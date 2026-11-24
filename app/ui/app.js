// Edge Cockpit: builds the cockpit console, turns touches into key presses and
// follows Game.log for the status display, the moods and the pages.
import { GLYPHS } from './lib/glyphs.js';
import { parseLine, reduce, lawless, EMPTY, version, sessionsOf, missingLines, untested, place, tally, stamp, NEW_TALLY, minutes, shipName, alertsFor, hangarText, culprit, logFor, shardName, weaponName, placeName, worstInjury, droppedText } from './lib/gamelog.js';
import { pageFor, pageById } from './lib/pages.js';
import { lookup } from './lib/ships.js';
import * as bridge from './bridge.js';
import * as controls from './controls.js';
import { scene, init as initScenes, moduleOf, MODULE_NAMES, CUSTOM, swipeList, swipeIndex } from './scenes.js';
import { cleanPage, refuseItem, pageForShip, FIELDS, LIVE_FIELDS, duplicate, blank as blankPage, newId } from './lib/custom.js';
import { outline, render as shipRender } from './outlines.js';
import { ART } from './backdrops.js';
import * as arrange from './arrange.js';
import * as editor from './editor.js';
import * as perf from './perf.js';
import * as world from './world.js';
import * as phone from './phone.js';
import { keepAwake } from './awake.js';
import * as haptics from './haptics.js';
import * as tele from './lib/telemetry.js';
import * as tp from './telepages.js';
import { reportText, issueBody } from './lib/report.js';

const $ = id => document.getElementById(id);
// On a phone (link.js set this up), the console shows one plate at a time.
const onPhone = !!window.__EC_PHONE__;
// A device big enough for the whole console (a tablet across, another computer) shows all of it.
let whole = false;
// Pairing comes first: the console below waits for the PC to answer.
if (onPhone) window.__EC_PHONE__.onState(st => phone.linkScreen(st, window.__EC_PHONE__.error));
const stage = $('stage');
const load = async f => (await fetch('vendor/' + f)).json();
const [layout, shipsDb, bundledOverrides, consoleXml] = await Promise.all([
  load('star-citizen.json'), load('ships.json'), load('ship-overrides.json'),
  fetch('vendor/binds.xml').then(r => r.text()),
]);

// Brushed metal and grain, drawn once as small tiles.
const tile = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const noise = (w, ht, freq, alpha) => tile(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${alpha} 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`);
document.documentElement.style.setProperty('--noise', noise(200, 200, '.85', '.05'));
document.documentElement.style.setProperty('--brush', noise(400, 200, '.004 .9', '.07'));

// Ship roles: the repo's overrides, then the player's own file (Documents\Edge Cockpit\ships.json).
const overrides = { ships: { ...bundledOverrides.ships } };
async function loadUserShips() {
  try {
    const text = await bridge.userShips();
    overrides.ships = { ...bundledOverrides.ships, ...(text ? JSON.parse(text).ships : {}) };
  } catch { /* a typo in the file: keep the bundled roles */ }
}
await loadUserShips();

// Every key by label, from every page of the layout.
const KEYS = new Map();
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') {
    if (o.label && (o.action || o.steps) && !KEYS.has(o.label)) KEYS.set(o.label, o);
    Object.values(o).forEach(walk);
  }
})(layout);
// Kit a ship may lack, and the keys that need it.
const KIT_KEYS = { missiles: ['Missiles +', 'Missiles reset', 'Missile mode'], emp: ['EMP'], qed: ['QED'], tractor: ['Tractor rotate', 'Tractor detach', 'Beam closer', 'Beam farther'] };

// ---------- your pages (lib/custom.js) ----------
// Kept in this console's storage; each one joins the main deck after the curated pages, so
// showing, swiping and the soft keys treat it like any page. The curated pages are not touched.
const mainPages = layout.decks.find(d => d.id === 'main').pages;
// The Telemetry pages join the deck too; only the Gauges soft key reaches them, and only while
// the game link is live with the Telemetry layout on.
for (const t of tp.TELE_PAGES) mainPages.push({ id: t.id, name: t.name, theme: { accent: '#58d2f0', code: 'TLM', glyph: t.glyph }, groups: [], rows: [] });
const CURATED = mainPages.length;
// A Device keeps no pages of its own: it shows the PC's, which arrive with the shared state.
const devicePages = new Map();
function storedPages() {
  if (window.__EC_PHONE__) return [...devicePages.values()];
  try { return JSON.parse(localStorage.getItem('xfd-pages') || '[]'); } catch { return []; /* broken: start empty */ }
}
function loadPages() {
  const list = storedPages();
  CUSTOM.clear();
  mainPages.length = CURATED;
  for (const raw of Array.isArray(list) ? list : []) {
    const spec = cleanPage(raw);
    if (!spec || CUSTOM.has(spec.id)) continue;
    // A page from a file or an older build may hold a key the rules no longer allow there
    // (a guessed switch, an uncovered eject): it isn't drawn.
    for (const pl of spec.plates) pl.add = pl.add.filter(it => !refuseItem(it, KEYS));
    CUSTOM.set(spec.id, spec);
    const from = spec.from && mainPages.find(p => p.id === spec.from);
    mainPages.push({ id: spec.id, name: spec.name, custom: true, theme: from?.theme || from && mainPages.find(p => p.id === (from.role?.tab || from.tab))?.theme || undefined });
  }
}
loadPages();
const savePages = list => { try { localStorage.setItem('xfd-pages', JSON.stringify(list)); } catch { /* private mode */ } };
/** Stores a page of yours (null deletes it) and tells the other screens. */
function putPage(id, spec, tell = true) {
  if (window.__EC_PHONE__) { if (spec) devicePages.set(id, spec); else devicePages.delete(id); }
  else savePages([...storedPages().filter(p => p?.id !== id), ...(spec ? [spec] : [])]);
  if (tell) bridge.share({ pages: { [id]: spec } });
}

// ---------- settings ----------
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('xfd-' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xfd-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
// Night mode is off, on, or auto (dark from 20:00 to 07:00 by this PC's clock). Older builds stored a boolean.
const NIGHT_FROM = 20, NIGHT_TO = 7;
// Maker theme: auto (the ship's maker), off, or one maker's theme always. Older builds stored a boolean.
const THEMED = new Set(['DRAK', 'AEGS', 'ORIG', 'MISC', 'ANVL', 'RSI', 'CRUS', 'ARGO', 'CNOU']);
const themeMode = v => (v === false ? 'off' : v === 'off' || THEMED.has(v) ? v : 'auto');
// Ship plates shown on this screen: all four unless you left some out (at least one stays).
const SHIP_PLATES = ['power', 'role', 'flight', 'gear'];
const platesMode = v => (Array.isArray(v) && v.some(x => SHIP_PLATES.includes(x)) ? SHIP_PLATES.filter(x => v.includes(x)) : SHIP_PLATES);
// Night backlight in percent; 0 leaves the backlight alone.
const nightLevel = v => [0, 10, 30, 50].includes(+v) ? +v : 30;
const nightMode = v => (v === true ? 'on' : ['on', 'auto'].includes(v) ? v : 'off');
const opts = { night: nightMode(store.get('night', 'off')), sound: store.get('sound', true), flash: store.get('flash', true), auto: store.get('auto', true), recap: store.get('recap', true), alertSound: store.get('alertSound', true), mute: store.get('mute', false), anywhere: store.get('anywhere', false), stack: store.get('stack', true), large: store.get('large', false), shapes: store.get('shapes', false), calm: store.get('calm', false), plates: platesMode(store.get('plates', null)), size: store.get('size', 'fit') === 'actual' ? 'actual' : 'fit', makerTheme: themeMode(store.get('makerTheme', 'auto')), vibrate: store.get('vibrate', true), nightLight: nightLevel(store.get('nightLight', 30)), layout: store.get('layout', 'telemetry') === 'classic' ? 'classic' : 'telemetry', gameSend: store.get('gameSend', true) };
// The game link (see the game link section): off until the game shares its telemetry.
let link = { link: 'off', port: 2942, actions: [], live: {} };
/** A key the game takes through the link, so it needs no keyboard bind (5.0, taps only). */
const byGame = k => !!k && k.role !== 'hold' && tele.viaGame(link, k, 'tap', opts.gameSend);
/** A key the console can press: a keyboard bind, or the game takes it. */
const reach = k => !!k && (!!bindOf(k) || byGame(k));
// Vibration is for paired phones and tablets only; the Edge has no motor.
if (onPhone) haptics.enable(opts.vibrate);
stage.classList.toggle('large', opts.large);
document.body.classList.toggle('shapes', opts.shapes);
document.body.classList.toggle('calm', opts.calm);

// ---------- binds: the player's actionmaps.xml, then our Xeneon profile, then the defaults ----------
function parseActionmaps(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const kb = {}, stick = {}, mouse = {};
  if (doc.querySelector('parsererror')) return { kb, stick, mouse };
  doc.querySelectorAll('action').forEach(a => {
    const name = a.getAttribute('name');
    a.querySelectorAll('rebind').forEach(rb => {
      const input = (rb.getAttribute('input') || '').trim();
      const m = input.match(/^kb\d*_(.*)$/);
      if (m) kb[name] = m[1].trim() || null;
      const j = input.match(/^(js|gp)\d*_(.+)$/);
      if (j && j[2].trim()) stick[name] = input;
      const mo = input.match(/^mo\d*_(.+)$/);
      if (mo && mo[1].trim()) mouse[name] = mo[1].trim();
    });
  });
  return { kb, stick, mouse };
}
// The game keeps keys and mouse buttons in one Keyboard/Mouse slot, so where our key replaces a
// default mouse button (quantum engage: left button) our profile puts the button on the mouse.
const { kb: consoleBinds, mouse: consoleMouse } = parseActionmaps(consoleXml);
let mine = { kb: {}, stick: {}, mouse: {} };
function bindOf(k) {
  if (!k?.action) return null;
  if (Object.hasOwn(mine.kb, k.action)) {
    const v = mine.kb[k.action];
    return v && !/mouse|mwheel|maxis/.test(v) ? v : null;
  }
  return k.defaultKey || consoleBinds[k.action] || null;
}
async function reloadBinds() {
  const text = await bridge.readBinds().catch(() => null);
  mine = text ? parseActionmaps(text) : { kb: {}, stick: {}, mouse: {} };
  const n = Object.keys(mine.kb).length;
  $('binds-note').textContent = text ? `${n} keyboard binds from your actionmaps.xml` : 'Default binds (no actionmaps.xml yet)';
  cache.clear();
  render();
  paintBindHealth();
  paintSetup();
  paintBackups();
}

// ---------- binds copies: the app keeps the last few versions of actionmaps.xml ----------
// When a game update (or a deleted USER folder) wipes the player's binds, Keybinds says so
// and Restore puts the newest copy back in the game's Control Profiles.
let backups = null;
const when = s => new Date(s * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function paintBackups() {
  backups = await bridge.bindsBackups().catch(() => null);
  const newest = backups?.copies?.[0];
  const lost = !!(backups?.lost && newest);
  $('act-restore').hidden = !newest;
  $('act-keep').hidden = !lost;
  if (newest) $('restore-note').textContent = `From ${when(newest.at)} · ${newest.binds} binds · ${backups.copies.length} kept in Documents\\Edge Cockpit\\Binds`;
  const card = $('binds-lost');
  card.hidden = !lost;
  if (lost) {
    card.querySelector('b').textContent = 'Your binds look reset';
    card.querySelector('p').textContent = `${backups.now == null ? 'The game has no actionmaps.xml now' : `actionmaps.xml holds ${backups.now} ${backups.now === 1 ? 'bind' : 'binds'} now`}. On ${when(newest.at)} it held ${newest.binds}, joysticks included.\nRestore adds them to the game's Control Profiles as "edge-cockpit-backup": pick it there and tick each device.`;
  }
  paintBindHealth();
}
/** Every bind and device option in an actionmaps.xml, as a Control Profile the game can load. */
function backupProfile(text, at) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const prof = doc.querySelector('ActionProfiles[profileName="default"]') || doc.querySelector('ActionProfiles');
  if (!prof) return null;
  const e = controls.esc, ser = new XMLSerializer();
  const devices = [...prof.querySelectorAll(':scope > options')]
    .map(o => [o.getAttribute('type'), o.getAttribute('instance')])
    .filter(([t, i]) => /^(keyboard|mouse|joystick|gamepad)$/.test(t || '') && /^\d+$/.test(i || ''))
    .map(([t, i]) => `   <${t} instance="${i}"/>`);
  if (!devices.length) devices.push('   <keyboard instance="1"/>');
  const body = [...prof.children].filter(c => ['deviceoptions', 'options', 'modifiers', 'actionmap'].includes(c.tagName)).map(c => ' ' + ser.serializeToString(c).replace(/ xmlns="[^"]*"/g, ''));
  if (!body.some(b => b.startsWith(' <actionmap'))) return null;
  return `<ActionMaps version="1" optionsVersion="2" rebindVersion="2" profileName="edge-cockpit-backup">
 <CustomisationUIHeader label="edge-cockpit-backup" description="${e(`Your binds as Edge Cockpit kept them on ${when(at)}`)}" image="">
  <devices>
${devices.join('\n')}
  </devices>
 </CustomisationUIHeader>
${body.join('\n')}
</ActionMaps>
`;
}
async function restoreBinds() {
  const newest = backups?.copies?.[0];
  if (!newest) return;
  try {
    const xml = backupProfile(await bridge.readBindsBackup(newest.file), newest.at);
    if (!xml) { toast('That copy has no binds the game can load'); return; }
    await bridge.installProfileBinds(xml, true);
    toast('Added. In game: Options, Keybindings, Control Profiles, pick "edge-cockpit-backup" and tick each device.');
  } catch (err) { toast(String(err?.message || err)); }
}
async function keepBinds() {
  await bridge.dismissBindsLoss().catch(() => {});
  await paintBackups();
  toast('Kept. The next change to your binds is copied as usual.');
}

/** Modifiers the game also binds on their own, so a chord with one presses that action too. */
const LONE_MODIFIERS = { rshift: 'locks rotation', lshift: 'boosts', lctrl: 'strafes down' };
/**
 * The keybind check: every key the console can send, against the binds in use.
 * Missing: no keyboard key at all. Stick only: bound to a joystick, which the panel
 * can't press. Shared: two different actions on the same key in the same part of the
 * game, with the same press type, so one press does both.
 */
function bindHealth() {
  const byAction = new Map();
  const add = k => { if (k?.action && !byAction.has(k.action)) byAction.set(k.action, k); };
  for (const k of KEYS.values()) { add(k); k.steps?.forEach(st => add(st.key)); }
  const missing = [], stick = [], shared = [], mouse = [], held = [], game = [], seen = new Map();
  for (const k of byAction.values()) {
    const spec = bindOf(k);
    // Our key took the slot of a default mouse button and the button didn't move to the mouse.
    const button = consoleMouse[k.action];
    if (button && Object.hasOwn(mine.kb, k.action) && spec === consoleBinds[k.action] && !mine.mouse[k.action]) mouse.push(`${k.label} (${mouseText(button)})`);
    if (!spec) { (byGame(k) ? game : mine.stick[k.action] ? stick : missing).push(k.label); continue; }
    // The game fires a modifier's own action even mid-chord: right Shift alone is Lock rotation.
    const parts = spec.split('+'), lone = parts.find(p => Object.hasOwn(LONE_MODIFIERS, p));
    if (parts.length > 1 && lone && spec !== k.defaultKey) held.push(`${k.label} (${keyText(spec)}, also ${LONE_MODIFIERS[lone]})`);
    const id = `${k.actionmap || ''}|${k.activation || ''}|${spec}`;
    const other = seen.get(id);
    // The game itself puts some actions on one key and picks by context (mining and salvage mode on M).
    if (other && !(spec === k.defaultKey && spec === other.defaultKey)) shared.push(`${other.label} and ${k.label} (${keyText(spec)})`);
    else seen.set(id, k);
  }
  return { total: byAction.size, missing, stick, shared, mouse, held, game };
}
function mouseText(spec) { return spec.split('+').map(p => ({ mouse1: 'left mouse button', mouse2: 'right mouse button', mouse3: 'middle mouse button' }[p] || keyText(p))).join(' + '); }
const listOf = (a, n = 4) => a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '');
function paintBindHealth() {
  const h = bindHealth();
  const bad = h.missing.length + h.stick.length;
  const row = $('bind-health');
  const odd = h.mouse.length + h.held.length;
  row.className = `health ${bad || odd ? 'warn' : h.shared.length ? 'info' : 'ok'}`;
  row.querySelector('b').textContent = bad
    ? `${bad} of ${h.total} keys can't be pressed from the console`
    : h.game.length ? `All ${h.total} keys the console uses can be pressed` : `All ${h.total} keys the console uses have a keyboard bind`;
  const lines = [];
  if (h.missing.length) lines.push(`No keyboard key: ${listOf(h.missing)}.`);
  if (h.stick.length) lines.push(`Joystick only: ${listOf(h.stick)}.`);
  if (h.game.length) lines.push(`No keyboard key, so only through the game while telemetry is live: ${listOf(h.game)}.`);
  if (h.shared.length) lines.push(`Sharing a key: ${listOf(h.shared, 2)}.`);
  if (h.mouse.length) lines.push(`Lost their mouse button in game: ${listOf(h.mouse)}.`);
  if (h.held.length) lines.push(`Shift or left Ctrl in these keys also fires its own action in game: ${listOf(h.held, 2)}.`);
  if (bad || odd) lines.push('Add the console\'s binds, then pick "edge-cockpit" in the game\'s Control Profiles with Keyboard and Mouse ticked.');
  row.querySelector('p').textContent = lines.join('\n') || 'Checked when the console starts and whenever your binds change.';
  const chip = $('binds-chip'), lost = !!backups?.lost;
  chip.hidden = !bad && !lost;
  chip.querySelector('span').textContent = lost ? 'Binds reset' : `${bad} ${bad === 1 ? 'key' : 'keys'} unbound`;
  $('binds-dot').hidden = !bad && !lost;
  return h;
}
const keyText = spec => (spec || '').split('+').map(p => ({ ralt: 'RAlt', lalt: 'LAlt', rctrl: 'RCtrl', lctrl: 'LCtrl', rshift: 'RShift', lshift: 'LShift', backspace: 'Bksp' }[p] || p.toUpperCase())).join(' ');

// ---------- sound ----------
let audio;
function tick(kind) {
  haptics.buzz(kind);
  if (!opts.sound || opts.mute) return;
  try {
    audio ||= new AudioContext();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    const f = { critical: 160, arm: 320, toggle: 540, hold: 280, page: 900, error: 110, detent: 1400 }[kind] || 720;
    o.type = kind === 'critical' || kind === 'error' ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .55, t + .05);
    g.gain.setValueAtTime(kind === 'detent' ? .05 : .12, t); g.gain.exponentialRampToValueAtTime(.0001, t + .08);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + .09);
  } catch { /* no audio device */ }
}

// ---------- alerts ----------
// A banner and a short tone when something changes that needs you: a CrimeStat, armistice, your ship disabled.
let bannerTimer;
function raise({ text, tone }) {
  const b = $('banner');
  b.className = `banner ${tone}`;
  b.textContent = text;
  void b.offsetWidth;
  b.classList.add('show');
  stage.classList.remove('flash-bad', 'flash-warn', 'flash-good');
  void stage.offsetWidth;
  stage.classList.add(`flash-${tone}`);
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.classList.remove('show'); stage.classList.remove(`flash-${tone}`); }, 4000);
  if (opts.alertSound && !opts.mute) alertTone(tone);
}
function alertTone(tone) {
  try {
    audio ||= new AudioContext();
    const notes = { bad: [880, 660, 880, 660], warn: [660, 520], good: [520, 780] }[tone] || [660];
    notes.forEach((f, i) => {
      const t = audio.currentTime + i * .14, o = audio.createOscillator(), g = audio.createGain();
      o.type = tone === 'bad' ? 'square' : 'triangle';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.09, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + .13);
    });
  } catch { /* no audio device */ }
}

// ---------- toast ----------
let toastTimer;
function toast(text, action) {
  $('toast-text').textContent = text;
  const b = $('toast-act');
  b.hidden = !action;
  if (action) { b.textContent = action.label; b.onclick = () => { $('toast').classList.remove('show'); action.run(); }; }
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), action ? 6000 : 3200);
}

// ---------- sending keys ----------
// How long a tap holds the key, by Star Citizen activation mode; hold keys are held at least this long.
const HOLD_MS = { delayed_press: 350, delayed_press_medium: 1100, delayed_press_long: 1600, delayed_hold: 350, delayed_hold_long: 1600, delayed_hold_no_retrigger: 350 };
const holdMs = k => HOLD_MS[k.activation] || 70;

const flash = (node, cls) => { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); setTimeout(() => node.classList.remove(cls), 600); };
function failed(err, k, node) {
  const msg = String(err?.message || err);
  flash(node, 'error');
  tick('error');
  if (msg === 'no-game') toast('Star Citizen is not in front, so the key was not sent.', { label: 'Test mode', run: () => setOpt('anywhere', true) });
  else if (msg === 'blocked') toast('Windows blocked the key. The game runs as administrator, so the panel must too.', { label: 'Restart as admin', run: bridge.runAsAdmin });
  else if (msg === 'unbound') toast(`${k.label} has no keyboard key. Pick "edge-cockpit" in the game's Control Profiles.`, { label: 'Add binds', run: installBinds });
  else toast(msg);
}

async function send(k, mode, ms, node) {
  if (K.dry) return true;  // the page editor's Try it: presses light up, nothing is sent
  // Through the game when it takes this action: no keybind or focus needed. Anything but
  // "ok" (an action it refuses, a dropped link) falls back to the key.
  let refused = null;
  if (tele.viaGame(link, k, mode, opts.gameSend)) {
    const r = await bridge.gameAction(k.action).catch(() => 'failed');
    if (r !== 'ok') refused = r;
    else lastPress = { label: k.label, via: 'ok' };
    if (r === 'ok') {
      if (info.focused && /^spaceship|^vehicle/.test(k.actionmap || '')) { watch.shipKeys++; paintPatch(); }
      if (!$('sheet').hidden) paintLink();
      return true;
    }
  }
  const spec = bindOf(k);
  if (mode !== 'up') lastPress = { label: k.label, via: refused || 'key' };
  if (!spec) { failed('unbound', k, node); return false; }
  try { await bridge.sendKey(spec, mode, ms, opts.anywhere); } catch (e) { failed(e, k, node); return false; }
  if (mode !== 'up' && info.focused && /^spaceship|^vehicle/.test(k.actionmap || '')) { watch.shipKeys++; paintPatch(); }
  return true;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Runs a key once: a tap long enough for its activation mode, or a macro's steps. */
async function fire(k, node) {
  if (!k) return false;
  if (k.role === 'macro') {
    for (const step of k.steps) {
      if (step.delay) await sleep(step.delay);
      else if (step.key) {
        if (!(await send(step.key, 'tap', holdMs(step.key), node))) return false;
        if (step.key.state) flip(step.key.state);
      }
    }
    return true;
  }
  const ok = await send(k, 'tap', holdMs(k), node);
  if (ok) after(k);
  return ok;
}

// Readouts that follow what you press, since the game doesn't report them.
const local = { speed: 50, laser: 50, spacing: 50, beam: 50, missiles: 2, pips: [4, 4, 4], navmode: 0 };
function after(k) {
  if (k.label === 'Missiles +') local.missiles = Math.min(8, local.missiles + 1);
  else if (k.label === 'Missiles reset') local.missiles = 1;
  else return;
  repaint();
}

async function wheel(clicks, node) {
  try { await bridge.wheel(clicks, opts.anywhere); } catch (e) { failed(e, { label: 'The wheel' }, node); }
}

/**
 * Gives a touch target its key's behaviour: tap, hold (down while touched), a long
 * press or double tap for a second action, a macro, or tap twice for a critical key.
 * `label` is a separate element that lights with the target (dial wedges).
 */
function bind(node, k, { label } = {}) {
  const fired = () => { if (opts.flash) flash(node, 'fired'); };
  const role = k.role;
  if (role === 'hold') {
    const min = holdMs(k);
    node.style.setProperty('--hold-ms', Math.max(min, 250) + 'ms');
    let t0 = 0, sent = null;
    controls.pressable(node, {
      down: () => { t0 = performance.now(); sent = send(k, 'down', null, node); tick('hold'); node.classList.add('held'); label?.classList.add('lit'); },
      up: async () => {
        const wait = Math.max(0, min - (performance.now() - t0));
        const ok = await sent;
        if (wait) await sleep(wait);
        if (ok) await send(k, 'up', null, node);
        node.classList.remove('held'); label?.classList.remove('lit');
      },
    });
    return;
  }
  if (role === 'critical') {
    let timer;
    const st = node.querySelector('.st');
    const disarm = () => { node.classList.remove('armed'); if (st) st.textContent = ''; };
    controls.pressable(node, {
      up: async () => {
        clearTimeout(timer);
        if (!node.classList.contains('armed')) { tick('arm'); node.classList.add('armed'); if (st) st.textContent = 'TAP AGAIN'; timer = setTimeout(disarm, 3000); }
        else { tick('critical'); disarm(); if (await fire(k, node)) fired(); }
      },
    });
    return;
  }
  const primary = async () => {
    // The key goes first; the click and the light follow.
    const sent = fire(k, node);
    tick(k.state ? 'toggle' : 'tap');
    if (role === 'macro') node.classList.add('held');
    if (await sent) { fired(); if (k.state) flip(k.state); }
    node.classList.remove('held');
  };
  const alt = async other => { tick('toggle'); if (await fire(other, node)) { fired(); toast(other.label); } };
  let longTimer, longDone = false, lastUp = 0, single;
  controls.pressable(node, {
    down: () => {
      longDone = false;
      label?.classList.add('lit');
      if (k.more?.hold) longTimer = setTimeout(() => { longDone = true; alt(k.more.hold); }, 550);
    },
    up: () => {
      label?.classList.remove('lit');
      clearTimeout(longTimer);
      if (longDone) return;
      if (k.more?.double) {
        const now = performance.now();
        if (now - lastUp < 300) { clearTimeout(single); lastUp = 0; alt(k.more.double); return; }
        lastUp = now; single = setTimeout(primary, 300);
        return;
      }
      primary();
    },
    cancel: () => { clearTimeout(longTimer); label?.classList.remove('lit'); },
  });
}

// ---------- switch state ----------
// The game doesn't report what a toggle key leaves on or off (G-safe, doors, lights), and
// it can change in game without the panel, so a toggle shows no state: it flicks and springs
// back. Keys that set one state (gimbals locked, gear down) show the last one sent, and
// nothing until one is sent.
const states = {};
const tracked = st => st.kind === 'set';
const isOn = st => st.kind === 'set' && states[st.key] === st.value;
const known = key => key in states;
function flip(st) {
  // The game reports a switch a moment after it moves: until then, what the console just set stands.
  if (teleKeys.has(st.key)) holdoff[st.key] = performance.now() + HOLDOFF_MS;
  if (tracked(st)) { states[st.key] = st.value; repaint(); bridge.share({ st: { [st.key]: st.value } }); return; }
  // A toggle flips whatever the game had, so the matching switch no longer knows, unless the game says.
  if (st.key in states && !teleKeys.has(st.key)) { delete states[st.key]; repaint(); bridge.share({ st: { [st.key]: null } }); }
  for (const node of document.querySelectorAll(`#console [data-state]`)) {
    if (JSON.parse(node.dataset.state).key !== st.key) continue;
    node.classList.add('on');
    setTimeout(() => node.classList.remove('on'), 350);
  }
}
/** State another screen (the PC or a phone) changed. */
/** A page of yours left: nothing points at it any more. */
function pageGone(id) {
  loadPages(); cache.delete(id);
  if (lastShip === id) lastShip = 'flight';
  if (rolePage === id) rolePage = null;
  if (current === id) show('flight');
}
function shared(s) {
  // Pages of yours, saved on another screen (the PC keeps them; a Device shows them).
  if (s.pages && typeof s.pages === 'object') {
    for (const [id, spec] of Object.entries(s.pages)) {
      const clean = spec && cleanPage(spec);
      if (spec && !clean) continue;
      putPage(id, clean, false);
      if (!clean) pageGone(id);
      else if (!(editor.isOpen() && current === id)) { loadPages(); cache.delete(id); if (current === id) render(); }
    }
  }
  // A page being edited on another screen: shown here as it changes, until Done.
  if ('preview' in s && !editor.isOpen()) {
    const spec = s.preview && cleanPage(s.preview);
    if (spec && CUSTOM.has(spec.id)) CUSTOM.set(spec.id, spec);
    else if (!s.preview) loadPages();
    for (const id of CUSTOM.keys()) cache.delete(id);
    if (CUSTOM.has(current)) render();
  }
  if (s.gl && onPhone) { link = { ...link, link: s.gl.link, actions: s.gl.actions || [] }; gameBinds(); }
  if (Array.isArray(s.tk)) teleKeys = new Set(s.tk);
  if ('st' in s) {
    if (s.st === null) for (const key of Object.keys(states)) delete states[key];
    else for (const [k, v] of Object.entries(s.st)) { if (v === null) delete states[k]; else states[k] = v; }
    repaint();
  }
  if (s.page && s.page !== current) show(s.page, true);
}
function repaint() {
  for (const node of document.querySelectorAll('#console [data-state]')) {
    const st = JSON.parse(node.dataset.state);
    if (!tracked(st)) { paintLamp(node, st); continue; }
    const on = isOn(st);
    node.classList.toggle('on', on);
    const s = node.querySelector(':scope > .cap > .st, :scope > .st');
    if (s && st.labels) s.textContent = st.labels[on ? 0 : 1];
  }
  for (const node of document.querySelectorAll('#console .painted')) node.paint();
  paintCounts();
}

// ---------- game link: Star Citizen's own telemetry ----------
// With the game sharing its state, switches show where the ship really is, push-buttons for
// what the game reports get a lamp, and the status display shows the game's instruments. What
// the game doesn't send keeps the classic behaviour. With telemetry off, nothing changes.
const teleOn = () => link.link === 'live' && opts.layout !== 'classic';
let teleKeys = new Set();           // state keys whose value came from the game
const holdoff = {};                 // key -> until when the game's value waits
const HOLDOFF_MS = 800;
let linkShared = '', byGameNow = '';
/** Keys with no keyboard bind that the game takes: the bind health, and GAME on their caps. */
function gameBinds() {
  const g = paintBindHealth().game.join('|');
  if (g !== byGameNow) { byGameNow = g; cache.clear(); render(); }
}
function applyTelemetry(u) {
  if (u) link = u;
  if (onPhone) return;
  const want = {};
  if (teleOn()) {
    Object.assign(want, tele.switchesOf(link.live));
    const cm = tele.countermeasures(link.live), g = tele.guns(link.live);
    if (cm.decoy != null) want.cm_decoy = cm.decoy;
    if (cm.noise != null) want.cm_noise = cm.noise;
    if (g) want.guns_ready = `${g.ready}/${g.total}`;
  }
  const now = performance.now(), changed = {};
  for (const k of teleKeys) if (!(k in want)) { delete states[k]; changed[k] = null; }
  for (const [k, v] of Object.entries(want)) {
    if ((holdoff[k] || 0) > now) continue;
    if (states[k] !== v) { states[k] = v; changed[k] = v; }
  }
  const keys = Object.keys(want), moved = keys.length !== teleKeys.size || keys.some(k => !teleKeys.has(k));
  teleKeys = new Set(keys);
  const gl = JSON.stringify({ link: link.link, actions: link.actions });
  if (gl !== linkShared) gameBinds();
  if (Object.keys(changed).length || moved || gl !== linkShared) {
    repaint();
    bridge.share({ st: changed, tk: keys, gl: JSON.parse(gl) });
    linkShared = gl;
  }
  paintTele();
  paintGauges();
  if (!$('sheet').hidden) paintLink();
}
let lastGauges = 'tl-instruments', gaugesShown = null;
/** The Telemetry pages: filled from each update; when telemetry goes away, back to the ship. */
let seatSeen = '';
function paintGauges() {
  const on = teleOn();
  if (on) {
    tp.observe(link.live);
    // Into a gunner's seat: the Turret page; out of it: back to the ship.
    const st = link.live?.actor?.state, seat = st ? `${st.crew_role}:${st.seat_name || ''}` : '';
    if (seat !== seatSeen) {
      seatSeen = seat;
      if (tp.isGunner(link.live)) { if (current !== 'tl-turret') show('tl-turret'); }
      else if (current === 'tl-turret' && seat) show(rolePage || lastShip);
    }
  } else seatSeen = '';
  if (on !== gaugesShown) { gaugesShown = on; paintSoftkeys(); }
  // Status screens of yours that show game values follow every update.
  if (CUSTOM.has(current)) for (const node of document.querySelectorAll('#console .custom-screen.painted')) node.paint();
  if (!tp.isTele(current)) return;
  if (!on) { show(rolePage || lastShip); return; }
  tp.paint($('console'), link.live);
}
/** A push-button whose state the game reports: a lamp, and the state under its label. */
function paintLamp(node, st) {
  const cap = node.matches('.cap') ? node : node.querySelector(':scope > .cap');
  if (!cap) return;
  const show = teleKeys.has(st.key) && typeof states[st.key] === 'boolean';
  cap.classList.toggle('glamp', show);
  cap.classList.toggle('glamp-on', show && states[st.key]);
  let t = cap.querySelector(':scope > .lvt');
  if (!show) { t?.remove(); cap.querySelector(':scope > .lv')?.remove(); return; }
  if (!t) { cap.insertAdjacentHTML('beforeend', '<span class="lv"></span><span class="lvt"></span>'); t = cap.querySelector(':scope > .lvt'); }
  t.textContent = (st.labels || ['On', 'Off'])[states[st.key] ? 0 : 1];
}
/** Decoys and noise left on their keys, and guns ready over the gun groups. */
function paintCounts() {
  for (const [label, key] of [['Decoy', 'cm_decoy'], ['Noise', 'cm_noise']]) {
    for (const cap of document.querySelectorAll(`#console [data-k="${label}"] > .cap`)) {
      const v = teleKeys.has(key) ? states[key] : null;
      let c = cap.querySelector(':scope > .cnt');
      if (v == null) { c?.remove(); continue; }
      if (!c) { cap.insertAdjacentHTML('beforeend', '<span class="cnt"></span>'); c = cap.querySelector(':scope > .cnt'); }
      c.textContent = v;
    }
  }
  for (const p of document.querySelectorAll('#console .guns-placard')) p.textContent = teleKeys.has('guns_ready') ? `Guns ${states.guns_ready} ready` : 'Gun groups';
}
let baseRole = '', teleShown = '';
/** The status display's telemetry: the ship's instruments seated, your vitals on foot. */
function paintTele() {
  const mfd = $('mfd'), facts = mfd.querySelector('.facts');
  $('tele-chip').hidden = link.link !== 'live' || game.menu;
  const on = teleOn() && !game.menu && !game.down;
  const v = on ? link.live.vehicle : null, body = on && !v ? tele.vitals(link.live) : null;
  const esc = controls.esc;
  let html = '', role = baseRole;
  if (v) {
    const ins = tele.instruments(v), ann = v.annunciators;
    const line = tele.shipLine(link.live);
    if (line && game.seated) role = baseRole.replace(/ · pilot seat$/, '') + ' · ' + line;
    const bar = (n, val, c) => `<span>${n}</span><i style="--v:${val ?? 0}%;--c:${c}"></i><em>${val == null ? '—' : val + '%'}</em>`;
    const num = (n, val, unit) => `<span>${n}<b>${val == null ? '—' : esc(String(val))}${val == null ? '' : `<small> ${unit}</small>`}</b></span>`;
    html = (ann ? `<div class="ann">${tele.ANNUNCIATORS.map(k => { const l = tele.lamp(ann[k]); return `<b class="${l.cls}${l.flash ? ' fl' : ''}">${k.toUpperCase()}</b>`; }).join('')}</div>` : '')
      + `<div class="bars">${bar('Shields', ins.shields, 'var(--cyan)')}${bar('Hull', ins.hull, 'var(--ok)')}${bar('Boost', ins.boost, 'var(--hold)')}</div>`
      + `<div class="rd">${num('Speed', ins.speed, 'm/s')}${num('Radar alt', ins.radarAlt == null ? null : ins.radarAlt < 100 ? ins.radarAlt.toFixed(1) : Math.round(ins.radarAlt), 'm')}${num('Vertical', ins.vertical, 'm/s')}</div>`;
  } else if (body) {
    if (body.breathable != null) role = `${body.eva ? 'EVA' : 'On foot'} · ${body.breathable ? 'Breathable air outside' : 'No breathable air'}`;
    const g = (n, val, unit, p, c) => `<div>${n}<b>${val == null ? '—' : esc(String(val))}${val == null ? '' : `<small>${unit}</small>`}</b>${p != null ? `<i style="--v:${p}%;--c:${c}"></i>` : ''}</div>`;
    const level = p => p < 25 ? 'var(--danger)' : p < 50 ? 'var(--hold)' : 'var(--ok)';
    const gauge = (n, x, unit, fmt) => g(n, x ? fmt(x) : null, unit, x?.pct, x ? level(x.pct) : '');
    html = `<div class="vit">${gauge('Health', body.health, '%', x => x.pct)}${gauge('Oxygen', body.oxygen, '%', x => x.pct)}`
      + `${gauge('Hunger', body.hunger, '%', x => x.pct)}${gauge('Thirst', body.thirst, '%', x => x.pct)}`
      + `${g('Body temp', body.body == null ? null : body.body.toFixed(1), '°C')}${g('Heart rate', body.heart, 'bpm')}`
      + `${g('Outside', body.outside == null ? null : Math.round(body.outside), '°C')}${g('Gravity', body.gravity == null ? null : body.gravity.toFixed(2), 'g')}</div>`;
  }
  if ($('ship-role').textContent !== role) $('ship-role').textContent = role;
  if (html === teleShown) return;
  const had = !!teleShown;
  teleShown = html;
  let box = $('tlm');
  if (!html) { box?.remove(); mfd.classList.remove('tlm-on'); }
  else {
    if (!box) { box = document.createElement('div'); box.id = 'tlm'; box.className = 'tlm'; facts.prepend(box); }
    box.innerHTML = html;
    mfd.classList.add('tlm-on');
  }
  if (had !== !!html) fitChips();
}
/** Settings › Game link. With `fresh`, asks the PC how telemetry is set up. */
let setupSeen = null;
async function paintLink(fresh) {
  if (onPhone) return;
  if (fresh) setupSeen = await bridge.telemetrySetup().catch(() => null);
  const live = link.link === 'live', sends = live && link.actions.length > 0;
  const state = $('link-state');
  state.className = 'chip ' + (live ? 'ok' : 'warn');
  state.querySelector('span').textContent = live ? 'Live' : 'Off';
  $('link-note').textContent = live
    ? `Star Citizen on 127.0.0.1:${link.port}. ${sends ? 'Reading the ship and taking commands' : 'Reading the ship. This game version takes no commands'}`
    : 'The game isn\'t sharing it. The console runs from Game.log and your keys, as before';
  document.querySelectorAll('#layout-seg button').forEach(b => b.classList.toggle('cur', b.dataset.v === opts.layout));
  const set = setupSeen && (setupSeen.env || setupSeen.channels.some(([, on]) => on));
  $('tele-act').textContent = set ? 'Turn telemetry off' : 'Turn telemetry on';
  $('tele-act-note').textContent = set
    ? `On for ${[setupSeen.env && '4.10', ...setupSeen.channels.filter(([, on]) => on).map(([c]) => c + ' (user.cfg)')].filter(Boolean).join(', ')}. The game reads it when it starts`
    : 'For 4.10 and 5.0. Restart the RSI Launcher and the game afterwards';
  const WHY = { unknown: 'it doesn\'t know the action', inactive: 'not in this seat or mode', 'rate-limited': 'too many at once', filtered: 'it refused', hold: 'no holds', failed: 'it failed', 'no-link': 'no link', timeout: 'no answer' };
  $('press-note').textContent = !lastPress ? 'Nothing pressed yet' : lastPress.via === 'ok' ? `${lastPress.label}: through the game`
    : lastPress.via === 'key' ? `${lastPress.label}: your key` : `${lastPress.label}: your key (the game: ${WHY[lastPress.via] || lastPress.via})`;
  $('rec-act').textContent = recording ? 'Stop and save the recording' : 'Record telemetry';
  $('rec-note').textContent = recording ? 'Recording what the game sends. Saves to Documents\\Edge Cockpit' : live ? 'Saves up to ten minutes of what the game sends, for a bug report' : 'Works while the game shares telemetry';
}
async function toggleTelemetry() {
  const set = setupSeen && (setupSeen.env || setupSeen.channels.some(([, on]) => on));
  try {
    setupSeen = await bridge.telemetryEnable(!set);
    toast(set ? 'Telemetry off from the next game start' : 'Telemetry on. Restart the RSI Launcher and the game');
  } catch (e) { toast(`Not changed: ${e?.message || e}`); }
  paintLink();
}
let recording = false;
let lastPress = null;
async function toggleRecord() {
  if (!recording && link.link !== 'live') { toast('Start the game with telemetry on first'); return; }
  try {
    const file = await bridge.telemetryRecord(!recording);
    recording = !recording;
    if (file) toast(`Saved to ${file}`);
  } catch (e) { recording = false; toast(`No recording: ${e?.message || e}`); }
  paintLink();
}

// ---------- the console ----------
// Ship weapon actionmaps, and on-foot weapons by their icon.
const isWeapon = k => /^spaceship_(weapons|missiles|defensive)$/.test(k.actionmap || '') || /^(rifle|pistol|knife|grenade)$/.test(k.icon || '');
// Colour family of a key: emergency red, weapons amber, flight cyan, everything else systems white.
const FLIGHT = /^spaceship_(movement|quantum|docking|view)$/;
const family = k => !k ? 'sys' : k.role === 'critical' || /eject|self_destruct|panic|emergency/.test(k.action || '') ? 'emg'
  : isWeapon(k) || /^spaceship_target(ing|ing_advanced|_hailing)$/.test(k.actionmap || '') ? 'wpn'
  : FLIGHT.test(k.actionmap || '') ? 'flt' : 'sys';
const theme = page => page.theme || pageById(layout, page.role?.tab || page.tab || 'flight')?.theme || { accent: '#5cc8e6', glyph: 'ship' };
// The Log page's rows, newest first, and the server-lag chip's last stall.
const LOG_MAX = 50, LAG_MS = 45000;
let logRows = [], lagSeen = null, lagTimer = null, liveLog = false;
let current = 'flight', rolePage = null, lastShip = 'flight', pageAccent = '#5cc8e6', makerAccent = null;
const applyAccent = () => stage.style.setProperty('--accent', makerAccent || pageAccent);

const K = {
  key: l => KEYS.get(l) || null,
  fitted: k => {
    const lacks = pageById(layout, current)?.role?.lacks || [];
    return !lacks.some(kit => KIT_KEYS[kit]?.includes(k.label));
  },
  bindText: k => (k.role === 'macro' ? '' : mine.stick[k.action] ? 'STICK' : !bindOf(k) && byGame(k) ? 'GAME' : keyText(bindOf(k))),
  isWeapon,
  family,
  bind, fire, wheel, flip, isOn, known, local, tick, toast, theme,
  fired: node => { if (opts.flash) flash(node, 'fired'); },
  scale: () => (onPhone && !whole ? phone.phoneScale() : stacked ? sized(twoRows()) : oneRow()),
  swipe: dir => {
    const list = swipeList(), i = swipeIndex(current);
    const base = list[(i + dir + list.length) % list.length];
    tick('page');
    show(!CUSTOM.has(base) && rolePage?.startsWith(base) ? rolePage : base);
  },
  go: id => { tick('page'); show(id); },
  tele: () => link.live,
  repaint: () => paintGauges(),
  /** A live value for a status screen on a page of yours: only what Game.log gave. */
  live: f => {
    if (LIVE_FIELDS.has(f)) return teleOn() ? tp.fieldValue(f, link.live) : null;
    if (f === 'armistice') return game.armistice ? 'Armistice zone' : 'Weapons free';
    if (f === 'ship') return game.seated && game.ship ? shipName(game.ship) : null;
    if (f === 'location') {  // as the status display words it: the place, else the jurisdiction
      const at = game.location ? place(game.location) : null;
      return (at ? [at.name, at.system].filter(Boolean).join(' · ') : (game.jurisdiction || '').replace(/ Jurisdiction$/, '')) || null;
    }
    if (f === 'kills') return String(session.kills || 0);
    if (f === 'shard') { const sh = shardName(game.shard); return sh ? [sh.region, sh.n].filter(Boolean).join(' ') : null; }
    if (f === 'qtTarget') return game.qtTarget ? placeName(game.qtTarget) : null;
    if (f === 'mission') return game.mission?.status === 'active' ? game.mission.contract : null;
    const v = game[f];
    return v == null ? null : String(typeof v === 'object' ? v.name ?? '' : v) || null;
  },
  fieldName: f => FIELDS[f] || '',
  /** A game value on a status screen of yours, as an instrument; null for text. */
  gauge: (f, w, h) => (LIVE_FIELDS.has(f) && teleOn() ? tp.fieldGauge(f, link.live, w, h) : null),
  /** The role module you put on this ship page in arrange mode, if not its own. */
  moduleFor: id => { const role = moduleOf(id), m = role && store.get(`module:${role}`, null); return m && MODULE_NAMES[m] && m !== role ? m : null; },
};
// ---------- your keys ----------
// A spare slot ("Not fitted", where the ship lacks the kit) takes any tap key you pick, and any
// tap key on a page can be swapped for another: long-press it to choose, long-press again to
// change it or go back to stock. Kept per page and slot; a cyan dot marks a key you changed.
let slotN = 0;
const mapN = new Map();
const pickable = k => !k.more && k.role !== 'hold' && k.role !== 'critical';
function longPress(node, fn) {
  let t = null, done = false, at = null;
  const stop = e => { clearTimeout(t); t = null; if (done) { e.stopImmediatePropagation(); node.classList.remove('pressed', 'lit', 'held'); } };
  node.addEventListener('pointerdown', e => {
    done = false; at = e;
    if (!node.hasPointerCapture?.(e.pointerId)) node.setPointerCapture?.(e.pointerId);
    t = setTimeout(() => { done = true; node.classList.remove('pressed'); tick('toggle'); fn(); }, 700);
  }, true);
  node.addEventListener('pointermove', e => { if (t && at && Math.hypot(e.clientX - at.clientX, e.clientY - at.clientY) > 12) { clearTimeout(t); t = null; } }, true);
  node.addEventListener('pointerup', stop, true);
  node.addEventListener('pointercancel', stop, true);
}
K.spare = (x, y, w, ht, r) => {
  const id = `slot:${current}:${slotN++}`;
  const k = KEYS.get(store.get(id, null));
  const el = k && pickable(k) ? controls.keycap(x, y, w, ht, k, { fitted: true, r, kb: w >= 100 }) : controls.blank(x, y, w, ht, r, w >= 100 ? 'Hold to add a key' : '+');
  el.classList.add('spare');
  longPress(el, () => openPicker(id, k));
  return el;
};
/** The key you put in place of a stock key here, if any: { id, key }. Ids follow the stock label, so they survive layout changes. */
K.mapped = stock => {
  if (!stock || !pickable(stock)) return null;
  const n = mapN.get(stock.label) || 0;
  mapN.set(stock.label, n + 1);
  const id = `map:${current}:${stock.label}${n ? `#${n}` : ''}`;
  const k = KEYS.get(store.get(id, null));
  return { id, key: k && pickable(k) && k !== stock ? k : null };
};
K.remappable = (el, id, stock, now) => longPress(el, () => openPicker(id, now || stock, stock));

const PICK_GROUPS = [
  ['flight', 'Flight', /^spaceship_(movement|quantum|docking|view)$/],
  ['weapons', 'Weapons', /^spaceship_(weapons|missiles|defensive|targeting|targeting_advanced|target_hailing)$/],
  ['systems', 'Systems', /^(spaceship_(power|hud|general|radar|scanning)|lights_controller|seat_general|vehicle_\w+|ui_notification|default)$/],
  ['work', 'Mining & salvage', /^(spaceship_(mining|salvage)|tractor_beam)$/],
  ['foot', 'On foot', /^(player|player_emotes|incapacitated|mapui|player_input_optical_tracking)$/],
];
// Sub-groups inside a tab, by the game's actionmap.
const SUBGROUPS = {
  spaceship_movement: 'Flight & assists', spaceship_quantum: 'Quantum', spaceship_docking: 'Docking', spaceship_view: 'View',
  spaceship_weapons: 'Guns', spaceship_missiles: 'Missiles', spaceship_defensive: 'Countermeasures & shields', spaceship_targeting: 'Targeting',
  spaceship_targeting_advanced: 'Targeting', spaceship_target_hailing: 'Targeting', spaceship_power: 'Power', spaceship_hud: 'HUD',
  spaceship_general: 'Ship', spaceship_radar: 'Radar & scanning', spaceship_scanning: 'Radar & scanning', lights_controller: 'Lights',
  seat_general: 'Seat', vehicle_mfd: 'MFDs', vehicle_general: 'Ship', ui_notification: 'Other', default: 'Other',
  spaceship_mining: 'Mining', spaceship_salvage: 'Salvage', tractor_beam: 'Tractor beam',
  player: 'On foot', player_emotes: 'Emotes', incapacitated: 'Downed', mapui: 'Map', player_input_optical_tracking: 'Other',
};
// Remote turrets: entering one is a seat action, the rest the turret's own.
const turret = k => k.actionmap === 'turret_movement' || /^v_enter_remote_turret_/.test(k.action || '');
const subOf = k => (turret(k) ? 'Remote turrets' : SUBGROUPS[k.actionmap] || 'Other');
const groupOf = k => (turret(k) ? 'weapons' : PICK_GROUPS.find(g => g[2].test(k.actionmap || ''))?.[0] || 'systems');
const RECENT = 'pick-recent';
let picking = null, pickStock = null, pickNow = null, query = '', typing = false, pickTab = 'flight';
// The page editor's pick: { title, now, base, refuse(label), onPick(label) }. Every key is offered;
// the ones its rules refuse show why, and a switch picks the base of a set-on / set-off pair.
let pickFor = null;
function openEditorPicker(o) {
  pickFor = o;
  picking = 'editor'; pickStock = null; pickNow = KEYS.get(o.now) || KEYS.get(`${o.now} on`) || null;
  query = ''; typing = false;
  $('pick-title').textContent = o.title;
  $('pick-clear').hidden = true;
  $('pick-now').innerHTML = o.list ? `${o.list.length} found` : o.now ? `Now: <b>${controls.esc(o.now)}</b>` : 'Empty';
  $('picker').classList.toggle('listing', !!o.list);
  showPickGroup(suggested().length ? 'sug' : pickNow ? groupOf(pickNow) : 'flight');
  $('picker').hidden = false;
}
function openPicker(id, k, stock = null) {
  pickFor = null;
  $('picker').classList.remove('listing');
  picking = id; pickStock = stock; pickNow = k;
  query = ''; typing = false;
  const changed = stock ? k && k !== stock : !!k;
  $('pick-title').textContent = stock ? 'Change key' : 'Add a key';
  $('pick-clear').hidden = !changed;
  $('pick-clear').querySelector('span').textContent = stock ? 'Back to stock' : 'Clear slot';
  $('pick-now').innerHTML = stock
    ? `Stock: <b>${controls.esc(stock.label)}</b>${changed ? `<br>Now: <b class="mine">${controls.esc(k.label)}</b>` : ''}`
    : k ? `Now: <b>${controls.esc(k.label)}</b>` : 'Empty';
  showPickGroup(suggested().length ? 'sug' : k ? groupOf(k) : 'flight');
  $('picker').hidden = false;
}
const pickKeys = () => [...KEYS.values()].filter(k => (pickFor ? !k.steps || k.role === 'macro' : pickable(k)));
/** Keys like the one in the slot, and the ones you picked lately. */
function suggested() {
  const out = [];
  const ref = pickStock || pickNow;
  if (ref) {
    const all = pickKeys();
    const same = all.filter(k => k !== ref && k.actionmap === ref.actionmap);
    const near = all.filter(k => k !== ref && k.actionmap !== ref.actionmap && subOf(k) === subOf(ref));
    const list = [ref, ...same, ...near].slice(0, 18);
    out.push([`Like ${ref.label}`, list]);
  }
  const recent = store.get(RECENT, []).map(l => KEYS.get(l)).filter(k => k && pickable(k));
  if (recent.length) out.push(['Picked lately', recent]);
  return out;
}
/** Folds "X", "X on" and "X off" into one tile with Toggle / On / Off. */
function fold(keys) {
  const by = new Map(keys.map(k => [k.label, k]));
  const seen = new Set(), tiles = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    const base = k.label.replace(/ (on|off)$/i, '');
    const t = by.get(base), on = by.get(`${base} on`) || by.get(`${base} On`), off = by.get(`${base} off`) || by.get(`${base} Off`);
    const parts = [[t, 'Toggle'], [on, 'On'], [off, 'Off']].filter(([v]) => v);
    if (parts.length > 1) { parts.forEach(([v]) => seen.add(v)); tiles.push({ label: base, keys: parts }); }
    else { seen.add(k); tiles.push({ label: k.label, keys: [[k, '']] }); }
  }
  return tiles;
}
function tileEl({ label, keys }, hit = '') {
  if (pickFor) return editorTile({ label, keys }, hit);
  const k0 = keys[0][0];
  const isNow = keys.some(([k]) => k === pickNow);
  const name = hit ? controls.esc(label).replace(new RegExp(`(${hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'), '<em>$1</em>') : controls.esc(label);
  const b = controls.h(`<div class="pick fam-${family(k0)} ${isNow ? 'cur' : ''} ${keys.length > 1 ? 'fold' : ''}" role="button">${controls.icon(k0.icon, 22)}<span class="pn">${name}</span>${keys.length > 1
    ? `<span class="pseg">${keys.map(([k, t]) => `<button data-l="${controls.esc(k.label)}" class="${k === pickNow ? 'on' : ''}">${t}</button>`).join('')}</span>` : ''}</div>`);
  // Pointer capture retargets the lift to the tile, so the segment is read where the touch began.
  let seg = null;
  controls.pressable(b, { down: e => { seg = e.target.closest?.('button[data-l]'); }, up: () => setSlot(seg ? seg.dataset.l : k0.label) });
  return b;
}
const BASE = /^(.*) (on|off)$/i;
/** A tile in the page editor's picker: dimmed with the reason when its rules refuse it. */
function editorTile({ label, keys }, hit) {
  const k0 = keys[0][0];
  const name = hit ? controls.esc(label).replace(new RegExp(`(${hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'), '<em>$1</em>') : controls.esc(label);
  const base = pickFor.base;
  const pickLabel = base ? (keys.some(([, t]) => t === 'On') ? label : k0.label.replace(BASE, '$1')) : null;
  const segs = base ? [] : keys.filter(([, t]) => t);
  const why = base ? pickFor.refuse(pickLabel) : keys.map(([k]) => pickFor.refuse(k.label)).every(Boolean) ? pickFor.refuse(k0.label) : '';
  const unbound = !why && (base ? !(reach(KEYS.get(`${pickLabel} on`)) && reach(KEYS.get(`${pickLabel} off`))) : !reach(k0));
  const isNow = base ? pickFor.now === pickLabel : keys.some(([k]) => k === pickNow);
  const b = controls.h(`<div class="pick fam-${family(k0)} ${isNow ? 'cur' : ''} ${segs.length > 1 ? 'fold' : ''} ${why ? 'no' : ''}" role="button">${controls.icon(k0.icon, 22)}<span class="pn">${name}${
    why ? `<small class="why">${controls.esc(why.split(/[,.;]/)[0])}</small>` : unbound ? '<small class="amber">Not bound in your game yet</small>' : ''}</span>${segs.length > 1
    ? `<span class="pseg">${segs.map(([k, t]) => `<button data-l="${controls.esc(k.label)}" ${pickFor.refuse(k.label) ? 'disabled' : ''}>${t}</button>`).join('')}</span>` : ''}</div>`);
  let seg = null;
  controls.pressable(b, { down: e => { seg = e.target.closest?.('button[data-l]'); }, up: () => {
    const l = base ? pickLabel : seg ? seg.dataset.l : keys.map(([k]) => k.label).find(x => !pickFor.refuse(x));
    const no = !l || pickFor.refuse(l);
    if (no) { tick('error'); toast(no || why); return; }
    setSlot(l);
  } });
  return b;
}
function section(title, keys, hit) {
  const tiles = fold(keys);
  // In the page editor, what the rules refuse comes last.
  if (pickFor) tiles.sort((a, b) => !!refusedTile(a) - !!refusedTile(b));
  if (!tiles.length) return [];
  return [controls.h(`<div class="pk-h">${controls.esc(title)}</div>`), Object.assign(document.createElement('div'), { className: 'pk-row' })].map((el, i) => {
    if (i) el.append(...tiles.map(t => tileEl(t, hit)));
    return el;
  });
}
function showPickGroup(g) {
  pickTab = g;
  document.querySelectorAll('#pick-tabs .tab[data-g]').forEach(t => t.classList.toggle('cur', t.dataset.g === g && !query));
  paintPick();
}
function paintPick() {
  const out = [];
  const q = query.trim().toLowerCase();
  if (pickFor?.list) {
    const row = Object.assign(document.createElement('div'), { className: 'pk-row' });
    for (const it of pickFor.list) {
      const b = controls.h(`<div class="pick" role="button">${controls.icon('download', 22)}<span class="pn">${controls.esc(it.label)}<small class="why">${controls.esc(it.note || '')}</small></span></div>`);
      controls.pressable(b, { up: () => setSlot(it.label) });
      row.appendChild(b);
    }
    out.push(row);
  } else if (q) {
    const words = q.split(/\s+/);
    const hits = pickKeys().filter(k => words.every(w => k.label.toLowerCase().includes(w))).sort((a, b) => a.label.localeCompare(b.label));
    $('pick-count').textContent = `${hits.length} key${hits.length === 1 ? '' : 's'}`;
    out.push(...section('Results', hits, words[0]));
    if (!hits.length) out.push(controls.h('<p class="pk-none">No key matches</p>'));
  } else {
    $('pick-count').textContent = '';
    if (pickTab === 'sug') for (const [t, keys] of suggested()) out.push(...section(t, keys));
    else {
      const keys = pickKeys().filter(k => groupOf(k) === pickTab).sort((a, b) => a.label.localeCompare(b.label));
      const subs = [...new Set(keys.map(subOf))];
      for (const s of subs) out.push(...section(s, keys.filter(k => subOf(k) === s)));
    }
  }
  $('pick-grid').replaceChildren(...out);
  $('pick-grid').scrollTop = 0;
  $('pick-q').textContent = query || 'Search all keys';
  $('pick-search').classList.toggle('typing', typing);
  $('pick-search').classList.toggle('empty', !query);
  $('pick-kb').hidden = !typing;
  $('picker').classList.toggle('typing', typing);
}
const refusedTile = ({ label, keys }) => (pickFor.base ? pickFor.refuse(keys.some(([, t]) => t === 'On') ? label : keys[0][0].label.replace(BASE, '$1')) : keys.every(([k]) => pickFor.refuse(k.label)));
function setSlot(label) {
  tick('toggle');
  if (pickFor) {
    const o = pickFor;
    pickFor = null; picking = null;
    $('picker').hidden = true;
    if (label && KEYS.has(label)) store.set(RECENT, [label, ...store.get(RECENT, []).filter(l => l !== label)].slice(0, 9));
    if (label) o.onPick(label);
    return;
  }
  const stockPick = pickStock && label === pickStock.label;
  if (label && !stockPick) {
    store.set(picking, label);
    store.set(RECENT, [label, ...store.get(RECENT, []).filter(l => l !== label)].slice(0, 9));
  } else { try { localStorage.removeItem('xfd-' + picking); } catch { /* private mode */ } }
  $('picker').hidden = true;
  cache.delete(picking.split(':')[1]);
  picking = null; pickStock = null; pickNow = null;
  render();
}
// The panel never takes focus from the game, so search types on its own keyboard.
function buildPickKeyboard() {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const kb = $('pick-kb');
  const key = (t, v, cls = '') => {
    const b = controls.h(`<button class="${cls}">${t}</button>`);
    controls.pressable(b, { up: () => {
      tick('tap');
      if (v === 'back') query = query.slice(0, -1);
      else if (v === 'clear') query = '';
      else if (v === 'done') typing = false;
      else query = (query + v).replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
      paintPick();
    } });
    return b;
  };
  kb.append(...rows[0].split('').map(c => key(c, c.toLowerCase())), key('⌫', 'back', 'w'), key('+', '+'),
    ...rows[1].split('').map(c => key(c, c.toLowerCase())), key('Clear', 'clear', 'w'), key('Done', 'done', 'w primary'),
    ...rows[2].split('').map(c => key(c, c.toLowerCase())), key('Space', ' ', 'space'));
}
$('pick-tabs').append(...[['sug', 'Suggested'], ...PICK_GROUPS].map(([g, name]) => {
  const t = controls.h(`<button class="tab" data-g="${g}"><span>${name}</span></button>`);
  controls.pressable(t, { up: () => { tick('page'); query = ''; typing = false; showPickGroup(g); } });
  return t;
}), $('pick-clear'));
buildPickKeyboard();
controls.pressable($('pick-search'), { up: () => { tick('tap'); typing = true; paintPick(); } });
controls.pressable($('pick-clear'), { up: () => setSlot(null) });
controls.pressable($('pick-close'), { up: () => { $('picker').hidden = true; picking = null; pickFor = null; } });

controls.init(K);
initScenes(K);
tp.init(K);

const cache = new Map(); // built plates by page, so switching back is instant
function render() {
  const page = pageById(layout, current);
  pageAccent = theme(page).accent;
  applyAccent();
  if (!cache.has(current)) { slotN = 0; mapN.clear(); cache.set(current, scene(page)); }
  for (const p of cache.get(current)) { phone.unfold(p); p.classList.toggle('moved', !onPhone && !!p.dataset.slot && (moved.has(p.dataset.slot) || (SHIP_PLATES.includes(p.dataset.slot) && !opts.plates.includes(p.dataset.slot)))); }
  $('console').replaceChildren(...cache.get(current));
  const role = moduleOf(current);
  if (role && !CUSTOM.has(current)) arrange.place($('console'), arrange.orderFor(role));
  stack();
  if (!onPhone) fit();
  repaint();
  paintQuantum();
  paintLog();
  world.paint();
  if (tp.isTele(current)) paintGauges();
  paintSoftkeys();
  // A phone folds the plates as painted.
  if (onPhone) fit();
}

function show(id, remote) {
  if (!pageById(layout, id) || arrange.isEditing() || (editor.isOpen() && id !== current)) return;
  if (!remote && id !== current) bridge.share({ page: id });
  if (moduleOf(id)) lastShip = id;
  if (tp.isTele(id)) lastGauges = id;
  const changed = id !== current;
  if (changed && (current === 'world' || id === 'world')) world.showing(id === 'world');
  current = id;
  if (changed) render(); else paintSoftkeys();
}

// Soft keys under the status display.
const SOFT = [
  { label: 'Ship', icon: 'ship', go: () => rolePage || lastShip, is: id => !!moduleOf(id) },
  { label: 'On foot', icon: 'helmet', go: () => 'onfoot', is: id => id === 'onfoot' || id === 'emotes' },
  { label: 'Map', icon: 'map', go: () => 'map', is: id => id === 'map' },
  { label: 'Downed', icon: 'medical', go: () => 'downed', is: id => id === 'downed' },
  { label: 'Log', icon: 'list', go: () => 'log', is: id => id === 'log' },
  { label: 'World', icon: 'globe', go: () => 'world', is: id => id === 'world' },
  { label: 'Gauges', icon: 'gauge', go: () => lastGauges, is: tp.isTele, tele: true },
  { label: 'Settings', icon: 'cog', go: null },
];
function buildSoftkeys() {
  const nav = $('softkeys');
  nav.replaceChildren(...SOFT.map(s => {
    const node = controls.h(`<div class="well"><div class="cap"><span class="led"></span>${controls.icon(s.icon, 18)}<span class="lg">${s.label}</span></div></div>`);
    controls.pressable(node, { up: () => { tick('page'); if (s.go) { openSheet(false); show(s.go()); } else openSheet(true); } });
    s.node = node;
    return node;
  }));
}
// The open Settings sheet takes the highlight from the page under it.
function paintSoftkeys() {
  const sheet = !$('sheet').hidden;
  for (const s of SOFT) s.node?.classList.toggle('cur', sheet ? !s.go : !!s.is?.(current));
  const tl = teleOn();
  $('softkeys').classList.toggle('with-gauges', tl);
  for (const s of SOFT) if (s.tele && s.node) s.node.hidden = !tl;
}

// ---------- settings sheet ----------
// Start with Windows and Screen off live in the app, since they matter before the console loads.
const APP_OPTS = ['autostart', 'screen_off'];
function setOpt(name, v) {
  opts[name] = v;
  if (APP_OPTS.includes(name)) bridge.setPref(name, v); else store.set(name, v);
  if (name === 'stack' || name === 'size') fit();
  if (name === 'plates') render();
  if (name === 'plates' || name === 'size') paintScreenOpts();
  if (name === 'makerTheme') paintStatus();
  if (name === 'vibrate' && onPhone) haptics.enable(v);
  paintNight();
  stage.classList.toggle('large', !!opts.large);
  document.body.classList.toggle('shapes', !!opts.shapes);
  document.body.classList.toggle('calm', !!opts.calm);
  document.querySelectorAll('.opt[data-opt]').forEach(o => o.classList.toggle('on', !!opts[o.dataset.opt]));
  // Mute all wins over the two sound switches, which stay as set for when sound comes back.
  document.querySelectorAll('.opt[data-opt=sound], .opt[data-opt=alertSound]').forEach(o => o.classList.toggle('muted', !!opts.mute));
  $('auto').classList.toggle('on', opts.auto);
  if (name === 'anywhere') paintIdle();
  if (name === 'auto' && v) follow(true);
  if (name === 'layout') { applyTelemetry(); paintLink(); }
  if (name === 'gameSend') gameBinds();
}
const isNight = (d = new Date()) => opts.night === 'on' || (opts.night === 'auto' && (d.getHours() >= NIGHT_FROM || d.getHours() < NIGHT_TO));
// The backlight level last asked of the PC (undefined: not yet), and whether the screen answered.
let nightSent, nightAnswered = null;
function paintNight() {
  const night = isNight();
  stage.classList.toggle('night', night);
  document.querySelectorAll('#night-seg button').forEach(b => b.classList.toggle('cur', b.dataset.v === opts.night));
  document.querySelectorAll('#nightlight-seg button').forEach(b => b.classList.toggle('cur', +b.dataset.v === opts.nightLight));
  const hh = h => `${String(h).padStart(2, '0')}:00`;
  const light = opts.nightLight && nightAnswered !== false ? ` and the backlight to ${opts.nightLight} %` : '';
  $('night-note').textContent = opts.night === 'auto' ? `Dims from ${hh(NIGHT_FROM)} to ${hh(NIGHT_TO)}, now ${night ? 'dimmed' : 'bright'}` : opts.night === 'on' ? `Dims the console${light}` : 'Dims the console for dark rooms';
  $('nightlight-note').textContent = nightAnswered === false ? 'This screen can\'t dim its backlight'
    : !opts.nightLight ? 'Off: only the console dims' : 'Screen backlight at night';
  // The PC turns the backlight down at night and back up after, once per change.
  if (onPhone) return;
  const want = night && opts.nightLight ? opts.nightLight : null;
  if (want === nightSent) return;
  nightSent = want;
  bridge.nightBacklight(want).then(ok => { if (ok != null && ok !== nightAnswered) { nightAnswered = ok; paintNight(); } }).catch(() => {});
}
// ---------- display: which screen the console lives on ----------
async function paintDisplays() {
  const d = await bridge.displays().catch(() => null);
  const box = $('displays');
  if (!d) { box.innerHTML = ''; return; }
  const cur = d.list.find(x => x.id === d.current);
  const card = (id, name, note) => `<button class="disp${(d.picked ?? null) === id ? ' cur' : ''}" data-id="${controls.esc(id ?? '')}"><b>${controls.esc(name)}</b><small>${controls.esc(note)}</small></button>`;
  // Scale shows when the screens differ, which is when a move between them can go wrong.
  const mixed = new Set(d.list.map(x => x.scale ?? 100)).size > 1;
  box.innerHTML = card(null, 'Automatic', cur ? `Now ${cur.name}` : 'Finds the touchscreen') +
    d.list.map(x => card(x.id, x.name, [`${x.width} × ${x.height}`, mixed && x.scale && `${x.scale} % scale`, x.touch && 'touch', x.primary && 'main'].filter(Boolean).join(' · '))).join('');
  box.querySelectorAll('.disp').forEach(b => controls.pressable(b, { up: async () => {
    tick('toggle');
    await bridge.setDisplay(b.dataset.id || null);
    paintDisplays();
  } }));
  const bad = fitWrong(d);
  // One warning row at a time, size first: the touch chip stays on the status screen.
  $('touch-health').hidden = d.touch_ok || bad;
  $('touch-chip').hidden = d.touch_ok;
  $('fit-health').hidden = !bad;
  $('fit-chip').hidden = !bad;
  if (bad) {
    const [[ww, wh], [gw, gh]] = [d.fit.want, d.fit.got];
    $('fit-health').querySelector('b').textContent = `The console is ${gw} × ${gh} on a ${ww} × ${wh} screen`;
    $('fit-health').querySelector('p').textContent = mixed ? 'Windows resized it while moving it between screens of different scale.' : 'Windows did not give it the whole screen.';
    $('act-refit').querySelector('small').textContent = `Moves it onto ${cur?.name || 'its screen'} again and checks the size`;
  }
}
/** The console's size after its last move differs from its screen's. */
const fitWrong = d => !!d?.fit && (d.fit.want[0] !== d.fit.got[0] || d.fit.want[1] !== d.fit.got[1]);
async function refit() {
  const ok = await bridge.refit().catch(() => false);
  toast(ok ? 'The console fills its screen' : 'Still the wrong size. Pick the screen in Settings › Screen, or set both screens to the same scale.');
  paintDisplays(); paintSetup();
}
bridge.onDisplays(() => { paintDisplays(); paintSetup(); });
const TAB_ICONS = { link: 'radar', general: 'cog', screen: 'bulb', feedback: 'pulse', phones: 'phone', binds: 'list', profile: 'person', about: 'download' };
function showSection(sec) {
  document.querySelectorAll('.tab[data-sec]').forEach(t => t.classList.toggle('cur', t.dataset.sec === sec));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.sec !== sec; });
  if (sec === 'screen') paintDisplays();
  if (sec === 'phones') paintPhones();
  if (sec === 'link') paintLink(true);
}
function openSheet(open, sec) {
  if (onPhone) { if (open) phone.openSettings({ set: (plate, mode) => bridge.phoneSet(plate, mode), opts, setOpt, vibrates: !!haptics.can }); return; }
  if (sec) showSection(sec); $('sheet').hidden = !open; paintSoftkeys();
}
document.querySelectorAll('.tab[data-sec]').forEach(t => {
  t.querySelector('svg').innerHTML = GLYPHS[TAB_ICONS[t.dataset.sec]] || '';
  controls.pressable(t, { up: () => { tick('page'); showSection(t.dataset.sec); } });
});
showSection('general');
document.querySelectorAll('.opt[data-opt]').forEach(o => controls.pressable(o, { up: () => { tick('toggle'); setOpt(o.dataset.opt, !opts[o.dataset.opt]); } }));
document.querySelectorAll('#night-seg button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); setOpt('night', b.dataset.v); } }));
document.querySelectorAll('#nightlight-seg button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); setOpt('nightLight', +b.dataset.v); } }));
document.querySelectorAll('#theme-seg button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); setOpt('makerTheme', b.dataset.v); } }));
document.querySelectorAll('#layout-seg button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); setOpt('layout', b.dataset.v); } }));
document.querySelectorAll('#plates-seg button').forEach(b => controls.pressable(b, { up: () => {
  const v = b.dataset.v, on = opts.plates.includes(v);
  if (on && opts.plates.length === 1) { tick('arm'); toast('Keep at least one plate on this screen'); return; }
  tick('toggle');
  setOpt('plates', on ? opts.plates.filter(x => x !== v) : SHIP_PLATES.filter(x => x === v || opts.plates.includes(x)));
} }));
document.querySelectorAll('#size-seg button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); setOpt('size', b.dataset.v); } }));
function paintScreenOpts() {
  document.querySelectorAll('#plates-seg button').forEach(b => b.classList.toggle('cur', opts.plates.includes(b.dataset.v)));
  document.querySelectorAll('#size-seg button').forEach(b => b.classList.toggle('cur', b.dataset.v === opts.size));
  $('plates-note').textContent = opts.plates.length === SHIP_PLATES.length ? 'The rest grow to fill' : `${SHIP_PLATES.length - opts.plates.length} left out. The rest grow`;
  $('size-note').textContent = opts.size === 'actual' ? 'Designed size, never larger' : 'Grows the console to fill the screen';
}
paintScreenOpts();
controls.pressable($('sheet-close'), { up: () => openSheet(false) });
controls.pressable($('auto'), { up: () => { tick('toggle'); setOpt('auto', !opts.auto); } });
async function installBinds() {
  try { await bridge.installBinds(); toast('Added. In game: Options, Keybindings, Control Profiles, pick "edge-cockpit", tick Keyboard and Mouse.'); }
  catch (e) { toast(String(e?.message || e)); }
}
// ---------- wipe lock: touches off for a while, to clean the screen ----------
const WIPE_S = 15;
let wipeEnd = 0, wipeTimer = 0;
function wipe(on = true) {
  clearInterval(wipeTimer);
  $('wipe').hidden = !on;
  if (!on) return;
  wipeEnd = Date.now() + WIPE_S * 1000;
  const paint = () => {
    const left = Math.ceil((wipeEnd - Date.now()) / 1000);
    if (left <= 0) { wipe(false); return; }
    $('wipe-left').textContent = `Touches are off for ${left} s`;
  };
  paint();
  wipeTimer = setInterval(paint, 1000);
}
// Every press on the lock is swallowed; holding it 1 s ends it early.
{
  let hold = 0;
  const box = $('wipe');
  box.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); clearTimeout(hold); hold = setTimeout(() => { tick('tap'); wipe(false); }, 1000); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(ev, () => clearTimeout(hold));
  box.addEventListener('contextmenu', e => e.preventDefault());
  // The clock: hold 1 s to start it.
  let clockHold = 0;
  $('clock').addEventListener('pointerdown', e => { clockHold = setTimeout(() => { tick('toggle'); wipe(true); }, 1000); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('clock').addEventListener(ev, () => clearTimeout(clockHold));
}
// The game saved new binds: read them again and say what that did to the console's keys.
bridge.onBinds(async () => {
  const before = bindHealth();
  await reloadBinds();
  const after = bindHealth();
  const lost = after.missing.length + after.stick.length - before.missing.length - before.stick.length;
  toast(lost > 0 ? `Binds changed in game: ${lost} console ${lost === 1 ? 'key has' : 'keys have'} no keyboard bind now` : lost < 0 ? `Binds changed in game: ${-lost} more console ${lost === -1 ? 'key works' : 'keys work'}` : 'Binds changed in game');
});
// ---------- report a problem: a report file and a bug form filled in; nothing is sent ----------
async function reportData() {
  const [sys, shown] = await Promise.all([bridge.reportInfo().catch(() => ({})), bridge.displays().catch(() => ({ list: [] }))]);
  const h = bindHealth();
  return {
    at: new Date().toISOString(), version: prefs.version, os: sys.os, webview: sys.webview,
    screens: (shown.list || []).map(d => ({ ...d, current: d.id === shown.current })),
    game: { channel: info.channel, build: game.build?.branch ? version(game.build.branch) : null, changelist: game.build?.changelist, running: info.running },
    binds: { total: h.total, missing: h.missing.length, stick: h.stick.length, shared: h.shared.length, copies: backups?.copies?.length ?? 0, lost: !!backups?.lost },
    page: current, ship: game.ship || null, settings: opts, missing: $('patch').hidden ? null : $('patch').dataset.miss,
    lines: recent, me: game.me?.name,
  };
}
async function reportProblem(title = 'Bug: ') {
  const d = await reportData();
  let path = null;
  try { path = await bridge.saveReport(reportText(d)); }
  catch (err) { toast(`No report file: ${err?.message || err}. The bug form opens anyway.`); }
  const opened = await bridge.reportIssue(title, issueBody(d, path));
  toast(opened === false ? 'Could not open the browser. The report is in Documents\\Edge Cockpit\\report.txt' : 'Report saved. Drag report.txt into the bug form.');
}
const acts = { 'act-binds': [() => reloadBinds().then(() => toast('Binds reloaded')), 'reload'], 'act-install': [installBinds, 'layers'],
  'act-restore': [restoreBinds, 'back'], 'act-keep': [keepBinds, 'x'], 'act-report': [() => reportProblem(), 'chat'],
  'act-admin': [bridge.runAsAdmin, 'shield'], 'act-sleep': [() => { openSheet(false); bridge.sleepScreen(); }, 'moon'],
  'act-refit': [refit, 'reload'], 'act-update': [installUpdate, 'download'], 'act-touch': [() => bridge.fixTouch().then(ok => ok || toast('Windows did not open its touchscreen setup. Open Tablet PC Settings, then Setup.')), 'hand'], 'act-save': [saveProfile, 'download'], 'act-load': [loadProfile, 'reload'], 'act-quit': [bridge.quit, 'power'], 'act-setup': [() => { openSheet(false); showSetup(); }, 'hand'], 'act-wipe': [() => { openSheet(false); wipe(true); }, 'wiper'], 'act-legend': [() => { openSheet(false); showLegend(); }, 'help'], 'act-telemetry': [toggleTelemetry, 'power'], 'act-record': [toggleRecord, 'camera'] };
for (const [id, [run, icon]] of Object.entries(acts)) {
  $(id).querySelector('svg').innerHTML = GLYPHS[icon] || '';
  controls.pressable($(id), { up: () => { tick('tap'); run(); } });
}
$('qt').querySelector('svg').innerHTML = GLYPHS.quantum;

// ---------- profile: settings, plate order, ship roles and keyboard binds in one file ----------
// Saved as Documents\Edge Cockpit\profile.json, to copy to another PC or keep as a backup.
const PROFILE_OPTS = ['layout', 'gameSend', 'night', 'nightLight', 'sound', 'flash', 'auto', 'recap', 'alertSound', 'mute', 'anywhere', 'stack', 'large', 'shapes', 'calm', 'makerTheme', 'plates', 'size', 'autostart', 'screen_off'];
const KEPT_AS_IS = new Set(['layout', 'night', 'nightLight', 'makerTheme', 'plates', 'size']);
/** The keyboard binds in an actionmaps.xml, as a Control Profile the game can load. */
function bindsProfile(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const e = controls.esc, maps = [];
  doc.querySelectorAll('actionmap').forEach(m => {
    const acts = [];
    m.querySelectorAll(':scope > action').forEach(a => {
      const kb = [...a.querySelectorAll('rebind')].map(r => r.getAttribute('input') || '').find(i => /^kb\d*_/.test(i));
      if (kb !== undefined) acts.push(`  <action name="${e(a.getAttribute('name'))}">\n   <rebind input="${e(kb)}"/>\n  </action>`);
    });
    if (acts.length) maps.push(` <actionmap name="${e(m.getAttribute('name'))}">\n${acts.join('\n')}\n </actionmap>`);
  });
  if (!maps.length) return null;
  return `<ActionMaps version="1" optionsVersion="2" rebindVersion="2" profileName="edge-cockpit-profile">
 <CustomisationUIHeader label="edge-cockpit-profile" description="Keyboard binds from an Edge Cockpit profile" image="">
  <devices>
   <keyboard instance="1"/>
  </devices>
 </CustomisationUIHeader>
 <modifiers/>
${maps.join('\n')}
</ActionMaps>
`;
}
async function saveProfile() {
  const plates = {}, slots = {}, keys = {}, modules = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('xfd-order:')) plates[k.slice(10)] = store.get(k.slice(4), null);
    if (k?.startsWith('xfd-slot:')) slots[k.slice(9)] = store.get(k.slice(4), null);
    if (k?.startsWith('xfd-map:')) keys[k.slice(8)] = store.get(k.slice(4), null);
    if (k?.startsWith('xfd-module:')) modules[k.slice(11)] = store.get(k.slice(4), null);
  }
  const ships = await bridge.userShips().catch(() => null);
  const binds = await bridge.readBinds().catch(() => null);
  const profile = {
    app: 'edge-cockpit', format: 1, version: prefs.version, saved: new Date().toISOString(),
    settings: Object.fromEntries(PROFILE_OPTS.map(k => [k, KEPT_AS_IS.has(k) ? opts[k] : !!opts[k]])),
    plates,
    slots,
    keys,
    modules,
    pages: storedPages(),
    ships: (() => { try { return ships ? JSON.parse(ships) : null; } catch { return null; } })(),
    binds: binds ? bindsProfile(binds) : null,
  };
  try { toast(`Profile saved to ${await bridge.saveProfile(JSON.stringify(profile, null, 2))}`); }
  catch (e) { toast(`The profile was not saved: ${e?.message || e}`); }
}
async function loadProfile() {
  let p = null;
  try { p = JSON.parse(await bridge.loadProfile() || 'null'); } catch { /* not JSON */ }
  if (p?.app !== 'edge-cockpit') { toast('No profile found. Put a profile.json in Documents\\Edge Cockpit, then load it.'); return; }
  for (const k of PROFILE_OPTS) {
    const v = p.settings?.[k];
    if (k === 'night' && v !== undefined) setOpt(k, nightMode(v));
    else if (k === 'nightLight' && v !== undefined) setOpt(k, nightLevel(v));
    else if (k === 'makerTheme' && v !== undefined) setOpt(k, themeMode(v));
    else if (k === 'plates' && v !== undefined) setOpt(k, platesMode(v));
    else if (k === 'size' && (v === 'fit' || v === 'actual')) setOpt(k, v);
    else if (typeof v === 'boolean') setOpt(k, v);
  }
  for (const [role, order] of Object.entries(p.plates || {})) if (Array.isArray(order)) store.set(`order:${role}`, order);
  for (const [slot, label] of Object.entries(p.slots || {})) if (typeof label === 'string' && KEYS.has(label)) store.set(`slot:${slot}`, label);
  for (const [id, label] of Object.entries(p.keys || {})) if (typeof label === 'string' && KEYS.has(label)) store.set(`map:${id}`, label);
  for (const [role, m] of Object.entries(p.modules || {})) if (typeof m === 'string' && MODULE_NAMES[m]) store.set(`module:${role}`, m);
  // Pages of yours in the profile replace the ones by the same id.
  for (const raw of Array.isArray(p.pages) ? p.pages : []) { const spec = cleanPage(raw); if (spec) putPage(spec.id, spec); }
  loadPages();
  if (p.ships && typeof p.ships === 'object') await bridge.saveUserShips(JSON.stringify(p.ships, null, 2)).catch(() => {});
  let note = 'Profile loaded.';
  if (typeof p.binds === 'string') {
    try { await bridge.installProfileBinds(p.binds); note += ' For its binds, pick "edge-cockpit-profile" in the game\'s Control Profiles.'; }
    catch (e) { note += ` Its binds were not added: ${e?.message || e}`; }
  }
  await loadUserShips();
  cache.clear();
  render();
  toast(note);
}

// ---------- screen off ----------
// The app turns the screen off when the game isn't running. The console then shows
// nothing at all and draws nothing; a touch anywhere wakes it.
function setDark(dark) {
  $('dark').hidden = !dark;
  document.body.classList.toggle('is-dark', dark);
  if (dark) { openSheet(false); bridge.releaseKeys(); }
}
bridge.onScreen?.(setDark);
$('dark').addEventListener('pointerdown', () => bridge.wakeScreen());

// ---------- updates ----------
// Checked a little after start and every six hours after that, never while the game runs.
let update = null;
function notesHtml(md) {
  const out = [];
  for (const raw of (md || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const text = controls.esc(line.replace(/^[-*]\s+|^#+\s*/, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
    out.push(/^#+\s/.test(line) ? `<h4>${text}</h4>` : /^[-*]\s/.test(line) ? `<li>${text}</li>` : `<p>${text}</p>`);
  }
  return out.join('');
}
function paintUpdate() {
  const chip = $('update');
  chip.hidden = !update;
  if (update) chip.querySelector('span').textContent = `Update ${update.version}`;
  $('act-update').hidden = !update;
  $('tab-dot').hidden = !update;
  const seen = store.get('whats-new', null);
  const notes = update?.notes || (seen?.version === prefs.version ? seen.notes : '');
  $('upd-state').textContent = update ? `Version ${update.version} is ready. What's new:` : notes ? `What's new in ${prefs.version}:` : 'Up to date. Checks while you are not playing.';
  $('upd-notes').hidden = !notes;
  $('upd-notes').innerHTML = notesHtml(notes);
  paintPrompt();
}
// ---------- session recap ----------
// When you leave the game: how long you played and what the log saw, from this session's lines only.
let session = { ...NEW_TALLY };
function showRecap() {
  const t = session, mins = minutes(t);
  if (!opts.recap || onPhone || !t.start || mins < 1) return;
  const ships = t.ships.map(m => lookup(shipsDb.ships, overrides.ships, m)?.name || shipName(m));
  const stat = (n, label) => `<div class="rc-stat"><b>${n}</b><span>${label}</span></div>`;
  $('rc-time').textContent = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  $('rc-stats').innerHTML = [t.kills ? stat(t.kills, 'Kills') : stat(t.injuries, t.injuries === 1 ? 'Injury' : 'Injuries'), stat(t.deaths, t.deaths === 1 ? 'Time down' : 'Times down'),
    stat(t.missions, t.missions === 1 ? 'Mission done' : 'Missions done'), stat(t.routes, t.routes === 1 ? 'Route set' : 'Routes set'),
    t.failed ? stat(t.failed, 'Failed') : '', t.crimeMax ? stat(t.crimeMax, 'Top CrimeStat') : ''].join('');
  const row = (k, v) => (v.length ? `<p><small>${k}</small>${v.map(controls.esc).join(' · ')}</p>` : '');
  $('rc-lists').innerHTML = row('Flew', ships) + row('Visited', t.places) + (t.dropped ? `<p class="ended"><small>Ended</small>${controls.esc(droppedText(t.dropped))}</p>` : '');
  $('recap').hidden = false;
  session = { ...NEW_TALLY };
}
controls.pressable($('rc-close'), { up: () => { tick('tap'); $('recap').hidden = true; } });

// ---------- setup check: on first run, and from Settings > General ----------
// Each row says only what the app can see. Admin rights are known only while the game is in front.
let setupOpen = false;
async function paintSetup() {
  if (!setupOpen) return;
  const d = await bridge.displays().catch(() => null);
  const touch = d?.list.find(x => x.touch);
  const h = bindHealth(), bad = h.missing.length + h.stick.length;
  const ch = info.channel ? info.channel.split(/[\\/]/).pop().toUpperCase() : null;
  const cur = d?.list.find(x => x.id === d.current);
  const scales = d && new Set(d.list.map(x => x.scale ?? 100)).size > 1 ? ` Main screen at ${d.list.find(x => x.primary)?.scale ?? 100} %.` : '';
  const rows = [
    !d || !cur ? ['unknown', 'Screen', 'Checked in the app.']
      : fitWrong(d) ? ['warn', `The console is ${d.fit.got[0]} × ${d.fit.got[1]} on ${cur.name}`, `It should be ${d.fit.want[0]} × ${d.fit.want[1]}. Refit moves it again.`, 'Refit', refit]
      : ['ok', `Console fills ${cur.name}`, `${cur.width} × ${cur.height}${cur.scale ? ` at ${cur.scale} % scale` : ''}.${scales}`],
    !d ? ['unknown', 'Touchscreen', 'Checked in the app.']
      : !touch ? ['warn', 'No touchscreen found', 'The console works with a mouse too. Plug in the touchscreen\'s USB cable for touch.']
      : !d.touch_ok ? ['warn', 'Touches land on another display', `Windows maps ${touch.name}'s touches to the wrong screen.`, 'Fix touch', () => bridge.fixTouch()]
      : ['ok', 'Touchscreen found', `${touch.name}, ${touch.width} × ${touch.height}. Touches map to it.`],
    !ch ? ['warn', 'Star Citizen not found yet', 'Start the game once. The console finds it from the running game.']
      : ['ok', 'Star Citizen found', `${ch}${game.build?.branch ? ' ' + version(game.build.branch) : ''} · ${info.log ? 'Game.log readable' : 'no Game.log yet'}`],
    bad ? ['warn', 'Pick the edge-cockpit control profile', `In game: Options › Keybindings › Control Profiles › edge-cockpit, Keyboard and Mouse. ${bad} ${bad === 1 ? 'key waits' : 'keys wait'} on it.`, 'Add binds', installBinds]
      : h.mouse.length ? ['warn', 'Pick the edge-cockpit control profile again', `In game: Options › Keybindings › Control Profiles › edge-cockpit, Keyboard and Mouse. It gives back ${listOf(h.mouse)}.`, 'Add binds', installBinds]
      : h.held.length ? ['warn', 'Pick the edge-cockpit control profile again', `In game: Options › Keybindings › Control Profiles › edge-cockpit, Keyboard and Mouse. Some keys also fire another action: ${listOf(h.held, 2)}.`, 'Add binds', installBinds]
      : ['ok', 'Every key has a bind', `All ${h.total} keys the console uses have a keyboard bind.`],
    info.game_elevated == null ? ['unknown', 'Admin rights', 'Checked while the game is in front.']
      : info.game_elevated && !info.elevated ? ['warn', 'The game runs as administrator', 'Windows drops keys from the console unless it does too.', 'Restart as admin', bridge.runAsAdmin]
      : ['ok', 'Same rights as the game', info.elevated ? 'Both run as administrator.' : 'Neither runs as administrator.'],
  ];
  const ready = rows.filter(r => r[0] === 'ok').length;
  $('su-count').textContent = `Setup · ${ready} of ${rows.length} ready`;
  const esc = controls.esc;
  $('su-rows').innerHTML = rows.map(([cls, b, p, btn], i) => `<div class="su-row ${cls}"><i></i><div class="txt"><b>${esc(b)}</b><p>${esc(p)}</p></div>${btn ? `<button data-i="${i}">${esc(btn)}</button>` : ''}</div>`).join('');
  $('su-rows').querySelectorAll('button').forEach(b => controls.pressable(b, { up: () => { tick('tap'); rows[b.dataset.i][4](); } }));
}
function showSetup() { setupOpen = true; $('setup').hidden = false; $('su-test').textContent = ''; paintSetup(); }
controls.pressable($('su-done'), { up: () => {
  tick('tap'); setupOpen = false; $('setup').hidden = true; store.set('setup-done', true);
  // The first time, the legend follows the setup check.
  if (!store.get('legend-seen', false)) showLegend();
} });
// ---------- controls legend: once after the first setup check, then from the ? on the status screen ----------
// Each sample is drawn with the console's own key styles, so it looks like the key it explains.
const LEGEND = [
  ['<div class="well key fam-flt"><div class="cap"><span class="lg">Autoland</span><span class="kb">N</span></div></div>', 'Tap', 'Sends the key once. The letters bottom right are its bind in the game.'],
  ['<div class="well key fam-wpn"><div class="cap"><span class="lg">Fire</span><svg class="ring-h" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><circle class="f" cx="8" cy="8" r="6" pathLength="1"/></svg></div></div>', 'Ring: hold', 'The key stays down while your finger does, like holding it in game. The ring fills while held.'],
  ['<div class="well key fam-wpn"><div class="cap"><span class="lg">Decoy</span><span class="tg">LONG</span></div></div>', 'LONG or 2×', 'Press and hold, or tap twice, for a second action. Its name shows at the bottom of the screen when it goes.'],
  ['<div class="well key fam-sys cut"><div class="cap"><span class="lg">Flight ready</span><span class="notch"></span></div></div>', 'Notched corner: macro', 'Several keys in turn, such as power on and Flight Ready.'],
  ['<div class="well pair fam-flt"><div class="cap half a"><span class="lg">On</span><span class="led"></span></div><div class="cap half b"><span class="lg">Off</span><span class="led"></span></div></div>', 'On and off', 'Sets it on or off in game. Dark until you set it here, as the game never says which it is.', 'Sets it on or off in game. Lit with the game\'s own state while telemetry is live; dark for what the game doesn\'t send (doors, port locks).'],
  ['<div class="well key fam-flt"><div class="cap glamp glamp-on"><span class="lg">G-safe</span><span class="lv"></span><span class="lvt">On</span></div></div>', 'Lamp: the game says', 'A toggle with its state from the game. Only while telemetry is live.', null, true],
  ['<div class="well key fam-emg"><div class="cap"><span class="lg">Self destruct</span><span class="tg">GUARD</span></div></div>', 'GUARD', 'Tap twice within 3 s. The first tap only arms it.'],
  ['<div class="guard"><div class="cover"><span class="hinge"></span><span>LIFT COVER</span></div></div>', 'Cover', 'The first tap lifts it, a second within 3 s sends the key.'],
  ['<div class="well key fam-flt"><div class="cap"><span class="lg">Ping</span><span class="mine"></span></div></div>', 'Cyan dot: your key', 'A key you swapped in. Long press it to change it again or go back to stock.'],
  ['<div class="lgd-fams"><i class="fam-wpn"></i><i class="fam-flt"></i><i class="fam-sys"></i><i class="fam-emg"></i></div>', 'Colours', 'Weapons amber, flight cyan, systems white, emergency red.'],
  ['<div class="well blank"><div class="cap"><span class="lg">Not fitted</span></div></div>', 'Not fitted', 'The ship lacks that kit. Hold the slot to put a key of yours there.'],
];
function showLegend() {
  const esc = controls.esc;
  // With telemetry live, the switches show the game's state, so the legend says so.
  const live = teleOn();
  $('lgd-rows').innerHTML = LEGEND.filter(r => live || !r[4]).map(([sample, b, p0, p1]) => [sample, b, live && p1 ? p1 : p0]).map(([sample, b, p]) => `<div class="lgd-row"><div class="lgd-s" aria-hidden="true">${sample}</div><div class="txt"><b>${esc(b)}</b><p>${esc(p)}</p></div></div>`).join('');
  $('legend').hidden = false;
}
controls.pressable($('lgd-done'), { up: () => { tick('tap'); $('legend').hidden = true; store.set('legend-seen', true); } });
controls.pressable($('help'), { up: () => { tick('tap'); showLegend(); } });

// Test a key: mobiGlas, which opens and closes without changing anything in game.
controls.pressable($('su-key'), { up: async () => {
  const k = KEYS.get('mobiGlas'), out = $('su-test');
  const ok = await fire(k, $('su-key'));
  out.className = 'su-test ' + (ok ? 'ok' : 'warn');
  out.textContent = ok ? `Sent ${keyText(bindOf(k))}. mobiGlas should open in game; test again to close it.` : 'Not sent. The message at the bottom says why.';
} });

/** Asks once per version, with its notes, and only while the game isn't running. Later waits for the next version. */
function paintPrompt() {
  const ask = !!update && !info.running && store.get('upd-later', null) !== update.version;
  const el = $('upd-prompt');
  if (ask && el.hidden) {
    $('upd-p-title').textContent = `Edge Cockpit ${update.version}`;
    $('upd-p-notes').innerHTML = notesHtml(update.notes) || '<p>Fixes and improvements.</p>';
    tick('tap');
  }
  el.hidden = !ask;
}
controls.pressable($('upd-later'), { up: () => { tick('tap'); store.set('upd-later', update?.version); paintPrompt(); } });
controls.pressable($('upd-now'), { up: () => { tick('tap'); $('upd-prompt').hidden = true; installUpdate(); } });
async function checkUpdate() {
  if (!bridge.inApp || info.running) return;
  try { update = await bridge.checkUpdate(); } catch { update = null; }
  paintUpdate();
}
async function installUpdate() {
  if (!update) return;
  if (info.running) { toast('Updates install when you are not playing'); return; }
  store.set('whats-new', { version: update.version, notes: update.notes, fresh: true });
  toast(`Installing ${update.version}. The console restarts in a few seconds.`);
  try { await bridge.installUpdate(); } catch (e) { toast(`The update failed: ${e?.message || e}`); }
}
controls.pressable($('update'), { up: () => { tick('tap'); openSheet(true, 'about'); } });
controls.pressable($('binds-chip'), { up: () => { tick('tap'); openSheet(true, 'binds'); } });
controls.pressable($('touch-chip'), { up: () => { tick('tap'); openSheet(true, 'screen'); } });
$('touch-chip').querySelector('span').textContent = 'Touch on another display';
controls.pressable($('fit-chip'), { up: () => { tick('tap'); refit(); } });
$('fit-chip').querySelector('span').textContent = 'Console too small · Refit';
controls.pressable($('act-identify'), { up: () => { tick('tap'); bridge.identifyScreens().catch(() => toast('Shows each screen\'s name on it, in the app')); } });
$('toast-act').addEventListener('pointerdown', e => e.stopPropagation());

// ---------- game state ----------
// here: when Game.log last named your place, and whether you travelled since.
let placeSeen = { at: 0, moved: false };
let game = { ...EMPTY }, ship = null, lastAuto = null, lastSeq = 0;
const MAKERS = { AEGS: '#ff6b5b', ANVL: '#7fb2ff', DRAK: '#ff9f43', MISC: '#5fe0c8', RSI: '#9fb4ff', ORIG: '#f5f0e6', CRUS: '#6ec1ff', ARGO: '#f0b54a',
  CNOU: '#9be15d', ESPR: '#c49bff', KRIG: '#e0c070', BANU: '#d4a373', MRAI: '#ff7eb6', TMBL: '#f7d154', GRIN: '#b0e0a8', XIAN: '#7ef0ff', CRSD: '#6ec1ff', GAMA: '#c0d0e0' };
const glyph = n => `<svg class="i" viewBox="0 0 24 24">${GLYPHS[n] || ''}</svg>`;

// Maker names as plain text, for the large faint type behind the status screen.
const MAKER_NAMES = { AEGS: ['Aegis', 'Dynamics'], ANVL: ['Anvil', 'Aerospace'], DRAK: ['Drake', 'Interplanetary'], MISC: ['MISC', 'Musashi Industrial'],
  RSI: ['RSI', 'Roberts Space Industries'], ORIG: ['Origin', 'Jumpworks'], CRUS: ['Crusader', 'Industries'], CRSD: ['Crusader', 'Industries'],
  ARGO: ['Argo', 'Astronautics'], CNOU: ['Consolidated', 'Outland'], ESPR: ['Esperia', ''], KRIG: ['Kruger', 'Intergalactic'], BANU: ['Banu', ''],
  MRAI: ['Mirai', ''], TMBL: ['Tumbril', 'Land Systems'], GRIN: ['Greycat', 'Industrial'], XIAN: ['Aopoa', ''], GAMA: ['Gatac', 'Manufacture'] };

// The backdrop behind the status screen: the ship's render from FleetYards (fetched once,
// then kept), dimmed and faded, over the maker's name. Without a render (offline, or none),
// themed makers get their line art instead. A dark fade keeps the text readable.
let backdropKey = null;
// Shrinks one line of text from `max` px until it fits its box.
function fitText(el, max, min = 1) {
  el.style.fontSize = max + 'px';
  const room = el.clientWidth, need = el.scrollWidth;
  if (need > room) el.style.fontSize = Math.max(min, Math.floor(max * room / need)) + 'px';
}
function paintBackdrop(cls, artMaker, nameMaker) {
  const key = `${cls}|${artMaker}|${nameMaker}`;
  if (key === backdropKey) return;
  backdropKey = key;
  const mfd = $('mfd');
  mfd.querySelectorAll(':scope > .art, :scope > .shot, :scope > .mkname').forEach(e => e.remove());
  mfd.classList.remove('rendered');
  const art = () => {
    if (!artMaker || mfd.querySelector(':scope > .art')) return;
    mfd.prepend(controls.h(`<svg class="art" viewBox="0 0 338 588" preserveAspectRatio="none" aria-hidden="true">${ART[artMaker]()}<rect x="0" y="200" width="338" height="388" fill="url(#art-fade)"/></svg>`));
  };
  const words = MAKER_NAMES[nameMaker];
  if (words) {
    const t = document.createElement('div');
    t.className = 'mkname';
    t.setAttribute('aria-hidden', 'true');
    const b = document.createElement('b'), s = document.createElement('small');
    b.textContent = words[0]; s.textContent = words[1];
    t.append(b, s);
    mfd.append(t);
    // Sized by measuring, so long names (Crusader, Consolidated) fit the screen's width.
    fitText(b, 76); fitText(s, 15);
    requestAnimationFrame(fitMakerName);
  }
  if (!cls) return art();
  shipRender(cls).then(url => {
    if (backdropKey !== key) return;
    if (!url) return art();
    const img = new Image();
    img.className = 'shot'; img.alt = ''; img.decoding = 'async'; img.src = url;
    mfd.prepend(img);
    mfd.classList.add('rendered');
  });
}
let figureFor = null; // the ship whose outline is showing or loading
function paintFigure(fig, cls, fallback) {
  if (figureFor === cls) return;
  figureFor = cls;
  fig.innerHTML = fallback;
  // Outlines come from FleetYards the first time and are cached on disk after that.
  outline(cls).then(svg => { if (svg && figureFor === cls) fig.innerHTML = svg; });
}

// With no game to send to, the controls grey out (not in Test mode, which sends anywhere).
const paintIdle = () => stage.classList.toggle('idle', !info.running && !opts.anywhere);
function paintStatus() {
  const fig = $('figure');
  fig.classList.remove('wait');
  let name, role;
  if (!info.running && game.menu) {
    name = 'Standing by'; role = 'Waiting for Star Citizen';
    figureFor = null; fig.innerHTML = glyph('ship'); fig.classList.add('wait');
  } else if (game.menu) { name = 'Main menu'; role = 'Loading or between sessions'; figureFor = null; fig.innerHTML = glyph('layers'); fig.classList.add('wait'); }
  else if (game.down) { name = 'Downed'; role = 'Call for help or wait for medical'; figureFor = null; fig.innerHTML = glyph('medical'); }
  else if (game.seated && game.ship) {
    name = ship?.name || game.ship.replace(/^[A-Z]{3,5}_/, '').replace(/_/g, ' ');
    const r = layout.roles.find(x => x.id === ship?.role);
    role = (r ? r.name : 'Ship') + ' · pilot seat';
    paintFigure(fig, game.ship, glyph(theme(pageById(layout, current)).glyph || 'ship'));
  } else {
    name = game.me?.name || 'On foot';
    // On foot, the ship you last flew stays in view, dimmed.
    const last = store.get('last-ship', null);
    const lastName = last && (lookup(shipsDb.ships, overrides.ships, last)?.name || last.replace(/^[A-Z]{3,5}_/, '').replace(/_/g, ' '));
    role = last ? `On foot · last flew ${lastName}` : game.me ? 'On foot' : 'In the verse';
    if (last) { paintFigure(fig, last, glyph('helmet')); fig.classList.add('parked'); }
    else { figureFor = null; fig.innerHTML = glyph('helmet'); }
  }
  fig.classList.toggle('parked', !game.seated && !game.menu && !game.down && !!store.get('last-ship', null));
  if (game.seated && game.ship && store.get('last-ship', null) !== game.ship) store.set('last-ship', game.ship);
  const maker = game.seated && game.ship ? MAKERS[game.ship.split('_')[0]] : null;
  makerAccent = maker;
  applyAccent();
  stage.style.setProperty('--ship', maker || 'var(--accent)');
  // Maker themes: the plate metal and title trim of the maker of the ship you sit in.
  const code = game.seated && game.ship ? game.ship.split('_')[0] : null;
  const themeCode = opts.makerTheme === 'auto' ? code : opts.makerTheme;
  if (THEMED.has(themeCode)) stage.dataset.maker = themeCode; else delete stage.dataset.maker;
  const off = opts.makerTheme === 'off', artMaker = THEMED.has(themeCode) ? themeCode : null;
  paintBackdrop(off ? null : game.seated && game.ship || null, artMaker, off ? null : code || artMaker);
  document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('cur', b.dataset.v === opts.makerTheme));
  paintIdle();
  // Long names (Constellation Andromeda) shrink to one line rather than run into the role below.
  if ($('ship-name').textContent !== name) { $('ship-name').textContent = name; fitText($('ship-name'), 28, 16); }
  baseRole = role;
  $('ship-role').textContent = role;

  // Law: red for CrimeStat; amber outside monitored space, with comms down or in lawless
  // space (calls for help go nowhere); green in armistice.
  const law = $('law');
  let lawText = null, lawCls = '';
  if (game.crime > 0) { lawText = `CrimeStat ${game.crime}`; lawCls = 'bad'; }
  else if (game.restricted) { lawText = 'Restricted area'; lawCls = 'warn'; }
  else if (game.private) { lawText = 'Private property'; lawCls = 'warn'; }
  else if (game.monitored === 'down') { lawText = 'Comms down'; lawCls = 'warn'; }
  else if (game.monitored === 'no') { lawText = 'Unmonitored'; lawCls = 'warn'; }
  else if (lawless(game) && !game.jurisdiction) { lawText = 'Lawless'; lawCls = 'warn'; }
  else if (game.armistice) { lawText = 'Armistice'; lawCls = 'ok'; }
  else if (game.monitored === 'yes') { lawText = 'Monitored'; lawCls = 'info'; }
  law.hidden = !lawText || game.menu;
  law.className = 'chip ' + lawCls;
  law.querySelector('span').textContent = lawText || '';
  // Where: the place you last opened an inventory at, then its kind, system and jurisdiction.
  const at = game.location ? place(game.location) : null;
  const juris = (game.jurisdiction || '').replace(/ Jurisdiction$/, '');
  const ungoverned = /ungoverned|lawless|unclaimed/i.test(juris);
  $('where').hidden = game.menu || (!at && !juris);
  $('where-name').textContent = at ? [at.name, at.system].filter(Boolean).join(' · ') : juris;
  $('where-note').innerHTML = [at?.kind, at && juris].filter(Boolean).map(t => controls.esc(t)).join(' · ')
    .replace(controls.esc(juris), ungoverned && at ? `<em>${controls.esc(juris)}</em>` : controls.esc(juris));
  $('where').classList.toggle('lawless', ungoverned && !at);
  paintOrrery(at);

  const chip = (id, text, cls = '') => { const c = $(id); c.hidden = !text || game.menu; c.className = 'chip ' + cls; c.querySelector('span').textContent = text || ''; };
  chip('kills', game.kills ? `Kills ${game.kills}` : null, 'info');
  // Injuries the game reported, the one needing the most care first. A med pen logs nothing, so a tap clears them.
  const hurt = worstInjury(game.injuries), more = game.injuries.length - 1;
  chip('injury', hurt ? `${hurt.limb} · tier ${hurt.tier}${more > 0 ? ` +${more}` : ''}` : null, 'warn');
  chip('fuel', game.lowFuel && game.seated ? 'Low fuel' : null, 'warn');
  chip('party', game.party ? `Party jump calibrating${game.party.calibrating ? ` · ${game.party.calibrating}` : ''}` : null, 'info');
  // Why the game threw you out shows at the menu too, until you are back in or tap it.
  const drop = $('dropped');
  drop.hidden = !game.dropped;
  drop.querySelector('span').textContent = droppedText(game.dropped) || '';
  chip('wreck', game.wrecked && game.seated ? (game.wrecked > 1 ? 'Ship destroyed' : 'Ship disabled') : null, 'bad');
  // The ship you called at a fleet terminal, or the hangar ATC gave you, as far as the log tells.
  const hangar = hangarText(game);
  chip('hangar', hangar, /ready|assigned/.test(hangar || '') ? 'ok' : 'info');
  // A game build of another major version than the panel knows: say so, and carry on.
  const odd = untested(game);
  $('build').hidden = !odd;
  $('build').querySelector('span').textContent = odd ? `Untested build ${version(game.build.branch)}` : '';
  // Quantum: where the drive is set to, from the route or the marker, then where it arrived.
  const qtTo = game.qtTarget || game.qtRoute?.to, qtAt = !qtTo && game.qtArrived;
  $('qt').hidden = !qtTo && !qtAt;
  $('qt').classList.toggle('arrived', !!qtAt);
  $('qt-name').textContent = qtTo ? `Quantum to ${navName(qtTo)}` : qtAt ? `Arrived · ${navName(qtAt)}` : '';
  // Server lag: the log names each stall of your client; the chip shows for a while after one.
  const lagOn = !!game.lag && game.lag.n !== lagSeen && liveLog;
  if (lagOn) { lagSeen = game.lag.n; clearTimeout(lagTimer); $('lag').hidden = false; lagTimer = setTimeout(() => { $('lag').hidden = true; }, LAG_MS); }
  if (game.menu) $('lag').hidden = true;
  $('lag').querySelector('span').textContent = game.lag ? `Server lag ${game.lag.len >= 1 ? Math.round(game.lag.len) + ' s' : ''}`.trim() : '';

  const esc = controls.esc;
  const m = game.mission, card = $('mission');
  card.hidden = !m || (!m.contract && !m.objective);
  if (m) {
    card.className = 'mission' + (m.status === 'complete' ? ' done' : m.status === 'failed' || m.status === 'withdrawn' ? ' failed' : '');
    $('mission-kind').textContent = m.status === 'active' ? 'Mission' : 'Mission ' + m.status;
    $('mission-obj').textContent = m.status === 'active' ? m.objective || '' : '';
    // Where the objective's marker points. The game logs no distance, so only whether you're there.
    const here = m.target && place(game.location).name.toLowerCase().includes(m.target.toLowerCase());
    $('mission-at').innerHTML = m.target && m.status === 'active' ? `→ ${esc(m.target)}${here ? ' <em>· you are here</em>' : ''}` : '';
    $('mission-text').innerHTML = m.runs?.length
      ? m.runs.map(r => r.em === null ? esc(r.text) : `<span class="em${r.em}">${esc(r.text)}</span>`).join('')
      : esc(m.contract || '');
    $('mission-tags').innerHTML = (m.tags || []).map(t => `<span class="${/^bp$/i.test(t) ? 'bp' : ''}">${esc(/^bp$/i.test(t) ? 'Blueprint' : t)}</span>`).join('');
    if (m.seq !== lastSeq && lastSeq) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 3000); }
    lastSeq = m.seq;
  }

  // Moods: the whole panel reacts to where you are and what is happening.
  const inWorld = !game.menu;
  stage.classList.toggle('standby', !info.running || game.menu);
  stage.classList.toggle('armistice', inWorld && game.armistice && !game.down);
  // The red frame is for what needs you now: a CrimeStat, or the ship you're in disabled.
  // Unmonitored or lawless space is only a note on the law chip.
  stage.classList.toggle('alert', inWorld && (game.crime > 0 || (game.seated && game.wrecked > 0)));
  stage.classList.toggle('downed', inWorld && game.down);
  // A disabled ship swaps Flight ready and All systems on for Self repair and Emergency exit.
  stage.classList.toggle('wrecked', inWorld && game.seated && game.wrecked > 0);
  paintQuantum();
  paintLog();
  paintPatch();
  paintTele();
  fitChips();
  requestAnimationFrame(fitMakerName);
}
// Chips that would run off the status screen give way, the least pressing first, so Follow game
// and the ones that need you stay in sight.
const CHIP_ORDER = ['tele-chip', 'kills', 'build', 'update', 'binds-chip', 'patch', 'touch-chip', 'fit-chip', 'lag', 'party', 'hangar', 'fuel', 'injury', 'wreck', 'dropped', 'law'];
function fitChips() {
  const screen = $('auto').closest('.facts')?.parentElement, r = screen?.getBoundingClientRect();
  if (!r?.height) return;
  // First the ship shrinks, then gives way, until the facts and Follow game fit; the other chips after.
  CHIP_ORDER.forEach(id => $(id).classList.add('squeezed'));
  for (const fit of ['', 'tight', 'tighter']) {
    screen.classList.remove('tight', 'tighter');
    if (fit) screen.classList.add(fit);
    if ($('auto').getBoundingClientRect().bottom <= r.bottom - 10) break;
  }
  CHIP_ORDER.forEach(id => $(id).classList.remove('squeezed'));
  for (const id of CHIP_ORDER) {
    if ($('auto').getBoundingClientRect().bottom <= r.bottom - 10) break;
    if (!$(id).hidden) $(id).classList.add('squeezed');
  }
}
// The maker's name only shows where the status text leaves room for it.
function fitMakerName() {
  const t = $('mfd').querySelector(':scope > .mkname');
  if (t) t.classList.toggle('clash', document.querySelector('#mfd .facts').getBoundingClientRect().bottom > t.getBoundingClientRect().top - 8);
}

// ---------- the Log page: what the game log said this session ----------
const hhmm = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const shipLabel = m => lookup(shipsDb.ships, overrides.ships, m)?.name || shipName(m);
const lastRow = kind => logRows.find(r => r.kind === kind);
// ---------- past sessions: the game's own log backups, read once per Game.log ----------
let past = null, pastLoading = false;
async function loadPast() {
  if (pastLoading) return;
  pastLoading = true;
  const logs = await bridge.pastLogs().catch(() => []);
  past = logs.flatMap(l => sessionsOf(l.lines)).sort((a, b) => b.start.localeCompare(a.start));
  pastLoading = false;
  paintLog();
}
function paintPast() {
  if (!$('lg-past')) return;
  if (!past) { loadPast(); return; }
  const esc = controls.esc;
  const span = m => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
  const day = iso => {
    const d = new Date(iso), now = new Date(), days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86_400_000);
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString([], days < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })} ${t}`;
  };
  const week = past.filter(t => Date.now() - Date.parse(t.start) < 7 * 86_400_000).reduce((n, t) => n + minutes(t), 0);
  $('lg-past-note').textContent = past.length ? `From the game's log backups · last 7 days: ${span(week)} played` : '';
  // Like the cards above: injuries, as the game stopped logging kills in 2026, unless a session shown does log one.
  const shown = past.slice(0, 5), kills = shown.some(t => t.kills);
  const rows = shown.map(t => `<tr><td>${esc(day(t.start))}</td><td>${esc(span(minutes(t)))}</td><td>${kills ? t.kills : t.injuries}</td><td>${t.deaths}</td><td>${t.missions}</td><td>${esc(t.ships.map(m => shipLabel(m)).join(', ') || '–')}</td></tr>`).join('');
  $('lg-past').innerHTML = `<tr><th>Started</th><th>Played</th><th>${kills ? 'Kills' : 'Injuries'}</th><th>Downed</th><th>Missions</th><th>Ships</th></tr>`
    + (rows || '<tr><td class="empty" colspan="6">No earlier sessions yet. The game keeps each finished session\'s log, and they show here.</td></tr>');
}
function paintLog() {
  if (current !== 'log' || !$('lg-list')) return;
  paintPast();
  const esc = controls.esc, set = (id, t = '', p = '', q = '', b = '') => {
    $(id + '-t').textContent = t; $(id + '-b').textContent = b; $(id + '-p').innerHTML = p; $(id + '-q').innerHTML = q;
    $(id + '-b').closest('.card').classList.toggle('none', !b);
  };
  const d = game.downedBy;
  const by = d && culprit(d.by, game.me);
  set('lg-down', hhmm(lastRow('down')?.ts), d ? [d.weapon && esc(weaponName(d.weapon)), d.damage && esc(d.damage.toLowerCase()) + ' hit'].filter(Boolean).join(' · ') : 'Nothing this session',
    d?.hospital ? `Respawn at <em>${esc(placeName(d.hospital) || d.hospital)}</em>` : '', d ? (by ? `By ${by}` : 'Downed') : '');
  const s = shardName(game.shard), at = game.location ? placeName(game.location) : null;
  set('lg-where', '', s ? `Region <em>${esc(s.region || '?')}</em> · shard <em>${esc(s.n)}</em>` : 'No shard joined yet',
    game.jump ? `Last jump <em>${esc(game.jump.from || '?')} → ${esc(game.jump.to)}</em>${lastRow('jump') ? ' at ' + hhmm(lastRow('jump').ts) : ''}` : '',
    [at, game.system].filter(Boolean).join(' · ') || (s ? 'In the verse' : ''));
  const r = game.refinery;
  set('lg-ref', hhmm(lastRow('refinery')?.ts), r ? esc(r.place) : 'No job finished this session', r ? 'Pick it up at the refinery terminal.' : '', r ? 'Job done' : '');
  const st = game.stored, last = game.lastShip, ej = d?.ejected;
  set('lg-ships', '', st ? `Stored${lastRow('stored') ? ' at ' + hhmm(lastRow('stored').ts) : ''}` : last ? (game.seated ? 'Flying now' : 'Last flown') : 'No ship this session',
    ej ? `Thrown clear of <em>${esc(shipLabel(ej.replace(/_\d+$/, '')))}</em>` : '', st ? shipLabel(st.ship) : last ? shipLabel(last.ship) : '');
  // This session's totals, as the recap counts them.
  const mins = minutes(session);
  $('lg-time').textContent = mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  // The game stopped logging kills in 2026, so injuries show unless a session does log one.
  $('lg-kills').textContent = session.kills || session.injuries;
  $('lg-kills').nextElementSibling.textContent = session.kills ? 'Kills' : session.injuries === 1 ? 'Injury' : 'Injuries';
  $('lg-deaths').textContent = session.deaths;
  $('lg-missions').textContent = session.missions;
  $('lg-ships-n').textContent = session.ships.length;
  $('lg-list').innerHTML = logRows.length
    // Newest first, as many rows as the list holds whole.
    ? logRows.slice(0, 11).map(e => `<li><time>${hhmm(e.ts)}</time><i class="${e.tone}"></i><span>${esc(e.text)}</span></li>`).join('')
    : '<li class="empty"><span>Nothing yet. Events from the game log show here as they happen.</span></li>';
}
// ---------- the system you are in, as a line of its planets from the star out ----------
// Drawn here, not fetched: planets in order, belts as dotted marks, where you are ringed.
const SYSTEMS_MAP = {
  Stanton: [['Hurston'], ['Crusader'], ['ArcCorp'], ['microTech']],
  Pyro: [['Pyro I'], ['Monox'], ['Bloom'], ['Pyro IV'], ['Pyro V'], ['Terminus']],
  Nyx: [['Nyx I'], ['Nyx II'], ['Glaciem', 'belt'], ['Nyx III'], ['Keeger', 'belt']],
};
let orreryFor = null;
// A mission marker's nav point, MISSION_QT_Kaboos_928004668243, reads as Kaboos.
const navName = n => n.replace(/^MISSION_(QT_)?/, '').replace(/_\d{6,}$/, '').replace(/_/g, ' ');
function paintOrrery(at) {
  const svg = $('orrery'), sys = at?.system && SYSTEMS_MAP[at.system];
  svg.toggleAttribute('hidden', !sys || game.menu);
  if (!sys) { orreryFor = null; return; }
  const name = at.name.toLowerCase();
  let here = sys.findIndex(([n, kind]) => kind === 'belt' && name.startsWith(n.toLowerCase()));
  if (here < 0 && at.body) here = sys.map((b, i) => b[1] === 'belt' ? -1 : i).filter(i => i >= 0)[at.body - 1] ?? -1;
  const key = `${at.system}:${here}`;
  if (key === orreryFor) return;
  orreryFor = key;
  const x0 = 34, x1 = 290, step = (x1 - x0) / Math.max(1, sys.length - 1), y = 22;
  const parts = [`<circle cx="10" cy="${y}" r="7" class="star"/><line x1="18" y1="${y}" x2="${x1}" y2="${y}" class="track"/>`,
    `<text x="0" y="50" class="sys">${controls.esc(at.system.toUpperCase())}</text>`];
  sys.forEach(([n, kind], i) => {
    const x = x0 + i * step, cur = i === here;
    parts.push(kind === 'belt'
      ? `<line x1="${x}" y1="${y - 9}" x2="${x}" y2="${y + 9}" class="belt${cur ? ' cur' : ''}"/>`
      : `<circle cx="${x}" cy="${y}" r="${cur ? 5 : 3.5}" class="body${cur ? ' cur' : ''}"/>`);
    if (cur) parts.push(`<circle cx="${x}" cy="${y}" r="10" class="ring"/><text x="${Math.min(x, x1 - 2)}" y="50" text-anchor="${x > x1 - 40 ? 'end' : 'middle'}" class="here">${controls.esc(n)}</text>`);
  });
  svg.innerHTML = parts.join('');
}
function paintQuantum() {
  const ready = !game.menu && game.seated && !!game.qtTarget;
  document.querySelectorAll('#console .quantum').forEach(q => { q.classList.toggle('ready', ready); q.querySelector('.st').textContent = ready ? 'READY · HOLD' : 'HOLD'; });
}

/** Opens the page for the moment when that changes, unless you turned auto pages off. */
// Switches show what the console last set. A different ship, or none, starts unknown again,
// except what the game reports.
let stateShip = null;
function forgetStates() {
  const ship = game.seated ? game.ship : null;
  if (ship === stateShip) return;
  stateShip = ship;
  // What the game reports stays: it is about the ship you're in now, not the last one.
  const kept = Object.fromEntries([...teleKeys].filter(k => k in states).map(k => [k, states[k]]));
  for (const key of Object.keys(states)) delete states[key];
  Object.assign(states, kept);
  repaint();
  bridge.share({ st: null });
  if (Object.keys(kept).length) bridge.share({ st: kept });
}
function follow(force) {
  forgetStates();
  ship = game.seated ? lookup(shipsDb.ships, overrides.ships, game.ship) : null;
  let { id } = pageFor(layout, game, shipsDb.ships, overrides.ships);
  // A page of yours linked to this ship takes the place of its role page.
  const mine = game.seated && !game.down && !game.menu ? pageForShip([...CUSTOM.values()], game.ship) : null;
  if (mine) id = mine.id;
  rolePage = moduleOf(id) && id !== 'flight' ? id : null;
  if (opts.auto && (force || id !== lastAuto)) show(id);
  lastAuto = id;
}

// ---------- patch watch: the log lines the console needs, still there after a patch ----------
const newWatch = () => ({ kinds: new Set(), loadedAt: 0, shipKeys: 0 });
let watch = newWatch();
function paintPatch() {
  const miss = liveLog && !game.menu ? missingLines(watch, Date.now()) : [];
  $('patch').hidden = !miss.length;
  $('patch').querySelector('span').textContent = miss.length ? 'Log lines missing' : '';
  $('patch').dataset.miss = miss.join(', ');
}
// A tap clears what the log can't clear by itself: a med pen heals without a log line, a tank
// refuels without one, and the reason the game dropped you is read once.
for (const [id, clear] of [['injury', { injuries: [] }], ['fuel', { lowFuel: false }], ['dropped', { dropped: null }]]) {
  controls.pressable($(id), { up: () => { tick('tap'); game = { ...game, ...clear }; paintStatus(); } });
}
controls.pressable($('patch'), { up: () => {
  tick('tap');
  const what = $('patch').dataset.miss, build = game.build?.branch ? version(game.build.branch) : 'this build';
  toast(`Game.log on ${build} shows nothing for ${what}. A patch may have changed it.`, { label: 'Report', run: () => reportProblem(`Patch watch: no log line for ${what} on ${build}`) });
} });

// The last Game.log lines the console read, for Report a problem.
const RECENT_MAX = 300;
let recent = [];
function onLog({ lines, live, reset }) {
  if (reset) recent = [];
  recent = recent.concat(lines).slice(-RECENT_MAX);
  // A new Game.log means a new channel or a restart: its binds may differ too.
  if (reset) { past = null; placeSeen = { at: 0, moved: false }; game = { ...EMPTY }; session = { ...NEW_TALLY }; lastSeq = 0; logRows = []; watch = newWatch(); if (bridge.inApp) { reloadBinds(); loadUserShips(); } }
  for (const line of lines) {
    const ev = parseLine(line);
    const was = game;
    if (ev && (ev.type === 'qt-arrived' || ev.type === 'jump') && placeSeen.at) placeSeen.moved = true;
    if (ev) { game = reduce(game, ev);
      if (ev.type === 'lift' && ev.place) placeSeen = { at: Date.parse(stamp(line) || '') || Date.now(), moved: false, id: ev.place, sys: game.system };
      if (ev.type === 'location' && game.location === ev.place && (!game.me || ev.who === game.me.name)) placeSeen = { at: Date.parse(stamp(line) || '') || Date.now(), moved: false, id: ev.place, sys: game.system }; watch.kinds.add(ev.type); if (ev.type === 'loaded') watch.loadedAt = (live ? 0 : Date.parse(stamp(line) || '')) || Date.now(); }
    session = tally(session, was, game, stamp(line));
    if (ev) for (const e of logFor(was, game)) logRows.unshift({ ...e, ts: stamp(line) });
    if (live && !was.menu && game.menu) showRecap();
    if (live && ev) for (const a of alertsFor(was, game)) raise(a);
    if (!game.menu) $('recap').hidden = true;
  }
  if (logRows.length > LOG_MAX) logRows.length = LOG_MAX;
  liveLog = live;
  if (!live) lagSeen = game.lag?.n ?? null;
  follow(!live);
  paintStatus();
  paintChannel();
  world.onLog();
}
bridge.onGameLog(onLog);

let info = { running: false, focused: false, elevated: false, channel: null };
function paintChannel() {
  // OFFLINE with no game; the game's channel and version (LIVE 4.10.3, PTU 4.11) while it runs.
  const on = info.running && info.channel;
  const ch = on ? info.channel.split(/[\\/]/).pop().toUpperCase() : 'OFFLINE';
  const chText = on && game.build?.branch ? `${ch} ${version(game.build.branch)}` : ch;
  if ($('channel').textContent !== chText) {
    $('channel').textContent = chText;
    // A long channel name (TECH-PREVIEW 4.10.3) needs the room: the ? gives way, and the legend stays in Settings > General.
    $('help').hidden = false;
    $('help').hidden = $('link').offsetHeight > 26;
  }
}
async function poll() {
  const was = JSON.stringify(info);
  info = await bridge.gameInfo().catch(() => info);
  if (JSON.stringify(info) === was) return;
  const link = $('link');
  link.classList.toggle('running', info.running);
  link.classList.toggle('focused', info.focused);
  paintChannel();
  $('act-admin').hidden = info.elevated;
  if (!info.running && !game.menu) { game = { ...EMPTY, me: game.me, dropped: game.dropped }; follow(false); showRecap(); }
  paintPrompt();
  paintStatus();
  paintSetup();
}

// ---------- phones: Settings > Phones on the PC ----------
const PLATES = [['swipe', 'All'], ['status', 'Status'], ['power', 'Power'], ['role', 'Role'], ['flight', 'Flight'], ['gear', 'Gear']];
let phonesState = null;
async function paintPhones() {
  const v = phonesState = await bridge.phonesView().catch(() => null);
  if (!v) return;
  $('ph-enable').classList.toggle('on', v.enabled);
  $('phones-dot').hidden = !v.list.some(p => p.online);
  const qr = $('ph-qr');
  qr.classList.toggle('off', !v.qr);
  if (v.qr) qr.innerHTML = v.qr; else qr.textContent = v.enabled ? 'No home network' : 'Devices off';
  $('ph-code').textContent = v.code ? `${v.code.slice(0, 3)} ${v.code.slice(3)}` : '––– –––';
  $('ph-addr').textContent = v.url || '';
  const esc = controls.esc;
  const seg = (cls, list, val, na) => `<span class="seg ${cls}${na ? ' na' : ''}">${list.map(([k, l]) => `<button data-v="${k}" class="${k === val ? 'cur' : ''}">${l}</button>`).join('')}</span>`;
  const ago = s => { const m = Math.round((Date.now() / 1000 - s) / 60); return m < 2 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const here = ['status', 'power', 'role', 'flight', 'gear'];
  const gone = new Set(v.moved);
  const rows = v.list.map(p => `<div class="opt choice${p.online ? '' : ' off'}" data-id="${esc(p.id)}">${controls.icon('phone', 34).replace('class="i"', 'class="i ico"')}
    <span class="txt">${esc(p.name)}<small><i class="live"></i>${p.online ? 'Connected' : `Seen ${ago(p.seen)}`}</small></span>
    ${seg('which', PLATES, p.plate)}${seg('mode', [['copy', 'Copy'], ['move', 'Move']], p.mode, p.plate === 'swipe' || p.plate === 'status')}
    <button class="forget">Forget</button></div>`).join('');
  $('ph-list').innerHTML = (v.list.length ? `<div class="here"><small>This screen shows</small>${here.map(k => `<span class="${gone.has(k) ? 'gone' : ''}">${k}</span>`).join('')}${gone.size ? '<em>Moved plates come back when their device disconnects.</em>' : ''}</div>` : '')
    + rows + `<p class="hint">${v.list.length ? 'Copy shows the plate on the device and here. Move takes it off this screen. All shows every plate: the whole console on a big screen, one at a time on a phone. Each device can change this in its own settings too.' : 'No devices yet. Turn Devices on, then open the address on a phone, tablet or computer on the same network.'}</p>`;
  $('ph-list').querySelectorAll('.opt[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('.seg.which button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); bridge.phonesSet(id, b.dataset.v, null).then(paintPhones); } }));
    row.querySelectorAll('.seg.mode button').forEach(b => controls.pressable(b, { up: () => { tick('toggle'); bridge.phonesSet(id, null, b.dataset.v).then(paintPhones); } }));
    controls.pressable(row.querySelector('.forget'), { up: () => { tick('tap'); bridge.phonesForget(id).then(paintPhones); } });
  });
  const m = new Set(v.moved);
  if ([...m].join() !== [...moved].join()) { moved = m; render(); }
}
function startPhones() {
  // On a small window the code is tiny: a tap shows it across the whole screen.
  controls.pressable($('ph-qr'), { up: () => {
    if (!phonesState?.qr) return;
    const big = document.createElement('div');
    big.className = 'qr-big';
    big.innerHTML = phonesState.qr;
    big.addEventListener('pointerup', () => big.remove());
    document.body.appendChild(big);
  } });
  controls.pressable($('ph-enable'), { up: () => { tick('toggle'); bridge.phonesEnable(!phonesState?.enabled).then(paintPhones); } });
  bridge.onPhones?.(paintPhones);
  paintPhones();
  // The pairing code changes every two minutes: keep it current while it shows.
  // While pairing, the console stays up without a game (it would hide after two minutes).
  let ticks = 0;
  setInterval(() => {
    if ($('sheet').hidden || document.querySelector('.pane[data-sec=phones]').hidden) return;
    paintPhones();
    if (++ticks % 12 === 0) bridge.wakeScreen();
  }, 5000);
}

// ---------- on a phone ----------
function startPhone() {
  const link = window.__EC_PHONE__;
  phone.init({ stage, tick, fit, current: () => current, onSettings: () => openSheet(true) });
  // Toasts and alerts sit over the phone's screen, not on the stage.
  document.body.append($('toast'), $('banner'));
  opts.recap = false;
  link.onState(st => phone.paintTop({ state: st, rtt: link.rtt }));
  bridge.onPhoneConfig?.(c => phone.configure(c));
  if (link.me) phone.configure(link.me);
  setInterval(() => phone.paintTop({ state: link.state, rtt: link.rtt }), 5000);
  // Keep the screen on while the console shows.
  addEventListener('pointerdown', keepAwake, { passive: true });
  document.addEventListener('visibilitychange', keepAwake);
  // The ship's name in the top bar, and where you are under a short plate, follow the status display.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; phone.paintTop({ state: link.state, rtt: link.rtt, ship: $('ship-name').textContent }); phone.refresh(); });
  }).observe($('status'), { subtree: true, childList: true, characterData: true });
}

// ---------- clock and scale ----------
function clock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (opts.night === 'auto') paintNight();
  paintPatch();
  world.paint();
}
// On a screen that isn't ultra-wide (16:10, 4:3, portrait, a tablet) the console stacks in two
// rows when that makes the keys bigger: the status display and first plates on top, the rest below.
const ROW_W = 1662;
let stacked = false;
let fitScale = null;
const oneRow = () => fitScale ?? Math.min(innerWidth / 2560, innerHeight / 720);
// Actual size: never larger than designed (1 stage pixel to 1 CSS pixel), centred on a bigger screen.
const sized = s => ((CUSTOM.get(current)?.size || opts.size) === 'actual' && !onPhone ? Math.min(s, 1) : s);
const twoRows = () => Math.min(innerWidth / ROW_W, innerHeight / 1440);
function stack() {
  const status = $('status');
  const plates = [...$('console').querySelectorAll(':scope > .plate:not(.moved)')].sort((a, b) => a.offsetLeft - b.offsetLeft);
  for (const p of [status, ...plates]) p.style.translate = '';
  if (!stacked || !plates.length) return;
  // Split where the longer row is shortest, then centre both rows.
  const right = plates.at(-1).offsetLeft + plates.at(-1).offsetWidth;
  let best = null;
  for (let i = 1; i < plates.length; i++) {
    const a = plates[i - 1].offsetLeft + plates[i - 1].offsetWidth + 6, b = right - plates[i].offsetLeft + 12;
    if (!best || Math.max(a, b) < best.w) best = { i, w: Math.max(a, b), a, b };
  }
  if (!best) return;
  const top = Math.max(0, Math.round((ROW_W - best.a) / 2));
  const bottom = Math.round((ROW_W - best.b) / 2) + 6 - plates[best.i].offsetLeft;
  [status, ...plates.slice(0, best.i)].forEach(p => { if (top) p.style.translate = `${top}px 0`; });
  plates.slice(best.i).forEach(p => { p.style.translate = `${bottom}px 720px`; });
}
// Plates moved to a phone leave the PC's console; the rest close up and grow to fill the screen.
let moved = new Set();
function contentWidth() {
  if (!$('console').querySelector(':scope > .plate.moved')) return 2560;
  const plates = [...$('console').querySelectorAll(':scope > .plate:not(.moved)')];
  return Math.max(382, ...plates.map(p => p.offsetLeft + p.offsetWidth)) + 6;
}
const BIG = 0.5;
function fit() {
  if (onPhone) {
    whole = phone.allPlates() && Math.max(Math.min(innerWidth / 2560, innerHeight / 720), twoRows()) >= BIG;
    document.body.classList.toggle('ph-whole', whole);
    if (!whole) {
      if (stacked) { stacked = false; stage.classList.remove('stacked'); stage.style.width = stage.style.height = ''; stack(); }
      phone.layout();
      return;
    }
    phone.clear();
  }
  const was = stacked;
  const cw = contentWidth();
  const rows2 = $('console').querySelectorAll(':scope > .plate:not(.moved)').length > 1;
  stacked = (opts.stack || onPhone) && rows2 && twoRows() > Math.min(innerWidth / cw, innerHeight / 720) * 1.08;
  stage.classList.toggle('stacked', stacked);
  stage.style.width = stacked ? `${ROW_W}px` : '';
  stage.style.height = stacked ? '1440px' : '';
  if (stacked !== was || stacked) stack();
  // The stage closes up with the moved plates, so the settings sheet and banners stay on screen.
  if (!stacked) stage.style.width = cw < 2560 ? `${cw}px` : '';
  const s = stacked ? K.scale() : sized(Math.min(innerWidth / cw, innerHeight / 720));
  fitScale = s;
  stage.style.transform = `translate(${Math.max(0, (innerWidth - (stacked ? ROW_W : cw) * s) / 2)}px, ${Math.max(0, (innerHeight - (stacked ? 1440 : 720) * s) / 2)}px) scale(${s})`;
}
addEventListener('resize', fit);
// Lifting a finger outside the panel, or the panel hiding, must never leave a key down.
addEventListener('blur', () => bridge.releaseKeys());
document.addEventListener('visibilitychange', () => document.hidden && bridge.releaseKeys());

const demo = new URLSearchParams(location.search).get('page');
fit(); clock();
// Wake once a minute, on the minute, and not more.
setTimeout(() => { clock(); setInterval(clock, 60_000); }, 60_000 - Date.now() % 60_000 + 50);
buildSoftkeys();
const ROLE_NAMES = { fighter: 'fighter', crew: 'multi-crew', mining: 'mining', salvage: 'salvage', cargo: 'cargo', medical: 'medical', ground: 'ground vehicle', systems: 'ship systems' };
arrange.init($('console'), {
  store, tick, scale: K.scale, role: () => moduleOf(current), roleName: () => ROLE_NAMES[moduleOf(current)] || 'ship',
  canArrange: () => !CUSTOM.has(current),
  onEdit: () => { if (!onPhone || whole) editor.openEditor(current, CUSTOM.get(current)); },
  onImport: () => importPages(),
  onNew: () => newPage(blankPage(`My page ${CUSTOM.size + 1}`, newId())),
  onDuplicate: () => newPage(duplicate(current, `My ${(ship?.name || pageById(layout, current)?.name || 'page').slice(0, 20)}`, moduleOf(current), newId())),
  modules: MODULE_NAMES, module: () => K.moduleFor(current) || moduleOf(current), stockModule: () => moduleOf(current),
  onDone: (role, mod, quiet) => {
    const was = K.moduleFor(current) || role;
    if (mod && mod !== was) {
      store.set(`module:${role}`, mod === role ? null : mod);
      for (const id of cache.keys()) if (moduleOf(id) === role) cache.delete(id);
      render();
    }
    if (!quiet) toast('Layout saved for this role');
  },
});
// Ships by the curated page they get, for the editor's Use for.
let shipGroups = null;
function groupShips() {
  const by = new Map();
  for (const cls of Object.keys(shipsDb.ships)) {
    const { id } = pageFor(layout, { seated: true, ship: cls }, shipsDb.ships, overrides.ships);
    if (!moduleOf(id)) continue;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push({ cls, name: shipLabel(cls) });
  }
  // Pages that share a name (a role with and without some kit) make one group.
  const named = new Map();
  for (const [id, list] of by) {
    const name = pageById(layout, id)?.name || id;
    if (!named.has(name)) named.set(name, { id, name, ships: [] });
    named.get(name).ships.push(...list);
  }
  return [...named.values()].map(g => ({ ...g, ships: g.ships.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.name.localeCompare(b.name));
}
/** The class a Game.log model belongs to (AEGS_Gladius_1234 -> AEGS_Gladius), so a page follows every one of it. */
function lookupClass(model) {
  if (shipsDb.ships[model]) return model;
  let best = null;
  for (const cls of Object.keys(shipsDb.ships)) if (model.startsWith(cls + '_') && (!best || cls.length > best.length)) best = cls;
  return best || model;
}
/** Page files in Documents\Edge Cockpit\Pages, offered in the key picker's sheet to import. */
async function importPages() {
  if (onPhone) { toast('Import pages on the PC'); return; }
  const files = await bridge.pageFiles().catch(() => []);
  const pages = files.map(([file, text]) => { try { const f = JSON.parse(text); return f?.app === 'edge-cockpit' && f.kind === 'page' ? { file, page: f.page } : null; } catch { return null; } })
    .filter(x => x && cleanPage(x.page));
  if (!pages.length) { toast('No page files found. Put one in Documents\\Edge Cockpit\\Pages, then Import'); return; }
  openEditorPicker({
    title: 'Import a page', now: null, base: false, refuse: () => '',
    list: pages.map(({ file, page }) => ({ label: page.name || file.replace(/\.json$/i, ''), note: `${file} · ${page.plates?.length || 0} plates` })),
    onPick: label => {
      const hit = pages.find(({ file, page }) => (page.name || file.replace(/\.json$/i, '')) === label);
      // Always a new page: an import never replaces one of yours.
      if (hit) newPage({ ...hit.page, id: newId(), ships: [] });
    },
  });
}
/** A new page of yours: saved, shown, and open in the editor. */
function newPage(spec) {
  const saved = spec && window.xfd.savePage(spec);
  if (!saved) return;
  show(saved.id);
  editor.openEditor(saved.id, CUSTOM.get(saved.id));
}
editor.init({
  K, keys: KEYS, store, tick, toast, scale: K.scale, size: () => opts.size,
  pageName: id => pageById(layout, id)?.name,
  bound: (label, base) => (base ? reach(KEYS.get(`${label} on`)) && reach(KEYS.get(`${label} off`)) : reach(KEYS.get(label))),
  openPicker: openEditorPicker,
  ships: () => {
    shipGroups ||= groupShips();
    return { groups: shipGroups, current: game.seated && game.ship ? { cls: lookupClass(game.ship), name: shipLabel(game.ship) } : null, name: shipLabel };
  },
  // The draft is drawn as if saved; null draws the saved page again.
  preview: (spec, id = spec?.id) => {
    bridge.share({ preview: spec });
    if (spec) { CUSTOM.set(spec.id, spec); const pg = mainPages.find(p => p.id === spec.id); if (pg) pg.name = spec.name; } else loadPages();
    cache.delete(id);
    if (current === id) render();
  },
  save: spec => window.xfd.savePage(spec),
  share: async spec => {
    if (onPhone) { toast('Share a page from the PC'); return; }
    const file = { app: 'edge-cockpit', kind: 'page', format: 1, saved: new Date().toISOString(), page: spec };
    try { toast(`Saved to ${await bridge.savePageFile(spec.name, JSON.stringify(file, null, 2))}. Send that file to share the page`); }
    catch (e) { toast(`The page was not saved: ${e?.message || e}`); }
  },
  remove: id => window.xfd.deletePage(id),
});
world.init({ fire, keyHint: k => bindOf(k), game: () => game, location: () => ({ id: placeSeen.id || game.location, ...placeSeen }), store, bridge, raise, tick, hhmm, current: () => current, painted: els => { if (onPhone) phone.repainted(els); } });
perf.init({ hold: document.querySelector('#mfd .brand'), parent: $('mfd'), perf: bridge.perf, tick });
bridge.onKeySent(perf.keySent);
const prefs = await bridge.getPrefs().catch(() => ({ autostart: false, screen_off: false, backlight: null, version: '' }));
opts.autostart = prefs.autostart; opts.screen_off = prefs.screen_off;
$('version').textContent = prefs.version;
if (prefs.backlight === false) $('screen-note').textContent = 'The Edge keeps its backlight on, so the console shows black';
const fresh = store.get('whats-new', null);
if (fresh?.fresh && fresh.version === prefs.version) {
  store.set('whats-new', { ...fresh, fresh: false });
  setTimeout(() => toast(`Updated to ${prefs.version}`, { label: "What's new", run: () => openSheet(true, 'about') }), 1500);
}
paintUpdate();
paintDisplays();
setTimeout(() => { checkUpdate(); setInterval(checkUpdate, 6 * 3600_000); }, 20_000);
// The tray menu: Settings, Setup check, Check for updates and the Start with Windows tick.
bridge.onTray?.(what => {
  if (what === 'settings') { $('setup').hidden = true; setupOpen = false; openSheet(true, 'general'); }
  else if (what === 'setup') { openSheet(false); showSetup(); }
  else if (what === 'update') bridge.checkUpdate().then(u => { update = u; paintUpdate(); toast(u ? `Version ${u.version} is ready to install` : `Edge Cockpit ${prefs.version} is up to date`); }, e => toast(`Could not check for updates: ${e?.message || e}`));
});
bridge.onAutostart?.(on => { opts.autostart = on; document.querySelectorAll('.opt[data-opt="autostart"]').forEach(o => o.classList.toggle('on', on)); });
setOpt('night', opts.night);
bridge.onShared?.(shared);
if (!onPhone) { bridge.onTelemetry?.(applyTelemetry); bridge.telemetryNow().then(u => u && applyTelemetry(u)).catch(() => {}); }
// The PC holds the pages of yours: every Device gets them, and no stale edit from a closed one.
if (!onPhone) bridge.share({ pages: Object.fromEntries(storedPages().filter(p => p?.id).map(p => [p.id, p])), preview: null });
if (onPhone) startPhone(); else startPhones();
render();
await reloadBinds();
poll(); setInterval(poll, 2000);
paintStatus();
if (demo) { opts.auto = false; show(demo); }
// The setup check shows once, on the first start (in the browser preview only with ?setup).
if (!onPhone && (bridge.inApp ? !store.get('setup-done', false) : new URLSearchParams(location.search).has('setup'))) showSetup();
stage.classList.remove('booting');
window.xfd = {
  myPages: () => [...CUSTOM.values()],
  edit: id => { show(id); editor.openEditor(id, CUSTOM.get(id)); },
  shared,
  editing: editor.isOpen,
  /** Saves a page of yours (adds or replaces by id); returns the cleaned page, or null. */
  savePage: raw => {
    const spec = cleanPage(raw);
    if (!spec) return null;
    putPage(spec.id, spec);
    loadPages(); cache.delete(spec.id); if (current === spec.id) render();
    return CUSTOM.get(spec.id) || null;
  },
  deletePage: id => { putPage(id, null); pageGone(id); },
  telemetry: applyTelemetry,
  show, raise, setup: showSetup, legend: showLegend, feed: (lines, live = true) => onLog({ lines, live }), recap: t => { session = { ...NEW_TALLY, ...t }; showRecap(); }, perf: perf.toggle, showSection, bindHealth, reloadBinds, bindsProfile, reportProblem, backupProfile, paintBackups, pages: () => layout.decks.find(d => d.id === 'main').pages.map(p => p.id) };
document.body.dataset.ready = '1';
