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

/** A file from FleetYards, from the cache when it was fetched before. */
async function cached(url) {
  let c = null;
  try { c = await caches.open(CACHE); } catch { /* no Cache API: straight from the network */ }
  const hit = c && await c.match(url).catch(() => null);
  if (hit) return hit.blob();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FleetYards answered ${res.status}`);
  if (c) await c.put(url, res.clone()).catch(() => {});
  return res.blob();
}

const VERT = 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}';
const FRAG = 'uniform float s;varying vec3 n;varying vec3 v;void main(){float f=pow(1.-abs(dot(n,v)),2.6);float a=(f*1.15+.03)*s;gl_FragColor=vec4(vec3(.345,.824,.941)*a,a);}';

/** One view, kept for the page's life: a canvas in `host`, and set() to change what it shows. */
export function view(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 's3-canvas';
  host.prepend(canvas);
  const st = { yaw: 40, pitch: 22, zoom: 1.9 };
  let ctx = null, want = {}, shown = {}, frame = 0, loading = null;
  const status = msg => { host.dataset.state = msg || ''; const n = host.querySelector('.s3-msg'); if (n) n.textContent = msg || ''; };

  async function setup() {
    const { T } = await three();
    const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
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
    if (!ctx?.ship) return;
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
    const blob = await cached(url), obj = URL.createObjectURL(blob);
    try {
      const g = await loader.loadAsync(obj);
      const ship = g.scene, box = new T.Box3().setFromObject(ship), size = box.getSize(new T.Vector3());
      ship.position.sub(box.getCenter(new T.Vector3()));
      return { ship, size };
    } finally { URL.revokeObjectURL(obj); }
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
    const s = want.shield ?? 0;
    ctx.shell.visible = s > 0;
    ctx.shell.material.uniforms.s.value = s;
    ctx.shell.scale.set(size.x * 0.6, Math.max(size.y * 0.8, size.x * 0.22), size.z * 0.6);
    ctx.ring.visible = !!want.landed;
    const rr = Math.max(size.x, size.z) * 0.55;
    ctx.ring.scale.set(rr, rr, 1); ctx.ring.position.y = -size.y / 2 - 0.05;
    draw();
  }
  /** What to show: { url, paint, shield, hull, power, landed }; only what changed is redone. */
  async function set(next) {
    want = { ...want, ...next };
    if (!want.url) { status('No 3D model for this ship on FleetYards'); return; }
    try {
      if (!ctx) await setup();
      if (want.url !== shown.url) {
        const url = want.url;
        status('Loading the model…');
        loading = load(url);
        const m = await loading;
        if (want.url !== url) return;
        if (ctx.ship) { ctx.group.remove(ctx.ship); ctx.ship.traverse(o => { o.geometry?.dispose(); }); }
        ctx.base.clear();
        m.ship.traverse(o => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          const mt = o.material;
          ctx.base.set(o, { name: mt.name || '', map: mt.map, color: mt.color.clone(), emissive: mt.emissive?.clone(), emissiveMap: mt.emissiveMap, ei: mt.emissiveIntensity ?? 1 });
        });
        ctx.ship = m.ship; ctx.size = m.size; ctx.group.add(m.ship);
        shown.url = url;
        status('');
      }
      await apply();
    } catch (e) {
      status(navigator.onLine ? 'The 3D model didn\'t load' : 'Offline: the 3D model loads once you\'re online');
      console.warn('ship3d', e);
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
