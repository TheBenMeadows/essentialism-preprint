// Renders the decay strip used in Figure 1: one seed at editions 1, 15, 30, 44.
// Usage: node figures.mjs [seed=1391882777]  -> ../figures/strip-edNN.svg
import { writeFileSync } from 'node:fs';
import { render } from './runtime.mjs';
const seed = process.argv[2] || '1391882777';
for (const ed of [1, 15, 30, 44]) {
  const root = render(seed, ed);
  const f = `strip-ed${String(ed).padStart(2, '0')}.svg`;
  writeFileSync(new URL(`../figures/${f}`, import.meta.url), root.ser());
  console.log(f, '|', root.children.find(c => c.name === 'desc').text);
}
