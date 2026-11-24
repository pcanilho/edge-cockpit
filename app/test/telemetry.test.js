import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { switchesOf, countermeasures, guns, lamp, instruments, shipLine, vitals, viaGame } from '../ui/lib/telemetry.js';

const U = JSON.parse(readFileSync(new URL('./fixtures/telemetry-prospector.json', import.meta.url)));
const live = U.live;

test('switches read from a real frame', () => {
  assert.deepEqual(switchesOf(live), {
    power: true, pwr_thr: false, pwr_shd: true, pwr_wpn: true, lights: false, gear: true, vtol: true,
    decoupled: false, limiter: true, gsafe: false, esp: false, prox: false, stability: true, gravcomp: true, windcomp: true,
    lightamp: false, advhud: false, navmode: 'scm', gimbal: true, stagger: false,
  });
});

test('nothing is claimed without the section', () => {
  assert.deepEqual(switchesOf({}), {});
  assert.deepEqual(switchesOf({ weapons: live.weapons }), { gimbal: true, stagger: false });
  // A setting the ship doesn't offer stays unknown.
  const v = structuredClone(live.vehicle); v.flight.settings.ifcs_g_safe = { enabled: false, active: false }; v.flight.settings.ifcs_esp = null;
  const s = switchesOf({ vehicle: v });
  assert.ok(!('gsafe' in s) && !('esp' in s));
  // Gear and VTOL the ship doesn't have.
  v.flight.state.gear = null; v.flight.state.vtol = null;
  assert.ok(!('gear' in switchesOf({ vehicle: v })));
  // Doors, port locks and the gun group are never claimed: the game doesn't send them.
  for (const k of ['doors', 'doorlocks', 'portlocks', 'guns', 'autoprec', 'rotlock']) assert.ok(!(k in s));
});

test('deploying counts as down, retracting as up', () => {
  const v = structuredClone(live.vehicle);
  v.flight.state.gear = 2; assert.equal(switchesOf({ vehicle: v }).gear, true);
  v.flight.state.gear = 4; assert.equal(switchesOf({ vehicle: v }).gear, false);
  v.flight.state.gear = 1; assert.equal(switchesOf({ vehicle: v }).gear, false);
});

test('NAV mode reads its own advanced HUD', () => {
  const v = structuredClone(live.vehicle);
  v.master_mode.mode = 1; v.flight.settings.advanced_hud_enabled_nav = true;
  assert.equal(switchesOf({ vehicle: v }).advhud, true);
  assert.equal(switchesOf({ vehicle: v }).navmode, 'nav');
});

test('counts, guns and lights', () => {
  assert.deepEqual(countermeasures(live), { decoy: 48, noise: 5 });
  assert.deepEqual(guns(live), { ready: 2, total: 2 });
  assert.equal(guns({}), null);
  assert.deepEqual(lamp(1), { cls: 'n', flash: false });
  assert.deepEqual(lamp(4), { cls: 'm', flash: false });
  assert.deepEqual(lamp(5), { cls: 'x', flash: true });
  assert.deepEqual(lamp(0), { cls: '', flash: false });
});

test('instruments, with the no-ground altitude left out', () => {
  assert.deepEqual(instruments(live.vehicle), { shields: 100, hull: 100, boost: 100, speed: 0, radarAlt: 4.433704, vertical: 0 });
  const v = structuredClone(live.vehicle);
  v.flight.instruments.radar_altitude = 3.4028235e38; v.health = 0; v.shields = null;
  const i = instruments(v);
  assert.equal(i.radarAlt, null); assert.equal(i.hull, null); assert.equal(i.shields, null);
  assert.equal(shipLine(live), 'Pilot seat · Landed · SCM spooled');
});

test('vitals only on foot or in EVA', () => {
  assert.equal(vitals(live), null);
  const a = structuredClone(live.actor); a.state.locomotion = 1;
  const v = vitals({ actor: a });
  assert.equal(v.health.pct, 100); assert.equal(v.hunger.pct, 73); assert.equal(v.thirst.pct, 39);
  assert.equal(v.heart, 61); assert.equal(v.breathable, true); assert.equal(v.eva, false);
});

test('presses go through the game only for actions it takes', () => {
  const k = { action: 'v_lights' };
  assert.equal(viaGame(U, k, 'tap', true), true);
  assert.equal(viaGame(U, k, 'tap', false), false);
  assert.equal(viaGame(U, k, 'down', true), false);
  assert.equal(viaGame(U, { action: 'v_eject' }, 'tap', true), false);
  assert.equal(viaGame({ ...U, link: 'off' }, k, 'tap', true), false);
});

test('4.10.3 LIVE leaves out shields, hull, master mode and vertical speed: none is shown', () => {
  // From a recording on 4.10.3 LIVE (RSI Galaxy, flying), as the app passes it on.
  const v = { name: 'RSI_Galaxy_929237689784', class_name: 'RSI_Galaxy', lights_enabled: false, shields: null, health: 0, master_mode: null,
    flight: { state: { is_landed: false, gear: 1, vtol: 1 }, settings: { ifcs_coupled: { enabled: true, active: true } },
      instruments: { speed: 12.34, boost: { engaged: true, reserves: 0.9977, critical: false }, radar_altitude: 3.4028234663852886e38, vertical_speed_indicator: 0 } } };
  assert.deepEqual(instruments(v), { shields: null, hull: null, boost: 99, speed: 12, radarAlt: null, vertical: null });
  assert.equal(shipLine({ vehicle: v, actor: { state: { crew_role: 1 } } }), 'Pilot seat · Flying');
});

test('decoupled: 5.0 sends coupled as neither offered nor active', () => {
  const at = c => switchesOf({ vehicle: { flight: { settings: { ifcs_coupled: c } } } }).decoupled;
  assert.equal(at({ enabled: true, active: true }), false);
  assert.equal(at({ enabled: false, active: false }), true);
  assert.equal(at(null), undefined);
});
