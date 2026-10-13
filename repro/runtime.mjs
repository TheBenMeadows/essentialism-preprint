// Minimal stand-in for the bootloader SVG-JS runtime: the PRNG the platform
// seeds (splitmix64 -> sfc32) and a fake DOM that serializes to SVG text.
// Runs the generator exactly as stored on-chain (essentialism.chain.js).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const CODE = readFileSync(join(here, 'essentialism.chain.js'), 'utf8');

const M64 = 0xffffffffffffffffn;
export function splitmix64(seed) {
  let n = seed;
  return () => {
    let x = (n = (n + 0x9e3779b97f4a7c15n) & M64);
    x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64;
    x ^= x >> 31n;
    return Number(x & 0xffffffffn) >>> 0;
  };
}
export function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function El(name) {
  return {
    name, attrs: {}, children: [], text: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this.text = String(v); },
    get textContent() { return this.text; },
    ser() {
      const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      return `<${this.name}${a}>${this.children.map(c => c.ser()).join('')}${this.text ? esc(this.text) : ''}</${this.name}>`;
    },
  };
}
globalThis.document = { createElementNS: (_ns, n) => El(n) };

const GEN = new Function('BTLDR', CODE);

// Render one token. Returns the root element; root.ser() is the SVG text.
export function render(seed, edition, isPreview = false) {
  const sm = splitmix64(BigInt(seed));
  const root = El('svg');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  GEN({ rnd: sfc32(sm(), sm(), sm(), sm()), seed: BigInt(seed), iterationNumber: edition, isPreview, svg: root });
  return root;
}

// Counterfactual: the same program with only the photograph swapped. The
// source draw at line 66 still consumes its rnd() value, so every trait drawn
// before the dot loop comes out the same. Inside the loop, dot sizes, run
// lengths and the random draws follow the other photograph, and the ember
// (drawn after the loop) can differ. Used as the null in measure.mjs and
// extra.mjs. The chain file itself is never modified.
const SOURCE_LINE = "const source = rnd() < .13 ? 'natural gradient' : 'blue tree';";
if (!CODE.includes(SOURCE_LINE)) throw new Error('runtime: source line not found in chain code');
const GEN_SWAPPED = new Function('BTLDR', CODE.replace(SOURCE_LINE,
  "const source = rnd() < .13 ? 'blue tree' : 'natural gradient';"));
export function renderSwapped(seed, edition) {
  const sm = splitmix64(BigInt(seed));
  const root = El('svg');
  GEN_SWAPPED({ rnd: sfc32(sm(), sm(), sm(), sm()), seed: BigInt(seed), iterationNumber: edition, isPreview: false, svg: root });
  return root;
}

// The memory factor the generator applies at a given edition (line 69 of the chain code).
export const memory = ed => Math.max(0.12, 1 - 0.88 * (Math.min(Math.max(1, ed), 44) - 1) / 43);

// The two embedded grids, read out of the chain code itself.
export const grid = name => CODE.match(new RegExp(`const ${name} = '([0-9a-f]+)'`))[1];
