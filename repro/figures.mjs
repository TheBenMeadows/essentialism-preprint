// Renders the decay strip used in Figure 1: one seed at editions 1, 15, 30, 44.
// The default is edition 1's own seed, the one its mint-time artifact declares
// (data/provenance.csv, token 5364, block 14305273).
// Usage: node figures.mjs [seed]  -> ../figures/strip-edNN.svg
import { writeFileSync } from 'node:fs';
import { render } from './runtime.mjs';
const seed = process.argv[2] || '68468206326414033182208490206218027875160410067690517625730587478246395170456';
for (const ed of [1, 15, 30, 44]) {
  const root = render(seed, ed);
  const f = `strip-ed${String(ed).padStart(2, '0')}.svg`;
  writeFileSync(new URL(`../figures/${f}`, import.meta.url), root.ser());
  console.log(f, '|', root.children.find(c => c.name === 'desc').text);
}
