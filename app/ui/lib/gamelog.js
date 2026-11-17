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
  kill: /<Actor Death> CActor::Kill: '([^']+)' \[\d+\] in zone '[^']*' killed by '([^']+)'/,
  // <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'AEGS_Gladius_123' [123] ... driven by 'me' [1] advanced from destroy level 0 to 1 caused by 'them' ...
  wreck: /<Vehicle Destruction>.*?Vehicle '([^']+)'.*?advanced from destroy level (\d) to (\d)/,
  // <RequestLocationInventory> Player[me] requested inventory for Location[Stanton1_Lorville]
  location: /<RequestLocationInventory> Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]/,
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

export function parseLine(line) {
  if (line.includes('UpdateNotificationItem')) return null;
  // A notice's text echoed on its own line, after the line that logged it.
  if (/^<[^>]*>\s+"/.test(line)) return null;
  let m = PATTERNS.seat.exec(line);
  if (m) return { type: 'seat', seated: m[1] === 'SetDriver', ship: shipModel(m[2]) };
  m = PATTERNS.nav.exec(line);
  if (m) return { type: 'seat', seated: true, ship: m[1] };
  m = PATTERNS.crew.exec(line);
  if (m) return { type: 'seat', seated: m[1] === 'joined', ship: shipClass(m[2]), board: true };
  m = PATTERNS.armistice.exec(line);
  if (m) return { type: 'armistice', inside: m[1] === 'Entering' };
  m = PATTERNS.qtTarget.exec(line);
  if (m) return { type: 'qt', target: m[1] };
  if (PATTERNS.session.test(line)) return { type: 'session' };
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
  if (m) return { type: 'wreck', ship: shipModel(m[1]), level: Number(m[3]) };
  m = PATTERNS.location.exec(line);
  if (m) return { type: 'location', who: m[1], place: m[2] };
  m = PATTERNS.kill.exec(line);
  if (m && m[1] !== m[2]) return { type: 'kill', victim: m[1], killer: m[2] };
  m = PATTERNS.incap.exec(line) || PATTERNS.dead.exec(line) || PATTERNS.killed.exec(line);
  if (m) return { type: 'down', who: m[1].trim() };
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
export const EMPTY = Object.freeze({ seated: false, ship: null, armistice: false, qtTarget: null, down: false, menu: true, me: null,
  mission: null, jurisdiction: null, monitored: null, crime: 0, build: null, wrecked: 0, kills: 0, location: null });

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
    words.push(t.replace(/([a-z])([A-Z])/g, '$1 $2'));
  }
  return { name: words.join(' ') || kind || system || '', kind: words.length ? kind : '', system, body };
}
export const placeName = p => place(p).name;

const isMe = (state, ev) =>
  (ev.who == null && ev.geid == null) || (state.me && (ev.who === state.me.name || ev.geid === state.me.geid));

export function reduce(state, ev) {
  const live = state.menu ? { ...state, menu: false } : state;  // anything in the world means we're in it
  switch (ev.type) {
    case 'seat':
      // Boarding (the crew channel) names the ship less exactly than its pilot seat does.
      if (ev.board && ev.seated && state.seated) return live;
      if (ev.board && !ev.seated) return state.seated ? { ...live, seated: false, qtTarget: null } : live;
      if (ev.seated && state.seated && state.ship === ev.ship) return live;
      if (ev.seated) return { ...live, seated: true, ship: ev.ship, down: false, wrecked: state.ship === ev.ship ? state.wrecked : 0 };
      // Leaving another seat than ours (a turret, a second ship) changes nothing.
      return state.ship === ev.ship ? { ...live, seated: false, qtTarget: null } : state;
    case 'armistice': return { ...live, armistice: ev.inside };
    case 'qt': return { ...live, qtTarget: ev.target };
    case 'session': return { ...EMPTY, me: state.me, mission: state.mission, build: state.build, kills: state.kills };
    case 'loaded': return state.menu ? { ...EMPTY, me: state.me, mission: state.mission, build: state.build, kills: state.kills, menu: false } : state;
    case 'menu': return state.menu ? state : { ...EMPTY, me: state.me, mission: state.mission, build: state.build, kills: state.kills };
    case 'build': return { ...state, build: { ...state.build, ...(ev.branch ? { branch: ev.branch } : { changelist: ev.changelist }) } };
    case 'wreck':
      if (!state.seated || state.ship !== ev.ship || ev.level <= state.wrecked) return state;
      return { ...live, wrecked: ev.level };
    case 'kill':
      if (state.me && ev.victim === state.me.name) return reduce(state, { type: 'down', who: ev.victim });
      if (!state.me || ev.killer !== state.me.name) return state;
      return { ...live, kills: state.kills + 1 };
    case 'location':
      if (state.me && ev.who !== state.me.name) return state;
      return state.location === ev.place ? live : { ...live, location: ev.place };
    case 'me': return state.me?.geid === ev.geid ? state : { ...state, me: { geid: ev.geid, name: ev.name } };
    case 'down':
      // Without knowing who we are, only the local-only HUD notice counts.
      if (state.down || !isMe(state, ev) || (ev.who != null && !state.me)) return state;
      return { ...state, down: true, seated: false, qtTarget: null };
    case 'respawn':
      if (!state.down || (state.me && !isMe(state, ev))) return state;
      return { ...state, down: false };
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

