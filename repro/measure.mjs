// How much of the photograph can still be read out of a finished edition?
//
// For every (seed, edition) pair this renders the token, takes every dot the
// generator drew except the ember, and computes the Spearman rank correlation
// between each dot's ink darkness and the darkness of the embedded grid at the
// dot's centre (rho). When every dot has the same ink the rank correlation is
// undefined; such renders carry no rank information about the photograph and
// are scored 0, so every render counts and none is selected away.
//
// Null (rho_cf): the same seed and edition rendered with the OTHER photograph
// driving the field (runtime.renderSwapped), its dots correlated with the
// photograph the real token sampled. Placement, traits and quantisation are
// identical; only the photograph's influence is removed.
//
// Night-paper tokens invert the ink order on purpose (generator line 134), so
// their correlations are sign-flipped.
//
// Usage: node measure.mjs [nSeeds=1000]  -> ../data/renders.csv, ../data/curve.csv
import { writeFileSync, mkdirSync } from 'node:fs';
import { render, renderSwapped, memory, grid } from './runtime.mjs';

const N = Number(process.argv[2] || 1000);
const W = 750, H = 1000, GW = 28, GH = 38;
const EMBER = '#e0521b';
const GRIDS = { 'blue tree': grid('TREE'), 'natural gradient': grid('SKY') };

// Bilinear sample of a grid, identical to P() in the generator; returns darkness 0..1.
const dark = (g, x, y) => {
  const px = (i, j) => parseInt(g[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))], 16) / 15;
  const u = x / W * GW - .5, v = y / H * GH - .5;
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  return 1 - (px(i, j) * (1 - a) * (1 - b) + px(i + 1, j) * a * (1 - b) + px(i, j + 1) * (1 - a) * b + px(i + 1, j + 1) * a * b);
};
const inkDark = h => 1 - (parseInt(h.slice(1, 3), 16) * .299 + parseInt(h.slice(3, 5), 16) * .587 + parseInt(h.slice(5, 7), 16) * .114) / 255;

const ranks = a => {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let s = 0; s < idx.length;) {
    let e = s; while (e + 1 < idx.length && idx[e + 1][0] === idx[s][0]) e++;
    for (let k = s; k <= e; k++) r[idx[k][1]] = (s + e) / 2;
    s = e + 1;
  }
  return r;
};
const pearson = (x, y) => {
  const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
};
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const dotsOf = root => root.children.find(c => c.name === 'g').children.filter(c => c.attrs.fill !== EMBER);
const corr = (dots, g, sgn) => {
  const r = sgn * spearman(dots.map(c => inkDark(c.attrs.fill)), dots.map(c => dark(g, +c.attrs.cx, +c.attrs.cy)));
  return Number.isFinite(r) ? [r, true] : [0, false];
};

const seeds = Array.from({ length: N }, (_, i) => 1000003 + (i + 1) * 7919);
const rows = [];
for (const seed of seeds) {
  for (let ed = 1; ed <= 44; ed++) {
    const root = render(seed, ed);
    const desc = root.children.find(c => c.name === 'desc').text;
    const source = desc.match(/source: ([a-z ]+) ·/)[1];
    const night = desc.includes('· night');
    const sgn = night ? -1 : 1;
    const dots = dotsOf(root);
    const [rho, defined] = corr(dots, GRIDS[source], sgn);
    const [rhoCf, definedCf] = corr(dotsOf(renderSwapped(seed, ed)), GRIDS[source], sgn);
    rows.push({ seed, ed, f: memory(ed), source, density: desc.split(' · ')[1], nInks: Number(desc.match(/(\d) ink/)[1]),
      night, dots: dots.length, rho, defined, rhoCf, definedCf });
  }
}

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const out = p => new URL(`../data/${p}`, import.meta.url);
writeFileSync(out('renders.csv'), 'seed,ed,f,source,density,inks,night,dots,rho,defined,rho_cf,defined_cf\n' +
  rows.map(r => [r.seed, r.ed, r.f.toFixed(6), r.source, r.density, r.nInks, +r.night, r.dots, r.rho.toFixed(6), +r.defined, r.rhoCf.toFixed(6), +r.definedCf].join(',')).join('\n') + '\n');

const curve = ['ed,f,src,n,excluded,q25,med,q75,null_q25,null_med,null_q75,med_defined'];
for (const src of ['blue tree', 'natural gradient']) {
  for (let ed = 1; ed <= 44; ed++) {
    const sel = rows.filter(r => r.ed === ed && r.source === src);
    const a = sel.map(r => r.rho), b = sel.map(r => r.rhoCf), d = sel.filter(r => r.defined).map(r => r.rho);
    curve.push([ed, memory(ed).toFixed(6), src === 'blue tree' ? 'tree' : 'sky', sel.length, (1 - d.length / sel.length).toFixed(6),
      quant(a, .25).toFixed(6), quant(a, .5).toFixed(6), quant(a, .75).toFixed(6),
      quant(b, .25).toFixed(6), quant(b, .5).toFixed(6), quant(b, .75).toFixed(6), quant(d, .5).toFixed(6)].join(','));
  }
}
writeFileSync(out('curve.csv'), curve.join('\n') + '\n');

console.log(`seeds=${N} renders=${rows.length} undefined (single ink, scored 0)=${rows.filter(r => !r.defined).length}`);
for (const l of curve.filter((_, i) => i === 0 || /^(1|22|34|44),/.test(_))) console.log(l);
