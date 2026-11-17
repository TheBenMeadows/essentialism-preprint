#!/opt/homebrew/bin/python3
"""PDF submission check: fonts and author metadata of a built paper.

Adapted from the PDF part of Lattice's src-tauri/src/latex/submission_review.rs
(https://github.com/leo1oel/lattice, Apache-2.0), using poppler's pdffonts,
pdfinfo and pdftotext.

Fails on any Type 3 font or any font not embedded. Reports the Info /Author
and XMP dc:creator. With --blind (make BLIND=1) it also fails when that
metadata is set or when an author name or e-mail address from the paper's
\\author{...} (an "Anonymous" placeholder is skipped) or from --names appears
in the PDF's text; pass the real names with --names (make NAMES="A;B") when
the source is already anonymized.

Exit 0 = pass, 1 = a check failed, 2 = poppler missing or no PDF.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

TOOLS = ("pdffonts", "pdfinfo", "pdftotext")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def run(*command):
    return subprocess.run(command, capture_output=True, text=True, check=True).stdout


def font_rows(pdf):
    """[{name, type, emb}] from pdffonts, split on the column widths its dashed rule gives."""
    lines = run("pdffonts", pdf).splitlines()
    if len(lines) < 2:
        return []
    rule = lines[1]
    columns, start = [], 0
    for part in rule.split(" "):
        columns.append((start, start + len(part)))
        start += len(part) + 1
    names = ["name", "type", "encoding", "emb", "sub", "uni", "object", "id"]
    rows = []
    for line in lines[2:]:
        cells = [line[a:b + 1].strip() for a, b in columns]
        rows.append(dict(zip(names, cells, strict=False)))
    return rows


def check_fonts(pdf):
    failures = 0
    rows = font_rows(pdf)
    for row in rows:
        if row.get("type", "").startswith("Type 3"):
            print(f"FAIL Type 3 font: {row.get('name') or '[none]'}")
            failures += 1
        if row.get("emb") == "no":
            print(f"FAIL font not embedded: {row.get('name')} ({row.get('type')})")
            failures += 1
    if not failures:
        print(f"ok   {len(rows)} fonts, all embedded, no Type 3")
    return failures


def metadata(pdf):
    info = {}
    for line in run("pdfinfo", pdf).splitlines():
        key, _, value = line.partition(":")
        info[key.strip()] = value.strip()
    xmp = run("pdfinfo", "-meta", pdf)
    creator = re.search(r"<dc:creator>(.*?)</dc:creator>", xmp, re.S)
    info["dc:creator"] = "; ".join(re.findall(r"<rdf:li[^>]*>(.*?)</rdf:li>", creator.group(1), re.S)) if creator else ""
    return info


def strip_tex(text):
    text = re.sub(r"\\thanks\s*\{[^{}]*\}", " ", text)
    text = re.sub(r"\\(?:texttt|textit|textbf|emph|url|href)\s*\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\*?", " ", text)
    return re.sub(r"[{}~]", " ", text)


def author_block(tex):
    match = re.search(r"\\author\s*(?:\[[^\]]*\])?\s*\{", tex)
    if not match:
        return ""
    depth, index = 1, match.end()
    while index < len(tex) and depth:
        depth += {"{": 1, "}": -1}.get(tex[index], 0)
        index += 1
    return tex[match.end():index - 1]


def names_from_tex(path):
    """The first line of each \\and-separated author, plus any e-mail address."""
    with open(path, encoding="utf-8", errors="replace") as handle:
        block = author_block(handle.read())
    names = EMAIL.findall(block)
    for person in re.split(r"\\and\b", block):
        first = re.split(r"\\\\", person)[0]
        name = " ".join(strip_tex(first).split())
        if name and not name.lower().startswith("anonymous"):
            names.append(name)
    return names


def check_metadata(pdf, blind, names):
    info = metadata(pdf)
    for key in ("Title", "Author", "Creator", "Producer", "dc:creator"):
        print(f"     {key}: {info.get(key, '') or '(none)'}")
    if not blind:
        return 0
    failures = 0
    for key in ("Author", "dc:creator"):
        if info.get(key):
            print(f"FAIL blind: PDF {key} metadata is set ({info[key]})")
            failures += 1
    text = " ".join(run("pdftotext", "-q", pdf, "-").split()).lower()
    for name in names:
        if name.lower() in text:
            print(f"FAIL blind: the PDF text names {name}")
            failures += 1
    if not failures:
        print(f"ok   blind: no author metadata, none of {len(names)} names in the text")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf")
    parser.add_argument("--tex", help="main .tex, for the \\author names")
    parser.add_argument("--blind", action="store_true")
    parser.add_argument("--names", default="", help="extra names, ';'-separated")
    args = parser.parse_args()
    missing = [tool for tool in TOOLS if shutil.which(tool) is None]
    if missing:
        print(f"FAIL {', '.join(missing)} not found: poppler is not installed (brew install poppler)")
        return 2
    if not os.path.isfile(args.pdf):
        print(f"FAIL no PDF at {args.pdf}: build the paper first")
        return 2
    names = [n.strip() for n in args.names.split(";") if n.strip()]
    if args.tex:
        names += names_from_tex(args.tex)
    print(f"pdf-check {args.pdf}")
    failures = check_fonts(args.pdf) + check_metadata(args.pdf, args.blind, list(dict.fromkeys(names)))
    print(f"pdf-check: {'passed' if not failures else f'{failures} failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
