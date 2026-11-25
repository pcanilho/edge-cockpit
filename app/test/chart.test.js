import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layout, resolve, where, ago, kindText, placesAt, spell } from '../ui/lib/chart.js';

// A real chart from UEX, cut down by the Rust side (cargo test -- --ignored live_chart).
const CHART = JSON.parse(readFileSync(new URL('./fixtures/world-chart.json', import.meta.url), 'utf8'));
const sys = name => CHART.systems.find(s => s.name === name);
const S = sys('Stanton'), P = sys('Pyro'), N = sys('Nyx');
const at = (s, id) => resolve(s, id);

test('planets go out from the star in their order, each on its own ring', () => {
  const { nodes, rings } = layout(S);
  const planets = nodes.filter(n => n.kind === 'planet');
  assert.deepEqual(planets.map(n => n.label), ['Hurston', 'Crusader', 'ArcCorp', 'microTech']);
  const d = planets.map(n => Math.hypot(n.x, n.z));
  assert.ok(d.every((v, i) => !i || v > d[i - 1]), 'each planet further out');
  assert.equal(rings.filter(r => r.kind === 'planet').length, 4);
  // Every body UEX lists has a node, and no two sit on the same spot.
  assert.equal(nodes.length, S.bodies.length);
  const spots = new Set(nodes.map(n => `${Math.round(n.x)},${Math.round(n.z)}`));
  assert.equal(spots.size, nodes.length);
});

test('moons circle their planet and Lagrange points keep their places', () => {
  const { nodes } = layout(S);
  const get = n => nodes.find(x => x.name === n);
  const cru = get('Crusader'), yela = get('Yela');
  assert.ok(Math.hypot(yela.x - cru.x, yela.z - cru.z) < 60, 'Yela near Crusader');
  const l = k => get(`Hurston Lagrange Point ${k}`), hur = get('Hurston'), r = n => Math.hypot(n.x, n.z);
  assert.ok(r(l(1)) < r(hur) && r(l(2)) > r(hur), 'L1 inside, L2 outside');
  const dot = (a, b) => (a.x * b.x + a.z * b.z) / (r(a) * r(b));
  assert.ok(dot(l(3), hur) < -0.99, 'L3 opposite');
  assert.ok(Math.abs(dot(l(4), hur) - 0.5) < 0.01 && Math.abs(dot(l(5), hur) - 0.5) < 0.01, 'L4 and L5 at 60 degrees');
  assert.equal(l(1).label, 'Hurston Lagrange point 1');
  assert.equal(get('microTech Lagrange Point 1').label, 'microTech Lagrange point 1');
});

test('Nyx has no planets on UEX: its bases and gateways still lay out', () => {
  const { nodes } = layout(N);
  assert.ok(nodes.some(n => n.name === 'Delamar' && n.kind === 'asteroid'));
  assert.equal(nodes.filter(n => n.kind === 'gateway').length, 2);
});

test('Game.log names resolve to the body, never a guess', () => {
  // Quantum targets.
  assert.deepEqual(at(S, 'Yela'), { body: 'Yela', place: null });
  assert.deepEqual(at(S, 'OM-1_Hurston'), { body: 'Hurston', place: null });
  assert.deepEqual(at(S, 'ArcCorp'), { body: 'ArcCorp', place: null });
  // Inventory locations and hangar lifts.
  assert.deepEqual(at(S, 'Stanton3_Area18'), { body: 'ArcCorp', place: 'Area 18' });
  assert.deepEqual(at(S, 'Area18'), { body: 'ArcCorp', place: 'Area 18' });
  assert.deepEqual(at(S, 'RR_HUR_L1'), { body: 'Hurston Lagrange Point 1', place: null });
  assert.deepEqual(at(S, 'RR_CRU_LEO'), { body: 'Crusader', place: null });
  assert.deepEqual(at(S, 'RR_JP_PyroStanton'), { body: 'Pyro Gateway', place: null });
  assert.deepEqual(at(P, 'RR_P6_LEO_Ruin_Station'), { body: 'Terminus', place: 'Ruin Station' });
  assert.deepEqual(at(P, 'RR_P5_L4'), { body: 'Pyro V Lagrange Point 4', place: null });
  assert.deepEqual(at(P, 'RR_JP_PyroStanton'), { body: 'Stanton Gateway', place: null });
  assert.deepEqual(at(S, 'Stanton1_Lorville'), { body: 'Hurston', place: 'Lorville' });
  assert.deepEqual(at(S, 'GrimHEX'), { body: 'Yela', place: 'Green Imperial Housing Exchange' });
  assert.deepEqual(at(N, 'Levski'), { body: 'Delamar', place: 'Levski' });
  // A planet by its number when the words name nothing UEX lists.
  assert.deepEqual(at(S, 'Stanton2_SomeOutpost_123'), { body: 'Crusader', place: null });
  // A mission marker, something unknown, or another system's id: no body.
  assert.equal(at(S, 'MISSION_QT_Kaboos_928004668243'), null);
  assert.equal(at(S, 'Somewhere'), null);
  assert.equal(at(S, 'Pyro2_Outpost'), null);
  assert.equal(at(null, 'Yela'), null);
});

test('where you are: the last place Game.log named, in the system you are in', () => {
  const fix = { id: 'Yela', how: 'arrived', at: 1000, sys: 'Stanton', route: { from: 'ArcCorp', to: 'Yela' } };
  const w = where(CHART, { system: 'Stanton' }, fix);
  assert.equal(w.body, 'Yela');
  assert.equal(w.how, 'arrived');
  assert.deepEqual(w.route, { from: 'ArcCorp', to: 'Yela', active: false });
  // A quantum trip under way is the route shown, while the marker stays where you were.
  const q = where(CHART, { system: 'Stanton', qtRoute: { from: 'Yela', to: 'microTech' } }, fix);
  assert.deepEqual([q.body, q.route.to, q.route.active], ['Yela', 'microTech', true]);
  // After a jump the old place is in another system: no marker.
  const j = where(CHART, { system: 'Pyro' }, fix);
  assert.equal(j.sys.name, 'Pyro');
  assert.equal(j.body, null);
  // Game.log names the system only on a jump: else the one system that has the place.
  assert.equal(where(CHART, {}, { ...fix, sys: null }).system, 'Stanton');
  assert.equal(where(CHART, { location: 'Pyro1_Something' }, null).system, 'Pyro');
  assert.equal(where(CHART, { qtRoute: { from: 'Nyx Gateway', to: 'Pyro Gateway' } }, null).system, null, 'gateways are in more than one system');
  // No fix: the system only.
  assert.equal(where(CHART, { system: 'Stanton' }, null).body, null);
  assert.equal(where(null, { system: 'Stanton' }, fix).sys, null);
});

test('words for the card are written out in full', () => {
  assert.equal(ago(30_000), 'just now');
  assert.equal(ago(60_000), '1 minute ago');
  assert.equal(ago(14 * 60_000), '14 minutes ago');
  assert.equal(ago(61 * 60_000), '1 hour 1 minute ago');
  assert.equal(ago(120 * 60_000), '2 hours ago');
  assert.equal(ago(50 * 3600_000), '2 days ago');
  assert.equal(kindText(S, 'Yela'), 'Moon of Crusader');
  assert.equal(kindText(S, 'MicroTech'), 'Planet · Stanton IV');
  assert.equal(kindText(S, 'microTech Lagrange Point 2'), 'Lagrange point of microTech');
  assert.equal(kindText(S, 'Pyro Gateway'), 'Jump point');
  assert.equal(spell('MicroTech'), 'microTech');
  assert.ok(placesAt(S, 'ArcCorp').some(p => p.name === 'Area 18'));
  assert.ok(placesAt(S, 'ArcCorp').findIndex(p => p.kind === 'station') < placesAt(S, 'ArcCorp').findIndex(p => p.kind === 'city'));
});
