// Table 2 rows, rounded once from full-precision data. f is computed from
// Eq. 2, not read back from a rounded column.
// Usage: node tables.mjs -> ../data/table2.tex
import { readFileSync, writeFileSync } from 'node:fs';
import { memory } from './runtime.mjs';
const read = f => { const [h, ...r] = readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8').trim().split('\n'); const k = h.split(','); return r.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const curve = read('curve.csv'), field = read('field.csv');
const at = (t, src, ed) => t.find(r => r.src === src && +r.ed === ed);
const n = x => { const s = (+x).toFixed(3); return s.startsWith('-') ? `$-$${s.slice(1)}` : s; };
const rows = [1, 9, 15, 22, 30, 34, 44].map(e => {
  const t = at(curve, 'tree', e), s = at(curve, 'sky', e);
  return `    ${e} & ${memory(e).toFixed(3)} & ${n(at(field, 'tree', e).med)} & ${n(t.med)} & (${n(t.q25)}, ${n(t.q75)}) & ${(100 * t.excluded).toFixed(1)} & ${n(s.med)} & ${n(t.null_med)} \\\\`;
});
writeFileSync(new URL('../data/table2.tex', import.meta.url), rows.join('\n') + '\n');
console.log(rows.join('\n'));
