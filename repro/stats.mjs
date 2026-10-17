// Every number the paper quotes in its text, computed from data/*.csv.
// Usage: node stats.mjs  -> ../data/stats.txt (also printed)
import { readFileSync, writeFileSync } from 'node:fs';

const at = p => new URL(`../data/${p}`, import.meta.url);
const read = f => { const [h, ...r] = readFileSync(at(f), 'utf8').trim().split('\n'); const k = h.split(','); return r.map(l => Object.fromEntries(l.split(',').map((v, i) => [k[i], v]))); };
const quant = (a, q) => { const s = [...a].sort((p, r) => p - r), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = a => quant(a, .5);
const curve = read('curve.csv'), field = read('field.csv'), renders = read('renders.csv');
const sig = Object.fromEntries(readFileSync(at('sigma.txt'), 'utf8').trim().split('\n').map(l => { const m = l.match(/^(sigma_\w+)( (TREE|SKY))?.*?= ([\d.]+)/); return [m[1] + (m[3] ? '_' + m[3] : ''), +m[4]]; }));
const C = (src, ed, k) => +curve.find(r => r.src === src && +r.ed === ed)[k];
const F = (src, ed) => +field.find(r => r.src === src && +r.ed === ed).med;
const memory = e => Math.max(.12, 1 - .88 * (Math.min(e, 44) - 1) / 43);
const closed = (f, sp) => f * sp / Math.sqrt((f * sp) ** 2 + (.85 * (1 - f) * sig.sigma_n) ** 2);
const SP = { tree: sig.sigma_p_TREE, sky: sig.sigma_p_SKY };
const eds = [...Array(44)].map((_, i) => i + 1);
const lines = [];
const put = (k, v) => lines.push(`${k} = ${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : v}`);

for (const s of ['tree', 'sky']) {
  put(`field_min_ed1_21_${s}`, Math.min(...eds.slice(0, 21).map(e => F(s, e))));
  let w = [0, 0]; for (const e of eds) { const d = F(s, e) - closed(memory(e), SP[s]); if (Math.abs(d) > Math.abs(w[1])) w = [e, d]; }
  put(`closed_max_abs_err_${s}`, Math.abs(w[1])); put(`closed_max_abs_err_${s}_edition`, w[0]);
  const fs = .85 * sig.sigma_n / (SP[s] + .85 * sig.sigma_n);
  put(`fstar_${s}`, fs); put(`fstar_${s}_edition`, 1 + 43 * (1 - fs) / .88);
  put(`closed_ed34_${s}`, closed(memory(34), SP[s])); put(`field_ed34_${s}`, F(s, 34));
  put(`closed_ed44_${s}`, closed(.12, SP[s])); put(`field_ed44_${s}`, F(s, 44));
  for (const e of [1, 9, 10, 22, 34, 44]) put(`dots_med_ed${e}_${s}`, C(s, e, 'med'));
  put(`field_med_ed10_${s}`, F(s, 10));
  put(`dots_n_${s}`, C(s, 1, 'n'));
  const ex = eds.map(e => C(s, e, 'excluded'));
  put(`excluded_ed1_${s}`, C(s, 1, 'excluded')); put(`excluded_ed44_${s}`, C(s, 44, 'excluded')); put(`excluded_max_${s}`, Math.max(...ex));
  const nm = eds.map(e => C(s, e, 'null_med'));
  put(`null_med_min_${s}`, Math.min(...nm)); put(`null_med_max_${s}`, Math.max(...nm));
  put(`dots_med_defined_ed44_${s}`, C(s, 44, 'med_defined'));
}
put('field_loss_ed1_22_tree', F('tree', 1) - F('tree', 22));
put('field_loss_ed34_44_tree', F('tree', 34) - F('tree', 44));
put('field_loss_total_tree', F('tree', 1) - F('tree', 44));
put('dots_loss_ed1_22_tree', C('tree', 1, 'med') - C('tree', 22, 'med'));
put('dots_loss_ed34_44_tree', C('tree', 34, 'med') - C('tree', 44, 'med'));
put('dots_loss_total_tree', C('tree', 1, 'med') - C('tree', 44, 'med'));

const ed1 = renders.filter(r => r.ed === '1');
for (const v of ['air', 'field', 'full']) put(`ed1_med_density_${v}`, med(ed1.filter(r => r.density === v).map(r => +r.rho)));
for (const v of ['1', '2', '3', '4']) put(`ed1_med_inks_${v}`, med(ed1.filter(r => r.inks === v).map(r => +r.rho)));
put('ed1_med_night', med(ed1.filter(r => r.night === '1').map(r => +r.rho)));
put('ed1_med_all', med(ed1.map(r => +r.rho)));
const ed44 = renders.filter(r => r.ed === '44');
put('ed44_share_rho_pos', ed44.filter(r => +r.rho > 0).length / ed44.length);
put('ed44_share_rho_gt_null', ed44.filter(r => +r.rho > +r.rho_cf).length / ed44.length);
put('undefined_renders', renders.filter(r => r.defined === '0').length);
put('undefined_share', renders.filter(r => r.defined === '0').length / renders.length);
put('renders', renders.length);

// ordering: probability a random render at edition a scores above one at edition b (tree)
const treeAt = e => renders.filter(r => r.source === 'blue tree' && +r.ed === e).map(r => +r.rho);
const mw = (x, y) => { let w = 0; for (const u of x) for (const v of y) w += u > v ? 1 : u === v ? .5 : 0; return w / (x.length * y.length); };
put('p_ed44_gt_ed34_tree', mw(treeAt(44), treeAt(34)));
put('p_ed23_gt_ed22_tree', mw(treeAt(23), treeAt(22)));
const k44 = ed44.filter(r => +r.rho > +r.rho_cf).length;
put('ed44_pairs_above_null', k44);
put('ed44_pairs_z', (k44 - ed44.length / 2) / Math.sqrt(ed44.length / 4));
put('null_zero_from_edition_tree', eds.find(e => eds.filter(x => x >= e).every(x => C('tree', x, 'null_med') === 0)));
// the trait line's memory against the drawn median (tree)
put('label_cross_edition_tree', eds.find(e => C('tree', e, 'med') > memory(e)));
put('label_cross_edition_sky', eds.find(e => C('sky', e, 'med') > memory(e)));
put('label_gap_ed12_tree', memory(12) - C('tree', 12, 'med'));
put('field_loss_ed34_44_sky', F('sky', 34) - F('sky', 44));
put('dots_med_ed12_tree', C('tree', 12, 'med'));
// area-weighted measure and carbon
const area = read('area.csv'), carbon = read('carbon.csv');
const A = (src, ed, k) => +area.find(r => r.src === src && +r.ed === ed)[k];
for (const s of ['tree', 'sky']) for (const e of [1, 44]) { put(`area_med_ed${e}_${s}`, A(s, e, 'med')); put(`area_null_ed${e}_${s}`, A(s, e, 'null_med')); }
const single = area.filter(r => r.single_ink_med !== 'NA' && +r.single_ink_n >= 5).map(r => +r.single_ink_med);
put('area_single_ink_min', Math.min(...single)); put('area_single_ink_max', Math.max(...single));
put('carbon_none_from_edition', +carbon.find(r => r.carbon_dots === '0').ed);
put('fstar_trajectories_sky', C('sky', 1, 'n'));

// the label as printed (f rounded to a whole percent) against the drawn medians
const printed = e => Math.round(memory(e) * 100) / 100;
for (const s of ['tree', 'sky']) {
  put(`printed_cross_${s}`, eds.find(e => C(s, e, 'med') > printed(e)));
  const ex = eds.filter(e => e >= 12 && C(s, e, 'med') <= printed(e));
  put(`printed_exceptions_${s}`, ex.length ? ex.join(' ') : 'none');
}
// edition 44, tree tokens only
const t44 = ed44.filter(r => r.source === 'blue tree');
const kt = t44.filter(r => +r.rho > +r.rho_cf).length;
put('ed44_tree_n', t44.length);
put('ed44_tree_share_pos', t44.filter(r => +r.rho > 0).length / t44.length);
put('ed44_tree_above_null', kt);
put('ed44_tree_z', (kt - t44.length / 2) / Math.sqrt(t44.length / 4));
put('excluded_max_tree_edition', eds.reduce((a, e) => C('tree', e, 'excluded') > C('tree', a, 'excluded') ? e : a, 1));
// single-ink renders on the area measure, against the null, at the five editions measured
const gap = r => +r.single_ink_med - +r.null_med;
put('area_single_below_null_all_tree', area.filter(r => r.src === 'tree' && +r.single_ink_n >= 5).every(r => gap(r) < 0) ? 1 : 0);
put('area_single_max_above_null_sky', Math.max(...area.filter(r => r.src === 'sky' && +r.single_ink_n >= 5).map(gap)));

writeFileSync(at('stats.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
