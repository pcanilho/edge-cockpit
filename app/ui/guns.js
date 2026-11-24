// The guns the game lists by item class name, made readable: the shop name, maker, size and rated
// stats from the Star Citizen Wiki API (api.star-citizen.wiki), the picture from FleetYards.
// Rated, not measured: the numbers are the item's, labelled with the game version they're for.
const WIKI = 'https://api.star-citizen.wiki/api/v2/items/';
const FY = 'https://api.fleetyards.net/v1/components';
const KEEP_MS = 12 * 3600 * 1000;  // the Wiki's own cache time
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } },
};
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Stats from a Wiki item answer, or null when it isn't a ship weapon. */
export function statsOf(d) {
  const vw = d?.vehicle_weapon;
  if (!vw) return null;
  const dmg = vw.damage || {};
  return {
    burst: num(dmg.burst), sustained: num(dmg.sustained_60s), alpha: num(dmg.alpha_total),
    rpm: num(vw.rpm), range: num(vw.range), speed: num(vw.ammunition?.speed ?? d.ammunition?.speed),
    power: num(d.resource_network?.usage?.power?.max),
    kind: Object.entries(dmg.dps || {}).filter(([, v]) => v > 0).map(([k]) => k)[0] || null,
  };
}
/** '4.10.3-LIVE.13165946' -> '4.10.3-LIVE' */
export const patchOf = v => (typeof v === 'string' ? v.split('.').slice(0, 3).join('.') : null);

const pending = new Map();
async function fetchGun(cls) {
  const r = await fetch(WIKI + encodeURIComponent(cls), { headers: { Accept: 'application/json' } });
  if (r.status === 404) return { cls, name: null };
  if (!r.ok) throw new Error('wiki ' + r.status);
  const j = await r.json(), d = j.data || j;
  const out = { cls, name: d.name || null, maker: d.manufacturer?.name || '', size: d.size ?? null, patch: patchOf(d.version), stats: statsOf(d), img: null };
  // The picture: FleetYards lists components by name; the one with this class name is ours.
  if (out.name) {
    const f = await fetch(`${FY}?perPage=20&q[nameCont]=${encodeURIComponent(out.name)}`).then(x => (x.ok ? x.json() : null)).catch(() => null);
    const hit = (f?.items || []).find(c => c.scKey === cls.toLowerCase());
    out.img = hit?.media?.storeImage?.smallUrl || hit?.media?.storeImage?.url || null;
  }
  return out;
}
/** A gun by class name: { name, maker, size, patch, stats, img }, or { name: null } when unknown. */
export async function gun(cls) {
  const key = 'xfd-gun:' + cls, saved = store.get(key);
  if (saved && Date.now() - saved.at < KEEP_MS) return saved.g;
  if (!navigator.onLine) return saved?.g || null;
  if (!pending.has(cls)) pending.set(cls, fetchGun(cls).catch(() => undefined));
  const g = await pending.get(cls);
  pending.delete(cls);
  if (g === undefined) return saved?.g || null;
  store.set(key, { at: Date.now(), g });
  return g;
}
/** 'KLWE_LaserRepeater_S2_878452447009' -> 'KLWE_LaserRepeater_S2': 5.0 adds the item's instance id. */
export const classOf = name => String(name || '').replace(/_\d{6,}$/, '');
/** 'KLWE_LaserRepeater_S1' -> 'Laser repeater S1': what the class name says, until the Wiki answers. */
export function plainName(cls) {
  const [, t = '', sz = ''] = String(cls).split('_');
  const words = t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1) + (/^S\d+$/.test(sz) ? ' ' + sz : '')).trim() || String(cls);
}
