// The link to the Rust side. Outside the app (a browser preview) it falls back to a
// stand-in that logs keys and can play a short demo of Game.log lines.

const tauri = window.__TAURI__;

export const inApp = !!tauri;

let sent = null;
/** f(now) once each key has gone down, for the performance overlay. */
export const onKeySent = f => { sent = f; };

export async function sendKey(spec, mode, ms, anywhere) {
  if (!tauri) { (window.__keys ||= []).push({ spec, mode, t: performance.now() }); sent?.(performance.now()); return; }
  await tauri.core.invoke('key', { spec, mode, ms: ms ?? null, anywhere });
  // A tap answers after its key is back up: take the hold (as the app clamps it) off to time the press.
  sent?.(performance.now() - (mode === 'tap' ? Math.min(5000, Math.max(30, ms ?? 60)) : 0));
}
// Outside the app (UI tests, mocks) a page may supply its own readings.
export const perf = () => tauri ? tauri.core.invoke('perf') : window.xfdTestPerf ? Promise.resolve(window.xfdTestPerf) : Promise.reject(new Error('Only in the app'));

export async function wheel(clicks, anywhere) {
  if (!tauri) { (window.__keys ||= []).push({ wheel: clicks, t: performance.now() }); return; }
  return tauri.core.invoke('wheel', { clicks, anywhere });
}

export const releaseKeys = () => tauri?.core.invoke('release_keys');
const demoOn = !!new URLSearchParams(location.search).get('demo');
export const gameInfo = () => tauri ? tauri.core.invoke('game_info') : Promise.resolve({ channel: demoOn ? 'LIVE' : null, elevated: false, focused: demoOn, running: demoOn, log: demoOn, game_elevated: null });
export const userShips = () => tauri ? tauri.core.invoke('user_ships') : Promise.resolve(null);
// Outside the app (UI tests, mocks) a page may supply its own actionmaps.xml.
export const readBinds = () => tauri ? tauri.core.invoke('read_binds') : Promise.resolve(window.xfdTestBinds ?? null);
export const installBinds = () => tauri ? tauri.core.invoke('install_binds') : Promise.reject(new Error('Only in the app'));
const onlyInApp = () => Promise.reject(new Error('Only in the app'));
export const saveProfile = json => tauri ? tauri.core.invoke('save_profile', { json }) : onlyInApp();
export const loadProfile = () => tauri ? tauri.core.invoke('load_profile') : Promise.resolve(null);
export const saveUserShips = json => tauri ? tauri.core.invoke('save_user_ships', { json }) : onlyInApp();
export const installProfileBinds = xml => tauri ? tauri.core.invoke('install_profile_binds', { xml }) : onlyInApp();
export const runAsAdmin = () => tauri?.core.invoke('run_as_admin');
export const getPrefs = () => tauri ? tauri.core.invoke('get_prefs') : Promise.resolve({ autostart: true, screen_off: true, backlight: null, version: '0.4.0' });
export const setPref = (name, value) => tauri?.core.invoke('set_pref', { name, value });
export const wakeScreen = () => tauri?.core.invoke('wake_screen');
export const sleepScreen = () => tauri?.core.invoke('sleep_screen');
export const checkUpdate = () => tauri ? tauri.core.invoke('check_update') : Promise.resolve(null);
export const installUpdate = () => tauri.core.invoke('install_update');
// Outside the app (UI tests, mocks) a page may supply its own displays.
export const displays = () => tauri ? tauri.core.invoke('displays') : Promise.resolve(window.xfdTestDisplays ?? { list: [], picked: null, current: null, touch_ok: true });
export const setDisplay = id => tauri ? tauri.core.invoke('set_display', { id }) : Promise.resolve(window.xfdTestDisplays && (window.xfdTestDisplays.picked = id));
export const fixTouch = () => tauri ? tauri.core.invoke('fix_touch') : onlyInApp();
/** f() when displays are added, removed or change resolution. */
export const onDisplays = f => tauri?.event.listen('displays', () => f());
/** onScreen(dark) when the screen goes off or wakes. */
export const onScreen = f => tauri?.event.listen('screen', e => f(e.payload));
/** Opens a new GitHub issue for the app in the browser, with a title and body filled in. */
export const reportIssue = (title, body) => tauri ? tauri.core.invoke('report_issue', { title, body }) : Promise.resolve(window.xfdReported = { title, body });
export const quit = () => tauri ? tauri.core.invoke('quit') : window.close();

/** onBatch({ lines, live, reset }) for each batch of Game.log lines. */
export function onGameLog(onBatch) {
  if (tauri) return tauri.event.listen('game-log', e => onBatch(e.payload)).then(() => tauri.core.invoke('ui_ready'));
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) setTimeout(() => onBatch({ lines: DEMO[demo] || DEMO.ship, live: true, reset: true }), 50);
}

// A session for the Log page, with the game log's own time stamps.
const T = (hm, rest) => `<2026-11-17T${hm}:00.000Z> ${rest}`;
const LOG_DEMO = [
  T('18:05', '[Notice] <Join PU> address[10.0.0.1] port[64090] shard[pub_euw1b_13165946_031] locationId[1]'),
  T('18:05', '<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name Argoneth - state STATE_CURRENT'),
  T('18:06', '<Context Establisher Done>'),
  T('18:40', 'Added notification "Refinery Work Orders have been Completed at Levski: " [4]'),
  T('19:02', '[Notice] | NOT AUTH | DRAK_Cutlass_Black_771690342710[771690342710]|CSCItemNavigation::GetStarmapRouteSegmentData|'),
  T('19:12', '<Changing Solar System> Solar system changed: Client entity Argoneth [2001] is changing system from Stanton to Nyx'),
  T('19:44', "<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'DRAK_Cutlass_Black_771690342710' [771690342710] in zone 'space' driven by 'Argoneth' [2001] advanced from destroy level 0 to 2 caused by 'Kaboos_Raider' [3]"),
  T('19:44', "<Actor Death> CActor::Kill: 'Argoneth' [2001] in zone 'space' killed by 'Kaboos_Raider' [3] using 'KLWE_LaserRepeater_S3_4411' [Class unknown] with damage type 'Ballistic'"),
  T('19:44', "<[ActorState] Dead> [ACTOR STATE][SSCActorStateCVars::LogActorState] Player 'Argoneth' [2001] ejected from zone 'DRAK_Cutlass_Black_771690342710' [771690342710] to zone 'space' due to destroyed vehicle. Actor 'Argoneth' [2001]"),
  T('19:52', `<Corpse> Player 'Argoneth' <local client>: DoesLocationContainHospital: Searching landing zone location "Orison" for the closest hospital.`),
  T('19:52', '<Recv Unbind Batch Add Player> playerGEID=2001'),
  T('20:05', '[Notice] | NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::GetStarmapRouteSegmentData|'),
  T('20:06', '[Notice] | NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::CalculateRoute|Projected Start Location is Nyx I for route to destination Keeger'),
  T('20:09', '[Notice] | NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::OnQuantumDriveArrived|'),
  T('20:10', '<Actor stall> Actor stall detected, Player: Argoneth, Type: downstream, Length: 3.2.'),
];

const DEMO = {
  ship: [
    'Branch: sc-alpha-4.10.3',
    '<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name pilot - state STATE_CURRENT',
    '<Context Establisher Done>',
    'Added notification "Entered Stanton Jurisdiction: " [1]',
    'Added notification "Contract Accepted: Eliminate All Hostiles <EM4>[BP]</EM4> <EM4>[2,500 Rep]</EM4>: " [2]',
    'Added notification "New Objective: Destroy the hostile ships near Yela (3/6): " [3]',
    'MissionObjectiveMarker_754[754] - Paired with NavPoint: MISSION_QT_Yela_928306496062[928306496062]',
    "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'AEGS_Gladius_123456' [123456]",
    'Player has selected point ArcCorp_Mining_Area_045 as their destination',
    "<Actor Death> CActor::Kill: 'PU_Pilot_Enemy_77' [77] in zone 'space' killed by 'pilot' [2001] using 'AEGS_Gladius_123456' [Class unknown]",
  ],
  foot: ['<Context Establisher Done>', 'Entering Armistice Zone'],
  log: LOG_DEMO,
  nyx: ['<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name Argoneth - state STATE_CURRENT',
    '<Context Establisher Done>', 'Added notification "Entered Ungoverned Jurisdiction: " [1]',
    '<RequestLocationInventory> Player[Argoneth] requested inventory for Location[AsteroidClusterBase_Nyx_Social_Keeger_001]'],
  armistice: ['<Context Establisher Done>', "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'DRAK_Cutlass_Black_1' [1]", 'Entering Armistice Zone',
    'Added notification "Entered Stanton Jurisdiction: " [1]'],
  alert: ['<Context Establisher Done>', "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'ANVL_Hornet_F7C_Mk2_1' [1]",
    'Added notification "Entered Pyro Jurisdiction: " [1]', 'Added notification "CrimeStat Rating Increased: " [2] SHUDEvent', 'Player has selected point Ruin_Station as their destination'],
  downed: ['<Context Establisher Done>', 'Emergency Services are en route'],
  disabled: ['<Context Establisher Done>', "CVehicleMovementBase::SetDriver: Local client node [1] granted control token for 'ANVL_Hornet_F7C_Mk2_1' [1]",
    "<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Hornet_F7C_Mk2_1' [1] in zone 'space' driven by 'pilot' [2] advanced from destroy level 0 to 1 caused by 'PU_Pilot_Enemy_77' [77]"],
  hangar: ['<AccountLoginCharacterStatus_Character> Character: createdAt 1 - updatedAt 1 - geid 2001 - accountId 1 - name Argoneth - state STATE_CURRENT',
    '<Context Establisher Done>', 'Entering Armistice Zone', '<RequestLocationInventory> Player[Argoneth] requested inventory for Location[AsteroidClusterBase_Nyx_Social_Keeger_001]',
    "<x> [Notice] <CEntityComponentShipListProvider::SetVehicleSpawningInformations> SetVehicleSpawningInformations - VehicleEntityId: [1], LandingArea: Argoneth's",
    '<x> XL Hangar [Team_GameServices][ASOP]',
    '<x> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarXLTop_Nyx] Platform state changed to RaisingPlatform [Team_CoreGameplayFeatures][Cargo]',
    '<x> [Notice] <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarXLTop_Nyx] Platform state changed to OpenIdle [Team_CoreGameplayFeatures][Cargo]'],
};
