// The game link: what Star Citizen's own telemetry says, turned into what the console shows.
// Pure functions, so the tests can check them. A value the game doesn't send is left out,
// never guessed: the console then shows nothing for it, as it does without telemetry.

// Deployment states: 1 retracted, 2 deploying, 3 deployed, 4 retracting.
const deployed = s => s == null ? undefined : s === 2 || s === 3;
// A setting the ship offers (enabled) is on or off; one it doesn't offer is left out.
const avail = a => a?.enabled ? !!a.active : undefined;

/**
 * Switch state keys (as the layout names them) and their value, from a live update's
 * `vehicle` and `weapons`. Doors, port locks, lock rotation, look ahead, scan mode, mining
 * mode, auto precision and the gun group aren't sent, so they never appear.
 */
export function switchesOf(live) {
  const out = {};
  const v = live?.vehicle, w = live?.weapons;
  if (v) {
    const f = v.flight, s = f?.settings, p = v.power;
    if (p) Object.assign(out, { power: !!p.powerplants, pwr_thr: !!p.engines, pwr_shd: !!p.shield_generators, pwr_wpn: !!p.weapons });
    out.lights = !!v.lights_enabled;
    if (f?.state) { out.gear = deployed(f.state.gear); out.vtol = deployed(f.state.vtol); }
    if (s) {
      // Decoupled, the game sends coupled as neither offered nor active (5.0 PTU, checked in game),
      // so any coupled it sends that isn't active is decoupled. Not sent at all: unknown.
      out.decoupled = s.ifcs_coupled ? !(s.ifcs_coupled.enabled && s.ifcs_coupled.active) : undefined;
      Object.assign(out, {
        limiter: avail(s.ifcs_speed_limiter), gsafe: avail(s.ifcs_g_safe), esp: avail(s.ifcs_esp), prox: avail(s.ifcs_proximity_assist),
        stability: avail(s.ifcs_stability), gravcomp: avail(s.ifcs_gravity_compensation), windcomp: avail(s.ifcs_wind_compensation),
      });
      out.lightamp = !!s.flight_light_amplification;
      // Advanced HUD is set per mode; the one for the mode you're in.
      const mode = v.master_mode?.mode;
      if (mode === 1 || mode === 2) out.advhud = !!(mode === 1 ? s.advanced_hud_enabled_nav : s.advanced_hud_enabled_scm);
    }
    const mode = v.master_mode?.mode;
    if (mode === 1 || mode === 2) out.navmode = mode === 1 ? 'nav' : 'scm';
  }
  if (w?.settings) { out.gimbal = !!w.settings.gimbals_locked; out.stagger = !!w.settings.staggered_fire; }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** Decoys and noise left, when the ship carries them. The game sends no maximum. */
export function countermeasures(live) {
  const out = {};
  for (const c of live?.weapons?.countermeasures || []) {
    if (c.type === 1) out.decoy = c.amount;
    if (c.type === 2) out.noise = c.amount;
  }
  return out;
}

/** Guns ready to fire out of those fitted, or null with no weapons frame. */
export function guns(live) {
  const list = live?.weapons?.weapons;
  if (!list?.length) return null;
  return { ready: list.filter(g => g.is_powered && g.ready_to_fire).length, total: list.length };
}

export const ANNUNCIATORS = ['pwr', 'wpn', 'thr', 'shld', 'cool', 'qdrv', 'radr', 'prox', 'hit', 'misl'];
/** The warning lights in words: the game's own short codes would cut them. */
export const ANNUNCIATOR_NAMES = { pwr: 'Power', wpn: 'Weapons', thr: 'Thrusters', shld: 'Shields', cool: 'Coolers', qdrv: 'Quantum', radr: 'Radar', prox: 'Proximity', hit: 'Hit', misl: 'Missile' };
/** A warning light's look: '' off or unknown, 'n' nominal, 'm' minor, 'x' major; flashing too. */
export function lamp(state) {
  return { cls: state === 1 ? 'n' : state === 3 || state === 4 ? 'm' : state === 5 || state === 6 ? 'x' : '', flash: state === 3 || state === 5 };
}

const pct = v => Math.max(0, Math.min(100, Math.floor(v * 100 + 1e-6)));
// The game sends the largest float for an altitude that doesn't apply.
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e30;

/** The ship's instruments for the status display; a missing one is null. */
export function instruments(v) {
  const ins = v?.flight?.instruments;
  return {
    shields: v?.shields ? pct(v.shields.level) : null,
    // A hull of exactly 0 is what an unsent value looks like.
    hull: v?.health > 0 ? pct(v.health) : null,
    boost: ins?.boost ? pct(ins.boost.reserves) : null,
    speed: ins && finite(ins.speed) ? Math.round(ins.speed) : null,
    radarAlt: ins && finite(ins.radar_altitude) && ins.radar_altitude > 0 ? ins.radar_altitude : null,
    // 4.10 never sends it, and an unsent value reads 0: exactly 0 counts as unknown.
    vertical: ins && finite(ins.vertical_speed_indicator) && ins.vertical_speed_indicator !== 0 ? Math.round(ins.vertical_speed_indicator) : null,
  };
}

const SEATS = { 1: 'Pilot seat', 2: 'Gunner seat', 3: 'Crew seat' };
const MODES = { 1: 'NAV', 2: 'SCM' };
/** The role line's telemetry part: seat, landed or flying, mode and spool. */
export function shipLine(live) {
  const v = live?.vehicle;
  if (!v) return null;
  const parts = [];
  const seat = SEATS[live.actor?.state?.crew_role];
  if (seat) parts.push(seat);
  if (v.flight?.state) parts.push(v.flight.state.is_landed ? 'Landed' : 'Flying');
  const m = MODES[v.master_mode?.mode];
  if (m) parts.push(m + (v.master_mode.spooled ? ' spooled' : ''));
  return parts.join(' · ');
}

/**
 * Steps for the vitals, so a bar or a number takes a colour only when it needs attention:
 * '' fine, 'caution' (amber) or 'warning' (red). The game publishes no thresholds, so these are
 * ours: percentages of what the game calls full, and body temperature in °C both ways.
 */
export const VITAL_STEPS = { health: [50, 25], oxygen: [40, 15], hunger: [30, 10], thirst: [30, 10] };
export const BODY_STEPS = { cold: [35, 32], hot: [38.5, 40] };
export function vitalStep(kind, p) {
  const s = VITAL_STEPS[kind];
  return !s || p == null ? '' : p < s[1] ? 'warning' : p < s[0] ? 'caution' : '';
}
export function bodyStep(t) {
  if (t == null) return '';
  const { cold, hot } = BODY_STEPS;
  return t < cold[1] || t > hot[1] ? 'warning' : t < cold[0] || t > hot[0] ? 'caution' : '';
}

/** On foot or in EVA: the vitals for the status display, or null when seated or unknown. */
export function vitals(live) {
  const a = live?.actor, loc = a?.state?.locomotion;
  if (!a?.vitals || (loc !== 1 && loc !== 2)) return null;
  const vt = a.vitals, e = a.environment;
  const gauge = (g, scale) => g && g.max > 0 ? { value: g.current, pct: pct(g.current / g.max), scale } : null;
  return {
    eva: loc === 2,
    health: gauge(vt.health), oxygen: gauge(vt.oxygen), hunger: gauge(vt.hunger), thirst: gauge(vt.thirst),
    body: vt.body_temperature ? vt.body_temperature.current : null,
    heart: vt.heart_rate > 0 ? Math.round(vt.heart_rate) : null,
    gravity: finite(vt.gravity) ? vt.gravity : null,
    outside: e ? e.external_temperature : null,
    breathable: e ? !!e.breathable_atmosphere : null,
  };
}

/**
 * Whether a press goes through the game link: a tap of an action the game says it takes,
 * while the link is up and sending through it is on. Holds stay on keys.
 */
export const viaGame = (link, k, mode, on) => !!(on && link?.link === 'live' && mode === 'tap' && k?.action && link.actions?.includes(k.action));
