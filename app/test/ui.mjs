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
    const FRAMES = '.cap, .placard, .screen, .rbtn, .qbtn, .corner, .chip, .under, .cover, .chan, .softkeys .well, .opt, .act, .plate, .updates, .tab, .tabs, .pane';
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
  if (shots) await page.screenshot({ path: join(shots, `${id}.png`) });
}
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

// A rearranged console: plates in reverse order still fit, labels and all.
await page.evaluate(() => { localStorage.setItem('xfd-order:fighter', JSON.stringify(['gear', 'flight', 'role', 'power'])); window.xfd.show('mining'); window.xfd.show('light-fighter'); });
await checkLabels('light-fighter rearranged');
const slots = await page.evaluate(() => [...document.querySelectorAll('#console .plate[data-slot]')].sort((a, b) => a.offsetLeft - b.offsetLeft).map(p => p.dataset.slot).join());
if (slots !== 'gear,flight,role,power') problems.push(`rearranged plates came out as ${slots}`);
const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#console .plate')].map(p => p.getBoundingClientRect().right)));
if (right > 2560) problems.push(`rearranged plates run off screen (${right})`);
await page.evaluate(() => { localStorage.removeItem('xfd-order:fighter'); window.xfd.show('mining'); });

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
