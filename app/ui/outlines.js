// Ship outlines and renders for the status display, fetched from FleetYards.net the first time a
// ship is seen and kept in the panel's storage after that. Nothing is bundled: the
// fleet chart image (a top view on a transparent background) is turned nose left
// and kept as a plain mask, which the panel paints in the maker's colour; the angled
// render is scaled down and kept for the dimmed backdrop.
const API = 'https://api.fleetyards.net/v1/models';
const RETRY_MS = 7 * 24 * 3600 * 1000; // try again weekly for ships with no outline
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or private */ } },
};

/** 'AEGS_Gladius_Valiant' -> ['aegs-gladius-valiant', 'aegs-gladius'] */
export const slugsOf = cls => {
  const parts = cls.split('_');
  return parts.slice(1).map((_, i) => parts.slice(0, parts.length - i).join('-').toLowerCase());
};

const json = async url => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); return r.ok ? r.json() : null; };

// FleetYards slugs don't always follow the game's class names, but each model lists
// its game id, so a one-off index covers the rest.
let index = null;
async function bySc() {
  if (index) return index;
  const saved = store.get('xfd-fy-index');
  if (saved && Date.now() - saved.at < RETRY_MS) return (index = saved.map);
  const map = {};
  let complete = false;
  for (let page = 1; page < 20; page++) {
    const res = await json(`${API}?perPage=200&page=${page}`).catch(() => null);
    if (!res) break;
    for (const m of res.items || []) if (m.scIdentifier && m.media?.fleetchartImage) map[m.scIdentifier.toLowerCase()] = m.slug;
    if (page >= (res.meta?.pagination?.totalPages || 1)) { complete = true; break; }
  }
  // Offline or a partial answer: keep using the index we had.
  if (!complete && saved) return (index = saved.map);
  if (complete) store.set('xfd-fy-index', { at: Date.now(), map });
  return (index = map);
}

function image(url) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = url;
  });
}

/** The fleet chart as a white mask, cropped and turned nose left, at most 320 px wide. */
function mask(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const scale = Math.min(1, 320 / Math.max(cw, ch));
  // Fleet charts point nose down; a quarter turn clockwise puts the nose on the left.
  const ow = Math.round(ch * scale), oh = Math.round(cw * scale);
  const out = document.createElement('canvas');
  out.width = ow; out.height = oh;
  const o = out.getContext('2d');
  o.translate(ow, 0); o.rotate(Math.PI / 2); o.scale(scale, scale);
  o.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = '#fff';
  o.fillRect(0, 0, ow, oh);
  return { url: out.toDataURL('image/png'), w: ow, h: oh };
}

/** The first FleetYards model for a game class that pick() gets something from, or null. */
async function fromModel(cls, pick) {
  const tried = new Set();
  const attempt = async slug => {
    if (!slug || tried.has(slug)) return null;
    tried.add(slug);
    const m = await json(`${API}/${slug}`);
    return m ? pick(m) : null;
  };
  for (const slug of slugsOf(cls)) { const s = await attempt(slug); if (s) return s; }
  const map = await bySc();
  const parts = cls.toLowerCase().split('_');
  for (let n = parts.length; n >= 2; n--) { const s = await attempt(map[parts.slice(0, n).join('_')]); if (s) return s; }
  return null;
}
const fetchOutline = cls => fromModel(cls, async m => (m.media?.fleetchartImage ? mask(await image(m.media.fleetchartImage)) : null));

/** The ship's angled render (or store image), at most 560 px wide, as a WebP data URL. */
async function shot(m) {
  const v = m.media?.angledView || m.media?.storeImage;
  const src = v?.mediumUrl || v?.url || (typeof v === 'string' ? v : null);
  if (!src) return null;
  const img = await image(src);
  const scale = Math.min(1, 560 / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.8);
}

const pending = new Map();
/** Markup for a ship's outline, or null when there is none (offline, or no fleet chart). */
export async function outline(cls) {
  const key = 'xfd-outline:' + cls;
  const saved = store.get(key);
  let shape = saved?.shape;
  if (!saved || (!shape && Date.now() - saved.at > RETRY_MS)) {
    if (!navigator.onLine) return null;
    if (!pending.has(cls)) pending.set(cls, fetchOutline(cls).catch(() => undefined));
    shape = await pending.get(cls);
    pending.delete(cls);
    if (shape === undefined) return null; // a network error: try again next time
    store.set(key, { at: Date.now(), shape });
  }
  if (!shape) return null;
  return `<div class="ol" style="aspect-ratio:${shape.w}/${shape.h};-webkit-mask-image:url(${shape.url});mask-image:url(${shape.url})"></div>`;
}

const pendingShots = new Map();
/** A data URL of the ship's render for the status backdrop, or null (offline, or none). Kept after the first fetch. */
export async function render(cls) {
  const key = 'xfd-render:' + cls;
  const saved = store.get(key);
  let url = saved?.url;
  if (!saved || (!url && Date.now() - saved.at > RETRY_MS)) {
    if (!navigator.onLine) return null;
    if (!pendingShots.has(cls)) pendingShots.set(cls, fromModel(cls, shot).catch(() => undefined));
    url = await pendingShots.get(cls);
    pendingShots.delete(cls);
    if (url === undefined) return null;
    store.set(key, { at: Date.now(), url });
  }
  return url || null;
}
