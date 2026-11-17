// Edge Cockpit: builds the cockpit console, turns touches into key presses and
// follows Game.log for the status display, the moods and the pages.
import { GLYPHS } from './lib/glyphs.js';
import { parseLine, reduce, lawless, EMPTY, version, untested, placeName } from './lib/gamelog.js';
import { pageFor, pageById } from './lib/pages.js';
import { lookup } from './lib/ships.js';
import * as bridge from './bridge.js';
import * as controls from './controls.js';
import { scene, init as initScenes, SWIPE, moduleOf } from './scenes.js';
import { outline } from './outlines.js';
import * as arrange from './arrange.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const load = async f => (await fetch('vendor/' + f)).json();
const [layout, shipsDb, bundledOverrides, xeneonXml] = await Promise.all([
  load('star-citizen.json'), load('ships.json'), load('ship-overrides.json'),
  fetch('vendor/xeneon-binds.xml').then(r => r.text()),
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
const KIT_KEYS = { missiles: ['Missiles +', 'Missiles reset'], emp: ['EMP'], qed: ['QED'], tractor: ['Tractor rotate', 'Tractor detach', 'Beam closer', 'Beam farther'] };

// ---------- settings ----------
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('xfd-' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xfd-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const opts = { night: store.get('night', false), sound: store.get('sound', true), flash: store.get('flash', true), auto: store.get('auto', true), anywhere: store.get('anywhere', false) };

// ---------- binds: the player's actionmaps.xml, then our Xeneon profile, then the defaults ----------
function parseActionmaps(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const kb = {}, stick = {};
  if (doc.querySelector('parsererror')) return { kb, stick };
  doc.querySelectorAll('action').forEach(a => {
    const name = a.getAttribute('name');
    a.querySelectorAll('rebind').forEach(rb => {
      const input = (rb.getAttribute('input') || '').trim();
      const m = input.match(/^kb\d*_(.*)$/);
      if (m) kb[name] = m[1].trim() || null;
      const j = input.match(/^(js|gp)\d*_(.+)$/);
      if (j && j[2].trim()) stick[name] = input;
    });
  });
  return { kb, stick };
}
const xeneon = parseActionmaps(xeneonXml).kb;
let mine = { kb: {}, stick: {} };
function bindOf(k) {
  if (!k?.action) return null;
  if (Object.hasOwn(mine.kb, k.action)) {
    const v = mine.kb[k.action];
    return v && !/mouse|mwheel|maxis/.test(v) ? v : null;
  }
  return k.defaultKey || xeneon[k.action] || null;
}
async function reloadBinds() {
  const text = await bridge.readBinds().catch(() => null);
  mine = text ? parseActionmaps(text) : { kb: {}, stick: {} };
  const n = Object.keys(mine.kb).length;
  $('binds-note').textContent = text ? `${n} keyboard binds from your actionmaps.xml` : 'Default binds (no actionmaps.xml yet)';
  cache.clear();
  render();
  paintBindHealth();
}

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
  const missing = [], stick = [], shared = [], seen = new Map();
  for (const k of byAction.values()) {
    const spec = bindOf(k);
    if (!spec) { (mine.stick[k.action] ? stick : missing).push(k.label); continue; }
    const id = `${k.actionmap || ''}|${k.activation || ''}|${spec}`;
    const other = seen.get(id);
    if (other) shared.push(`${other.label} and ${k.label} (${keyText(spec)})`);
    else seen.set(id, k);
  }
  return { total: byAction.size, missing, stick, shared };
}
const listOf = (a, n = 4) => a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '');
function paintBindHealth() {
  const h = bindHealth();
  const bad = h.missing.length + h.stick.length;
  const row = $('bind-health');
  row.className = `health ${bad ? 'warn' : h.shared.length ? 'info' : 'ok'}`;
  row.querySelector('b').textContent = bad
    ? `${bad} of ${h.total} keys can't be pressed from the console`
    : `All ${h.total} keys the console uses have a keyboard bind`;
  const lines = [];
  if (h.missing.length) lines.push(`No keyboard key: ${listOf(h.missing)}.`);
  if (h.stick.length) lines.push(`Joystick only: ${listOf(h.stick)}.`);
  if (h.shared.length) lines.push(`Sharing a key: ${listOf(h.shared, 2)}.`);
  if (bad) lines.push('Add the console\'s binds, then pick "xeneon" in the game\'s Control Profiles.');
  row.querySelector('p').textContent = lines.join('\n') || 'Checked when the console starts and whenever your binds change.';
  const chip = $('binds-chip');
  chip.hidden = !bad;
  chip.querySelector('span').textContent = `${bad} ${bad === 1 ? 'key' : 'keys'} unbound`;
  $('binds-dot').hidden = !bad;
  return h;
}
const keyText = spec => (spec || '').split('+').map(p => ({ ralt: 'RAlt', lalt: 'LAlt', rctrl: 'RCtrl', lctrl: 'LCtrl', rshift: 'RShift', lshift: 'LShift', backspace: 'Bksp' }[p] || p.toUpperCase())).join(' ');

// ---------- sound ----------
let audio;
function tick(kind) {
  if (!opts.sound) return;
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
  else if (msg === 'unbound') toast(`${k.label} has no keyboard key. Pick "xeneon" in the game's Control Profiles.`, { label: 'Add binds', run: installBinds });
  else toast(msg);
}

async function send(k, mode, ms, node) {
  const spec = bindOf(k);
  if (!spec) { failed('unbound', k, node); return false; }
  try { await bridge.sendKey(spec, mode, ms, opts.anywhere); return true; } catch (e) { failed(e, k, node); return false; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Runs a key once: a tap long enough for its activation mode, or a macro's steps. */
async function fire(k, node) {
  if (!k) return false;
  if (k.role === 'macro') {
    for (const step of k.steps) {
      if (step.delay) await sleep(step.delay);
      else if (step.key && !(await send(step.key, 'tap', holdMs(step.key), node))) return false;
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

// ---------- toggle state (the game doesn't report these, so they show what you last pressed) ----------
const states = { gear: true };
const isOn = st => st.kind === 'set' ? states[st.key] === st.value : !!states[st.key];
function flip(st) { states[st.key] = st.kind === 'set' ? st.value : !states[st.key]; repaint(); }
function repaint() {
  for (const node of document.querySelectorAll('#console [data-state]')) {
    const st = JSON.parse(node.dataset.state), on = isOn(st);
    node.classList.toggle('on', on);
    const s = node.querySelector(':scope > .cap > .st, :scope > .st');
    if (s && st.labels) s.textContent = st.labels[on ? 0 : 1];
  }
  for (const node of document.querySelectorAll('#console .painted')) node.paint();
}

// ---------- the console ----------
const WEAPON = /spaceship_weapons|spaceship_missiles|spaceship_defensive|\b(rifle|pistol|knife|grenade)$/;
const theme = page => page.theme || pageById(layout, page.role?.tab || page.tab || 'flight')?.theme || { accent: '#5cc8e6', glyph: 'ship' };
let current = 'flight', rolePage = null, lastShip = 'flight', pageAccent = '#5cc8e6', makerAccent = null;
const applyAccent = () => stage.style.setProperty('--accent', makerAccent || pageAccent);

const K = {
  key: l => KEYS.get(l) || null,
  fitted: k => {
    const lacks = pageById(layout, current)?.role?.lacks || [];
    return !lacks.some(kit => KIT_KEYS[kit]?.includes(k.label));
  },
  bindText: k => (k.role === 'macro' ? '' : mine.stick[k.action] ? 'STICK' : keyText(bindOf(k))),
  isWeapon: k => WEAPON.test(`${k.actionmap} ${k.icon}`),
  bind, fire, wheel, flip, isOn, local, tick, toast, theme,
  fired: node => { if (opts.flash) flash(node, 'fired'); },
  scale: () => Math.min(innerWidth / 2560, innerHeight / 720),
  swipe: dir => {
    const i = SWIPE.findIndex(s => current.startsWith(s));
    const base = SWIPE[(i + dir + SWIPE.length) % SWIPE.length];
    tick('page');
    show(rolePage?.startsWith(base) ? rolePage : base);
  },
};
controls.init(K);
initScenes(K);

const cache = new Map(); // built plates by page, so switching back is instant
function render() {
  const page = pageById(layout, current);
  pageAccent = theme(page).accent;
  applyAccent();
  if (!cache.has(current)) cache.set(current, scene(page));
  $('console').replaceChildren(...cache.get(current));
  const role = moduleOf(current);
  if (role) arrange.place($('console'), arrange.orderFor(role));
  repaint();
  paintQuantum();
  paintSoftkeys();
}

function show(id) {
  if (!pageById(layout, id) || arrange.isEditing()) return;
  if (moduleOf(id)) lastShip = id;
  const changed = id !== current;
  current = id;
  if (changed) render(); else paintSoftkeys();
}

// Soft keys under the status display.
const SOFT = [
  { label: 'Ship', icon: 'ship', go: () => rolePage || lastShip, is: id => !!moduleOf(id) },
  { label: 'On foot', icon: 'helmet', go: () => 'onfoot', is: id => id === 'onfoot' },
  { label: 'Map', icon: 'map', go: () => 'map', is: id => id === 'map' },
  { label: 'Downed', icon: 'medical', go: () => 'downed', is: id => id === 'downed' },
  { label: 'Settings', icon: 'cog', go: null },
];
function buildSoftkeys() {
  const nav = $('softkeys');
  nav.replaceChildren(...SOFT.map(s => {
    const node = controls.h(`<div class="well"><div class="cap"><span class="led"></span>${controls.icon(s.icon, 18)}<span class="lg">${s.label}</span></div></div>`);
    controls.pressable(node, { up: () => { tick('page'); if (s.go) show(s.go()); else openSheet(true); } });
    s.node = node;
    return node;
  }));
}
function paintSoftkeys() { for (const s of SOFT) s.node?.classList.toggle('cur', !!s.is?.(current)); }

// ---------- settings sheet ----------
// Start with Windows and Screen off live in the app, since they matter before the console loads.
const APP_OPTS = ['autostart', 'screen_off'];
function setOpt(name, v) {
  opts[name] = v;
  if (APP_OPTS.includes(name)) bridge.setPref(name, v); else store.set(name, v);
  stage.classList.toggle('night', opts.night);
  document.querySelectorAll('.opt').forEach(o => o.classList.toggle('on', !!opts[o.dataset.opt]));
  $('auto').classList.toggle('on', opts.auto);
  if (name === 'anywhere') paintIdle();
  if (name === 'auto' && v) follow(true);
}
const TAB_ICONS = { general: 'cog', screen: 'bulb', feedback: 'pulse', binds: 'list', profile: 'person', about: 'download' };
function showSection(sec) {
  document.querySelectorAll('.tab[data-sec]').forEach(t => t.classList.toggle('cur', t.dataset.sec === sec));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.sec !== sec; });
}
function openSheet(open, sec) { if (sec) showSection(sec); $('sheet').hidden = !open; }
document.querySelectorAll('.tab[data-sec]').forEach(t => {
  t.querySelector('svg').innerHTML = GLYPHS[TAB_ICONS[t.dataset.sec]] || '';
  controls.pressable(t, { up: () => { tick('page'); showSection(t.dataset.sec); } });
});
showSection('general');
document.querySelectorAll('.opt').forEach(o => controls.pressable(o, { up: () => { tick('toggle'); setOpt(o.dataset.opt, !opts[o.dataset.opt]); } }));
controls.pressable($('sheet-close'), { up: () => openSheet(false) });
controls.pressable($('auto'), { up: () => { tick('toggle'); setOpt('auto', !opts.auto); } });
async function installBinds() {
  try { await bridge.installBinds(); toast('Added. In game: Options, Keybindings, Control Profiles, pick "xeneon", tick Keyboard only.'); }
  catch (e) { toast(String(e?.message || e)); }
}
const acts = { 'act-binds': [() => reloadBinds().then(() => toast('Binds reloaded')), 'reload'], 'act-install': [installBinds, 'layers'],
  'act-admin': [bridge.runAsAdmin, 'shield'], 'act-sleep': [() => { openSheet(false); bridge.sleepScreen(); }, 'moon'],
  'act-update': [installUpdate, 'download'], 'act-save': [saveProfile, 'download'], 'act-load': [loadProfile, 'reload'], 'act-quit': [bridge.quit, 'power'] };
for (const [id, [run, icon]] of Object.entries(acts)) {
  $(id).querySelector('svg').innerHTML = GLYPHS[icon] || '';
  controls.pressable($(id), { up: () => { tick('tap'); run(); } });
}
$('qt').querySelector('svg').innerHTML = GLYPHS.quantum;

// ---------- profile: settings, plate order, ship roles and keyboard binds in one file ----------
// Saved as Documents\Edge Cockpit\profile.json, to copy to another PC or keep as a backup.
const PROFILE_OPTS = ['night', 'sound', 'flash', 'auto', 'anywhere', 'autostart', 'screen_off'];
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
  const plates = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('xfd-order:')) plates[k.slice(10)] = store.get(k.slice(4), null);
  }
  const ships = await bridge.userShips().catch(() => null);
  const binds = await bridge.readBinds().catch(() => null);
  const profile = {
    app: 'edge-cockpit', format: 1, version: prefs.version, saved: new Date().toISOString(),
    settings: Object.fromEntries(PROFILE_OPTS.map(k => [k, !!opts[k]])),
    plates,
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
  for (const k of PROFILE_OPTS) if (typeof p.settings?.[k] === 'boolean') setOpt(k, p.settings[k]);
  for (const [role, order] of Object.entries(p.plates || {})) if (Array.isArray(order)) store.set(`order:${role}`, order);
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
}
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
$('toast-act').addEventListener('pointerdown', e => e.stopPropagation());

// ---------- game state ----------
let game = { ...EMPTY }, ship = null, lastAuto = null, lastSeq = 0;
const MAKERS = { AEGS: '#ff6b5b', ANVL: '#7fb2ff', DRAK: '#ff9f43', MISC: '#5fe0c8', RSI: '#9fb4ff', ORIG: '#f5f0e6', CRUS: '#6ec1ff', ARGO: '#f0b54a',
  CNOU: '#9be15d', ESPR: '#c49bff', KRIG: '#e0c070', BANU: '#d4a373', MRAI: '#ff7eb6', TMBL: '#f7d154', GRIN: '#b0e0a8', XIAN: '#7ef0ff', CRSD: '#6ec1ff', GAMA: '#c0d0e0' };
const glyph = n => `<svg class="i" viewBox="0 0 24 24">${GLYPHS[n] || ''}</svg>`;

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
  } else { name = game.me?.name || 'On foot'; role = game.me ? 'On foot' : 'In the verse'; figureFor = null; fig.innerHTML = glyph('helmet'); }
  const maker = game.seated && game.ship ? MAKERS[game.ship.split('_')[0]] : null;
  makerAccent = maker;
  applyAccent();
  stage.style.setProperty('--ship', maker || 'var(--accent)');
  paintIdle();
  $('ship-name').textContent = name;
  $('ship-role').textContent = role;

  // Law: red for CrimeStat or comms down, amber in lawless space, green in armistice.
  const law = $('law');
  let lawText = null, lawCls = '';
  if (game.crime > 0) { lawText = `CrimeStat ${game.crime}`; lawCls = 'bad'; }
  else if (game.monitored === 'down') { lawText = 'Comms down'; lawCls = 'bad'; }
  else if (lawless(game)) { lawText = 'Lawless'; lawCls = 'warn'; }
  else if (game.armistice) { lawText = 'Armistice'; lawCls = 'ok'; }
  else if (game.monitored === 'yes') { lawText = 'Monitored'; lawCls = 'info'; }
  law.hidden = !lawText || game.menu;
  law.className = 'chip ' + lawCls;
  law.querySelector('span').textContent = lawText || '';
  const zone = $('zone');
  zone.hidden = !game.jurisdiction || game.menu;
  zone.querySelector('span').textContent = (game.jurisdiction || '').replace(/ Jurisdiction$/, '');

  const chip = (id, text, cls = '') => { const c = $(id); c.hidden = !text || game.menu; c.className = 'chip ' + cls; c.querySelector('span').textContent = text || ''; };
  chip('place', game.location && placeName(game.location));
  chip('kills', game.kills ? `Kills ${game.kills}` : null, 'info');
  chip('wreck', game.wrecked && game.seated ? (game.wrecked > 1 ? 'Ship destroyed' : 'Ship disabled') : null, 'bad');
  // A game build of another major version than the panel knows: say so, and carry on.
  const odd = untested(game);
  $('build').hidden = !odd;
  $('build').querySelector('span').textContent = odd ? `Untested build ${version(game.build.branch)}` : '';
  $('qt').hidden = !game.qtTarget;
  $('qt-name').textContent = (game.qtTarget || '').replace(/_/g, ' ');

  const m = game.mission, card = $('mission');
  card.hidden = !m || (!m.contract && !m.objective);
  if (m) {
    card.className = 'mission' + (m.status === 'complete' ? ' done' : m.status === 'failed' || m.status === 'withdrawn' ? ' failed' : '');
    $('mission-kind').textContent = m.status === 'active' ? (m.objective ? 'Objective' : 'Mission') : 'Mission ' + m.status;
    $('mission-text').textContent = [m.objective, m.contract].filter(Boolean).join(' · ');
    if (m.seq !== lastSeq && lastSeq) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 3000); }
    lastSeq = m.seq;
  }

  // Moods: the whole panel reacts to where you are and what is happening.
  const inWorld = !game.menu;
  stage.classList.toggle('standby', !info.running || game.menu);
  stage.classList.toggle('armistice', inWorld && game.armistice && !game.down);
  stage.classList.toggle('alert', inWorld && (game.crime > 0 || lawless(game) || (game.seated && game.wrecked > 0)));
  stage.classList.toggle('downed', inWorld && game.down);
  paintQuantum();
}
function paintQuantum() {
  const ready = !game.menu && game.seated && !!game.qtTarget;
  document.querySelectorAll('#console .quantum').forEach(q => { q.classList.toggle('ready', ready); q.querySelector('.st').textContent = ready ? 'READY · HOLD' : 'HOLD'; });
}

/** Opens the page for the moment when that changes, unless you turned auto pages off. */
function follow(force) {
  ship = game.seated ? lookup(shipsDb.ships, overrides.ships, game.ship) : null;
  const { id } = pageFor(layout, game, shipsDb.ships, overrides.ships);
  rolePage = moduleOf(id) && id !== 'flight' ? id : null;
  if (opts.auto && (force || id !== lastAuto)) show(id);
  lastAuto = id;
}

bridge.onGameLog(({ lines, live, reset }) => {
  // A new Game.log means a new channel or a restart: its binds may differ too.
  if (reset) { game = { ...EMPTY }; lastSeq = 0; if (bridge.inApp) { reloadBinds(); loadUserShips(); } }
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) game = reduce(game, ev);
  }
  follow(!live);
  paintStatus();
  paintChannel();
});

let info = { running: false, focused: false, elevated: false, channel: null };
function paintChannel() {
  // OFFLINE with no game; the game's channel and version (LIVE 4.10.3, PTU 4.11) while it runs.
  const on = info.running && info.channel;
  const ch = on ? info.channel.split(/[\\/]/).pop().toUpperCase() : 'OFFLINE';
  $('channel').textContent = on && game.build?.branch ? `${ch} ${version(game.build.branch)}` : ch;
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
  if (!info.running && !game.menu) { game = { ...EMPTY, me: game.me }; follow(false); }
  paintStatus();
}

// ---------- clock and scale ----------
function clock() { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function fit() { stage.style.transform = `scale(${K.scale()})`; }
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
  onDone: () => toast('Layout saved for this role'),
});
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
setTimeout(() => { checkUpdate(); setInterval(checkUpdate, 6 * 3600_000); }, 20_000);
setOpt('night', opts.night);
render();
await reloadBinds();
poll(); setInterval(poll, 2000);
paintStatus();
if (demo) { opts.auto = false; show(demo); }
stage.classList.remove('booting');
window.xfd = { show, bindHealth, bindsProfile, pages: () => layout.decks.find(d => d.id === 'main').pages.map(p => p.id) };
document.body.dataset.ready = '1';
