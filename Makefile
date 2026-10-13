# Rebuilds every number, table, figure and the PDF from the stored generator.
# `make` runs offline; `make verify` needs the network (TzKT) and refreshes the
# on-chain checks and data/generator-history.csv.
NODE ?= node
TECTONIC ?= tectonic
# sha256sum (coreutils) where available, else shasum (macOS); both print the same format
SHA256 ?= $(shell command -v sha256sum >/dev/null 2>&1 && echo sha256sum || echo shasum -a 256)

all: data figures paper

verify:
	$(NODE) repro/verify-chain.mjs

data:
	$(NODE) repro/census.mjs 20000
	$(NODE) repro/field.mjs 1000
	$(NODE) repro/sigma.mjs 1000 | tee data/sigma.txt
	$(NODE) repro/measure.mjs 1000
	$(NODE) repro/extra.mjs 1000
	$(NODE) repro/plotdata.mjs
	$(NODE) repro/tables.mjs > /dev/null
	$(NODE) repro/stats.mjs > /dev/null
	cd data && $(SHA256) census.csv curve.csv field.csv grids.csv plot.csv renders.csv sigma.txt stats.txt area.csv carbon.csv table2.tex > SHA256SUMS

figures:
	$(NODE) repro/figures.mjs 1391882777
	cd figures && for e in 01 15 30 44; do \
	  inkscape strip-ed$$e.svg --export-type=png --export-width=750 --export-filename=strip-ed$$e.png && \
	  sips -s format jpeg -s formatOptions 88 strip-ed$$e.png --out strip-ed$$e.jpg >/dev/null && rm strip-ed$$e.png; done

paper:
	$(TECTONIC) main.tex

check:
	cd data && $(SHA256) -c SHA256SUMS
	$(NODE) review/audit.mjs
	$(NODE) review/orrery-audit.mjs

.PHONY: all verify data figures paper check
