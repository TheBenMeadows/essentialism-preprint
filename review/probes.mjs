// Checks behind the method choices in Section 4. Each section measures one
// question raised in review and prints the measured values.
// Usage (repo root): node review/probes.mjs [nSeeds=1000]
import { readFileSync } from 'node:fs';
import { render, memory, grid, CODE } from '../repro/runtime.mjs';

const N = Number(process.argv[2] || 1000);
const W = 750, H = 1000, GW = 28, GH = 38, EMBER = '#e0521b';
const read = f => { const [h, ...r] = readFileSync(f, 'utf8').trim().split('\n'); const k = h.split(','); return r.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = a => quant(a, .5);
const ranks = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let s = 0; s < idx.length;) { let e = s; while (e + 1 < idx.length && idx[e + 1][0] === idx[s][0]) e++; for (let k = s; k <= e; k++) r[idx[k][1]] = (s + e) / 2; s = e + 1; } return r; };
const pearson = (x, y) => { const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN; };
const spearman = (x, y) => pearson(ranks(x), ranks(y));
const GR = { 'blue tree': grid('TREE'), 'natural gradient': grid('SKY') };
const OTHER = { 'blue tree': 'natural gradient', 'natural gradient': 'blue tree' };
const dark = (g, x, y) => { const px = (i, j) => parseInt(g[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))], 16) / 15; const u = x / W * GW - .5, v = y / H * GH - .5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j; return 1 - (px(i, j) * (1 - a) * (1 - b) + px(i + 1, j) * a * (1 - b) + px(i, j + 1) * (1 - a) * b + px(i + 1, j + 1) * a * b); };
const inkDark = h => 1 - (parseInt(h.slice(1, 3), 16) * .299 + parseInt(h.slice(3, 5), 16) * .587 + parseInt(h.slice(5, 7), 16) * .114) / 255;
const seeds = Array.from({ length: N }, (_, i) => 1000003 + (i + 1) * 7919);

// --- P1: how far the closed form (Eq. 3) sits from the measured field curve, per photograph ---
{
  const field = read('data/field.csv');
  const sig = Object.fromEntries(readFileSync('data/sigma.txt', 'utf8').trim().split('\n').map(l => { const m = l.match(/^(sigma_\w+)( (TREE|SKY))?.*?= ([\d.]+)/); return [m[1] + (m[3] ? '_' + m[3] : ''), +m[4]]; }));
  const cf = (f, sp) => f * sp / Math.sqrt((f * sp) ** 2 + (.85 * (1 - f) * sig.sigma_n) ** 2);
  for (const [src, sp] of [['tree', sig.sigma_p_TREE], ['sky', sig.sigma_p_SKY]]) {
    let worst = [0, 0];
    for (const r of field.filter(r => r.src === src)) { const d = +r.med - cf(+r.f, sp); if (Math.abs(d) > Math.abs(worst[1])) worst = [+r.ed, d]; }
    console.log(`P1 closed form, ${src}: max |measured - Eq.3| = ${Math.abs(worst[1]).toFixed(4)} at edition ${worst[0]} (measured ${worst[1] > 0 ? 'above' : 'below'})`);
  }
}

// --- P2/P3: which renders have no defined rank correlation, and what scoring them 0 does ---
{
  const rows = read('data/renders.csv');
  const bad = rows.filter(r => r.defined === '0');
  console.log(`P2 undefined rho: ${bad.length}; zero-dot renders among them: ${bad.filter(r => +r.dots === 0).length}`);
  const byInk = {}; for (const r of bad) byInk[r.inks] = (byInk[r.inks] || 0) + 1;
  console.log(`P2 undefined by ink count: ${JSON.stringify(byInk)}`);
  for (const src of ['blue tree', 'natural gradient']) {
    const out = [];
    for (const ed of [1, 9, 22, 34, 44]) {
      const all = rows.filter(r => r.source === src && +r.ed === ed);
      const def = all.filter(r => r.defined === '1').map(r => +r.rho);
      out.push(`ed${ed}: undefined ${(100 * (all.length - def.length) / all.length).toFixed(1)}%, median ${med(def).toFixed(3)} if excluded vs ${med(all.map(r => +r.rho)).toFixed(3)} scored 0`);
    }
    console.log(`P3 ${src}: ${out.join('; ')}`);
  }
}

// --- P4: the dot hidden under the ember: does counting it change the result? ---
// --- P5: counterfactual null: same seed and edition, source forced to the other
//     photograph; correlate the resulting dots with the ORIGINAL photograph.
{
  const swapped = new Function('BTLDR', CODE.replace("const source = rnd() < .13 ? 'natural gradient' : 'blue tree';",
    "const _src = rnd() < .13 ? 'natural gradient' : 'blue tree'; const source = _src == 'blue tree' ? 'natural gradient' : 'blue tree';"));
  if (!/const _src/.test(swapped.toString())) throw new Error('P5 patch did not apply');
  const { splitmix64, sfc32 } = await import('../repro/runtime.mjs');
  const El = () => ({ name: 'svg', attrs: {}, children: [], text: '', setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; } });
  const renderSwapped = (seed, ed) => { const sm = splitmix64(BigInt(seed)); const root = El(); swapped({ rnd: sfc32(sm(), sm(), sm(), sm()), seed: BigInt(seed), iterationNumber: ed, isPreview: false, svg: root }); return root; };
  const res = { 1: { real: [], hid: [], cf: [], cfOther: [] }, 22: { real: [], hid: [], cf: [], cfOther: [] }, 44: { real: [], hid: [], cf: [], cfOther: [] } };
  for (const seed of seeds) for (const ed of [1, 22, 44]) {
    const root = render(seed, ed);
    const desc = root.children.find(c => c.name === 'desc').text;
    const src = desc.match(/source: ([a-z ]+) ·/)[1], sgn = desc.includes('· night') ? -1 : 1;
    const circles = root.children.find(c => c.name === 'g').children;
    const emb = circles.find(c => c.attrs.fill === EMBER);
    const dots = circles.filter(c => c.attrs.fill !== EMBER);
    const visible = emb ? dots.filter(c => !(c.attrs.cx === emb.attrs.cx && c.attrs.cy === emb.attrs.cy)) : dots;
    const rho = d => sgn * spearman(d.map(c => inkDark(c.attrs.fill)), d.map(c => dark(GR[src], +c.attrs.cx, +c.attrs.cy)));
    const a = rho(dots), b = rho(visible);
    if (Number.isFinite(a) && Number.isFinite(b)) { res[ed].real.push(a); res[ed].hid.push(b); }
    const cr = renderSwapped(seed, ed);
    const cdots = cr.children.find(c => c.name === 'g').children.filter(c => c.attrs.fill !== EMBER);
    const cink = cdots.map(c => inkDark(c.attrs.fill));
    const c1 = sgn * spearman(cink, cdots.map(c => dark(GR[src], +c.attrs.cx, +c.attrs.cy)));
    const c2 = sgn * spearman(cink, cdots.map(c => dark(GR[OTHER[src]], +c.attrs.cx, +c.attrs.cy)));
    if (Number.isFinite(c1)) res[ed].cf.push(c1);
    if (Number.isFinite(c2)) res[ed].cfOther.push(c2);
  }
  for (const ed of [1, 22, 44]) {
    const r = res[ed];
    console.log(`P4 ed${ed}: median rho all dots ${med(r.real).toFixed(4)} vs ember-hidden dot removed ${med(r.hid).toFixed(4)} (n=${r.real.length})`);
    console.log(`P5 ed${ed}: counterfactual null (other photo drives D, correlate with original) median ${med(r.cf).toFixed(4)} IQR ${quant(r.cf, .25).toFixed(3)}..${quant(r.cf, .75).toFixed(3)} n=${r.cf.length}; sanity: same render vs the photo that drove it ${med(r.cfOther).toFixed(4)}`);
  }
}
