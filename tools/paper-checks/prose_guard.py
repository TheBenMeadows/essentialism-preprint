#!/opt/homebrew/bin/python3
"""Prose-edit guard: fail when an edit changed LaTeX that a prose edit must leave alone.

The protected spans follow Lattice's src/editor/latex/latex-protected.ts
(https://github.com/leo1oel/lattice, Apache-2.0): math, \\cite/\\ref/\\label and
other reference commands with their keys, % comments, command names with their
options and braces, environment boundaries, verbatim code, and paragraph
breaks. Text inside known prose arguments (\\emph{...}, \\caption{...},
\\section{...}) is prose and may change; the arguments of any other macro are
protected whole.

Each .tex file under PATHS is compared between BASE (a git ref, default HEAD)
and the working tree. Exit 0 = every protected span unchanged and in order,
1 = something protected changed (listed), 2 = usage or git error.
"""

import argparse
import difflib
import os
import re
import subprocess
import sys

MATH_ENVIRONMENTS = {n + s for n in "align alignat displaymath eqnarray equation flalign gather math multline".split() for s in ("", "*")}
VERBATIM_ENVIRONMENTS = {n + s for n in "comment listing lstlisting minted verbatim Verbatim".split() for s in ("", "*")}
REFERENCE_COMMANDS = set("""
  autocite autoref bibliography bibliographystyle cite citealp citealt citeauthor citep citet citeyear cref Cref
  eqref footcite fullcite href hyperref include includegraphics input label nameref nocite pageref parencite ref
  subref textcite url vref
""".split())
PROSE_COMMANDS = {name: 0 for name in """
  caption chapter emph enquote footnote marginpar mbox paragraph part section subparagraph subsection
  subsubsection textbf textit textmd textnormal textrm textsc textsf textsl textup thanks title underline
""".split()}
PROSE_COMMANDS.update({"colorbox": 1, "textcolor": 1})
INFINITE = float("inf")
BLANK_LINE = re.compile(r"\n[^\S\n]*\n")
PARAGRAPH_BREAK = re.compile(r"\n[^\S\n]*\n\s*")


def is_letter(char):
    return char is not None and (char.isascii() and char.isalpha() or char == "@")


def at(source, index):
    return source[index] if 0 <= index < len(source) else None


def group_end(source, start, opener, closer):
    depth, index = 0, start
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return len(source)


def paragraph_end(source, start):
    match = BLANK_LINE.search(source, start)
    return match.start() if match else len(source)


def math_end(source, start, closer):
    """Past an unescaped closer; TeX refuses a blank line inside math, so an unclosed one stops at the paragraph."""
    limit = paragraph_end(source, start)
    index = start
    while index < limit:
        if source.startswith(closer, index):
            return index + len(closer)
        if source[index] == "\\":
            index += 1
        index += 1
    return limit


def arguments_end(source, start, braced, skip_spaces):
    cursor, groups = start, 0
    while True:
        nxt = cursor
        if skip_spaces:
            while at(source, nxt) in (" ", "\t"):
                nxt += 1
        char = at(source, nxt)
        if char == "[":
            cursor = group_end(source, nxt, "[", "]")
        elif char == "{" and groups < braced:
            cursor = group_end(source, nxt, "{", "}")
            groups += 1
        else:
            return cursor


def protect_environment(source, start, cursor, name, add):
    env_end = group_end(source, cursor, "{", "}") if at(source, cursor) == "{" else cursor
    environment = source[cursor + 1:env_end - 1]
    if name == "begin" and (environment in MATH_ENVIRONMENTS or environment in VERBATIM_ENVIRONMENTS):
        closing = "\\end{" + environment + "}"
        close = source.find(closing, env_end)
        end = len(source) if close < 0 else close + len(closing)
        return add(start, end, "math" if environment in MATH_ENVIRONMENTS else "verbatim")
    end = arguments_end(source, env_end, INFINITE, False) if name == "begin" else env_end
    return add(start, end, "environment")


def protect_verb(source, start, cursor, add):
    delimiter = at(source, cursor)
    close = source.find(delimiter, cursor + 1) if delimiter else -1
    line_end = source.find("\n", cursor)
    end = cursor + 1 if close < 0 or (line_end >= 0 and close > line_end) else close + 1
    return add(start, end, "verbatim")


def protect_escape(source, start, add):
    nxt = at(source, start + 1)
    if nxt == "(":
        return add(start, math_end(source, start + 2, "\\)"), "math")
    if nxt == "[":
        return add(start, math_end(source, start + 2, "\\]"), "math")
    end = min(len(source), start + 2)
    return add(start, arguments_end(source, end, 0, False) if nxt == "\\" else end, "command")


def protect_command(source, start, add):
    if not is_letter(at(source, start + 1)):
        return protect_escape(source, start, add)
    cursor = start + 1
    while is_letter(at(source, cursor)):
        cursor += 1
    name = source[start + 1:cursor]
    if at(source, cursor) == "*":
        cursor += 1
    if name in ("begin", "end"):
        return protect_environment(source, start, cursor, name, add)
    if name == "verb":
        return protect_verb(source, start, cursor, add)
    if name in REFERENCE_COMMANDS:
        return add(start, arguments_end(source, cursor, INFINITE, True), "reference")
    if name in PROSE_COMMANDS:
        return add(start, arguments_end(source, cursor, PROSE_COMMANDS[name], False), "command")
    return add(start, arguments_end(source, cursor, INFINITE, False), "command")


def protected_spans(source):
    spans = []

    def add(start, end, kind):
        if end > start:
            spans.append((start, end, kind))
        return max(end, start + 1)

    index = 0
    while index < len(source):
        char = source[index]
        if char == "%":
            newline = source.find("\n", index)
            index = add(index, len(source) if newline < 0 else newline, "comment")
        elif char == "$":
            marker = "$$" if at(source, index + 1) == "$" else "$"
            index = add(index, math_end(source, index + len(marker), marker), "math")
        elif char in "{}&#":
            index = add(index, index + 1, "command")
        elif char == "\n":
            match = PARAGRAPH_BREAK.match(source, index)
            index = add(index, match.end(), "paragraph") if match else index + 1
        elif char == "\\":
            index = protect_command(source, index, add)
        else:
            index += 1
    return spans


def signature(source):
    """[(key, line, text)] per protected span; a paragraph break compares as any blank-line run."""
    entries = []
    for start, end, kind in protected_spans(source):
        text = source[start:end]
        key = kind if kind == "paragraph" else f"{kind}:{text}"
        entries.append((key, source.count("\n", 0, start) + 1, text))
    return entries


# ---------------------------------------------------------------- git

def git(repo, *args):
    result = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def tex_files(repo, base, paths):
    at_base = git(repo, "ls-tree", "-r", "--name-only", base, "--", *paths).split("\n")
    tracked = git(repo, "ls-files", "--cached", "--others", "--exclude-standard", "--", *paths).split("\n")
    pick = lambda names: {n for n in names if n.endswith(".tex")}  # noqa: E731
    return pick(at_base), pick(tracked)


def shown(text):
    text = text.replace("\n", "\\n")
    return text if len(text) <= 110 else text[:107] + "..."


def compare(name, before, after):
    """Lines describing each protected span the edit changed, removed or added."""
    old, new = signature(before), signature(after)
    matcher = difflib.SequenceMatcher(None, [e[0] for e in old], [e[0] for e in new], autojunk=False)
    lines = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        for key, line, text in old[i1:i2]:
            lines.append(f"  - {name}:{line} (base) {key.split(':', 1)[0]}: {shown(text)}")
        for key, line, text in new[j1:j2]:
            lines.append(f"  + {name}:{line} (now)  {key.split(':', 1)[0]}: {shown(text)}")
    return lines


def run(repo, base, paths):
    at_base, now = tex_files(repo, base, paths)
    failures, compared = 0, 0
    for name in sorted(at_base | now):
        if name not in now:
            print(f"FAIL {name}: deleted since {base}")
            failures += 1
            continue
        if name not in at_base:
            print(f"WARN {name}: new since {base}, not compared")
            continue
        before = git(repo, "show", f"{base}:{name}")
        with open(os.path.join(repo, name), encoding="utf-8", errors="replace") as handle:
            after = handle.read()
        compared += 1
        if before == after:
            continue
        changes = compare(name, before, after)
        if changes:
            failures += 1
            print(f"FAIL {name}: protected LaTeX changed since {base}")
            print("\n".join(changes))
        else:
            print(f"ok   {name}: prose changed, protected spans intact")
    if failures:
        print(f"prose-guard: {failures} file(s) changed protected LaTeX")
        return 1
    print(f"prose-guard: passed ({compared} .tex files compared against {base})")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True, help="git working tree")
    parser.add_argument("--base", default="HEAD")
    parser.add_argument("paths", nargs="*", default=["."], help="paths inside the repo to scan")
    args = parser.parse_args()
    repo = os.path.abspath(args.repo)
    try:
        top = git(repo, "rev-parse", "--show-toplevel").strip()
        git(repo, "rev-parse", "--verify", "--quiet", args.base + "^{commit}")
        paths = [os.path.relpath(os.path.abspath(os.path.join(repo, p)), top) for p in args.paths]
        return run(top, args.base, paths)
    except RuntimeError as error:
        print(f"FAIL {error}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
