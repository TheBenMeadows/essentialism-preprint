// Standard deviations of the photograph term and the noise term of D over the
// canvas, used for the closed-form curve in Section 4. Usage: node sigma.mjs [nSeeds=1000]
import { splitmix64, sfc32, grid } from './runtime.mjs';
const N = Number(process.argv[2] || 1000), W = 750, H = 1000, GW = 28, GH = 38;
const P = (g, x, y) => {
  const px = (i, j) => parseInt(g[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))], 16) / 15;
  const u = x / W * GW - .5, v = y / H * GH - .5, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
  return px(i, j) * (1 - a) * (1 - b) + px(i + 1, j) * a * (1 - b) + px(i, j + 1) * (1 - a) * b + px(i + 1, j + 1) * a * b;
};
const sd = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const med = a => { const s = [...a].sort((p, q) => p - q); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const L = []; for (let y = 5; y < H; y += 10) for (let x = 5; x < W; x += 10) L.push([x, y]);
for (const name of ['TREE', 'SKY']) console.log(`sigma_p ${name} = ${sd(L.map(([x, y]) => 1 - P(grid(name), x, y))).toFixed(4)}`);
const sn = [];
for (let s = 0; s < N; s++) {
  const sm = splitmix64(BigInt(1000003 + (s + 1) * 7919)), rnd = sfc32(sm(), sm(), sm(), sm());
  const G = Array.from({ length: 256 }, () => rnd()), q = t => t * t * (3 - 2 * t);
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), u = q(x - xi), v = q(y - yi), g = (i, j) => G[(j & 15) * 16 + (i & 15)];
    return g(xi, yi) * (1 - u) * (1 - v) + g(xi + 1, yi) * u * (1 - v) + g(xi, yi + 1) * (1 - u) * v + g(xi + 1, yi + 1) * u * v; };
  sn.push(sd(L.map(([x, y]) => vn(x / W * 3.1 + 5.2, y / H * 3.1) * .65 + vn((x / W * 3.1 + 5.2) * 2.7 + 11.3, (y / H * 3.1) * 2.7 + 7.1) * .35)));
}
console.log(`sigma_n median over ${N} seeds = ${med(sn).toFixed(4)}`);
