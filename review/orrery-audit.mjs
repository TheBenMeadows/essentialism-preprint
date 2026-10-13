// Pre-publication audit of every machine-checkable fact in main.tex that is
// not a measurement: chain history, byte counts, costs, cited code lines,
// constants quoted from the generator, trait weights, citation keys, and a
// clean-clone rebuild against data/SHA256SUMS. PASS or FAIL per check.
// Measurements are checked by review/audit.mjs.
// Usage (repo root): node review/orrery-audit.mjs [--rebuild]
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tex = readFileSync('main.tex', 'utf8').replace(/\s+/g, ' ');
const code = readFileSync('repro/essentialism.chain.js', 'utf8');
const lines = code.split('\n');
const L = n => lines[n - 1];
const key = JSON.parse(readFileSync('data/bigmap-407.json', 'utf8')).value;
const hist = JSON.parse(readFileSync('data/bigmap-407-updates.json', 'utf8'));
const decode = hex => decodeURIComponent(Buffer.from(hex, 'hex').toString('utf8')).replace(/\n+$/, '');
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const has = s => tex.includes(s);

// chain facts
const sha = createHash('sha256').update(code.replace(/\n+$/, ''), 'utf8').digest('hex');
check('generator digest in text matches the copy', has(sha), sha.slice(0, 12));
check('version 6 on chain', key.version === '6' && has('generator version 6'));
check('44 editions at 8 tez', key.sale.editions === '44' && key.sale.price === '8000000' && has('The edition is 44 tokens at 8 tez'));
check('nine minted', key.n_tokens === '9' && has('Nine of the 44 editions are minted'));
check('stored bytes 15,560', Buffer.from(key.code, 'hex').length === 15560 && has('15{,}560 bytes'));
check('code bytes 10,098', Buffer.byteLength(code.replace(/\n+$/, '')) === 10098 && has('10{,}098 bytes'));
check('16 writes', hist.length === 16 && has('written 16 times'), `${hist.length}`);
const versions = hist.filter((u, i) => i === 0 || u.value.version !== hist[i - 1].value.version).length;
const sales = hist.filter((u, i) => i > 0 && JSON.stringify(u.value.sale) !== JSON.stringify(hist[i - 1].value.sale)).length;
const mints = hist.filter((u, i) => i > 0 && u.value.n_tokens !== hist[i - 1].value.n_tokens).length;
check('write breakdown 1 create + 5 versions + 1 sale + 9 mints', versions === 6 && sales === 1 && mints === 9 && has('once to create it, five times to publish versions 2 to 6, once to open the sale, and nine times to record a mint'), `${versions} version states, ${sales} sale, ${mints} mints`);
const v1 = hist[0], firstMint = hist.find(u => u.value.n_tokens === '1'), v4 = hist.find(u => u.value.version === '4');
check('version 1 at 22:10:28 UTC 31 July', v1.timestamp === '2026-07-31T22:10:28Z' && has('published at 22:10:28 UTC on 31 July'));
const mins = (new Date(firstMint.timestamp) - new Date(v1.timestamp)) / 60000;
check('edition 1 minted four minutes after version 1', mins === 4 && firstMint.value.version === '1' && has('four minutes later'), `${mins} min, under v${firstMint.value.version}`);
check('version 4 at 03:03 UTC 1 August', v4.timestamp.startsWith('2026-08-01T03:03') && has('Version 4 (03:03 UTC, 1 August)'));
check('version 1 header claimed the sketch', decode(v1.value.code).split('\n')[2].includes('in november 2022 i wrote a p5.js sketch called "365 days of tbm"') && has("in november 2022 i wrote a p5.js sketch called `365 days of tbm'"));
check('current header credits Haskell', [L(3), L(4), L(5)].join(' ').includes("working through andy haskell's tutorial"));
check('published 31 July 2026', key.created === '2026-07-31T22:10:28Z' && has('published on 31 July 2026'));

// grids and costs
const tree = code.match(/const TREE = '([0-9a-f]+)'/)[1], sky = code.match(/const SKY = '([0-9a-f]+)'/)[1];
check('grids are 1,064 cells each', tree.length === 1064 && sky.length === 1064 && has('1{,}064 bytes per photograph'));
check('storage cost of grids 0.532 tez', 2128 * 250 / 1e6 === 0.532 && has('$2{,}128 \\times 250$ mutez $= 0.532$ tez'));
check('information at most 532 bytes', 1064 * 4 / 8 === 532 && has('at most 532 bytes of information'));

// cited lines say what the paper says they say
check('lines 25 and 26 are the grid literals', L(25).startsWith('const TREE =') && L(26).startsWith('const SKY ='));
check('lines 35 to 42 are the noise lattice and fbm', L(35).includes('Array.from({ length: 256 }, () => rnd())') && L(42).startsWith('const fbm'));
check('line 69 is the memory factor', L(69).includes('1 - .88 * (Math.min(it, 44) - 1) / 43') && L(69).includes('Math.max(.12'));
check('line 129 is run persistence 0.58 within 0.3', L(129).includes('Math.abs(d - prevD) < .3 && rnd() < .58'));
check('line 153 writes the trait line to desc', L(153).startsWith("put('desc'"));
check('line 77 is the field D with 0.85', L(77).includes('(1 - P(x, y)) * f + fbm(x / W * 3.1 + 5.2, y / H * 3.1) * (1 - f) * .85'));
check('line 66 is the source draw at .13', L(66).includes("rnd() < .13 ? 'natural gradient' : 'blue tree'"));

// constants quoted in the text
check('radius formula', code.includes('dotRadius * (.72 + .56 * fbm(c * .37, t * 3.1)) * (.8 + .5 * sc)') && has('r_0\\,(0.72 + 0.56\\,n\')(0.8 + 0.5\\,D)'));
check('column width 3 r0', code.includes('const columnWidth = dotRadius * 3') && has('columns of width $3r_0$'));
check('bone below 0.1, carbon above 0.88', code.includes('d < .1 && q < .7 ? BONE') && code.includes('d > .88 && q < .8') && has('below $D = 0.1$') && has('above $0.88$'));
check('displacement at most 3 px (scale 6)', code.includes("scale: 6") && has('at most 3 pixels'));
check('ember probability 0.55', code.includes('rnd() < .55') && has('55\\%'));
check('ember colour', code.includes("EMBER = '#e0521b'") && has('\\#e0521b'));
check('inks listed from the palette', ['#dd68a4', '#85dad9', '#6a93c9', '#36597d', '#87c2e4'].every(c => code.includes(c)));
const weights = [['[[2, 56], [3, 30], [4, 10], [1, 4]]', '4 / 56 / 30 / 10\\%'], ["[['air', 50], ['field', 38], ['full', 12]]", '50 / 38 / 12\\%'], ['[CARBON, 8]', '8\\%']];
for (const [c, t] of weights) check(`trait weights ${t}`, code.includes(c) && has(t));
check('paper weights 28/22/20/12/10', code.includes("['#f6ecf2', 28], ['#f0c9d3', 20], ['#f3e7d4', 22], ['#f2f0f6', 12], ['#8cadd7', 10]") && has('28/22/20/12/10\\%'));
check('platform PRNG construction quoted', has('splitmix64 into sfc32'));
check('seed 1391882777 is edition 1 entropy mod 2^32', (BigInt('0xe9fa8515caf823a1a45b19ef4d8b6c720c47246bb90b74a387350a3952f67219') % (1n << 32n)) === 1391882777n && has('1391882777, edition 1\'s stored entropy reduced modulo $2^{32}$'));
check('memory at editions 15/30/44 in Figure 1', [15, 30, 44].every((e, i) => Math.round(100 * Math.max(.12, 1 - .88 * (e - 1) / 43)) === [71, 41, 12][i]) && has('memory 71\\%') && has('memory 41\\%') && has('memory 12\\%'));

// citations
const bib = readFileSync('refs.bib', 'utf8');
const keys = new Set([...bib.matchAll(/@\w+\{([^,]+),/g)].map(m => m[1]));
const cited = [...readFileSync('main.tex', 'utf8').matchAll(/\\cite[pt]?\{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(s => s.trim()));
const missing = cited.filter(k => !keys.has(k));
check('every cited key exists in refs.bib', missing.length === 0, missing.join(' ') || `${new Set(cited).size} keys`);
const labels = new Set([...readFileSync('main.tex', 'utf8').matchAll(/\\label\{([^}]+)\}/g)].map(m => m[1]));
const refs = [...readFileSync('main.tex', 'utf8').matchAll(/\\(?:eq)?ref\{([^}]+)\}/g)].map(m => m[1]).filter(r => !labels.has(r));
check('every \\ref has a label', refs.length === 0, refs.join(' '));

// clean-clone rebuild
if (process.argv.includes('--rebuild')) {
  const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim();
  if (dirty) { console.log('FAIL  --rebuild needs a clean, committed tree (git status is not empty)'); process.exit(1); }
  const dir = mkdtempSync(join(tmpdir(), 'ess-audit-'));
  try {
    execFileSync('git', ['clone', '-q', '.', dir]);
    execFileSync('make', ['data'], { cwd: dir, stdio: 'ignore' });
    const a = readFileSync('data/SHA256SUMS', 'utf8'), b = readFileSync(join(dir, 'data/SHA256SUMS'), 'utf8');
    check('clean clone: make data reproduces data/SHA256SUMS', a === b);
    execFileSync('node', ['repro/figures.mjs'], { cwd: dir, stdio: 'ignore' });
    const svgs = readdirSync('figures').filter(f => f.endsWith('.svg'));
    check('clean clone: Figure 1 SVGs regenerate byte-identical', svgs.length === 4 && svgs.every(f => readFileSync(join('figures', f)).equals(readFileSync(join(dir, 'figures', f)))), `${svgs.length} files`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
