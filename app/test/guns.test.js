import test from 'node:test';
import assert from 'node:assert/strict';
import { classOf, plainName, patchOf, statsOf } from '../ui/guns.js';

test('a weapon name from 5.0 loses its instance id; a 4.x class name stays', () => {
  assert.equal(classOf('KLWE_LaserRepeater_S2_878452447009'), 'KLWE_LaserRepeater_S2');
  assert.equal(classOf('GATS_BallisticCannon_S3_878452446989'), 'GATS_BallisticCannon_S3');
  assert.equal(classOf('KLWE_LaserRepeater_S1'), 'KLWE_LaserRepeater_S1');
  assert.equal(classOf(''), '');
  assert.equal(classOf(undefined), '');
});
test('the class name reads as words until the Wiki answers', () => {
  assert.equal(plainName('KLWE_LaserRepeater_S1'), 'Laser repeater S1');
  assert.equal(patchOf('4.10.3-LIVE.13165946'), '4.10.3-LIVE');
});
test('only a ship weapon has stats', () => {
  assert.equal(statsOf({ name: 'x' }), null);
  const s = statsOf({ vehicle_weapon: { rpm: 750, range: 1605, damage: { burst: 218.7, sustained_60s: 111.9, alpha_total: 17.5, dps: { energy: 218.7, physical: 0 } } } });
  assert.deepEqual([s.burst, s.sustained, s.alpha, s.rpm, s.range, s.kind], [218.7, 111.9, 17.5, 750, 1605, 'energy']);
});
