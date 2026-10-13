// Fetches the generator from the Tezos contract through the TzKT indexer and
// checks it against repro/essentialism.chain.js, the copy every other script
// runs. Also lists every recorded version of the generator, because the
// contract's update history keeps the superseded code (Section 5).
//
// Usage: node verify-chain.mjs   (network; exits 1 on any mismatch)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PIN = '33d85a12cf2a8404bccda1e31d6b3fd72c361673f995cc58b0857eabb6d5c248';
const KEY = 'https://api.tzkt.io/v1/bigmaps/771404/keys/407';
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
const decode = hex => decodeURIComponent(Buffer.from(hex, 'hex').toString('utf8')).replace(/\n+$/, '');
const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };

const local = readFileSync(new URL('./essentialism.chain.js', import.meta.url), 'utf8').replace(/\n+$/, '');
const { value } = await get(KEY);
const chain = decode(value.code);
console.log(`chain: generator v${value.version}, ${value.n_tokens} of ${value.sale.editions} minted, ${Buffer.from(value.code, 'hex').length} bytes stored, sha256 ${sha(chain)}`);
console.log(`local: sha256 ${sha(local)}`);

const updates = await get(`${KEY}/updates?limit=200`);
writeFileSync(new URL('../data/generator-history.csv', import.meta.url), 'timestamp,action,version,code_bytes,code_sha256_12,description_bytes,first_header_line\n' +
  updates.map(u => {
    const code = decode(u.value.code);
    const desc = u.value.description ? Buffer.from(u.value.description, 'hex').length : 0;
    return [u.timestamp, u.action, u.value.version, Buffer.byteLength(code), sha(code).slice(0, 12), desc, JSON.stringify(code.split('\n')[2])].join(',');
  }).join('\n') + '\n');
console.log(`history: ${updates.length} updates written to data/generator-history.csv`);

if (sha(chain) !== PIN || sha(local) !== PIN) { console.error('MISMATCH: chain, local copy and pin do not agree'); process.exit(1); }
console.log('OK: chain, local copy and pin agree');
