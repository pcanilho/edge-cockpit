// The Ship page's 3D view: the FleetYards model of the ship you sit in, turned with a finger.
// The shield shell glows with the one shield value the game sends, the hull tints as hull drops,
// the ship goes dark with the power plant off, and the landed or flight model follows the gear.
// Paint is the user's pick: the game doesn't say which one is on the ship. Nothing is bundled:
// models and textures come from FleetYards the first time and are kept in the browser cache.
// It draws only when something changes (a drag, a new value), never in a loop.
const CACHE = 'ec-models-v1';
let lib = null;
async function three() {
  if (!lib) lib = (async () => {
    const [T, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
      import('./vendor/three/three.module.js'), import('./vendor/three/GLTFLoader.js'), import('./vendor/three/DRACOLoader.js')]);
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('vendor/three/draco/'));
    return { T, loader };
  })();
  return lib;
}

/** A failure that says which step went wrong: 'net', 'http' (with the status), 'file' or 'gpu'. */
const oops = (kind, cause, status) => Object.assign(new Error(kind), { kind, cause, status });

/** A file from FleetYards, from the cache when it was fetched before. */
async function cached(url) {
  let c = null;
  try { c = await caches.open(CACHE); } catch { /* no Cache API: straight from the network */ }
  const hit = c && await c.match(url).catch(() => null);
  if (hit) return hit.blob();
  let res;
  try { res = await fetch(url); } catch (e) { throw oops('net', e); }
  if (!res.ok) throw oops('http', null, res.status);
  if (c) await c.put(url, res.clone()).catch(() => {});
  try { return await res.blob(); } catch (e) { throw oops('net', e); }
}
/** Drops a cached file that turned out unreadable, so a retry downloads it again. */
const forget = url => caches.open(CACHE).then(c => c.delete(url)).catch(() => {});

/** What the view says when the model can't be shown. Every line fits the Edge in full. */
function why(e) {
  if (e.kind === 'http') return `FleetYards didn't send the 3D model (error ${e.status})`;
  if (e.kind === 'file') return 'The 3D model file from FleetYards couldn\'t be read';
  if (e.kind === 'gpu') return 'This screen\'s graphics can\'t draw 3D';
  if (e.kind === 'lost') return 'The graphics driver reset the 3D view';
  return navigator.onLine ? 'The 3D model download from FleetYards stopped' : 'Offline: the 3D model loads once you\'re online';
}

const VERT = 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}';
const FRAG = 'uniform float s;varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(n,v)),2.6);float a=(f*1.15+.03)*s;gl_FragColor=vec4(vec3(.345,.824,.941)*a,a);}';

/** One view, kept for the page's life: a canvas in `host`, and set() to change what it shows. */
export function view(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 's3-canvas';
  host.prepend(canvas);
  const retry = document.createElement('button');
  retry.className = 's3-retry'; retry.type = 'button'; retry.textContent = 'Retry';
  host.append(retry);
  const st = { yaw: 40, pitch: 22, zoom: 1.9 };
  let ctx = null, want = {}, shown = {}, frame = 0, failed = null;
  /** A message over the view; `again` also shows Retry. */
  const status = (msg, again = false) => {
    host.dataset.state = msg || ''; host.toggleAttribute('data-fail', again);
    const n = host.querySelector('.s3-msg'); if (n) n.textContent = msg || '';
  };
  /** Tries the model again: after Retry, or when the connection comes back after a download failed. */
  const again = () => {
    if (ctx?.lost) { status('Restoring the graphics…'); ctx.r.forceContextRestore(); return; }
    failed = null; set({});
  };
  retry.addEventListener('click', again);
  addEventListener('online', () => { if (failed?.kind === 'net') again(); });

  async function setup() {
    const { T } = await three();
    let r;
    try { r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); } catch (e) { throw oops('gpu', e); }
    // A driver reset drops the GPU copy of the model; three.js uploads it again once the context is back.
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ctx.lost = true; status(why({ kind: 'lost' }), true); });
    canvas.addEventListener('webglcontextrestored', () => { ctx.lost = false; status(''); draw(); });
    r.setClearColor(0, 0); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping;
    const scene = new T.Scene(), group = new T.Group();
    const hemi = new T.HemisphereLight(0xcfe8ff, 0x1a2028, 2), sun = new T.DirectionalLight(0xffffff, 3), rim = new T.DirectionalLight(0x58d2f0, 1.6);
    sun.position.set(4, 6, 5); rim.position.set(-5, 2, -6);
    scene.add(hemi, sun, rim, group);
    const shell = new T.Mesh(new T.SphereGeometry(1, 64, 48), new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { s: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG }));
    const ring = new T.Mesh(new T.RingGeometry(1, 1.025, 128), new T.MeshBasicMaterial({ color: 0x58d2f0, transparent: true, opacity: 0.35, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    group.add(shell, ring);
    ctx = { T, r, scene, group, hemi, sun, rim, shell, ring, cam: new T.PerspectiveCamera(28, 1, 0.1, 5000), ship: null, mats: [], size: null, base: new Map(), paints: new Map() };
  }
  /** Draws once on the next frame, however many changes came in. */
  const draw = () => { if (!frame) frame = requestAnimationFrame(paint); };
  function paint() {
    frame = 0;
    if (!ctx?.ship || ctx.lost) return;
    const { T, r, cam, size } = ctx, w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const px = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * px) || canvas.height !== Math.round(h * px)) r.setSize(w, h, false), r.setPixelRatio(px);
    const R = Math.max(size.x, size.y, size.z), yaw = st.yaw * Math.PI / 180, pit = st.pitch * Math.PI / 180, d = R * st.zoom;
    cam.aspect = w / h; cam.updateProjectionMatrix();
    cam.position.set(Math.sin(yaw) * Math.cos(pit) * d, Math.sin(pit) * d, Math.cos(yaw) * Math.cos(pit) * d);
    cam.lookAt(0, 0, 0);
    r.render(ctx.scene, cam);
    void T;
  }

  async function load(url) {
    const { T, loader } = await three();
    // Parsed straight from memory: no blob: URL to fetch (the app's content policy allows none for
    // whole files), and no second copy of a model that can run past 30 MB.
    const buf = await (await cached(url)).arrayBuffer();
    let g;
    try { g = await loader.parseAsync(buf, ''); } catch (e) { forget(url); throw oops('file', e); }
    const ship = g.scene, box = new T.Box3().setFromObject(ship), size = box.getSize(new T.Vector3());
    ship.position.sub(box.getCenter(new T.Vector3()));
    return { ship, size };
  }
  async function texture(url) {
    if (ctx.paints.has(url)) return ctx.paints.get(url);
    const { T } = ctx, blob = await cached(url), bmp = await createImageBitmap(blob, { imageOrientation: 'none' });
    const t = new T.Texture(bmp);
    t.flipY = false; t.colorSpace = T.SRGBColorSpace; t.needsUpdate = true;
    ctx.paints.set(url, t);
    return t;
  }
  /** Applies the live values and the paint to what is loaded. */
  async function apply() {
    const { T, ship, size } = ctx;
    if (!ship) return;
    // Materials change only with the paint, the hull or the power: redoing them recompiles shaders.
    const look = `${shown.gen}|${want.paint}|${want.hull}|${want.power}`;
    if (look !== shown.look) { shown.look = look; await looks(); }
    const s = want.shield ?? 0;
    ctx.shell.visible = s > 0;
    ctx.shell.material.uniforms.s.value = s;
    ctx.shell.scale.set(size.x * 0.6, Math.max(size.y * 0.8, size.x * 0.22), size.z * 0.6);
    ctx.ring.visible = !!want.landed;
    const rr = Math.max(size.x, size.z) * 0.55;
    ctx.ring.scale.set(rr, rr, 1); ctx.ring.position.y = -size.y / 2 - 0.05;
    draw();
  }
  async function looks() {
    const { T, ship } = ctx;
    const paint = want.paint ? await texture(want.paint).catch(() => null) : null;
    const hull = want.hull, dmg = hull == null ? 0 : 1 - hull, tint = new T.Color(hull != null && hull < 0.25 ? 0xff5040 : 0xffb040), dark = want.power === false;
    ship.traverse(m => {
      if (!m.isMesh) return;
      const b = ctx.base.get(m);
      m.material.map = paint && /atlas/i.test(b.name) ? paint : b.map;
      m.material.color.copy(b.color);
      if (dmg > 0) m.material.color.lerp(tint, Math.min(0.4, dmg * 0.75));
      if (m.material.emissive) {
        m.material.emissive.copy(dmg > 0 ? tint.clone().multiplyScalar(dmg * 0.1) : b.emissive);
        m.material.emissiveMap = dmg > 0 ? null : b.emissiveMap;
        m.material.emissiveIntensity = dark ? 0 : b.ei;
      }
      m.material.needsUpdate = true;
    });
    const lit = dark ? 0.12 : 1;
    ctx.hemi.intensity = 2 * lit; ctx.sun.intensity = 3 * lit; ctx.rim.intensity = 1.6 * lit;
  }
  /** What to show: { url, paint, shield, hull, power, landed }; only what changed is redone. */
  async function set(next) {
    // The glow in steps of 5 % and the hull tint in whole percent are all the eye sees; a reading
    // that moves less draws nothing, so a fight doesn't redraw the model ten times a second.
    if (typeof next.shield === 'number') next = { ...next, shield: Math.round(next.shield * 20) / 20 };
    if (typeof next.hull === 'number') next = { ...next, hull: Math.round(next.hull * 100) / 100 };
    if (Object.keys(next).every(k => want[k] === next[k]) && shown.url === want.url && ctx?.ship) return;
    want = { ...want, ...next };
    if (!want.url) { status('No 3D model for this ship on FleetYards'); return; }
    // A model that failed waits for Retry (or the connection coming back): the live stream calls
    // this many times a second, and each call must not download or parse it again.
    if (failed && failed.url === want.url) return;
    let trying = null;
    try {
      if (!ctx) await setup();
      if (want.url !== shown.url) {
        // Already on its way: that load applies the latest values when it lands.
        if (want.url === shown.loading) return;
        const url = trying = want.url;
        shown.loading = url;
        status('Loading the 3D model…');
        const m = await load(url);
        if (want.url !== url) { if (shown.loading === url) shown.loading = null; return; }
        if (ctx.ship) { ctx.group.remove(ctx.ship); ctx.ship.traverse(o => { o.geometry?.dispose(); }); }
        ctx.base.clear();
        m.ship.traverse(o => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          const mt = o.material;
          ctx.base.set(o, { name: mt.name || '', map: mt.map, color: mt.color.clone(), emissive: mt.emissive?.clone(), emissiveMap: mt.emissiveMap, ei: mt.emissiveIntensity ?? 1 });
        });
        ctx.ship = m.ship; ctx.size = m.size; ctx.group.add(m.ship);
        shown.url = url; shown.loading = null; shown.gen = (shown.gen || 0) + 1;
        status('');
      }
      await apply();
    } catch (e) {
      const kind = e.kind || 'file', url = trying || want.url;
      if (shown.loading === url) shown.loading = null;
      failed = { url, kind };
      if (url === want.url) status(why({ ...e, kind }), true);
      console.warn('ship3d', e.cause || e);
    }
  }

  // Drag to turn, pinch or wheel to zoom, double-tap to reset.
  const pts = new Map();
  let pinch = 0;
  host.addEventListener('pointerdown', e => { if (e.target.closest('.well, button')) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); host.setPointerCapture?.(e.pointerId); e.stopPropagation(); });
  host.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [c, dd] = [...pts.values()], d1 = Math.hypot(c.x - dd.x, c.y - dd.y);
      if (pinch && d0) st.zoom = Math.max(0.9, Math.min(4, st.zoom * d0 / d1));
      pinch = 1;
    } else {
      st.yaw -= (e.clientX - p.x) * 0.35; st.pitch = Math.max(-80, Math.min(80, st.pitch + (e.clientY - p.y) * 0.25));
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    draw();
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
  host.addEventListener('wheel', e => { e.preventDefault(); st.zoom = Math.max(0.9, Math.min(4, st.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
  host.addEventListener('dblclick', () => { Object.assign(st, { yaw: 40, pitch: 22, zoom: 1.9 }); draw(); });
  new ResizeObserver(draw).observe(host);
  return { set, draw, state: st };
}
