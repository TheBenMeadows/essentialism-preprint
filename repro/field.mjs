// The memory field D(x, y) before any dot is drawn.
//
// The generator's value-noise lattice G is the first 256 draws of the token's
// PRNG (chain code line 35), so D can be rebuilt outside the generator for any
// seed. This samples D on a 75x100 lattice and reports its Pearson correlation
// with the photograph's darkness, per edition. It is the ceiling on what any
// drawing of D could carry; measure.mjs reports what the drawing does carry.
//
// Usage: node field.mjs [nSeeds=1000]  -> ../data/field.csv, ../data/grids.csv
import { writeFileSync } from 'node:fs';
import { splitmix64, sfc32, memory, grid } from './runtime.mjs';

const N = Number(process.argv[2] || 1000);
const W = 750, H = 1000, GW = 28, GH = 38;
const TREE = grid('TREE'), SKY = grid('SKY');

const P = (g, x, y) => {
  const px = (i, j) => parseInt(g[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))], 16) / 15;
  const u = x / W * GW - .5, v = y / H * GH - .5;
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  return px(i, j) * (1 - a) * (1 - b) + px(i + 1, j) * a * (1 - b) + px(i, j + 1) * (1 - a) * b + px(i + 1, j + 1) * a * b;
};
const pearson = (x, y) => {
  const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

const lattice = [];
for (let y = 5; y < H; y += 10) for (let x = 5; x < W; x += 10) lattice.push([x, y]);
const photo = { tree: lattice.map(([x, y]) => 1 - P(TREE, x, y)), sky: lattice.map(([x, y]) => 1 - P(SKY, x, y)) };

const rhos = {};
for (let s = 0; s < N; s++) {
  const sm = splitmix64(BigInt(1000003 + (s + 1) * 7919));
  const rnd = sfc32(sm(), sm(), sm(), sm());
  const G = Array.from({ length: 256 }, () => rnd());
  const smooth = t => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const g = (i, j) => G[(j & 15) * 16 + (i & 15)];
    return g(xi, yi) * (1 - u) * (1 - v) + g(xi + 1, yi) * u * (1 - v) + g(xi, yi + 1) * (1 - u) * v + g(xi + 1, yi + 1) * u * v;
  };
  const fbm = (x, y) => vn(x, y) * .65 + vn(x * 2.7 + 11.3, y * 2.7 + 7.1) * .35;
  const noise = lattice.map(([x, y]) => fbm(x / W * 3.1 + 5.2, y / H * 3.1));
  for (const src of ['tree', 'sky']) {
    for (let ed = 1; ed <= 44; ed++) {
      const f = memory(ed);
      const D = photo[src].map((p, k) => p * f + noise[k] * (1 - f) * .85);
      ((rhos[src] ??= {})[ed] ??= []).push(pearson(D, photo[src]));
    }
  }
}

const rows = ['ed,f,src,q05,med,q95'];
for (const src of ['tree', 'sky']) for (let ed = 1; ed <= 44; ed++) {
  const a = rhos[src][ed];
  rows.push([ed, memory(ed).toFixed(6), src, quant(a, .05).toFixed(6), quant(a, .5).toFixed(6), quant(a, .95).toFixed(6)].join(','));
}
writeFileSync(new URL('../data/field.csv', import.meta.url), rows.join('\n') + '\n');

// Both grids as tables, for the figure, plus their correlation with each other.
const cells = g => [...g].map(c => parseInt(c, 16));
const gr = ['i,j,tree,sky'];
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) gr.push([i, j, cells(TREE)[j * GW + i], cells(SKY)[j * GW + i]].join(','));
writeFileSync(new URL('../data/grids.csv', import.meta.url), gr.join('\n') + '\n');
console.log(`grid-grid pearson (cells) = ${pearson(cells(TREE), cells(SKY)).toFixed(4)}`);
for (const l of rows.filter(r => /^(1|11|22|33|44),/.test(r))) console.log(l);
