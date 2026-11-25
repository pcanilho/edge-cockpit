// The Verse page's sums: the executive hangar cycle, your own timers and the commodity rows.
// Nothing here guesses: the hangar shows times only after you sync it on the current game
// build, and every price carries the age of its report.

const MIN = 60_000;

// ---------- executive hangars (PYAM-EXHANG-0-1) ----------
// One cycle for every server: charging, five red lights turning green one every 24 min;
// open, the five green lights going out one every 12 min; then 5 min dark before all go red.
export const HANGAR = { charge: 120, open: 60, reset: 5, lights: 5 };
export const CYCLE_MIN = HANGAR.charge + HANGAR.open + HANGAR.reset;
const CHARGE_STEP = HANGAR.charge / HANGAR.lights, OPEN_STEP = HANGAR.open / HANGAR.lights;

/** Every state the lights can show, in cycle order, with the minute of the cycle it starts at.
 *  lights: 'r' red, 'g' green, '' dark. */
export const LIGHT_STATES = [
  ...Array.from({ length: HANGAR.lights }, (_, k) => ({ id: `c${k}`, phase: 'charging', at: k * CHARGE_STEP,
    lights: Array.from({ length: HANGAR.lights }, (_, i) => (i < k ? 'g' : 'r')) })),
  ...Array.from({ length: HANGAR.lights }, (_, k) => ({ id: `o${HANGAR.lights - k}`, phase: 'open', at: HANGAR.charge + k * OPEN_STEP,
    lights: Array.from({ length: HANGAR.lights }, (_, i) => (i < HANGAR.lights - k ? 'g' : '')) })),
  { id: 'z', phase: 'reset', at: HANGAR.charge + HANGAR.open, lights: Array(HANGAR.lights).fill('') },
];

/** The cycle start for "the lights just changed to this state" at time t (ms). */
export function syncAt(stateId, t) {
  const s = LIGHT_STATES.find(x => x.id === stateId);
  return s ? { start: t - s.at * MIN, at: t } : null;
}

/** A sync counts on the game build it was made on. Build unknown then: it takes the next one seen. */
export function syncValid(sync, build) {
  if (!sync) return false;
  return !sync.build || !build || sync.build === build;
}

/** Where the cycle is at time t: the phase, the lights, when the next light changes, when
 *  this phase ends, and the next two opening windows [start, end] in ms. */
export function hangarAt(start, t) {
  const C = CYCLE_MIN * MIN;
  const into = (((t - start) % C) + C) % C;
  const m = into / MIN, cycle0 = t - into;
  let i = LIGHT_STATES.length - 1;
  while (LIGHT_STATES[i].at > m) i--;
  const s = LIGHT_STATES[i];
  const nextAt = i + 1 < LIGHT_STATES.length ? LIGHT_STATES[i + 1].at : CYCLE_MIN;
  const phaseEnd = s.phase === 'charging' ? HANGAR.charge : s.phase === 'open' ? HANGAR.charge + HANGAR.open : CYCLE_MIN;
  const win = n => [cycle0 + (n * CYCLE_MIN + HANGAR.charge) * MIN, cycle0 + (n * CYCLE_MIN + HANGAR.charge + HANGAR.open) * MIN];
  const first = s.phase === 'charging' ? 0 : 1;
  return {
    phase: s.phase, lights: s.lights, state: s.id, progress: m / CYCLE_MIN,
    changes: cycle0 + nextAt * MIN, ends: cycle0 + phaseEnd * MIN,
    windows: [win(first), win(first + 1)],
  };
}

// ---------- your own timers ----------
// Ruin Station's vault door runs on its own server: closed 20 min, open 1 min.
export const VAULT = { closed: 20, open: 1 };
export const TIMERS = [
  { id: 'red', name: 'Red keycard printer', mins: 30, note: '30 min cooldown' },
  { id: 'vault', name: 'Ruin vault door', cycle: VAULT, note: 'Tap when it closes' },
  { id: 'blue', name: 'Blue keycard printer', mins: 30, note: '30 min cooldown' },
  { id: 'own', name: 'Own timer', mins: null, note: '5 to 120 min' },
];
export const OWN_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];

/** A timer's state at t: { running, left (ms), done, open (vault), next (ms of the next change) }. */
export function timerAt(def, run, t) {
  if (!run) return { running: false };
  if (def.cycle) {
    const C = (def.cycle.closed + def.cycle.open) * MIN, into = (t - run.started) % C;
    const open = into >= def.cycle.closed * MIN;
    const next = t - into + (open ? C : def.cycle.closed * MIN);
    return { running: true, open, left: next - t, next, progress: into / C };
  }
  const end = run.started + run.mins * MIN;
  if (t >= end) return { running: false, done: true };
  return { running: true, left: end - t, next: end, progress: (t - run.started) / (run.mins * MIN) };
}

/** Minutes for people: 6 min, 1 h 12 min, under a minute. Rounded up, so 0 never shows early. */
export function inMinutes(ms) {
  const m = Math.ceil(ms / MIN);
  if (m <= 1) return ms < MIN ? 'under a minute' : '1 min';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// ---------- commodities ----------
// Prices are what players report to UEX: each one shows its age, and a week-old one is dropped (in Rust).
export const SYSTEMS = ['Stanton', 'Pyro', 'Nyx'];
export const ROWS = 7;
/** Reports older than this show in grey. */
export const OLD_S = 2 * 86_400;

/** How old a report is, for people, and whether it counts as old. */
export function age(reportedS, nowMs) {
  const s = Math.max(0, nowMs / 1000 - reportedS);
  const text = s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < OLD_S ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} days ago`;
  return { text, old: s >= OLD_S };
}

const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A planet's orbital station goes by its own name, not by the planet's.
const LEO = { HUR: 'Everus Harbor', CRU: 'Seraphim Station', ARC: 'Baijini Point', MIC: 'Port Tressler' };
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' };
const SYSTEM_OF = id => SYSTEMS.find(s => new RegExp(`^${s}`, 'i').test(id || ''));

/** The trade place a Game.log location id stands for (Stanton3_Area18, RR_ARC_L1, RR_P6_LEO_Ruin_Station,
 *  RR_JP_PyroStanton), in the system you are in. -1 when no place with prices matches. */
export function placeFor(market, id, system) {
  if (!market || !id) return -1;
  // An id that names its system (Stanton3_Area18) wins over the system you were last seen in.
  const sys = SYSTEM_OF(id) || system;
  const places = market.places.map((p, i) => ({ ...p, i })).filter(p => !sys || p.system === sys);
  const names = p => [p.name, ...(p.aliases || [])].map(flat);
  const find = test => places.find(p => names(p).some(test))?.i ?? -1;
  const t = id.split('_');
  // Rest stops: RR_<planet>_L<n> is "<PLANET>-L<n> … Station", RR_<planet>_LEO the planet's station.
  if (t[0] === 'RR' && LEO[t[1]] && t[2] === 'LEO') return find(n => n === flat(LEO[t[1]]));
  if (t[0] === 'RR' && LEO[t[1]] && /^L\d$/.test(t[2] || '')) return find(n => n.startsWith(flat(t[1] + t[2])));
  // Pyro's rest stops: RR_P5_L4 is the station at Pyro V's Lagrange point 4.
  const pl = /^P(\d)$/.exec(t[1] || ''), lp = /^L(\d)$/.exec(t[2] || '');
  if (t[0] === 'RR' && pl && lp) {
    const orbit = flat(`Pyro ${ROMAN[pl[1]]} Lagrange Point ${lp[1]}`);
    return places.find(p => flat(p.orbit) === orbit && p.system === 'Pyro')?.i ?? -1;
  }
  // Jump point stations: RR_JP_PyroStanton in Stanton is Stanton's Pyro Gateway.
  if (t[0] === 'RR' && t[1] === 'JP' && sys) {
    const other = SYSTEMS.concat('Terra', 'Magnus').find(s => s !== sys && (t[2] || '').includes(s));
    if (other) return find(n => n.startsWith(flat(other + 'gateway')));
  }
  // Otherwise the words of the id, without its system and kind prefixes: Area18, NewBabbage, Ruin Station.
  const words = t.filter(w => !/^(RR|LEO|LZ|Stanton\d*\w?|Pyro\d*\w?|Nyx\d*\w?|P\d+\w?|HUR|CRU|ARC|MIC|AsteroidClusterBase|AsteroidBase|Social|Outpost|Station|\d+)$/i.test(w));
  const key = flat(words.join(''));
  if (key.length < 4) return -1;
  const exact = find(n => n === key || n === flat(words.join('') + 'station'));
  if (exact >= 0) return exact;
  return find(n => n.length >= 4 && (n.includes(key) || key.includes(n)));
}

/** Places on the same planet as place i (itself included), in its system. */
export function nearby(market, i) {
  const p = market.places[i];
  if (!p) return [];
  return market.places.map((q, j) => ({ q, j })).filter(({ q }) => q.system === p.system && (q === p || (p.planet && q.planet === p.planet))).map(({ j }) => j);
}

/** Rows for a set of places: what you can buy there ('buy') with the best place in the system to sell
 *  it, or what you can sell there ('sell') with the cheapest place in the system to buy it.
 *  Best profit per SCU first; rows with nothing to compare with last, then by name. */
export function tradeRows(market, at, mode, system) {
  const here = new Set(at);
  const inSys = market.quotes.filter(q => market.places[q.place].system === system);
  const best = new Map();
  for (const q of inSys) {
    const b = best.get(q.name) || { buy: null, sell: null, here: null };
    if (here.has(q.place)) {
      // The best of the chosen places: lowest buy, or highest sell.
      if (mode === 'buy' && q.buy > 0 && (!b.here || q.buy < b.here.price)) b.here = { price: q.buy, at: q.buy_at, place: q.place, scu: q.buy_scu };
      if (mode === 'sell' && q.sell > 0 && (!b.here || q.sell > b.here.price)) b.here = { price: q.sell, at: q.sell_at, place: q.place, status: q.sell_status };
    }
    if (q.sell > 0 && !here.has(q.place) && (!b.sell || q.sell > b.sell.price)) b.sell = { price: q.sell, at: q.sell_at, place: q.place, status: q.sell_status };
    if (q.buy > 0 && !here.has(q.place) && (!b.buy || q.buy < b.buy.price)) b.buy = { price: q.buy, at: q.buy_at, place: q.place, scu: q.buy_scu };
    best.set(q.name, b);
  }
  const rows = [];
  for (const [name, b] of best) {
    if (!b.here) continue;
    const other = mode === 'buy' ? b.sell : b.buy;
    const profit = other ? (mode === 'buy' ? other.price - b.here.price : b.here.price - other.price) : null;
    rows.push({ name, here: b.here, other, profit });
  }
  return rows.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || a.name.localeCompare(b.name));
}

// The terminal's own stock level, as the game's terminal shows it (UEX status 1 to 7). When you sell,
// an empty terminal has room for your cargo and a full one does not.
const LEVEL = ['', 'empty', 'very low', 'low', 'medium', 'high', 'very high', 'full'];
/** What the terminal had when the price was reported: SCU for sale when you buy; its own stock when you sell. */
export function stockText(x) {
  if (x.scu > 0) return { text: `${x.scu.toLocaleString('en-US')} SCU in stock`, low: x.scu < 10 };
  if (x.status) return { text: `Stock ${LEVEL[x.status] || ''}`, low: x.status >= 6 };
  return null;
}

/** With your place unknown: each commodity's cheapest buy and best sell anywhere in the system, at two different places. */
export function routes(market, system) {
  const by = new Map();
  for (const q of market.quotes) {
    if (market.places[q.place].system !== system) continue;
    const r = by.get(q.name) || { name: q.name, buys: [], sells: [] };
    if (q.buy > 0) r.buys.push({ price: q.buy, at: q.buy_at, place: q.place, scu: q.buy_scu });
    if (q.sell > 0) r.sells.push({ price: q.sell, at: q.sell_at, place: q.place, status: q.sell_status });
    by.set(q.name, r);
  }
  const rows = [];
  for (const r of by.values()) {
    const buy = r.buys.sort((a, b) => a.price - b.price)[0];
    const sell = buy && r.sells.filter(s => s.place !== buy.place).sort((a, b) => b.price - a.price)[0];
    if (buy && sell && sell.price > buy.price) rows.push({ name: r.name, here: buy, other: sell, profit: sell.price - buy.price });
  }
  return rows.sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
}

/** Where one commodity is cheapest to buy and pays most to sell in a system, best first. */
export function whereTo(market, name, system, n = 4) {
  const qs = market.quotes.filter(q => q.name === name && market.places[q.place].system === system);
  return {
    buy: qs.filter(q => q.buy > 0).sort((a, b) => a.buy - b.buy).slice(0, n).map(q => ({ price: q.buy, at: q.buy_at, place: q.place })),
    sell: qs.filter(q => q.sell > 0).sort((a, b) => b.sell - a.sell).slice(0, n).map(q => ({ price: q.sell, at: q.sell_at, place: q.place })),
  };
}

// UEX's kinds, folded into a few chips that fit one row of a touch screen.
export const KIND_CHIPS = [
  ['Metals', ['Metal', 'Alloy']],
  ['Minerals', ['Mineral', 'Minteral', 'Non-Metal', 'Halogen', 'Raw Materials']],
  ['Gases', ['Gas', 'Fuel', 'Liquid', 'Chemical']],
  ['Medical', ['Medical', 'Medicine', 'Drug']],
  ['Food', ['Food', 'Agricultural', 'Seed', 'Natural', 'Organic', 'Organics', 'Animal']],
  ['Vice', ['Vice']],
  ['Goods', ['Man-made', 'Electronics', 'Commodity', 'Crafting', 'Ammunition', 'Explosive']],
  ['Scrap', ['Scrap', 'Waste']],
];
const chipOf = kind => KIND_CHIPS.find(([, ks]) => ks.some(k => k.toLowerCase() === String(kind || '').toLowerCase()))?.[0] || 'Other';

/** Commodities with a price in a system, filtered by a chip and a first letter, A to Z. */
export function findList(market, system, { chip = null, letter = null } = {}) {
  const names = new Set(market.quotes.filter(q => market.places[q.place].system === system).map(q => q.name));
  return [...names].filter(n => (!chip || chipOf(market.kinds?.[n]) === chip) && (!letter || n[0].toUpperCase() === letter)).sort((a, b) => a.localeCompare(b));
}
/** The first letters that have something, for the A–Z strip. */
export const letters = (market, system, chip) => [...new Set(findList(market, system, { chip }).map(n => n[0].toUpperCase()))].sort();
