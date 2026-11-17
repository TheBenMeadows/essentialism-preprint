# Pre-submission checks for a LaTeX paper (adapted from the Lattice app,
# https://github.com/leo1oel/lattice, Apache-2.0). Include this file after
# setting PAPER_DIR (the folder holding MAIN) and PAPER_CHECKS (the folder
# holding these scripts).
#
#   make arxiv-check   build, stage the arXiv package from what TeX read,
#                      check it, rebuild it alone with pdflatex, write
#                      $(PAPER_BUILD)/arxiv/<stem>-arxiv.tar.gz + .sha256
#   make arxiv-verify  fail unless that tarball still matches its recorded sha256
#   make cite-health   Crossref/DataCite retraction and correction lookup (network)
#   make prose-guard   fail if math, citations, labels, commands or comments
#                      changed since BASE (default HEAD)
#   make pdf-check     fonts embedded, no Type 3; author metadata report
#                      (BLIND=1 fails if the authors are named)
#   make paper-checks  the offline ones: arxiv-check prose-guard pdf-check
#
# PDFLATEX_FALLBACK=tectonic rebuilds the package with tectonic when pdflatex
# is not installed; the result is an approximation, not arXiv's engine.

MAIN ?= main.tex
PAPER_BUILD ?= $(PAPER_DIR)/build
TEX_ENGINE ?= tectonic
PAPER_PY ?= /opt/homebrew/bin/python3
BIB ?= $(wildcard $(PAPER_DIR)/*.bib)
BASE ?= HEAD
BLIND ?=
NAMES ?=
STRICT ?=
PDFLATEX_FALLBACK ?=

PAPER_PDF = $(PAPER_BUILD)/tex/$(basename $(notdir $(MAIN))).pdf

paper-build:
	$(PAPER_PY) $(PAPER_CHECKS)/arxiv_check.py build --root $(PAPER_DIR) --main $(MAIN) --build $(PAPER_BUILD) --engine $(TEX_ENGINE)

arxiv-check: paper-build
	$(PAPER_PY) $(PAPER_CHECKS)/arxiv_check.py check --root $(PAPER_DIR) --main $(MAIN) --build $(PAPER_BUILD) $(if $(PDFLATEX_FALLBACK),--fallback $(PDFLATEX_FALLBACK))

arxiv-verify:
	$(PAPER_PY) $(PAPER_CHECKS)/arxiv_check.py verify --root $(PAPER_DIR) --main $(MAIN) --build $(PAPER_BUILD)

cite-health:
	@mkdir -p $(PAPER_BUILD) && { [ -f $(PAPER_BUILD)/.gitignore ] || echo '*' > $(PAPER_BUILD)/.gitignore; }
	$(PAPER_PY) $(PAPER_CHECKS)/cite_health.py --cache $(PAPER_BUILD)/cite-cache $(if $(STRICT),--strict) $(BIB)

prose-guard:
	$(PAPER_PY) $(PAPER_CHECKS)/prose_guard.py --repo $(PAPER_DIR) --base $(BASE) .

pdf-check: paper-build
	$(PAPER_PY) $(PAPER_CHECKS)/pdf_check.py $(PAPER_PDF) --tex $(PAPER_DIR)/$(MAIN) $(if $(BLIND),--blind) $(if $(NAMES),--names "$(NAMES)")

paper-checks: arxiv-check prose-guard pdf-check

.PHONY: paper-build arxiv-check arxiv-verify cite-health prose-guard pdf-check paper-checks
