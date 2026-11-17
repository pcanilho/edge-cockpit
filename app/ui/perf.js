// The hidden performance overlay: hold the EDGE COCKPIT title on the status display.
// Frame rate, CPU and memory of the app with its WebView2 processes, the JS heap, and
// touch to key: from a finger landing to Windows taking the key. Nothing here runs,
// and no frames are asked for, while the overlay is closed.

const SAMPLES = 20;
const lat = [];
let down = null;
let open = false, timer = 0, raf = 0, frames = 0, since = 0, fps = 0, worstFrame = 0, lastFrame = 0;
let box, read;

/** Called by the bridge each time a key has gone out. */
export function keySent(now = performance.now()) {
  if (down === null || now - down > 2000) return;
  lat.push(now - down);
  if (lat.length > SAMPLES) lat.shift();
  down = null;
}

function frame(t) {
  frames++;
  if (lastFrame) worstFrame = Math.max(worstFrame, t - lastFrame);
  lastFrame = t;
  raf = requestAnimationFrame(frame);
}

const ms = v => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
async function paint() {
  const now = performance.now();
  fps = since ? frames * 1000 / (now - since) : 0;
  const worst = worstFrame;
  frames = 0; since = now; worstFrame = 0;
  const p = await read().catch(() => null);
  const heap = performance.memory?.usedJSHeapSize;
  const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  const rows = [
    ['Frames', fps ? `${Math.round(fps)} fps · worst ${ms(worst)}` : '…'],
    ['CPU', p ? `${p.cpu.toFixed(1)} %` : 'in the app only'],
    ['Memory', [p && `${Math.round(p.mem_mb)} MB app`, heap && `${(heap / 1048576).toFixed(1)} MB JS`].filter(Boolean).join(' · ') || '…'],
    ['Touch to key', avg === null ? 'press a key' : `${ms(avg)} · worst ${ms(Math.max(...lat))}`],
  ];
  box.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

export function toggle(on = !open) {
  open = on;
  box.hidden = !on;
  clearInterval(timer); cancelAnimationFrame(raf);
  if (!on) return;
  frames = 0; since = 0; lastFrame = 0; worstFrame = 0;
  raf = requestAnimationFrame(frame);
  paint();
  timer = setInterval(paint, 1000);
}

/** Wires the overlay: `hold` is the node to hold, `perf()` reads CPU and memory. */
export function init({ hold, parent, perf, tick }) {
  read = perf;
  box = document.createElement('div');
  box.className = 'perf';
  box.id = 'perf';
  box.hidden = true;
  box.innerHTML = '<h4>Performance<small>Hold the title to close</small></h4><dl></dl>';
  parent.append(box);
  // Every touch anywhere starts a touch-to-key measurement; the key that follows ends it.
  addEventListener('pointerdown', e => { down = e.timeStamp; }, true);
  let t = 0;
  hold.addEventListener('pointerdown', () => { clearTimeout(t); t = setTimeout(() => { tick?.('toggle'); toggle(); }, 2000); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hold.addEventListener(ev, () => clearTimeout(t));
}
