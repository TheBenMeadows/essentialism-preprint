// Provenance of every minted token: each version of its token_metadata record
// (TzKT bigmap 771410), the entropy the RNG contract set (bigmap 771409), the
// seed declared inside each stored artifact, and whether that artifact parses
// as a program. The artifact seed is the entropy with the bits of each byte
// reversed: the contract converts the 32 entropy bytes to a number by testing
// each byte's bits from 0x01 up to 0x80 and shifting them in, which reads the
// byte backwards (Section 5). regenerate_token skips that conversion and writes
// the entropy bytes themselves, which is not a number and not UTF-8.
//
// Usage: node provenance.mjs   (network) -> ../data/provenance.csv
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { render } from './runtime.mjs';

const C = 'KT1CB4MYiAViCuXWBU961x7LjQXGeA8SnQwt', GENERATOR = '407';
const META = 771410, EXTRA = 771409;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async url => {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
    if (r.ok) return r.json();
    if (i === 4) throw new Error(`${url}: HTTP ${r.status}`);
    await sleep(3000 * (i + 1));
  }
};
const bitrev = hex => [...Buffer.from(hex, 'hex')].map(b => parseInt(b.toString(2).padStart(8, '0').split('').reverse().join(''), 2).toString(16).padStart(2, '0')).join('');
const artifactBytes = ti => {
  if (!ti?.artifactUri) return Buffer.alloc(0);
  const uri = Buffer.from(ti.artifactUri, 'hex').toString('latin1');
  const body = uri.slice(uri.indexOf(',') + 1);
  // percent-decoding by hand keeps raw bytes raw; decodeURIComponent would throw on them
  return Buffer.from(body.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
};
const seedOf = raw => {
  const i = raw.indexOf('const SEED=');
  if (i < 0) return { format: 'none', seed: '' };
  const m = raw.subarray(i + 11, i + 11 + 90).toString('latin1').match(/^(\d+)n;/);
  if (m) return { format: m[1] === '0' ? 'zero' : 'decimal', seed: '0x' + BigInt(m[1]).toString(16).padStart(64, '0') };
  return { format: 'raw', seed: '0x' + raw.subarray(i + 11, i + 11 + 32).toString('hex') };
};
const isUtf8 = raw => { try { new TextDecoder('utf-8', { fatal: true }).decode(raw); return true; } catch { return false; } };
const renders = (format, seed, edition) => {
  if (format !== 'decimal') return { circles: 0, desc: '' };
  const root = render(BigInt(seed).toString(), edition);
  const count = n => (n.name === 'circle' ? 1 : 0) + (n.children || []).reduce((s, c) => s + count(c), 0);
  return { circles: count(root), desc: root.children.find(c => c.name === 'desc')?.text || '' };
};

const thumbs = {};
const tm = new URL('../data/thumb-match.csv', import.meta.url);
if (existsSync(tm)) for (const line of readFileSync(tm, 'utf8').trim().split('\n').slice(1)) { const [tid, i, , , corr] = line.split(','); thumbs[`${tid}:${i}`] = corr; }

const tokens = await get(`https://api.tzkt.io/v1/bigmaps/${EXTRA}/keys?value.generator_id=${GENERATOR}&select=key,value&limit=100`);
tokens.sort((a, b) => Number(a.value.iteration_number) - Number(b.value.iteration_number));
const rows = ['token_id,edition,version,level,timestamp,action,generator_version,entropy,artifact_seed_format,artifact_seed,artifact_is_bitrev_of_entropy,artifact_bytes,artifact_utf8,circles,trait_line,thumbnail_corr'];
let bitrevOk = 0, decimals = 0;
for (const t of tokens) {
  const tid = t.key, edition = Number(t.value.iteration_number);
  const meta = await get(`https://api.tzkt.io/v1/bigmaps/${META}/keys/${tid}/updates`);
  const extra = await get(`https://api.tzkt.io/v1/bigmaps/${EXTRA}/keys/${tid}/updates`);
  const entropyAt = level => [...extra].reverse().find(u => u.level <= level)?.value?.seed || '';
  meta.forEach((u, i) => {
    const raw = artifactBytes(u.value?.token_info);
    const { format, seed } = seedOf(raw);
    const entropy = entropyAt(u.level);
    const gv = extra.find(x => x.level === u.level)?.value?.generator_version || [...extra].reverse().find(x => x.level <= u.level)?.value?.generator_version || '';
    const isRev = format === 'decimal' && entropy && seed === '0x' + bitrev(entropy);
    if (format === 'decimal') { decimals++; if (isRev) bitrevOk++; }
    const r = renders(format, seed, edition);
    rows.push([tid, edition, i, u.level, u.timestamp, u.action, gv, entropy, format, seed, format === 'decimal' ? (isRev ? 'yes' : 'no') : '', raw.length, isUtf8(raw) ? 'yes' : 'no', r.circles, JSON.stringify(r.desc), thumbs[`${tid}:${i}`] ?? ''].join(','));
  });
  await sleep(300);
}
writeFileSync(new URL('../data/provenance.csv', import.meta.url), rows.join('\n') + '\n');
console.log(`${tokens.length} tokens, ${rows.length - 1} metadata versions; ${bitrevOk}/${decimals} decimal artifact seeds are the bit-reversed entropy`);
if (bitrevOk !== decimals) process.exit(1);
