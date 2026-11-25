import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idle, step } from '../ui/lib/approach.js';

/** Runs updates { landed, gear, ralt, vsi, t } and returns the acts with their times. */
function run(frames) {
  let s = idle();
  const acts = [];
  for (const f of frames) {
    const r = step(s, { landed: f.landed ?? null, gear: f.gear ?? null, ralt: f.ralt ?? null, vsi: f.vsi ?? null }, f.t);
    s = r.state;
    if (r.act) acts.push(`${r.act}@${f.t}`);
  }
  return { acts, s };
}
const fly = (t, ralt, vsi, gear = 1) => ({ t, landed: false, gear, ralt, vsi });

test('gear going down in flight opens it, touchdown plus 5 s closes it', () => {
  const { acts } = run([fly(0, 900, -5), fly(1000, 600, -5, 2), fly(2000, 200, -3, 3),
    { t: 3000, landed: true, gear: 3, ralt: 1, vsi: 0 }, { t: 7000, landed: true, gear: 3 }, { t: 8000, landed: true, gear: 3 }]);
  assert.deepEqual(acts, ['open@1000', 'close@8000']);
});

test('sinking under 300 m opens it once the ship has been above 400 m', () => {
  assert.deepEqual(run([fly(0, 250, -4), fly(1000, 200, -4)]).acts, [], 'never seen high: no altitude trigger');
  assert.deepEqual(run([fly(0, 500, -4), fly(1000, 299, -4)]).acts, ['open@1000']);
  assert.deepEqual(run([fly(0, 500, -4), fly(1000, 250, 0)]).acts, [], 'level flight low is not a landing');
});

test('takeoff opens it, 5 s above 400 m with the gear up closes it', () => {
  const { acts } = run([{ t: 0, landed: true, gear: 3, ralt: 1 }, fly(1000, 20, 5, 3), fly(2000, 450, 8, 3),
    fly(3000, 450, 8, 1), fly(7000, 420, 2, 1), fly(8000, 430, 1, 1)]);
  assert.deepEqual(acts, ['open@1000', 'close@8000'], 'gear still down at 450 m keeps it open');
});

test('dipping back under 400 m restarts the hold, so it does not flap', () => {
  const { acts } = run([{ t: 0, landed: true, gear: 3 }, fly(1000, 50, 5),
    fly(2000, 410, 1), fly(4000, 390, -1), fly(6000, 410, 1), fly(10000, 420, 0), fly(11000, 420, 0)]);
  assert.deepEqual(acts, ['open@1000', 'close@11000']);
});

test('a touch-and-go does not close it while it is still near the ground', () => {
  const { acts } = run([fly(0, 800, -5), fly(1000, 280, -5), { t: 2000, landed: true, gear: 3 }, fly(4000, 30, 4, 3)]);
  assert.deepEqual(acts, ['open@1000']);
});

test('after a close, the next takeoff opens it again', () => {
  const { acts } = run([fly(0, 800, -5), fly(1000, 280, -5), { t: 2000, landed: true, gear: 3 }, { t: 7000, landed: true, gear: 3 },
    { t: 60000, landed: true, gear: 3 }, fly(61000, 10, 3, 3)]);
  assert.deepEqual(acts, ['open@1000', 'close@7000', 'open@61000']);
});

test('a value the game does not send triggers nothing', () => {
  assert.deepEqual(run([{ t: 0 }, { t: 1000 }, { t: 9000 }]).acts, []);
  assert.deepEqual(run([fly(0, null, null, null), fly(1000, null, null, null)]).acts, []);
});
