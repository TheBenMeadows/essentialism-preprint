// Joins curve.csv (drawn dots) and field.csv (memory field) into one wide
// table for the pgfplots figure. Usage: node plotdata.mjs -> ../data/plot.csv
import { readFileSync, writeFileSync } from 'node:fs';
const read = f => { const [h, ...r] = readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8').trim().split('\n'); const k = h.split(','); return r.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const curve = read('curve.csv'), field = read('field.csv');
const at = (t, src, ed) => t.find(r => r.src === src && r.ed === String(ed));
const out = ['ed,f,tree_field,sky_field,tree_q25,tree_med,tree_q75,tree_null,sky_med,sky_null,tree_excluded'];
for (let ed = 1; ed <= 44; ed++) {
  const t = at(curve, 'tree', ed), s = at(curve, 'sky', ed);
  out.push([ed, t.f, at(field, 'tree', ed).med, at(field, 'sky', ed).med, t.q25, t.med, t.q75, t.null_med, s.med, s.null_med, t.excluded].join(','));
}
writeFileSync(new URL('../data/plot.csv', import.meta.url), out.join('\n') + '\n');
console.log(`plot.csv: ${out.length - 1} rows`);
