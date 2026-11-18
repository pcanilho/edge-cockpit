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
// No network in the test: ship outlines fall back to the role badge.
await page.route(/fleetyards|fltyrd/, r => r.abort());

const problems = [];
const report = [];
if (shots) await mkdir(shots, { recursive: true });

async function checkLabels(where, sheet = false) {
  const found = await page.evaluate(sheet => {
    const out = [];
    const FRAMES = '.su-row, .su-foot, .su-card, .cap, .placard, .screen, .rbtn, .qbtn, .corner, .chip, .under, .cover, .chan, .softkeys .well, .opt, .act, .plate, .updates, .tab, .tabs, .pane, .wd-card';
    const inside = (r, f, m = -1) => r.left >= f.left + m && r.right <= f.right - m && r.top >= f.top + m && r.bottom <= f.bottom - m;
    const visible = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || e.hidden) return false; } return true; };
    const walker = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      const el = n.parentElement;
      if (!text || !visible(el) || !!el.closest('.sheet') !== sheet || el.closest('.toast, .banner')) continue;
      if (getComputedStyle(el).textOverflow === 'ellipsis') out.push(`${text}: ellipsis`);
      const range = document.createRange(); range.selectNodeContents(n);
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

// The World page's prices and server status, as the app's Rust side hands them over.
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
await page.addInitScript(TEXT_CHECK);
await page.addInitScript(m => { window.xfdTestWorld = { prices: m, status: { fetched: Date.now(), summary: 'disrupted', services: [{ name: 'Platform', status: 'operational' }, { name: 'Persistent Universe', status: 'disrupted' }, { name: 'Arena Commander', status: 'operational' }] } }; }, MARKET);

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

// World: every view of the market fits; the hangar shows no time until synced, then the right lights;
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

// A profile carries the player's keyboard binds as a Control Profile the game can load.
const profileXml = await page.evaluate(() => window.xfd.bindsProfile(`<ActionMaps><ActionProfiles profileName="default">
  <actionmap name="spaceship_movement"><action name="v_vtol_toggle"><rebind input="js1_button3"/><rebind input="kb1_n"/></action>
  <action name="v_autoland"><rebind input="js1_button4"/></action></actionmap></ActionProfiles></ActionMaps>`));
if (!/<actionmap name="spaceship_movement">\s*<action name="v_vtol_toggle">\s*<rebind input="kb1_n"\/>/.test(profileXml || '') || /js1_|v_autoland/.test(profileXml))
  problems.push(`profile binds are wrong:\n${profileXml}`);

// Settings, with release notes showing.
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
const late = new Date().getHours() >= 20 || new Date().getHours() < 7;
if (!night.on.dim || night.on.cur !== 'on') problems.push(`night mode On does not dim: ${JSON.stringify(night.on)}`);
if (night.auto.dim !== late || !/20:00 to 07:00/.test(night.auto.note)) problems.push(`night mode Auto is wrong: ${JSON.stringify(night.auto)}`);
if (night.off.dim || night.off.cur !== 'off') problems.push(`night mode Off still dims: ${JSON.stringify(night.off)}`);
await page.evaluate(() => { document.getElementById('sheet').hidden = true; });

// The setup check: four rows, the touch warning from the displays above, nothing cut off.
await page.evaluate(() => window.xfd.setup());
await page.waitForTimeout(150);
const setup = await page.evaluate(() => [...document.querySelectorAll('#su-rows .su-row')].map(r => r.className.replace('su-row ', '') + ':' + r.querySelector('b').textContent));
if (setup.length !== 4 || setup[0] !== 'warn:Touches land on another display' || !setup[3].startsWith('unknown:')) problems.push(`setup check is wrong: ${JSON.stringify(setup)}`);
await checkLabels('setup check');
if (shots) await page.screenshot({ path: join(shots, 'setup.png') });
await page.click('#su-done');
if (!(await page.evaluate(() => document.getElementById('setup').hidden))) problems.push('Done does not close the setup check');

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
  await ph.addInitScript(m => { window.xfdTestWorld = { prices: m, status: { fetched: Date.now(), summary: 'ok', services: [] } }; }, MARKET);
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
  await checkLabels('your keys');
  if (shots) await pg.screenshot({ path: join(shots, 'custom-keys.png') });
  // Long-press the swapped key: the picker says what's stock and offers it back.
  const key = await pg.evaluateHandle(() => [...document.querySelectorAll('#console .well.key')].find(e => e.querySelector('.mine')));
  const b = await key.boundingBox();
  await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await pg.mouse.down(); await pg.waitForTimeout(800); await pg.mouse.up();
  const pick = await pg.evaluate(() => ({ open: !document.getElementById('picker').hidden, now: document.getElementById('pick-now').textContent, back: !document.getElementById('pick-clear').hidden }));
  if (!pick.open || !pick.now.includes('Stock: Noise') || !pick.back) problems.push(`the key picker shows ${JSON.stringify(pick)}`);
  await checkLabels('key picker', true);
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
