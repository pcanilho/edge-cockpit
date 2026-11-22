import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { namesIn, redact, reportText, issueBody } from '../ui/lib/report.js';

const LOG = readFileSync(new URL('./fixtures/game-4.10.log', import.meta.url), 'utf8').split('\n');

test('finds the players a log names, not ships or AI', () => {
  const n = namesIn(LOG);
  assert.ok(n.has('Argoneth'));
  for (const x of n) assert.doesNotMatch(x, /^(PU_|AEGS_)/);
});

test('report lines keep no handle, player name, ID or address', () => {
  const out = redact([
    "<Actor Death> CActor::Kill: 'Argoneth' [201990709919] in zone 'space' killed by 'Kaboos' [3] using 'KLWE_LaserRepeater_S3_4411'",
    '<Actor stall> Actor stall detected, Player: Argoneth, Type: downstream',
    'Added notification "Party Wingman7 connected.: "',
    '<Join PU> address[35.187.10.4] port[64300] shard[pub_euw1b_11218823_090]',
    'Player has selected point Hurston as their destination',
  ], 'Argoneth').join('\n');
  assert.doesNotMatch(out, /Argoneth|Kaboos|Wingman7|201990709919|35\.187/);
  assert.match(out, /<you>/);
  assert.match(out, /<player>/);
  assert.match(out, /KLWE_LaserRepeater_S3_<id>|KLWE_LaserRepeater_S3_4411/);
  assert.match(out, /Player has selected point Hurston/, 'ordinary words stay');
});

test('the whole fixture comes out without the handle or its id', () => {
  const text = reportText({ version: '0.9.2', os: 'Windows 11 24H2 (build 26100.2314)', webview: '131', lines: LOG.slice(-300), me: 'Argoneth',
    screens: [{ name: 'XENEON EDGE', width: 2560, height: 720, scale: 1, touch: true, current: true }], game: { channel: 'LIVE', build: '4.10.3' }, binds: { total: 232 } });
  assert.doesNotMatch(text, /Argoneth|201990709919/);
  assert.match(text, /\* XENEON EDGE 2560x720 at 100 % \(touch\)/);
});

test('the issue body fits in a link', () => {
  const body = issueBody({ version: '0.9.2', os: 'Windows 11', webview: '131', game: { channel: 'LIVE', build: '4.10.3' },
    screens: [{ name: 'XENEON EDGE', width: 2560, height: 720, scale: 1, current: true }] }, 'C:\\Users\\x\\Documents\\Edge Cockpit\\report.txt');
  assert.ok(body.length < 1500, `${body.length} characters`);
  assert.match(body, /XENEON EDGE 2560x720 at 100 %/);
});
