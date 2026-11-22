// Your own pages: the format and the rules every control keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPage, cleanItem, refuse, refuseItem, unset, switchable, isDanger, duplicate, blank, lefts, pageForShip, WIDTHS, SPACE, GRID } from '../ui/lib/custom.js';

const K = (label, o = {}) => [label, { label, action: o.action || label.toLowerCase().replace(/ /g, '_'), ...o }];
const keys = new Map([K('Lights on'), K('Lights off'), K('Lights'), K('Ping'), K('Shields'), K('Eject', { action: 'v_eject', role: 'critical' }),
  K('Self destruct', { action: 'v_self_destruct', role: 'critical' }), K('Space brake', { role: 'hold' }), K('Decoy', { more: { hold: {} } }), K('Jettison cargo', { action: 'v_jettison_cargo' })]);

test('a switch only takes an action with set-on and set-off binds', () => {
  assert.equal(refuse('switch', 'Lights', keys), '');
  assert.match(refuse('switch', 'Shields', keys), /set-on/);
  assert.match(refuse('onoffkey', 'Ping', keys), /set-on/);
  assert.deepEqual(switchable(keys), ['Lights']);
});

test('keys that end a flight or dump cargo only go behind a guard or a slide', () => {
  for (const l of ['Eject', 'Self destruct', 'Jettison cargo']) {
    assert.ok(isDanger(keys.get(l)), l);
    assert.match(refuse('key', l, keys), /guarded cover/);
    assert.equal(refuse('guard', l, keys), '');
    assert.equal(refuse('slide', l, keys), '');
  }
  assert.match(refuse('guard', 'Ping', keys), /guarded cover is for/);
});

test('hold keys go on a keycap or round button; keys with their own long-press stay stock', () => {
  assert.equal(refuse('key', 'Space brake', keys), '');
  assert.equal(refuse('round', 'Space brake', keys), '');
  assert.match(refuse('rocker', 'Space brake', keys), /Hold keys/);
  assert.match(refuse('key', 'Decoy', keys), /long-press/);
  assert.match(refuse('key', 'Nope', keys), /Not a known key/);
});

test('controls snap to the grid, keep their smallest size and stay on the plate', () => {
  const it = cleanItem({ t: 'key', x: 3, y: -50, w: 10, h: 999, key: 'Ping' }, 450);
  assert.equal(it.x % GRID, 0);
  assert.equal(it.y, 2 * GRID);
  assert.equal(it.w, 64); // 56 minimum, on the grid
  assert.ok(it.y + it.h <= 708 - GRID);
  const sw = cleanItem({ t: 'switch', x: 440, y: 0, w: 300, h: 300, key: 'Lights' }, 450);
  assert.deepEqual([sw.w, sw.h], [84, 196]); // a switch has one size
  assert.ok(sw.x + sw.w <= 450 - GRID);
  assert.equal(cleanItem({ t: 'bogus' }, 450), null);
});

test('a page is cleaned: plates fit the Edge, stock widths kept, junk dropped', () => {
  assert.equal(cleanPage({ id: 'x', plates: [{}] }), null);
  assert.equal(cleanPage({ id: 'my-abcd1234', plates: [] }), null);
  const p = cleanPage({ id: 'my-abcd1234', name: 'A'.repeat(80), plates: [{ stock: 'power' }, { w: 612, add: [{ t: 'key', key: 'Ping' }, { t: 'nope' }] }, { w: 5000 }, { w: 900 }] });
  assert.equal(p.name.length, 24);
  assert.equal(p.plates[0].w, WIDTHS.power);
  assert.equal(p.plates[1].w, 612); // a stock width is kept, not snapped
  assert.equal(p.plates[1].add.length, 1);
  const used = p.plates.reduce((s, pl) => s + pl.w + 6, -6);
  assert.ok(used <= SPACE, `${used} > ${SPACE}`);
});

test('duplicate keeps the four stock plates; blank is one plate; plates sit left to right', () => {
  const d = duplicate('light-fighter', 'My Gladius', 'fighter', 'my-dup00001');
  assert.deepEqual(d.plates.map(p => p.stock), ['power', 'role', 'flight', 'gear']);
  assert.deepEqual(lefts(d), [382, 838, 1662, 2280]); // the stock positions exactly
  const b = blank('Mine', 'my-blank001');
  assert.equal(b.plates.length, 1);
  assert.equal(b.plates[0].stock, null);
});

test('a page linked to a ship class wins for its variants, the longest class first', () => {
  const a = cleanPage({ id: 'my-aaaa0001', ships: ['AEGS_Gladius'], plates: [{ stock: 'power' }] });
  const b = cleanPage({ id: 'my-bbbb0001', ships: ['AEGS_Gladius_Valiant'], plates: [{ stock: 'power' }] });
  assert.equal(pageForShip([a, b], 'AEGS_Gladius_1234')?.id, 'my-aaaa0001');
  assert.equal(pageForShip([a, b], 'AEGS_Gladius_Valiant_99')?.id, 'my-bbbb0001');
  assert.equal(pageForShip([a, b], 'AEGS_Avenger'), null);
});

test('a control without its key is unset; a page keeps Fit or Actual size', async () => {
  const { unset, cleanPage } = await import('../ui/lib/custom.js');
  assert.equal(unset({ t: 'key' }), true);
  assert.equal(unset({ t: 'key', key: 'Ping' }), false);
  assert.equal(unset({ t: 'rocker', a: 'X' }), true);
  assert.equal(unset({ t: 'rotary', positions: [{ key: 'A' }, { key: '' }] }), true);
  assert.equal(unset({ t: 'label', text: '' }), false);
  const p = { id: 'my-abcd', plates: [{ w: 450 }] };
  assert.equal(cleanPage({ ...p, size: 'actual' }).size, 'actual');
  assert.equal(cleanPage({ ...p, size: 'huge' }).size, null);
});

test('a sequence takes taps and set-on / set-off keys, never a toggle with a set pair, danger, hold or another sequence', () => {
  const ks = new Map([...keys, K('Startup', { role: 'macro', steps: [] })]);
  assert.equal(refuse('seq', 'Lights on', ks), '');
  assert.equal(refuse('seq', 'Ping', ks), '');
  assert.equal(refuse('seq', 'Decoy', ks), '');
  assert.match(refuse('seq', 'Lights', ks), /Lights on or Lights off/);
  assert.match(refuse('seq', 'Eject', ks), /guarded cover/);
  assert.match(refuse('seq', 'Space brake', ks), /Hold keys/);
  assert.match(refuse('seq', 'Startup', ks), /another sequence/);
});

test('a sequence keeps six steps at most, a known gap, and needs two steps', () => {
  const it = cleanItem({ t: 'seq', x: 32, y: 48, w: 192, h: 112, steps: Array.from({ length: 10 }, () => ({ key: 'Ping' })), gap: 7 }, 818);
  assert.equal(it.steps.length, 6);
  assert.equal(it.gap, 250);
  assert.equal(cleanItem({ t: 'seq', steps: [], gap: 3000 }, 818).gap, 3000);
  assert.ok(unset({ t: 'seq', steps: [{ key: 'Ping' }] }));
  assert.ok(!unset({ t: 'seq', steps: [{ key: 'Ping' }, { key: 'Lights on' }] }));
  assert.match(refuseItem({ t: 'seq', steps: [{ key: 'Ping' }] }, keys), /two steps/);
  assert.equal(refuseItem({ t: 'seq', steps: [{ key: 'Ping' }, { key: 'Lights off' }] }, keys), '');
});
