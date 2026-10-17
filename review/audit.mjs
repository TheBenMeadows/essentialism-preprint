// Deterministic audit: each number the paper states, rounded as printed, must
// equal the value in data/stats.txt, and the printed string must appear in
// main.tex. No model opinion; PASS or FAIL per claim.
// Usage (repo root): node review/audit.mjs
import { readFileSync } from 'node:fs';

const tex = readFileSync('main.tex', 'utf8').replace(/\s+/g, ' ');
const raw = Object.fromEntries(readFileSync('data/stats.txt', 'utf8').trim().split('\n').map(l => l.split(' = ')));
const st = Object.fromEntries(readFileSync('data/stats.txt', 'utf8').trim().split('\n').map(l => l.split(' = ')).map(([k, v]) => [k, +v]));
const census = readFileSync('data/census.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
let fails = 0;
// [stats key, transform, decimals, the text that must appear in main.tex]
const claims = [
  ['closed_max_abs_err_tree', x => x, 3, 'within 0.010 for one photograph'],
  ['closed_max_abs_err_tree_edition', x => x, 0, '(largest gap at edition 32)'],
  ['closed_max_abs_err_sky_edition', x => x, 0, "(largest gap 0.0204, at edition 38)"],
  ['closed_max_abs_err_sky', x => x, 4, "(largest gap 0.0204, at edition 38)"],
  ['field_loss_ed34_44_sky', x => x, 2, 'and loses 0.43 (tree) and 0.44 (sky) of it'],
  ['printed_cross_tree', x => x, 0, 'too low from edition 12, for both photographs'],
  ['printed_cross_sky', x => x, 0, 'too low from edition 12, for both photographs'],
  ['ed44_tree_n', x => x, 0, '62.5\\% of the 872 tree renders are positive'],
  ['ed44_tree_share_pos', x => 100 * x, 1, '62.5\\% of the 872 tree renders are positive'],
  ['ed44_tree_above_null', x => x, 0, 'and 629 exceed their own counterfactual null'],
  ['ed44_tree_z', x => x, 0, '($z = 13$ against an even split)'],
  ['p_ed44_gt_ed34_tree', x => 100 * x, 0, 'edition-34 render 26\\% of the time'],
  ['p_ed23_gt_ed22_tree', x => 100 * x, 0, '(edition 23 above edition 22: 48\\%)'],
  ['carbon_none_from_edition', x => x, 0, 'from edition 27 no carbon dot appears'],
  ['null_zero_from_edition_tree', x => x, 0, "From edition 37 the tree null's median is exactly 0"],
  ['area_med_ed1_tree', x => x, 2, '0.20 for the tree at edition 1 against 0.11 for its null'],
  ['area_null_ed1_tree', x => x, 2, '0.20 for the tree at edition 1 against 0.11 for its null'],
  ['area_med_ed44_tree', x => x, 2, 'and 0.14 against 0.13 at edition 44'],
  ['area_null_ed44_tree', x => x, 2, 'and 0.14 against 0.13 at edition 44'],
  ['area_single_max_above_null_sky', x => x, 3, 'at most 0.015 above it for sky tokens'],
  ['fstar_trajectories_sky', x => x, 0, "the sky's drawn-dot curves rest on 128 of them"],
  ['dots_med_ed1_tree', x => x, 2, '0.82 with the tree photograph at edition 1'],
  ['dots_med_ed44_tree', x => x, 2, '0.14 at edition 44'],
  ['null_med_max_tree', x => x, 3, 'ranges from 0.000 to 0.101 for tree tokens'],
  ['null_med_max_sky', x => x, 3, 'and to 0.104 for sky tokens'],
  ['null_med_max_sky', x => x, 3, 'medians between 0.00 and 0.104'],
  ['dots_med_ed10_tree', x => x, 2, 'median drawn correlation of 0.79 (tree) or 0.81 (sky)'],
  ['dots_med_ed10_sky', x => x, 2, 'median drawn correlation of 0.79 (tree) or 0.81 (sky)'],
  ['dots_med_ed10_tree', x => x, 2, 'is 0.79 for tree tokens and 0.81 for sky tokens'],
  ['dots_med_ed10_sky', x => x, 2, 'is 0.79 for tree tokens and 0.81 for sky tokens'],
  ['field_med_ed10_tree', x => x, 3, "the field's median correlation is 0.994 for tree tokens and 0.995 for sky tokens"],
  ['field_med_ed10_sky', x => x, 3, "the field's median correlation is 0.994 for tree tokens and 0.995 for sky tokens"],
  ['fstar_tree', x => x, 3, '$f^\\ast = 0.334$ for the tree'],
  ['fstar_sky', x => x, 3, 'and $0.327$ for the sky'],
  ['fstar_tree_edition', x => x, 1, 'edition 33.5 and 33.9'],
  ['fstar_sky_edition', x => x, 1, 'edition 33.5 and 33.9'],
  ['closed_ed34_tree', x => x, 2, 'gives 0.69 and 0.70'],
  ['closed_ed34_sky', x => x, 2, 'gives 0.69 and 0.70'],
  ['field_ed34_tree', x => x, 2, 'measured medians are 0.70 and 0.72'],
  ['field_ed34_sky', x => x, 2, 'measured medians are 0.70 and 0.72'],
  ['closed_ed44_tree', x => x, 2, 'it gives 0.26 and 0.27 against 0.27 and 0.28'],
  ['closed_ed44_sky', x => x, 2, 'it gives 0.26 and 0.27 against 0.27 and 0.28'],
  ['field_ed44_tree', x => x, 2, 'it gives 0.26 and 0.27 against 0.27 and 0.28'],
  ['field_ed44_sky', x => x, 2, 'it gives 0.26 and 0.27 against 0.27 and 0.28'],
  ['field_loss_ed1_22_tree', x => x, 2, 'falls by 0.06'],
  ['field_loss_ed34_44_tree', x => x, 2, 'it falls by 0.43, out of a total loss of 0.73'],
  ['field_loss_ed34_44_tree', x => x, 2, 'and loses 0.43 (tree)'],
  ['field_loss_total_tree', x => x, 2, 'total loss of 0.73'],
  ['dots_loss_ed1_22_tree', x => x, 2, 'a fall of 0.13 between editions 1 and 22'],
  ['dots_loss_ed34_44_tree', x => x, 2, 'and 0.30 between 34 and 44'],
  ['dots_med_ed1_sky', x => x, 2, 'median of 0.82 (tree) and 0.84 (sky)'],
  ['ed1_med_density_air', x => x, 2, '0.77 for air density'],
  ['ed1_med_density_field', x => x, 2, '0.84 for field'],
  ['ed1_med_density_full', x => x, 2, '0.87 for full'],
  ['ed1_med_inks_1', x => x, 2, '0.42 for one-ink tokens'],
  ['ed1_med_inks_4', x => x, 2, '0.87 for four-ink tokens'],
  ['ed1_med_night', x => x, 2, 'their median is 0.80'],
  ['ed1_med_all', x => x, 2, 'against 0.83 over all 1{,}000 seeds'],
  ['undefined_renders', x => x, 0, '3{,}291 renders (7.5\\%)'],
  ['undefined_share', x => 100 * x, 1, '3{,}291 renders (7.5\\%)'],
  ['excluded_ed1_tree', x => 100 * x, 1, 'rises from 1.0\\% at edition 1 to 13.3\\% at edition 42 (12.7\\% at edition 44)'],
  ['excluded_max_tree', x => 100 * x, 1, 'rises from 1.0\\% at edition 1 to 13.3\\% at edition 42 (12.7\\% at edition 44)'],
  ['excluded_max_tree_edition', x => x, 0, 'to 13.3\\% at edition 42'],
  ['excluded_ed44_tree', x => 100 * x, 1, '(12.7\\% at edition 44)'],
  ['dots_med_defined_ed44_tree', x => x, 2, 'from 0.14 to 0.19'],
  ['dots_n_tree', x => x, 0, '872 of each edition from tree tokens'],
  ['dots_n_sky', x => x, 0, '128 from sky tokens'],
];
for (const [k, fn, d, text] of claims) {
  if (!(k in st)) { fails++; console.log(`FAIL  ${k}: missing from stats.txt`); continue; }
  const v = fn(st[k]);
  const printed = d === null ? null : v.toFixed(d).replace(/^(\d)(\d{3})$/, '$1{,}$2');
  const inText = tex.includes(text);
  const numOk = d === null ? (k === 'field_min_ed1_22_tree' ? v >= .94 : true) : text.replace(/\\/g, '').replace(/\{,\}/g, '').includes(v.toFixed(d).replace(/\{,\}/g, ''));
  const ok = inText && numOk;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${k} = ${v.toFixed(4)}${printed ? ` (prints ${printed})` : ''}${inText ? '' : '  [text not found in main.tex]'}${numOk ? '' : '  [number differs]'}`);
}
// field >= 0.94 through 21 must hold for both photographs; 0.9385 at 22 is why it says 21
if (!(Math.ceil(st.closed_max_abs_err_sky * 1000) / 1000 <= 0.021 && tex.includes('0.021 for the other') && tex.includes("0.021 of the sky's"))) { fails++; console.log('FAIL  sky closed-form bound 0.021'); } else console.log('PASS  sky closed-form bound 0.021 in abstract and body');
if (!tex.includes('at least 0.94 with the photograph through edition 21')) { fails++; console.log('FAIL  abstract 0.94 sentence not found'); }
const f2 = k => st[k].toFixed(2);
const ordered = [
  `gives ${f2('closed_ed34_tree')} and ${f2('closed_ed34_sky')} and the measured medians are ${f2('field_ed34_tree')} and ${f2('field_ed34_sky')}`,
  `it gives ${f2('closed_ed44_tree')} and ${f2('closed_ed44_sky')} against ${f2('field_ed44_tree')} and ${f2('field_ed44_sky')}`,
  `edition ${st.fstar_tree_edition.toFixed(1)} and ${st.fstar_sky_edition.toFixed(1)}`,
  `median of ${f2('dots_med_ed1_tree')} (tree) and ${f2('dots_med_ed1_sky')} (sky)`,
  `${f2('dots_med_ed10_tree')} (tree) or ${f2('dots_med_ed10_sky')} (sky)`,
  `loses ${f2('field_loss_ed34_44_tree')} (tree) and ${f2('field_loss_ed34_44_sky')} (sky)`,
];
for (const o of ordered) { const ok = tex.includes(o); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ordered pair: ${o}`); }
const exc = raw.printed_exceptions_sky === '42' && raw.printed_exceptions_tree === 'none' && tex.includes('the one exception is the sky at edition 42');
if (!exc) fails++; console.log(`${exc ? 'PASS' : 'FAIL'}  printed-label exceptions: sky ${raw.printed_exceptions_sky}, tree ${raw.printed_exceptions_tree}`);
const below = st.area_single_below_null_all_tree === 1 && tex.includes("is below the null's median for tree tokens");
if (!below) fails++; console.log(`${below ? 'PASS' : 'FAIL'}  tree single-ink area medians below the null at all five editions`);
const field = readFileSync('data/field.csv', 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const min21 = Math.min(...field.filter(r => +r[0] <= 21).map(r => +r[4]));
console.log(`${min21 >= .94 ? 'PASS' : 'FAIL'}  field median >= 0.94 for editions 1 to 21, both photographs (min ${min21.toFixed(4)})`);
if (min21 < .94) fails++;
const maxz = Math.max(...census.map(r => Math.abs(+r[5])));
console.log(`${maxz <= 1.5 ? 'PASS' : 'FAIL'}  census within 1.5 SE (max |z| ${maxz.toFixed(2)})`);
if (maxz > 1.5) fails++;
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
