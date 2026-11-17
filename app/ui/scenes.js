// The pages of the console. A ship page is four plates: power, the role module, flight
// and gear. On foot, map and downed pages use the whole width for their own plates.
import { plate, placard, label, keycap, rocker, toggle, onOff, onOffKey, rotary, wheelKnob, slider, slideConfirm, guard, gearLever, quantum,
  roundButton, dial, missileRack, screen, icon, esc, h, pressable } from './controls.js';

let K;
export const init = ctx => { K = ctx; };

// Plate positions on the 2560 x 720 stage (the status display is 6..376).
const X = { power: 382, role: 838, flight: 1662, gear: 2280 };
const W = { power: 450, role: 818, flight: 612, gear: 274 };

/** Which role module a page shows. */
export const MODULE = {
  flight: 'systems', power: 'systems', combat: 'fighter', industry: 'mining',
  'multi-crew': 'crew', mining: 'mining', salvage: 'salvage', cargo: 'cargo', medical: 'medical', ground: 'ground',
};
export const moduleOf = id => MODULE[id] || (id.startsWith('light-fighter') || id.startsWith('heavy-fighter') ? 'fighter' : id.startsWith('multi-crew') ? 'crew' : null);
/** Pages a swipe on the role module steps through. */
export const SWIPE = ['light-fighter', 'heavy-fighter', 'multi-crew', 'mining', 'salvage', 'cargo', 'medical', 'ground', 'flight'];

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
    keycap(18, 262, 274, 196, 'Flight ready', { fs: 22, is: 40, lc: 'var(--ok)', lit: true }),
    keycap(298, 262, 134, 196, 'All systems on', { label: 'All systems on', fs: 13, is: 28, ...cut }),
    placard(18, 470, 'Power assignment'),
    keycap(18, 496, 134, 92, 'Weapons +', { fs: 12 }), keycap(158, 496, 134, 92, 'Engines +', { fs: 12 }),
    keycap(298, 496, 134, 92, 'Shields +', { fs: 12 }),
    keycap(18, 596, 414, 90, 'Power reset', { fs: 13 }));
}

function flightPlate() {
  const p = plate(X.flight, W.flight, 'Flight');
  add(p,
    slider(20, 62, 112, 480, { value: 'speed', title: 'Speed limit', onStep: s => K.wheel(s, p) }),
    onOffKey(20, 590, 112, 96, 'Speed limiter', { label: 'Limiter' }),
    rotary(150, 52, 116, [{ label: 'SCM', angle: -40, key: 'Set SCM' }, { label: 'NAV', angle: 40, key: 'Set NAV' }], { title: 'Flight mode', pointer: 'var(--cyan)', radius: 92 }),
    quantum(372, 44, 220, 'Quantum'),
    onOffKey(150, 276, 140, 90, 'Decoupled'),
    keycap(296, 276, 140, 90, 'Freelook', { fs: 13 }),
    keycap(442, 276, 150, 90, 'Startup', { label: 'Ready & ATC', fs: 13, ...cut }),
    keycap(150, 374, 150, 78, 'Decoy', { fs: 13 }),
    keycap(306, 374, 68, 78, 'Decoy burst −', { label: 'Burst −', fs: 11, icon: false }), keycap(380, 374, 68, 78, 'Decoy burst +', { label: 'Burst +', fs: 11, icon: false }),
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
    gearLever(24, 40, 'Landing gear'),
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
          { label: 'Look behind', a0: 136, a1: 178 }, { label: 'Gimbal mode', text: 'Cycle gimbal', a0: 182, a1: 224 }] },
      ],
    }),
    placard(20, 54, 'Missiles'), missileRack(20, 80, 128, 148),
    keycap(20, 238, 128, 92, 'Missiles +', { fs: 13 }),
    keycap(20, 338, 62, 100, 'EMP', { fs: 13, is: 20 }), keycap(86, 338, 62, 100, 'QED', { fs: 13, is: 20 }),
    keycap(20, 446, 128, 110, 'Missiles reset', { fs: 12 }),
    keycap(20, 564, 128, 122, 'Combat prep', { label: 'Battle stations', fs: 12, ...cut }),
    placard(670, 54, 'Gimbals'),
    rotary(670, 80, 68, [{ label: 'Locked', angle: -48, key: 'Gimbals locked' }, { label: 'Free', angle: 48, key: 'Gimbals free' }], { radius: 60 }),
    placard(670, 252, 'Gun groups'),
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
    wheelKnob(259, 116, 200, { value: 'laser', title: 'Laser power', marks: [{ from: 66, to: 84, colour: 'var(--ok)' }, { from: 84, to: 100, colour: 'var(--danger)' }] }),
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
    slider(666, 66, 112, 420, { value: 'spacing', title: 'Beam spacing', onStep: s => K.wheel(s, null), colour: 'var(--hold)' }),
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
    slider(380, 86, 112, 520, { value: 'beam', title: 'Beam distance', onStep: beam, colour: 'var(--hold)' }),
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
    keycap(566, 568, 234, 118, 'Look ahead', { fs: 13 }),
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

const MODULES = { fighter, crew, mining, salvage, cargo, medical, ground, systems };

/** Page n of the ship pages, with arrows to step through them as well as swiping. */
function pager(i) {
  const el = h(`<div class="pager"><button class="pg prev" aria-label="Previous ship page">${icon('left', 18)}</button>
    <span><b>${i + 1}</b> / ${SWIPE.length}</span><button class="pg next" aria-label="Next ship page">${icon('right', 18)}</button></div>`);
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
  const i = SWIPE.findIndex(s => id.startsWith(s));
  add(p, h(`<div class="rtitle">${icon(K.theme(page).glyph, 18)}<span>${esc(page.name)}</span></div>`),
    pager(i),
    h('<div class="swipe-hint lab">‹ swipe or tap the arrows for other ships ›</div>'));
  add(p, MODULES[moduleOf(id)]());
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
  return dial(cx, cy, { bezel: 300, centreR: 96, centre: 'Reload', rings: [{ r0: 110, r1: 250, keys: keys.map(([l, a0, a1]) => ({ label: l, a0: a0 + 1, a1: a1 - 1 })) }] });
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
    ...[1, 2, 3, 4, 5].map(n => keycap(20, 70 + (n - 1) * 124, half, 116, `Reply ${n}`, { fs: 16, icon: 'chat' })),
    keycap(40 + half, 70, half, 116, 'Local map', { fs: 15 }), keycap(40 + half, 194, half, 116, 'Starmap', { fs: 15 }),
    keycap(40 + half, 318, half, 116, 'Plan route', { fs: 15 }), keycap(40 + half, 442, half, 116, 'Scoreboard', { fs: 15 }),
    keycap(40 + half, 566, half / 2 - 4, 116, 'Chat window', { label: 'Chat', fs: 14 }),
    keycap(44 + half * 1.5, 566, half / 2 - 4, 116, 'Push to talk', { fs: 13 }));
  return p;
}

function mapPage() {
  const a = plate(382, 760, 'Map');
  add(a,
    dial(380, 380, {
      bezel: 300, centreR: 96, centre: 'Go to selection',
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
    keycap(410, 434, half, 120, 'Hail target', { fs: 16 }), keycap(410, 562, half, 116, 'Visor wipe', { fs: 16 }));
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

/** The plates for a page. */
export function scene(page) {
  if (page.id === 'onfoot') return onFoot();
  if (page.id === 'map') return mapPage();
  if (page.id === 'downed') return downed();
  const plates = { power: powerPlate(), role: rolePlate(page), flight: flightPlate(), gear: gearPlate() };
  for (const [slot, p] of Object.entries(plates)) p.dataset.slot = slot;
  return Object.values(plates);
}
