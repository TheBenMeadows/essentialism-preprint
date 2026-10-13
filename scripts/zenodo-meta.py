#!/opt/homebrew/bin/python3
"""Writes .zenodo.json and abstract.txt from main.tex, so the Zenodo record and
the paper never disagree. Run before tagging a release."""
import json, re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tex = (root / "main.tex").read_text()
title = re.search(r"\\title\{(.*?)\}\n", tex, re.S).group(1)
title = re.sub(r"\\texttt\{(.*?)\}", r"\1", title).replace("\\\\", " ")
abstract = tex.split("\\begin{abstract}")[1].split("\\end{abstract}")[0].strip()
for a, b in [(r"\\texttt\{(.*?)\}", r"\1"), (r"\$28\\times38\$", "28x38"), (r"\\%", "%"), (r"\{,\}", ","),
             (r"``|''", '"'), (r"\\citep?\{.*?\}", ""), (r"\\url\{(.*?)\}", r"\1")]:
    abstract = re.sub(a, b, abstract)
assert "\\" not in abstract and "$" not in abstract, "unconverted LaTeX left in abstract"
(root / "abstract.txt").write_text(abstract + "\n")
meta = {
    "upload_type": "publication",
    "publication_type": "preprint",
    "title": title,
    "creators": [{"name": "Meadows, Benjamin", "orcid": "0009-0007-9698-0910"}],
    "description": abstract,
    "license": "cc-by-4.0",
    "language": "eng",
    "keywords": ["generative art", "on-chain art", "blockchain", "Tezos", "memory", "forgetting", "digital preservation"],
    "related_identifiers": [
        {"identifier": "https://bootloader.art/generator/svg-js/407", "relation": "documents", "resource_type": "other"},
        {"identifier": "https://thebenmeadows.com/blog/essentialism-the-working-log/", "relation": "isSupplementTo", "resource_type": "publication-other"},
    ],
    "notes": "Paper text (main.tex, main.pdf, refs.bib, figures) is CC BY 4.0. Code and data, including the copy of the on-chain generator, are MIT. See LICENSE.",
}
(root / ".zenodo.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
print(f"title: {title}\nabstract: {len(abstract)} chars\nwrote .zenodo.json and abstract.txt")
