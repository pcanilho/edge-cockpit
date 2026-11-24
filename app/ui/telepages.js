// The Telemetry pages: instruments drawn from the game's own live stream. They exist only while
// the game link is live and the Telemetry layout is on; Classic never shows them. Every value is
// one the game sent in this update. One it didn't send shows as "Not sent" or "—", never a guess.
import * as G from './lib/gauges.js';
import { plate, screen, keycap, h, icon, esc, pressable } from './controls.js';

const { C, T, mono } = G;

/** The pages, in the order the pager steps through them. */
export const TELE_PAGES = [
  { id: 'tl-instruments', name: 'Instruments', glyph: 'gauge' },
  { id: 'tl-approach', name: 'Approach', glyph: 'land' },
  { id: 'tl-systems', name: 'Systems', glyph: 'power' },
  { id: 'tl-combat', name: 'Combat', glyph: 'target' },
  { id: 'tl-suit', name: 'Suit', glyph: 'helmet' },
];
export const isTele = id => typeof id === 'string' && id.startsWith('tl-');

let K;
/** ctx: go(id) shows a page, scale() is the stage scale, live() the latest update, repaint() redraws. */
export const init = ctx => {
  K = ctx;
  // The gauges' glow filters, fades and hatching, defined once for every page.
  if (!document.getElementById('gx-defs')) document.body.insertAdjacentHTML('afterbegin', `<svg id="gx-defs" width="0" height="0" style="position:absolute" aria-hidden="true">${G.DEFS}</svg>`);
};

// ---------- reading the update ----------
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e30;
const pct = v => (finite(v) ? Math.max(0, Math.min(100, Math.floor(v * 100 + 1e-6))) : null);
const ANN = ['pwr', 'wpn', 'thr', 'shld', 'cool', 'qdrv', 'radr', 'prox', 'hit', 'misl'];
const lampCls = s => (s === 1 ? 'n' : s === 3 || s === 4 ? 'm' : s === 5 || s === 6 ? 'x' : '');
const flashing = s => s === 3 || s === 5;
const DEP = { 1: 'Up', 2: 'Lowering', 3: 'Down', 4: 'Raising' };

/** The flight values the pages draw, null where the game didn't send one. */
export function flightOf(live) {
  const v = live?.vehicle, f = v?.flight, i = f?.instruments, st = f?.state;
  return {
    v,
    speed: i && finite(i.speed) ? i.speed : null,
    vsi: i && finite(i.vertical_speed_indicator) ? i.vertical_speed_indicator : null,
    // The largest float means no ground in range; 0 is what an unsent value looks like.
    ralt: i && finite(i.radar_altitude) && i.radar_altitude > 0 ? i.radar_altitude : null,
    hdg: i && finite(i.heading) ? i.heading : null,
    g: i?.g_meter && finite(i.g_meter.current) && finite(i.g_meter.max) ? i.g_meter : null,
    boost: i?.boost || null,
    h2: i && finite(i.hydrogen_fuel) ? i.hydrogen_fuel : null,
    shields: v?.shields ? v.shields.level : null,
    // A hull of exactly 0 is what an unsent value looks like.
    hull: v?.health > 0 ? v.health : null,
    ann: v?.annunciators || null,
    mode: v?.master_mode?.mode ?? null,
    spooled: v?.master_mode ? !!v.master_mode.spooled : null,
    landed: st ? !!st.is_landed : null,
    gear: st?.gear ?? null,
    vtol: st?.vtol ?? null,
  };
}
const anyAnn = (ann, states) => !!ann && ANN.some(k => states.includes(ann[k]));

// ---------- pager ----------
function pager(id) {
  const i = TELE_PAGES.findIndex(p => p.id === id);
  const el = h(`<div class="pager tl-pager"><button class="pg prev" aria-label="Previous gauge page">${icon('left', 18)}</button>
    <span><b>${i + 1}</b> / ${TELE_PAGES.length}</span><button class="pg next" aria-label="Next gauge page">${icon('right', 18)}</button></div>`);
  for (const [sel, dir] of [['.prev', -1], ['.next', 1]]) {
    const b = el.querySelector(sel);
    pressable(b, { up: () => K.go(TELE_PAGES[(i + dir + TELE_PAGES.length) % TELE_PAGES.length].id) });
    b.addEventListener('pointerdown', e => e.stopPropagation());
  }
  return el;
}
/** A plate whose title carries the page's name and the pager. */
function head(x, w, id) {
  const p = plate(x, w, '');
  const page = TELE_PAGES.find(t => t.id === id);
  p.append(h(`<div class="rtitle">${icon(page.glyph, 18)}<span>${esc(page.name)}</span></div>`), pager(id));
  // Swipe sideways on the plate for the next page.
  let x0 = null;
  p.addEventListener('pointerdown', e => { x0 = e.clientX; });
  p.addEventListener('pointerup', e => {
    if (x0 === null) return;
    const dx = (e.clientX - x0) / K.scale();
    x0 = null;
    const i = TELE_PAGES.findIndex(t => t.id === id), n = TELE_PAGES.length;
    if (Math.abs(dx) > 120) K.go(TELE_PAGES[(i + (dx < 0 ? 1 : -1) + n) % n].id);
  });
  return p;
}
const slot = (x, y, w, ht, k, glass = true) => {
  const el = glass ? screen(x, y, w, ht, '', 'tl-slot') : h(`<div class="tl-slot bare" style="left:${x}px;top:${y}px;width:${w}px;height:${ht}px"></div>`);
  el.dataset.tk = k;
  return el;
};
// A tap on a lit master caution or warning quietens it until another light comes on.
const ackable = el => {
  el.addEventListener('pointerup', e => { if (e.target.closest('[data-ack]')) { acknowledge(K.live()); K.repaint(); } });
  return el;
};
const add = (p, ...els) => { for (const e of els) p.appendChild(e); return p; };

// ---------- the plates ----------
export function scene(id) {
  if (id === 'tl-instruments') return [
    add(head(382, 900, id), slot(24, 52, 852, 632, 'air')),
    add(plate(1288, 600, 'Energy'), slot(24, 44, 552, 470, 'energy'), slot(24, 526, 552, 160, 'modes', false)),
    add(plate(1894, 660, 'Caution'), ackable(slot(24, 44, 612, 260, 'caution', false)), slot(24, 316, 612, 368, 'sh-hull')),
  ];
  if (id === 'tl-approach') return [
    add(head(382, 1100, id), slot(24, 52, 1052, 632, 'approach')),
    add(plate(1488, 520, 'Touchdown'), slot(24, 44, 472, 640, 'touchdown', false)),
    add(plate(2014, 540, 'Sink rate'), slot(24, 44, 492, 640, 'sink')),
  ];
  if (id === 'tl-systems') return [
    add(head(382, 860, id), slot(24, 52, 812, 632, 'bus', false)),
    add(plate(1248, 620, 'Flight control'), slot(24, 44, 572, 640, 'ifcs', false)),
    add(plate(1874, 680, 'Weapons'), slot(24, 44, 632, 640, 'weapons', false)),
  ];
  if (id === 'tl-combat') return [
    add(head(382, 760, id), slot(24, 52, 712, 632, 'threat', false)),
    add(plate(1148, 700, 'Defence'), slot(24, 44, 652, 400, 'defence'), keycap(24, 466, 314, 220, 'Decoy', { fs: 16, is: 30 }), keycap(362, 466, 314, 220, 'Noise', { fs: 16, is: 30 })),
    add(plate(1854, 700, 'Guns'), slot(24, 44, 652, 640, 'guns')),
  ];
  if (id === 'tl-suit') return [
    add(head(382, 900, id), slot(24, 52, 852, 632, 'vitals')),
    add(plate(1288, 600, 'Environment'), slot(24, 44, 552, 470, 'env'), slot(24, 530, 552, 150, 'breath', false)),
    add(plate(1894, 660, 'Wallet'), slot(24, 44, 612, 260, 'wallet'), slot(24, 330, 612, 354, 'where', false)),
  ];
  return [];
}

// ---------- painting ----------
const lamp = (st, n, txt = '') => `<b class="${st}"><i></i>${n}${txt ? `<em>${esc(txt)}</em>` : ''}</b>`;
const NOT = (w, ht, what = 'Not sent') => G.svg(w, ht, T(w / 2, ht / 2, 15, what.toUpperCase(), { c: C.dim, ls: 3 }));

function air(d) {
  return G.svg(852, 632,
    G.heading(150, 18, 552, 64, d.hdg) +
    G.tape(26, 124, 160, 470, d.speed, { title: 'SPEED', unit: 'M/S', ppu: 4, minor: 5, major: 25, min: 0, c: C.cyan, fmt: v => Math.round(v), side: 'left' }) +
    G.tape(666, 124, 160, 470, d.ralt, { title: 'RADAR ALT', unit: 'METRES', ppu: 9, minor: 1, major: 5, c: C.ok, fmt: v => (v < 100 ? v.toFixed(1) : Math.round(v)), side: 'right', ground: true }) +
    (d.vsi == null ? T(426, 368, 15, 'VERTICAL SPEED · NOT SENT', { c: C.dim, ls: 3 }) : G.vsi(426, 368, 200, d.vsi)));
}
function energy(d) {
  const b = d.boost;
  return G.svg(552, 470,
    (b ? G.ring(146, 150, 108, pct(b.reserves) ?? 0, { title: 'BOOST', c: b.critical ? C.red : C.amber, halo: b.engaged, glow: true, sub: b.engaged ? '▲ ENGAGED' : '', fs: 44 }) : T(146, 150, 14, 'BOOST · NOT SENT', { c: C.dim, ls: 3 })) +
    G.gmeter(406, 150, 108, d.g) +
    G.hbar(30, 382, 492, 46, d.h2 == null ? null : pct(d.h2), { title: 'HYDROGEN FUEL', c: C.cyan, n: 26 }));
}
function modes(d) {
  const m = (on, n) => lamp(on ? 'on' : '', n);
  const na = n => lamp('na', n, '—');
  return `<div class="tl-lamps">${d.mode == null ? na('Mode') : m(d.mode === 2, 'SCM') + m(d.mode === 1, 'NAV') + lamp(d.spooled ? 'on' : 'am', d.spooled ? 'Spooled' : 'Spooling')}</div>
    <div class="tl-lamps">${d.landed == null ? na('Landed') : m(d.landed, d.landed ? 'Landed' : 'Flying')}${d.gear == null ? na('Gear') : lamp(d.gear === 3 ? 'on' : 'am', 'Gear ' + DEP[d.gear])}</div>`;
}
// Acknowledged warnings stay lit but stop calling for attention until a new one comes on.
let acked = '';
function caution(d) {
  const a = d.ann;
  const key = a ? ANN.map(k => a[k]).join() : '';
  const minor = anyAnn(a, [3, 4]), major = anyAnn(a, [5, 6]);
  const quiet = key === acked;
  return `<div class="tl-mc"><b class="${minor ? 'cau' : ''} ${minor && !quiet ? 'fl' : ''}" data-ack>Master caution<small>${minor ? 'Tap to acknowledge' : 'All clear'}</small></b><b class="${major ? 'war' : ''} ${major && !quiet ? 'fl' : ''}" data-ack>Master warning<small>${major ? 'Tap to acknowledge' : 'All clear'}</small></b></div>
    <div class="tl-ann">${ANN.map(k => `<b class="${a ? lampCls(a[k]) : ''} ${a && flashing(a[k]) ? 'fl' : ''}">${k.toUpperCase()}</b>`).join('')}</div>`;
}
function shHull(d) {
  const sh = pct(d.shields), hu = pct(d.hull);
  return G.svg(612, 368, (sh == null ? T(160, 200, 14, 'SHIELDS · NOT SENT', { c: C.dim, ls: 2 }) : G.semi(160, 210, 120, sh, { title: 'SHIELDS', c: C.cyan }))
    + (hu == null ? T(452, 200, 14, 'HULL · NOT SENT', { c: C.dim, ls: 2 }) : G.semi(452, 210, 120, hu, { title: 'HULL', c: hu < 25 ? C.red : hu < 50 ? C.amber : C.ok })));
}

function approach(d) {
  const W = 1052, H = 632, gy = 552, top = 70, lg = a => gy - Math.log10(1 + Math.max(0, a)) / Math.log10(1001) * (gy - top);
  let s = `<rect width="${W}" height="${gy}" fill="#08202d" opacity=".6"/><rect y="${gy}" width="${W}" height="${H - gy}" fill="url(#gx-hatch)"/><line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="${C.amber}" stroke-width="3"/>`;
  for (const a of [0, 5, 10, 25, 50, 100, 250, 500, 1000]) { const y = lg(a); s += `<line x1="70" x2="${W - 20}" y1="${y}" y2="${y}" stroke="#fff" stroke-opacity=".05"/><line x1="58" x2="76" y1="${y}" y2="${y}" stroke="${C.paint}" stroke-width="2"/>` + mono(50, y, 15, a, { c: C.muted, a: 'end' }); }
  s += T(40, 40, 12, 'RADAR ALT · M', { c: C.muted, ls: 2, a: 'start' });
  const mx = 260;
  if (d.ralt == null) return G.svg(W, H, s + T(W / 2, 300, 18, d.v ? 'NO GROUND IN RANGE' : 'NOT IN A SHIP', { c: C.dim, ls: 4 }));
  const my = d.landed ? gy - 14 : lg(d.ralt);
  if (d.landed) s += `<g transform="translate(${W / 2} 250)">${T(0, 0, 46, 'TOUCHDOWN', { c: C.ok, ls: 10 })}${T(0, 50, 14, 'THE GAME REPORTS LANDED', { c: C.ok, ls: 4, op: 0.8 })}</g>`;
  else if (d.vsi != null && d.speed != null && d.vsi < -0.5 && d.speed > Math.abs(d.vsi)) {
    const hs = Math.sqrt(d.speed ** 2 - d.vsi ** 2), ang = Math.atan2(-d.vsi, hs), t = d.ralt / -d.vsi, dist = hs * t;
    const tx = mx + Math.min(t * 130, W - mx - 120);
    s += `<line x1="${mx}" y1="${my}" x2="${tx}" y2="${gy}" stroke="${C.cyan}" stroke-width="3" stroke-dasharray="10 8" filter="url(#gx-gl)"/><circle cx="${tx}" cy="${gy}" r="9" fill="none" stroke="${C.cyan}" stroke-width="3"/>`
      + T(tx, gy + 30, 12, 'GROUND AT THIS RATE', { c: C.cyan, ls: 2 });
    s += `<g transform="translate(${W - 330} 70)"><rect width="300" height="280" rx="10" fill="#02080cdd" stroke="#ffffff18"/>`
      + T(24, 34, 12, 'DESCENT ANGLE', { c: C.muted, ls: 3, a: 'start' }) + mono(24, 76, 40, (ang * 180 / Math.PI).toFixed(1) + '°', { c: C.cyan, a: 'start' })
      + T(24, 124, 12, 'TIME TO GROUND', { c: C.muted, ls: 3, a: 'start' }) + mono(24, 166, 40, t.toFixed(1) + `<tspan font-size="18" fill="${C.muted}"> s</tspan>`, { c: C.amber, a: 'start' })
      + T(24, 214, 12, 'GROUND COVERED', { c: C.muted, ls: 3, a: 'start' }) + mono(24, 252, 32, Math.round(dist) + `<tspan font-size="16" fill="${C.muted}"> m</tspan>`, { c: C.ink, a: 'start' }) + '</g>';
  }
  s += `<g filter="url(#gx-gl)"><circle cx="${mx}" cy="${my}" r="16" fill="none" stroke="${C.ink}" stroke-width="3"/><path d="M${mx - 36} ${my}h20M${mx + 16} ${my}h20M${mx} ${my - 16}v-14" stroke="${C.ink}" stroke-width="3"/></g>`;
  s += `<rect x="${mx - 60}" y="${my - 76}" width="120" height="40" rx="6" fill="#02080c" stroke="${C.ok}" stroke-width="2"/>` + mono(mx, my - 56, 24, d.ralt < 100 ? d.ralt.toFixed(1) + `<tspan font-size="13" fill="${C.muted}"> m</tspan>` : Math.round(d.ralt), { c: C.ok });
  return G.svg(W, H, s);
}
function touchdown(d) {
  const s = d.v?.flight?.settings;
  const dep = v => (v == null ? ['na', '—'] : [v === 3 ? 'on' : 'am', DEP[v]]);
  const yes = (v, a, b) => (v == null ? ['na', '—'] : [v ? 'on' : 'am', v ? a : b]);
  const prox = s?.ifcs_proximity_assist?.enabled ? !!s.ifcs_proximity_assist.active : null;
  const coupled = s?.ifcs_coupled?.enabled ? !!s.ifcs_coupled.active : null;
  const rows = [['Gear', dep(d.gear)], ['VTOL', dep(d.vtol)], ['Lights', yes(d.v ? !!d.v.lights_enabled : null, 'On', 'Off')], ['Proximity assist', yes(prox, 'On', 'Off')], ['Flight', yes(coupled, 'Coupled', 'Decoupled')], ['State', d.landed == null ? ['na', '—'] : [d.landed ? 'on' : '', d.landed ? 'Landed' : 'Flying']]];
  return `<div class="cap-t">Touchdown check · live from the game</div><div class="tl-check">${rows.map(([n, [c, t]]) => `<b class="${c}"><span><i></i>${n}</span><em>${t}</em></b>`).join('')}</div>`;
}
function sink(d) {
  const v = d.vsi;
  if (v == null) return NOT(492, 640);
  const vv = Math.max(-20, Math.min(20, v)), cy = 330, sc = 13, col = v < -0.5 ? C.amber : v > 0.5 ? C.ok : C.paint;
  return G.svg(492, 640, `<rect x="186" y="${cy - 270}" width="120" height="540" rx="10" fill="#071119" stroke="#ffffff14"/>`
    + [-20, -10, -5, 0, 5, 10, 20].map(t => `<line x1="306" x2="326" y1="${cy - t * sc}" y2="${cy - t * sc}" stroke="${C.paint}" stroke-width="2"/>` + mono(336, cy - t * sc, 15, t > 0 ? '+' + t : t, { c: C.muted, a: 'start' })).join('')
    + `<rect x="196" y="${Math.min(cy, cy - vv * sc)}" width="100" height="${Math.abs(vv * sc) || 2}" fill="${col}" filter="url(#gx-gl)"/>`
    + T(246, 30, 12, 'SINK RATE · M/S', { c: C.muted, ls: 3 }) + mono(100, cy, 40, Math.abs(v) < 0.5 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1), { c: v < -0.5 ? C.amber : C.ink })
    + T(100, cy + 40, 12, v < -0.5 ? 'DESCENDING' : v > 0.5 ? 'CLIMBING' : 'LEVEL', { c: C.muted, ls: 3 }));
}

const POWER = [['Engines', 'engines'], ['Weapons', 'weapons'], ['Shield<br>generators', 'shield_generators'], ['Shield<br>emitters', 'shield_emitters'],
  ['Coolers', 'coolers'], ['Life<br>support', 'life_support'], ['Sensors', 'sensors'], ['Gravity<br>generators', 'gravity_generators']];
function bus(d) {
  const p = d.v?.power;
  if (!p) return `<div class="tl-empty">${NOT(812, 632, d.v ? 'Power · not sent' : 'Not in a ship')}</div>`;
  const plant = !!p.powerplants, xs = [300, 450, 600, 750], top = 92, bot = 470, busY = 330, bw = 136, bh = 96;
  let lines = `<rect width="812" height="632" rx="10" fill="#050a0e"/><path d="M216 ${busY}H${xs[3] + 20}" stroke="${plant ? C.ok : '#1c262e'}" stroke-width="6" ${plant ? 'filter="url(#gx-gl)"' : ''}/>`;
  POWER.forEach(([, k], i) => {
    const x = xs[i % 4], on = plant && !!p[k];
    lines += `<path d="M${x} ${busY}V${i < 4 ? top + bh : bot}" stroke="${on ? C.ok : '#1c262e'}" stroke-width="${on ? 4 : 3}" ${on ? 'filter="url(#gx-gl)"' : 'stroke-dasharray="6 6"'}/><circle cx="${x}" cy="${busY}" r="7" fill="${plant ? C.ok : '#1c262e'}"/>`;
  });
  lines += T(406, 600, 12, 'ON / OFF AS THE GAME REPORTS · NO POWER LEVELS IN THE STREAM', { c: C.dim, ls: 1.6 }) + T(750, 584, 10, 'OFF, OR NONE FITTED', { c: C.dim, ls: 1.2 });
  const brk = POWER.map(([n, k], i) => `<b class="brk ${p[k] ? 'on' : 'off'}" style="left:${xs[i % 4] - bw / 2}px;top:${i < 4 ? top : bot}px;width:${bw}px;height:${bh}px"><i></i>${n}<em>${p[k] ? 'On' : 'Off'}</em></b>`).join('');
  return `<div class="tl-bus">${G.svg(812, 632, lines)}<b class="brk src2 ${plant ? 'on' : 'off'}" style="left:24px;top:${busY - 55}px"><i></i>Power plant<em>${plant ? 'On' : 'Off'}</em></b>${brk}</div>`;
}
function ifcs(d) {
  const v = d.v, s = v?.flight?.settings;
  if (!s) return NOT(572, 640, v ? 'Flight control · not sent' : 'Not in a ship');
  const av = a => (!a?.enabled ? 'na' : a.active ? 'on' : 'off');
  const cell = (n, st, txt) => `<b class="${st}">${n}<em>${txt || (st === 'on' ? 'On' : st === 'off' ? 'Off' : 'Unavailable')}</em></b>`;
  const mode = d.mode;
  const hud = mode === 1 || mode === 2 ? ((mode === 1 ? s.advanced_hud_enabled_nav : s.advanced_hud_enabled_scm) ? 'on' : 'off') : 'na';
  return `<div class="tl-ifcs">${[
    cell('Coupled', av(s.ifcs_coupled)), cell('Speed<br>limiter', av(s.ifcs_speed_limiter)), cell('Cruise', av(s.ifcs_cruise_mode)),
    cell('ESP', av(s.ifcs_esp)), cell('G-safe', av(s.ifcs_g_safe)), cell('Proximity<br>assist', av(s.ifcs_proximity_assist)),
    cell('Stability', av(s.ifcs_stability)), cell('Gravity<br>comp', av(s.ifcs_gravity_compensation)), cell('Wind<br>comp', av(s.ifcs_wind_compensation)),
    cell('Advanced<br>HUD', hud, hud === 'na' ? '—' : ''), cell('Light<br>amp', s.flight_light_amplification ? 'on' : 'off'), cell('Lights', v.lights_enabled ? 'on' : 'off'),
  ].join('')}</div>
  <div class="cap-t">Deploy</div><div class="tl-lamps">${d.gear == null ? lamp('na', 'Gear', '—') : lamp(d.gear === 3 ? 'on' : 'am', 'Gear ' + DEP[d.gear])}${d.vtol == null ? lamp('na', 'VTOL', '—') : lamp(d.vtol === 3 ? 'on' : 'am', 'VTOL ' + DEP[d.vtol])}${d.landed == null ? lamp('na', 'State', '—') : lamp(d.landed ? 'on' : '', d.landed ? 'Landed' : 'Flying')}</div>
  <div class="cap-t">Master mode</div><div class="tl-lamps">${mode == null ? lamp('na', 'Mode', '—') : lamp(mode === 1 ? 'on' : '', 'NAV') + lamp(mode === 2 ? 'on' : '', 'SCM') + lamp(d.spooled ? 'on' : 'am', d.spooled ? 'Spooled' : 'Spooling')}</div>`;
}
// The game sends what's left but no capacity: bars are out of the most seen on this ship.
const mostSeen = new Map();
function seen(cls, type, n) {
  const k = `${cls}:${type}`, m = Math.max(mostSeen.get(k) || 0, n);
  mostSeen.set(k, m);
  return m;
}
function weapons(live) {
  const w = live?.weapons, cls = live?.vehicle?.class_name || '';
  if (!w) return NOT(632, 640, 'Weapons · not sent');
  const guns = (w.weapons || []).map((g, i) => `<b><span class="gs">${i + 1}</span>Gun ${i + 1}<span class="gl"><i class="${g.is_powered ? 'on' : ''}"></i>Power <i class="${g.ready_to_fire ? 'on' : ''}"></i>Ready</span></b>`).join('');
  const cm = Object.fromEntries((w.countermeasures || []).map(c => [c.type, c.amount]));
  const cmBox = (n, t) => {
    if (cm[t] == null) return `<div><span class="cap-t">${n}</span><div class="n dim">—</div></div>`;
    const most = seen(cls, t, cm[t]), lit = most ? Math.round(cm[t] / most * 24) : 0;
    return `<div><span class="cap-t">${n}</span><div class="n">${cm[t]}</div><div class="bar">${Array.from({ length: 24 }, (_, i) => `<i class="${i < lit ? 'l' : ''}"></i>`).join('')}</div></div>`;
  };
  const st = w.settings || {};
  return `<div class="tl-guns">${guns || '<b class="na">No guns reported</b>'}</div>
    <div class="tl-lamps">${lamp(st.gimbals_locked ? 'am' : 'on', st.gimbals_locked ? 'Gimbals locked' : 'Gimbals free')}${lamp(st.staggered_fire ? 'on' : '', st.staggered_fire ? 'Stagger on' : 'Stagger off')}</div>
    <div class="cap-t">Countermeasures</div><div class="tl-cm">${cmBox('Decoys', 1)}${cmBox('Noise', 2)}</div>
    <div class="tl-src">The game sends what's left but no capacity, so each bar is out of the most seen on this ship.</div>`;
}
const WORD = { 1: 'Nominal', 2: 'Off', 3: 'Minor', 4: 'Minor', 5: 'Major', 6: 'Major' };
function threat(d) {
  const a = d.ann;
  if (!a) return NOT(712, 632, d.v ? 'Warning lights · not sent' : 'Not in a ship');
  const big = (k, n) => `<b class="${lampCls(a[k])} ${flashing(a[k]) ? 'fl' : ''}">${n}<small>${WORD[a[k]] || '—'}</small></b>`;
  return `<div class="tl-threat">${big('misl', 'Missile')}${big('hit', 'Hit')}</div>
    <div class="tl-ann four">${['radr', 'prox', 'shld', 'wpn'].map(k => `<b class="${lampCls(a[k])} ${flashing(a[k]) ? 'fl' : ''}">${k.toUpperCase()}</b>`).join('')}</div>
    <div class="tl-src">The game's own warning lights. Missile and Hit flash when the game flashes them.</div>`;
}
function defence(d) {
  const sh = pct(d.shields), hu = pct(d.hull);
  return G.svg(652, 400, (sh == null ? T(170, 190, 14, 'SHIELDS · NOT SENT', { c: C.dim, ls: 2 }) : G.ring(170, 190, 130, sh, { title: 'SHIELDS', c: C.cyan, glow: true, fs: 52 }))
    + (hu == null ? T(482, 190, 14, 'HULL · NOT SENT', { c: C.dim, ls: 2 }) : G.ring(482, 190, 130, hu, { title: 'HULL', c: hu < 25 ? C.red : hu < 50 ? C.amber : C.ok, glow: true, fs: 52 })));
}
function guns(live) {
  const w = live?.weapons, list = w?.weapons || [];
  if (!list.length) return NOT(652, 640, 'Guns · not sent');
  const ready = list.filter(g => g.is_powered && g.ready_to_fire).length, n = list.length, st = w.settings || {};
  const per = Math.min(150, 560 / n);
  return G.svg(652, 640, G.ring(326, 220, 160, ready / n * 100, { title: 'GUNS READY', c: C.ok, glow: true, sw: 24, noNum: true }) + mono(326, 214, 90, `${ready}/${n}`, { c: C.ok })
    + list.map((g, i) => `<g transform="translate(${326 + (i - (n - 1) / 2) * per - per / 2 + 6} 452)"><rect width="${per - 12}" height="70" rx="8" fill="#070b0e" stroke="#ffffff18"/><circle cx="24" cy="35" r="9" fill="${g.ready_to_fire && g.is_powered ? C.ok : '#333'}"/>${per > 110 ? T(per / 2 + 10, 35, 14, 'GUN ' + (i + 1), { c: C.paint, ls: 2 }) : mono(per / 2 + 6, 35, 16, i + 1, { c: C.paint })}</g>`).join('')
    + `<g transform="translate(40 560)">${T(0, 20, 13, 'GIMBALS', { c: C.muted, ls: 3, a: 'start' })}${T(130, 20, 18, st.gimbals_locked ? 'LOCKED' : 'FREE', { c: C.amber, ls: 3, a: 'start' })}${T(330, 20, 13, 'STAGGER', { c: C.muted, ls: 3, a: 'start' })}${T(450, 20, 18, st.staggered_fire ? 'ON' : 'OFF', { c: C.paint, ls: 3, a: 'start' })}</g>`);
}

const gp = g => (g && g.max > 0 && finite(g.current) ? Math.floor(Math.max(0, Math.min(1, g.current / g.max)) * 100 + 1e-6) : null);
function vitals(live) {
  const vt = live?.actor?.vitals;
  if (!vt) return NOT(852, 632, 'Vitals · not sent');
  const lvl = p => (p < 25 ? C.red : p < 50 ? C.amber : C.ok);
  const ring = (x, g, n, c) => (gp(g) == null ? T(x, 180, 14, n + ' · NOT SENT', { c: C.dim, ls: 2 }) : G.ring(x, 180, 112, gp(g), { title: n, c: c || lvl(gp(g)), glow: true }));
  const bar = (y, g, n) => G.hbar(40, y, 772, 44, gp(g), { title: n, c: gp(g) == null ? C.ok : lvl(gp(g)), n: 34 });
  return G.svg(852, 632, ring(150, vt.health, 'HEALTH') + ring(426, vt.oxygen, 'OXYGEN', C.cyan)
    + (vt.heart_rate > 0 ? G.dial(702, 180, 112, vt.heart_rate, { min: 40, max: 200, step: 40, c: '#ff6a7a', unit: 'BPM', title: 'HEART RATE', fmt: x => Math.round(x) }) : T(702, 180, 14, 'HEART RATE · NOT SENT', { c: C.dim, ls: 2 }))
    + bar(440, vt.hunger, 'HUNGER') + bar(548, vt.thirst, 'THIRST'));
}
function env(live) {
  const vt = live?.actor?.vitals, e = live?.actor?.environment;
  if (!vt && !e) return NOT(552, 470);
  const body = vt?.body_temperature && finite(vt.body_temperature.current) ? vt.body_temperature.current : null;
  const out = e && finite(e.external_temperature) ? e.external_temperature : null;
  return G.svg(552, 470, (body == null ? T(110, 240, 13, 'BODY · NOT SENT', { c: C.dim, ls: 2 }) : G.thermo(110, 120, 230, body, { min: 30, max: 42, step: 2, c: '#ff9a5a', title: 'BODY', dp: 1 }))
    + (out == null ? T(300, 240, 13, 'OUTSIDE · NOT SENT', { c: C.dim, ls: 2 }) : G.thermo(300, 120, 230, out, { min: -40, max: 60, step: 20, c: C.cyan, title: 'OUTSIDE', dp: 0 }))
    + (vt && finite(vt.gravity) ? mono(470, 150, 40, vt.gravity.toFixed(2), { c: C.ink }) + T(470, 186, 12, 'GRAVITY · G', { c: C.muted, ls: 3 }) : ''));
}
function breath(live) {
  const e = live?.actor?.environment;
  if (!e) return `<div class="tl-mc one"><b>Air outside<small>Not sent</small></b></div>`;
  return `<div class="tl-mc one"><b class="${e.breathable_atmosphere ? 'okl' : 'war'}">${e.breathable_atmosphere ? 'Breathable air' : 'No breathable air'}<small>Outside your helmet</small></b></div>`;
}
function wallet(live) {
  const b = live?.actor?.state?.uec_balance;
  return G.svg(612, 260, T(306, 60, 13, 'BALANCE', { c: C.muted, ls: 4 }) + (b == null ? T(306, 140, 16, 'NOT SENT', { c: C.dim, ls: 3 })
    : mono(306, 140, String(b).length > 10 ? 54 : 72, Number(b).toLocaleString('en-US'), { c: C.amber }) + T(306, 205, 16, 'aUEC', { c: C.amber, ls: 4 })));
}
function where(live) {
  const loc = live?.actor?.state?.locomotion;
  const m = (n, on) => lamp(on ? 'on' : '', n);
  return `<div class="cap-t">Where you are</div><div class="tl-lamps">${m('On foot', loc === 1)}${m('EVA', loc === 2)}${m('Seated', loc === 3)}</div>
    <div class="tl-src">Radiation and intoxication join this page once a game build is seen sending them.</div>`;
}

const PAINT = {
  air: (d) => air(d), energy: (d) => energy(d), modes: (d) => modes(d), caution: (d) => caution(d), 'sh-hull': (d) => shHull(d),
  approach: (d) => approach(d), touchdown: (d) => touchdown(d), sink: (d) => sink(d),
  bus: (d) => bus(d), ifcs: (d) => ifcs(d), weapons: (d, l) => weapons(l),
  threat: (d) => threat(d), defence: (d) => defence(d), guns: (d, l) => guns(l),
  vitals: (d, l) => vitals(l), env: (d, l) => env(l), breath: (d, l) => breath(l), wallet: (d, l) => wallet(l), where: (d, l) => where(l),
};
const last = new WeakMap();
/** Fills the page's slots from a live update; slots whose drawing didn't change are left alone. */
export function paint(root, live) {
  const d = flightOf(live);
  for (const el of root.querySelectorAll('[data-tk]')) {
    const k = el.dataset.tk;
    const html = PAINT[k]?.(d, live) ?? '';
    if (last.get(el) === html) continue;
    last.set(el, html);
    el.innerHTML = html;
  }
}
/** A tap on master caution or warning acknowledges what is lit now. */
export function acknowledge(live) { const a = live?.vehicle?.annunciators; acked = a ? ANN.map(k => a[k]).join() : ''; }
