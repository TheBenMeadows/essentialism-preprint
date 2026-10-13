// Two secondary measurements for Section 4.
//
// 1. Area-weighted ink per grid cell: for each of the 28x38 cells, the sum over
//    dots centred in it of dot area times (ink darkness minus paper darkness),
//    Pearson-correlated with the grid. Unlike measure.mjs it also counts dot
//    size and column presence, and it is defined for single-ink renders. Same
//    counterfactual null as measure.mjs. Editions 1, 9, 22, 34 and 44.
// 2. Carbon dots on light paper, per edition: the darkest ink needs D > 0.88,
//    which the falling memory weight eventually makes unreachable.
//
// Usage: node extra.mjs [nSeeds=1000] -> ../data/area.csv, ../data/carbon.csv
import { writeFileSync } from 'node:fs';
import { render, renderSwapped, grid } from './runtime.mjs';

const N = Number(process.argv[2] || 1000);
const W = 750, H = 1000, GW = 28, GH = 38, EMBER = '#e0521b', CARBON = '#1c161c';
const GR = { 'blue tree': grid('TREE'), 'natural gradient': grid('SKY') };
const inkDark = h => 1 - (parseInt(h.slice(1, 3), 16) * .299 + parseInt(h.slice(3, 5), 16) * .587 + parseInt(h.slice(5, 7), 16) * .114) / 255;
const pearson = (x, y) => { const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; };
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const cells = g => [...g].map(c => 1 - parseInt(c, 16) / 15);
const dotsOf = root => root.children.find(c => c.name === 'g').children.filter(c => c.attrs.fill !== EMBER);
const areaScore = (root, src, sgn) => {
  const pd = inkDark(root.children.find(c => c.name === 'rect').attrs.fill), v = new Array(GW * GH).fill(0);
  for (const c of dotsOf(root)) {
    const i = Math.min(GW - 1, Math.floor(+c.attrs.cx / W * GW)), j = Math.min(GH - 1, Math.floor(+c.attrs.cy / H * GH));
    v[j * GW + i] += Math.PI * (+c.attrs.r) ** 2 * (inkDark(c.attrs.fill) - pd);
  }
  const r = sgn * pearson(v, cells(GR[src]));
  return Number.isFinite(r) ? r : 0;
};

const seeds = Array.from({ length: N }, (_, i) => 1000003 + (i + 1) * 7919);
const area = ['ed,src,n,med,null_med,single_ink_n,single_ink_med'];
const acc = {};
for (const seed of seeds) for (const ed of [1, 9, 22, 34, 44]) {
  const root = render(seed, ed), desc = root.children.find(c => c.name === 'desc').text;
  const src = desc.match(/source: ([a-z ]+) ·/)[1], sgn = desc.includes('· night') ? -1 : 1;
  const k = `${ed}|${src}`; acc[k] ??= { s: [], n: [], single: [] };
  const s = areaScore(root, src, sgn);
  acc[k].s.push(s); acc[k].n.push(areaScore(renderSwapped(seed, ed), src, sgn));
  if (new Set(dotsOf(root).map(c => c.attrs.fill)).size < 2) acc[k].single.push(s);
}
for (const src of ['blue tree', 'natural gradient']) for (const ed of [1, 9, 22, 34, 44]) {
  const a = acc[`${ed}|${src}`];
  area.push([ed, src === 'blue tree' ? 'tree' : 'sky', a.s.length, quant(a.s, .5).toFixed(6), quant(a.n, .5).toFixed(6), a.single.length, a.single.length ? quant(a.single, .5).toFixed(6) : 'NA'].join(','));
}
writeFileSync(new URL('../data/area.csv', import.meta.url), area.join('\n') + '\n');

const carbon = ['ed,light_paper_renders,carbon_dots'];
for (let ed = 1; ed <= 44; ed++) {
  let n = 0, c = 0;
  for (const seed of seeds) {
    const root = render(seed, ed);
    if (root.children.find(x => x.name === 'rect').attrs.fill === CARBON) continue;
    n++; c += dotsOf(root).filter(x => x.attrs.fill === CARBON).length;
  }
  carbon.push([ed, n, c].join(','));
}
writeFileSync(new URL('../data/carbon.csv', import.meta.url), carbon.join('\n') + '\n');
console.log(area.join('\n'));
console.log(`carbon: first edition with none = ${carbon.slice(1).map(l => l.split(',')).find(r => r[2] === '0')?.[0]}`);
