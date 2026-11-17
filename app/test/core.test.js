import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY, parseLine, reduce, shipName, shipClass, version, untested, placeName, place } from '../ui/lib/gamelog.js';
import { pageFor } from '../ui/lib/pages.js';
import { lookup } from '../ui/lib/ships.js';
import { slugsOf } from '../ui/outlines.js';

const layout = JSON.parse(readFileSync(new URL('../../layouts/star-citizen.json', import.meta.url), 'utf8'));
const SET = "<2026-11-17T08:00:01.123Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::SetDriver: Local client node [204721322607] granted control token for 'MISC_Prospector_771690342710' [771690342710] [Team_VehicleFeatures][Vehicle]";
const CLEAR = "<2026-11-17T08:09:01.123Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [204721322607] releasing control token for 'MISC_Prospector_771690342710' [771690342710] [Team_VehicleFeatures][Vehicle]";

test('parses pilot seat lines', () => {
  assert.deepEqual(parseLine(SET), { type: 'seat', seated: true, ship: 'MISC_Prospector' });
  assert.deepEqual(parseLine(CLEAR), { type: 'seat', seated: false, ship: 'MISC_Prospector' });
  assert.deepEqual(parseLine('<SHUDEvent_OnNotification> Added notification "Entering Armistice Zone - Combat Prohibited: "'), { type: 'armistice', inside: true });
  assert.deepEqual(parseLine('Added notification "Leaving Armistice Zone - Caution Advised: "'), { type: 'armistice', inside: false });
  assert.deepEqual(parseLine('Player has selected point OM-1_Hurston as their destination'), { type: 'qt', target: 'OM-1_Hurston' });
  assert.equal(parseLine('<Something else> nothing to see'), null);
});

test('tracks seat, zone and destination', () => {
  let s = { ...EMPTY };
  s = reduce(s, parseLine(SET));
  assert.equal(s.seated, true);
  s = reduce(s, { type: 'armistice', inside: true });
  s = reduce(s, { type: 'qt', target: 'ARC-L1' });
  // Leaving some other seat does not count.
  assert.equal(reduce(s, { type: 'seat', seated: false, ship: 'ANVL_Arrow' }), s);
  s = reduce(s, parseLine(CLEAR));
  assert.deepEqual([s.seated, s.armistice, s.qtTarget], [false, true, null]);
  assert.deepEqual(reduce(s, { type: 'session' }), { ...EMPTY });
});

test('tracks going down, respawning and the menu', () => {
  const read = (s, line) => { const ev = parseLine(line); return ev ? reduce(s, ev) : s; };
  let s = { ...EMPTY };
  assert.equal(s.menu, true);
  s = read(s, '<2026-11-17T10:00:00.000Z> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 201990709919 - accountId 1 - name space-man-rob - state STATE_CURRENT');
  assert.deepEqual(s.me, { geid: '201990709919', name: 'space-man-rob' });
  s = read(s, '<Join PU> address[1] port[1]');
  assert.equal(s.menu, true);
  s = read(s, 'Loading screen for Stanton : SC_Default closed after 41.2 seconds');
  assert.equal(s.menu, false);
  s = read(s, SET);
  // Someone else going down changes nothing; you going down does, and leaves the seat.
  assert.equal(read(s, "Logged an incap.! nickname: Someone-Else, causes: [Bullet (12 damage)]").down, false);
  assert.equal(read(s, "<Actor Death> CActor::Kill: 'Someone-Else' [1] in zone 'x' killed by 'y'").down, false);
  s = read(s, "Logged an incap.! nickname: space-man-rob, causes: [Bullet (12 damage)]");
  assert.deepEqual([s.down, s.seated], [true, false]);
  assert.equal(pageFor(layout, s).id, 'downed');
  // Another player's respawn doesn't count; ours does.
  assert.equal(read(s, '<Recv Unbind Batch Add Player> playerGEID=1').down, true);
  s = read(s, '<Recv Unbind Batch Add Player> playerGEID=201990709919');
  assert.equal(s.down, false);
  assert.equal(pageFor(layout, s).id, 'onfoot');
  // The HUD notice only reaches the local player, so it counts even before we know our name.
  assert.equal(read({ ...EMPTY, menu: false }, '<SHUDEvent_OnNotification> Added notification "Standby, Local Emergency Services Are En Route: "').down, true);
  s = read(s, '[CIG] CCIGBroker::FastShutdown');
  assert.deepEqual([s.menu, s.me.name], [true, 'space-man-rob']);
  assert.equal(pageFor(layout, s).id, 'flight');
});

test('names ships for the status key', () => {
  assert.equal(shipName('MISC_Prospector'), 'Prospector');
  assert.equal(shipName('DRAK_Cutlass_Black'), 'Cutlass Black');
});

test('picks the role page for each ship, hiding kit it lacks', () => {
  const db = JSON.parse(readFileSync(new URL('../../layouts/ships.json', import.meta.url), 'utf8')).ships;
  const at = (ship, over = {}) => pageFor(layout, { seated: true, ship }, db, over).id;
  assert.equal(at('MISC_Prospector'), 'mining');
  assert.equal(at('DRAK_Vulture'), 'salvage');
  assert.equal(at('AEGS_Gladius'), 'light-fighter');
  assert.equal(at('RSI_Mantis'), 'heavy-fighter--no-emp');       // has missiles and QED, no EMP
  assert.equal(at('TMBL_Cyclone'), 'ground');
  assert.equal(at('NOPE_Unknown'), 'flight');                    // unknown ship: Flight
  assert.equal(pageFor(layout, { seated: false, ship: 'MISC_Prospector' }, db).id, 'onfoot');
  // The player's overrides win, by exact class or prefix.
  assert.equal(at('AEGS_Gladius', { AEGS_Gladius: 'heavy-fighter' }), 'heavy-fighter--no-emp--no-qed');
  assert.equal(at('AEGS_Gladius_Valiant', { AEGS_Gladius: { role: 'mining' } }), 'mining');
  assert.equal(pageFor(layout, { seated: true, ship: 'MISC_Prospector' }, db).ship.name, 'MISC Prospector');
});

test('looks ships up by class or prefix', () => {
  const db = { AEGS_Gladius: { name: 'Gladius', role: 'light-fighter', has: ['missiles'] }, AEGS_Gladius_Valiant: { name: 'Valiant', role: 'heavy-fighter', has: [] } };
  assert.equal(lookup(db, {}, 'AEGS_Gladius_Valiant').name, 'Valiant');
  assert.equal(lookup(db, {}, 'AEGS_Gladius_PIR').name, 'Gladius');
  assert.equal(lookup(db, {}, 'AEGS_Gladiusx'), null);
  assert.deepEqual(lookup(db, { AEGS_Gladius: { has: [] } }, 'AEGS_Gladius').has, []);
});

test('looks up ship outlines by class, then by base model', () => {
  assert.deepEqual(slugsOf('AEGS_Gladius_Valiant'), ['aegs-gladius-valiant', 'aegs-gladius']);
  assert.deepEqual(slugsOf('DRAK_Cutlass_Black'), ['drak-cutlass-black', 'drak-cutlass']);
});

test('reads the build, kills, a wrecked ship and the location', () => {
  const lines = [
    'Branch: sc-alpha-4.3.2',
    'Changelist: 9876543',
    '<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name pilot - state STATE_CURRENT',
    '<Context Establisher Done>',
    "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'AEGS_Gladius_123' [123]",
    "<2026-11-17T09:00:00.000Z> [Notice] <Actor Death> CActor::Kill: 'PU_Pilot_Enemy_77' [77] in zone 'ANVL_Arrow_9' killed by 'pilot' [2001] using 'AEGS_Gladius_123' [Class unknown] with damage type 'VehicleDestruction'",
    "<RequestLocationInventory> Player[pilot] requested inventory for Location[Stanton1_Lorville]",
    "<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_123' [123] in zone 'space' [pos x: 1] driven by 'pilot' [2001] advanced from destroy level 0 to 1 caused by 'PU_Pilot_Enemy_78' [78] with 'Combat'",
  ];
  const s = lines.map(parseLine).filter(Boolean).reduce(reduce, EMPTY);
  assert.deepEqual(s.build, { branch: 'sc-alpha-4.3.2', changelist: '9876543' });
  assert.equal(version(s.build.branch), '4.3.2');
  assert.equal(untested(s), false);
  assert.equal(untested({ build: { branch: 'sc-alpha-5.0.0' } }), true);
  assert.equal(s.kills, 1);
  assert.equal(s.wrecked, 1);
  assert.equal(placeName(s.location), 'Lorville');
  assert.deepEqual(place('Stanton1_Lorville'), { name: 'Lorville', kind: '', system: 'Stanton', body: 1 });
  assert.deepEqual(place('AsteroidClusterBase_Nyx_Social_Keeger_001'), { name: 'Keeger', kind: 'Asteroid base', system: 'Nyx', body: null });
  assert.deepEqual(place('Stanton2b_RestStop_Daymar'), { name: 'Daymar', kind: 'Rest stop', system: 'Stanton', body: 2 });
  // Being killed counts as going down, not as a kill.
  const dead = reduce(s, parseLine("<Actor Death> CActor::Kill: 'pilot' [2001] in zone 'x' killed by 'PU_Pilot_Enemy_78' [78] using 'gun'"));
  assert.equal(dead.down, true);
  assert.equal(dead.kills, 1);
});

test('4.10: boarding by crew channel, the ship from navigation, leaving', () => {
  const lines = [
    "<2026-11-17T17:57:33.479Z> [Notice] <SHUDEvent_OnNotification> Added notification \"You have joined channel 'Aegis Sabre Firebird : Argoneth'.",
    "<2026-11-17T17:57:33.629Z> [Notice] <Failed to get starmap route data!> [ItemNavigation][CL][31556] | NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::GetStarmapRouteSegmentData|No Route loaded! [Team_CGP4][QuantumTravel]",
  ];
  let s = lines.map(parseLine).filter(Boolean).reduce(reduce, { ...EMPTY, menu: false });
  assert.equal(s.seated, true);
  assert.equal(s.ship, 'AEGS_Sabre_Firebird');
  s = reduce(s, parseLine("<2026-11-17T18:10:08.285Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [204717092667] releasing control token for 'AEGS_Sabre_Firebird_932943782879' [932943782879] [Team_CGP4][Vehicle]"));
  assert.equal(s.seated, false);
  // Walking out of the ship after leaving the seat changes nothing more.
  s = reduce(s, parseLine("<2026-11-17T18:11:14.749Z> [Notice] <SHUDEvent_OnNotification> Added notification \"You have left the channel 'Aegis Sabre Firebird : Argoneth'."));
  assert.equal(s.seated, false);
  // Another ship's route lines (not ours) do not seat us.
  assert.equal(parseLine("<x> [Notice] <Local Route Guard - Server Rerouted> [ItemNavigation][CL][31556] | NOT AUTH | RSI_Constellation_Taurus_GS_938366176068[938366176068]|CSCItemNavigation::PostInitialize::<lambda_1>::operator ()|FinalStop=0"), null);
  assert.equal(shipClass('Consolidated Outland Mustang Alpha'), 'CNOU_Mustang_Alpha');
});

