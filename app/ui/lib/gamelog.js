// Read Star Citizen's Game.log: which ship's pilot seat you are in, armistice zones,
// the quantum destination, going down and respawning, and the menu or loading
// screen. The game logs nothing about landing gear, gimbals, weapons or the
// quantum drive itself, so those keys show what you last pressed.
//
// The death and respawn lines change from patch to patch. These follow what
// community log readers see in 4.x builds; any line that names a player is only
// counted when it names you.

export const PATTERNS = {
  // CVehicleMovementBase::SetDriver: Local client node [204721322607] granted control token for 'DRAK_Clipper_771690342710' [771690342710]
  seat: /CVehicleMovementBase::(SetDriver|ClearDriver):.*?control token for '([^']+)'/,
  // 4.10 no longer logs SetDriver when you sit down, but the ship's crew channel says you
  // boarded: Added notification "You have joined channel 'Aegis Sabre Firebird : Argoneth'.
  crew: /You have (joined|left) (?:the )?channel '(.+?) : [^']+'/,
  // The ship's navigation, while you fly it: ... | NOT AUTH | AEGS_Sabre_Firebird_932943782879[932943782879]|CSCItemNavigation::GetStarmapRouteSegmentData|
  nav: /\| ([A-Z]{3,5}_\w+?)_\d{6,}\[\d+\]\|CSCItemNavigation::GetStarmapRouteSegmentData/,
  armistice: /\b(Entering|Leaving) Armistice Zone\b/,
  qtTarget: /Player has selected point (\S+) as their destination/,
  // A new session starts loading with Join PU, and is in the game once loaded.
  session: /<Join PU>|\{Join PU\}/,
  loaded: /<Context Establisher Done>|Loading screen for \S+ : \S+ closed after/,
  menu: /CCIGBroker::FastShutdown|Disconnecting from \w+\b|\bSystemQuit\b/,
  // <AccountLoginCharacterStatus_Character> Character: ... geid 201990709919 - ... - name space-man-rob - ...
  me: /<AccountLoginCharacterStatus_Character>.*?\bgeid (\d+).*?\bname ([\w-]+)/,
  // HUD notice that only the local player gets.
  emergency: /Emergency Services.*en route/i,
  incap: /Logged an incap\.! nickname: ([^,]+),/,
  dead: /<\[ActorState\] Dead>.*?Actor '([^']+)'/,
  killed: /<Actor Death>.*?CActor::Kill: '([^']+)'/,
  // The old body is unbound when you respawn.
  unbind: /<Recv Unbind Batch Add Player>.*?playerGEID=(\d+)/,
  spawn: /<Spawn Flow>.*?Player '([^']+)'.*?lost reservation for spawnpoint/,
  // HUD notifications, e.g. Added notification "New Objective: Go to Hurston: " [12]. The same
  // notice is repeated on UpdateNotificationItem lines, which are skipped.
  contract: /"Contract (Accepted|Complete|Failed|Withdrawn):\s*(.*?):?\s*"/,
  objective: /"(New Objective|Objective Complete|Objective Withdrawn):\s*(.*?):?\s*"/,
  // Where the objective marker points, e.g. Paired with NavPoint: MISSION_QT_Kaboos_928306496062[...]
  objectiveAt: /Paired with NavPoint: (?:MISSION_)?(?:QT_)?(.+?)_\d+\[/,
  jurisdiction: /"Entered (.+?) Jurisdiction/,
  monitored: /\b(Entered|Exited) Monitored Space\b|\bMonitored Space (Down|Restored)\b/,
  crime: /CrimeStat(?: Rating)?\s*(Increased|Decreased|Cleared|Removed|Lost)?\D{0,12}(\d)?/i,
  // The build, near the top of every log: Branch: sc-alpha-4.3.2 and Changelist: 9876543
  branch: /^\s*Branch:\s*(sc-alpha-\S+)/i,
  changelist: /^\s*Changelist:\s*(\d+)/,
  // <Actor Death> CActor::Kill: 'victim' [id] in zone 'zone' killed by 'killer' [id] using 'weapon' ...
  kill: /<Actor Death> CActor::Kill: '([^']+)' \[\d+\] in zone '[^']*' killed by '([^']+)'(?: \[\d+\] using '([^']+)'(?: \[Class [^\]]*\])?(?: with damage type '(\w+)')?)?/,
  // <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_123' [123] ... driven by 'me' [1] advanced from destroy level 0 to 1 caused by 'them' ...
  wreck: /<Vehicle Destruction>.*?Vehicle '([^']+)'.*?advanced from destroy level (\d) to (\d)(?: caused by '([^']+)')?/,
  // Quantum: CSCItemNavigation::CalculateRoute|Projected Start Location is Stanton Gateway for route to destination pyro3 ...
  qtRoute: /\|CSCItemNavigation::CalculateRoute\|Projected Start Location is (.+?) for route to destination (\S+)/,
  qtArrived: /\|CSCItemNavigation::OnQuantumDriveArrived/,
  // <Actor stall> Actor stall detected, Player: me, Type: downstream, Length: 2.345.
  stall: /<Actor stall> Actor stall detected, Player: ([\w-]+), Type: (?:up|down)stream, Length: (\d+(?:\.\d+)?)/,
  // <Join PU> address[...] port[...] shard[pub_euw1b_13165946_150] locationId[...]
  shard: /<Join PU>.*?shard\[([^\]]+)\]/,
  // <Changing Solar System> ... Client entity me [1] ... changing system from Stanton to Pyro
  jump: /<Changing Solar System>.*? Client entity ([\w-]+) .*?changing system from (\w+) to (\w+)/,
  // Added notification "Refinery Work Orders have been Completed at ARC-L1 Wide Forest Station: "
  refinery: /"(?:(?:A|\d+) )?Refinery Work Orders? (?:has|have) been Completed at ([^:"]+)/,
  // <Corpse> Player 'me' <local client>: DoesLocationContainHospital: Searching landing zone location "Orison" for the closest hospital.
  hospital: /Player '([\w-]+)' <(?:remote|local) client>: DoesLocationContainHospital: Searching landing zone location "([^"]*)" for the closest hospital/,
  // A ship stowed as its pad or hangar unloads: Attempting to stow current vehicle [938763553539] due to landing area unregistering.
  stowed: /\[STOWING ON UNREGISTER\].*?stow current vehicle \[(\d+)\]/,
  // <RequestLocationInventory> Player[me] requested inventory for Location[Stanton1_Lorville]
  // Hangars. A ship called at a fleet terminal: SetVehicleSpawningInformations - VehicleEntityId: [1], LandingArea: me's
  // with the rest of the name on the next line: <time> XL Hangar [Team_GameServices][ASOP]
  hangarCall: /SetVehicleSpawningInformations - VehicleEntityId: \[\d+\], LandingArea: (.*?)\s*(?:\[Team_\w+\].*)?$/,
  hangarName: /^<[^>]+> ([^<>\["]+?) \[Team_GameServices\]\[ASOP\]\s*$/,
  // Landing clearance from ATC: Added notification "Hangar Request Completed: "
  hangarGranted: /"Hangar Request Completed/,
  // The hangar's ship lift: Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarXLTop_Nyx] Platform state changed to RaisingPlatform
  lift: /<CSCLoadingPlatformManager::OnLoadingPlatformStateChanged>.*?\[LoadingPlatformManager_ShipElevator_([^\]]*)\] Platform state changed to (\w+)/,
  location: /<RequestLocationInventory> Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]/,
  // HUD notices that only you get. Notices over several lines reach the console joined into one.
  // Added notification "Minor Injury Detected - Left arm - Tier 3 Treatment Required : " [26]
  injury: /"(Minor|Moderate|Major|Severe) Injury Detected - (.+?) - Tier (\d)/i,
  // <MED BED HEAL> Actor: me (...) | ... -> Perform surgery event Success, med bed name: ..., vehicle name: @vehicle_NameDRAK_Cutlass_Red, ...
  medbed: /<MED BED HEAL> Actor: ([\w-]+).*?surgery event Success/,
  // Added notification "Joined hangar queue. Your place: 3. Max. estimated wait: 120: " [9]
  hangarQueue: /"Joined hangar queue\. Your place: (\d+)\. Max\. estimated wait: (\d+(?:\.\d+)?)/,
  restricted: /"(Leaving )?Restricted Area\b/,
  privateProperty: /"(Entering|Leaving) Private Property\b/,
  impounded: /"Vehicle Impounded\b/,
  lowFuel: /"Low Fuel\b/,
  // Why a session ended: <Channel Disconnected> cause=30000 reason="..." ... gamerules="SC_Default"
  disconnect: /<Channel Disconnected> cause=(\d+) reason="([^"]*)"/,
  popup: /Error Popup Opened> errorCode=(\d+)/,
  crash: /crash handler taking over|^\s*Exception ((?:STATUS|EXCEPTION)_\w+)\(/,
  // The party: Added notification "Party Name connected.: ", "Name Party Invite Received: ...",
  // "Name has started to QT to your current location", "Quantum Travel Calibration Started By Name: ".
  partyMember: /"Party ([\w-]+) (connected|disconnected)\./,
  partyInvite: /"([\w-]+) Party Invite Received/,
  partyQt: /"([\w-]+) has started to QT to your current location/,
  partyCalib: /"Quantum Travel Calibration (Started|Complete) By ?([\w-]*)/,
  partyIn: /"(You have joined party|You have created party|You have left the party|You have been kicked from the party|Party Disbanded)/,
};

// What the game's network and crash codes mean, from community log readers (sc-log-tracker).
export const DROP_CODES = {
  30000: 'connection timed out', 30013: 'the server crashed', 30015: 'signed in somewhere else', 30024: 'game services stopped answering',
  30028: 'idle too long', 41045: 'timed out joining', 41058: 'player lookup failed', 41070: 'timed out loading your character',
  64004: 'server could not place you', 64008: 'server could not place you', 64010: 'location lookup timed out',
  67001: 'server database unreachable', 70003: 'sign-in timed out', 70006: 'game files failed the check',
};
export const CRASH_KINDS = {
  STATUS_CRYENGINE_GPU_CRASH: 'graphics driver crash', STATUS_CRYENGINE_OUT_OF_SYSMEM: 'out of memory',
  STATUS_CRYENGINE_WATCH_DOG: 'the game hung', EXCEPTION_ACCESS_VIOLATION: 'game bug', EXCEPTION_BREAKPOINT: 'game bug',
  STATUS_CRYENGINE_FATAL_ERROR: 'fatal engine error',
};

/** Game builds this panel was tested on. A different major version shows an "untested" badge. */
export const TESTED_MAJOR = 4;

/** 'DRAK_Clipper_771690342710' -> 'DRAK_Clipper' */
export const shipModel = entity => entity.replace(/_\d+$/, '');

// Maker names in crew channels, to the codes ship classes start with.
const MAKER_CODES = { aegis: 'AEGS', anvil: 'ANVL', drake: 'DRAK', misc: 'MISC', rsi: 'RSI', origin: 'ORIG', crusader: 'CRUS', argo: 'ARGO',
  consolidated: 'CNOU', esperia: 'ESPR', kruger: 'KRIG', banu: 'BANU', mirai: 'MRAI', tumbril: 'TMBL', greycat: 'GRIN', aopoa: 'XIAN', gatac: 'GAMA' };
/** 'Aegis Sabre Firebird' -> 'AEGS_Sabre_Firebird', the ship class a crew channel names. */
export function shipClass(display) {
  let words = display.trim().split(/\s+/);
  const first = words[0].toLowerCase();
  const code = MAKER_CODES[first];
  if (!code) return words.join('_');
  if (first === 'consolidated' && /^outland$/i.test(words[1] || '')) words = words.slice(1);
  return [code, ...words.slice(1)].join('_');
}

/** 'MISC_Prospector' -> 'Prospector', 'DRAK_Cutlass_Black' -> 'Cutlass Black' */
export const shipName = model => model.replace(/^[A-Z]{3,5}_/, '').replace(/_/g, ' ');

/**
 * The game's text markup, which localisation mods such as StarStrings and SmartCitizen use
 * too: <EM>/<EM0>..<EM4> colour a run of text, <b>, <i> and <font ...> style it. Returns the
 * text as runs, [{ text, em }], em being 0-4, 'b', 'i' or null for plain text. Unknown tags
 * (stage directions such as <cough>) are dropped.
 */
export function markup(raw) {
  const runs = [], stack = [];
  const push = text => {
    if (!text) return;
    const em = stack.length ? stack[stack.length - 1] : null;
    const last = runs[runs.length - 1];
    if (last && last.em === em) last.text += text; else runs.push({ text, em });
  };
  const re = /<(\/?)(EM(\d)?|b|i|font)\b[^>]*>|<[^<>]{1,30}>/gi;
  let at = 0, m;
  while ((m = re.exec(raw))) {
    push(raw.slice(at, m.index));
    at = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) { stack.pop(); continue; }
    const tag = m[2].toLowerCase();
    stack.push(tag.startsWith('em') ? Number(m[3] || 0) : tag === 'font' ? (stack[stack.length - 1] ?? null) : tag);
  }
  push(raw.slice(at));
  for (const r of runs) r.text = r.text.replace(/\\n/g, ' ').replace(/\s+/g, ' ');
  return runs.filter(r => r.text.trim() || r.text === ' ');
}

/**
 * A contract title, split into its name and the reward tags mods and the game append:
 * 'Retrieve Intel <EM4>[BP]</EM4> <EM4>[100 Rep]</EM4>' -> { text: 'Retrieve Intel', tags: ['BP', '100 Rep'], runs }.
 */
export function contractText(raw) {
  const tags = [];
  const runs = [];
  for (const r of markup(raw)) {
    // Bracketed tags, coloured or not: [BP], [100 Rep], [Illegal].
    const rest = r.text.replace(/\[([^\]]{1,24})\]/g, (_, t) => { tags.push(t.trim()); return ' '; });
    if (rest) runs.push({ ...r, text: rest });
  }
  while (runs.length && !runs[0].text.trim()) runs.shift();
  while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
  if (runs.length) { runs[0].text = runs[0].text.trimStart(); runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd(); }
  const text = runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
  return { text, tags, runs: runs.filter(r => r.text) };
}

const LIFT = { OpeningLoadingGate: 'rising', RaisingPlatform: 'rising', OpenIdle: 'up', LoweringPlatform: 'lowering', ClosingLoadingGate: 'lowering', ClosedIdle: 'down' };

export function parseLine(line) {
  if (line.includes('UpdateNotificationItem')) return null;
  // A notice's text echoed on its own line, after the line that logged it.
  if (/^<[^>]*>\s+"/.test(line)) return null;
  let m = PATTERNS.seat.exec(line);
  if (m) return { type: 'seat', seated: m[1] === 'SetDriver', ship: shipModel(m[2]), id: /_(\d+)$/.exec(m[2])?.[1] || null };
  m = PATTERNS.nav.exec(line);
  if (m) return { type: 'seat', seated: true, ship: m[1], id: /\[(\d+)\]\|CSCItemNavigation/.exec(line)?.[1] || null };
  m = PATTERNS.crew.exec(line);
  if (m) return { type: 'seat', seated: m[1] === 'joined', ship: shipClass(m[2]), board: true };
  m = PATTERNS.armistice.exec(line);
  if (m) return { type: 'armistice', inside: m[1] === 'Entering' };
  m = PATTERNS.qtTarget.exec(line);
  if (m) return { type: 'qt', target: m[1] };
  if (PATTERNS.session.test(line)) return { type: 'session', shard: PATTERNS.shard.exec(line)?.[1] || null };
  if (PATTERNS.loaded.test(line)) return { type: 'loaded' };
  if (PATTERNS.menu.test(line)) return { type: 'menu' };
  m = PATTERNS.me.exec(line);
  if (m) return { type: 'me', geid: m[1], name: m[2] };
  if (PATTERNS.emergency.test(line)) return { type: 'down', who: null };
  m = PATTERNS.branch.exec(line);
  if (m) return { type: 'build', branch: m[1] };
  m = PATTERNS.changelist.exec(line);
  if (m) return { type: 'build', changelist: m[1] };
  m = PATTERNS.wreck.exec(line);
  if (m) return { type: 'wreck', ship: shipModel(m[1]), level: Number(m[3]), by: m[4] || null };
  m = PATTERNS.lift.exec(line);
  // The lift's name ends with its place: HangarMediumTop_Area18. A bare system (HangarXLTop_Nyx) says no more than the system.
  if (m) { const at = /^Hangar[A-Za-z]*?_(.+)$/.exec(m[1])?.[1] || null; return { type: 'lift', to: LIFT[m[2]] || null, place: at && !/^(Stanton|Pyro|Nyx)$/.test(at) ? at : null }; }
  m = PATTERNS.hangarCall.exec(line);
  if (m) return { type: 'hangar', status: 'called', area: m[1].trim() };
  m = PATTERNS.hangarName.exec(line);
  if (m) return { type: 'hangar-name', area: m[1].trim() };
  if (PATTERNS.hangarGranted.test(line)) return { type: 'hangar', status: 'granted', area: null };
  m = PATTERNS.location.exec(line);
  if (m) return { type: 'location', who: m[1], place: m[2] };
  m = PATTERNS.kill.exec(line);
  if (m && m[1] !== m[2]) return { type: 'kill', victim: m[1], killer: m[2], weapon: m[3] || null, damage: m[4] || null };
  m = PATTERNS.incap.exec(line);
  // Logged an incap.! nickname: me, causes: [Bullet (35 damage), ...]
  if (m) return { type: 'down', who: m[1].trim(), damage: /causes: \[([A-Za-z ]+?) \(/.exec(line)?.[1] || null };
  m = PATTERNS.dead.exec(line);
  // The body thrown clear of a destroyed ship: ... ejected from zone 'AEGS_Gladius_123' ... destroyed vehicle
  if (m) return { type: 'down', who: m[1].trim(), ejected: /ejected from zone '([^']+)'/.exec(line)?.[1] || null };
  m = PATTERNS.killed.exec(line);
  if (m) return { type: 'down', who: m[1].trim() };
  m = PATTERNS.hospital.exec(line);
  if (m) return { type: 'hospital', who: m[1], place: m[2] };
  m = PATTERNS.qtRoute.exec(line);
  if (m) return { type: 'qt-route', from: m[1], to: m[2] };
  if (PATTERNS.qtArrived.test(line)) return { type: 'qt-arrived', id: /_(\d+)\[\d+\]\|CSCItemNavigation::OnQuantumDriveArrived/.exec(line)?.[1] || null };
  m = PATTERNS.stall.exec(line);
  if (m) return { type: 'stall', who: m[1], len: Number(m[2]) };
  m = PATTERNS.jump.exec(line);
  if (m) return { type: 'jump', who: m[1], from: m[2], to: m[3] };
  m = PATTERNS.refinery.exec(line);
  if (m) return { type: 'refinery', place: m[1].trim() };
  m = PATTERNS.stowed.exec(line);
  if (m) return { type: 'stowed', id: m[1] };
  m = PATTERNS.unbind.exec(line);
  if (m) return { type: 'respawn', geid: m[1] };
  m = PATTERNS.spawn.exec(line);
  if (m) return { type: 'respawn', who: m[1] };
  m = PATTERNS.contract.exec(line);
  if (m) return { type: 'mission', kind: m[1].toLowerCase(), ...contractText(m[2]) };
  m = PATTERNS.objective.exec(line);
  if (m) return { type: 'objective', kind: { 'New Objective': 'new', 'Objective Complete': 'done', 'Objective Withdrawn': 'withdrawn' }[m[1]], text: contractText(m[2]).text };
  m = PATTERNS.objectiveAt.exec(line);
  if (m) return { type: 'objective-at', place: m[1].replace(/_/g, ' ') };
  m = PATTERNS.jurisdiction.exec(line);
  if (m) return { type: 'jurisdiction', name: m[1].trim() };
  m = PATTERNS.monitored.exec(line);
  if (m) return { type: 'monitored', value: { Entered: 'yes', Exited: 'no', Down: 'down', Restored: 'yes' }[m[1] || m[2]] };
  m = PATTERNS.injury.exec(line);
  if (m) return { type: 'injury', severity: m[1].toLowerCase(), limb: m[2].trim().toLowerCase(), tier: Number(m[3]) };
  m = PATTERNS.medbed.exec(line);
  if (m) return { type: 'medbed', who: m[1] };
  m = PATTERNS.hangarQueue.exec(line);
  if (m) return { type: 'hangar-queue', place: Number(m[1]), wait: Number(m[2]) };
  m = PATTERNS.restricted.exec(line);
  if (m) return { type: 'restricted', inside: !m[1] };
  m = PATTERNS.privateProperty.exec(line);
  if (m) return { type: 'private', inside: m[1] === 'Entering' };
  if (PATTERNS.impounded.test(line)) return { type: 'impounded' };
  if (PATTERNS.lowFuel.test(line)) return { type: 'low-fuel' };
  m = PATTERNS.disconnect.exec(line);
  if (m) {
    // 30016 is a disconnect the player asked for (or can't be told from one), 30010 the menu's own.
    const code = Number(m[1]);
    if (code === 30016 || code === 30010 || !/gamerules="SC_Default"/.test(line)) return null;
    return { type: 'dropped', code };
  }
  m = PATTERNS.popup.exec(line);
  if (m) return { type: 'dropped', code: Number(m[1]), popup: true };
  m = PATTERNS.crash.exec(line);
  if (m) return { type: 'crashed', kind: m[1] || null };
  m = PATTERNS.partyMember.exec(line);
  if (m) return { type: 'party', what: m[2] === 'connected' ? 'online' : 'offline', who: m[1] };
  m = PATTERNS.partyInvite.exec(line);
  if (m) return { type: 'party', what: 'invite', who: m[1] };
  m = PATTERNS.partyQt.exec(line);
  if (m) return { type: 'party', what: 'qt', who: m[1] };
  m = PATTERNS.partyCalib.exec(line);
  if (m) return { type: 'party', what: m[1] === 'Started' ? 'calibrating' : 'calibrated', who: m[2] || null };
  m = PATTERNS.partyIn.exec(line);
  if (m) return { type: 'party', what: /joined|created/.test(m[1]) ? 'joined' : 'left', who: null };
  m = PATTERNS.crime.exec(line);
  if (m && /notification|SHUDEvent|CrimeStat Rating/i.test(line)) {
    const how = (m[1] || '').toLowerCase();
    return { type: 'crime', how: ['cleared', 'removed', 'lost'].includes(how) ? 'clear' : how === 'decreased' ? 'down' : 'up', level: m[2] ? Number(m[2]) : null };
  }
  return null;
}

/** Ungoverned space, or space where the comm array is down: crimes go unreported, and so do calls for help. */
export const lawless = state => state.monitored === 'down' || state.monitored === 'no'
  || /ungoverned|lawless|unclaimed/i.test(state.jurisdiction || '');

// menu: at the main menu or a loading screen. down: incapacitated or dead.
// mission: { contract, tags (rewards), objective, target (where its marker points), status: active | complete | failed | withdrawn, seq } (seq counts changes).
// monitored: yes, no (left monitored space) or down (comm array offline). crime: CrimeStat level.
// build: { branch, changelist } of the running game. wrecked: 1 disabled, 2 destroyed, for the ship you fly.
// kills: players and NPCs you killed this session. location: where you last opened your inventory.
// injuries: [{ limb, tier, severity }] the game reported since your last med bed or respawn; hurt and healed count them.
// restricted, private: inside a restricted area or private property. impounded, lowFuel: as the HUD said.
// dropped: { code, crash, kind, n } why the game last threw you out, until you are back in.
// party: { calibrating } while a party member calibrates a party jump; partyEv: the last party notice, { what, who, n }.
export const EMPTY = Object.freeze({ injuries: [], hurt: 0, healed: 0, restricted: false, private: false, impounded: 0, lowFuel: false,
  dropped: null, party: null, partyEv: null, seated: false, ship: null, armistice: false, qtTarget: null, down: false, menu: true, me: null,
  mission: null, jurisdiction: null, monitored: null, crime: 0, build: null, wrecked: 0, wreckedBy: null, kills: 0, location: null, hangar: null,
  shipId: null, lastShip: null, shard: null, system: null, qtArrived: null, lag: null, downedBy: null, refinery: null, stored: null, jumps: 0, qtRoute: null, jump: null });

/** 'sc-alpha-4.3.2' -> '4.3.2' */
export const version = branch => (branch || '').replace(/^sc-alpha-/i, '');
/** True when the game's major version differs from the one the panel was tested on. */
export const untested = state => !!state.build?.branch && Number(version(state.build.branch).split('.')[0]) !== TESTED_MAJOR;
/** 'Stanton1_Lorville' -> 'Lorville', 'RR_HUR_LEO' -> 'RR HUR LEO' */
// Location ids are internal names: Stanton1_Lorville, AsteroidClusterBase_Nyx_Social_Keeger_001.
const SYSTEMS = /^(Stanton|Pyro|Nyx)\d*[a-z]?$/i;
const KINDS = { AsteroidClusterBase: 'Asteroid base', AsteroidBase: 'Asteroid base', RestStop: 'Rest stop', RR: 'Rest stop', Outpost: 'Outpost',
  Station: 'Station', LandingZone: '', LZ: '', Social: '', Hangar: '', Habs: '', Shop: '' };
/** { name, kind, system, body } of a location id, for people: Keeger, Asteroid base, Nyx.
 *  body is the planet's number in its system when the id says (Stanton1_Lorville: 1). */
export function place(id) {
  let system = null, kind = '', body = null;
  const words = [];
  for (const t of (id || '').split('_')) {
    if (!t || /^\d+$/.test(t)) continue;
    if (SYSTEMS.test(t)) { system ||= t.match(SYSTEMS)[1]; body ??= Number(t.match(/\d+/)?.[0]) || null; continue; }
    if (t in KINDS) { kind ||= KINDS[t]; continue; }
    words.push(t.replace(/([a-z])([A-Z]|\d)/g, '$1 $2'));
  }
  return { name: words.join(' ') || kind || system || '', kind: words.length ? kind : '', system, body };
}
export const placeName = p => place(p).name;

// What outlives leaving the game or changing server: who you are, the mission, and what the Log page shows.
const kept = s => ({ me: s.me, mission: s.mission, build: s.build, kills: s.kills, shard: s.shard, lastShip: s.lastShip,
  downedBy: s.downedBy, refinery: s.refinery, stored: s.stored, jumps: s.jumps, jump: s.jump, system: s.system,
  hurt: s.hurt, healed: s.healed, impounded: s.impounded, dropped: s.dropped, partyEv: s.partyEv });
const isMe = (state, ev) =>
  (ev.who == null && ev.geid == null) || (state.me && (ev.who === state.me.name || ev.geid === state.me.geid));

export function reduce(state, ev) {
  const r = step(state, ev);
  // Low fuel is the ship's: it goes when you leave the seat or take another ship's.
  return r.lowFuel && (!r.seated || r.ship !== state.ship) && r !== state ? { ...r, lowFuel: false } : r;
}

const SEVERITY = ['minor', 'moderate', 'major', 'severe'];
/** The injury that needs the most care: the lowest tier (tier 1 is a hospital), then the worst severity. */
export const worstInjury = list => [...(list || [])].sort((a, b) => a.tier - b.tier || SEVERITY.indexOf(b.severity) - SEVERITY.indexOf(a.severity))[0] || null;

function step(state, ev) {
  const live = state.menu ? { ...state, menu: false } : state;  // anything in the world means we're in it
  switch (ev.type) {
    case 'seat':
      // Boarding (the crew channel) names the ship less exactly than its pilot seat does.
      if (ev.board && ev.seated && state.seated) return live;
      if (ev.board && !ev.seated) return state.seated ? { ...live, seated: false, qtTarget: null, hangar: null } : live;
      if (ev.seated && state.seated && state.ship === ev.ship) {
        // The navigation line names the ship's entity id, which the crew channel doesn't.
        if (ev.id && state.shipId !== ev.id) return { ...live, shipId: ev.id, lastShip: { ship: ev.ship, id: ev.id } };
        return live;
      }
      // Boarding the ship you called ends the hangar call; a landing clearance lasts until you get out.
      if (ev.seated) return { ...live, seated: true, ship: ev.ship, down: false, wrecked: state.ship === ev.ship ? state.wrecked : 0,
        hangar: state.hangar?.status === 'granted' ? state.hangar : null, qtArrived: null,
        shipId: ev.id || (state.ship === ev.ship ? state.shipId : null), lastShip: { ship: ev.ship, id: ev.id || (state.lastShip?.ship === ev.ship ? state.lastShip.id : null) } };
      // Leaving another seat than ours (a turret, a second ship) changes nothing.
      return state.ship === ev.ship ? { ...live, seated: false, qtTarget: null, hangar: null } : state;
    case 'armistice': return { ...live, armistice: ev.inside };
    case 'qt': return { ...live, qtTarget: ev.target, qtArrived: null };
    case 'qt-route': return state.seated ? { ...live, qtRoute: { from: ev.from, to: ev.to } } : state;
    case 'qt-arrived': {
      if (!state.seated || (ev.id && state.shipId && ev.id !== state.shipId)) return state;
      const to = state.qtTarget || state.qtRoute?.to;
      return to ? { ...live, qtArrived: to, qtTarget: null, qtRoute: null } : state;
    }
    case 'stall':
      if (state.me && ev.who !== state.me.name) return state;
      return { ...live, lag: { len: ev.len, n: (state.lag?.n || 0) + 1 } };
    case 'jump':
      if (state.me && ev.who !== state.me.name) return state;
      return { ...live, system: ev.to, jump: { from: ev.from, to: ev.to }, jumps: state.jumps + 1, qtTarget: null };
    case 'refinery': return { ...live, refinery: { place: ev.place, n: (state.refinery?.n || 0) + 1 } };
    case 'hospital':
      if (!state.me || ev.who !== state.me.name || !state.downedBy) return state;
      return { ...live, downedBy: { ...state.downedBy, hospital: ev.place } };
    case 'stowed':
      if (!state.lastShip?.id || ev.id !== state.lastShip.id || state.seated) return state;
      return { ...live, stored: { ship: state.lastShip.ship, n: (state.stored?.n || 0) + 1 }, hangar: null, lastShip: { ...state.lastShip, id: null } };
    case 'session': return { ...EMPTY, ...kept(state), shard: ev.shard || state.shard };
    case 'loaded': return state.menu ? { ...EMPTY, ...kept(state), menu: false, dropped: null } : state;
    case 'menu': return state.menu ? state : { ...EMPTY, ...kept(state) };
    case 'build': return { ...state, build: { ...state.build, ...(ev.branch ? { branch: ev.branch } : { changelist: ev.changelist }) } };
    case 'wreck':
      if (!state.seated || state.ship !== ev.ship || ev.level <= state.wrecked) return state;
      return { ...live, wrecked: ev.level, wreckedBy: ev.by };
    case 'hangar': return { ...live, hangar: { status: ev.status, area: ev.area, lift: null } };
    case 'hangar-name': {
      // The second line of a called ship's hangar name, only right after the first.
      const h = state.hangar;
      if (h?.status !== 'called' || h.lift || !/'s$/.test(h.area || '')) return state;
      return { ...live, hangar: { ...h, area: `${h.area} ${ev.area}` } };
    }
    case 'lift': {
      // Lifts in other hangars load and settle too; only follow one after a call or clearance.
      const h = state.hangar;
      if (!h || !ev.to || h.lift === ev.to) return state;
      if ((ev.to === 'up' && h.lift !== 'rising') || (ev.to === 'down' && h.lift !== 'lowering')) return state;
      if (ev.to === 'down') return { ...live, hangar: null };  // stowed
      return { ...live, hangar: { ...h, lift: ev.to } };
    }
    case 'kill':
      if (state.me && ev.victim === state.me.name) return reduce(state, { type: 'down', who: ev.victim, by: ev.killer, weapon: ev.weapon, damage: ev.damage });
      if (!state.me || ev.killer !== state.me.name) return state;
      return { ...live, kills: state.kills + 1 };
    case 'location':
      if (state.me && ev.who !== state.me.name) return state;
      return state.location === ev.place ? live : { ...live, location: ev.place };
    case 'me': return state.me?.geid === ev.geid ? state : { ...state, me: { geid: ev.geid, name: ev.name } };
    case 'down':
      // Without knowing who we are, only the local-only HUD notice counts.
      if (!isMe(state, ev) || (ev.who != null && !state.me)) return state;
      if (state.down) {
        // A later line about the same downing adds what it knows.
        const d = state.downedBy;
        if (!d || (!ev.by && !ev.weapon && !ev.damage && !ev.ejected)) return state;
        return { ...state, downedBy: { ...d, by: d.by || ev.by || null, weapon: d.weapon || ev.weapon || null, damage: d.damage || ev.damage || null, ejected: d.ejected || ev.ejected || null } };
      }
      return { ...state, down: true, seated: false, qtTarget: null,
        downedBy: { by: ev.by || null, weapon: ev.weapon || null, damage: ev.damage || null, ejected: ev.ejected || null, hospital: null, n: (state.downedBy?.n || 0) + 1 } };
    case 'respawn':
      if (!state.down || (state.me && !isMe(state, ev))) return state;
      return { ...state, down: false, injuries: [] };
    case 'injury': {
      const now = state.injuries.find(i => i.limb === ev.limb);
      if (now && now.tier <= ev.tier && SEVERITY.indexOf(now.severity) >= SEVERITY.indexOf(ev.severity)) return live;
      const injury = { limb: ev.limb, tier: ev.tier, severity: ev.severity };
      return { ...live, injuries: [...state.injuries.filter(i => i.limb !== ev.limb), injury], hurt: state.hurt + 1 };
    }
    case 'medbed':
      if (state.me && ev.who !== state.me.name) return state;
      return { ...live, injuries: [], healed: state.healed + 1 };
    case 'hangar-queue': return { ...live, hangar: { status: 'queued', area: null, lift: null, place: ev.place, wait: ev.wait } };
    case 'restricted': return state.restricted === ev.inside ? live : { ...live, restricted: ev.inside };
    case 'private': return state.private === ev.inside ? live : { ...live, private: ev.inside };
    case 'impounded': return { ...live, impounded: state.impounded + 1 };
    case 'low-fuel': return state.seated && !state.lowFuel ? { ...live, lowFuel: true } : live;
    case 'dropped': {
      // An error box shows for many reasons; only the codes known to end a session count.
      if (ev.popup && !DROP_CODES[ev.code]) return state;
      if (state.dropped && !state.dropped.crash && state.dropped.code === ev.code) return state;
      return { ...state, dropped: { code: ev.code, crash: false, kind: null, n: (state.dropped?.n || 0) + 1 } };
    }
    case 'crashed':
      if (state.dropped?.crash) return ev.kind && !state.dropped.kind ? { ...state, dropped: { ...state.dropped, kind: ev.kind } } : state;
      return { ...state, dropped: { code: null, crash: true, kind: ev.kind, n: (state.dropped?.n || 0) + 1 } };
    case 'party': {
      const party = ev.what === 'calibrating' ? { calibrating: ev.who } : ev.what === 'calibrated' || ev.what === 'left' ? null : state.party;
      return { ...live, party, partyEv: { what: ev.what, who: ev.who, n: (state.partyEv?.n || 0) + 1 } };
    }
    case 'mission': {
      const m = state.mission;
      if (ev.kind === 'accepted') {
        if (m?.contract === ev.text && m.status === 'active') return live;
        return { ...live, mission: { contract: ev.text, tags: ev.tags || [], runs: ev.runs || null, objective: null, target: null, status: 'active', seq: (m?.seq || 0) + 1 } };
      }
      if (!m || m.status !== 'active') return live;
      return { ...live, mission: { ...m, status: ev.kind, seq: m.seq + 1 } };
    }
    case 'objective': {
      const m = state.mission || { contract: null, objective: null, status: 'active', seq: 0 };
      if (ev.kind === 'new') return m.objective === ev.text && m.status === 'active' ? live : { ...live, mission: { ...m, objective: ev.text, target: null, status: 'active', seq: m.seq + 1 } };
      return { ...live, mission: { ...m, objective: m.objective === ev.text ? null : m.objective } };
    }
    case 'objective-at': {
      const m = state.mission;
      return !m || m.target === ev.place ? live : { ...live, mission: { ...m, target: ev.place } };
    }
    case 'jurisdiction': return state.jurisdiction === ev.name ? live : { ...live, jurisdiction: ev.name };
    case 'monitored': return state.monitored === ev.value ? live : { ...live, monitored: ev.value };
    case 'crime': {
      const level = ev.how === 'clear' ? 0 : ev.level ?? Math.max(0, Math.min(5, state.crime + (ev.how === 'down' ? -1 : 1)));
      return level === state.crime ? live : { ...live, crime: level };
    }
    default: return state;
  }
}


// ---------- session recap ----------
/** A fresh tally, from the log time a session started (ISO string or null). */
export const NEW_TALLY = Object.freeze({ start: null, end: null, kills: 0, injuries: 0, deaths: 0, dropped: null, ships: [], missions: 0, failed: 0, crimeMax: 0, places: [], routes: 0 });
/** The log line's timestamp, or null. */
export const stamp = line => /^<(\d{4}-\d\d-\d\dT[\d:.]+Z)>/.exec(line)?.[1] || null;

/** Adds what changed from state a to state b to the session tally t; ts is the line's time. */
export function tally(t, a, b, ts) {
  if (a === b) return ts && t.start ? { ...t, end: ts } : t;
  if (a.menu && !b.menu) return { ...NEW_TALLY, start: ts, end: ts };
  // Why the session ended, for the recap.
  if (b.dropped && b.dropped !== a.dropped) return { ...t, dropped: b.dropped };
  if (b.menu) return t;
  const n = { ...t, end: ts || t.end };
  if (!n.start) n.start = ts;
  if (b.kills > a.kills) n.kills += b.kills - a.kills;
  if (b.hurt > a.hurt) n.injuries += b.hurt - a.hurt;
  if (b.down && !a.down) n.deaths++;
  if (b.seated && b.ship && (!a.seated || a.ship !== b.ship) && !n.ships.includes(b.ship)) n.ships = [...n.ships, b.ship];
  const ma = a.mission, mb = b.mission;
  if (mb && mb.seq !== ma?.seq && mb.status !== ma?.status) {
    if (mb.status === 'complete') n.missions++;
    if (mb.status === 'failed') n.failed++;
  }
  if (b.crime > n.crimeMax) n.crimeMax = b.crime;
  if (b.location && b.location !== a.location) { const p = placeName(b.location); if (p && !n.places.includes(p)) n.places = [...n.places, p]; }
  if (b.qtTarget && b.qtTarget !== a.qtTarget) n.routes++;
  return n;
}

/** Minutes between the tally's first and last log line. */
export const minutes = t => (t.start && t.end ? Math.max(0, Math.round((Date.parse(t.end) - Date.parse(t.start)) / 60000)) : 0);

/** Who a log names as the cause, for people: a player's handle, "an NPC" for spawned AI, null when unknown. */
export function culprit(name, me) {
  if (!name || /^unknown$/i.test(name)) return null;
  if (me && name === me.name) return 'yourself';
  if (/^(PU_|NPC_|AIModule|Kopion|Shipjacker)|_\d{4,}$/i.test(name)) return 'an NPC';
  return name;
}

/** What changed from state a to b that deserves an alert: [{ kind, text, tone }] (tone: bad, warn, good). */
export function alertsFor(a, b) {
  if (b.menu || a.menu) return [];
  const out = [];
  if (b.crime > a.crime) out.push({ kind: 'crime', text: `CrimeStat ${b.crime}`, tone: 'bad' });
  else if (a.crime > 0 && b.crime === 0) out.push({ kind: 'crime', text: 'CrimeStat cleared', tone: 'good' });
  if (b.armistice && !a.armistice) out.push({ kind: 'armistice', text: 'Armistice zone · weapons safe', tone: 'good' });
  else if (a.armistice && !b.armistice) out.push({ kind: 'armistice', text: 'Leaving armistice', tone: 'warn' });
  if (b.seated && b.wrecked > a.wrecked && b.ship === a.ship) {
    const who = culprit(b.wreckedBy, b.me);
    out.push({ kind: 'wreck', text: `${b.wrecked >= 2 ? 'Ship destroyed' : 'Ship disabled'}${who ? ` by ${who}` : ''}`, tone: 'bad' });
  }
  if (b.hurt > a.hurt) { const i = b.injuries[b.injuries.length - 1]; if (i) out.push({ kind: 'injury', text: `${cap(i.limb)} injured · tier ${i.tier}`, tone: 'warn' }); }
  if (b.restricted && !a.restricted) out.push({ kind: 'restricted', text: 'Restricted area · leave or the ship is impounded', tone: 'warn' });
  if (b.impounded > a.impounded) out.push({ kind: 'impounded', text: 'Ship impounded', tone: 'warn' });
  if (b.lowFuel && !a.lowFuel) out.push({ kind: 'fuel', text: 'Low fuel', tone: 'warn' });
  const p = b.partyEv;
  if (p && p.n !== a.partyEv?.n) {
    if (p.what === 'invite') out.push({ kind: 'party', text: `Party invite from ${p.who}`, tone: 'good' });
    if (p.what === 'qt') out.push({ kind: 'party', text: `${p.who} is jumping to you`, tone: 'good' });
    if (p.what === 'calibrated') out.push({ kind: 'party', text: 'Party jump calibrated', tone: 'good' });
  }
  if (b.refinery && b.refinery.n !== a.refinery?.n) out.push({ kind: 'refinery', text: `Refinery job done · ${b.refinery.place}`, tone: 'good' });
  if (b.jump && b.jumps > a.jumps) out.push({ kind: 'jump', text: `Entered ${b.jump.to}`, tone: 'good' });
  const ha = a.hangar, hb = b.hangar;
  if (hb?.status === 'granted' && ha?.status !== 'granted') out.push({ kind: 'hangar', text: 'Hangar assigned', tone: 'good' });
  if (hb?.status === 'called' && hb.lift === 'up' && ha?.lift !== 'up') out.push({ kind: 'hangar', text: `Ship ready · ${hangarName(hb, b.me)}`, tone: 'good' });
  return out;
}

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const ordinal = n => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

/** Why the game threw you out, for people: "Disconnected · connection timed out", or null. */
export function droppedText(d) {
  if (!d) return null;
  if (d.crash) return `Game crashed${CRASH_KINDS[d.kind] ? ` · ${CRASH_KINDS[d.kind]}` : ''}`;
  return `Disconnected · ${DROP_CODES[d.code] || `error ${d.code}`}`;
}

/** A hangar's name for people: "XL Hangar" for your own (the game says "Name's XL Hangar"), else as logged. */
export function hangarName(h, me) {
  const a = (h?.area || '').trim();
  if (!a) return 'Hangar';
  const own = me && a.startsWith(`${me.name}'s`) ? a.slice(me.name.length + 2).trim() : a.replace(/^\S+'s\s+/, '');
  return own || 'Hangar';
}

/** The hangar chip's text, or null: what the log says about the ship you called or the hangar you were given. */
export function hangarText(state) {
  const h = state.hangar;
  if (!h) return null;
  if (h.status === 'queued') return `Queue ${ordinal(h.place)}${h.wait ? ` · ≤ ${h.wait >= 90 ? `${Math.round(h.wait / 60)} min` : `${Math.round(h.wait)} s`}` : ''}`;
  if (h.status === 'granted') return h.lift === 'lowering' ? 'Landed · lift going down' : 'Hangar assigned';
  const name = hangarName(h, state.me);
  return { rising: `${name} · lift rising`, up: `${name} · ship ready`, lowering: `${name} · lift going down` }[h.lift] || `${name} · ship called`;
}

const REGIONS = { use: 'US East', usw: 'US West', euw: 'EU West', euc: 'EU Central', eun: 'EU North', apse: 'Asia Pacific', aps: 'Asia Pacific', apne: 'Asia', aus: 'Australia', sa: 'South America' };
/** A shard id as people say it: pub_euw1b_13165946_150 is { region: 'EU West', n: '150' }. */
export function shardName(id) {
  const m = /^[a-z]+_([a-z]+)\d*[a-z]?_\d+_(\d+)$/.exec(id || '');
  if (!m) return id ? { region: null, n: id } : null;
  return { region: REGIONS[m[1]] || m[1].toUpperCase(), n: m[2] };
}

const downText = d => [d.by ? `by ${culpritOrNull(d.by)}` : null, d.weapon ? weaponName(d.weapon) : null].filter(Boolean).join(' · ');
const culpritOrNull = by => (/^(PU_|NPC_|AIModule|Kopion|Shipjacker)|_\d{4,}$/i.test(by) ? 'an NPC' : by);
/** A weapon or ship entity name for people: KLWE_LaserRepeater_S3_1234 is "Laser Repeater S3". */
export const weaponName = w => w.replace(/_\d+$/, '').replace(/^[A-Z]{3,5}_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

/** What changed from state a to b that belongs on the Log page: [{ kind, text, tone }]. */
export function logFor(a, b) {
  const out = alertsFor(a, b).filter(e => e.kind !== 'armistice' && e.kind !== 'injury');
  if (b.shard && b.shard !== a.shard) { const s = shardName(b.shard); out.push({ kind: 'shard', text: `Joined ${[s.region, s.n && `shard ${s.n}`].filter(Boolean).join(' · ')}`, tone: 'info' }); }
  if (b.dropped && (b.dropped.n !== a.dropped?.n || b.dropped.kind !== a.dropped?.kind)) out.push({ kind: 'dropped', text: droppedText(b.dropped), tone: 'warn' });
  if (b.menu) return out;
  if (b.down && !a.down) { const t = b.downedBy ? downText(b.downedBy) : ''; out.push({ kind: 'down', text: `Downed${t ? ` ${t}` : ''}`, tone: 'bad' }); }
  if (b.downedBy?.hospital && b.downedBy.hospital !== a.downedBy?.hospital) out.push({ kind: 'respawn', text: `Respawn at ${placeName(b.downedBy.hospital) || b.downedBy.hospital}`, tone: 'info' });
  if (b.downedBy?.ejected && b.downedBy.ejected !== a.downedBy?.ejected) out.push({ kind: 'eject', text: `Thrown clear of the wreck of ${shipName(shipModel(b.downedBy.ejected))}`, tone: 'warn' });
  if (b.qtArrived && b.qtArrived !== a.qtArrived) out.push({ kind: 'qt', text: `Quantum arrived · ${b.qtArrived.replace(/_/g, ' ')}`, tone: 'info' });
  if (b.stored && b.stored.n !== a.stored?.n) out.push({ kind: 'stored', text: `${shipName(b.stored.ship)} stored`, tone: 'good' });
  for (const i of b.hurt > a.hurt ? b.injuries.filter(x => !a.injuries.includes(x)) : []) out.push({ kind: 'injury', text: `${cap(i.severity)} injury · ${i.limb} · tier ${i.tier}`, tone: 'warn' });
  if (b.healed > a.healed) out.push({ kind: 'medbed', text: 'Treated in a med bed', tone: 'good' });
  if (b.private !== a.private) out.push({ kind: 'private', text: b.private ? 'Entered private property' : 'Left private property', tone: 'info' });
  if (a.restricted && !b.restricted) out.push({ kind: 'restricted', text: 'Left the restricted area', tone: 'info' });
  if (b.hangar?.status === 'queued' && (a.hangar?.status !== 'queued' || a.hangar.place !== b.hangar.place)) out.push({ kind: 'hangar', text: `Hangar queue · ${hangarText(b)}`.replace('Hangar queue · Queue', 'Hangar queue'), tone: 'info' });
  const p = b.partyEv;
  if (p && p.n !== a.partyEv?.n) {
    const t = { online: `${p.who} online`, offline: `${p.who} offline`, calibrating: `Party jump calibrating${p.who ? ` · ${p.who}` : ''}`, joined: 'Joined a party', left: 'Left the party' }[p.what];
    if (t) out.push({ kind: 'party', text: p.what === 'online' || p.what === 'offline' ? `Party · ${t}` : t, tone: 'info' });
  }
  if (b.seated && b.ship && (!a.seated || a.ship !== b.ship)) out.push({ kind: 'seat', text: `Took the seat of ${shipName(b.ship)}`, tone: 'info' });
  return out;
}

// Patch watch: a patch can rename the log lines the console reads, and then it just goes
// quiet. Lines every session logs soon after it loads, and boarding once you press ship keys
// in the game, are checked. Kinds are parseLine types seen in this Game.log.
export const WATCH_MS = 3 * 60_000, WATCH_KEYS = 10;
/** What the log should have shown by now and hasn't: [] when all is well. */
export function missingLines({ kinds, loadedAt, shipKeys }, now) {
  const miss = [];
  if (loadedAt && now - loadedAt > WATCH_MS) {
    if (!kinds.has('me')) miss.push('your character');
    if (!kinds.has('session')) miss.push('joining a server');
  }
  if (shipKeys >= WATCH_KEYS && !kinds.has('seat')) miss.push('boarding a ship');
  return miss;
}
