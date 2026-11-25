// Renders every page of the panel in Chromium and fails when:
//   - any label is cut off, truncated with an ellipsis, or spills out of its control
//   - a keycap's label runs into its key name or tag
//   - anything animates or asks for animation frames while the panel is idle
//   - a page takes too long to build or switch to, or a touch takes too long to send
// It prints the measured numbers. Run `node scripts/sync.mjs` first.
//   node test/ui.mjs [--shots dir]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright from the project or, failing that, NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const BUDGET = { firstBuildMs: 120, switchMs: 40, touchToKeyMs: 10, nodes: 6000 };

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'text/xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = join(UI, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try { res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// Count animation frame requests, so an idle loop can't hide.
await page.addInitScript(() => {
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { window.__raf++; return raf(cb); };
});
// Past sessions on the Log page: the fixture log as a backup.
const pastLines = (await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'game-4.10.filtered.log'), 'utf8')).split('\n');
await page.addInitScript(lines => { window.xfdTestPastLogs = [{ name: 'Game Build 1.log', lines }]; }, pastLines);
// No network in the test: ship outlines fall back to the role badge.
await page.route(/fleetyards|fltyrd/, r => r.abort());

const problems = [];
const report = [];
if (shots) await mkdir(shots, { recursive: true });

async function checkLabels(where, sheet = false, pg = page) {
  const found = await pg.evaluate(sheet => {
    const out = [];
    const FRAMES = '.su-row, .su-foot, .su-card, .cap, .placard, .screen, .rbtn, .qbtn, .corner, .chip, .under, .cover, .chan, .softkeys .well, .opt, .act, .plate, .updates, .tab, .tabs, .pane, .wd-card, .pick, .pick-search, .pick-grid';
    const inside = (r, f, m = -1) => r.left >= f.left + m && r.right <= f.right - m && r.top >= f.top + m && r.bottom <= f.bottom - m;
    const visible = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) return false; } return true; };
    const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      const el = n.parentElement;
      if (!text || !visible(el) || !!el.closest('.sheet') !== sheet || el.closest('.toast, .banner')) continue;
      if (getComputedStyle(el).textOverflow === 'ellipsis') out.push(`${text}: ellipsis`);
      const range = document.createRange(); range.selectNodeContents(n);
      // Scrolled out of a scrolling list (the key picker's) isn't cut off.
      const sc = el.closest('.pick-grid');
      if (sc && sc.scrollHeight > sc.clientHeight + 1) { const r = el.getBoundingClientRect(), f = sc.getBoundingClientRect(); if (r.top < f.top || r.bottom > f.bottom) continue; }
      const frame = el.closest(FRAMES);
      if (!frame) { out.push(`${text}: outside any frame`); continue; }
      const fr = frame.getBoundingClientRect();
      for (const r of range.getClientRects()) {
        if (!inside(r, fr, 2)) { out.push(`"${text}" spills out of its ${frame.className.split(' ')[0]}`); break; }
        if (r.right > 2560 || r.left < 0) { out.push(`"${text}" is off screen`); break; }
      }
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`"${text}" is clipped`);
    }
    // Every control and placard sits wholly on its plate.
    for (const c of document.querySelectorAll('#console .plate :is(.placard, .well, .screen, .tgl, .round, .guard, .slide, .quantum, .lab, .wl)')) {
      if (!visible(c)) continue;
      const plate = c.closest('.plate').getBoundingClientRect(), r = c.getBoundingClientRect();
      if (!inside(r, plate)) out.push(`"${c.textContent.trim().slice(0, 40)}" (${c.className.split(' ')[0]}) runs off its plate`);
    }
    // A keycap's label must not run into its key name or tag.
    for (const cap of document.querySelectorAll('#console .cap')) {
      const lg = cap.querySelector('.lg')?.getBoundingClientRect();
      if (!lg) continue;
      for (const s of cap.querySelectorAll('.kb, .tg')) {
        const r = s.getBoundingClientRect();
        if (r.left < lg.right && r.right > lg.left && r.top < lg.bottom && r.bottom > lg.top) out.push(`"${cap.querySelector('.lg').textContent}" runs into "${s.textContent}"`);
      }
    }
    return out;
  }, sheet);
  for (const f of new Set(found)) problems.push(`${where}: ${f}`);
}

// The Verse page's prices and server status, as the app's Rust side hands them over.
// Wrapped text keeps the console whole: no text over other text, none out of its button or
// screen, and no word split across lines. Runs in the page, on the Edge and on devices.
const TEXT_CHECK = () => {
  window.__textCheck = root => {
    const out = [];
    const name = e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) || e.className.split(' ')[0];
    const leaves = [...root.querySelectorAll('*')].filter(t => !t.children.length && t.textContent.trim() && t.offsetWidth && !t.closest('.ph-hide, [hidden], [aria-hidden=true]') && getComputedStyle(t).visibility !== 'hidden' && +getComputedStyle(t).opacity !== 0);
    const rs = leaves.map(t => t.getBoundingClientRect());
    const range = document.createRange();
    leaves.forEach((t, i) => {
      const box = t.closest('button, .cap, .seg, .screen, .placard');
      if (box && box !== t) {
        const br = box.getBoundingClientRect();
        if (rs[i].bottom > br.bottom + 2 || rs[i].right > br.right + 2 || rs[i].left < br.left - 2 || rs[i].top < br.top - 2) out.push(`"${name(t)}" falls out of its ${box.matches('.screen') ? 'screen' : 'button'}`);
      }
      const node = t.firstChild;
      if (node?.nodeType === 3) {
        for (const m of node.data.matchAll(/\S+/g)) {
          range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          const lines = new Set([...range.getClientRects()].filter(r => r.width > 0.5).map(r => Math.round(r.top)));
          if (lines.size > 1) { out.push(`"${m[0]}" is split across lines`); break; }
        }
      }
      for (let j = i + 1; j < leaves.length; j++) {
        // A guard cover lies over its own key's label on purpose.
        if (t.contains(leaves[j]) || leaves[j].contains(t) || !!t.closest('.cover') !== !!leaves[j].closest('.cover')) continue;
        const a = rs[i], b = rs[j];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push(`"${name(t)}" and "${name(leaves[j])}" overlap`);
      }
    });
    return out;
  };
};
const MARKET = JSON.parse(await readFile(join(UI, '..', 'test', 'fixtures', 'world-market.json'), 'utf8'));
const CHART = JSON.parse(await readFile(join(UI, '..', 'test', 'fixtures', 'world-chart.json'), 'utf8'));
await page.addInitScript(TEXT_CHECK);
await page.addInitScript(([m, c]) => { window.xfdTestWorld = { chart: c, prices: m, status: { fetched: Date.now(), summary: 'disrupted', services: [{ name: 'Platform', status: 'operational' }, { name: 'Persistent Universe', status: 'disrupted' }, { name: 'Arena Commander', status: 'operational' }] } }; }, [MARKET, CHART]);

// Every page, then each mood of the demo.
await page.goto(base + '?demo=ship');
await page.waitForSelector('body[data-ready]');
await page.evaluate(() => document.fonts.ready);
const ids = (await page.evaluate(() => window.xfd.pages())).filter(id => id !== 'left');
let worstBuild = 0, worstSwitch = 0;
for (const id of ids) {
  const ms = await page.evaluate(id => { const t = performance.now(); window.xfd.show(id); document.body.offsetHeight; return performance.now() - t; }, id);
  worstBuild = Math.max(worstBuild, ms);
  await checkLabels(id);
  // The page title, counter and arrows sit on their own strip: nothing on the plate may run under them.
  const under = await page.evaluate(() => {
    const plate = document.querySelector('.rolemod');
    if (!plate) return [];
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // 4 px of clearance, plus the arrows' 3 px drop shadow.
    const bars = [plate.querySelector('.pager'), plate.querySelector('.rtitle')].map(e => e.getBoundingClientRect())
      .map(r => ({ left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 7 }));
    return [...plate.querySelectorAll('.well, .dialw, .placard, .rotary, .slider, .round, .screen, .screw, .quantum, .hz')]
      .filter(e => bars.some(b => hit(b, e.getBoundingClientRect())))
      .map(e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) || e.className);
  });
  for (const u of under) problems.push(`${id}: "${u}" is under the page title or arrows`);
  // No two controls on a plate may touch: boxes, or circles for dials and round controls, with 2 px between them.
  const overlaps = await page.evaluate(() => {
    const out = [];
    const name = e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) || e.className.split(' ')[0];
    const plates = [...document.querySelectorAll('#console .plate')];
    plates.forEach((a, i) => plates.slice(i + 1).forEach(b => {
      const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) out.push(`plates "${name(a.querySelector('.title') || a)}" and "${name(b.querySelector('.title') || b)}" overlap`);
    }));
    for (const plate of plates) {
      const items = [...plate.children].filter(e => !e.matches('.screw, .title, .pager, .rtitle') && getComputedStyle(e).display !== 'none')
        .map(e => {
          const r = e.getBoundingClientRect();
          const round = e.matches('.dialw, .round, .quantum, .knobw');
          return { e, r, round, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, rad: Math.min(r.width, r.height) / 2 - (e.matches('.dialw') ? 10 : 0) };  // a dial's box has 10 px around its bezel
        }).filter(i => i.r.width && i.r.height);
      const boxHit = (a, b, g) => a.left < b.right + g && b.left < a.right + g && a.top < b.bottom + g && b.top < a.bottom + g;
      const circleBox = (c, b, g) => {
        const x = Math.max(b.left, Math.min(c.cx, b.right)), y = Math.max(b.top, Math.min(c.cy, b.bottom));
        return Math.hypot(c.cx - x, c.cy - y) < c.rad + g;
      };
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const hit = a.round && b.round ? Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.rad + b.rad + 2
          : a.round ? circleBox(a, b.r, 2) : b.round ? circleBox(b, a.r, 2) : boxHit(a.r, b.r, 2);
        if (hit) out.push(`"${name(a.e)}" and "${name(b.e)}" overlap`);
      }
    }
    return out;
  });
  for (const o of overlaps) problems.push(`${id}: ${o}`);
  for (const t of await page.evaluate(() => [...document.querySelectorAll('#status, #console .plate')].flatMap(p => window.__textCheck(p)))) problems.push(`${id}: ${t}`);
  if (shots) await page.screenshot({ path: join(shots, `${id}.png`) });
}
// Past sessions: the backup log's one session, in a table that fits.
{
  await page.evaluate(() => window.xfd.show('log'));
  await page.waitForTimeout(300);
  const pastRows = await page.evaluate(() => [...document.querySelectorAll('#lg-past tr')].map(r => r.textContent));
  if (pastRows.length !== 2 || !/8 min.*Sabre Firebird/.test(pastRows[1] || '')) problems.push(`past sessions show ${JSON.stringify(pastRows)}`);
  await checkLabels('log with past sessions');
  for (const t of await page.evaluate(() => [...document.querySelectorAll('#console .plate')].flatMap(p => window.__textCheck(p)))) problems.push(`log with past sessions: ${t}`);
  if (shots) await page.screenshot({ path: join(shots, 'log-past.png') });
  // The cards full: a whole session (downed, shard, ships) still fits them.
  const pg = await browser.newPage({ viewport: { width: 2560, height: 720 } });
  await pg.addInitScript(TEXT_CHECK);
  await pg.addInitScript(lines => { window.xfdTestPastLogs = [{ name: 'Game Build 1.log', lines }]; }, pastLines);
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base);
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => document.fonts.ready);
  await pg.evaluate(lines => { window.xfd.feed(lines, false); window.xfd.show('log'); }, pastLines);
  await pg.waitForTimeout(300);
  await checkLabels('log with a full session', false, pg);
  for (const t of await pg.evaluate(() => [...document.querySelectorAll('#console .plate')].flatMap(p => window.__textCheck(p)))) problems.push(`log with a full session: ${t}`);
  if (shots) await pg.screenshot({ path: join(shots, 'log-full.png') });
  await pg.close();
}
// Large labels: every page again with the bigger text, which must still fit.
await page.evaluate(() => document.getElementById('stage').classList.add('large'));
for (const id of ids) {
  await page.evaluate(id => window.xfd.show(id), id);
  await checkLabels(`${id} (large labels)`);
  if (shots && ['flight', 'light-fighter', 'onfoot'].includes(id)) await page.screenshot({ path: join(shots, `large-${id}.png`) });
}
await page.evaluate(() => document.getElementById('stage').classList.remove('large'));
for (const id of ['mining', 'light-fighter', 'onfoot', 'downed']) {
  const ms = await page.evaluate(id => { const t = performance.now(); window.xfd.show(id); document.body.offsetHeight; return performance.now() - t; }, id);
  worstSwitch = Math.max(worstSwitch, ms);
}
const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);

// Touch to key: from the finger lifting to the key being handed to the app.
await page.evaluate(() => window.xfd.show('light-fighter'));
const touch = await page.evaluate(async () => {
  const key = [...document.querySelectorAll('#console .well.key')].find(k => k.textContent.includes('Noise'));
  const cap = key;
  const times = [];
  for (let i = 0; i < 20; i++) {
    window.__keys = [];
    const o = { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 };
    cap.dispatchEvent(new PointerEvent('pointerdown', o));
    const t = performance.now();
    cap.dispatchEvent(new PointerEvent('pointerup', o));
    await new Promise(r => setTimeout(r, 0));
    if (window.__keys[0]) times.push(window.__keys[0].t - t);
  }
  return times.length ? Math.max(...times) : null;
});

// The gear starts unknown: lever in the middle, lights dark. Pulled down it sends gear down and shows DOWN.
await page.evaluate(() => window.xfd.show('mining'));
const gear0 = await page.$eval('#console .gear', e => e.classList.contains('on') || e.classList.contains('up'));
if (gear0) problems.push('the gear lever shows a side before it was moved');
{
  await page.evaluate(() => { window.__keys = []; });
  const a = await (await page.$('#console .gear .arm')).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 120, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(100);
  const g = await page.evaluate(() => ({ down: document.querySelector('#console .gear').classList.contains('on'), sent: window.__keys.length }));
  if (!g.down || g.sent !== 1) problems.push(`pulling the gear lever down: ${JSON.stringify(g)}`);
}
// Controls that send steps show no value: no percentages anywhere on the console.
for (const id of ['mining', 'cargo', 'salvage']) {
  const pct = await page.evaluate(id => { window.xfd.show(id); return /\d+\s*%/.test(document.getElementById('console').textContent); }, id);
  if (pct) problems.push(`${id} shows a percentage the game never reported`);
}

// Verse: every view of the market fits; the hangar shows no time until synced, then the right lights;
// a timer starts with a tap. Nothing animates while it shows.
{
  const at = new Date().toISOString();
  const me = 'pilot'; // the ship demo's character
  await page.evaluate(([at, me]) => {
    for (const k of ['xfd-world-hangar', 'xfd-world-timers']) localStorage.removeItem(k);
    window.xfd.feed([`<${at}> [Notice] <RequestLocationInventory> Player[${me}] requested inventory for Location[Stanton3_Area18] [Team_CoreGameplayFeatures][Inventory]`]);
    window.xfd.show('flight'); window.xfd.show('world');
  }, [at, me]);
  await page.waitForTimeout(200);
  const txt = sel => page.$eval(sel, e => e.textContent);
  if (!(await txt('#wd-xh')).includes('Not synced') || /\d\d:\d\d –/.test(await txt('#wd-xh'))) problems.push('world: the hangar shows times before a sync');
  if (!(await txt('#wd-cm')).includes('Area 18')) problems.push(`world: Here is not Area 18: ${(await txt('#wd-cm')).slice(0, 80)}`);
  if (!(await txt('#wd-sv')).includes('Disrupted')) problems.push('world: the server status does not show');
  await checkLabels('world here buy');
  const views = [['sell', '#wd-cmhead [data-side=sell]'], ['nearby', '#wd-cmhead [data-mode=nearby]'], ['find', '#wd-cmhead [data-mode=find]'], ['find metals', '#wd-cm [data-chip=Metals]'], ['find gold', '#wd-cm [data-c=Gold]']];
  for (const [name, sel] of views) {
    await page.click(sel);
    await checkLabels(`world ${name}`);
  }
  if (!(await txt('#wd-cm')).includes('Cheapest to buy')) problems.push('world: Find > Gold shows no places');
  if (shots) await page.screenshot({ path: join(shots, 'world-find-gold.png') });
  await page.click('#wd-xh .wsync');
  await checkLabels('world sync dialog');
  await page.click('.wdlg [data-s=o3]');
  const xh = await txt('#wd-xh');
  if (!xh.includes('Open') || !/Closes at \d\d:\d\d/.test(xh)) problems.push(`world: after syncing on 3 green the hangar reads ${xh.slice(0, 120)}`);
  const lit = await page.$$eval('#wd-xh > .lamps .lamp.g', l => l.length);
  if (lit !== 3) problems.push(`world: ${lit} green lights after syncing on 3`);
  await page.click('#wd-tm .tmr:has-text("Red keycard")');
  if (!(await txt('#wd-tm')).includes('30 min left')) problems.push('world: the red keycard timer did not start');
  await checkLabels('world synced');
  const raf0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => window.__raf) !== raf0) problems.push('world: asks for animation frames while idle');
  if (shots) await page.screenshot({ path: join(shots, 'world-synced.png') });
  await page.evaluate(() => { for (const k of ['xfd-world-hangar', 'xfd-world-timers']) localStorage.removeItem(k); window.xfd.show('mining'); });
}

// System chart: the Map softkey again opens it; it draws on opening and never while idle, marks only
// the place Game.log named, lights a commodity Verse sends it, and gives its graphics back when closed.
{
  await page.evaluate(() => window.xfd.show('map'));
  await page.click('#softkeys .well:has-text("Map")');
  await page.waitForTimeout(800);
  if (await page.evaluate(() => window.xfd.current()) !== 'chart') problems.push('chart: Map again does not open the chart');
  const s = await page.evaluate(() => window.xfd.chart());
  if (!s.view || !(await page.$('#sc-host canvas'))) problems.push('chart: no 3D view');
  if (s.where?.body !== 'ArcCorp' || s.where?.place !== 'Area 18') problems.push(`chart: the marker is not Area 18 on ArcCorp: ${JSON.stringify(s.where)}`);
  if (!(await page.$eval('#sc-card', e => e.textContent)).includes('Area 18')) problems.push('chart: the card does not say Area 18');
  await checkLabels('chart');
  const raf0 = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => window.__raf) !== raf0) problems.push('chart: asks for animation frames while idle');
  if (shots) await page.screenshot({ path: join(shots, 'chart.png') });
  // A tap on a body picks it; Verse's Show on chart lights where a commodity sells.
  const you = await page.$eval('.sc-l.you', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top - 36 }; });
  await page.mouse.click(you.x, you.y);
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.xfd.chart().pick) !== 'ArcCorp') problems.push(`chart: a tap on ArcCorp picked ${await page.evaluate(() => window.xfd.chart().pick)}`);
  await checkLabels('chart picked');
  await page.evaluate(() => window.xfd.chartGoods('Gold'));
  await page.waitForTimeout(300);
  const gold = await page.$eval('#sc-card', e => e.textContent);
  if (!gold.includes('Gold') || !gold.includes('Sells for 31,000')) problems.push(`chart: Gold on the chart reads ${gold.slice(0, 120)}`);
  await checkLabels('chart gold');
  if (shots) await page.screenshot({ path: join(shots, 'chart-gold.png') });
  await page.click('#sc-card [data-clear]');
  await page.evaluate(() => window.xfd.show('mining'));
  if (await page.evaluate(() => window.xfd.chart().view) || await page.$('canvas.sc-canvas')) problems.push('chart: the 3D view stays after leaving the page');
}

// A rearranged console: plates in reverse order still fit, labels and all.
await page.evaluate(() => { localStorage.setItem('xfd-order:fighter', JSON.stringify(['gear', 'flight', 'role', 'power'])); window.xfd.show('mining'); window.xfd.show('light-fighter'); });
await checkLabels('light-fighter rearranged');
const slots = await page.evaluate(() => [...document.querySelectorAll('#console .plate[data-slot]')].sort((a, b) => a.offsetLeft - b.offsetLeft).map(p => p.dataset.slot).join());
if (slots !== 'gear,flight,role,power') problems.push(`rearranged plates came out as ${slots}`);
const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#console .plate')].map(p => p.getBoundingClientRect().right)));
if (right > 2560) problems.push(`rearranged plates run off screen (${right})`);
await page.evaluate(() => { localStorage.removeItem('xfd-order:fighter'); window.xfd.show('mining'); });

// A slot for kit the ship lacks takes a key: long-press, pick, and it is a working key; a tap on it does not reopen the picker.
await page.evaluate(() => window.xfd.show('light-fighter--no-missiles'));
const spare = await page.$('#console .spare');
if (!spare) problems.push('light-fighter--no-missiles has no spare slot');
else {
  const sb = await spare.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  if (await page.$eval('#picker', e => e.hidden)) problems.push('long-press on a spare slot did not open the key picker');
  await page.click('#pick-tabs .tab[data-g=systems]');
  await page.click('#pick-grid .pick:has-text("All systems on")');
  const now = await page.$eval('#console .spare', e => e.classList.contains('key') ? e.querySelector('.lg').textContent : 'blank');
  if (now !== 'All systems on') problems.push(`spare slot shows ${now} after picking All systems on`);
  const nb = await (await page.$('#console .spare')).boundingBox();
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  if (!(await page.$eval('#picker', e => e.hidden))) problems.push('a tap on an assigned spare slot opened the picker');
  await checkLabels('light-fighter--no-missiles with a spare key');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('xfd-slot:')) localStorage.removeItem(k); window.xfd.show('mining'); });
}

// On a 4:3 screen the console stacks in two rows: bigger than one row, every plate on screen, none overlapping.
await page.setViewportSize({ width: 1600, height: 1200 });
await page.waitForTimeout(100);
for (const id of ['light-fighter', 'onfoot', 'emotes', 'downed']) {
  const r = await page.evaluate(id => {
    window.xfd.show(id);
    const st = document.getElementById('stage');
    const boxes = [...document.querySelectorAll('#stage > .plate, #console > .plate')].map(p => p.getBoundingClientRect());
    const out = boxes.filter(b => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1).length;
    let hit = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hit++;
    }
    return { stacked: st.classList.contains('stacked'), out, hit };
  }, id);
  if (!r.stacked) problems.push(`${id} at 1600x1200 is not in two rows`);
  if (r.out) problems.push(`${id} at 1600x1200: ${r.out} plates off screen`);
  if (r.hit) problems.push(`${id} at 1600x1200: ${r.hit} plates overlap`);
}
await page.setViewportSize({ width: 2560, height: 720 });
await page.waitForTimeout(100);
if (await page.evaluate(() => document.getElementById('stage').classList.contains('stacked'))) problems.push('the console stays in two rows at 2560x720');
await page.evaluate(() => window.xfd.show('mining'));

// With the game's default binds, every key the console uses can be pressed and none collide.
const health = await page.evaluate(() => window.xfd.bindHealth());
if (health.missing.length) problems.push(`keys with no default keyboard bind: ${health.missing.join(', ')}`);
if (health.shared.length) problems.push(`default binds that collide: ${health.shared.join('; ')}`);
report.push(`keybind check: ${health.total} keys, ${health.missing.length} missing, ${health.shared.length} shared`);

// Our key takes quantum engage's Keyboard/Mouse slot (default: left mouse button), so the profile
// puts the button on the mouse; binds loaded without it say quantum lost its button.
if (health.mouse.length) problems.push(`default binds report lost mouse buttons: ${health.mouse.join(', ')}`);
// The game fires right Shift's own action (Lock rotation) mid-chord, so no console key may use it.
if (health.held.length) problems.push(`console binds use a modifier the game binds on its own: ${health.held.join(', ')}`);
const doors = `<ActionMaps><ActionProfiles profileName="default"><actionmap name="spaceship_general"><action name="v_open_all_doors"><rebind input="kb1_rctrl+rshift+f4"/></action></actionmap></ActionProfiles></ActionMaps>`;
const oldDoors = await page.evaluate(async xml => { window.xfdTestBinds = xml; await window.xfd.reloadBinds(); return window.xfd.bindHealth(); }, doors);
if (!oldDoors.held.some(m => /RShift F4, also locks rotation/.test(m))) problems.push(`a right Shift chord is not reported: ${oldDoors.held.join(', ')}`);
const qdrive = mo => `<ActionMaps><ActionProfiles profileName="default"><actionmap name="spaceship_quantum"><action name="v_toggle_qdrive_engagement"><rebind input="kb1_rctrl+f6"/>${mo}</action></actionmap></ActionProfiles></ActionMaps>`;
for (const [mo, lost] of [['', true], ['<rebind input="mo1_mouse1"/>', false]]) {
  const h = await page.evaluate(async xml => { window.xfdTestBinds = xml; await window.xfd.reloadBinds(); return window.xfd.bindHealth(); }, qdrive(mo));
  if (lost !== h.mouse.some(m => m.startsWith('Quantum (left mouse button)'))) problems.push(`quantum's left mouse button ${lost ? 'not reported lost' : 'reported lost'} with ${mo || 'no mouse bind'}: ${h.mouse.join(', ')}`);
}
await page.evaluate(async () => { window.xfdTestBinds = null; await window.xfd.reloadBinds(); });

// A profile carries the player's keyboard binds as a Control Profile the game can load.
const profileXml = await page.evaluate(() => window.xfd.bindsProfile(`<ActionMaps><ActionProfiles profileName="default">
  <actionmap name="spaceship_movement"><action name="v_vtol_toggle"><rebind input="js1_button3"/><rebind input="kb1_n"/></action>
  <action name="v_autoland"><rebind input="js1_button4"/></action></actionmap></ActionProfiles></ActionMaps>`));
if (!/<actionmap name="spaceship_movement">\s*<action name="v_vtol_toggle">\s*<rebind input="kb1_n"\/>/.test(profileXml || '') || /js1_|v_autoland/.test(profileXml))
  problems.push(`profile binds are wrong:\n${profileXml}`);

// A kept copy of the binds goes back as a Control Profile with every device, its options and all binds.
const backupXml = await page.evaluate(() => window.xfd.backupProfile(`<ActionMaps><ActionProfiles version="1" optionsVersion="2" rebindVersion="2" profileName="default">
  <deviceoptions name="VKB  {0200231D}"><option input="x" deadzone="0.02"/></deviceoptions>
  <options type="keyboard" instance="1" Product="Keyboard  {6F1D2B61}"/>
  <options type="joystick" instance="1" Product="VKB  {0200231D}"><flight_move_pitch invert="1"/></options>
  <modifiers/>
  <actionmap name="spaceship_movement"><action name="v_vtol_toggle"><rebind input="js1_button3"/></action>
  <action name="v_autoland"><rebind input="kb1_ "/></action></actionmap></ActionProfiles></ActionMaps>`, 1763800000));
for (const want of ['profileName="edge-cockpit-backup"', '<keyboard instance="1"/>', '<joystick instance="1"/>', '<rebind input="js1_button3"/>', '<rebind input="kb1_ "/>', 'invert="1"', 'deadzone="0.02"'])
  if (!(backupXml || '').includes(want)) problems.push(`binds copy profile lacks ${want}:\n${backupXml}`);
if (/xmlns|ActionProfiles/.test(backupXml || '')) problems.push(`binds copy profile carries actionmaps.xml wrapping:\n${backupXml}`);
// Binds that look wiped: Keybinds warns, the chip says so, and the settings below are checked that way.
await page.evaluate(() => { window.xfdTestBackups = { lost: true, now: 12, copies: [{ file: 'actionmaps-1763800000.xml', at: 1763800000, binds: 214 }, { file: 'actionmaps-1763700000.xml', at: 1763700000, binds: 210 }] }; return window.xfd.paintBackups(); });
const lostUi = await page.evaluate(() => ({ card: !document.getElementById('binds-lost').hidden, restore: !document.getElementById('act-restore').hidden, keep: !document.getElementById('act-keep').hidden, chip: document.querySelector('#binds-chip span').textContent, chipShown: !document.getElementById('binds-chip').hidden }));
if (!lostUi.card || !lostUi.restore || !lostUi.keep || !lostUi.chipShown || lostUi.chip !== 'Binds reset') problems.push(`wiped binds not shown: ${JSON.stringify(lostUi)}`);

await page.evaluate(() => {
  document.getElementById('sheet').hidden = false;
  const n = document.getElementById('upd-notes');
  n.hidden = false;
  n.innerHTML = '<h4>New</h4><li>Screen off when not playing</li><li>Start with Windows</li><p>Thanks for flying.</p>';
});
// Every section of the sheet, one at a time.
for (const sec of await page.evaluate(() => [...document.querySelectorAll('.tab[data-sec]')].map(t => t.dataset.sec))) {
  await page.evaluate(sec => {
    document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.sec !== sec; });
    document.querySelectorAll('.tab[data-sec]').forEach(t => t.classList.toggle('cur', t.dataset.sec === sec));
  }, sec);
  await checkLabels(`settings: ${sec}`, true);
  // Anything marked hidden must not show, whatever display its class gives it.
  const shown = await page.evaluate(() => [...document.querySelectorAll('[hidden]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className));
  for (const x of shown) problems.push(`settings: ${sec}: ${x} is hidden but still shows`);
  if (shots) await page.screenshot({ path: join(shots, `settings-${sec}.png`) });
}
await page.evaluate(() => { window.xfdTestBackups = null; return window.xfd.paintBackups(); });
// Displays: Automatic plus each display, and a warning when touch maps to another one.
await page.evaluate(() => {
  window.xfdTestDisplays = { picked: null, current: '\\\\.\\DISPLAY2', touch_ok: false, list: [
    { id: '\\\\.\\DISPLAY1', name: 'DELL U2723QE', width: 3840, height: 2160, primary: true, touch: true },
    { id: '\\\\.\\DISPLAY2', name: 'XENEON EDGE', width: 2560, height: 720, primary: false, touch: false }] };
});
// Night mode: Off, Auto and On, from the Screen section.
await page.evaluate(() => document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.sec !== 'screen'; }));
const night = {};
for (const v of ['on', 'auto', 'off']) {
  await page.click(`#night-seg [data-v="${v}"]`);
  night[v] = await page.evaluate(() => ({ dim: document.getElementById('stage').classList.contains('night'),
    cur: document.querySelector('#night-seg .cur')?.dataset.v, note: document.getElementById('night-note').textContent }));
}
// Night backlight: a screen that doesn't answer DDC/CI says only the console dims.
await page.evaluate(() => { window.xfdTestBacklight = false; });
await page.click('#night-seg [data-v="on"]');
await page.click('#nightlight-seg [data-v="10"]');
await page.waitForTimeout(100);
const nl = await page.evaluate(() => ({ cur: document.querySelector('#nightlight-seg .cur')?.dataset.v, note: document.getElementById('nightlight-note').textContent }));
if (nl.cur !== '10' || nl.note !== 'This screen can\'t dim its backlight') problems.push(`night backlight is wrong: ${JSON.stringify(nl)}`);
await page.click('#nightlight-seg [data-v="30"]');
await page.click('#night-seg [data-v="off"]');
await page.evaluate(() => { delete window.xfdTestBacklight; });
await page.evaluate(() => window.xfd.showSection('screen'));
await page.waitForTimeout(100);
const disp = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#displays .disp b')].map(b => b.textContent),
  cur: document.querySelector('#displays .cur b')?.textContent, warn: !document.getElementById('touch-health').hidden }));
if (disp.cards.join('|') !== 'Automatic|DELL U2723QE|XENEON EDGE' || disp.cur !== 'Automatic' || !disp.warn) problems.push(`display picker is wrong: ${JSON.stringify(disp)}`);
await page.click('#displays .disp >> nth=2');
await page.waitForTimeout(100);
if (await page.evaluate(() => document.querySelector('#displays .cur b')?.textContent) !== 'XENEON EDGE') problems.push('picking a display does not stick');
await checkLabels('settings: screen with displays', true);
if (shots) await page.screenshot({ path: join(shots, 'settings-screen-displays.png') });
// Screen check: a console smaller than its screen (mixed scales) shows the scale on each
// card, an amber row and chip with Refit; Refit clears them.
await page.evaluate(() => Object.assign(window.xfdTestDisplays, { fit: { want: [2560, 720], got: [1707, 480] } }) && window.xfdTestDisplays.list.forEach((d, i) => { d.scale = i ? 100 : 150; }));
await page.evaluate(() => window.xfd.showSection('screen'));
await page.waitForTimeout(100);
const fit = await page.evaluate(() => ({ row: !document.getElementById('fit-health').hidden && document.querySelector('#fit-health b').textContent,
  chip: !document.getElementById('fit-chip').hidden, notes: [...document.querySelectorAll('#displays .disp small')].map(s => s.textContent) }));
if (fit.row !== 'The console is 1707 × 480 on a 2560 × 720 screen' || !fit.chip || !fit.notes[1].includes('150 % scale') || !fit.notes[2].includes('100 % scale')) problems.push(`screen check is wrong: ${JSON.stringify(fit)}`);
await checkLabels('settings: screen too small', true);
if (shots) await page.screenshot({ path: join(shots, 'settings-screen-fit.png') });
await page.click('#act-refit');
await page.waitForTimeout(150);
if (await page.evaluate(() => !document.getElementById('fit-health').hidden || !document.getElementById('fit-chip').hidden)) problems.push('Refit leaves the screen check showing');
await page.evaluate(() => window.xfdTestDisplays.list.forEach(d => { delete d.scale; }));
await page.evaluate(() => window.xfd.showSection('screen'));
const late = new Date().getHours() >= 20 || new Date().getHours() < 7;
if (!night.on.dim || night.on.cur !== 'on') problems.push(`night mode On does not dim: ${JSON.stringify(night.on)}`);
if (night.auto.dim !== late || !/20:00 to 07:00/.test(night.auto.note)) problems.push(`night mode Auto is wrong: ${JSON.stringify(night.auto)}`);
if (night.off.dim || night.off.cur !== 'off') problems.push(`night mode Off still dims: ${JSON.stringify(night.off)}`);
await page.evaluate(() => { document.getElementById('sheet').hidden = true; });

// Wipe lock: holding the clock covers the console, so a touch reaches no key; holding the
// cover ends it.
{
  await page.evaluate(() => { document.getElementById('sheet').hidden = true; });
  const c = await (await page.$('#clock')).boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
  const w = await page.evaluate(() => {
    const k = document.querySelector('#console .plate button, #console .plate [class*="cap"]')?.getBoundingClientRect();
    const top = k && document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
    return { shown: !document.getElementById('wipe').hidden, covers: !!top?.closest('#wipe'), text: document.getElementById('wipe-left').textContent };
  });
  if (!w.shown || !w.covers || !/^Touches are off for 1[45] s$/.test(w.text)) problems.push(`wipe lock is wrong: ${JSON.stringify(w)}`);
  if (shots) await page.screenshot({ path: join(shots, 'wipe.png') });
  await page.mouse.move(1280, 360); await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
  if (await page.evaluate(() => !document.getElementById('wipe').hidden)) problems.push('holding the wipe lock does not end it');
}

// The setup check: four rows, the touch warning from the displays above, nothing cut off.
await page.evaluate(() => window.xfd.setup());
await page.waitForTimeout(150);
const setup = await page.evaluate(() => [...document.querySelectorAll('#su-rows .su-row')].map(r => r.className.replace('su-row ', '') + ':' + r.querySelector('b').textContent));
if (setup.length !== 5 || setup[0] !== 'ok:Console fills XENEON EDGE' || setup[1] !== 'warn:Touches land on another display' || !setup[4].startsWith('unknown:')) problems.push(`setup check is wrong: ${JSON.stringify(setup)}`);
await checkLabels('setup check');
if (shots) await page.screenshot({ path: join(shots, 'setup.png') });
await page.click('#su-done');
if (!(await page.evaluate(() => document.getElementById('setup').hidden))) problems.push('Done does not close the setup check');

// The controls legend follows the first setup check: ten samples, nothing cut off, Got it closes it for good.
const legend = await page.evaluate(() => ({ shown: !document.getElementById('legend').hidden, rows: document.querySelectorAll('#lgd-rows .lgd-row').length }));
if (!legend.shown || legend.rows !== 10) problems.push(`controls legend after the setup check is wrong: ${JSON.stringify(legend)}`);
await checkLabels('controls legend');
if (shots) await page.screenshot({ path: join(shots, 'legend.png') });
await page.click('#lgd-done');
if (!(await page.evaluate(() => document.getElementById('legend').hidden))) problems.push('Got it does not close the controls legend');
await page.evaluate(() => window.xfd.setup());
await page.click('#su-done');
if (!(await page.evaluate(() => document.getElementById('legend').hidden))) problems.push('the controls legend shows again after the setup check');
// The ? on the status screen opens it again.
await page.click('#help');
if (await page.evaluate(() => document.getElementById('legend').hidden)) problems.push('the ? does not open the controls legend');
await page.click('#lgd-done');

// Patch watch: a session loaded long ago with no character or server line shows the chip.
await page.evaluate(() => { window.xfd.feed(['<2020-01-01T10:00:00.000Z> <Context Establisher Done>'], false); window.xfd.feed(['nothing the console reads']); });
if (await page.evaluate(() => document.getElementById('patch').hidden)) problems.push('patch watch chip did not show');
await checkLabels('patch watch chip');

// The hidden performance overlay: hold the title for 2 s, read it, close it the same way.
const brand = await page.locator('#mfd .brand').boundingBox();
await page.mouse.move(brand.x + 30, brand.y + brand.height / 2);
await page.mouse.down(); await page.waitForTimeout(2200); await page.mouse.up();
await page.evaluate(() => { window.__keys = []; window.xfdTestPerf = { cpu: 0.8, mem_mb: 164 }; });
await page.click('#console .well >> nth=0').catch(() => {});
await page.waitForTimeout(1200);
const perfRows = await page.evaluate(() => [...document.querySelectorAll('#perf dd')].map(d => d.textContent));
const perfOpen = await page.evaluate(() => !document.getElementById('perf').hidden);
if (!perfOpen || perfRows.length !== 4 || !/fps/.test(perfRows[0]) || perfRows[1] !== '0.8 %' || !/^164 MB app/.test(perfRows[2])) problems.push(`performance overlay did not open: ${JSON.stringify(perfRows)}`);
await checkLabels('performance overlay');
if (shots) await page.screenshot({ path: join(shots, 'perf.png') });
await page.evaluate(() => window.xfd.perf(false));
report.push(`overlay: ${perfRows.join(' | ')}`);

// A busy status: mission, place, quantum and route all fit on the screen, on the Edge and a small phone.
const BUSY = ['<Context Establisher Done>', 'Added notification "Entered Ungoverned Jurisdiction: " [1]',
  '<RequestLocationInventory> Player[Argoneth] requested inventory for Location[AsteroidClusterBase_Nyx_Social_Keeger_001]',
  "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'ORIG_m80_123456' [123456]",
  'Added notification "Contract Accepted: Retrieve Additional Smuggler Intel <EM4>[BP]</EM4> <EM4>[100 Rep]</EM4>: " [2]',
  'Added notification "New Objective: Go to Location: " [3]',
  'MissionObjectiveMarker_754[754] - Paired with NavPoint: MISSION_QT_Kaboos_928004668243[928004668243]',
  'Player has selected point MISSION_QT_Kaboos_928004668243 as their destination'];
const busyFits = pg => pg.evaluate(() => {
  const s = document.getElementById('mfd').getBoundingClientRect(), out = [];
  for (const id of ['mission', 'where', 'orrery', 'auto']) {
    const e = document.getElementById(id), b = e.getBoundingClientRect();
    if (e.hidden || e.hasAttribute('hidden') || !b.height) out.push(`${id} does not show`);
    else if (b.bottom > s.bottom - 4) out.push(`${id} runs off the status screen`);
  }
  const qt = document.getElementById('qt-name').textContent;
  if (qt !== 'Quantum to Kaboos') out.push(`quantum reads "${qt}"`);
  return out;
});
for (const [W, H] of [[2560, 720], [360, 640], [393, 852]]) {
  const phone = W < 1000;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: phone, isMobile: phone });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`busy status ${W}x${H}: ${e.message}`));
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + (phone ? '?phone&demo=nyx' : '?demo=nyx'));
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(200);
  await pg.evaluate(l => window.xfd.feed(l), BUSY);
  await pg.waitForTimeout(100);
  for (const o of await busyFits(pg)) problems.push(`busy status ${W}x${H}: ${o}`);
  if (!phone) await checkLabels('busy status', false, pg);
  await ctx.close();
}

// Idle: nothing animates and no frames are asked for.
for (const mood of ['ship', 'armistice', 'alert', 'downed']) {
  await page.goto(`${base}?demo=${mood}`);
  await page.waitForSelector('body[data-ready]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await checkLabels(`demo ${mood}`);
  const idle = await page.evaluate(async () => {
    const before = window.__raf;
    await new Promise(r => setTimeout(r, 2000));
    return { frames: window.__raf - before, animations: document.getAnimations().filter(a => a.playState === 'running').length };
  });
  if (idle.frames) problems.push(`demo ${mood}: ${idle.frames} animation frames asked for while idle`);
  if (idle.animations) problems.push(`demo ${mood}: ${idle.animations} animations running while idle`);
  if (shots) await page.screenshot({ path: join(shots, `demo-${mood}.png`) });
}

// Phones: every page in portrait and landscape, each view of each plate: on screen, nothing
// overlapping or cut off, and big enough to press.
let phoneViews = 0, phoneLow = 9;
for (const [W, H, tag] of [[393, 852, 'portrait'], [852, 393, 'landscape']]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: shots ? 2 : 1 });
  const ph = await ctx.newPage();
  ph.on('pageerror', e => errors.push(`phone ${tag}: ${e.message}`));
  await ph.addInitScript(TEXT_CHECK);
  await ph.addInitScript(([m, c]) => { window.xfdTestWorld = { chart: c, prices: m, status: { fetched: Date.now(), summary: 'ok', services: [] } }; }, [MARKET, CHART]);
  await ph.route(/fleetyards|fltyrd/, r => r.abort());
  await ph.goto(base + '?phone&demo=ship');
  await ph.waitForSelector('body[data-ready]');
  await ph.evaluate(() => document.fonts.ready);
  if (await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`phone ${tag}: the page is wider than the screen`);
  for (const id of ids) {
    await ph.evaluate(id => window.xfd.show(id), id);
    const n = await ph.evaluate(() => document.querySelectorAll('#ph-rail button').length);
    for (let k = 0; k < n; k++) {
      const r = await ph.evaluate(k => {
        document.querySelectorAll('#ph-rail button')[k].click();
        const out = [];
        const plate = document.querySelector('.ph-on');
        if (!plate) return { out: ['no plate shows'] };
        const scale = new DOMMatrix(getComputedStyle(document.getElementById('stage')).transform).a;
        const pr = plate.getBoundingClientRect();
        if (pr.left < -1 || pr.top < -1 || pr.right > innerWidth + 1 || pr.bottom > innerHeight + 1) out.push('plate runs off the screen');
        const name = e => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) || e.className.split(' ')[0];
        const kids = [...plate.children].filter(e => !e.matches('.screw, .title, .rtitle, .pager, .ph-hide, .swipe-hint') && getComputedStyle(e).display !== 'none' && e.offsetWidth);
        for (const e of kids) {
          const b = e.getBoundingClientRect();
          if (b.left < pr.left - 2 || b.right > pr.right + 2 || b.top < pr.top - 2 || b.bottom > pr.bottom + 2) out.push(`"${name(e)}" runs off the plate`);
        }
        // Boxes, or circles for dials and round controls (a dial's box has 10 px around its bezel).
        const shape = e => {
          const r = e.getBoundingClientRect(), round = e.matches('.dialw, .round, .quantum, .knobw');
          return { r, round, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, rad: Math.min(r.width, r.height) / 2 - (e.matches('.dialw') ? 10 * scale : 0) };
        };
        const hit = (a, b) => {
          if (a.round && b.round) return Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.rad + b.rad - 2;
          if (a.round || b.round) {
            const [c, x] = a.round ? [a, b] : [b, a];
            const dx = Math.max(x.r.left - c.cx, 0, c.cx - x.r.right), dy = Math.max(x.r.top - c.cy, 0, c.cy - x.r.bottom);
            return Math.hypot(dx, dy) < c.rad - 2;
          }
          return Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 2 && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 2;
        };
        const shapes = kids.map(shape);
        kids.forEach((a, i) => kids.slice(i + 1).forEach((b, j) => { if (hit(shapes[i], shapes[i + 1 + j])) out.push(`"${name(a)}" and "${name(b)}" overlap`); }));
        for (const t of plate.querySelectorAll('*')) {
          if (t.closest('.ph-hide') || !t.offsetWidth || t.children.length || !t.textContent.trim()) continue;
          if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflow !== 'visible') out.push(`"${name(t)}" is cut off`);
        }
        out.push(...window.__textCheck(plate));
        for (const b of document.querySelectorAll('#ph-rail button')) if (b.scrollWidth > b.clientWidth + 1) out.push(`rail label "${b.textContent}" is cut off`);
        return { out, scale, view: document.body.dataset.phView };
      }, k);
      phoneViews++;
      phoneLow = Math.min(phoneLow, r.scale ?? 9);
      for (const o of r.out) problems.push(`phone ${tag} ${id} ${r.view || k}: ${o}`);
      if (r.scale < 0.45) problems.push(`phone ${tag} ${id} ${r.view}: shown at ${Math.round(r.scale * 100)} %`);
    }
  }
  // The device reopens on the view it showed last.
  await ph.evaluate(() => window.xfd.show('flight'));
  const last = await ph.evaluate(() => { const bs = document.querySelectorAll('#ph-rail button'); bs[bs.length - 1].click(); return document.body.dataset.phView; });
  await ph.reload();
  await ph.waitForSelector('body[data-ready]');
  await ph.evaluate(() => window.xfd.show('flight'));
  const back = await ph.evaluate(() => document.body.dataset.phView);
  if (back !== last) problems.push(`phone ${tag}: reopened on "${back}", not "${last}"`);
  // Docs shots: docs/phone-flight.png and phone-power.png (upright), phone-role.png (sideways).
  if (shots) {
    await ph.evaluate(() => window.xfd.show('light-fighter'));
    for (const view of tag === 'portrait' ? ['Flight', 'Power'] : ['Role']) {
      await ph.evaluate(v => [...document.querySelectorAll('#ph-rail button')].find(b => b.textContent === v)?.click(), view);
      await ph.waitForTimeout(200);
      await ph.screenshot({ path: join(shots, `phone-${view.toLowerCase()}.png`) });
    }
  }
  await ctx.close();
}
report.push(`phone views checked: ${phoneViews}, smallest ${Math.round(phoneLow * 100)} %`);
// Vibration. Android: a buzz per press, and Off stops it. iPhone: a control gets its invisible
// switch label on its first press and the press still sends its key. The Edge gets neither.
for (const kind of ['android', 'iphone']) {
  const ua = kind === 'iphone' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined;
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, userAgent: ua });
  const ph = await ctx.newPage();
  ph.on('pageerror', e => errors.push(`vibration ${kind}: ${e.message}`));
  await ph.addInitScript(kind => {
    window.__buzz = [];
    if (kind === 'iphone') { delete Navigator.prototype.vibrate; Object.defineProperty(HTMLInputElement.prototype, 'switch', { configurable: true, get() { return this.hasAttribute('switch'); } }); }
    else Navigator.prototype.vibrate = p => { window.__buzz.push(p); return true; };
  }, kind);
  await ph.route(/fleetyards|fltyrd/, r => r.abort());
  await ph.goto(base + '?phone&demo=ship');
  await ph.waitForSelector('body[data-ready]');
  await ph.evaluate(() => { window.xfd.show('flight'); [...document.querySelectorAll('#ph-rail button')].find(b => b.textContent === 'Power')?.click(); });
  const key = (await ph.evaluateHandle(() => [...document.querySelectorAll('#console .well.key')].find(w => { const b = w.getBoundingClientRect(); return !w.querySelector('button') && b.width > 30 && w.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }))).asElement();
  const press = async () => { const b = await key.boundingBox(); await ph.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await ph.waitForTimeout(80); };
  await ph.evaluate(() => { window.__keys = []; });
  await press(); await press();
  const r = await ph.evaluate(k => ({ keys: window.__keys.length, buzz: window.__buzz.length, labels: k.querySelectorAll(':scope > label.hx').length, on: document.body.classList.contains('hx-on') }), key);
  if (!r.keys) problems.push(`vibration ${kind}: pressing a key sent nothing (${JSON.stringify(r)})`);
  if (kind === 'android' && (r.buzz < 2 || r.labels)) problems.push(`vibration android: ${JSON.stringify(r)}`);
  if (kind === 'iphone' && (r.labels !== 1 || !r.on)) problems.push(`vibration iphone: ${JSON.stringify(r)}`);
  // This device's settings: Sound and Vibration, and Off stops it.
  await ph.evaluate(() => document.getElementById('ph-gear').click());
  const row = await ph.evaluate(() => !!document.querySelector('.ph-sheet .seg[data-seg=vibrate]'));
  if (!row) problems.push(`vibration ${kind}: no Vibration switch in the device's settings`);
  await ph.evaluate(() => { document.querySelector('.ph-sheet .seg[data-seg=vibrate] button[data-v=off]')?.click(); document.querySelector('.ph-sheet').hidden = true; window.__buzz = []; });
  await press();
  const off = await ph.evaluate(() => ({ buzz: window.__buzz.length, on: document.body.classList.contains('hx-on') }));
  if (off.buzz || off.on) problems.push(`vibration ${kind}: still on after Off (${JSON.stringify(off)})`);
  await ctx.close();
}
if (await page.evaluate(() => document.querySelectorAll('label.hx').length || document.body.classList.contains('hx-on'))) problems.push('the Edge got vibration labels');
// Sound: click sounds and alert sound off means silence, on the PC's screen and on a paired device.
for (const kind of ['edge', 'phone']) {
  const ctx = await browser.newContext(kind === 'phone' ? { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true } : { viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`sound ${kind}: ${e.message}`));
  await pg.addInitScript(() => {
    window.__tones = 0;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { window.__tones++; return make.call(this); };
  });
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + (kind === 'phone' ? '?phone&demo=ship' : '?demo=ship'));
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => { window.xfd.show('flight'); [...document.querySelectorAll('#ph-rail button')].find(b => b.textContent === 'Power')?.click(); });
  const noise = async () => {
    await pg.evaluate(() => { window.__tones = 0; window.__keys = []; });
    const b = await pg.evaluate(() => { const w = [...document.querySelectorAll('#console .well.key')].find(w => { const b = w.getBoundingClientRect(); return !w.querySelector('button') && b.width > 30 && w.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }); const r = w?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (!b) { problems.push(`sound ${kind}: no key to press`); return 0; }
    if (kind === 'phone') await pg.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await pg.evaluate(() => window.xfd.raise({ text: 'CrimeStat 1', tone: 'bad' }));
    await pg.waitForTimeout(80);
    return pg.evaluate(() => window.__tones);
  };
  if (!await noise()) problems.push(`sound ${kind}: no tone with sounds on, so the check below proves nothing`);
  if (kind === 'phone') {
    await pg.evaluate(() => document.getElementById('ph-gear').click());
    for (const seg of ['sound', 'alertSound']) {
      if (!await pg.evaluate(s => !!document.querySelector(`.ph-sheet .seg[data-seg=${s}]`), seg)) problems.push(`sound phone: no ${seg} switch in the device's settings`);
      await pg.evaluate(s => document.querySelector(`.ph-sheet .seg[data-seg=${s}] button[data-v=off]`)?.click(), seg);
    }
    await pg.evaluate(() => { document.querySelector('.ph-sheet').hidden = true; });
  } else {
    if (await pg.evaluate(() => document.querySelector('.opt[data-opt=alertSound]')?.closest('.pane')?.dataset.sec) !== 'feedback') problems.push('sound edge: Alert sound is not next to Click sounds');
    await pg.evaluate(() => { localStorage.setItem('xfd-sound', 'false'); localStorage.setItem('xfd-alertSound', 'false'); });
    await pg.reload();
    await pg.waitForSelector('body[data-ready]');
    await pg.evaluate(() => window.xfd.show('flight'));
  }
  const left = await noise();
  if (left) problems.push(`sound ${kind}: ${left} tones with click and alert sound off`);
  // Mute all alone: click and alert sound back on, still silent.
  if (kind === 'phone') {
    await pg.evaluate(() => document.getElementById('ph-gear').click());
    for (const [seg, v] of [['sound', 'on'], ['alertSound', 'on'], ['mute', 'on']]) await pg.evaluate(([s, v]) => document.querySelector(`.ph-sheet .seg[data-seg=${s}] button[data-v=${v}]`)?.click(), [seg, v]);
    await pg.evaluate(() => { document.querySelector('.ph-sheet').hidden = true; });
  } else {
    await pg.evaluate(() => { localStorage.setItem('xfd-sound', 'true'); localStorage.setItem('xfd-alertSound', 'true'); localStorage.setItem('xfd-mute', 'true'); });
    await pg.reload();
    await pg.waitForSelector('body[data-ready]');
    await pg.evaluate(() => window.xfd.show('flight'));
  }
  const muted = await noise();
  if (muted) problems.push(`sound ${kind}: ${muted} tones with Mute all on`);
  await ctx.close();
}
// Another computer or a tablet across: the whole console, not one plate at a time.
for (const [W, H] of [[1920, 1080], [1180, 820]]) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const big = await ctx.newPage();
  big.on('pageerror', e => errors.push(`device ${W}x${H}: ${e.message}`));
  await big.route(/fleetyards|fltyrd/, r => r.abort());
  await big.goto(base + '?phone&demo=ship');
  await big.waitForSelector('body[data-ready]');
  const r = await big.evaluate(() => {
    const plates = [document.getElementById('status'), ...document.querySelectorAll('#console > .plate')];
    return { whole: document.body.classList.contains('ph-whole'), shown: plates.filter(p => getComputedStyle(p).visibility === 'visible').length, all: plates.length,
      inside: plates.every(p => { const b = p.getBoundingClientRect(); return b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; }) };
  });
  if (!r.whole || r.shown !== r.all || !r.inside) problems.push(`device ${W}x${H}: whole console not shown (${JSON.stringify(r)})`);
  await ctx.close();
}

// The PC with a plate moved to a phone: the rest close up, the settings list shows the phones.
{
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pc = await ctx.newPage();
  pc.on('pageerror', e => errors.push(`phones on the PC: ${e.message}`));
  await pc.route(/fleetyards|fltyrd/, r => r.abort());
  await pc.addInitScript(() => {
    const now = Date.now() / 1000;
    window.xfdTestPhones = { enabled: true, url: 'http://192.168.1.20:47823', code: '482913', ttl: 96, qr: '<svg viewBox="0 0 1 1"></svg>', moved: ['role'],
      list: [{ id: 'a', name: 'iPhone', plate: 'role', mode: 'move', online: true, seen: now }, { id: 'b', name: 'Pixel', plate: 'swipe', mode: 'copy', online: false, seen: now - 7200 }] };
  });
  await pc.goto(base + '?demo=ship');
  await pc.waitForSelector('body[data-ready]');
  await pc.evaluate(() => document.fonts.ready);
  const m = await pc.evaluate(() => {
    const role = document.querySelector('#console > .plate[data-slot=role]');
    const rest = [...document.querySelectorAll('#console > .plate:not(.moved)')].map(p => p.getBoundingClientRect());
    return { hidden: !!role && getComputedStyle(role).display === 'none', right: Math.max(...rest.map(r => r.right)), fits: rest.every(r => r.right <= innerWidth + 1) };
  });
  if (!m.hidden) problems.push('a plate moved to a phone still shows on the PC');
  if (!m.fits) problems.push('with a plate moved, the rest run off the PC screen');
  await pc.evaluate(() => { document.getElementById('sheet').hidden = false; window.xfd.showSection('phones'); });
  await pc.waitForTimeout(200);
  const rows = await pc.evaluate(() => document.querySelectorAll('#ph-list .opt[data-id]').length);
  if (rows !== 2) problems.push(`Settings › Phones lists ${rows} phones, not 2`);
  const cut = await pc.evaluate(() => [...document.querySelectorAll('#ph-list button, #ph-list .txt')].filter(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth).map(b => b.textContent.trim()));
  for (const c of cut) problems.push(`Settings › Phones: "${c}" is cut off`);
  if (shots) await pc.screenshot({ path: join(shots, 'settings-phones.png') });
  await ctx.close();
}

// Your keys and plates: a key you swap in, a role module on another ship page, plates left out.
{
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`custom: ${e.message}`));
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('xfd-map:light-fighter:Noise', '"Scan mode"');
    localStorage.setItem('xfd-module:fighter', '"mining"');
  });
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => document.fonts.ready);
  await pg.evaluate(() => window.xfd.show('light-fighter'));
  const r = await pg.evaluate(() => ({
    mine: [...document.querySelectorAll('#console .well.key')].filter(e => e.querySelector('.mine')).map(e => e.querySelector('.lg').textContent),
    noise: [...document.querySelectorAll('#console .lg')].some(e => e.textContent === 'Noise'),
    module: document.querySelector('#console .plate[data-slot="role"] .rtitle small')?.textContent,
  }));
  if (r.mine.join() !== 'Scan mode' || r.noise) problems.push(`a swapped key shows ${JSON.stringify(r)}`);
  if (r.module !== 'Mining module') problems.push(`the role plate shows "${r.module}", not the mining module`);
  await checkLabels('your keys', false, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'custom-keys.png') });
  // Long-press the swapped key: the picker says what's stock and offers it back.
  const key = await pg.evaluateHandle(() => [...document.querySelectorAll('#console .well.key')].find(e => e.querySelector('.mine')));
  const b = await key.boundingBox();
  await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.waitForTimeout(800); await pg.mouse.up();
  const pick = await pg.evaluate(() => ({ open: !document.getElementById('picker').hidden, now: document.getElementById('pick-now').textContent, back: !document.getElementById('pick-clear').hidden }));
  if (!pick.open || !pick.now.includes('Stock: Noise') || !pick.back) problems.push(`the key picker shows ${JSON.stringify(pick)}`);
  await checkLabels('key picker', true, pg);
  await pg.evaluate(() => document.getElementById('pick-search').dispatchEvent(new PointerEvent('pointerup')));
  for (const c of 'SCAN') await pg.evaluate(c => [...document.querySelectorAll('#pick-kb button')].find(b => b.textContent === c).dispatchEvent(new PointerEvent('pointerup')), c);
  const hits = await pg.evaluate(() => [...document.querySelectorAll('#pick-grid .pick')].map(e => e.textContent.trim().toLowerCase()));
  if (!hits.includes('scan mode')) problems.push(`search for "scan" found ${hits.join(', ') || 'nothing'}`);
  if (shots) await pg.screenshot({ path: join(shots, 'picker-search.png') });
  // Two plates on a 4:3 screen: the rest leave and those two fill it.
  await pg.evaluate(() => { localStorage.setItem('xfd-plates', '["role","flight"]'); });
  await pg.setViewportSize({ width: 1280, height: 960 });
  await pg.reload(); await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => window.xfd.show('light-fighter'));
  const f = await pg.evaluate(() => {
    const vis = [...document.querySelectorAll('#console > .plate')].filter(p => getComputedStyle(p).display !== 'none').map(p => p.dataset.slot);
    const r = [...document.querySelectorAll('#console > .plate:not(.moved), #status')].map(p => p.getBoundingClientRect());
    return { vis, inside: r.every(b => b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1), width: Math.max(...r.map(b => b.right)) - Math.min(...r.map(b => b.left)) };
  });
  if (f.vis.join() !== 'role,flight') problems.push(`with two plates chosen, the screen shows ${f.vis.join(', ')}`);
  if (!f.inside || f.width < 1200) problems.push(`two chosen plates don't fill the screen (${JSON.stringify(f)})`);
  if (shots) await pg.screenshot({ path: join(shots, 'plates-two.png') });
  await ctx.close();
}

// A page of yours: stock plates and one of your own, drawn after the curated pages and
// without touching them. Keys the rules refuse (a guessed switch, an uncovered eject) aren't drawn.
{
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`page of yours: ${e.message}`));
  await pg.addInitScript(TEXT_CHECK);
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => document.fonts.ready);
  const before = await pg.evaluate(() => window.xfd.pages());
  const r = await pg.evaluate(() => {
    const saved = window.xfd.savePage({ id: 'my-test1', name: 'My Gladius', from: 'light-fighter', module: 'fighter', plates: [
      { stock: 'power' }, { stock: 'role' },
      { w: 612, title: 'Extras', add: [
        { t: 'switch', x: 32, y: 48, key: 'Lights' }, { t: 'switch', x: 128, y: 48, key: 'Ping' },
        { t: 'key', x: 240, y: 48, w: 160, h: 96, key: 'Ping' }, { t: 'key', x: 416, y: 48, w: 160, h: 96, key: 'Eject' },
        { t: 'screen', x: 32, y: 288, w: 544, h: 112, field: 'location' },
        { t: 'slide', x: 304, y: 432, w: 272, h: 96, key: 'Eject' },
      ] },
      { stock: 'gear' },
    ] });
    window.xfd.show('my-test1');
    const pl = [...document.querySelectorAll('#console > .plate')];
    const mine = document.querySelector('#console .plate[data-slot="mine2"]');
    return {
      kept: saved?.plates[2].add.map(i => `${i.t}:${i.key || i.field}`),
      slots: pl.map(p => `${p.dataset.slot}@${p.offsetLeft}`).join(),
      yours: !!document.querySelector('#console .rtitle small.yours'),
      extras: mine ? [...mine.children].filter(e => !e.matches('.screw, .title, .rtitle, .pager')).map(e => e.className.split(' ')[0]) : [],
    };
  });
  const after = await pg.evaluate(() => window.xfd.pages());
  if (after.slice(0, before.length).join() !== before.join() || after.at(-1) !== 'my-test1') problems.push(`saving a page changed the page list: ${after.join()}`);
  if (r.kept?.join() !== 'switch:Lights,key:Ping,screen:location,slide:Eject') problems.push(`a page of yours kept ${r.kept?.join()}`);
  if (r.slots !== 'power@382,role@838,mine2@1662,gear@2280') problems.push(`a page of yours lays out as ${r.slots}`);
  if (!r.yours) problems.push('a page of yours has no "Yours" tag');
  if (r.extras.length !== 4) problems.push(`a plate of yours shows ${r.extras.join(', ')}`);
  await checkLabels('a page of yours', false, pg);
  for (const t of await pg.evaluate(() => [...document.querySelectorAll('#console .plate')].flatMap(p => window.__textCheck?.(p) || []))) problems.push(`a page of yours: ${t}`);
  if (shots) await pg.screenshot({ path: join(shots, 'my-page.png') });
  // Deleting it leaves the curated pages as they were.
  await pg.evaluate(() => window.xfd.deletePage('my-test1'));
  if ((await pg.evaluate(() => window.xfd.pages())).join() !== before.join()) problems.push('deleting a page of yours left the page list changed');
  await ctx.close();
}

// The page editor: New blank page from arrange mode, a control dragged from the palette, its key
// picked (the picker refuses what a switch can't take), Try it sends nothing, Done saves.
{
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`page editor: ${e.message}`));
  await pg.addInitScript(TEXT_CHECK);
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => document.fonts.ready);
  await pg.evaluate(() => window.xfd.show('light-fighter'));
  const press = async sel => { const b = await (await pg.$(sel)).boundingBox(); await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.mouse.up(); };
  const t = await (await pg.$('#console .plate[data-slot="role"] .rtitle')).boundingBox();
  await pg.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up();
  const bar = await pg.evaluate(() => [...document.querySelectorAll('.arrange-bar button')].map(b => b.textContent));
  if (!bar.includes('New blank page') || !bar.includes('Duplicate & edit')) problems.push(`arrange mode offers ${bar.join(', ')}`);
  await press('.arrange-bar [data-a="new"]');
  if (!(await pg.evaluate(() => window.xfd.editing()))) problems.push('New blank page did not open the editor');
  if (shots) await pg.screenshot({ path: join(shots, 'editor.png') });
  const drop = async (name, x, y) => {
    const tile = await (await pg.$(`.ed-tile[data-name="${name}"]`)).boundingBox();
    const pl = await (await pg.$('#console > .plate')).boundingBox();
    await pg.mouse.move(tile.x + 20, tile.y + 20); await pg.mouse.down();
    await pg.mouse.move(pl.x + x, pl.y + y, { steps: 6 }); await pg.mouse.up();
  };
  // A switch: keys without a set-on / set-off pair are refused, Lights isn't.
  await drop('On / off switch', 120, 240);
  const sw = await pg.evaluate(() => {
    const tiles = [...document.querySelectorAll('#pick-grid .pick')];
    return { open: !document.getElementById('picker').hidden, refused: tiles.filter(e => e.classList.contains('no')).length, ok: tiles.filter(e => !e.classList.contains('no')).length };
  });
  if (!sw.open || !sw.refused) problems.push(`a new switch's picker shows ${JSON.stringify(sw)}`);
  await pg.evaluate(() => [...document.querySelectorAll('#pick-tabs .tab')].find(t => t.dataset.g === 'systems').dispatchEvent(new PointerEvent('pointerup')));
  await checkLabels('switch picker', true, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'editor-switch-picker.png') });
  await press('#pick-grid .pick:not(.no)');
  // A keycap beside it.
  await drop('Wide key', 400, 240);
  await press('#pick-grid .pick:not(.no)');
  // A sequence: the picker asks for step 1, then step 2; a toggle with a set pair is refused.
  await drop('Sequence', 400, 400);
  const seqPick = await pg.evaluate(() => ({ title: document.getElementById('pick-title').textContent }));
  if (!/step 1/.test(seqPick.title)) problems.push(`a new sequence's picker shows ${JSON.stringify(seqPick)}`);
  await pg.evaluate(() => [...document.querySelectorAll('#pick-tabs .tab')].find(t => t.dataset.g === 'flight').dispatchEvent(new PointerEvent('pointerup')));
  await press('#pick-grid .pick:not(.no)');
  await pg.waitForTimeout(100);
  if (!/step 2/.test(await pg.evaluate(() => document.getElementById('pick-title').textContent))) problems.push('a sequence does not ask for its second step');
  await pg.evaluate(() => [...document.querySelectorAll('#pick-tabs .tab')].find(t => t.dataset.g === 'flight').dispatchEvent(new PointerEvent('pointerup')));
  await press('#pick-grid .pick:not(.no)');
  await pg.waitForTimeout(100);
  const seqCard = await pg.evaluate(() => [...document.querySelectorAll('.ed-card .ed-row small')].map(s => s.textContent));
  if (!seqCard.includes('Step 1') || !seqCard.includes('Step 2') || !seqCard.includes('Between steps')) problems.push(`a sequence's card shows ${seqCard.join(', ')}`);
  if (shots) await pg.screenshot({ path: join(shots, 'editor-sequence.png') });
  const saved0 = await pg.evaluate(() => JSON.parse(localStorage.getItem('xfd-pages'))[0].plates[0].add.length);
  // Try it: a press lights up but sends nothing.
  await press('.ed-bar [data-a="try"]');
  await press('#console [data-add="1"]');
  await press('.ed-bar [data-a="try"]');
  await press('.ed-bar [data-a="done"]');
  const r = await pg.evaluate(() => ({ editing: window.xfd.editing(), items: window.xfd.myPages()[0]?.plates[0].add.map(i => i.t), note: document.querySelector('.ed-note')?.textContent }));
  if (r.editing || r.items?.join() !== 'switch,key,seq') problems.push(`after Done the editor shows ${JSON.stringify(r)}`);
  // The sequence sends its two keys, one after the other.
  const sent0 = await pg.evaluate(() => (window.__keys || []).length);
  await press('#console [data-add="2"]');
  await pg.waitForTimeout(800);
  const seqSent = await pg.evaluate(n => (window.__keys || []).slice(n).filter(k => k.spec).length, sent0);
  if (seqSent !== 2) problems.push(`a sequence sent ${seqSent} keys, not 2`);
  if (saved0) problems.push('the page was saved before Done');
  await checkLabels('a page from the editor', false, pg);
  for (const x of await pg.evaluate(() => [...document.querySelectorAll('#console .plate')].flatMap(p => window.__textCheck(p)))) problems.push(`a page from the editor: ${x}`);
  if (shots) await pg.screenshot({ path: join(shots, 'editor-saved.png') });
  await ctx.close();
}

// Pages of yours across screens and files: Use for links ships, the phone preview folds a plate,
// a page file imports as a new page, and pages saved or edited on a Device reach this screen.
{
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`pages across screens: ${e.message}`));
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.addInitScript(() => { window.xfdTestPageFiles = [['Shared Cutlass.json', JSON.stringify({ app: 'edge-cockpit', kind: 'page', format: 1, page: { id: 'my-zzzz9', name: 'Shared Cutlass', ships: ['DRAK_Cutlass'], plates: [{ w: 450, title: 'Extras', add: [{ t: 'key', x: 32, y: 64, w: 160, h: 96, key: 'Ping' }] }] } })], ['broken.json', '{']]; });
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => { window.xfd.savePage({ id: 'my-glad1', name: 'My Gladius', from: 'light-fighter', plates: [{ stock: 'power' }, { stock: 'role' }, { stock: 'flight' }, { stock: 'gear' }] }); window.xfd.edit('my-glad1'); });
  const r = await (await pg.$('#console > .plate[data-slot="role"]')).boundingBox();
  await pg.mouse.click(r.x + 400, r.y + 690);
  await pg.click('.ed-bar [data-a="phone"]');
  const views = await pg.evaluate(() => document.querySelectorAll('.ed-ph-rail button').length);
  if (views < 1) problems.push('the phone preview shows no views');
  if (shots) await pg.screenshot({ path: join(shots, 'editor-phone.png') });
  await pg.click('.ed-bar [data-a="phone"]');
  await pg.click('.ed-bar [data-a="ships"]');
  const groups = await pg.evaluate(() => [...document.querySelectorAll('.ed-groups button')].map(b => b.textContent));
  if (new Set(groups).size !== groups.length || !groups.length) problems.push(`Use for groups ships as ${groups.join(', ')}`);
  await pg.evaluate(() => document.querySelector('.ed-shiplist button').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  if (shots) await pg.screenshot({ path: join(shots, 'editor-use-for.png') });
  await pg.evaluate(() => document.querySelector('.ed-ships [data-close]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  await pg.click('.ed-bar [data-a="done"]');
  const linked = await pg.evaluate(() => window.xfd.myPages()[0].ships.length);
  if (linked !== 1) problems.push(`Use for linked ${linked} ships`);
  // Import: the readable file becomes a new page of yours, without its ships.
  await pg.evaluate(() => window.xfd.show('light-fighter'));
  const t = await (await pg.$('#console .plate[data-slot="role"] .rtitle')).boundingBox();
  await pg.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await pg.mouse.down(); await pg.waitForTimeout(700); await pg.mouse.up();
  await pg.click('.arrange-bar [data-a="import"]');
  const offered = await pg.evaluate(() => document.querySelectorAll('#pick-grid .pick').length);
  if (offered !== 1) problems.push(`Import offers ${offered} pages`);
  await checkLabels('import a page', true, pg);
  await pg.click('#pick-grid .pick');
  await pg.click('.ed-bar [data-a="done"]');
  const imp = await pg.evaluate(() => window.xfd.myPages().find(p => p.name === 'Shared Cutlass'));
  if (!imp || imp.id === 'my-zzzz9' || imp.ships.length) problems.push(`the imported page came in as ${JSON.stringify(imp && { id: imp.id, ships: imp.ships })}`);
  // A Device saves a page, shows a live edit, then deletes the page.
  await pg.evaluate(() => window.xfd.shared({ pages: { 'my-dev01': { id: 'my-dev01', name: 'From a tablet', plates: [{ w: 450, add: [] }] } } }));
  const stored = await pg.evaluate(() => JSON.parse(localStorage.getItem('xfd-pages')).map(p => p.id));
  if (!stored.includes('my-dev01')) problems.push('a page saved on a Device was not kept');
  await pg.evaluate(() => { window.xfd.show('my-glad1'); window.xfd.shared({ preview: { id: 'my-glad1', name: 'My Gladius', plates: [{ stock: 'power' }] } }); });
  const live = await pg.evaluate(() => document.querySelectorAll('#console > .plate').length);
  await pg.evaluate(() => window.xfd.shared({ preview: null }));
  const back = await pg.evaluate(() => document.querySelectorAll('#console > .plate').length);
  if (live !== 1 || back !== 4) problems.push(`a Device's live edit showed ${live} plates, then ${back}`);
  await pg.evaluate(() => window.xfd.shared({ pages: { 'my-dev01': null } }));
  if ((await pg.evaluate(() => window.xfd.pages())).includes('my-dev01')) problems.push('a page deleted on a Device stayed');
  await ctx.close();
}

// The game link: a real Prospector frame (5.0 PTU). Switches show where the ship is, push-buttons
// the game reports get a lamp, the status shows the game's instruments; Classic and a dropped link
// take it all back, and presses go through the game when it takes the action.
{
  const U = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry-prospector.json'), 'utf8'));
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push('telemetry: ' + e.message));
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.waitForTimeout(300);
  await pg.evaluate(() => window.xfd.feed(["CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'MISC_Prospector_877602860529' [877602860529]"]));
  await pg.evaluate(() => window.xfd.show('mining'));
  const sw = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#console .tgl.dual')].map(e => [e.querySelector('.placard').textContent.trim(), e.classList.contains('on') ? 'on' : e.classList.contains('off') ? 'off' : '-'])));
  const before = await sw();
  if (Object.values(before).some(v => v !== '-')) problems.push(`telemetry: switches show a side before the game said: ${JSON.stringify(before)}`);
  await pg.evaluate(u => window.xfd.telemetry(u), U);
  await pg.waitForTimeout(100);
  const after = await sw();
  const want = { Power: 'on', Thrusters: 'off', Shields: 'on', Weapons: 'on' };
  for (const [k, v] of Object.entries(want)) if (after[k] !== v) problems.push(`telemetry: ${k} shows ${after[k]}, the game said ${v}`);
  const st = await pg.evaluate(() => ({
    gear: document.querySelector('#console .gear').classList.contains('on'),
    ann: document.querySelectorAll('#tlm .ann b').length, amber: document.querySelector('#tlm .ann b.m')?.textContent,
    decoy: document.querySelector('#console [data-k="Decoy"] .cnt')?.textContent, noise: document.querySelector('#console [data-k="Noise"] .cnt')?.textContent,
    role: document.getElementById('ship-role').textContent, chip: !document.getElementById('tele-chip').hidden,
  }));
  if (!st.gear || st.ann !== 1 || st.amber !== 'Shields' || st.decoy !== '48' || st.noise !== '5' || !/Pilot seat · Landed · SCM spooled/.test(st.role) || !st.chip)
    problems.push(`telemetry status: ${JSON.stringify(st)}`);
  await checkLabels('telemetry mining', false, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'telemetry-mining.png') });
  await pg.evaluate(() => window.xfd.show('flight'));
  const fl = await pg.evaluate(() => ({
    esp: document.querySelector('#console [data-k="ESP"] .lvt')?.textContent,
    locks: [...document.querySelectorAll('#console .tgl.dual')].find(e => /door locks/i.test(e.textContent))?.className,
  }));
  if (fl.esp !== 'OFF') problems.push(`telemetry: ESP lamp reads ${fl.esp}`);
  // A key with no keyboard bind still works when the game takes its action: GAME on the cap, not unbound.
  const noEsp = `<ActionMaps><ActionProfiles profileName="default"><actionmap name="spaceship_movement"><action name="v_ifcs_toggle_esp"><rebind input="kb1_ "/></action></actionmap></ActionProfiles></ActionMaps>`;
  const gb = await pg.evaluate(async xml => { window.xfdTestBinds = xml; await window.xfd.reloadBinds(); const h = window.xfd.bindHealth(); return { game: h.game, missing: h.missing, kb: document.querySelector('#console [data-k="ESP"] .kb')?.textContent, chip: !document.getElementById('binds-chip').hidden }; }, noEsp);
  if (!gb.game.includes('ESP') || gb.missing.includes('ESP') || gb.kb !== 'GAME' || gb.chip) problems.push(`telemetry: an unbound key the game takes: ${JSON.stringify(gb)}`);
  await pg.evaluate(async () => { window.xfdTestBinds = null; await window.xfd.reloadBinds(); });
  if (fl.locks && /\b(on|off)\b/.test(fl.locks)) problems.push('telemetry: door locks show a side the game never sent');
  await checkLabels('telemetry flight', false, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'telemetry-flight.png') });
  await pg.evaluate(() => window.xfd.show('light-fighter'));
  const gp = await pg.evaluate(() => document.querySelector('#console .guns-placard')?.textContent);
  if (gp !== 'Guns 2/2 ready') problems.push(`telemetry: gun placard reads ${gp}`);
  await checkLabels('telemetry fighter', false, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'telemetry-fighter.png') });
  // Presses: through the game when it takes the action, the key when it refuses.
  await pg.evaluate(() => { window.__keys = []; window.__acts = []; window.xfdTestAction = a => { window.__acts.push(a); return window.__answer; }; window.__answer = 'ok'; window.xfd.show('flight'); });
  const press = async sel => { const b = await (await pg.$(sel)).boundingBox(); await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await pg.waitForTimeout(400); };
  await press('#console [data-k="ESP"] .cap');
  let r = await pg.evaluate(() => ({ acts: window.__acts.slice(), keys: window.__keys.length }));
  if (r.acts.join() !== 'v_ifcs_toggle_esp' || r.keys !== 0) problems.push(`telemetry: ESP through the game sent ${JSON.stringify(r)}`);
  await pg.evaluate(() => { window.__answer = 'filtered'; window.__acts = []; window.__keys = []; });
  await press('#console [data-k="ESP"] .cap');
  r = await pg.evaluate(() => ({ acts: window.__acts.slice(), keys: window.__keys.length }));
  if (r.acts.length !== 1 || r.keys !== 1) problems.push(`telemetry: a refused ESP did not fall back to the key: ${JSON.stringify(r)}`);
  // On foot: vitals.
  const foot = structuredClone(U); foot.live.vehicle = null; foot.live.weapons = null; foot.live.actor.state.locomotion = 1;
  await pg.evaluate(u => { window.xfd.feed(['<Context Establisher Done>', 'Entering Armistice Zone']); window.xfd.telemetry(u); window.xfd.show('onfoot'); }, foot);
  await pg.waitForTimeout(100);
  const vit = await pg.evaluate(() => [...document.querySelectorAll('#tlm .vit span')].map(s => { let e = s.nextElementSibling; while (e && e.tagName !== 'EM') e = e.nextElementSibling; return s.textContent + (e?.textContent || '').replace(/\s+/g, ''); }));
  if (vit.length !== 8 || !vit.includes('Hunger73%')) problems.push(`telemetry vitals: ${JSON.stringify(vit)}`);
  // With a mission, a location with its system map and an injury, the card still ends above its edge.
  await pg.evaluate(() => window.xfd.feed(['<RequestLocationInventory> Player[Argoneth] requested inventory for Location[Stanton4_NewBabbage]']));
  await pg.waitForTimeout(150);
  const card = await pg.evaluate(() => { const m = document.getElementById('mfd').getBoundingClientRect(); return { over: [...document.querySelectorAll('#mfd .facts *')].filter(e => { const b = e.getBoundingClientRect(); return b.height && b.bottom > m.bottom; }).map(e => e.id || e.className), follow: !document.getElementById('auto').hidden }; });
  if (card.over.length || !card.follow) problems.push(`telemetry on foot: the status card runs past its edge: ${JSON.stringify(card)}`);
  await checkLabels('telemetry on foot', false, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'telemetry-onfoot.png') });
  // Classic, then a dropped link: back to the console without telemetry.
  await pg.evaluate(u => { window.xfd.feed(["CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'MISC_Prospector_877602860529' [877602860529]"]); window.xfd.telemetry(u); window.xfd.show('mining'); }, U);
  await pg.evaluate(() => { document.getElementById('sheet').hidden = false; window.xfd.showSection('link'); });
  await pg.waitForTimeout(100);
  await checkLabels('settings game link', true, pg);
  if (shots) await pg.screenshot({ path: join(shots, 'settings-link.png') });
  // On for 4.10 and LIVE, but a PTU folder came later: the button turns on the rest, not off.
  const part = await pg.evaluate(async () => {
    window.xfdTestTelemetrySetup = { env: true, channels: [['LIVE', true], ['PTU', false]] };
    window.xfd.showSection('link'); await new Promise(r => setTimeout(r, 100));
    const out = [document.getElementById('tele-act').textContent, document.getElementById('tele-act-note').textContent];
    window.xfdTestTelemetrySetup = null; window.xfd.showSection('link'); await new Promise(r => setTimeout(r, 100));
    return out;
  });
  if (part[0] !== 'Turn telemetry on' || !/Not yet in PTU's user\.cfg/.test(part[1])) problems.push(`telemetry: partly on reads ${JSON.stringify(part)}`);
  await pg.click('#layout-seg [data-v="classic"]');
  await pg.evaluate(() => { document.getElementById('sheet').hidden = true; });
  const classic = await sw();
  if (Object.values(classic).some(v => v !== '-') || await pg.$('#tlm')) problems.push(`telemetry: Classic still shows the game's state ${JSON.stringify(classic)}`);
  await pg.evaluate(() => { document.getElementById('sheet').hidden = false; window.xfd.showSection('link'); });
  await pg.click('#layout-seg [data-v="telemetry"]');
  await pg.evaluate(() => { document.getElementById('sheet').hidden = true; });
  await pg.evaluate(u => window.xfd.telemetry({ ...u, link: 'off', actions: [], live: { vehicle: null, weapons: null, actor: null } }), U);
  const dropped = await sw();
  if (Object.values(dropped).some(v => v !== '-') || await pg.$('#tlm')) problems.push(`telemetry: a dropped link left ${JSON.stringify(dropped)}`);
  const chip = () => pg.evaluate(() => { const c = document.getElementById('tele-chip'); return c.hidden ? null : c.textContent.trim(); });
  if (await chip()) problems.push(`telemetry: the link chip shows with telemetry off and not turned on: ${await chip()}`);
  // The game answers before your character spawns: linked, with nothing claimed yet.
  await pg.evaluate(u => window.xfd.telemetry({ ...u, link: 'linked', live: { vehicle: null, weapons: null, actor: null } }), U);
  const linked = await sw();
  if (await chip() !== 'Telemetry linked · waiting for spawn' || Object.values(linked).some(v => v !== '-')) problems.push(`telemetry: linked shows ${await chip()} ${JSON.stringify(linked)}`);
  // A real 4.10.3 LIVE frame (RSI Galaxy, flying): no shields, hull, master mode or vertical speed,
  // so the status shows only what came.
  const G = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry-galaxy-410.json'), 'utf8'));
  await pg.evaluate(() => window.xfd.feed(["CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'RSI_Galaxy_929237689784' [929237689784]"]));
  await pg.evaluate(u => window.xfd.telemetry(u), G);
  await pg.evaluate(() => window.xfd.show('flight'));
  await pg.waitForTimeout(100);
  const g410 = await pg.evaluate(() => ({ text: document.getElementById('tlm')?.innerText.replace(/\s+/g, ' '), chip: document.getElementById('tele-chip').textContent.trim() }));
  if (!/BOOST 100%/i.test(g410.text) || /shields|hull|vertical|radar/i.test(g410.text) || !/Speed 339 m\/s/i.test(g410.text) || g410.chip !== 'Telemetry live')
    problems.push(`telemetry 4.10: ${JSON.stringify(g410)}`);
  if (shots) await pg.screenshot({ path: join(shots, 'telemetry-410.png') });
  // Updates arrive ten times a second: the chip keeps the room the status screen gave it, or it blinks.
  const keeps = await pg.evaluate(u => { const c = document.getElementById('tele-chip'); c.classList.add('squeezed'); window.xfd.telemetry(u); window.xfd.telemetry(u); const kept = c.classList.contains('squeezed'); c.classList.remove('squeezed'); return kept; }, G);
  if (!keeps) problems.push('telemetry: an update undoes the chip squeeze, so it blinks');
  await ctx.close();
}

// Follow game, pilot seat: Approach opens at takeoff and hands the page back once clear of the
// ground; a page picked in between stays.
{
  const P = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'telemetry-prospector.json'), 'utf8'));
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push('auto Approach: ' + e.message));
  await pg.route(/fleetyards|fltyrd/, r => r.abort());
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => window.xfd.feed(["CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'MISC_Prospector_877602860529' [877602860529]"]));
  const at = (landed, gear, ralt, vsi) => { const u = structuredClone(P); Object.assign(u.live.vehicle.flight.state, { is_landed: landed, gear }); Object.assign(u.live.vehicle.flight.instruments, { radar_altitude: ralt, vertical_speed_indicator: vsi }); return u; };
  const send = (u, n = 1) => pg.evaluate(([u, n]) => { for (let i = 0; i < n; i++) window.xfd.telemetry(u); }, [u, n]);
  await send(at(true, 3, 4.4, 0.001));
  const start = await pg.evaluate(() => window.xfd.current());
  await send(at(false, 3, 25, 6));
  const up = await pg.evaluate(() => window.xfd.current());
  await send(at(false, 1, 600, 4));
  await pg.waitForTimeout(5300);
  await send(at(false, 1, 620, 2));
  const back = await pg.evaluate(() => window.xfd.current());
  if (up !== 'tl-approach' || back !== start) problems.push(`auto Approach: takeoff went ${start} → ${up} → ${back}`);
  // Coming in to land, then picking Systems: Systems stays after touchdown.
  await send(at(false, 1, 350, -6)); await send(at(false, 2, 250, -6));
  const down = await pg.evaluate(() => window.xfd.current());
  await pg.evaluate(() => window.xfd.show('tl-systems'));
  await send(at(true, 3, 4.4, 0)); await pg.waitForTimeout(5300); await send(at(true, 3, 4.4, 0));
  const kept = await pg.evaluate(() => window.xfd.current());
  if (down !== 'tl-approach' || kept !== 'tl-systems') problems.push(`auto Approach: landing went ${down}, then a picked page became ${kept}`);
  await ctx.close();
}

// The Ship page's 3D model loads under the app's own content policy (the one Tauri serves), says
// what went wrong when it can't, asks FleetYards once rather than on every telemetry update, and
// loads after Retry.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const G = JSON.parse(await readFile(join(here, 'fixtures', 'telemetry-galaxy-410.json'), 'utf8'));
  const csp = JSON.parse(await readFile(join(here, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp;
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push('3D ship: ' + e.message));
  await pg.addInitScript(() => { window.__csp = []; addEventListener('securitypolicyviolation', e => window.__csp.push(e.blockedURI + ' ' + e.violatedDirective)); });
  await pg.route(base.replace('index.html', '**'), async r => {
    const res = await r.fetch();
    r.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
  });
  // A one-triangle model with an embedded texture: the same path as FleetYards' files (a binary glTF
  // whose images live inside it), without the network.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const pos = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), uv = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
  const pad = (b, f) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4, f)]);
  const bin = pad(Buffer.concat([pos, uv, png]), 0);
  const gltf = pad(Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }], textures: [{ source: 0 }],
    images: [{ bufferView: 2, mimeType: 'image/png' }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: png.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
  })), 0x20);
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + gltf.length + 8 + bin.length, 8); head.writeUInt32LE(gltf.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(bin.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([head, gltf, binHead, bin]);
  let answer = 404, asked = 0;
  const cors = { 'access-control-allow-origin': '*' };
  await pg.route(/fleetyards|fltyrd/, r => {
    const u = r.request().url();
    if (/\/v1\/models\/[^/?]+$/.test(u)) return r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ slug: 'test', name: 'Galaxy', manufacturer: { name: 'Roberts Space Industries' }, media: { holoTexturedLite: { url: 'https://storage.fltyrd.net/test.glb' } } }) });
    if (u.endsWith('/test.glb')) { asked++; return answer === 200 ? r.fulfill({ contentType: 'model/gltf-binary', headers: cors, body: glb }) : r.fulfill({ status: answer, headers: cors, body: '' }); }
    return r.abort();
  });
  await pg.goto(base + '?demo=ship');
  await pg.waitForSelector('body[data-ready]');
  await pg.evaluate(() => window.xfd.feed(["CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'RSI_Galaxy_929237689784' [929237689784]"]));
  const feed = async n => { for (let i = 0; i < n; i++) { await pg.evaluate(u => window.xfd.telemetry(u), G); await pg.waitForTimeout(150); } };
  await feed(2);
  await pg.evaluate(() => window.xfd.show('tl-ship'));
  await feed(12);
  const failed = await pg.$eval('.s3', e => ({ msg: e.querySelector('.s3-msg').textContent, retry: getComputedStyle(e.querySelector('.s3-retry') || e).display }));
  if (!/error 404/.test(failed.msg) || failed.retry !== 'block') problems.push(`3D ship: a missing model says ${JSON.stringify(failed)}`);
  if (asked !== 1) problems.push(`3D ship: a failed model was asked for ${asked} times, not once`);
  answer = 200;
  await pg.click('.s3-retry', { timeout: 2000 }).catch(() => problems.push('3D ship: no Retry to press'));
  await feed(12);
  const ok = await pg.$eval('.s3', e => ({ state: e.dataset.state, fail: e.hasAttribute('data-fail'), csp: window.__csp }));
  if (ok.state || ok.fail || ok.csp.length) problems.push(`3D ship: after Retry under the app's content policy: ${JSON.stringify(ok)}`);
  await ctx.close();
}

const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);

report.push(`pages checked: ${ids.length}`, `slowest first build: ${worstBuild.toFixed(1)} ms (budget ${BUDGET.firstBuildMs})`,
  `slowest page switch: ${worstSwitch.toFixed(1)} ms (budget ${BUDGET.switchMs})`, `touch to key: ${touch?.toFixed(2)} ms (budget ${BUDGET.touchToKeyMs})`,
  `elements: ${nodes} (budget ${BUDGET.nodes})`, `JS heap: ${(heap / 1048576).toFixed(1)} MB`, 'idle: 0 animation frames, 0 running animations');
if (worstBuild > BUDGET.firstBuildMs) problems.push(`a page took ${worstBuild.toFixed(0)} ms to build`);
if (worstSwitch > BUDGET.switchMs) problems.push(`a page switch took ${worstSwitch.toFixed(0)} ms`);
if (touch === null || touch > BUDGET.touchToKeyMs) problems.push(`touch to key took ${touch} ms`);
if (nodes > BUDGET.nodes) problems.push(`${nodes} elements on the page`);
for (const e of errors) problems.push(`script error: ${e}`);

await browser.close();
server.close();
console.log(report.join('\n'));
if (problems.length) {
  console.error(`\n${problems.length} problems:\n` + problems.map(p => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('\nUI OK');
