#!/opt/homebrew/bin/python3
"""arXiv pre-submission check for a LaTeX paper.

Adapted from Lattice's src-tauri/src/latex/arxiv.rs
(https://github.com/leo1oel/lattice, Apache-2.0).

  build   compile the paper into BUILD/tex and keep the record of the files
          TeX read (tectonic --makefile-rules, or pdflatex -recorder's .fls)
  check   stage the arXiv package from that record (the files TeX read inside
          the paper folder, plus the .bbl), check it, rebuild it alone in a
          temporary folder with pdflatex (no shell escape, no BibTeX), and
          write BUILD/arxiv/<stem>-arxiv.tar.gz with its sha256
  verify  exit non-zero unless the tarball on disk, and the package staged
          again from the current sources, both match the recorded sha256

Exit status: 0 = no failures, 1 = a check failed, 2 = usage or tool error.
"""

import argparse
import gzip
import hashlib
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

SIZE_LIMIT_BYTES = 50_000_000
COMPILE_TIME_LIMIT = 120
TEX_SOURCE_EXTENSIONS = {".tex", ".tikz", ".pgf", ".ltx", ".inc"}
# Read by BibTeX, not by TeX: arXiv does not run BibTeX, the .bbl ships instead.
BIBTEX_ONLY_EXTENSIONS = {".bib", ".bst"}
# pdfLaTeX cannot include these without a shell-escape conversion.
NON_PDFLATEX_FIGURES = {".eps", ".ps", ".svg"}
PRIVATE_TOP = {".git", ".claude"}

TODO_COMMENT = re.compile(r"(?i:\btodo\b|\bfixme\b)|\bXXX\b")
TODO_COMMAND = re.compile(r"\\(?:todo|missingfigure)\b")
# A definition of \todo is not a use of it.
TODO_DEFINITION = re.compile(r"\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand|def)\*?\s*\{?\\(?:todo|missingfigure)\b")
BIBLIOGRAPHY = re.compile(r"\\(?:bibliography\s*\{|printbibliography\b)")
BIBLATEX = re.compile(r"\\usepackage(?:\[[^\]]*\])?\{[^}]*\bbiblatex\b")
ENGINE_FEATURES = [
    (re.compile(r"\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math|polyglossia|luacode|luatexbase|luaotfload|xltxtra|xunicode)\b"),
     "package needs XeLaTeX/LuaLaTeX"),
    (re.compile(r"\\(directlua|luaexec|setmainfont|setsansfont|setmonofont|newfontfamily|XeTeXinputencoding|XeTeXlinebreaklocale)\b"),
     "command needs XeLaTeX/LuaLaTeX"),
    (re.compile(r"\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(minted|pythontex|svg|gnuplottex|sagetex|shellesc)\b"),
     "package needs shell escape, which arXiv disables"),
    (re.compile(r"\\(write18|ShellEscape|immediate\\write18)\b"), "shell escape, which arXiv disables"),
]
# Characters pdfLaTeX's default UTF-8 input (T1 + TS1) can typeset; anything
# else needs \DeclareUnicodeCharacter or \newunicodechar, or fails on arXiv.
EXTRA_SAFE_CHARS = set("\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122\ufb01\ufb02")
DECLARED_CHAR = re.compile(r"\\newunicodechar\s*\{(.)\}")
DECLARED_HEX = re.compile(r"\\DeclareUnicodeCharacter\s*\{([0-9A-Fa-f]{4,6})\}")


class Report:
    def __init__(self):
        self.failures = 0
        self.warnings = 0

    def fail(self, message):
        self.failures += 1
        print(f"FAIL {message}")

    def warn(self, message):
        self.warnings += 1
        print(f"WARN {message}")

    @staticmethod
    def ok(message):
        print(f"ok   {message}")

    @staticmethod
    def info(message):
        print(f"     {message}")


# ---------------------------------------------------------------- build

def tex_dir(build):
    return os.path.join(build, "tex")


def ensure_build_dir(build):
    os.makedirs(tex_dir(build), exist_ok=True)
    ignore = os.path.join(build, ".gitignore")
    if not os.path.exists(ignore):
        with open(ignore, "w", encoding="utf-8") as handle:
            handle.write("*\n")


def run_tectonic_build(root, main, build):
    out = os.path.relpath(tex_dir(build), root)
    stem = os.path.splitext(main)[0]
    command = ["tectonic", "-k", "--keep-logs", "-o", out,
               "--makefile-rules", os.path.join(out, stem + ".deps"), main]
    return subprocess.run(command, cwd=root, check=False).returncode


def run_pdflatex_build(root, main, build):
    out = os.path.abspath(tex_dir(build))
    stem = os.path.splitext(main)[0]
    latex = ["pdflatex", "-recorder", "-interaction=nonstopmode", "-halt-on-error",
             "-no-shell-escape", "-output-directory", out, main]
    if subprocess.run(latex, cwd=root, check=False).returncode:
        return 1
    aux = os.path.join(out, stem + ".aux")
    with open(aux, encoding="utf-8", errors="replace") as handle:
        needs_bibtex = "\\bibdata" in handle.read()
    if needs_bibtex:
        env = dict(os.environ, BIBINPUTS=os.path.abspath(root) + os.pathsep,
                   BSTINPUTS=os.path.abspath(root) + os.pathsep)
        if subprocess.run(["bibtex", stem], cwd=out, env=env, check=False).returncode:
            return 1
    for _ in range(2):
        if subprocess.run(latex, cwd=root, check=False).returncode:
            return 1
    return 0


def build_paper(root, main, build, engine):
    ensure_build_dir(build)
    if shutil.which(engine) is None:
        print(f"FAIL {engine} not found on PATH", file=sys.stderr)
        return 2
    runner = run_tectonic_build if engine == "tectonic" else run_pdflatex_build
    code = runner(root, main, build)
    if code == 0:
        with open(os.path.join(tex_dir(build), "engine.txt"), "w", encoding="utf-8") as handle:
            handle.write(engine + "\n")
    else:
        print(f"FAIL {engine} build of {main} failed (exit {code})")
    return 1 if code else 0


# ---------------------------------------------------------------- record

def split_make_words(text):
    words, current, escaped = [], [], False
    for char in text:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char.isspace():
            if current:
                words.append("".join(current))
                current = []
        else:
            current.append(char)
    if current:
        words.append("".join(current))
    return words


def parse_tectonic_deps(path, root):
    """(inputs, outputs) as absolute paths; tectonic writes them relative to its cwd."""
    with open(path, encoding="utf-8") as handle:
        text = handle.read().replace("\\\n", " ")
    head, _, tail = text.partition(":")
    absolute = lambda word: os.path.normpath(os.path.join(root, word))  # noqa: E731
    return ([absolute(w) for w in split_make_words(tail)],
            {absolute(w) for w in split_make_words(head)})


def parse_fls(path, root):
    cwd, inputs, outputs = root, [], set()
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if line.startswith("PWD "):
                cwd = line[4:]
            elif line.startswith("INPUT "):
                inputs.append(os.path.normpath(os.path.join(cwd, line[6:])))
            elif line.startswith("OUTPUT "):
                outputs.add(os.path.normpath(os.path.join(cwd, line[7:])))
    return inputs, outputs


def read_record(root, main, build):
    stem = os.path.splitext(main)[0]
    deps = os.path.join(tex_dir(build), stem + ".deps")
    fls = os.path.join(tex_dir(build), stem + ".fls")
    if os.path.isfile(fls) and (not os.path.isfile(deps) or os.path.getmtime(fls) >= os.path.getmtime(deps)):
        return parse_fls(fls, root)
    if os.path.isfile(deps):
        return parse_tectonic_deps(deps, root)
    return None


def inside(path, folder):
    return os.path.commonpath([path, folder]) == folder


def classify_inputs(root, build, inputs, outputs):
    """Project-relative paths TeX read: (sources, bbl path or None)."""
    root = os.path.abspath(root)
    texout = os.path.abspath(tex_dir(build))
    sources, bbl = [], None
    for path in dict.fromkeys(inputs):
        if not inside(path, root):
            continue
        if inside(path, texout):
            if os.path.isfile(path):
                if path.endswith(".bbl"):
                    bbl = path
                continue
            # tectonic -o prefixes the output folder onto inputs it found in its cwd
            path = os.path.join(root, os.path.relpath(path, texout))
        if path in outputs or os.path.relpath(path, root).split(os.sep)[0] in PRIVATE_TOP:
            continue
        if inside(path, os.path.abspath(build)):
            continue
        sources.append(os.path.relpath(path, root))
    if bbl is None:
        bbl = next((o for o in outputs if o.endswith(".bbl") and os.path.isfile(o)), None)
    return sources, bbl


def disk_spelling(root, rel):
    """The path as the disk spells it, or None when a component has no exact or case-folded match."""
    current, parts = root, []
    for part in rel.split(os.sep):
        try:
            names = os.listdir(current)
        except OSError:
            return None
        if part not in names:
            folded = [n for n in names if n.lower() == part.lower()]
            if not folded:
                return None
            part = folded[0]
        parts.append(part)
        current = os.path.join(current, part)
    return os.sep.join(parts)


# ---------------------------------------------------------------- stage

class Package:
    def __init__(self, root, main):
        self.root = root
        self.main = main
        self.files = {}          # package path -> bytes
        self.missing = []
        self.miscased = []       # (as written, as on disk)
        self.has_bbl = False


def stage(root, main, build):
    record = read_record(root, main, build)
    if record is None:
        return None
    sources, bbl = classify_inputs(root, build, *record)
    package = Package(root, main)
    for rel in sorted(set(sources)):
        if os.path.splitext(rel)[1].lower() in BIBTEX_ONLY_EXTENSIONS:
            continue
        on_disk = disk_spelling(root, rel)
        if on_disk is None or not os.path.isfile(os.path.join(root, on_disk)):
            package.missing.append(rel)
            continue
        if on_disk != rel:
            package.miscased.append((rel, on_disk))
        with open(os.path.join(root, on_disk), "rb") as handle:
            package.files[on_disk.replace(os.sep, "/")] = handle.read()
    if bbl:
        with open(bbl, "rb") as handle:
            package.files[os.path.splitext(main)[0] + ".bbl"] = handle.read()
        package.has_bbl = True
    return package


def tarball_bytes(files):
    raw = io.BytesIO()
    with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as tar:
            for name in sorted(files):
                info = tarfile.TarInfo(name)
                info.size = len(files[name])
                info.mtime = 0
                info.mode = 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                tar.addfile(info, io.BytesIO(files[name]))
    return raw.getvalue()


# ---------------------------------------------------------------- checks

def strip_comment(line):
    """(code, comment or None) for one line; an escaped \\% is not a comment."""
    at = 0
    while True:
        at = line.find("%", at)
        if at < 0:
            return line, None
        backslashes = len(line[:at]) - len(line[:at].rstrip("\\"))
        if backslashes % 2 == 0:
            return line[:at], line[at + 1:]
        at += 1


def tex_lines(package):
    """(file, line number, code, comment) for every line of every TeX source."""
    for name in sorted(package.files):
        if os.path.splitext(name)[1].lower() not in TEX_SOURCE_EXTENSIONS:
            continue
        text = package.files[name].decode("utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), 1):
            code, comment = strip_comment(line)
            yield name, number, code, comment


def check_files(package, report):
    for rel in package.missing:
        report.fail(f"missing: the last build read {rel}, which is not on disk now")
    for written, disk in package.miscased:
        report.fail(f"case mismatch: the source names {written}, the disk has {disk} (arXiv builds on a case-sensitive Linux disk)")
    if not package.missing and not package.miscased:
        report.ok(f"{len(package.files)} files staged, none missing, letter case matches the disk")
    for name in sorted(package.files):
        if os.path.splitext(name)[1].lower() in NON_PDFLATEX_FIGURES:
            report.fail(f"figure {name}: pdfLaTeX cannot include it without a shell-escape conversion")


def check_size(package, report):
    total = sum(len(data) for data in package.files.values())
    if total > SIZE_LIMIT_BYTES:
        report.fail(f"package is {total:,} bytes, over arXiv's {SIZE_LIMIT_BYTES:,}-byte limit")
    else:
        report.ok(f"package size {total:,} bytes (limit {SIZE_LIMIT_BYTES:,})")


def check_bibliography(package, report):
    code = "\n".join(c for _, _, c, _ in tex_lines(package))
    cites = BIBLIOGRAPHY.search(code) is not None
    if BIBLATEX.search(code):
        report.warn("biblatex: arXiv needs a .bbl made by the biber version it runs")
    if cites and not package.has_bbl:
        report.fail("the paper has a bibliography but the build left no .bbl (arXiv does not run BibTeX)")
    elif package.has_bbl:
        report.ok(f"{os.path.splitext(package.main)[0]}.bbl ships")


def check_todos(package, report):
    todos, comments = [], 0
    for name, number, code, comment in tex_lines(package):
        if TODO_COMMAND.search(TODO_DEFINITION.sub("", code)):
            todos.append(f"{name}:{number}: {code.strip()[:100]}")
        if comment is not None and comment.strip():
            comments += 1
            if TODO_COMMENT.search(comment):
                todos.append(f"{name}:{number}: %{comment.strip()[:100]}")
    for todo in todos:
        report.fail(f"leftover TODO: {todo}")
    if not todos:
        report.ok("no \\todo commands or TODO/FIXME/XXX comments")
    if comments:
        report.info(f"{comments} comment lines ship in the source (arXiv publishes the source)")


def check_engine(package, report):
    found = False
    for name, number, code, _ in tex_lines(package):
        for pattern, why in ENGINE_FEATURES:
            match = pattern.search(code)
            if match:
                found = True
                report.fail(f"{name}:{number}: {match.group(0)}: {why}")
    if not found:
        report.ok("no XeLaTeX/LuaLaTeX-only or shell-escape features")


def declared_chars(package):
    declared = set()
    for _, _, code, _ in tex_lines(package):
        declared.update(DECLARED_CHAR.findall(code))
        declared.update(chr(int(h, 16)) for h in DECLARED_HEX.findall(code))
    return declared


def unsafe_char(char, declared):
    point = ord(char)
    if point < 0x80 or 0xA0 <= point <= 0x17F:
        return False
    return char not in EXTRA_SAFE_CHARS and char not in declared


def check_unicode(package, report):
    """tectonic is XeTeX: it typesets any Unicode the font has; pdfLaTeX does not."""
    declared = declared_chars(package)
    lines = list(tex_lines(package))
    bbl = os.path.splitext(package.main)[0] + ".bbl"
    if bbl in package.files:
        text = package.files[bbl].decode("utf-8", errors="replace")
        lines += [(bbl, n, line, None) for n, line in enumerate(text.splitlines(), 1)]
    bad = 0
    for name, number, code, _ in lines:
        chars = sorted({c for c in code if unsafe_char(c, declared)})
        if chars:
            bad += 1
            shown = " ".join(f"{c} (U+{ord(c):04X})" for c in chars)
            report.fail(f"{name}:{number}: {shown}: pdfLaTeX has no default definition for this character")
    if not bad:
        report.ok("no characters outside pdfLaTeX's default UTF-8 set")


# ---------------------------------------------------------------- rebuild

def write_tree(files, folder):
    for name, data in files.items():
        target = os.path.join(folder, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(data)


def log_problems(log_text):
    problems = re.findall(r"(?:Citation|Reference) `[^']+' on page \d+ undefined", log_text)
    if "There were undefined references" in log_text and not problems:
        problems.append("There were undefined references")
    return problems


def pdflatex_alone(folder, main):
    command = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", main]
    log = os.path.join(folder, os.path.splitext(main)[0] + ".log")
    for _ in range(3):
        result = subprocess.run(command, cwd=folder, capture_output=True, text=True,
                                timeout=COMPILE_TIME_LIMIT, check=False)
        if result.returncode:
            return f"pdflatex failed:\n{result.stdout[-2500:]}", ""
        with open(log, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        if "Rerun to get" not in text and "Rerun LaTeX" not in text:
            break
    return None, text


def tectonic_alone(folder, main):
    """Approximation for a machine without pdflatex: XeTeX, not arXiv's engine.

    tectonic runs BibTeX whenever the .aux names a database, so the copy built
    here reads the .bbl through \\input instead of \\bibliography.
    """
    stem = os.path.splitext(main)[0]
    path = os.path.join(folder, main)
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    text = re.sub(r"\\bibliographystyle\s*\{[^}]*\}", "", text)
    text = re.sub(r"\\bibliography\s*\{[^}]*\}", lambda _: "\\input{" + stem + ".bbl}", text)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    result = subprocess.run(["tectonic", "--untrusted", "--keep-logs", main], cwd=folder,
                            capture_output=True, text=True, timeout=COMPILE_TIME_LIMIT, check=False)
    if result.returncode:
        return f"tectonic failed:\n{(result.stdout + result.stderr)[-2500:]}", ""
    with open(os.path.join(folder, stem + ".log"), encoding="utf-8", errors="replace") as handle:
        return None, handle.read()


def check_rebuild(package, report, fallback):
    if shutil.which("pdflatex"):
        builder, label = pdflatex_alone, "pdflatex"
    elif fallback == "tectonic" and shutil.which("tectonic"):
        builder, label = tectonic_alone, "tectonic (fallback)"
        report.warn("pdflatex is not installed; the package was rebuilt with tectonic (XeTeX), "
                    "which is not arXiv's engine - install TeX Live for the real test")
    else:
        report.fail("pdflatex is not installed, so the package cannot be rebuilt the way arXiv builds it "
                    "(install TeX Live, or set PDFLATEX_FALLBACK=tectonic for an approximation)")
        return
    with tempfile.TemporaryDirectory(prefix="arxiv-check-") as folder:
        write_tree(package.files, folder)
        try:
            error, log_text = builder(folder, package.main)
        except subprocess.TimeoutExpired:
            report.fail(f"{label} rebuild of the package alone took over {COMPILE_TIME_LIMIT} s")
            return
        pdf = os.path.join(folder, os.path.splitext(package.main)[0] + ".pdf")
        if error or not os.path.isfile(pdf):
            report.fail(f"{label} rebuild of the package alone failed: {error or 'no PDF'}")
            return
        problems = log_problems(log_text)
        for problem in problems:
            report.fail(f"{label} rebuild: {problem}")
        if not problems:
            report.ok(f"package rebuilt alone with {label}, no shell escape, no BibTeX")


# ---------------------------------------------------------------- commands

def arxiv_paths(build, main):
    stem = os.path.splitext(os.path.basename(main))[0]
    folder = os.path.join(build, "arxiv")
    tarball = os.path.join(folder, f"{stem}-arxiv.tar.gz")
    return folder, tarball, tarball + ".sha256"


def write_outputs(package, build, report):
    folder, tarball, sha_path = arxiv_paths(build, package.main)
    os.makedirs(folder, exist_ok=True)
    data = tarball_bytes(package.files)
    digest = hashlib.sha256(data).hexdigest()
    with open(tarball, "wb") as handle:
        handle.write(data)
    with open(sha_path, "w", encoding="utf-8") as handle:
        handle.write(f"{digest}  {os.path.basename(tarball)}\n")
    with open(os.path.join(folder, "MANIFEST.txt"), "w", encoding="utf-8") as handle:
        for name in sorted(package.files):
            content = package.files[name]
            handle.write(f"{hashlib.sha256(content).hexdigest()}  {len(content):>9}  {name}\n")
    report.ok(f"wrote {tarball}")
    report.info(f"sha256 {digest}")


def remove_outputs(build, main):
    _, tarball, sha_path = arxiv_paths(build, main)
    for path in (tarball, sha_path):
        if os.path.exists(path):
            os.remove(path)


def command_check(args):
    package = stage(args.root, args.main, args.build)
    if package is None:
        print(f"FAIL no build record in {tex_dir(args.build)}: run the build first")
        return 2
    report = Report()
    print(f"arXiv package for {os.path.join(args.root, args.main)}")
    for name in sorted(package.files):
        report.info(f"{len(package.files[name]):>9}  {name}")
    for check in (check_files, check_size, check_bibliography, check_todos, check_engine, check_unicode):
        check(package, report)
    if not args.no_rebuild:
        check_rebuild(package, report, args.fallback)
    if report.failures:
        remove_outputs(args.build, args.main)
        print(f"arxiv-check: {report.failures} failed, {report.warnings} warnings; no tarball written")
        return 1
    write_outputs(package, args.build, report)
    print(f"arxiv-check: passed, {report.warnings} warnings")
    return 0


def sha256_file(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def command_verify(args):
    _, tarball, sha_path = arxiv_paths(args.build, args.main)
    if not (os.path.isfile(tarball) and os.path.isfile(sha_path)):
        print(f"FAIL no checked package at {tarball}: run make arxiv-check")
        return 1
    with open(sha_path, encoding="utf-8") as handle:
        recorded = handle.read().split()[0]
    current = sha256_file(tarball)
    if current != recorded:
        print(f"FAIL {tarball} changed after it was checked\n     recorded {recorded}\n     now      {current}")
        return 1
    package = stage(args.root, args.main, args.build)
    restaged = hashlib.sha256(tarball_bytes(package.files)).hexdigest() if package else None
    if restaged != recorded:
        print(f"FAIL the sources changed after the check: staging them again gives {restaged}\n"
              f"     recorded {recorded}\n     run make arxiv-check again")
        return 1
    print(f"ok   {os.path.basename(tarball)} matches the checked package\n     sha256 {recorded}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["build", "check", "verify"])
    parser.add_argument("--root", required=True, help="folder holding the main .tex")
    parser.add_argument("--main", default="main.tex")
    parser.add_argument("--build", required=True, help="build output folder")
    parser.add_argument("--engine", default="tectonic", choices=["tectonic", "pdflatex"])
    parser.add_argument("--fallback", default="", help="'tectonic' to rebuild with tectonic when pdflatex is absent")
    parser.add_argument("--no-rebuild", action="store_true")
    args = parser.parse_args()
    args.root = os.path.abspath(args.root)
    args.build = os.path.abspath(args.build)
    if args.command == "build":
        return build_paper(args.root, args.main, args.build, args.engine)
    if args.command == "check":
        return command_check(args)
    return command_verify(args)


if __name__ == "__main__":
    sys.exit(main())
