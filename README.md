# essentialism preprint

Source, data and measurement code for "essentialism: An On-Chain Generative Work That Forgets Two Photographs" (Benjamin Meadows, October 2026).

## Build

Requirements: Node.js 26 or later, Tectonic 0.17, and for Figure 1 only, Inkscape 1.4 and `sips` (macOS).

```
make            # data, figures and main.pdf; runs offline
make check      # verify data/ against data/SHA256SUMS, then check every number and fact in main.tex
make verify     # network: fetch the generator from Tezos and compare it with the local copy
```

`make data` is deterministic and takes about 40 seconds. After it, `make check` must pass.

## Layout

| path | contents |
|---|---|
| `main.tex`, `refs.bib`, `main.pdf` | the paper |
| `repro/essentialism.chain.js` | generator version 6, byte-identical to the code stored on Tezos (sha256 `33d85a12cf2a8404bccda1e31d6b3fd72c361673f995cc58b0857eabb6d5c248`) |
| `repro/runtime.mjs` | stand-in for the bootloader SVG-JS runtime (splitmix64 into sfc32, as in the platform's artifact template) and `renderSwapped`, the counterfactual used as the null |
| `repro/verify-chain.mjs` | fetches big map 771404 key 407 through TzKT, checks the digest, writes `data/generator-history.csv` |
| `repro/census.mjs` | trait frequencies over 20,000 seeds (Table 1) |
| `repro/field.mjs`, `repro/sigma.mjs` | correlation of the memory field with each photograph per edition, and the two standard deviations used by Eq. 3 |
| `repro/measure.mjs` | 44,000 renders: rank correlation of each render's dot ink with the photograph it sampled, single-ink renders scored 0, and the counterfactual null |
| `repro/extra.mjs` | the area-weighted measure (ink, dot size and presence per grid cell) and carbon-dot counts per edition |
| `repro/plotdata.mjs`, `repro/tables.mjs` | the table behind Figure 3, and the rows of Table 2 |
| `repro/stats.mjs` | every number quoted in the text, written to `data/stats.txt` |
| `repro/figures.mjs` | the four renders in Figure 1 |
| `repro/embed-photo.py` | the script that reduced each photograph to its 28x38 grid; the photographs themselves are not included |
| `review/audit.mjs` | checks every measured number in `main.tex` against `data/stats.txt` |
| `review/orrery-audit.mjs` | checks every non-measured fact in `main.tex`: chain history, byte counts, costs, cited code lines, quoted constants, citation keys; with `--rebuild`, rebuilds a clean clone and compares checksums |
| `review/probes.mjs`, `review/probes-r2.mjs` | the checks behind method choices in Section 4 (the closed-form gap, the null, single-ink renders, ordering, carbon) |
| `data/` | every CSV the paper reads, the raw TzKT responses, `SHA256SUMS` |

## Do not edit `repro/essentialism.chain.js`

The file is chain bytes, not source. A formatter, a prose pass or a line-ending change breaks the digest, and every number in the paper then describes a program that is not on Tezos. If the generator changes on-chain, regenerate the file from the contract and update the pin in `repro/verify-chain.mjs`.

## Not reproducible from this package

- The platform's image of a minted token. The platform's artifact template seeds the generator exactly as `repro/runtime.mjs` does, but no seed derived from the token's on-chain data reproduces the platform's image of edition 1 (paper, Section 5). A token's memory factor can be computed from its edition number.
- The grids from the published photographs. `embed-photo.py` crops and autocontrasts its input, and the published images are not the exact files used. The strings stored in the generator are the authority.
- Exact grain in Figure 1. The texture comes from SVG filters, and Inkscape and browsers render them slightly differently.

## Licence

The paper (`main.tex`, `main.pdf`, `refs.bib`, `figures/`) is CC BY 4.0. Everything else, including the copy of the generator, is MIT. See `LICENSE`.
