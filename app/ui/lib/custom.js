// Your own pages: the format, and the rules every control on one keeps.
// A page is plates left to right. A plate is a stock plate (Power, Role, Flight, Gear, built by
// the same code as the curated pages) with your edits on top, or a blank plate of your own.
// Stock pages are never changed: a page of yours only references them.

export const FORMAT = 1;
export const GRID = 16;
/** Plate widths that fill the 2560 x 720 Edge next to the status display, as on the stock pages. */
export const WIDTHS = { power: 450, role: 818, flight: 612, gear: 274 };
export const STOCK = Object.keys(WIDTHS);
export const PLATE_H = 720 - 12;
export const LEFT = 382; // the status display is 6..376
export const SPACE = 2560 - LEFT - 6; // 2172 px across for plates
export const GAP = 6;

/** The controls you can place, their smallest size, and what they take. */
export const TYPES = {
  key: { name: 'Keycap', min: [56, 56], takes: 'tap' },
  rocker: { name: 'Rocker', min: [56, 72], takes: 'pair' },
  round: { name: 'Round button', min: [80, 80], takes: 'tap' },
  switch: { name: 'On / off switch', min: [84, 196], fixed: true, takes: 'set' },
  onoffkey: { name: 'On / off key', min: [96, 80], takes: 'set' },
  rotary: { name: 'Rotary', min: [120, 120], takes: 'positions' },
  slider: { name: 'Slider', min: [96, 240], takes: 'pair' },
  guard: { name: 'Guarded cover', min: [140, 72], takes: 'danger' },
  slide: { name: 'Slide to confirm', min: [200, 72], takes: 'danger' },
  label: { name: 'Label', min: [48, 20], takes: 'text' },
  placard: { name: 'Placard', min: [48, 20], takes: 'text' },
  screen: { name: 'Status screen', min: [160, 72], takes: 'field' },
};

/** Live values a status screen can show: only what Game.log tells us. */
export const FIELDS = {
  ship: 'Ship', location: 'Location', system: 'System', mission: 'Mission', qtTarget: 'Quantum target',
  armistice: 'Armistice', jurisdiction: 'Jurisdiction', kills: 'Kills this session', shard: 'Server',
};

const DANGER = /eject|self_destruct|selfdestruct|jettison|emergency|panic/i;
/** A key that ends a flight or dumps cargo: only behind a guarded cover or a slide. */
export const isDanger = k => !!k && (k.role === 'critical' || DANGER.test(k.action || '') || DANGER.test(k.label || ''));
const tap = k => !!k && !k.more && k.role !== 'hold';

/** Why a key can't go on this control, or '' when it can. `keys` is the label -> key map. */
export function refuse(type, key, keys) {
  const t = TYPES[type];
  if (!t) return 'Unknown control';
  if (t.takes === 'text' || t.takes === 'field') return '';
  if (t.takes === 'set') {
    const on = keys.get(`${key} on`), off = keys.get(`${key} off`);
    return on && off ? '' : 'No set-on / set-off bind, so a switch could show the wrong state. Use a keycap';
  }
  const k = keys.get(key);
  if (!k) return 'Not a known key';
  if (t.takes === 'danger') return isDanger(k) ? '' : 'A guarded cover is for keys that end a flight or dump cargo';
  if (isDanger(k)) return 'Needs a guarded cover or a slide to confirm';
  if (k.role === 'hold' && type !== 'key' && type !== 'round') return 'Hold keys go on a keycap or round button';
  if (t.takes === 'tap' && !tap(k) && k.role !== 'hold') return 'Has a long-press action of its own; use the stock control';
  return '';
}

/** Why an item can't stay on a page, or '' when it can: every key it sends must pass `refuse`. */
export function refuseItem(it, keys) {
  const t = TYPES[it?.t];
  if (!t) return 'Unknown control';
  if (t.takes === 'pair') return refuse(it.t, it.a, keys) || refuse(it.t, it.b, keys);
  if (t.takes === 'positions') {
    const pos = (it.positions || []).filter(p => p.key);
    return pos.length < 2 ? 'Needs two positions or more' : pos.map(p => refuse(it.t, p.key, keys)).find(Boolean) || '';
  }
  return refuse(it.t, it.key, keys);
}

/** True when an item still needs its key (or keys) picked. */
export function unset(it) {
  const t = TYPES[it?.t];
  if (!t || t.takes === 'text' || t.takes === 'field') return false;
  if (t.takes === 'pair') return !it.a || !it.b;
  if (t.takes === 'positions') return (it.positions || []).filter(p => p.key).length < 2;
  return !it.key;
}

/** Keys a switch can take: the bases with both a set-on and a set-off key. */
export function switchable(keys) {
  const out = [];
  for (const label of keys.keys()) {
    const m = /^(.*) on$/i.exec(label);
    if (m && keys.has(`${m[1]} off`)) out.push(m[1]);
  }
  return out.sort();
}

const snap = v => Math.round(v / GRID) * GRID;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : '');

/** One control, cleaned: on the grid, inside its plate, at least its smallest size. */
export function cleanItem(it, plateW) {
  const t = TYPES[it?.t];
  if (!t) return null;
  const up = n => Math.ceil(n / GRID) * GRID;
  let w = Math.max(up(t.min[0]), snap(num(it.w, t.min[0]))), h = Math.max(up(t.min[1]), snap(num(it.h, t.min[1])));
  if (t.fixed) [w, h] = t.min;
  w = Math.min(w, plateW - 2 * GRID); h = Math.min(h, PLATE_H - 3 * GRID);
  const x = Math.min(Math.max(GRID, snap(num(it.x, GRID))), plateW - GRID - w);
  const y = Math.min(Math.max(2 * GRID, snap(num(it.y, 2 * GRID))), PLATE_H - GRID - h);
  const out = { t: it.t, x, y, w, h };
  for (const k of ['key', 'a', 'b', 'label', 'text', 'field']) if (it[k] !== undefined) out[k] = str(it[k]);
  if (Array.isArray(it.positions)) out.positions = it.positions.slice(0, 4).map(p => ({ label: str(p?.label, 12), key: str(p?.key) }));
  return out;
}

/** A page from storage or a shared file, cleaned; null if it isn't one. */
export function cleanPage(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.plates)) return null;
  const id = /^my-[a-z0-9]{4,16}$/.test(p.id) ? p.id : null;
  if (!id) return null;
  const plates = [];
  let used = 0;
  for (const pl of p.plates.slice(0, 6)) {
    const stock = STOCK.includes(pl?.stock) ? pl.stock : null;
    const want = num(pl?.w, 450);
    // Your plates snap to the stock widths, so a page still fills the Edge; else to the grid.
    const w = stock ? WIDTHS[stock] : Object.values(WIDTHS).includes(want) ? want : Math.max(160, Math.min(SPACE, snap(want)));
    if (used + w > SPACE + GAP) break;
    used += w + GAP;
    const edits = stock && pl.edits && typeof pl.edits === 'object' ? {
      hide: Array.isArray(pl.edits.hide) ? pl.edits.hide.filter(s => typeof s === 'string').slice(0, 64) : [],
      move: Object.fromEntries(Object.entries(pl.edits.move || {}).filter(([, v]) => Array.isArray(v) && v.length === 4).slice(0, 64)
        .map(([k, v]) => [k, v.map(n => snap(num(n)))])),
    } : { hide: [], move: {} };
    plates.push({ stock, w, title: str(pl?.title, 24), edits, add: (Array.isArray(pl?.add) ? pl.add : []).slice(0, 48).map(it => cleanItem(it, w)).filter(Boolean) });
  }
  if (!plates.length) return null;
  return {
    format: FORMAT, id, name: str(p.name, 24) || 'My page', from: str(p.from, 40) || null, module: str(p.module, 16) || null,
    ships: Array.isArray(p.ships) ? p.ships.filter(s => typeof s === 'string').slice(0, 12) : [], plates,
    // Fit grows the page to fill a bigger screen; Actual size keeps it as designed. Unset follows Settings.
    size: p.size === 'fit' || p.size === 'actual' ? p.size : null,
  };
}

/** A fresh id for a page. */
export const newId = (rand = Math.random) => `my-${Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('')}`;

/** A page that starts as a copy of a curated ship page: its four stock plates, no edits. */
export const duplicate = (from, name, module, id = newId()) => cleanPage({ id, name, from, module, plates: STOCK.map(stock => ({ stock })) });
/** A blank page: one plate of yours, as wide as the console's role plate. */
export const blank = (name, id = newId()) => cleanPage({ id, name, plates: [{ w: WIDTHS.role, title: name }] });

/** Plates' left edges on the stage, left to right with the stock gap. */
export function lefts(page) {
  let x = LEFT;
  return page.plates.map(p => { const l = x; x += p.w + GAP; return l; });
}

/** The custom page linked to this Game.log ship, if any (the longest matching class wins). */
export function pageForShip(pages, model) {
  if (!model) return null;
  let best = null, len = 0;
  for (const p of pages) for (const s of p.ships) if ((model === s || model.startsWith(s + '_')) && s.length > len) { best = p; len = s.length; }
  return best;
}
