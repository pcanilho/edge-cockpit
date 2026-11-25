// The system chart's 3D view: our own spheres and rings, laid out by lib/chart.js. Loaded the
// first time the chart page opens. It draws only when something changes (a drag, a new place),
// never in a loop, and gives its graphics memory back when the page closes (dispose).
import { SIZE } from './lib/chart.js';

let lib = null;
const three = () => (lib ||= import('./vendor/three/three.module.js'));

const C = { body: 0x7f8c99, moon: 0x6b7783, star: 0x8f9ba7, ring: 0x262e36, ringMoon: 0x1e252c, mark: 0x56626e, route: 0x8f9ba7, you: 0x58d2f0, pick: 0xe4ebf1 };
const HOME = { yaw: 0, pitch: 52, zoom: 1 };

/** One view in `host`; set({ lay, you, route, pick }) changes what it shows. */
export async function view(host, { onPick } = {}) {
  const T = await three();
  const canvas = document.createElement('canvas');
  canvas.className = 'sc-canvas';
  const labels = document.createElement('div');
  labels.className = 'sc-labels';
  host.prepend(canvas, labels);
  let r;
  try { r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); }
  catch (e) { canvas.remove(); labels.remove(); throw Object.assign(new Error('gpu'), { kind: 'gpu', cause: e }); }
  r.setClearColor(0, 0);
  const scene = new T.Scene(), world = new T.Group(), marks = new T.Group();
  scene.add(new T.AmbientLight(0xffffff, 0.6), world, marks);
  const sun = new T.PointLight(0xffffff, 2.6, 0, 0);
  scene.add(sun);
  const cam = new T.PerspectiveCamera(30, 1, 1, 20_000);
  const st = { ...HOME };
  let lay = null, want = {}, frame = 0, extent = 600, lost = false, nodes = new Map();
  // Shared geometry: one sphere and one octahedron for every body, scaled.
  const sphere = new T.SphereGeometry(1, 20, 14), diamond = new T.OctahedronGeometry(1), torus = new T.TorusGeometry(1, 0.11, 6, 40);
  const mats = {
    star: new T.MeshStandardMaterial({ color: C.star, emissive: C.star, emissiveIntensity: 0.9, roughness: 1 }),
    planet: new T.MeshStandardMaterial({ color: C.body, emissive: C.body, emissiveIntensity: 0.12, roughness: 0.9 }),
    moon: new T.MeshStandardMaterial({ color: C.moon, emissive: C.moon, emissiveIntensity: 0.12, roughness: 0.9 }),
    flat: new T.MeshBasicMaterial({ color: C.mark }),
    ring: new T.LineBasicMaterial({ color: C.ring }), ringMoon: new T.LineBasicMaterial({ color: C.ringMoon }),
    route: new T.LineDashedMaterial({ color: C.route, dashSize: 10, gapSize: 8 }),
    you: new T.MeshBasicMaterial({ color: C.you }), youSoft: new T.MeshBasicMaterial({ color: C.you, transparent: true, opacity: 0.35 }),
    pick: new T.MeshBasicMaterial({ color: C.pick }), goods: new T.MeshBasicMaterial({ color: C.pick, transparent: true, opacity: 0.7 }),
  };
  const circle = new T.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => { const a = i / 96 * Math.PI * 2; return new T.Vector3(Math.cos(a), 0, Math.sin(a)); }));
  const ac = new AbortController(), on = (el, ev, fn, o) => el.addEventListener(ev, fn, { ...o, signal: ac.signal });
  on(canvas, 'webglcontextlost', e => { e.preventDefault(); lost = true; });
  on(canvas, 'webglcontextrestored', () => { lost = false; draw(); });

  function build() {
    for (const g of [world, marks]) g.clear();
    nodes = new Map();
    const star = new T.Mesh(sphere, mats.star);
    star.scale.setScalar(SIZE.star);
    world.add(star);
    for (const g of lay.rings) {
      const l = new T.Line(circle, g.kind === 'moon' ? mats.ringMoon : mats.ring);
      l.position.set(g.x, 0, g.z); l.scale.setScalar(g.r);
      world.add(l);
    }
    for (const n of lay.nodes) {
      const m = n.kind === 'planet' || n.kind === 'moon' ? new T.Mesh(sphere, mats[n.kind])
        : n.kind === 'gateway' ? new T.Mesh(torus, mats.flat) : new T.Mesh(diamond, mats.flat);
      m.position.set(n.x, 0, n.z); m.scale.setScalar(n.r);
      if (n.kind === 'gateway') m.rotation.x = Math.PI / 2;
      world.add(m);
      nodes.set(n.name, n);
    }
    extent = lay.extent || 600;
  }
  let routeGeo = null;
  function decorate() {
    marks.clear();
    routeGeo?.dispose(); routeGeo = null;
    const p = n => new T.Vector3(n.x, 0, n.z);
    const ring = (n, k, mat) => { const m = new T.Mesh(torus, mat); m.position.copy(p(n)); m.rotation.x = Math.PI / 2; m.scale.setScalar(n.r + k); marks.add(m); };
    const a = nodes.get(want.route?.[0]), b = nodes.get(want.route?.[1]);
    if (a && b && a !== b) {
      const mid = p(a).add(p(b)).multiplyScalar(0.5); mid.y += Math.hypot(a.x - b.x, a.z - b.z) * 0.15;
      routeGeo = new T.BufferGeometry().setFromPoints(new T.QuadraticBezierCurve3(p(a), mid, p(b)).getPoints(40));
      const line = new T.Line(routeGeo, mats.route);
      line.computeLineDistances();
      marks.add(line);
    }
    const you = nodes.get(want.you);
    if (you) { ring(you, 6, mats.you); ring(you, 13, mats.youSoft); }
    const pick = nodes.get(want.pick);
    if (pick) ring(pick, you === pick ? 20 : 7, mats.pick);
    for (const g of want.goods || []) { const n = nodes.get(g.body); if (n && n !== pick) ring(n, n === you ? 20 : 7, mats.goods); }
  }

  const draw = () => { if (!frame && r) frame = requestAnimationFrame(paint); };
  function paint() {
    frame = 0;
    if (!lay || lost || !r) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const px = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * px) || canvas.height !== Math.round(h * px)) { r.setPixelRatio(px); r.setSize(w, h, false); }
    const yaw = st.yaw * Math.PI / 180, pit = st.pitch * Math.PI / 180;
    cam.aspect = w / h;
    // Fits the whole system: the rings, tilted by the pitch, inside the view's height and width.
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const fit = Math.max(extent * Math.sin(pit) / tan, extent / (tan * cam.aspect)) * 1.1 + extent * Math.cos(pit) * 0.5;
    const d = fit / st.zoom;
    cam.position.set(Math.sin(yaw) * Math.cos(pit) * d, Math.sin(pit) * d, Math.cos(yaw) * Math.cos(pit) * d);
    cam.near = d / 50; cam.far = d * 4;
    cam.updateProjectionMatrix();
    cam.lookAt(0, 0, 0);
    r.render(scene, cam);
    placeLabels(w, h);
  }

  // Names as HTML over the canvas, so they stay sharp; the most important first, none on top of another.
  const RANK = { you: 0, picked: 1, goods: 1.5, star: 2, planet: 3, gateway: 4, asteroid: 5, moon: 6, lagrange: 9 };
  const v = new T.Vector3();
  function placeLabels(w, h) {
    const lit = new Set([want.you, want.pick, ...(want.goods || []).map(g => g.body)]);
    const list = [{ name: '', label: lay.system, kind: 'star', x: 0, z: 0, r: SIZE.star }, ...lay.nodes.filter(n => n.kind !== 'lagrange' || lit.has(n.name))];
    const price = new Map((want.goods || []).map(g => [g.body, g.text]));
    const items = list.map(n => {
      const tag = n.name && n.name === want.you ? 'you' : n.name && n.name === want.pick ? 'picked' : price.has(n.name) ? 'goods' : n.kind;
      if (price.has(n.name)) n = { ...n, label: `${n.label} · ${price.get(n.name)}` };
      v.set(n.x, 0, n.z).project(cam);
      return { n, tag, rank: RANK[tag], x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, z: v.z };
    }).sort((a, b) => a.rank - b.rank);
    const taken = [], out = [];
    const fs = { you: 15, picked: 15, goods: 14, star: 14, planet: 14, gateway: 12, asteroid: 12, moon: 11, lagrange: 11 };
    for (const it of items) {
      if (it.z > 1 || it.x < 0 || it.x > w || it.y < 0 || it.y > h) continue;
      const moon = it.tag === 'moon' || (it.n.kind === 'moon' && it.rank < 2);
      const wd = it.n.label.length * fs[it.tag] * 0.62 + 8, ht = fs[it.tag] + 4;
      // Clear of the rings round a lit body.
      const off = it.rank < 2 ? 24 : 0;
      const box = moon ? { l: it.x + 8 + off, t: it.y - ht / 2 } : { l: it.x - wd / 2, t: it.y + 12 + off };
      Object.assign(box, { r: box.l + wd, b: box.t + ht });
      if (box.l < 2 || box.r > w - 2 || box.b > h - 2) continue;
      if (taken.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
      taken.push(box);
      out.push(`<span class="sc-l ${it.tag}" style="left:${Math.round(box.l)}px;top:${Math.round(box.t)}px">${it.n.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`);
    }
    const html = out.join('');
    if (labels.innerHTML !== html) labels.innerHTML = html;
  }

  /** What to show: { lay, you, route: [from, to], pick }; only what changed is redone. */
  function set(next) {
    const before = want;
    want = { ...want, ...next };
    if (want.lay !== before.lay) { lay = want.lay; if (lay) build(); }
    const goodsKey = g => (g || []).map(x => x.body + x.text).join('|');
    if (want.lay !== before.lay || want.you !== before.you || want.pick !== before.pick || String(want.route) !== String(before.route) || goodsKey(want.goods) !== goodsKey(before.goods)) { if (lay) decorate(); draw(); }
  }

  // Drag to turn, pinch or wheel to zoom, double-tap to reset, tap a body to pick it.
  const pts = new Map();
  let pinch = 0, moved = 0;
  on(host, 'pointerdown', e => { if (e.target.closest('.well, button')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; host.setPointerCapture?.(e.pointerId); e.stopPropagation(); });
  on(host, 'pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, dd] = [...pts.values()], d1 = Math.hypot(c.x - dd.x, c.y - dd.y);
      if (pinch && d0) st.zoom = Math.max(0.8, Math.min(6, st.zoom * d1 / d0));
      pinch = 1;
    } else {
      st.yaw -= (e.clientX - p.x) * 0.3; st.pitch = Math.max(8, Math.min(89, st.pitch + (e.clientY - p.y) * 0.25));
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    draw();
  });
  const up = e => {
    const tap = pts.has(e.pointerId) && pts.size === 1 && moved < 8 && e.type === 'pointerup';
    pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    if (tap && lay && onPick) onPick(nearest(e));
  };
  on(host, 'pointerup', up); on(host, 'pointercancel', up);
  on(host, 'wheel', e => { e.preventDefault(); st.zoom = Math.max(0.8, Math.min(6, st.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); draw(); }, { passive: false });
  on(host, 'dblclick', () => { Object.assign(st, HOME); draw(); });
  /** The body nearest a tap, within reach of a finger; null for empty space. */
  function nearest(e) {
    const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let best = null, bd = 34;
    for (const n of lay.nodes) {
      v.set(n.x, 0, n.z).project(cam);
      const d = Math.hypot((v.x + 1) / 2 * b.width - x, (1 - v.y) / 2 * b.height - y);
      if (d < bd) { bd = d; best = n.name; }
    }
    return best;
  }
  const ro = new ResizeObserver(draw);
  ro.observe(host);

  /** Frees the GPU: the page closed. The view can't be used after this. */
  function dispose() {
    cancelAnimationFrame(frame); frame = 0;
    ac.abort(); ro.disconnect();
    marks.clear(); world.clear(); routeGeo?.dispose();
    for (const g of [sphere, diamond, torus, circle]) g.dispose();
    for (const m of Object.values(mats)) m.dispose();
    r.dispose(); r.forceContextLoss(); r = null;
    canvas.remove(); labels.remove();
  }
  return { host, set, draw, dispose, state: st };
}
