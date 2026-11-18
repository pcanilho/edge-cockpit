// Pixel-compares the console between two builds of the UI, so a change can't quietly alter
// the curated pages. Renders every page at 2560 x 720 and every phone view (portrait and
// landscape) from both, with the clock frozen, and fails on any differing pixel.
//   node test/regress.mjs <base ui dir> <head ui dir> [--out dir]
// Set LOOK_CHANGE=1 to report differences without failing (a PR that means to change the look).
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const [baseDir, headDir] = process.argv.slice(2, 4).map(d => resolve(d));
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (!baseDir || !headDir) { console.error('usage: node test/regress.mjs <base ui dir> <head ui dir> [--out dir]'); process.exit(2); }
const lenient = process.env.LOOK_CHANGE === '1';
// Anti-aliasing of the same frame can wobble by a few levels between renders; a real change moves far more.
const TOLERANCE = 40;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'text/xml', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const serve = dir => new Promise(ok => {
  const s = createServer(async (req, res) => {
    const path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    try { res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path)); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0, () => ok(s));
});
const servers = await Promise.all([serve(baseDir), serve(headDir)]);
const url = s => `http://localhost:${s.address().port}/index.html`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const FIXED = new Date('2026-01-15T12:00:00Z');

// The same fixed state for both builds: frozen clock, no network, no saved settings.
async function open(server, viewport, query, phone = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', ...(phone ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await page.goto(url(server) + query);
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const settle = async page => {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

// Shots from one build: { name: png buffer }.
async function shoot(server) {
  const shots = {};
  const { ctx, page } = await open(server, { width: 2560, height: 720 }, '?demo=ship');
  const ids = (await page.evaluate(() => window.xfd.pages())).filter(id => id !== 'left'); // left: the Stream Deck's side deck, not a console page
  for (const id of ids) {
    await page.evaluate(id => window.xfd.show(id), id);
    await settle(page);
    shots[`edge-${id}`] = await page.screenshot();
  }
  await ctx.close();
  for (const [w, h, tag] of [[393, 852, 'portrait'], [852, 393, 'landscape']]) {
    const { ctx, page } = await open(server, { width: w, height: h }, '?phone&demo=ship', true);
    for (const id of ids) {
      await page.evaluate(id => window.xfd.show(id), id);
      const n = await page.evaluate(() => document.querySelectorAll('#ph-rail button').length);
      for (let k = 0; k < Math.max(n, 1); k++) {
        if (n) await page.evaluate(k => document.querySelectorAll('#ph-rail button')[k].click(), k);
        await settle(page);
        shots[`phone-${tag}-${id}-${k}`] = await page.screenshot();
      }
    }
    await ctx.close();
  }
  return { ids, shots };
}

const a = await shoot(servers[0]);
const b = await shoot(servers[1]);

// Compare in the browser: decode both PNGs and count differing pixels.
const cmp = await (await browser.newContext()).newPage();
const diffs = [];
const missing = Object.keys(a.shots).filter(k => !b.shots[k]);
for (const [name, png] of Object.entries(a.shots)) {
  if (!b.shots[name]) continue;
  if (png.equals(b.shots[name])) continue;
  const r = await cmp.evaluate(async ([x, y, TOL]) => {
    const load = async b64 => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const [i, j] = await Promise.all([load(x), load(y)]);
    if (i.width !== j.width || i.height !== j.height) return { px: -1 };
    const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(i, 0, 0); const p = g.getImageData(0, 0, i.width, i.height).data;
    g.clearRect(0, 0, i.width, i.height); g.drawImage(j, 0, 0); const q = g.getImageData(0, 0, i.width, i.height).data;
    let px = 0; const box = [1e9, 1e9, -1, -1];
    for (let k = 0; k < p.length; k += 4) {
      if (Math.abs(p[k] - q[k]) > TOL || Math.abs(p[k + 1] - q[k + 1]) > TOL || Math.abs(p[k + 2] - q[k + 2]) > TOL) {
        px++; const n = k / 4, X = n % i.width, Y = (n / i.width) | 0;
        box[0] = Math.min(box[0], X); box[1] = Math.min(box[1], Y); box[2] = Math.max(box[2], X); box[3] = Math.max(box[3], Y);
      }
    }
    return { px, box };
  }, [png.toString('base64'), b.shots[name].toString('base64'), TOLERANCE]);
  if (r.px === 0) continue;
  diffs.push({ name, ...r });
  if (out) { await mkdir(out, { recursive: true }); await writeFile(join(out, `${name}-base.png`), png); await writeFile(join(out, `${name}-head.png`), b.shots[name]); }
}
await browser.close();
for (const s of servers) s.close();

console.log(`compared ${Object.keys(a.shots).length} screens (${a.ids.length} pages on the Edge, phone portrait and landscape views)`);
for (const k of missing) console.log(`  gone in the new build: ${k}`);
for (const d of diffs) console.log(`  ${d.name}: ${d.px < 0 ? 'size changed' : `${d.px} px differ in ${d.box.join(',')}`}`);
if (!diffs.length && !missing.length) { console.log('no visual change'); process.exit(0); }
if (lenient) { console.log('\nLOOK_CHANGE is set: reported, not failed.'); process.exit(0); }
console.error(`\n${diffs.length + missing.length} screens changed. If that is meant, label the PR look-change.`);
process.exit(1);
