// The console on a phone: one plate at a time, at a size a thumb can use.
//
// The plates are the console's own, built for a 2560 x 720 strip. A plate that fits the
// phone at 60% or more shows whole. A wider or taller one is folded: its controls are grouped
// by the gaps between them (an XY cut), and the groups are laid out again in one or two views
// that fit the phone, upright or sideways. Nothing is redrawn: each control just moves.
// A rail along the bottom (the side, held sideways) steps through the views; swipes count
// only on the rail, since the plates have sliders and levers of their own.

const $ = id => document.getElementById(id);
const PAD = { x: 16, top: 44, bottom: 20 };
const GAP = 8;
const WHOLE = 0.6; // a whole plate is fine down to this scale
const GOOD = 0.78; // a folded plate aims for at least this
const MAX_VIEWS = 3;
const MAX_S = 2; // a plate grows up to twice its size on a tablet
const FLOW = 0.85; // the scale a narrowed text screen is shown at
const FLOWS = /\b(screen|cm-head|cm-foot|lab)\b/;
const SKIP = /\b(screw|title|rtitle|pager|swipe-hint|grab)\b/;

let ctx = null; // { stage, current(), plateName(el), onSettings() }
let cur = { plate: null, view: 0 }; // what shows: a plate key and a view of it
// The last view on each page, kept on the device so it reopens where you left it.
let seen = {}, page = null;
try { seen = JSON.parse(localStorage.getItem('ph-seen') || '{}'); } catch { seen = {}; }
let me = { plate: 'swipe', mode: 'copy', name: '' };
let scale = 1;
let views = []; // [{ key, el, label, fold }]
let mini = null;

/** The plate's controls, with their boxes in plate coordinates. */
function items(plate) {
  const out = [];
  for (const el of plate.children) {
    if (SKIP.test(el.className) || el.classList.contains('ph-mini')) continue;
    // An empty text strip would make a view of its own.
    if (FLOWS.test(el.className) && !el.children.length && !el.textContent.trim()) { el.dataset.phempty = ''; continue; }
    delete el.dataset.phempty;
    let x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
    // A hidden twin (self repair in place of flight ready) still has its place.
    if (!w && !h) {
      x = parseFloat(el.style.left) || 0; y = parseFloat(el.style.top) || 0;
      w = parseFloat(el.style.width) || 0; h = parseFloat(el.style.height) || 0;
      if (!w || !h) continue;
    }
    out.push({ els: [el], x, y, w, h });
  }
  for (const it of out) it.at = new Map([[it.els[0], [0, 0]]]);
  // A placard belongs with what is under it.
  for (const p of out.filter(i => i.els[0].classList.contains('placard'))) {
    const below = out.filter(i => i !== p && i.y >= p.y + p.h - 4 && i.y - (p.y + p.h) < 30 && i.x < p.x + p.w && i.x + i.w > p.x)
      .sort((a, b) => a.y - b.y)[0];
    if (!below) continue;
    below.els.unshift(...p.els);
    const x0 = Math.min(p.x, below.x), y0 = p.y, x1 = Math.max(p.x + p.w, below.x + below.w), y1 = below.y + below.h;
    below.at = new Map([...p.at, ...below.at].map(([el, [dx, dy]]) => [el, [dx + (p.at.has(el) ? p.x : below.x) - x0, dy + (p.at.has(el) ? p.y : below.y) - y0]]));
    Object.assign(below, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    out.splice(out.indexOf(p), 1);
  }
  return out;
}

/** The height a bar (buttons that wrap) takes at width w. */
function autoHeight(el, w) {
  const kw = el.style.width, kh = el.style.height, kr = el.style.right;
  el.style.width = `${w}px`; el.style.height = 'auto'; el.style.right = 'auto';
  const h = el.offsetHeight;
  el.style.width = kw; el.style.height = kh; el.style.right = kr;
  return h;
}
/** The height a screen's content takes at width w, for screens that lay out again when narrow. */
function narrowHeight(el, w) {
  const keep = el.style.width;
  el.style.width = `${w}px`;
  const h = el.scrollHeight;
  el.style.width = keep;
  return h;
}

const box = list => {
  const x0 = Math.min(...list.map(i => i.x)), y0 = Math.min(...list.map(i => i.y));
  const x1 = Math.max(...list.map(i => i.x + i.w)), y1 = Math.max(...list.map(i => i.y + i.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Splits items where a clear gap runs across them, along x or y. Boxes shrink a little, so a dial's frame can overlap its neighbours. */
function segments(list, axis) {
  const SH = 8;
  const a = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'w' : 'h';
  const sorted = [...list].sort((p, q) => p[a] - q[a]);
  const groups = [];
  let end = -Infinity, gap = 0;
  for (const it of sorted) {
    const from = it[a] + Math.min(SH, it[s] / 4), to = it[a] + it[s] - Math.min(SH, it[s] / 4);
    if (from >= end) { if (groups.length) gap = Math.max(gap, from - end); groups.push([it]); } else groups.at(-1).push(it);
    end = Math.max(end, to);
  }
  return { groups, gap };
}

/** The XY-cut tree of a plate. */
function tree(list) {
  const b = box(list);
  if (list.length > 1) {
    const sx = segments(list, 'x'), sy = segments(list, 'y');
    const pick = sx.groups.length > 1 && (sy.groups.length < 2 || sx.gap >= sy.gap) ? ['x', sx] : sy.groups.length > 1 ? ['y', sy] : null;
    if (pick) return { ...b, dir: pick[0], kids: pick[1].groups.map(tree) };
  }
  return { ...b, items: list };
}

const fits = (n, mw, mh) => n.w <= mw && n.h <= mh;
/** Breaks the tree down until every piece fits mw x mh, or can't be broken further. */
function pieces(n, mw, mh) {
  if (fits(n, mw, mh) || !n.kids) return [n];
  return n.kids.flatMap(k => pieces(k, mw, mh));
}
const leaves = n => n.kids ? n.kids.flatMap(leaves) : n.items;

/** Rows: pieces left to right, a new row when full. Each piece goes to the first view with room, so
 *  two narrow columns can share a view while the wide dial between them gets its own. */
function shelves(ps, mw, mh) {
  const vs = [];
  for (const p of ps) {
    let v = vs.find(v => (v.x === 0 || v.x + p.w <= mw) && v.y + p.h <= mh) || vs.find(v => v.y + v.rowH + GAP + p.h <= mh && v.x);
    if (v && v.x && v.x + p.w > mw) { settle(v); v.y += v.rowH + GAP; v.x = 0; v.rowH = 0; }
    if (!v) { v = { items: [], x: 0, y: 0, rowH: 0, row: [] }; vs.push(v); }
    const c = { p, x: v.x, y: v.y };
    v.items.push(c); v.row.push(c);
    v.x += p.w + GAP; v.rowH = Math.max(v.rowH, p.h);
  }
  vs.forEach(settle);
  return vs.map(v => v.items);
}
/** A row's pieces line up at the bottom when only a placard makes one taller. */
function settle(v) {
  for (const c of v.row) { const d = v.rowH - c.p.h; if (d > 0 && d < 40) c.y += d; }
  v.row = [];
}
/** Columns: pieces top to bottom, a new column when full; first view with room, as above. */
function columns(ps, mw, mh) {
  const vs = [];
  for (const p of ps) {
    let v = vs.find(v => (v.y === 0 || v.y + p.h <= mh) && v.x + p.w <= mw) || vs.find(v => v.x + v.colW + GAP + p.w <= mw && v.y);
    if (v && v.y && v.y + p.h > mh) { v.x += v.colW + GAP; v.y = 0; v.colW = 0; }
    if (!v) { v = { items: [], x: 0, y: 0, colW: 0 }; vs.push(v); }
    v.items.push({ p, x: v.x, y: v.y });
    v.y += p.h + GAP; v.colW = Math.max(v.colW, p.w);
  }
  return vs.map(v => v.items);
}
const extent = v => ({ w: Math.max(...v.map(c => c.x + c.p.w)), h: Math.max(...v.map(c => c.y + c.p.h)) });

/** How to show a plate in an aw x ah area: whole, or folded into views. */
export function plan(plate, aw, ah) {
  const W = plate.offsetWidth, H = plate.offsetHeight;
  const whole = Math.min(aw / W, ah / H);
  if (whole >= WHOLE) return { whole: true, views: [null], scales: [Math.min(whole, MAX_S)] };
  const list = items(plate);
  if (!list.length) return { whole: true, views: [null], scales: [whole] };
  // Text screens (log, prices, timers) flow: a wide one narrows to the phone and grows taller.
  const tw = Math.floor(aw / FLOW - PAD.x * 2), th = Math.floor(ah / FLOW - PAD.top - PAD.bottom);
  for (const it of list) {
    // A gauge (the Gauges pages draw to scale) shrinks whole to the phone's width: nothing in it
    // is cut, and its words stay words.
    if (it.els.length === 1 && it.els[0].classList.contains('tl-slot') && it.w > tw) {
      const z = tw / it.w, nh = Math.round(it.h * z), dw = it.w - tw, dh = nh - it.h, right = it.x + it.w, bottom = it.y + it.h;
      for (const o of list) {
        if (o === it) continue;
        if (o.x >= right - 4 && o.y < bottom && o.y + o.h > it.y) o.x -= dw;
        if (o.y >= bottom - 4) o.y += dh;
      }
      Object.assign(it, { w: tw, h: nh, zoom: z });
      continue;
    }
    if (it.els.length !== 1 || !FLOWS.test(it.els[0].className) || it.w <= tw) continue;
    const c = it.els[0].className, bar = /\bcm-(head|foot)\b/.test(c);
    it.rh = /\blab\b/.test(c) ? Math.ceil(it.h * 1.4 * Math.ceil(it.w / tw)) : bar ? Math.max(it.h, autoHeight(it.els[0], tw)) : it.h < 200 ? Math.min(th, Math.max(it.h, Math.round(it.h * it.w / tw * 0.7))) : it.h;
    // A big screen with a narrow layout of its own (prices, hangar) says how tall it gets.
    if (/\bscreen\b/.test(c) && it.h >= 200) {
      const nh = narrowHeight(it.els[0], tw);
      it.els[0].dataset.phnh = `${tw}:${nh}`;
      it.rh = Math.max(it.rh, nh);
    }
    // What sat right of it or under it closes up or moves down.
    const dw = it.w - tw, dh = it.rh - it.h, right = it.x + it.w, bottom = it.y + it.h;
    for (const o of list) {
      if (o === it) continue;
      if (o.x >= right - 4 && o.y < bottom && o.y + o.h > it.y) o.x -= dw;
      if (o.y >= bottom - 4) o.y += dh;
    }
    it.rw = tw; it.w = tw; it.h = it.rh;
  }
  const root = tree(list);
  let best = null;
  for (let s = 1.1; s >= 0.5; s -= 0.04) {
    const mw = aw / s - PAD.x * 2, mh = ah / s - PAD.top - PAD.bottom;
    const ps = pieces(root, mw, mh);
    for (const pack of [shelves, columns]) {
      const vs = pack(ps, mw, mh);
      if (vs.length > MAX_VIEWS) continue;
      const scales = vs.map(v => { const e = extent(v); return Math.min(aw / (e.w + PAD.x * 2), ah / (e.h + PAD.top + PAD.bottom), MAX_S); });
      const low = Math.min(...scales);
      // Below GOOD, size wins over fewer views.
      const score = (low >= GOOD ? -low : 10 + (GOOD - low) * 30) + vs.length * 2;
      if (!best || score < best.score) best = { score, views: vs, scales };
    }
  }
  if (!best || Math.min(...best.scales) <= whole) return { whole: true, views: [null], scales: [whole] };
  return { whole: false, views: best.views, scales: best.scales };
}

// ---------- applying a view ----------

function remember(el) {
  if (el.dataset.phx !== undefined) return;
  el.dataset.phx = el.style.left; el.dataset.phy = el.style.top;
  el.dataset.phw = el.style.width; el.dataset.phh = el.style.height; el.dataset.phz = el.style.zoom;
}
function restore(el) {
  if (el.dataset.phx === undefined) return;
  el.style.left = el.dataset.phx; el.style.top = el.dataset.phy;
  el.style.width = el.dataset.phw; el.style.height = el.dataset.phh; el.style.zoom = el.dataset.phz || '';
  delete el.dataset.phx; delete el.dataset.phy; delete el.dataset.phw; delete el.dataset.phh; delete el.dataset.phz;
}

/** Puts a plate back as the console built it. */
export function unfold(plate) {
  if (!plate.classList.contains('ph-folded')) return;
  for (const el of plate.querySelectorAll(':scope > *')) { restore(el); el.classList.remove('ph-hide'); }
  restore(plate);
  plate.classList.remove('ph-folded');
}

/** Where the console put an element, also when it is hidden. */
const origin = el => (el.offsetWidth || el.offsetHeight ? [el.offsetLeft, el.offsetTop] : [parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0]);

/** Lays out one view of a folded plate: its pieces move, everything else hides. */
function fold(plate, view) {
  remember(plate);
  plate.classList.add('ph-folded');
  const W0 = plate.offsetWidth, H0 = plate.offsetHeight;
  const keep = new Set();
  const moves = [];
  for (const { p, x, y } of view) {
    for (const it of leaves(p)) {
      for (const el of it.els) {
        const [dx, dy] = it.at.get(el);
        moves.push([el, it.x + dx - p.x + PAD.x + x, it.y + dy - p.y + PAD.top + y, it.rw, it.rh, it.zoom]);
        keep.add(el);
      }
    }
  }
  for (const [el, l, t, w, h, z] of moves) {
    remember(el);
    // A zoomed element's own left and top are zoomed too.
    const k = z || 1;
    if (z) el.style.zoom = String(z);
    el.style.left = `${l / k}px`; el.style.top = `${t / k}px`;
    if (w) { el.style.width = `${w}px`; el.style.height = `${h}px`; }
  }
  const e = extent(view);
  const W = e.w + PAD.x * 2, H = e.h + PAD.top + PAD.bottom;
  for (const el of plate.children) {
    if (keep.has(el)) { el.classList.remove('ph-hide'); continue; }
    const c = el.className;
    if (/\bscrew\b/.test(c)) {
      const [l, t] = origin(el);
      remember(el);
      if (l > W0 / 2) el.style.left = `${W - (W0 - l)}px`;
      if (t > H0 / 2) el.style.top = `${H - (H0 - t)}px`;
    } else if (/\b(title|rtitle)\b/.test(c)) {
      el.classList.remove('ph-hide');
    } else el.classList.add('ph-hide');
  }
  plate.style.width = `${W}px`;
  plate.style.height = `${H}px`;
}

/**
 * The page editor's phone preview: copies of a plate laid out as a phone shows it in an
 * aw x ah area, one per view, each with its scale. `host` holds them (they need layout).
 */
export function previewPlate(plate, aw, ah, host) {
  const copy = () => { const c = plate.cloneNode(true); c.style.left = '0px'; c.style.top = '0px'; c.style.translate = ''; host.appendChild(c); return c; };
  const first = copy();
  const p = plan(first, aw, ah);
  first.remove();
  return p.views.map((v, i) => {
    const c = copy();
    const q = plan(c, aw, ah);
    if (!q.whole && q.views[i]) fold(c, q.views[i]);
    return { el: c, scale: q.scales[i] ?? q.scales[0] };
  });
}

// ---------- the phone screen ----------

// Short names, so a rail label stays on one line with its view number.
const NAMES = { status: 'Status', power: 'Power', role: 'Role', flight: 'Flight', gear: 'Gear', commodities: 'Prices', 'comms and map': 'Comms' };
const keyOf = el => el.id === 'status' ? 'status' : el.dataset.slot || el.querySelector(':scope > .title')?.textContent.trim().toLowerCase() || 'plate';
const nameOf = el => NAMES[keyOf(el)] || el.querySelector(':scope > .title')?.textContent.trim() || el.querySelector(':scope > .rtitle span')?.textContent.trim() || 'Plate';

let probe = null;
/** The screen's safe area (notch, home bar), read through a probe since env() doesn't reach JS. */
function insets() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

function area() {
  const land = innerWidth > innerHeight;
  const { t, b, l, r } = insets();
  if (land) {
    const railW = 72;
    const x0 = Math.max(l, 6);
    return { land, x: x0 + railW + 6, y: Math.max(t, 6), w: innerWidth - x0 - Math.max(r, 6) - railW - 6, h: innerHeight - Math.max(t, 6) - Math.max(b, 6) };
  }
  const top = 44, rail = 64;
  return { land, x: Math.max(l, 6), y: t + top, w: innerWidth - Math.max(l, 6) - Math.max(r, 6), h: innerHeight - t - top - Math.max(b, 8) - rail };
}

/** Rebuilds the list of views for the page showing, and shows the current one. */
export function layout() {
  if (!ctx) return;
  const a = area();
  document.body.classList.toggle('ph-land', a.land);
  const plates = [$('status'), ...$('console').querySelectorAll(':scope > .plate')];
  for (const p of plates) { unfold(p); p.classList.remove('ph-on'); }
  const now = ctx.current?.() ?? null;
  if (now !== page) { page = now; if (me.plate === 'swipe') cur = { plate: null, view: 0, ...seen[page] }; }
  // A phone given one plate of the ship page keeps to it, where the page has it.
  const pinned = me.plate !== 'swipe' && plates.some(p => keyOf(p) === me.plate) ? me.plate : null;
  views = [];
  for (const p of plates) {
    if (pinned && keyOf(p) !== pinned) continue;
    const pl = plan(p, a.w, a.h);
    pl.views.forEach((v, i) => views.push({ key: keyOf(p), el: p, fold: v, s: pl.scales[i], label: nameOf(p) + (pl.views.length > 1 ? ` ${i + 1}` : '') }));
  }
  let i = views.findIndex(v => v.key === cur.plate && views.filter(w => w.key === v.key).indexOf(v) === cur.view);
  if (i < 0) i = Math.max(0, views.findIndex(v => v.key === cur.plate));
  if (i < 0 || !views[i]) i = 0;
  showView(i, a);
  paintRail(i, pinned);
}

function showView(i, a = area()) {
  const v = views[i];
  if (!v) return;
  cur = { plate: v.key, view: views.filter(w => w.key === v.key).indexOf(v) };
  if (page !== null && me.plate === 'swipe') {
    seen[page] = cur;
    try { localStorage.setItem('ph-seen', JSON.stringify(seen)); } catch { /* private mode: not kept */ }
  }
  const plates = [$('status'), ...$('console').querySelectorAll(':scope > .plate')];
  for (const p of plates) { if (p !== v.el) unfold(p); p.classList.toggle('ph-on', p === v.el); }
  unfold(v.el);
  if (v.fold) fold(v.el, v.fold);
  const W = v.el.offsetWidth, H = v.el.offsetHeight;
  // Room left under a short plate holds where you are and the mission (upright only).
  const s = Math.min(a.w / W, a.h / H, MAX_S);
  let y = a.y + (a.h - H * s) / 2;
  const room = a.h - H * s;
  const showMini = !a.land && v.key !== 'status' && room > 150 && paintMini();
  mini.hidden = !showMini;
  if (showMini) {
    const mh = Math.min(room - 12, 260);
    mini.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${mh}px`;
    y = a.y + mh + 8 + (a.h - mh - 8 - H * s) / 2;
  }
  scale = s;
  // The plate's place on the stage, so the camera can point at it.
  const ox = v.el.offsetLeft + (v.el.offsetParent === ctx.stage ? 0 : v.el.offsetParent.offsetLeft);
  const oy = v.el.offsetTop + (v.el.offsetParent === ctx.stage ? 0 : v.el.offsetParent.offsetTop);
  const x = a.x + (a.w - W * s) / 2;
  ctx.stage.style.transform = `translate(${x - ox * s}px, ${y - oy * s}px) scale(${s})`;
  document.body.dataset.phView = v.label;
}

function paintMini() {
  const txt = id => { const e = $(id); return e && !e.closest('[hidden]') ? e.textContent.trim() : ''; };
  const where = txt('where-name'), note = txt('where-note') || txt('qt-name'), obj = txt('mission-obj'), mt = txt('mission-text');
  if (!where && !obj) return false;
  mini.innerHTML = (where ? `<div><small>Location</small><b></b><span class="qt"></span></div>` : '') + (obj ? `<div><small>Mission</small><b></b><span></span></div>` : '');
  const blocks = mini.querySelectorAll('div');
  let k = 0;
  if (where) { blocks[k].querySelector('b').textContent = where; blocks[k].querySelector('span').textContent = note; k++; }
  if (obj) { blocks[k].querySelector('b').textContent = obj; blocks[k].querySelector('span').textContent = mt; }
  return true;
}

let rail;
function paintRail(i, pinned) {
  rail.replaceChildren(...views.map((v, k) => {
    const b = document.createElement('button');
    b.textContent = v.label;
    b.className = k === i ? 'cur' : '';
    b.addEventListener('click', () => go(k));
    return b;
  }));
  rail.hidden = views.length < 2;
  rail.dataset.n = views.length;
  // Whole words only: a long name gets a smaller type rather than a break.
  for (const b of rail.children) {
    b.style.fontSize = '';
    for (let f = parseFloat(getComputedStyle(b).fontSize); f > 7 && b.scrollWidth > b.clientWidth; f -= 0.5) b.style.fontSize = `${f - 0.5}px`;
  }
  $('ph-pin').hidden = !pinned;
  $('ph-pin-name').textContent = pinned ? NAMES[pinned] || pinned : '';
}

function go(k) {
  if (!views[k]) return;
  ctx.tick?.('page');
  showView(k);
  [...rail.children].forEach((b, j) => b.classList.toggle('cur', j === k));
}

/** Steps with a swipe along the rail. */
function swipeRail() {
  let x0 = null, y0 = null, done = false;
  rail.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; done = false; });
  rail.addEventListener('pointermove', e => {
    if (x0 === null || done) return;
    const land = document.body.classList.contains('ph-land');
    const d = land ? e.clientY - y0 : e.clientX - x0;
    if (Math.abs(d) < 48) return;
    done = true;
    const i = views.findIndex(v => v.key === cur.plate && views.filter(w => w.key === v.key).indexOf(v) === cur.view);
    go(Math.max(0, Math.min(views.length - 1, i + (d < 0 ? 1 : -1))));
  });
  for (const ev of ['pointerup', 'pointercancel']) rail.addEventListener(ev, () => { x0 = null; });
}

export const phoneScale = () => scale;

let lastMini = '';
/** The status changed: the strip under a short plate follows it, without refolding the plate. */
export function refresh() {
  if (!ctx || !views.length) return;
  const txt = id => { const e = $(id); return e && !e.closest('[hidden]') ? e.textContent.trim() : ''; };
  const now = ['where-name', 'where-note', 'qt-name', 'mission-obj', 'mission-text'].map(txt).join('|');
  if (now === lastMini) return;
  lastMini = now;
  const i = views.findIndex(v => v.key === cur.plate && views.filter(w => w.key === v.key).indexOf(v) === cur.view);
  showView(Math.max(0, i));
}

/** A screen's content changed (new prices, a sync): lays out again if its narrow height changed or an empty strip filled. */
export function repainted(els) {
  if (!ctx) return;
  for (const el of els) {
    // A strip that was empty when the plate was laid out has content now.
    if (el && el.dataset.phempty !== undefined && el.textContent.trim()) { ctx.fit(); return; }
    const m = el?.dataset.phnh?.split(':');
    if (!m) continue;
    // Folded, the screen already has the narrow width.
    const nh = el.closest('.ph-folded') ? el.scrollHeight : narrowHeight(el, +m[0]);
    if (Math.abs(nh - Math.max(+m[1], 0)) > 4) { ctx.fit(); return; }
  }
}

/** This phone's plate and mode, as the PC has them. */
export function configure(c) {
  me = { ...me, ...c };
  if (me.plate !== 'swipe') cur = { plate: me.plate, view: 0 };
  ctx?.fit();
}

/** Every plate, rather than one: a big screen shows the whole console. */
export const allPlates = () => me.plate === 'swipe';

/** Leaves phone layout for the whole console. */
export function clear() {
  for (const p of [$('status'), ...$('console').querySelectorAll(':scope > .plate')]) { unfold(p); p.classList.remove('ph-on'); }
  if (mini) mini.hidden = true;
  views = [];
}

export function init(c) {
  ctx = c;
  document.body.classList.add('phone');
  const chrome = document.createElement('div');
  chrome.className = 'ph-chrome';
  chrome.innerHTML = `<header class="ph-top" id="ph-top"><span class="ph-link" id="ph-link"><i></i><span id="ph-link-t">LINK</span></span>
    <span class="ph-pin" id="ph-pin" hidden><svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span id="ph-pin-name"></span></span>
    <span class="ph-ship" id="ph-ship"></span>
    <button class="ph-gear" id="ph-gear" aria-label="This device"><svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg></button></header>
    <div class="ph-mini" id="ph-mini" hidden></div>
    <nav class="ph-rail" id="ph-rail"></nav>`;
  document.body.appendChild(chrome);
  rail = $('ph-rail'); mini = $('ph-mini');
  swipeRail();
  $('ph-gear').addEventListener('click', () => ctx.onSettings?.());
  // Rotating sometimes reports the new size a moment late.
  addEventListener('orientationchange', () => setTimeout(() => ctx.fit(), 250));
}

/** The link light and the ship name in the top bar. */
export function paintTop({ state, rtt, ship }) {
  const l = $('ph-link');
  if (!l) return;
  l.dataset.state = state;
  $('ph-link-t').textContent = state === 'ok' ? (rtt != null ? `LINK ${rtt} ms` : 'LINK') : state === 'offline' ? 'NO LINK' : 'LINKING';
  if (ship !== undefined) $('ph-ship').textContent = ship || '';
}

// ---------- pairing and the link ----------

let pairEl = null, code = '';
/** Covers the console while the phone pairs, or while the PC can't be reached. */
export function linkScreen(state, error) {
  if (!pairEl) {
    pairEl = document.createElement('div');
    pairEl.className = 'ph-pair';
    pairEl.innerHTML = `<img class="logo" src="icon-192.png" alt=""><h1>EDGE <span>COCKPIT</span></h1>
      <div class="ph-pairing"><h2>Pair this device</h2><p>Enter the code shown in Settings › Devices on the PC.</p>
        <div class="digits">${'<i></i>'.repeat(6)}</div><p class="err" id="ph-err"></p>
        <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="k" data-k="c">Clear</button><button data-k="0">0</button><button class="k" data-k="b">Back</button></div>
        <p class="hint">On a phone, add it to your home screen (Share › Add to Home Screen) to open it full screen.</p></div>
      <div class="ph-wait"><h2 id="ph-wait-t">Looking for the PC</h2><p>Edge Cockpit must be running, with Devices on in Settings, on the same network.</p></div>`;
    document.body.appendChild(pairEl);
    pairEl.querySelectorAll('.pad button').forEach(b => b.addEventListener('click', () => {
      ctx?.tick?.('tap');
      const k = b.dataset.k;
      if (k === 'c') code = ''; else if (k === 'b') code = code.slice(0, -1); else if (code.length < 6) code += k;
      paintDigits();
      if (code.length === 6) { window.__EC_PHONE__?.pair(code); code = ''; setTimeout(paintDigits, 400); }
    }));
  }
  pairEl.hidden = state === 'ok';
  pairEl.dataset.state = state;
  $('ph-err').textContent = error || '';
  $('ph-wait-t').textContent = state === 'offline' ? 'The PC is out of reach' : 'Looking for the PC';
  paintDigits();
}
function paintDigits() {
  pairEl?.querySelectorAll('.digits i').forEach((d, i) => { d.textContent = code[i] || ''; d.classList.toggle('c', i === code.length); });
}

// ---------- this phone's settings ----------

const PLATE_OPTS = [['swipe', 'All'], ['status', 'Status'], ['power', 'Power'], ['role', 'Role'], ['flight', 'Flight'], ['gear', 'Gear']];
let sheet = null;
const ONOFF = [['on', 'On'], ['off', 'Off']];
/** This phone's own settings: its plate, Copy or Move, touch feedback, unpair. */
export function openSettings({ set, opts, setOpt, vibrates }) {
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.className = 'ph-sheet';
    document.body.appendChild(sheet);
  }
  const seg = (name, list, v) => `<span class="seg" data-seg="${name}">${list.map(([k, l]) => `<button data-v="${k}" class="${k === v ? 'cur' : ''}">${l}</button>`).join('')}</span>`;
  sheet.innerHTML = `<div class="ph-card"><button class="close" aria-label="Close"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <small>This device</small><h3>${(me.name || 'Device').replace(/[<>&]/g, '')}</h3>
    <h4>Shows</h4>${seg('plate', PLATE_OPTS, me.plate)}
    <p class="note">All shows every plate: the whole console when the screen is big enough, otherwise one at a time with the rail. A plate keeps this device on it.</p>
    <h4>On the PC's screen</h4>${seg('mode', [['copy', 'Copy'], ['move', 'Move']], me.mode)}
    <p class="note">Move takes the plate off the PC's screen while this device is connected.</p>
    <h4>Feedback</h4>
    <div class="fb-row"><span>Mute all</span>${seg('mute', ONOFF, opts.mute ? 'on' : 'off')}</div>
    <div class="fb-row"><span>Click sound</span>${seg('sound', ONOFF, opts.sound ? 'on' : 'off')}</div>
    <div class="fb-row"><span>Alert sound</span>${seg('alertSound', ONOFF, opts.alertSound ? 'on' : 'off')}</div>
    ${vibrates ? `<div class="fb-row"><span>Vibration</span>${seg('vibrate', ONOFF, opts.vibrate ? 'on' : 'off')}</div>
    <p class="note">A short buzz under your finger on every press. On iPhone, one light tick when you lift your finger.</p>` : ''}
    <div class="row"><button class="act" id="ph-unpair">Unpair this device</button></div></div>`;
  sheet.hidden = false;
  sheet.querySelector('.close').addEventListener('click', () => { sheet.hidden = true; });
  sheet.querySelectorAll('.seg').forEach(sg => sg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    sg.querySelectorAll('button').forEach(x => x.classList.toggle('cur', x === b));
    const name = sg.dataset.seg, v = b.dataset.v;
    if (['mute', 'sound', 'alertSound', 'vibrate'].includes(name)) setOpt(name, v === 'on');
    else set(name === 'plate' ? v : null, name === 'mode' ? v : null);
  })));
  sheet.querySelector('.seg[data-seg=mode]').classList.toggle('off', me.plate === 'swipe' || me.plate === 'status');
  sheet.querySelector('#ph-unpair').addEventListener('click', () => { sheet.hidden = true; window.__EC_PHONE__?.forget(); });
}
