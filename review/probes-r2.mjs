// Round-2 probes. Usage (repo root): node review/r2/probes-r2.mjs [nSeeds=1000]
import { readFileSync } from 'node:fs';
import { render, renderSwapped, memory, grid, splitmix64, sfc32, CODE } from '../repro/runtime.mjs';

const N = Number(process.argv[2] || 1000);
const W = 750, H = 1000, GW = 28, GH = 38, EMBER = '#e0521b', CARBON = '#1c161c';
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = a => quant(a, .5);
const pearson = (x, y) => { const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; };
const GR = { 'blue tree': grid('TREE'), 'natural gradient': grid('SKY') };
const inkDark = h => 1 - (parseInt(h.slice(1, 3), 16) * .299 + parseInt(h.slice(3, 5), 16) * .587 + parseInt(h.slice(5, 7), 16) * .114) / 255;
const cellDark = g => [...g].map(c => 1 - parseInt(c, 16) / 15);
const seeds = Array.from({ length: N }, (_, i) => 1000003 + (i + 1) * 7919);

// --- P6: area-weighted ink per grid cell (all channels: ink, size, presence) ---
// v_cell = sum over dots centred in the cell of area * (inkDark(dot) - inkDark(paper)), Pearson with the grid.
const cellScore = (root, src, night) => {
  const paper = root.children.find(c => c.name === 'rect').attrs.fill;
  const pd = inkDark(paper), v = new Array(GW * GH).fill(0);
  for (const c of root.children.find(c => c.name === 'g').children) {
    if (c.attrs.fill === EMBER) continue;
    const i = Math.min(GW - 1, Math.floor(+c.attrs.cx / W * GW)), j = Math.min(GH - 1, Math.floor(+c.attrs.cy / H * GH));
    v[j * GW + i] += Math.PI * (+c.attrs.r) ** 2 * (inkDark(c.attrs.fill) - pd);
  }
  const r = pearson(v, cellDark(GR[src]));
  return (night ? -1 : 1) * (Number.isFinite(r) ? r : 0);
};
const p6 = {}, p6null = {}, p6single = [];
const renders = readFileSync('data/renders.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const undefinedSet = new Set(renders.filter(r => r[9] === '0').map(r => `${r[0]}:${r[1]}`));
for (const seed of seeds) for (const ed of [1, 9, 22, 34, 44]) {
  const root = render(seed, ed), desc = root.children.find(c => c.name === 'desc').text;
  const src = desc.match(/source: ([a-z ]+) ·/)[1], night = desc.includes('· night');
  const s = cellScore(root, src, night);
  (p6[`${src}:${ed}`] ??= []).push(s);
  (p6null[`${src}:${ed}`] ??= []).push(cellScore(renderSwapped(seed, ed), src, night));
  if (ed === 1 && undefinedSet.has(`${seed}:1`)) p6single.push(s);
}
for (const src of ['blue tree', 'natural gradient']) console.log(`P6 ${src}: ` + [1, 9, 22, 34, 44].map(e => `ed${e} area-weighted ${med(p6[`${src}:${e}`]).toFixed(3)} (null ${med(p6null[`${src}:${e}`]).toFixed(3)})`).join('; '));
console.log(`P6 single-ink renders at ed1 (ink score undefined, scored 0): n=${p6single.length}, area-weighted median ${p6single.length ? med(p6single).toFixed(3) : 'n/a'}`);

// --- P7: what produces the closed-form gap: per-seed covariance vs per-seed sigma_n ---
{
  const L = []; for (let y = 5; y < H; y += 10) for (let x = 5; x < W; x += 10) L.push([x, y]);
  const P = (g, x, y) => { const px = (i, j) => parseInt(g[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))], 16) / 15; const u = x / W * GW - .5, v = y / H * GH - .5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j; return px(i, j) * (1 - a) * (1 - b) + px(i + 1, j) * a * (1 - b) + px(i, j + 1) * (1 - a) * b + px(i + 1, j + 1) * a * b; };
  const sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const cov = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length; return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / a.length; };
  for (const [name, src] of [['TREE', 'tree'], ['SKY', 'sky']]) {
    const X = L.map(([x, y]) => 1 - P(grid(name), x, y)), sp = sd(X);
    const per = [];
    for (let s = 0; s < N; s++) {
      const sm = splitmix64(BigInt(1000003 + (s + 1) * 7919)), rnd = sfc32(sm(), sm(), sm(), sm());
      const G = Array.from({ length: 256 }, () => rnd()), q = t => t * t * (3 - 2 * t);
      const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), u = q(x - xi), v = q(y - yi), g = (i, j) => G[(j & 15) * 16 + (i & 15)]; return g(xi, yi) * (1 - u) * (1 - v) + g(xi + 1, yi) * u * (1 - v) + g(xi, yi + 1) * (1 - u) * v + g(xi + 1, yi + 1) * u * v; };
      const n = L.map(([x, y]) => { const a = x / W * 3.1 + 5.2, b = y / H * 3.1; return vn(a, b) * .65 + vn(a * 2.7 + 11.3, b * 2.7 + 7.1) * .35; });
      per.push({ sn: sd(n), C: cov(X, n) });
    }
    const exact = (f, sn, C) => { const a = f, b = .85 * (1 - f); return (a * sp * sp + b * C) / (sp * Math.sqrt(a * a * sp * sp + b * b * sn * sn + 2 * a * b * C)); };
    const msn = med(per.map(p => p.sn));
    let worstHet = 0, worstCov = 0;
    for (let e = 1; e <= 44; e++) {
      const f = memory(e);
      const closed = exact(f, msn, 0);
      const het = med(per.map(p => exact(f, p.sn, 0)));          // per-seed sigma_n, covariance suppressed
      const full = med(per.map(p => exact(f, p.sn, p.C)));       // per-seed sigma_n and covariance
      worstHet = Math.max(worstHet, Math.abs(het - closed)); worstCov = Math.max(worstCov, Math.abs(full - closed));
    }
    console.log(`P7 ${src}: median per-seed cov(n,1-P) = ${med(per.map(p => p.C)).toFixed(5)}; max |median with per-seed sigma_n only - Eq.3| = ${worstHet.toFixed(4)}; max |median with covariance - Eq.3| = ${worstCov.toFixed(4)}`);
  }
}

// --- P8: is the fade ordered token by token? P(random ed-a render > random ed-b render), tree ---
{
  const rows = renders.filter(r => r[3] === 'blue tree');
  const at = e => rows.filter(r => +r[1] === e).map(r => +r[8]);
  const mw = (a, b) => { let w = 0; for (const x of a) for (const y of b) w += x > y ? 1 : x === y ? .5 : 0; return w / (a.length * b.length); };
  console.log(`P8 tree: P(ed44 > ed34) = ${mw(at(44), at(34)).toFixed(3)}; P(ed44 > ed1) = ${mw(at(44), at(1)).toFixed(3)}; P(ed23 > ed22) = ${mw(at(23), at(22)).toFixed(3)}; P(ed10 > ed9) = ${mw(at(10), at(9)).toFixed(3)}`);
  const paired = renders.filter(r => +r[1] === 44);
  const k = paired.filter(r => +r[8] > +r[10]).length;
  console.log(`P8 paired ed44: ${k}/${paired.length} renders above their own null, z = ${((k - paired.length / 2) / Math.sqrt(paired.length / 4)).toFixed(1)}`);
}

// --- P9: does the swapped render keep every trait? ---
{
  let same = 0, n = 0;
  for (const seed of seeds.slice(0, 300)) for (const ed of [1, 44]) {
    const a = render(seed, ed).children.find(c => c.name === 'desc').text.replace(/source: [a-z ]+ ·/, '');
    const b = renderSwapped(seed, ed).children.find(c => c.name === 'desc').text.replace(/source: [a-z ]+ ·/, '');
    n++; if (a.replace(/ · ember/, '') === b.replace(/ · ember/, '')) same++;
  }
  console.log(`P9 traits other than source and ember identical in ${same}/${n} swapped renders (ember is drawn after the dot loop)`);
}

// --- P10: carbon unreachable late (max D = 0.85 + 0.15 f < 0.88 for f < 0.2) ---
{
  const out = [];
  for (const ed of [38, 40, 41, 44]) {
    let carb = 0;
    for (const seed of seeds) { const root = render(seed, ed); if (root.children.find(c => c.name === 'rect').attrs.fill === CARBON) continue; carb += root.children.find(c => c.name === 'g').children.filter(c => c.attrs.fill === CARBON).length; }
    out.push(`ed${ed} (f=${memory(ed).toFixed(3)}): ${carb} carbon dots`);
  }
  console.log(`P10 ${out.join('; ')}`);
}

// --- P11: trait-line memory vs measured medians: where does the label cross the measurement? ---
{
  const curve = readFileSync('data/curve.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(',')).filter(r => r[2] === 'tree');
  const cross = curve.find(r => +r[6] > +r[1]);
  console.log(`P11 tree: first edition where drawn median exceeds f: ${cross ? `ed${cross[0]} (f ${(+cross[1]).toFixed(3)}, median ${(+cross[6]).toFixed(3)})` : 'none'}; ed9 f ${memory(9).toFixed(3)} vs ${curve[8][6]}; ed12 f ${memory(12).toFixed(3)} vs ${curve[11][6]}`);
}
