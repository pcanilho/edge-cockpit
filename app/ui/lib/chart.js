// The Map page's system chart, without the drawing: where each body goes, which body a Game.log
// place stands for, and what the side card says. UEX gives order and parentage, not positions
// that agree with each other, so the layout is a schematic: rings in order from the star.

/** UEX's spelling of a few names differs from the game's. */
const SPELL = { MicroTech: 'microTech' };
export const spell = n => SPELL[n] || n;
const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const GOLDEN = 137.5;

/** Planet sizes and ring spacing, in chart units. */
export const SIZE = { star: 17, planet: 13, moon: 4.2, lagrange: 4.5, gateway: 12, asteroid: 7 };

/**
 * Where each body sits: { nodes, rings }. A node is { name, kind, label, x, z, r, parent };
 * y is up and every body lies on y = 0. A ring is { x, z, r, kind } (an orbit to draw).
 */
export function layout(sys) {
  const nodes = [], rings = [];
  if (!sys) return { nodes, rings };
  const planets = sys.bodies.filter(b => b.kind === 'planet').sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.name.localeCompare(b.name));
  const step = planets.length > 4 ? 72 : 95, first = 130;
  const at = new Map();
  planets.forEach((p, i) => {
    const r = first + i * step, a = (-90 + i * GOLDEN) * Math.PI / 180;
    const n = { name: p.name, kind: 'planet', label: spell(p.name), x: Math.cos(a) * r, z: Math.sin(a) * r, r: SIZE.planet, orbit: r, angle: a, parent: null };
    nodes.push(n); at.set(p.name, n); rings.push({ x: 0, z: 0, r, kind: 'planet' });
  });
  // Moons circle their planet, each on its own ring.
  const moonsOf = new Map();
  for (const m of sys.bodies.filter(b => b.kind === 'moon' && at.has(b.parent))) moonsOf.set(m.parent, [...(moonsOf.get(m.parent) || []), m]);
  for (const [planet, moons] of moonsOf) {
    const p = at.get(planet);
    moons.sort((a, b) => a.name.localeCompare(b.name)).forEach((m, j) => {
      const r = p.r + 14 + j * 11, a = p.angle + Math.PI + j * (2 * Math.PI / moons.length) + 0.6;
      nodes.push({ name: m.name, kind: 'moon', label: m.name, x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, r: SIZE.moon, parent: planet });
      rings.push({ x: p.x, z: p.z, r, kind: 'moon' });
    });
  }
  // Lagrange points: L1 inside the planet's orbit, L2 outside, L3 opposite, L4 and L5 60 degrees ahead and behind.
  const L = { 1: [-40, 0], 2: [40, 0], 3: [0, 180], 4: [0, 60], 5: [0, -60] };
  for (const b of sys.bodies.filter(b => b.kind === 'lagrange' && at.has(b.parent) && L[b.point])) {
    const p = at.get(b.parent), [dr, da] = L[b.point], r = p.orbit + dr, a = p.angle + da * Math.PI / 180;
    nodes.push({ name: b.name, kind: 'lagrange', label: `${spell(b.parent)} Lagrange point ${b.point}`, x: Math.cos(a) * r, z: Math.sin(a) * r, r: SIZE.lagrange, parent: b.parent });
  }
  // Gateways and bases that are not planets: on rings of their own, outside the planets.
  const outer = planets.length ? first + planets.length * step + 30 : first;
  [['asteroid', outer], ['gateway', outer + (sys.bodies.some(b => b.kind === 'asteroid') ? 90 : 0)]].forEach(([kind, r], k) => {
    const list = sys.bodies.filter(b => b.kind === kind);
    if (!list.length) return;
    rings.push({ x: 0, z: 0, r, kind });
    list.forEach((b, i) => {
      const a = (-60 + k * 40 + i * 360 / list.length) * Math.PI / 180;
      nodes.push({ name: b.name, kind, label: b.name, x: Math.cos(a) * r, z: Math.sin(a) * r, r: SIZE[kind], parent: null });
    });
  });
  return { nodes, rings, extent: Math.max(outer, ...rings.map(r => Math.hypot(r.x, r.z) + r.r)) };
}

const PLANET_CODE = { HUR: 'hurston', CRU: 'crusader', ARC: 'arccorp', MIC: 'microtech' };
const SYSTEM_WORD = /^(Stanton|Pyro|Nyx)(\d*)([a-z]?)$/i;

/**
 * The body (and the place, when it is one) that a Game.log name stands for: a quantum target
 * (Yela, OM-1_Hurston), a location id (Stanton3_Area18, RR_HUR_L1, RR_P6_LEO_Ruin_Station,
 * RR_JP_PyroStanton) or a hangar's place (Area18). null when it can't be told: a mission's
 * marker, a place UEX doesn't list. Never a guess at a nearby body.
 */
export function resolve(sys, id) {
  if (!sys || !id || /^MISSION_/i.test(id)) return null;
  const bodies = sys.bodies, places = sys.places || [];
  const body = name => bodies.find(b => flat(b.name) === flat(name)) || null;
  const planetBy = test => bodies.find(b => b.kind === 'planet' && test(b)) || null;
  const out = (b, place = null) => (b ? { body: b.name, place } : null);
  const t = String(id).replace(/^OM-?\d+_/i, '').split('_').filter(Boolean);
  // Rest stops and orbital stations: RR_HUR_L1, RR_P5_L4, RR_HUR_LEO, RR_P6_LEO_Ruin_Station, RR_JP_PyroStanton.
  if (/^RR$/i.test(t[0])) {
    const code = (t[1] || '').toUpperCase(), pn = /^P(\d)$/.exec(code);
    const planet = PLANET_CODE[code] ? planetBy(b => flat(b.name) === PLANET_CODE[code]) : pn ? planetBy(b => b.slot === Number(pn[1])) : null;
    const lp = /^L(\d)$/i.exec(t[2] || '');
    if (planet && lp) return out(bodies.find(b => b.kind === 'lagrange' && b.parent === planet.name && b.point === Number(lp[1])));
    // RR_P6_LEO_Ruin_Station: the station's own name follows.
    const named = flat(t.slice(3).join(''));
    const st = named && planet && places.find(p => p.body === planet.name && [p.name, ...(p.aliases || [])].some(n => flat(n) === named));
    if (planet) return out(planet, st?.name || null);
    if (code === 'JP') {
      const word = t.slice(2).join('');
      const g = bodies.find(b => b.kind === 'gateway' && word.toLowerCase().includes(flat(b.name).replace(/gateway$/, '')) && flat(b.name).replace(/gateway$/, '') !== flat(sys.name));
      return out(g);
    }
    return null;
  }
  // A place's words: Area18, NewBabbage, Ruin Station, Seraphim.
  const words = t.filter(w => !SYSTEM_WORD.test(w) && !/^(LEO|LZ|Hangar\w*|Social|Outpost|\d+)$/i.test(w));
  const key = flat(words.join(''));
  if (key.length >= 3) {
    const b = body(key) || bodies.find(b => flat(b.name) === key);
    if (b) return out(b);
    const names = p => [p.name, ...(p.aliases || [])].map(flat);
    const p = places.find(p => names(p).some(n => n === key || n === key + 'station'))
      || (key.length >= 5 && places.find(p => names(p).some(n => n.length >= 5 && (n.startsWith(key) || key.startsWith(n)))));
    if (p) return out(body(p.body), p.name);
  }
  // Stanton3_…: the system word names the planet by its place from the star.
  const sw = t.map(w => SYSTEM_WORD.exec(w)).find(m => m && m[2]);
  if (sw && flat(sw[1]) === flat(sys.name)) return out(planetBy(b => b.slot === Number(sw[2])));
  return null;
}

/** The chart body a trade place from World belongs to: its moon, else its orbit, else its planet. */
export function bodyOf(sys, p) {
  if (!sys || !p || p.system !== sys.name) return null;
  const find = n => n && sys.bodies.find(b => flat(b.name) === flat(n) || flat(b.name) === flat(String(n).split(' (')[0]))?.name;
  return find(p.moon) || find(p.orbit) || find(p.planet) || (sys.places || []).find(q => [q.name, ...(q.aliases || [])].some(n => flat(n) === flat(p.name)))?.body || null;
}

/** "14 minutes ago" for people; minutes are all the card shows. */
export function ago(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return `${h} hour${h === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} minute${m % 60 === 1 ? '' : 's'}` : ''} ago`;
}

/** What a body is, in words: "Moon of Crusader", "Planet · Stanton III". */
export function kindText(sys, name) {
  const b = sys?.bodies.find(x => x.name === name);
  if (!b) return '';
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  if (b.kind === 'planet') return b.slot ? `Planet · ${sys.name} ${ROMAN[b.slot]}` : 'Planet';
  if (b.kind === 'moon') return `Moon of ${spell(b.parent)}`;
  if (b.kind === 'lagrange') return `Lagrange point of ${spell(b.parent)}`;
  if (b.kind === 'gateway') return 'Jump point';
  return 'Asteroid base';
}

/** The places UEX lists at a body, stations first. */
export const placesAt = (sys, name) => (sys?.places || []).filter(p => p.body === name).sort((a, b) => a.kind.localeCompare(b.kind) * -1 || a.name.localeCompare(b.name));

/**
 * Where you are, as the card says it: { system, body, place, how, at, route } or null.
 * fix is the last place Game.log named ({ id, how, at, sys }); game is the Game.log state.
 */
export function where(chart, game, fix) {
  // The system: from a jump, else the one a place id names (Stanton3_Area18), else the one
  // system UEX lists the last named place or route in (Yela is only in Stanton).
  const named = /^(Stanton|Pyro|Nyx)\d/i.exec(game?.location || '')?.[1];
  const only = id => { const in_ = (chart?.systems || []).filter(s => resolve(s, id)); return in_.length === 1 ? in_[0].name : null; };
  const system = game?.system || fix?.sys || (named && named[0].toUpperCase() + named.slice(1).toLowerCase())
    || [fix?.id, game?.qtRoute?.to, game?.qtRoute?.from, game?.qtTarget, game?.location].filter(Boolean).map(only).find(Boolean) || null;
  const sys = chart?.systems?.find(s => s.name === system) || null;
  const route = game?.qtRoute ? { from: game.qtRoute.from, to: game.qtRoute.to, active: true }
    : game?.qtTarget ? { from: null, to: game.qtTarget, active: true } : fix?.route ? { ...fix.route, active: false } : null;
  const hit = fix && (!fix.sys || fix.sys === system) ? resolve(sys, fix.id) : null;
  return { system, sys, body: hit?.body || null, place: hit?.place || null, how: hit ? fix.how : null, at: hit ? fix.at : null, route };
}
