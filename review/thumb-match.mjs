// Does the platform's own image of each token match the artifact stored on
// chain? For every metadata version listed in data/provenance.csv this renders
// the stored artifact in a headless browser at the artifact's 750x1000 size,
// fetches the platform thumbnail (400x400, letterboxed), and reports the Pearson
// correlation of gray levels over the thumbnail's picture area.
//
// Needs Playwright (not a build dependency):  npm i playwright@1.62.0  in some
// directory, then  NODE_PATH=<that>/node_modules node review/thumb-match.mjs
// Network. Writes data/thumb-match.csv; rerun repro/provenance.mjs afterwards
// so the correlation column is filled.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // CommonJS resolution honours NODE_PATH

const META = 771410;
const rows = readFileSync(new URL('../data/provenance.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
const get = async url => {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(40000) }); if (r.ok) return r; if (i === 4) throw new Error(`${url}: HTTP ${r.status}`); }
    catch (e) { if (i === 4) throw e; }
    await new Promise(res => setTimeout(res, 3000 * (i + 1)));
  }
};
const artifact = ti => {
  const uri = Buffer.from(ti.artifactUri, 'hex').toString('latin1');
  return Buffer.from(uri.slice(uri.indexOf(',') + 1).replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
};
const browser = await chromium.launch();
const out = ['token_id,version,generator_version,thumbnail_url,corr'];
for (const tid of [...new Set(rows.map(r => r[0]))]) {
  const versions = rows.filter(r => r[0] === tid);
  const gv = versions.at(-1)[6];
  const thumbUrl = `https://media.bootloader.art/thumbnail/${tid}?v=${gv}`;
  const thumb = Buffer.from(await (await get(thumbUrl)).arrayBuffer()).toString('base64');
  const updates = await (await get(`https://api.tzkt.io/v1/bigmaps/${META}/keys/${tid}/updates`)).json();
  for (const v of versions) {
    const i = Number(v[2]);
    if (v[8] !== 'decimal' && v[8] !== 'zero') { out.push([tid, i, gv, thumbUrl, ''].join(',')); continue; }
    const svg = artifact(updates[i].value.token_info).toString('latin1');
    const page = await browser.newPage({ viewport: { width: 750, height: 1000 } });
    await page.goto('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    await page.waitForTimeout(1500);
    const shot = (await page.screenshot({ type: 'png' })).toString('base64');
    await page.close();
    const judge = await browser.newPage();
    const corr = await judge.evaluate(async ([a, b]) => {
      const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + src; });
      const gray = (im, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; const g = new Float64Array(w * h); for (let i = 0; i < w * h; i++) g[i] = (d[4 * i] + d[4 * i + 1] + d[4 * i + 2]) / 3; return g; };
      const T = await load(a), R = await load(b);
      const tg = gray(T, T.width, T.height);
      // picture area of the letterboxed thumbnail: columns and rows whose mean is not black
      const colMean = x => { let s = 0; for (let y = 0; y < T.height; y++) s += tg[y * T.width + x]; return s / T.height; };
      const rowMean = y => { let s = 0; for (let x = 0; x < T.width; x++) s += tg[y * T.width + x]; return s / T.width; };
      let x0 = 0, x1 = T.width, y0 = 0, y1 = T.height;
      while (x0 < x1 && colMean(x0) <= 30) x0++; while (x1 > x0 && colMean(x1 - 1) <= 30) x1--;
      while (y0 < y1 && rowMean(y0) <= 30) y0++; while (y1 > y0 && rowMean(y1 - 1) <= 30) y1--;
      const w = x1 - x0, h = y1 - y0, rg = gray(R, w, h), ag = new Float64Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ag[y * w + x] = tg[(y + y0) * T.width + x + x0];
      const n = w * h, ma = ag.reduce((s, v) => s + v, 0) / n, mb = rg.reduce((s, v) => s + v, 0) / n;
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) { const da = ag[i] - ma, db = rg[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
      return sab / Math.sqrt(saa * sbb);
    }, [thumb, shot]);
    await judge.close();
    out.push([tid, i, gv, thumbUrl, corr.toFixed(4)].join(','));
    console.log(tid, `v${i}`, v[8], corr.toFixed(4));
  }
}
await browser.close();
writeFileSync(new URL('../data/thumb-match.csv', import.meta.url), out.join('\n') + '\n');
