// The pages of the console. A ship page is four plates: power, the role module, flight
// and gear. On foot, map and downed pages use the whole width for their own plates.
import { plate, placard, label, keycap, rocker, toggle, onOff, onOffKey, rotary, wheelKnob, slider, slideConfirm, guard, gearLever, quantum,
  roundButton, dial, missileRack, screen, icon, esc, h, pressable, blank } from './controls.js';
import { lefts, unset } from './lib/custom.js';

let K;
export const init = ctx => { K = ctx; };

// Plate positions on the 2560 x 720 stage (the status display is 6..376).
const X = { power: 382, role: 838, flight: 1662, gear: 2280 };
const W = { power: 450, role: 818, flight: 612, gear: 274 };

/** Which role module a page shows. */
export const MODULE = {
  flight: 'systems', power: 'systems', combat: 'fighter', industry: 'mining',
  'multi-crew': 'crew', mfd: 'mfd', mining: 'mining', salvage: 'salvage', cargo: 'cargo', medical: 'medical', ground: 'ground',
};
/** Your own pages by id (lib/custom.js), set by the app. They follow the curated ship pages in the swipe. */
export const CUSTOM = new Map();
export const moduleOf = id => (CUSTOM.has(id) ? CUSTOM.get(id).module || 'systems' : null) || MODULE[id] || (id.startsWith('light-fighter') || id.startsWith('heavy-fighter') ? 'fighter' : id.startsWith('multi-crew') ? 'crew' : null);
/** Pages a swipe on the role module steps through. */
export const SWIPE = ['light-fighter', 'heavy-fighter', 'multi-crew', 'mining', 'salvage', 'cargo', 'medical', 'ground', 'flight', 'mfd'];
/** The swipe with your pages after the curated ones. */
export const swipeList = () => [...SWIPE, ...CUSTOM.keys()];
/** Where a page sits in the swipe: your pages by id, curated ones by their base. */
export const swipeIndex = id => (CUSTOM.has(id) ? SWIPE.length + [...CUSTOM.keys()].indexOf(id) : SWIPE.findIndex(s => id.startsWith(s)));

const tag = (el, cls) => { el.classList.add(cls); return el; };
const add = (p, ...els) => { for (const e of els.flat()) if (e) p.appendChild(e); return p; };
const cut = { cut: true, lc: 'var(--cyan)', lit: true };
// Open and close rather than one toggle: the game doesn't say whether the doors are open.
const doors = (x, w) => [keycap(x, 44, w, 92, 'Open doors', { fs: 12, kb: w > 110 }), keycap(x, 140, w, 92, 'Close doors', { fs: 12, kb: w > 110 })];

// ================= ship plates =================

function powerPlate() {
  const p = plate(X.power, W.power, 'Power');
  return add(p,
    onOff(16, 44, 'Power', { guard: true, w: 100 }), onOff(122, 44, 'Thrusters', { w: 100 }),
    onOff(228, 44, 'Shields', { w: 100 }), onOff(334, 44, 'Weapons', { w: 100 }),
    tag(keycap(18, 262, 274, 196, 'Flight ready', { fs: 22, is: 40, lc: 'var(--ok)', lit: true }), 'when-ok'),
    tag(keycap(298, 262, 134, 196, 'All systems on', { label: 'All systems on', fs: 13, is: 28, ...cut }), 'when-ok'),
    // With the ship disabled, what helps instead: repair it, or get out.
    tag(keycap(18, 262, 274, 196, 'Self repair', { label: 'Self repair all', fs: 20, is: 40, lc: 'var(--ok)', lit: true }), 'when-wrecked'),
    tag(keycap(298, 262, 134, 196, 'Emergency exit', { fs: 13, is: 28, lc: 'var(--danger)', lit: true }), 'when-wrecked'),
    placard(18, 470, 'Power assignment'),
    keycap(18, 496, 134, 92, 'Weapons +', { fs: 12 }), keycap(158, 496, 134, 92, 'Engines +', { fs: 12 }),
    keycap(298, 496, 134, 92, 'Shields +', { fs: 12 }),
    keycap(18, 596, 414, 90, 'Power reset', { fs: 13 }));
}

function flightPlate() {
  const p = plate(X.flight, W.flight, 'Flight');
  add(p,
    slider(20, 62, 112, 480, { title: 'Speed limit', onStep: s => K.wheel(s, p) }),
    onOffKey(20, 590, 112, 96, 'Speed limiter', { label: 'Limiter' }),
    rotary(150, 52, 116, [{ label: 'SCM', angle: -40, key: 'Set SCM' }, { label: 'NAV', angle: 40, key: 'Set NAV' }], { title: 'Flight mode', pointer: 'var(--cyan)', radius: 92 }),
    quantum(372, 44, 220, 'Quantum'),
    onOffKey(150, 276, 140, 90, 'Decoupled'),
    keycap(296, 276, 140, 90, 'Freelook', { fs: 13 }),
    keycap(442, 276, 150, 90, 'Startup', { label: 'Ready & ATC', fs: 13, ...cut }),
    keycap(150, 374, 150, 78, 'Decoy', { fs: 13 }),
    rocker(306, 374, 142, 78, 'Decoy burst −', 'Decoy burst +', { vertical: false, ia: false, ib: false, la: 'Burst −', lb: 'Burst +' }),
    keycap(454, 374, 138, 78, 'Noise', { fs: 13 }),
  );
  const brake = h('<div class="hz" style="left:150px;top:460px;width:442px;height:110px"></div>');
  brake.appendChild(keycap(8, 8, 426, 94, 'Space brake', { fs: 20, is: 30, lc: 'var(--hold)', lit: true }));
  return add(p, brake,
    keycap(150, 580, 106, 106, 'ATC request', { fs: 11, is: 20 }), keycap(262, 580, 106, 106, 'Autoland', { fs: 11, is: 20 }),
    onOffKey(374, 580, 106, 106, 'Lights'), onOffKey(486, 580, 106, 106, 'VTOL'));
}

function gearPlate() {
  const p = plate(X.gear, W.gear, 'Gear');
  return add(p,
    gearLever(24, 40, 'Gear'),
    placard(24, 456, 'Eject', 'red'), slideConfirm(24, 480, 226, 88, 'Eject', { text: 'SLIDE TO EJECT' }),
    placard(24, 584, 'Self destruct', 'red'), guard(24, 608, 226, 78, 'Self destruct'));
}

// ================= role modules (818 wide) =================

function fighter() {
  const cx = 409, cy = 368;
  return [
    dial(cx, cy, {
      bezel: 258, centreR: 80, centre: 'Auto target',
      rings: [
        { r0: 94, r1: 188, keys: [{ label: 'Lock 1', a0: -88, a1: -2 }, { label: 'Lock 2', a0: 2, a1: 88 }, { label: 'Lock 3', a0: 92, a1: 178 }, { label: 'Unlock', a0: 182, a1: 268 }] },
        { r0: 196, r1: 238, keys: [{ label: 'Look ahead', a0: -64, a1: -22 }, { label: 'Ping', a0: -20, a1: 20 }, { label: 'Scan mode', a0: 22, a1: 64 },
          { label: 'Next hostile', text: 'Hostile', a0: 68, a1: 100 }, { label: 'Next attacker', text: 'Attacker', a0: 102, a1: 134 },
          { label: 'Look behind', a0: 136, a1: 178 }, { label: 'Gimbal mode', text: 'Cycle gimbal', a0: 182, a1: 224 },
          { label: 'Subtarget', a0: 226, a1: 258 }, { label: 'Aim mode', text: 'Aim', a0: 260, a1: 294 }] },
      ],
    }),
    placard(20, 54, 'Missiles'), missileRack(20, 80, 128, 148),
    keycap(20, 238, 128, 92, 'Missiles +', { fs: 13 }),
    keycap(20, 338, 62, 100, 'EMP', { fs: 13, is: 20 }), keycap(86, 338, 62, 100, 'QED', { fs: 13, is: 20 }),
    keycap(20, 446, 62, 110, 'Missiles reset', { label: 'Reset', fs: 11, is: 20 }), keycap(86, 446, 62, 110, 'Missile mode', { label: 'MSL mode', fs: 11, is: 20, kb: false }),
    keycap(20, 564, 128, 122, 'Combat prep', { label: 'Battle stations', fs: 12, ...cut }),
    placard(670, 54, 'Gimbals'),
    rotary(670, 80, 68, [{ label: 'Locked', angle: -48, key: 'Gimbals locked' }, { label: 'Free', angle: 48, key: 'Gimbals free' }], { radius: 60 }),
    tag(placard(670, 252, 'Gun groups'), 'guns-placard'),
    keycap(670, 278, 62, 220, 'Guns group 1', { label: '1', fs: 26, r: 31, icon: 'guns' }),
    keycap(738, 278, 62, 220, 'Guns group 2', { label: '2', fs: 26, r: 31, icon: 'guns' }),
    onOffKey(670, 508, 130, 84, 'Staggered fire', { label: 'Stagger' }),
    keycap(670, 600, 130, 86, 'Evade', { fs: 12, ...cut }),
  ];
}

function crew() {
  return [
    dial(256, 380, {
      bezel: 236, centreR: 72, centre: 'Auto target',
      rings: [
        { r0: 84, r1: 168, keys: [{ label: 'Lock 1', a0: -88, a1: -2 }, { label: 'Lock 2', a0: 2, a1: 88 }, { label: 'Lock 3', a0: 92, a1: 178 }, { label: 'Unlock', a0: 182, a1: 268 }] },
        { r0: 176, r1: 214, keys: [{ label: 'Look ahead', a0: -64, a1: -22 }, { label: 'Ping', a0: -20, a1: 20 }, { label: 'Scan mode', a0: 22, a1: 64 }] },
      ],
    }),
    ...doors(500, 98), toggle(602, 44, 'Door locks', { w: 98 }), toggle(704, 44, 'Look behind', { w: 98 }),
    keycap(500, 256, 148, 90, 'Operator mode', { fs: 12 }), keycap(652, 256, 148, 90, 'Gimbal mode', { label: 'Cycle gimbal', fs: 12 }),
    keycap(500, 354, 148, 90, 'Guns group 1', { fs: 12 }), keycap(652, 354, 148, 90, 'Guns group 2', { fs: 12 }),
    keycap(500, 452, 148, 90, 'Missiles +', { fs: 12 }), missileRack(656, 456, 140, 82),
    keycap(500, 550, 98, 136, 'Loading area', { fs: 11 }), keycap(602, 550, 98, 136, 'Port locks', { fs: 11 }), keycap(704, 550, 96, 136, 'Docking request', { label: 'Docking', fs: 11 }),
  ];
}

function mining() {
  return [
    wheelKnob(259, 116, 200, { title: 'Laser power' }),
    keycap(254, 610, 310, 76, 'Mining mode', { fs: 14, lc: 'var(--cyan)' }),
    keycap(20, 60, 150, 110, 'Scan mode', { fs: 13, lc: 'var(--cyan)' }), keycap(20, 178, 150, 110, 'Ping', { fs: 13 }),
    keycap(20, 296, 150, 100, 'Lock rotation', { fs: 12 }), keycap(20, 404, 150, 100, 'Operator mode', { fs: 12 }),
    keycap(20, 512, 150, 84, 'Clear pins', { fs: 12 }), keycap(20, 604, 150, 82, 'Loading area', { fs: 12 }),
    placard(648, 54, 'Modules'),
    ...[1, 2, 3].map(m => keycap(648, 80 + (m - 1) * 84, 150, 76, `Module ${m}`, { fs: 13, lc: 'var(--cyan)' })),
    keycap(648, 332, 150, 76, 'Perm. module', { label: 'Permanent module', fs: 12, icon: false }),
    keycap(648, 416, 150, 84, 'Laser type', { fs: 13 }),
    placard(648, 512, 'Jettison', 'red'), guard(648, 536, 150, 150, 'Jettison cargo'),
  ];
}

function salvage() {
  return [
    dial(409, 330, {
      bezel: 236, centreR: 74, centre: 'Focus all',
      rings: [{ r0: 86, r1: 200, keys: [{ label: 'Fracture', a0: -44, a1: 44 }, { label: 'Fire right', a0: 46, a1: 134 }, { label: 'Disintegrate', a0: 136, a1: 224 }, { label: 'Fire left', a0: 226, a1: 314 }] }],
    }),
    keycap(20, 60, 150, 110, 'Salvage mode', { fs: 13, lc: 'var(--cyan)' }),
    keycap(20, 178, 150, 100, 'Head gimbal', { fs: 12 }), keycap(20, 286, 150, 100, 'Reset gimbal', { fs: 12 }),
    keycap(20, 394, 150, 100, 'Focus fracture', { fs: 12 }), keycap(20, 502, 150, 84, 'Scan mode', { fs: 12 }), keycap(20, 594, 150, 92, 'Lock rotation', { fs: 12 }),
    slider(666, 66, 112, 420, { title: 'Beam spacing', onStep: s => K.wheel(s, null), colour: 'var(--hold)' }),
    placard(648, 534, 'Jettison', 'red'), guard(648, 558, 150, 128, 'Jettison cargo'),
    keycap(200, 600, 200, 86, 'Ping', { fs: 13 }), keycap(418, 600, 200, 86, 'Operator mode', { fs: 13 }),
  ];
}

function cargo() {
  const beam = (s, el) => K.fire(K.key(s > 0 ? 'Beam farther' : 'Beam closer'), el);
  return [
    ...doors(20, 100), toggle(126, 44, 'Door locks', { w: 100 }), toggle(232, 44, 'Port locks', { w: 100 }),
    keycap(20, 258, 154, 92, 'Loading area', { fs: 12 }), keycap(180, 258, 154, 92, 'Lock rotation', { fs: 12 }),
    keycap(20, 358, 154, 92, 'Cruise throttle', { fs: 12 }), keycap(180, 358, 154, 92, 'Ping', { fs: 12 }),
    keycap(20, 458, 154, 92, 'Scan mode', { fs: 12 }), keycap(180, 458, 154, 92, 'Operator mode', { fs: 12 }),
    keycap(20, 558, 314, 128, 'Docking request', { fs: 14 }),
    placard(380, 54, 'Tractor beam'),
    slider(380, 86, 112, 520, { title: 'Beam distance', onStep: beam, colour: 'var(--hold)' }),
    roundButton(540, 80, 230, 'Tractor rotate', { colour: 'var(--hold)', is: 40 }),
    keycap(530, 340, 250, 100, 'Tractor detach', { fs: 14 }),
    keycap(530, 452, 250, 120, 'Look behind', { fs: 13 }),
    keycap(530, 584, 250, 102, 'Look ahead', { fs: 13 }),
  ];
}

function medical() {
  return [
    dial(296, 364, {
      bezel: 250, centreR: 82, centre: 'Scan mode',
      rings: [
        { r0: 94, r1: 190, keys: [{ label: 'Loading area', a0: -88, a1: -2 }, { label: 'Docking request', a0: 2, a1: 88 }, { label: 'Look behind', a0: 92, a1: 178 }, { label: 'Look ahead', a0: 182, a1: 268 }] },
        { r0: 198, r1: 236, keys: [{ label: 'Ping', a0: -40, a1: -2 }, { label: 'Lock rotation', a0: 2, a1: 40 }] },
      ],
    }),
    ...doors(566, 116), toggle(684, 44, 'Door locks', { w: 116 }),
    keycap(566, 256, 116, 96, 'Port locks', { fs: 12 }), keycap(686, 256, 114, 96, 'Operator mode', { fs: 11 }),
    keycap(566, 360, 116, 96, 'Gimbal mode', { label: 'Cycle gimbal', fs: 11 }), keycap(686, 360, 114, 96, 'Guns group 1', { fs: 11 }),
    keycap(566, 464, 234, 96, 'Cruise throttle', { fs: 13 }),
    keycap(566, 568, 234, 118, 'Visor wipe', { fs: 13 }),
  ];
}

function ground() {
  return [
    dial(296, 364, {
      bezel: 250, centreR: 82, centre: 'Third person',
      rings: [
        { r0: 94, r1: 190, keys: [{ label: 'Lock 1', a0: -88, a1: -2 }, { label: 'Unlock', a0: 2, a1: 88 }, { label: 'Look behind', a0: 92, a1: 178 }, { label: 'Gimbal mode', text: 'Cycle gimbal', a0: 182, a1: 268 }] },
        { r0: 198, r1: 236, keys: [{ label: 'Scan mode', a0: -40, a1: -2 }, { label: 'Ping', a0: 2, a1: 40 }] },
      ],
    }),
    ...doors(566, 116), toggle(684, 44, 'Door locks', { w: 116 }),
    keycap(566, 256, 234, 96, 'Operator mode', { fs: 13 }),
    keycap(566, 360, 116, 96, 'Guns group 1', { fs: 11 }), keycap(686, 360, 114, 96, 'Guns group 2', { fs: 11 }),
    keycap(566, 464, 234, 96, 'Auto target', { fs: 13 }),
    keycap(566, 568, 116, 118, 'Look ahead', { fs: 12 }), keycap(686, 568, 114, 118, 'Horn', { fs: 13 }),
  ];
}

function systems() {
  const row = (y, ht, labels, o = {}) => labels.map((l, i) => keycap(23 + i * 130, y, 122, ht, l, { fs: 11, is: 20, ...o }));
  return [
    ...['G-safe', 'ESP', 'Proximity assist', 'Lock rotation', 'Advanced HUD', 'Door locks'].map((l, i) => onOff(19 + i * 112, 44, l, { w: 108 })),
    ...doors(19 + 6 * 112, 108),
    ...row(258, 100, ['Cruise throttle', 'Loading area', 'Docking request', 'Scan mode', 'Ping', 'Starmap']),
    ...row(366, 100, ['Look behind', 'Look ahead', 'Port locks', 'Chat window']),
    onOffKey(23 + 4 * 130, 366, 122, 100, 'Stability'), onOffKey(23 + 5 * 130, 366, 122, 100, 'Gravity comp'),
    keycap(23, 476, 250, 98, 'Combat prep', { label: 'Battle stations', fs: 13, ...cut }), keycap(281, 476, 250, 98, 'Evade', { fs: 13, ...cut }),
    rocker(539, 476, 256, 98, 'Throttle −', 'Throttle +', { vertical: false }),
    keycap(23, 584, 250, 102, 'Weapons max', { fs: 13 }), keycap(281, 584, 250, 102, 'Shields max', { fs: 13 }), keycap(539, 584, 256, 102, 'Engines max', { fs: 13 }),
  ];
}

// MFD screens, the assists that have their own ON and OFF, and self repair.
function mfd() {
  const views = [['MFD Comms', 'Comms'], ['MFD Diagnostics', 'Diagnostics'], ['MFD IFCS', 'IFCS'], ['MFD Power', 'Power'],
    ['MFD Scanning', 'Scanning'], ['MFD Self status', 'Self status'], ['MFD Target status', 'Target status'], ['MFD Config', 'Config']];
  return [
    placard(23, 46, 'MFD screens'),
    ...views.map(([l, label], i) => keycap(23 + (i % 4) * 194, 76 + Math.floor(i / 4) * 116, 186, 108, l, { label, fs: 13, is: 24 })),
    placard(23, 316, 'Assists'),
    ...['Light amp', 'Auto precision', 'Wind comp'].map((l, i) => onOff(23 + i * 128, 346, l, { w: 120 })),
    placard(431, 316, 'Repair'),
    keycap(431, 346, 364, 196, 'Self repair', { label: 'Self repair all', fs: 15, is: 30 }),
    label(23, 572, 772, 'The game does not say which screen shows, so these keys light only while pressed', 'left'),
  ];
}

// ================= log =================
/** What the game logged this session: the last time you went down, where you are, refining, ships, and a timeline. */
function logPage() {
  const p = plate(382, 1100, 'Log', { cls: 'logp' });
  const card = (id, x, y, w, ht, title) => screen(x, y, w, ht, `<small>${esc(title)}</small><span class="t" id="${id}-t"></span><b id="${id}-b"></b><p id="${id}-p"></p><p id="${id}-q"></p>`, 'card');
  // Two plates, so that two-row mode can stack them.
  const list = plate(1488, 1066, 'This session', { cls: 'logp' });
  const stats = [['lg-time', 'Played'], ['lg-kills', 'Injuries'], ['lg-deaths', 'Downed'], ['lg-missions', 'Missions'], ['lg-ships-n', 'Ships flown']]
    .map(([id, l]) => `<div><b id="${id}">0</b><small>${esc(l)}</small></div>`).join('');
  return [add(p,
    card('lg-down', 24, 46, 520, 150, 'Last downed'), card('lg-where', 556, 46, 520, 150, 'Where'),
    card('lg-ref', 24, 204, 520, 150, 'Refinery'), card('lg-ships', 556, 204, 520, 150, 'Ships'),
    screen(24, 362, 1052, 318, '<small>Past sessions</small><span class="note" id="lg-past-note"></span><table id="lg-past"></table>', 'past')),
  add(list, screen(24, 46, 1018, 96, stats, 'stats'), screen(24, 154, 1018, 526, '<ol id="lg-list"></ol>', 'list'))];
}

// ================= world =================
/** Executive hangars, your timers and servers on one plate; the commodity market where you are on the other. The content is painted by world.js. */
function worldPage() {
  const a = plate(382, 1100, 'World', { cls: 'worldp' });
  const named = (el, id) => { el.id = id; return el; };
  add(a, named(screen(24, 46, 1052, 334, '', 'card xh'), 'wd-xh'), named(screen(24, 392, 640, 292, '', 'tm-wrap'), 'wd-tm'), named(screen(676, 392, 400, 292, '', 'sv'), 'wd-sv'));
  const b = plate(1488, 1066, 'Commodities', { cls: 'worldp' });
  add(b, h('<div class="cm-head" id="wd-cmhead"></div>'), named(screen(24, 118, 1018, 488, '', 'cm'), 'wd-cm'), h('<div class="cm-foot" id="wd-cmfoot"></div>'));
  return [a, b];
}

const MODULES = { mfd, fighter, crew, mining, salvage, cargo, medical, ground, systems };
/** The role modules you can put on a ship page, in the order arrange mode offers them. */
export const MODULE_NAMES = { fighter: 'Fighter', crew: 'Crew', mining: 'Mining', salvage: 'Salvage', cargo: 'Cargo', medical: 'Medical', ground: 'Ground', systems: 'Systems', mfd: 'MFD' };

/** Page n of the ship pages, with arrows to step through them as well as swiping. */
function pager(i) {
  const el = h(`<div class="pager"><button class="pg prev" aria-label="Previous ship page">${icon('left', 18)}</button>
    <span><b>${i + 1}</b> / ${swipeList().length}</span><button class="pg next" aria-label="Next ship page">${icon('right', 18)}</button></div>`);
  for (const [sel, dir] of [['.prev', -1], ['.next', 1]]) {
    const b = el.querySelector(sel);
    pressable(b, { up: () => K.swipe(dir) });
    // A tap on an arrow is not the start of a swipe.
    b.addEventListener('pointerdown', e => e.stopPropagation());
  }
  return el;
}

function rolePlate(page) {
  const p = plate(X.role, W.role, '', { cls: 'rolemod' });
  const id = page.id;
  const i = swipeIndex(id);
  const mine = CUSTOM.has(id);
  // You can put another role module on a ship page (arrange mode); the title says so. Your own pages carry their own.
  const stock = moduleOf(id), mod = (!mine && K.moduleFor?.(id)) || stock;
  const swapped = mod !== stock && MODULES[mod];
  add(p, h(`<div class="rtitle">${icon(K.theme(page).glyph, 18)}<span>${esc(page.name)}</span>${mine ? '<small class="yours">Yours</small>' : swapped ? `<small>${esc(MODULE_NAMES[mod])} module</small>` : ''}</div>`),
    pager(i),
    h('<div class="swipe-hint lab">‹ swipe or tap the arrows for other ships ›</div>'));
  add(p, MODULES[swapped ? mod : stock]());
  // Swipe sideways anywhere on the plate between controls to step through the role modules.
  let x0 = null;
  p.addEventListener('pointerdown', e => { x0 = e.clientX; });
  p.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = (e.clientX - x0) / K.scale();
    x0 = null;
    if (Math.abs(dx) > 120) K.swipe(dx < 0 ? 1 : -1);
  });
  return p;
}

// ================= on foot, map, downed =================

function weaponWheel(cx, cy) {
  const keys = [['Primary', -36, 36], ['Secondary', 36, 108], ['Sidearm', 108, 180], ['Melee', 180, 252], ['Gadget', 252, 324]];
  return dial(cx, cy, { bezel: 270, centreR: 96, centre: 'Reload', rings: [{ r0: 110, r1: 250, keys: keys.map(([l, a0, a1]) => ({ label: l, a0: a0 + 1, a1: a1 - 1 })) }] });
}

function onFoot() {
  const a = plate(382, 760, 'Weapons');
  add(a, weaponWheel(380, 370),
    toggle(20, 44, 'Lower weapon', { w: 120 }), toggle(620, 44, 'Flashlight', { w: 120 }),
    keycap(20, 560, 150, 126, 'Crouch', { fs: 14 }), keycap(590, 560, 150, 126, 'Third person', { fs: 13 }));
  const b = plate(1148, 600, 'Suit');
  add(b, toggle(24, 44, 'Helmet on/off', { w: 130, label: 'Helmet' }),
    keycap(170, 50, 196, 120, 'Visor wipe', { fs: 14 }), keycap(374, 50, 202, 120, 'mobiGlas', { fs: 14, is: 30 }),
    roundButton(24, 256, 260, 'Heal target', { colour: 'var(--ok)', is: 44 }),
    roundButton(316, 256, 260, 'Consume', { colour: 'var(--hold)', is: 44 }),
    keycap(24, 560, 268, 126, 'Tractor detach', { fs: 14 }), keycap(300, 560, 276, 126, 'Revive request', { fs: 14 }));
  return [a, b, comms(1754, 800)];
}

function comms(x, w) {
  const p = plate(x, w, 'Comms and map');
  const half = (w - 60) / 2;
  add(p, placard(20, 44, 'Replies'),
    ...[1, 2, 3, 4].map(n => keycap(20, 70 + (n - 1) * 124, half, 116, `Reply ${n}`, { fs: 16, icon: 'chat' })),
    keycap(20, 566, half / 2 - 4, 116, 'Reply 5', { fs: 14, icon: 'chat' }),
    pageKey(24 + half / 2, 566, half / 2 - 4, 116, 'Emotes', 'hand', 'emotes'),
    keycap(40 + half, 70, half, 116, 'Local map', { fs: 15 }), keycap(40 + half, 194, half, 116, 'Starmap', { fs: 15 }),
    keycap(40 + half, 318, half, 116, 'Plan route', { fs: 15 }), keycap(40 + half, 442, half / 2 - 4, 116, 'Accept', { fs: 14 }), keycap(44 + half * 1.5, 442, half / 2 - 4, 116, 'Ignore', { fs: 14 }),
    keycap(40 + half, 566, half / 2 - 4, 116, 'Chat window', { label: 'Chat', fs: 14 }),
    keycap(44 + half * 1.5, 566, half / 2 - 4, 116, 'Push to talk', { fs: 13 }));
  return p;
}

/** A key that opens another console page rather than pressing a game key. */
function pageKey(x, y, w, ht, text, glyph, page) {
  const el = h(`<div class="well key page-key" style="left:${x}px;top:${y}px;width:${w}px;height:${ht}px">
    <div class="cap">${icon(glyph, 22)}<span class="lg" style="--fs:14px">${esc(text)}</span><span class="tg">PAGE</span></div></div>`);
  pressable(el, { up: () => K.go(page) });
  return el;
}

const EMOTES = ['Wave', 'Salute', 'Point', 'Come', 'Wait', 'Agree', 'Disagree', 'Cheer', 'Clap', 'Laugh', 'Dance', 'Bow',
  'Greet', 'Threaten', 'Taunt', 'Rude', 'Sit', 'Sleep', 'Flex', 'Gloat', 'Angry', 'At ease', 'Attention', 'Whistle'];

function emotes() {
  const a = plate(382, 760, 'Hand signals');
  add(a,
    keycap(280, 50, 200, 140, 'Signal forward', { label: 'Forward', fs: 15, is: 36 }),
    keycap(70, 200, 200, 140, 'Signal left', { label: 'Left', fs: 15, is: 36 }),
    keycap(280, 200, 200, 140, 'Signal stop', { label: 'Stop', fs: 15, is: 36 }),
    keycap(490, 200, 200, 140, 'Signal right', { label: 'Right', fs: 15, is: 36 }),
    keycap(70, 380, 305, 140, 'Signal yes', { label: 'Yes', fs: 15, is: 36 }),
    keycap(385, 380, 305, 140, 'Signal no', { label: 'No', fs: 15, is: 36 }),
    pageKey(70, 560, 620, 120, 'Back to on foot', 'back', 'onfoot'));
  const b = plate(1148, 1406, 'Emotes');
  const cw = (1406 - 40 - 5 * 8) / 6, rh = 150;
  add(b, ...EMOTES.map((l, i) => keycap(20 + (i % 6) * (cw + 8), 50 + Math.floor(i / 6) * (rh + 8), cw, rh, l, { fs: 15, is: 58 })));
  return [a, b];
}

function mapPage() {
  const a = plate(382, 760, 'Map');
  add(a,
    dial(380, 380, {
      bezel: 270, centreR: 96, centre: 'Go to selection',
      rings: [{ r0: 110, r1: 250, keys: [{ label: 'Local map', a0: -44, a1: 44 }, { label: 'My location', a0: 46, a1: 134 }, { label: 'Plan route', a0: 136, a1: 224 }, { label: 'Step back', a0: 226, a1: 314 }] }],
    }),
    keycap(20, 44, 150, 110, 'Clear route', { fs: 13 }), keycap(590, 44, 150, 110, 'QT actions', { fs: 13 }),
    keycap(20, 576, 150, 110, 'Starmap', { fs: 13 }), keycap(590, 576, 150, 110, 'mobiGlas', { fs: 13 }));
  const b = plate(1148, 600, 'Displays');
  add(b,
    rocker(24, 50, 270, 140, 'Scan tab ◀', 'Scan tab ▶', { vertical: false, ia: 'left', ib: 'right' }), label(24, 196, 270, 'Scan tab'),
    rocker(306, 50, 270, 140, 'Contact ▲', 'Contact ▼', { vertical: false, ia: 'up', ib: 'down' }), label(306, 196, 270, 'Contact'),
    rocker(24, 236, 270, 140, 'MFD ◀', 'MFD ▶', { vertical: false, ia: 'left', ib: 'right' }), label(24, 382, 270, 'Display page'),
    toggle(380, 230, 'Advanced HUD', { w: 130 }),
    keycap(24, 430, 270, 120, 'Scoreboard', { fs: 15 }), keycap(306, 430, 270, 120, 'Look ahead', { fs: 15 }),
    keycap(24, 560, 270, 126, 'Scan mode', { fs: 15 }), keycap(306, 560, 270, 126, 'Ping', { fs: 15 }));
  const c = plate(1754, 800, 'Comms');
  const half = 370;
  add(c, ...[1, 2, 3, 4, 5].map(n => keycap(20, 50 + (n - 1) * 128, half, 120, `Reply ${n}`, { fs: 16, icon: 'chat' })),
    keycap(410, 50, half, 120, 'ATC request', { fs: 16 }), keycap(410, 178, half / 2 - 4, 120, 'Chat window', { label: 'Chat', fs: 15 }),
    keycap(414 + half / 2, 178, half / 2 - 4, 120, 'Push to talk', { fs: 14 }), keycap(410, 306, half, 120, 'Docking request', { fs: 16 }),
    keycap(410, 434, half, 120, 'Hail target', { fs: 16 }),
    keycap(410, 562, half / 2 - 4, 116, 'Accept', { fs: 15 }), keycap(414 + half / 2, 562, half / 2 - 4, 116, 'Ignore', { fs: 15 }));
  return [a, b, c];
}

function downed() {
  const a = plate(382, 1060, 'Downed', { cls: 'down' });
  add(a,
    roundButton(70, 90, 520, 'Revive request', { colour: 'var(--danger)', is: 64, sub: 'HOLD TO CALL FOR HELP' }),
    screen(650, 70, 380, 270, `<div class="lab" style="left:20px;top:18px;text-align:left;color:var(--danger)">Incapacitated</div>
      <div class="dn-t">Call for help, or wait for a medic</div>
      <div class="dn-s">A medic can revive you. Giving up respawns you at your medical bed.</div>`),
    keycap(650, 366, 186, 110, 'Consume', { fs: 14 }), keycap(844, 366, 186, 110, 'Heal target', { fs: 14 }),
    keycap(650, 486, 186, 96, 'Visor wipe', { fs: 13 }), keycap(844, 486, 186, 96, 'Helmet on/off', { label: 'Helmet', fs: 13 }),
    placard(650, 598, 'Give up and respawn', 'red'), guard(650, 622, 380, 64, 'Give up', { text: 'Give up' }));
  const b = plate(1448, 1106, 'Comms');
  add(b, ...[1, 2, 3, 4, 5].map(n => keycap(20, 50 + (n - 1) * 128, 520, 120, `Reply ${n}`, { fs: 16, icon: 'chat' })),
    keycap(560, 50, 260, 248, 'Local map', { fs: 18, is: 34 }), keycap(828, 50, 258, 248, 'Plan route', { fs: 18, is: 34 }),
    keycap(560, 306, 260, 186, 'Scoreboard', { fs: 16 }), keycap(828, 306, 258, 186, 'mobiGlas', { fs: 16 }),
    keycap(560, 500, 260, 186, 'Third person', { fs: 16 }), keycap(828, 500, 258, 186, 'Push to talk', { fs: 16 }));
  return [a, b];
}

// ================= your pages =================

const STOCK_PLATES = { power: () => powerPlate(), role: page => rolePlate(page), flight: () => flightPlate(), gear: () => gearPlate() };
// Plate furniture that is not a control: never hidden or moved by an edit.
const FIXED = '.screw, .title, .rtitle, .pager, .swipe-hint, .grab';

/** Names a stock plate's controls in build order, so your edits find them again: index and label. */
export function controlsOf(plateEl) {
  return [...plateEl.children].filter(e => !e.matches(FIXED)).map((el, i) => {
    const text = (el.querySelector('.lg, .placard, .lab')?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return { el, id: `${i}:${text}` };
  });
}

/** One control of yours, built by the same code as the stock ones. */
export function item(it) {
  const { x, y, w, h: ht } = it;
  // Only the page editor draws a control that has no key yet; a saved page never holds one.
  if (unset(it)) return blank(x, y, it.t === 'switch' ? 84 : w, it.t === 'switch' ? 196 : ht, 0, 'Pick a key');
  switch (it.t) {
    case 'key': return keycap(x, y, w, ht, it.key, { label: it.label || undefined, fs: w < 100 ? 11 : 13 });
    case 'seq': {
      // A macro of your own: each step's key in turn, the gap between them. On / off steps
      // carry their state, so switches on the console follow what the sequence set.
      const keys = (it.steps || []).map(st => K.key(st.key)).filter(Boolean);
      const steps = keys.flatMap((k, i) => (i ? [{ delay: it.gap || 250 }, { key: k }] : [{ key: k }]));
      const k = { label: it.label || 'Sequence', role: 'macro', press: 'tap', activation: '', icon: 'ready', steps };
      return keycap(x, y, w, ht, k, { fitted: true, kb: false, fs: w < 100 ? 11 : 13, sub: ht >= 96 ? `${keys.length} steps` : '' });
    }
    case 'round': return roundButton(x, y, Math.min(w, ht), it.key, { label: it.label || undefined });
    case 'rocker': return rocker(x, y, w, ht, it.a, it.b, { vertical: ht >= w });
    case 'switch': return onOff(x, y, it.key, { label: it.label || undefined, w: 84 });
    case 'onoffkey': return onOffKey(x, y, w, ht, it.key, { label: it.label || undefined });
    case 'rotary': {
      const pos = (it.positions || []).filter(p => p.key);
      const span = pos.length > 1 ? 100 / (pos.length - 1) : 0;
      return rotary(x, y, Math.min(w, ht) - 60, pos.map((p, i) => ({ label: p.label || p.key, key: p.key, angle: pos.length > 1 ? -50 + i * span : 0 })), { title: it.label || undefined });
    }
    case 'slider': return slider(x, y, w, ht, { title: it.label || undefined, onStep: s => K.fire(K.key(s > 0 ? it.a : it.b)) });
    case 'guard': return guard(x, y, w, ht, it.key, { text: it.label || undefined });
    case 'slide': return slideConfirm(x, y, w, ht, it.key, { text: it.label || `SLIDE TO ${String(it.key).toUpperCase()}` });
    case 'label': return label(x, y, w, it.text || '');
    case 'placard': return placard(x, y, it.text || '');
    case 'screen': {
      const el = screen(x, y, w, ht, `<small class="cs-f"></small><b class="cs-v"></b>`, 'custom-screen');
      el.paint = () => { const v = K.live?.(it.field); el.querySelector('.cs-f').textContent = K.fieldName?.(it.field) || ''; el.querySelector('.cs-v').textContent = v ?? '–'; };
      el.classList.add('painted');
      el.paint();
      return el;
    }
    default: return null;
  }
}

/** The plates of a page of yours: stock plates with your edits, and plates of your own. */
function customScene(page) {
  const spec = CUSTOM.get(page.id);
  const xs = lefts(spec);
  return spec.plates.map((pl, i) => {
    let p;
    if (pl.stock) {
      p = STOCK_PLATES[pl.stock](page);
      const { hide, move } = pl.edits;
      for (const c of controlsOf(p)) {
        c.el.dataset.cid = c.id;
        if (hide.includes(c.id)) c.el.remove();
        else if (move[c.id]) { const [x, y, w, ht] = move[c.id]; Object.assign(c.el.style, { left: `${x}px`, top: `${y}px`, ...(c.el.matches('.well') ? { width: `${w}px`, height: `${ht}px` } : {}) }); }
      }
      p.dataset.slot = pl.stock;
    } else {
      p = plate(xs[i], pl.w, pl.title || '');
      p.dataset.slot = `mine${i}`;
    }
    p.style.left = `${xs[i]}px`;
    p.classList.add('mine');
    add(p, pl.add.map((it, n) => { const el = item(it); if (el) el.dataset.add = n; return el; }));
    return p;
  });
}

/** The plates for a page. */
export function scene(page) {
  if (CUSTOM.has(page.id)) return customScene(page);
  if (page.id === 'onfoot') return onFoot();
  if (page.id === 'map') return mapPage();
  if (page.id === 'emotes') return emotes();
  if (page.id === 'downed') return downed();
  if (page.id === 'log') return logPage();
  if (page.id === 'world') return worldPage();
  const plates = { power: powerPlate(), role: rolePlate(page), flight: flightPlate(), gear: gearPlate() };
  for (const [slot, p] of Object.entries(plates)) p.dataset.slot = slot;
  return Object.values(plates);
}
