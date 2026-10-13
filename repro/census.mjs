// Trait frequencies over many seeds at edition 1, against the weights written
// in the generator. Usage: node census.mjs [nSeeds=20000] -> ../data/census.csv
import { writeFileSync } from 'node:fs';
import { render } from './runtime.mjs';
const N = Number(process.argv[2] || 20000);
const SPEC = { density: { air: .50, field: .38, full: .12 }, inks: { 1: .04, 2: .56, 3: .30, 4: .10 },
  source: { 'blue tree': .87, 'natural gradient': .13 }, night: { true: .08, false: .92 }, ember: { true: .55, false: .45 } };
const count = {};
for (let i = 0; i < N; i++) {
  const d = render(1000003 + (i + 1) * 7919, 1).children.find(c => c.name === 'desc').text;
  const t = { density: d.split(' · ')[1], inks: d.match(/(\d) ink/)[1], source: d.match(/source: ([a-z ]+) ·/)[1], night: d.includes('· night'), ember: d.includes('· ember') };
  for (const k in t) { count[k] ??= {}; count[k][t[k]] = (count[k][t[k]] || 0) + 1; }
}
const rows = ['trait,value,spec,count,share,z'];
for (const k in SPEC) for (const v in SPEC[k]) {
  const p = SPEC[k][v], c = count[k][v] || 0, z = (c - N * p) / Math.sqrt(N * p * (1 - p));
  rows.push([k, v, p, c, (c / N).toFixed(4), z.toFixed(2)].join(','));
}
writeFileSync(new URL('../data/census.csv', import.meta.url), rows.join('\n') + '\n');
console.log(rows.join('\n'));
