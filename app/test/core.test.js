import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY, parseLine, reduce, shipName, shipClass, version, untested, placeName, place, contractText, markup } from '../ui/lib/gamelog.js';
import { pageFor } from '../ui/lib/pages.js';
import { lookup } from '../ui/lib/ships.js';
import { slugsOf, shot } from '../ui/outlines.js';

const layout = JSON.parse(readFileSync(new URL('../../layouts/star-citizen.json', import.meta.url), 'utf8'));
const SET = "<2026-11-17T08:00:01.123Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::SetDriver: Local client node [204721322607] granted control token for 'MISC_Prospector_771690342710' [771690342710] [Team_VehicleFeatures][Vehicle]";
const CLEAR = "<2026-11-17T08:09:01.123Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [204721322607] releasing control token for 'MISC_Prospector_771690342710' [771690342710] [Team_VehicleFeatures][Vehicle]";

test('parses pilot seat lines', () => {
  assert.deepEqual(parseLine(SET), { type: 'seat', seated: true, ship: 'MISC_Prospector', id: '771690342710' });
  assert.deepEqual(parseLine(CLEAR), { type: 'seat', seated: false, ship: 'MISC_Prospector', id: '771690342710' });
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
  // A new session keeps what the Log page shows, such as the last ship flown.
  assert.deepEqual(reduce(s, { type: 'session' }), { ...EMPTY, lastShip: { ship: 'MISC_Prospector', id: '771690342710' } });
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
  assert.equal(place('Stanton3_Area18').name, 'Area 18'); // as the game spells it
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


test('4.10 missions: reward markup, echoed lines, where the marker points', () => {
  const lines = [
    '<2026-11-17T18:23:04.061Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Accepted:  Retrieve Additional Smuggler Intel <EM4>[BP]</EM4> <EM4>[100 Rep]</EM4>: " [10] to queue. New queue size: 1, MissionId: [e1a0], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]',
    '<2026-11-17T18:23:04.061Z> [Notice] <SHUDEvent_OnNotification> Added notification "New Objective: Go to Location: " [11] to queue. New queue size: 2, MissionId: [e1a0], ObjectiveId: [a319] [Team_CoreGameplayFeatures][Missions][Comms]',
    // The game echoes queued notices on lines of their own; they must not reset the objective.
    '<2026-11-17T18:23:04.061Z>    "Contract Accepted:  Retrieve Additional Smuggler Intel <EM4>[BP]</EM4> <EM4>[100 Rep]</EM4>: " [10]',
    '<2026-11-17T18:23:04.178Z> [Notice] <CObjectiveMarkerComponent::PairWithMissionNavpoint> MissionObjectiveMarker_754[754] - Paired with NavPoint: MISSION_QT_Kaboos_928306496062[928306496062] [Team_MissionFeatures][Missions]',
  ];
  const s = lines.map(parseLine).filter(Boolean).reduce(reduce, { ...EMPTY, menu: false });
  assert.equal(s.mission.contract, 'Retrieve Additional Smuggler Intel');
  assert.deepEqual(s.mission.tags, ['BP', '100 Rep']);
  assert.equal(s.mission.objective, 'Go to Location');
  assert.equal(s.mission.target, 'Kaboos');
  // Colour markup from the game and from StarStrings / SmartCitizen.
  assert.deepEqual(contractText('Deliver to <EM4>Lorville</EM4> [Illegal]'), { text: 'Deliver to Lorville', tags: ['Illegal'], runs: [{ text: 'Deliver to ', em: null }, { text: 'Lorville', em: 4 }] });
  assert.deepEqual(markup('<EM3>Hot</EM3> <b>cargo</b> <cough>run'), [{ text: 'Hot', em: 3 }, { text: ' ', em: null }, { text: 'cargo', em: 'b' }, { text: ' run', em: null }]);
});

test('tallies a session for the recap', async () => {
  const { tally, stamp, minutes, NEW_TALLY } = await import('../ui/lib/gamelog.js');
  const lines = [
    '<2026-11-17T08:00:00.000Z> <Context Establisher Done>',
    SET.replace('08:00:01', '08:01:00'),
    '<2026-11-17T08:05:00.000Z> Player has selected point OM-1_Hurston as their destination',
    '<2026-11-17T08:20:00.000Z> Added notification "Contract Complete: Kill them: "',
    CLEAR.replace('08:09:01', '08:40:00'),
    '<2026-11-17T08:42:00.000Z> CCIGBroker::FastShutdown',
  ];
  let s = { ...EMPTY }, t = { ...NEW_TALLY };
  s = reduce(s, { type: 'mission', kind: 'accepted', text: 'Kill them', tags: [] });
  s = { ...s, menu: true };
  for (const line of lines) {
    const ev = parseLine(line), was = s;
    if (ev) s = reduce(s, ev);
    t = tally(t, was, s, stamp(line));
  }
  assert.equal(minutes(t), 40);
  assert.deepEqual(t.ships, ['MISC_Prospector']);
  assert.equal(t.routes, 1);
  assert.equal(t.missions, 1);
});

test('alerts on CrimeStat, armistice and a disabled ship', async () => {
  const { alertsFor, culprit } = await import('../ui/lib/gamelog.js');
  const live = { ...EMPTY, menu: false, me: { name: 'pilot' } };
  assert.deepEqual(alertsFor(live, { ...live, crime: 2 }).map(a => a.text), ['CrimeStat 2']);
  assert.deepEqual(alertsFor({ ...live, crime: 2 }, live).map(a => a.tone), ['good']);
  assert.deepEqual(alertsFor(live, { ...live, armistice: true }).map(a => a.kind), ['armistice']);
  const seated = { ...live, seated: true, ship: 'AEGS_Gladius' };
  const hit = reduce(seated, parseLine("<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_123' [123] in zone 'space' driven by 'pilot' [2001] advanced from destroy level 0 to 1 caused by 'PU_Pilot_Enemy_78' [78] with 'Combat'"));
  assert.deepEqual(alertsFor(seated, hit).map(a => a.text), ['Ship disabled by an NPC']);
  assert.equal(culprit('Raider42', { name: 'pilot' }), 'Raider42');
  assert.equal(culprit('pilot', { name: 'pilot' }), 'yourself');
  assert.deepEqual(alertsFor({ ...EMPTY }, { ...EMPTY, crime: 1 }), []);
});

test('hangar: a called ship and its lift, a landing clearance', async () => {
  const { alertsFor, hangarText } = await import('../ui/lib/gamelog.js');
  const lift = to => `<2026-11-17T17:38:38.925Z> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarXLTop_Nyx] Platform state changed to ${to} [Team_CoreGameplayFeatures][Cargo]`;
  const me = { geid: '204717092667', name: 'Argoneth' };
  let s = { ...EMPTY, menu: false, me };
  // Lifts settle as hangars stream in: nothing to show without a call.
  s = reduce(s, parseLine(lift('OpenIdle')));
  assert.equal(s.hangar, null);
  // Freight lifts are not the ship lift.
  assert.equal(parseLine(lift('RaisingPlatform').replace('ShipElevator_HangarXLTop', 'FreightElevator_Util_HangarXL')), null);
  for (const l of [
    "<2026-11-17T17:38:36.758Z> [Notice] <CEntityComponentShipListProvider::SetVehicleSpawningInformations> SetVehicleSpawningInformations - VehicleEntityId: [932943782879], LandingArea: Argoneth's",
    '<2026-11-17T17:38:36.758Z> XL Hangar [Team_GameServices][ASOP]',
  ]) s = reduce(s, parseLine(l));
  assert.equal(hangarText(s), 'XL Hangar · ship called');
  s = reduce(s, parseLine(lift('OpeningLoadingGate')));
  assert.equal(hangarText(s), 'XL Hangar · lift rising');
  const up = reduce(s, parseLine(lift('OpenIdle')));
  assert.equal(hangarText(up), 'XL Hangar · ship ready');
  assert.deepEqual(alertsFor(s, up).map(a => a.text), ['Ship ready · XL Hangar']);
  // Boarding ends the call.
  s = reduce(up, parseLine(SET));
  assert.equal(s.hangar, null);
  // ATC clearance lasts until you leave the seat.
  const granted = reduce(s, parseLine('<2026-11-17T18:06:55.076Z> [Notice] <SHUDEvent_OnNotification> Added notification "Hangar Request Completed: " [7] to queue. New queue size: 1, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]'));
  assert.equal(hangarText(granted), 'Hangar assigned');
  assert.deepEqual(alertsFor(s, granted).map(a => a.text), ['Hangar assigned']);
  assert.equal(reduce(granted, parseLine(CLEAR)).hangar, null);
});

test('Log page: shard, jump, refinery, downed, quantum arrival, lag', async () => {
  const { logFor, shardName, weaponName } = await import('../ui/lib/gamelog.js');
  assert.deepEqual(shardName('pub_euw1b_13165946_150'), { region: 'EU West', n: '150' });
  assert.equal(weaponName('KLWE_LaserRepeater_S3_4411'), 'Laser Repeater S3');
  const lines = [
    '<Join PU> address[1] port[2] shard[pub_euw1b_13165946_031] locationId[1]',
    '<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name me - state STATE_CURRENT',
    '<Context Establisher Done>',
    'Added notification "Refinery Work Orders have been Completed at Levski: " [4]',
    '| NOT AUTH | DRAK_Cutlass_Black_771690342710[771690342710]|CSCItemNavigation::GetStarmapRouteSegmentData|',
    '<Changing Solar System> Solar system changed: Client entity me [2001] is changing system from Stanton to Nyx',
    "<Actor Death> CActor::Kill: 'me' [2001] in zone 'space' killed by 'Kaboos_Raider' [3] using 'KLWE_LaserRepeater_S3_4411' [Class unknown] with damage type 'Ballistic'",
    `<Corpse> Player 'me' <local client>: DoesLocationContainHospital: Searching landing zone location "Orison" for the closest hospital.`,
    '<Recv Unbind Batch Add Player> playerGEID=2001',
    '| NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::GetStarmapRouteSegmentData|',
    '| NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::CalculateRoute|Projected Start Location is Nyx I for route to destination Keeger',
    '| NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::OnQuantumDriveArrived|',
    '<Actor stall> Actor stall detected, Player: me, Type: downstream, Length: 3.2.',
    '<Actor stall> Actor stall detected, Player: someone, Type: downstream, Length: 9.',
  ];
  let g = { ...EMPTY };
  const log = [];
  for (const l of lines) { const ev = parseLine(l); assert.ok(ev, l); const was = g; g = reduce(g, ev); log.push(...logFor(was, g).map(e => e.text)); }
  assert.deepEqual(log, ['Joined EU West · shard 031', 'Refinery job done · Levski', 'Took the seat of Cutlass Black', 'Entered Nyx',
    'Downed by Kaboos_Raider · Laser Repeater S3', 'Respawn at Orison', 'Took the seat of Sabre Firebird', 'Quantum arrived · Keeger']);
  assert.deepEqual(g.lag, { len: 3.2, n: 1 });
  assert.equal(g.system, 'Nyx');
  assert.equal(g.downedBy.damage, 'Ballistic');
  // Stowing the ship you left logs it as stored.
  g = reduce(g, parseLine("CVehicleMovementBase::ClearDriver: Local client node [1] releasing control token for 'AEGS_Sabre_Firebird_932943782879' [932943782879]"));
  const was = g;
  g = reduce(g, parseLine('[STOWING ON UNREGISTER] Attempting to stow current vehicle [932943782879] due to landing area unregistering'));
  assert.deepEqual(logFor(was, g).map(e => e.text), ['Sabre Firebird stored']);
});

// The app's Rust side only passes on lines that hold one of its markers: every pattern
// the panel reads needs a sample here, and the sample must get through.
const N = t => `<2026-10-03T18:11:40.000Z> [Notice] <SHUDEvent_OnNotification> Added notification "${t}" [26] to queue. New queue size: 1`;
test('every log pattern gets past the Rust line filter', async () => {
  const { PATTERNS } = await import('../ui/lib/gamelog.js');
  const rs = readFileSync(new URL('../src-tauri/src/game.rs', import.meta.url), 'utf8');
  const block = /const MARKERS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)[1].replace(/\/\/.*$/gm, '');
  const markers = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"'));
  const SAMPLES = {
    seat: SET, crew: "You have joined channel 'Drake Cutlass Black : me'",
    nav: '| NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::GetStarmapRouteSegmentData|',
    armistice: 'Added notification "Entering Armistice Zone - Combat Prohibited: "', qtTarget: 'Player has selected point ArcCorp as their destination',
    session: '<Join PU> address[1] port[2] shard[pub_euw1b_13165946_031]', loaded: '<Context Establisher Done>', menu: 'CCIGBroker::FastShutdown',
    me: '<AccountLoginCharacterStatus_Character> Character: createdAt 1 - geid 2001 - name me - state STATE_CURRENT',
    emergency: 'Emergency Services are en route', incap: 'Logged an incap.! nickname: me, causes: [Bullet (35 damage)]',
    dead: "<[ActorState] Dead> Actor 'me' [1]", killed: "<Actor Death> CActor::Kill: 'me' [1]", unbind: '<Recv Unbind Batch Add Player> playerGEID=1',
    spawn: "<Spawn Flow> Player 'me' [1] lost reservation for spawnpoint", contract: 'Added notification "Contract Accepted: Bounty: " [2]',
    objective: 'Added notification "New Objective: Go to Hurston: " [3]', objectiveAt: 'MissionObjectiveMarker_754[754] - Paired with NavPoint: MISSION_QT_Yela_928306496062[9]',
    jurisdiction: 'Added notification "Entered Stanton Jurisdiction: " [1]', monitored: 'Added notification "Entered Monitored Space: "',
    crime: 'Added notification "CrimeStat Rating Increased: " [2] SHUDEvent', branch: 'Branch: sc-alpha-4.10.3', changelist: 'Changelist: 9876543',
    kill: "<Actor Death> CActor::Kill: 'a' [1] in zone 'space' killed by 'b' [2] using 'W_1' [Class unknown] with damage type 'Ballistic'",
    wreck: "<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_1' [1] advanced from destroy level 0 to 1 caused by 'x' [2]",
    qtRoute: '| AEGS_Sabre_1[1]|CSCItemNavigation::CalculateRoute|Projected Start Location is Nyx I for route to destination Keeger',
    qtArrived: '| AEGS_Sabre_1[1]|CSCItemNavigation::OnQuantumDriveArrived|', stall: '<Actor stall> Actor stall detected, Player: me, Type: downstream, Length: 3.2.',
    shard: '<Join PU> address[1] shard[pub_euw1b_13165946_031] locationId[1]',
    jump: '<Changing Solar System> Solar system changed: Client entity me [1] is changing system from Stanton to Nyx',
    refinery: 'Added notification "Refinery Work Orders have been Completed at Levski: " [4]',
    hospital: `<Corpse> Player 'me' <local client>: DoesLocationContainHospital: Searching landing zone location "Orison" for the closest hospital.`,
    stowed: '[STOWING ON UNREGISTER] Attempting to stow current vehicle [932943782879] due to landing area unregistering',
    hangarCall: "SetVehicleSpawningInformations - VehicleEntityId: [1], LandingArea: me's [Team_GameServices][ASOP]",
    hangarName: '<2026-11-17T08:00:01.123Z> XL Hangar [Team_GameServices][ASOP]', hangarGranted: 'Added notification "Hangar Request Completed: "',
    lift: '<CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [LoadingPlatformManager_ShipElevator_1] Platform state changed to OpenIdle',
    location: '<RequestLocationInventory> Player[me] requested inventory for Location[Stanton1_Lorville]',
    injury: N('Minor Injury Detected - Left arm - Tier 3 Treatment Required : '),
    medbed: '<MED BED HEAL> Actor: me (Non-Authoritative CLIENT: me) | [CEntityComponentMedBed::HandleComponentEvent:1101] | -> Perform surgery event Success, med bed name: Bed_Single_Medical_Cutlass',
    hangarQueue: N('Joined hangar queue. Your place: 3. Max. estimated wait: 120: '), restricted: N('Restricted Area: '),
    privateProperty: N('Entering Private Property: '), impounded: N('Vehicle Impounded: Drake Cutlass Black: '), lowFuel: N('Low Fuel: '),
    disconnect: '<Channel Disconnected> cause=30000 reason="Connection timed out" frame=1 isRemote=0 gamerules="SC_Default"',
    popup: '<Error Popup Opened> errorCode=30000', crash: 'Cloud Imperium Games public crash handler taking over...',
    partyMember: N('Party NovaRider connected.: '), partyInvite: N('NovaRider Party Invite Received: Accept Invitation?: '),
    partyQt: N('NovaRider has started to QT to your current location: '), partyCalib: N('Quantum Travel Calibration Started By NovaRider: '),
    partyIn: N('You have joined party: '),
  };
  for (const [name, re] of Object.entries(PATTERNS)) {
    const line = SAMPLES[name];
    assert.ok(line, `no sample for pattern ${name}`);
    assert.match(line, re, name);
    assert.ok(markers.some(m => line.includes(m)), `${name}: the Rust filter drops "${line}"`);
  }
});

test('a broken angled render falls back to the store image', async () => {
  const tried = [];
  const media = { angledView: { mediumUrl: 'a-med', url: 'a' }, storeImage: { mediumUrl: 's-med', url: 's' } };
  const fake = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:ok' }) };
  globalThis.document = fake;
  try {
    const load = async u => { tried.push(u); if (u.startsWith('a')) throw new Error('xml'); return { naturalWidth: 800, naturalHeight: 400 }; };
    assert.equal(await shot({ media }, load), 'data:ok');
    assert.deepEqual(tried, ['a-med', 'a', 's-med']);
    assert.equal(await shot({ media: {} }, load), null);
    await assert.rejects(shot({ media: { angledView: { url: 'a' } } }, load));
  } finally { delete globalThis.document; }
});

// A whole 4.10 session, as the Rust filter passed it on (see replays_a_recorded_session in
// game.rs), replayed through the parser: the state at points along the way and at the end.
test('replays a 4.10 session from the filtered Game.log', () => {
  const lines = readFileSync(new URL('./fixtures/game-4.10.filtered.log', import.meta.url), 'utf8').split('\n').filter(Boolean);
  const upTo = mark => {
    const end = lines.findIndex(l => l.includes(mark));
    assert.ok(end >= 0, `the filter dropped "${mark}"`);
    return lines.slice(0, end + 1).map(parseLine).filter(Boolean).reduce(reduce, EMPTY);
  };
  let s = upTo('Context Establisher Done');
  assert.equal(s.menu, false);
  assert.equal(s.me?.name, 'Argoneth');
  assert.equal(version(s.build.branch), '4.10.3');
  s = upTo('Platform state changed to OpenIdle');
  assert.equal(s.armistice, true);
  assert.equal(s.hangar?.lift, 'up');
  s = upTo('GetStarmapRouteSegmentData');
  assert.equal(s.seated, true);
  assert.equal(s.ship, 'AEGS_Sabre_Firebird');
  s = upTo('OnQuantumDriveArrived');
  assert.equal(s.qtArrived, 'Yela');
  assert.equal(s.mission?.target, 'Yela');
  s = upTo('Low Fuel');
  assert.equal(s.lowFuel, true);
  assert.deepEqual(s.partyEv, { what: 'online', who: 'NovaRider', n: 1 }, 'a notice over three lines, joined by the Rust filter');
  s = lines.map(parseLine).filter(Boolean).reduce(reduce, EMPTY);
  assert.equal(s.lowFuel, false, 'gone with the ship');
  assert.deepEqual(s.injuries, [{ limb: 'right leg', tier: 3, severity: 'minor' }]);
  assert.equal(s.kills, 3);
  assert.equal(s.system, 'Pyro');
  assert.deepEqual(s.jump, { from: 'Stanton', to: 'Pyro' });
  assert.equal(s.wrecked, 2);
  assert.equal(s.downedBy?.by, 'Kaboos_Raider');
  assert.equal(s.downedBy?.hospital, 'Checkmate');
  assert.equal(s.refinery?.place, 'Ruin Station');
  assert.equal(s.lag?.len, 3.2);
  assert.equal(s.shard, 'pub_euw1b_13165946_031');
  assert.equal(s.location, 'RR_P6_LEO_Ruin_Station');
});

test('patch watch: lines every session logs, and boarding once ship keys go out', async () => {
  const { missingLines, WATCH_MS, WATCH_KEYS } = await import('../ui/lib/gamelog.js');
  const w = (kinds, loadedAt = 0, shipKeys = 0) => ({ kinds: new Set(kinds), loadedAt, shipKeys });
  assert.deepEqual(missingLines(w(['loaded'], 1000), 1000 + WATCH_MS - 1), [], 'too early to say');
  assert.deepEqual(missingLines(w(['loaded'], 1000), 1000 + WATCH_MS + 1), ['your character', 'joining a server']);
  assert.deepEqual(missingLines(w(['loaded', 'me', 'session'], 1000), 1e9), []);
  assert.deepEqual(missingLines(w(['loaded', 'me', 'session'], 1000, WATCH_KEYS), 1e9), ['boarding a ship']);
  assert.deepEqual(missingLines(w(['loaded', 'me', 'session', 'seat'], 1000, 99), 1e9), []);
  // The replayed 4.10 session has everything.
  const lines = readFileSync(new URL('./fixtures/game-4.10.filtered.log', import.meta.url), 'utf8').split('\n').map(parseLine).filter(Boolean);
  assert.deepEqual(missingLines(w(lines.map(e => e.type), 1, 50), 1e9), []);
});

// ---------- World page ----------
import * as W from '../ui/lib/world.js';
const MARKET = JSON.parse(readFileSync(new URL('./fixtures/world-market.json', import.meta.url), 'utf8'));
const MIN = 60_000;

test('executive hangar cycle: phases, lights and windows', () => {
  const t0 = Date.UTC(2026, 10, 18, 8, 0);
  assert.equal(W.CYCLE_MIN, 185);
  let x = W.hangarAt(t0, t0 + 30 * MIN);
  assert.deepEqual([x.phase, x.lights.join('')], ['charging', 'grrrr']);
  assert.equal(x.changes, t0 + 48 * MIN);
  assert.equal(x.ends, t0 + 120 * MIN);
  assert.deepEqual(x.windows[0], [t0 + 120 * MIN, t0 + 180 * MIN]);
  x = W.hangarAt(t0, t0 + 157 * MIN);
  assert.deepEqual([x.phase, x.lights.join('')], ['open', 'gg']);
  assert.equal(x.ends, t0 + 180 * MIN);
  // While open, the next opening is the next cycle's.
  assert.deepEqual(x.windows[0], [t0 + 305 * MIN, t0 + 365 * MIN]);
  x = W.hangarAt(t0, t0 + 182 * MIN);
  assert.deepEqual([x.phase, x.lights.join('')], ['reset', '']);
  assert.equal(W.hangarAt(t0, t0 + 185 * MIN).state, 'c0');
  // Before the sync too: the cycle runs both ways.
  assert.equal(W.hangarAt(t0, t0 - 65 * MIN).phase, 'open');
});

test('executive hangar sync: every light state, and patches undo it', () => {
  const now = Date.UTC(2026, 10, 18, 10, 0);
  for (const s of W.LIGHT_STATES) assert.equal(W.hangarAt(W.syncAt(s.id, now).start, now).state, s.id);
  assert.equal(W.LIGHT_STATES.length, 11);
  const s = { ...W.syncAt('o3', now), build: 'sc-alpha-4.10.3' };
  assert.equal(W.syncValid(s, 'sc-alpha-4.10.3'), true);
  assert.equal(W.syncValid(s, 'sc-alpha-4.11.0'), false);
  assert.equal(W.syncValid(s, null), true);
  assert.equal(W.syncValid(null, 'x'), false);
});

test('own timers and the vault door', () => {
  const t = 1_000_000_000_000;
  const red = W.TIMERS.find(d => d.id === 'red'), vault = W.TIMERS.find(d => d.id === 'vault');
  assert.deepEqual(W.timerAt(red, null, t), { running: false });
  assert.equal(W.timerAt(red, { started: t, mins: 30 }, t + 12 * MIN).left, 18 * MIN);
  assert.equal(W.timerAt(red, { started: t, mins: 30 }, t + 30 * MIN).done, true);
  let v = W.timerAt(vault, { started: t }, t + 14 * MIN);
  assert.deepEqual([v.open, v.left], [false, 6 * MIN]);
  v = W.timerAt(vault, { started: t }, t + 20.5 * MIN);
  assert.deepEqual([v.open, v.next], [true, t + 21 * MIN]);
  assert.equal(W.timerAt(vault, { started: t }, t + 22 * MIN).open, false);
  assert.deepEqual([W.inMinutes(30_000), W.inMinutes(60_000), W.inMinutes(6 * MIN - 1), W.inMinutes(72 * MIN), W.inMinutes(120 * MIN)],
    ['under a minute', '1 min', '6 min', '1 h 12 min', '2 h']);
});

test('Game.log places find their UEX trade place', () => {
  const name = (id, sys) => { const i = W.placeFor(MARKET, id, sys); return i < 0 ? null : MARKET.places[i].name; };
  assert.equal(name('Stanton3_Area18', 'Pyro'), 'Area 18'); // the id's own system wins
  assert.equal(name('RR_ARC_L1', 'Stanton'), 'ARC-L1 Wide Forest Station');
  assert.equal(name('RR_HUR_LEO', 'Stanton'), 'Everus Harbor');
  assert.equal(name('RR_P6_LEO_Ruin_Station', 'Pyro'), 'Ruin Station');
  assert.equal(name('RR_P5_L4', 'Pyro'), "Rod's Fuel 'N Supplies");
  assert.equal(name('Stanton2b_GrimHex', 'Stanton'), 'Green Imperial Housing Exchange');
  assert.equal(name('Nyx_Delamar_Levski', 'Nyx'), 'Levski');
  assert.equal(name('Stanton1_Lorville', 'Stanton'), null); // not in the fixture: nothing, not a neighbour
  assert.equal(name(null, 'Stanton'), null);
  const ruin = W.placeFor(MARKET, 'RR_P6_LEO_Ruin_Station', 'Pyro');
  assert.deepEqual(W.nearby(MARKET, ruin).map(i => MARKET.places[i].name).sort(), ['Last Landings', 'Megumi Refueling', 'Ruin Station']);
});

test('trade rows: buy here, sell where it pays most, best profit first', () => {
  const a18 = W.placeFor(MARKET, 'Stanton3_Area18', 'Stanton');
  for (const side of ['buy', 'sell']) {
    const rows = W.tradeRows(MARKET, [a18], side, 'Stanton');
    assert.ok(rows.length > 3);
    for (const r of rows) {
      assert.equal(r.here.place, a18);
      if (r.other) {
        assert.notEqual(r.other.place, a18);
        assert.equal(r.profit, side === 'buy' ? r.other.price - r.here.price : r.here.price - r.other.price);
      } else assert.equal(r.profit, null);
    }
    const p = rows.map(r => r.profit ?? -Infinity);
    assert.deepEqual(p, [...p].sort((a, b) => b - a));
  }
  const gold = W.whereTo(MARKET, 'Gold', 'Stanton');
  assert.ok(gold.buy.length && gold.sell.length);
  assert.ok(gold.buy.every((x, i, a) => !i || a[i - 1].price <= x.price));
  assert.ok(gold.sell.every((x, i, a) => !i || a[i - 1].price >= x.price));
});

test('place unknown: best trades in the system; stock as reported', () => {
  const rows = W.routes(MARKET, 'Stanton');
  assert.ok(rows.length > 3);
  for (const r of rows) {
    assert.notEqual(r.here.place, r.other.place);
    assert.equal(MARKET.places[r.here.place].system, 'Stanton');
    assert.equal(r.profit, r.other.price - r.here.price);
    assert.ok(r.profit > 0);
  }
  assert.deepEqual(rows.map(r => r.profit), rows.map(r => r.profit).sort((a, b) => b - a));
  assert.deepEqual(W.stockText({ scu: 1200 }), { text: '1,200 SCU in stock', low: false });
  assert.deepEqual(W.stockText({ scu: 6 }), { text: '6 SCU in stock', low: true });
  assert.deepEqual(W.stockText({ status: 1 }), { text: 'Stock empty', low: false });
  assert.deepEqual(W.stockText({ status: 7 }), { text: 'Stock full', low: true });
  assert.equal(W.stockText({ scu: 0, status: 0 }), null);
});

test('the hangar lift names the place', () => {
  const lift = (id, st = 'RaisingPlatform') => parseLine(`<2026-11-16T19:04:43.026Z> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_${id}] Platform state changed to ${st} [Team_CoreGameplayFeatures][Cargo]`);
  assert.deepEqual(lift('HangarMediumTop_Area18'), { type: 'lift', to: 'rising', place: 'Area18' });
  assert.equal(lift('HangarXLTop_Nyx').place, null); // only the system
  assert.equal(W.placeFor(MARKET, 'Area18', 'Stanton') >= 0 && MARKET.places[W.placeFor(MARKET, 'Area18', 'Stanton')].name, 'Area 18');
});

test('find: kind chips and letters', () => {
  const metals = W.findList(MARKET, 'Stanton', { chip: 'Metals' });
  assert.ok(metals.includes('Gold') && !metals.includes('Stims'));
  assert.ok(W.findList(MARKET, 'Stanton', { letter: 'G' }).every(n => n.startsWith('G')));
  assert.deepEqual(W.letters(MARKET, 'Stanton'), [...new Set(W.findList(MARKET, 'Stanton').map(n => n[0].toUpperCase()))].sort());
  const now = 1_800_000_000_000;
  assert.deepEqual(W.age(now / 1000 - 1500, now), { text: '25 min ago', old: false });
  assert.deepEqual(W.age(now / 1000 - 5 * 3600, now), { text: '5 h ago', old: false });
  assert.deepEqual(W.age(now / 1000 - 3 * 86400, now), { text: '3 days ago', old: true });
});

// HUD notices and lines from 4.x logs (sc-log-tracker's samples from 238 real sessions).
test('injuries, the med bed, hangar queue, restricted areas, low fuel, drops and the party', async () => {
  const { parseLine, reduce, EMPTY, alertsFor, logFor, hangarText, droppedText, worstInjury } = await import('../ui/lib/gamelog.js');
  const run = (s, lines) => lines.reduce((g, l) => { const ev = parseLine(l); return ev ? reduce(g, ev) : g; }, s);
  let g = { ...EMPTY, menu: false, me: { name: 'me', geid: '1' }, seated: true, ship: 'DRAK_Cutlass_Black' };
  const a = g;
  g = run(g, [N('Minor Injury Detected - Left arm - Tier 3 Treatment Required : '), N('Major Injury Detected - Torso - Tier 2 Treatment Required : ')]);
  assert.equal(g.injuries.length, 2);
  assert.deepEqual(worstInjury(g.injuries), { limb: 'torso', tier: 2, severity: 'major' });
  assert.deepEqual(logFor(a, g).map(e => e.text), ['Minor injury · left arm · tier 3', 'Major injury · torso · tier 2']);
  // The same injury again is no new one.
  assert.equal(run(g, [N('Minor Injury Detected - Left arm - Tier 3 Treatment Required : ')]).hurt, 2);
  const healed = run(g, ['<MED BED HEAL> Actor: someone (x) | -> Perform surgery event Success']);
  assert.equal(healed.injuries.length, 2, 'another player in a med bed');
  assert.deepEqual(run(g, ['<MED BED HEAL> Actor: me (x) | -> Perform surgery event Success']).injuries, []);

  const q = run(g, [N('Joined hangar queue. Your place: 3. Max. estimated wait: 120: ')]);
  assert.equal(hangarText(q), 'Queue 3rd · ≤ 2 min');
  assert.equal(run(q, [N('Hangar Request Completed: ')]).hangar.status, 'granted');

  const r = run(g, [N('Restricted Area: ')]);
  assert.ok(alertsFor(g, r).some(e => e.kind === 'restricted'));
  assert.equal(run(r, [N('Leaving Restricted Area: ')]).restricted, false);
  const f = run(g, [N('Low Fuel: ')]);
  assert.ok(f.lowFuel);
  assert.equal(run(f, ["Added notification \"You have left the channel 'Drake Cutlass Black : me'.: \" [2]"]).lowFuel, false, 'leaving the seat clears it');

  // Leaving by yourself shows nothing; a timeout does, at the menu too, until you are back in.
  assert.equal(parseLine('<Channel Disconnected> cause=30016 reason="DisconnectCmd: disconnect light ExitToMenu" isRemote=0 gamerules="SC_Default"'), null);
  assert.equal(parseLine('<Channel Disconnected> cause=30000 reason="x" isRemote=0 gamerules="SC_Frontend"'), null);
  const d = run(g, ['<Channel Disconnected> cause=30000 reason="x" isRemote=0 gamerules="SC_Default"', 'CCIGBroker::FastShutdown']);
  assert.ok(d.menu);
  assert.equal(droppedText(d.dropped), 'Disconnected · connection timed out');
  assert.equal(run(d, ['<Context Establisher Done>']).dropped, null);
  const c = run(g, ['Cloud Imperium Games public crash handler taking over...', 'Exception STATUS_CRYENGINE_GPU_CRASH(0x2BADFF60) addr=0x0']);
  assert.equal(droppedText(c.dropped), 'Game crashed · graphics driver crash');

  const p = run(g, [N('NovaRider Party Invite Received: Accept Invitation?: '), N('Quantum Travel Calibration Started By NovaRider: ')]);
  assert.deepEqual(p.party, { calibrating: 'NovaRider' });
  const p2 = run(p, [N('Quantum Travel Calibration Complete By NovaRider: ')]);
  assert.equal(p2.party, null);
  assert.deepEqual(alertsFor(p, p2).map(e => e.text), ['Party jump calibrated']);
});
