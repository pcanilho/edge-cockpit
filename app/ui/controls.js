// Cockpit hardware for the panel: plates, keycaps, bat toggles, knobs, sliders, the
// target dial, the power triangle, the gear lever, slide to eject and guarded covers.
// Everything is CSS and inline SVG, drawn once per page, with no idle animation.
import { GLYPHS } from './lib/glyphs.js';

let K; // the app: key lookup, sending, state (see app.js)
export const init = ctx => { K = ctx; };

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const icon = (n, s = 24) => `<svg class="i" viewBox="0 0 24 24" style="width:${s}px;height:${s}px">${GLYPHS[n] || ''}</svg>`;
const box = (x, y, w, h) => `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const rad = a => a * Math.PI / 180;
export const polar = (cx, cy, r, a) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
export function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => polar(cx, cy, r, a).map(v => v.toFixed(1)).join(' ');
  const L = a1 - a0 > 180 ? 1 : 0;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${L} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${L} 0 ${p(r0, a0)} Z`;
}
const lbl = (k, label) => esc(label ?? k?.label ?? '');
const keyOf = l => (typeof l === 'string' ? K.key(l) : l);

/** Pointer capture, a press look and multi-touch safety for any touch target. */
export function pressable(node, { down, up, cancel } = {}) {
  node.addEventListener('pointerdown', e => {
    e.stopPropagation();
    node.setPointerCapture(e.pointerId);
    node.classList.add('pressed');
    down?.(e);
  });
  node.addEventListener('pointerup', e => { node.classList.remove('pressed'); up?.(e); });
  node.addEventListener('pointercancel', e => { node.classList.remove('pressed'); (cancel || up)?.(e); });
  node.addEventListener('contextmenu', e => e.preventDefault());
}

/** A drag with a step size: onStep(+1 / -1) for every `step` pixels along the axis. */
function stepper(node, { axis = 'y', step = 22, onStep, onMove, onEnd, onTap }) {
  let start = null, acc = 0, moved = false;
  node.addEventListener('pointerdown', e => { e.stopPropagation(); node.setPointerCapture(e.pointerId); start = e; acc = 0; moved = false; node.classList.add('pressed'); });
  node.addEventListener('pointermove', e => {
    if (!start) return;
    const scale = K.scale();
    const d = (axis === 'y' ? start.clientY - e.clientY : e.clientX - start.clientX) / scale;
    if (Math.abs(d) > 6) moved = true;
    onMove?.(d);
    while (d - acc >= step) { acc += step; onStep(1); }
    while (d - acc <= -step) { acc -= step; onStep(-1); }
  });
  const end = () => { if (!start) return; node.classList.remove('pressed'); if (!moved) onTap?.(); start = null; onEnd?.(); };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

// ---------- structure ----------

export function plate(x, w, title, { cls = '' } = {}) {
  const screws = [[11, 11], [w - 24, 11], [11, 684], [w - 24, 684]]
    .map(([sx, sy], i) => `<span class="screw" style="left:${sx}px;top:${sy}px;--r:${(x * 7 + i * 53) % 180}deg"></span>`).join('');
  return h(`<section class="plate ${cls}" style="left:${x}px;width:${w}px">${screws}${title ? `<div class="title">${esc(title)}</div>` : ''}</section>`);
}
export const placard = (x, y, text, cls = '') => h(`<div class="placard ${cls}" style="left:${x}px;top:${y}px">${esc(text)}</div>`);
export const label = (x, y, w, text, cls = '') => h(`<div class="lab ${cls}" style="left:${x}px;top:${y}px;width:${w}px">${esc(text)}</div>`);
export const screen = (x, y, w, ht, html = '', cls = '') => h(`<div class="screen ${cls}" style="${box(x, y, w, ht)}">${html}</div>`);

/** A blank cover where a ship has no such kit. */
const blank = (x, y, w, ht, r) => h(`<div class="well blank" style="${box(x, y, w, ht)};${r ? `border-radius:${r}px` : ''}"><div class="cap"><span class="lg">Not fitted</span></div></div>`);

// ---------- keycap ----------

/**
 * A backlit keycap in a recessed well. `l` is a key label (or key). Options:
 * label, icon, is (icon size), fs (font size), r (radius), lc (backlight colour),
 * lit (legend always lit), cut (chamfered macro plate), noLed, sub, kb (false hides the keybind).
 */
export function keycap(x, y, w, ht, l, o = {}) {
  const k = keyOf(l);
  if (!k || (o.fitted !== undefined ? !o.fitted : !K.fitted(k))) return blank(x, y, w, ht, o.r);
  const tog = k.role === 'toggle' || k.role === 'select';
  const tag = k.role === 'critical' ? 'GUARD' : k.more?.hold ? 'LONG' : k.more?.double ? '2×' : '';
  // Shape says the type: a ring that fills for hold, a notched corner for a macro.
  const mark = k.role === 'hold' ? '<svg class="ring-h" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><circle class="f" cx="8" cy="8" r="6" pathLength="1"/></svg>'
    : k.role === 'macro' ? '<span class="notch"></span>' : '';
  // Long chords don't fit a narrow cap; the keybind check still lists them.
  const bind = o.kb === false ? '' : K.bindText(k);
  const el = h(`<div class="well key fam-${K.family(k)} ${K.isWeapon(k) ? 'weapon' : ''} ${o.cut || k.role === 'macro' ? 'cut' : ''} ${w < 100 ? 'narrow' : ''}" style="${box(x, y, w, ht)};--lc:${o.lc || 'var(--fam)'};${o.r ? `--r:${o.r}px` : ''}">
    <div class="cap ${o.lit ? 'lit' : ''}">
      ${tog && !o.noLed && k.state?.kind === 'set' ? '<span class="led"></span>' : ''}
      ${o.icon === false ? '' : icon(o.icon || k.icon, o.is || 22)}
      <span class="lg" style="${o.fs ? `font-size:${o.fs}px` : ''}">${lbl(k, o.label)}</span>
      ${(k.state?.kind === 'set' && k.state.labels) || o.sub ? `<span class="st">${esc(o.sub || '')}</span>` : ''}
      ${bind ? `<span class="kb">${esc(bind)}</span>` : ''}${tag ? `<span class="tg">${tag}</span>` : ''}${mark}
      <span class="bar"><i></i></span>
    </div></div>`);
  if (k.state) el.dataset.state = JSON.stringify(k.state);
  K.bind(el, k);
  return el;
}

/** Two keys on one rocker: up/left and down/right halves. */
export function rocker(x, y, w, ht, a, b, { vertical = true, title, ia, ib } = {}) {
  const ka = keyOf(a), kb = keyOf(b);
  const el = h(`<div class="well rocker ${vertical ? 'v' : 'h'}" style="${box(x, y, w, ht)}">
    <div class="cap half a">${icon(ia || ka?.icon, 20)}<span class="lg">${lbl(ka)}</span></div>
    <div class="cap half b">${icon(ib || kb?.icon, 20)}<span class="lg">${lbl(kb)}</span></div>
    ${title ? `<span class="rk-t">${esc(title)}</span>` : ''}</div>`);
  if (ka) K.bind(el.querySelector('.a'), ka);
  if (kb) K.bind(el.querySelector('.b'), kb);
  return el;
}

// ---------- bat toggle switch ----------

export function toggle(x, y, l, o = {}) {
  const k = keyOf(l);
  const w = o.w || 84;
  if (!k) return h(`<div class="tgl" style="${box(x, y, w, 196)}"></div>`);
  // The game doesn't report what a toggle key leaves on or off, so it is a push-button:
  // it lights when pressed and claims no state. Only a key that sets one state is a switch.
  if (k.state?.kind !== 'set') {
    const b = keycap(x, y, w, 188, l, { fs: w < 110 ? 11 : 12, is: 24, noLed: true, label: o.label });
    if (o.guard) b.classList.add('guarded');
    return b;
  }
  const nut = [0, 60, 120, 180, 240, 300].map(a => polar(42, 84, 17, a + 30).join(',')).join(' ');
  const el = h(`<div class="tgl fam-${K.family(k)} ${o.guard ? 'guarded' : ''} ${K.isWeapon(k) ? 'weapon' : ''}" style="${box(x, y, w, 196)}">
    <svg viewBox="0 0 84 150" class="sw">
      <circle class="tled" cx="42" cy="10" r="5"/>
      ${o.guard ? '<rect x="12" y="26" width="60" height="116" rx="6" fill="none" stroke="#b3271c" stroke-width="7"/>' : ''}
      <rect x="18" y="32" width="48" height="104" rx="6" fill="#07090b" stroke="#ffffff10"/>
      <polygon points="${nut}" fill="url(#nut)" stroke="#000"/>
      <circle cx="42" cy="84" r="10" fill="#15191d" stroke="#ffffff20"/>
      <g class="bat-up" filter="url(#drop)"><path d="M37 84 L34 44 L50 44 L47 84 Z" fill="url(#chrome)"/><ellipse cx="42" cy="42" rx="10" ry="7" fill="url(#ball)"/></g>
      <g class="bat-dn" filter="url(#drop)"><path d="M37 84 L34 124 L50 124 L47 84 Z" fill="url(#chrome)"/><ellipse cx="42" cy="126" rx="10" ry="7" fill="url(#ball)"/></g>
    </svg>
    <div class="placard">${lbl(k, o.label)}</div>
    <div class="st"></div></div>`);
  if (k.state) el.dataset.state = JSON.stringify(k.state);
  K.bind(el, k);
  return el;
}

/**
 * A switch with separate on and off binds: tap the top half for on, the bottom for off. The
 * bat shows what the console last set, and sits level until it has set something.
 */
export function onOff(x, y, base, o = {}) {
  const kOn = keyOf(`${base} on`), kOff = keyOf(`${base} off`);
  if (!kOn || !kOff) return toggle(x, y, base, o);
  const w = o.w || 84;
  const nut = [0, 60, 120, 180, 240, 300].map(a => polar(42, 84, 17, a + 30).join(',')).join(' ');
  const el = h(`<div class="tgl dual fam-${K.family(kOn)} ${o.guard ? 'guarded' : ''} ${K.isWeapon(kOn) ? 'weapon' : ''}" style="${box(x, y, w, 196)}">
    <svg viewBox="0 0 84 150" class="sw">
      <circle class="tled" cx="42" cy="10" r="5"/>
      ${o.guard ? '<rect x="12" y="26" width="60" height="116" rx="6" fill="none" stroke="#b3271c" stroke-width="7"/>' : ''}
      <rect x="18" y="32" width="48" height="104" rx="6" fill="#07090b" stroke="#ffffff10"/>
      <text x="42" y="28" class="tk">ON</text><text x="42" y="148" class="tk">OFF</text>
      <polygon points="${nut}" fill="url(#nut)" stroke="#000"/>
      <circle cx="42" cy="84" r="10" fill="#15191d" stroke="#ffffff20"/>
      <g class="bat-up" filter="url(#drop)"><path d="M37 84 L34 44 L50 44 L47 84 Z" fill="url(#chrome)"/><ellipse cx="42" cy="42" rx="10" ry="7" fill="url(#ball)"/></g>
      <g class="bat-dn" filter="url(#drop)"><path d="M37 84 L34 124 L50 124 L47 84 Z" fill="url(#chrome)"/><ellipse cx="42" cy="126" rx="10" ry="7" fill="url(#ball)"/></g>
      <g class="bat-mid" filter="url(#drop)"><ellipse cx="42" cy="84" rx="12" ry="12" fill="url(#ball)"/></g>
    </svg>
    <div class="placard">${esc(o.label || base)}</div>
    <div class="st"></div>
    <div class="zone z-on"></div><div class="zone z-off"></div></div>`);
  K.bind(el.querySelector('.z-on'), kOn);
  K.bind(el.querySelector('.z-off'), kOff);
  el.paint = () => {
    const on = K.isOn(kOn.state), off = K.isOn(kOff.state);
    el.classList.toggle('on', on);
    el.classList.toggle('off', off);
    el.querySelector('.st').textContent = on ? 'ON' : off ? 'OFF' : '';
  };
  el.classList.add('painted');
  el.paint();
  return el;
}

/** The same in a keycap's space: the name on top, ON and OFF halves below, the last one set lit. */
export function onOffKey(x, y, w, ht, base, o = {}) {
  const kOn = keyOf(`${base} on`), kOff = keyOf(`${base} off`);
  if (!kOn || !kOff) return keycap(x, y, w, ht, base, o);
  const el = h(`<div class="well pair fam-${K.family(kOn)} ${K.isWeapon(kOn) ? 'weapon' : ''}" style="${box(x, y, w, ht)}">
    <div class="pt">${icon(o.icon || kOn.icon, 16)}<span>${esc(o.label || base)}</span></div>
    <div class="cap half a"><span class="lg">On</span><span class="led"></span></div>
    <div class="cap half b"><span class="lg">Off</span><span class="led"></span></div></div>`);
  const a = el.querySelector('.a'), b = el.querySelector('.b');
  a.dataset.state = JSON.stringify(kOn.state);
  b.dataset.state = JSON.stringify(kOff.state);
  K.bind(a, kOn);
  K.bind(b, kOff);
  return el;
}

// ---------- knobs ----------

const knurl = n => `repeating-conic-gradient(#59626b 0 ${180 / n}deg, #23282d ${180 / n}deg ${360 / n}deg)`;
const knobHtml = (size, pointer = 'var(--accent)') => {
  const inner = size * .8, off = (size - inner) / 2;
  return `<div class="knob" style="width:${size}px;height:${size}px;background:${knurl(Math.round(size * .9))}">
    <div class="cap-k" style="left:${off}px;top:${off}px;width:${inner}px;height:${inner}px"></div>
    <i class="ptr" style="height:${size * .3}px;left:${size / 2 - 2.5}px;top:${size * .08}px;transform-origin:50% ${size * .42}px;background:${pointer}"></i></div>`;
};

/**
 * A rotary selector. positions: [{ label, angle, key }] where each key sets that
 * position (gimbal modes), or one `cycle` key that steps to the next position.
 */
export function rotary(x, y, size, positions, { title, cycle, stateKey, pointer, radius } = {}) {
  const c = size / 2 + 30, R = radius || size / 2 + 20;
  const el = h(`<div class="rotary" style="${box(x, y, size + 60, size + 60)}">
    ${positions.map((p, i) => { const [px, py] = polar(c, c, R, p.angle); return `<button class="pos" data-i="${i}" style="left:${px - 40}px;top:${py - 10}px">${esc(p.label)}</button>`; }).join('')}
    <div class="kn" style="left:30px;top:30px">${knobHtml(size, pointer)}</div>
    ${title ? `<div class="lab" style="left:0;right:0;bottom:-6px">${esc(title)}</div>` : ''}</div>`);
  const ptr = el.querySelector('.ptr');
  const keys = positions.map(p => keyOf(p.key));
  const current = () => {
    if (cycle) return K.local[stateKey] ?? 0;
    // -1 until the console has set a position: the pointer stands straight up.
    return keys.findIndex(k => k?.state && K.isOn(k.state));
  };
  const paint = () => {
    const i = current();
    ptr.style.transform = `rotate(${i < 0 ? 0 : positions[i].angle}deg)`;
    el.querySelectorAll('.pos').forEach((b, j) => b.classList.toggle('on', j === i));
  };
  const go = async i => {
    if (cycle) {
      const k = keyOf(cycle);
      if (await K.fire(k, el)) { K.local[stateKey] = i; paint(); }
    } else if (keys[i] && await K.fire(keys[i], el)) { K.flip(keys[i].state); }
  };
  el.querySelectorAll('.pos').forEach(b => pressable(b, { up: () => { if (+b.dataset.i !== current()) go(+b.dataset.i); } }));
  pressable(el.querySelector('.kn'), { up: () => go((current() + 1) % positions.length) });
  el.paint = paint;
  el.classList.add('painted');
  paint();
  return el;
}

/** A free-turning knob read by the game as the mouse wheel: each detent is one click. */
export function wheelKnob(x, y, size, { value = 'power', title, unit = '%', colour = 'var(--cyan)', marks } = {}) {
  const c = size / 2 + 50, R = size / 2 + 36;
  const v = () => K.local[value] ?? 50;
  const sweep = a => arc(c, c, R - 12, R, -125, -125 + 250 * a / 100);
  const el = h(`<div class="wheelknob" style="${box(x, y, size + 100, size + 100)};--kc:${colour}">
    <svg class="dial" viewBox="0 0 ${size + 100} ${size + 100}">
      <path d="${arc(c, c, R - 12, R, -125, 125)}" fill="#0a0e12" stroke="#ffffff14"/>
      <path class="sweep" fill="${colour}" filter="url(#glow)"/>
      ${(marks || []).map(m => `<path d="${arc(c, c, R + 5, R + 11, -125 + 250 * m.from / 100, -125 + 250 * m.to / 100)}" fill="${m.colour}" opacity=".85"/>`).join('')}
      ${Array.from({ length: 51 }, (_, i) => -125 + i * 5).map(a => { const [x0, y0] = polar(c, c, R - 16, a), [x1, y1] = polar(c, c, R - (a % 25 ? 22 : 30), a); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#ffffff40"/>`; }).join('')}
    </svg>
    <div class="kn" style="left:50px;top:50px">${knobHtml(size, colour)}</div>
    <div class="read"><b></b><span>${esc(title || '')}</span></div></div>`);
  const ptr = el.querySelector('.ptr'), sw = el.querySelector('.sweep'), read = el.querySelector('.read b');
  const paint = () => {
    const a = v();
    ptr.style.transform = `rotate(${-125 + 250 * a / 100}deg)`;
    sw.setAttribute('d', a > 0 ? sweep(a) : '');
    read.textContent = Math.round(a) + unit;
  };
  // Turning: the angle around the centre, one wheel click per 10 degrees.
  const kn = el.querySelector('.kn');
  let last = null, acc = 0;
  const angle = e => { const r = kn.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI; };
  kn.addEventListener('pointerdown', e => { e.stopPropagation(); kn.setPointerCapture(e.pointerId); last = angle(e); acc = 0; kn.classList.add('pressed'); });
  kn.addEventListener('pointermove', e => {
    if (last === null) return;
    const a = angle(e);
    let d = a - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    last = a; acc += d;
    while (Math.abs(acc) >= 10) {
      const s = Math.sign(acc); acc -= s * 10;
      K.local[value] = Math.max(0, Math.min(100, v() + s * 5));
      K.wheel(s, el); K.tick('detent');
      paint();
    }
  });
  const end = () => { last = null; kn.classList.remove('pressed'); };
  kn.addEventListener('pointerup', end); kn.addEventListener('pointercancel', end);
  paint();
  return el;
}

// ---------- sliders ----------

/**
 * A vertical lever on a slotted track. Dragging sends one step per notch:
 * onStep(+1/-1). `value` names the remembered position (0-100).
 */
export function slider(x, y, w, ht, { value, title, onStep, colour = 'var(--cyan)', marks = [100, 50, 0], step = 5 }) {
  const v = () => K.local[value] ?? 50;
  const travel = ht - 60;
  const el = h(`<div class="slider" style="${box(x, y, w, ht)};--kc:${colour}">
    ${Array.from({ length: 11 }, (_, i) => `<i class="tick ${i % 5 ? '' : 'big'}" style="top:${30 + i * travel / 10}px"></i>`).join('')}
    ${marks.map(m => `<span class="mk" style="top:${24 + (100 - m) / 100 * travel}px">${m}</span>`).join('')}
    <div class="slot"></div><div class="fill"></div>
    <div class="handle">${'<span></span>'.repeat(4)}</div><div class="val"></div>
    ${title ? `<div class="lab" style="left:0;right:0;bottom:-26px">${esc(title)}</div>` : ''}</div>`);
  const handle = el.querySelector('.handle'), fill = el.querySelector('.fill'), val = el.querySelector('.val');
  const paint = () => {
    const top = 30 + (100 - v()) / 100 * travel;
    handle.style.top = top - 30 + 'px';
    val.style.top = top - 52 + 'px';
    fill.style.top = top + 'px';
    val.textContent = Math.round(v()) + '%';
  };
  stepper(handle, {
    step: travel / (100 / step),
    onStep: s => {
      const nv = Math.max(0, Math.min(100, v() + s * step));
      if (nv === v()) return;
      K.local[value] = nv; onStep(s, el); K.tick('detent'); paint();
    },
  });
  paint();
  return el;
}

/** Slide the handle to the end to fire a critical key (eject). */
export function slideConfirm(x, y, w, ht, l, { text = 'SLIDE', colour = '#e0301f' } = {}) {
  const k = keyOf(l);
  const knob = ht - 24;
  const el = h(`<div class="slide" style="${box(x, y, w, ht)};--sc:${colour}">
    <div class="hzr"></div><div class="chan"><span class="hint">${esc(text)} ›</span>
    <div class="grip" style="width:${knob}px;height:${knob}px">${icon(k?.icon || 'eject', 28)}</div></div></div>`);
  const grip = el.querySelector('.grip');
  const max = w - 16 - knob - 8;
  let x0 = null, dx = 0;
  grip.addEventListener('pointerdown', e => { e.stopPropagation(); grip.setPointerCapture(e.pointerId); x0 = e.clientX; grip.style.transition = 'none'; K.tick('arm'); });
  grip.addEventListener('pointermove', e => { if (x0 === null) return; dx = Math.max(0, Math.min(max, (e.clientX - x0) / K.scale())); grip.style.transform = `translateX(${dx}px)`; });
  const end = async () => {
    if (x0 === null) return;
    x0 = null;
    grip.style.transition = '';
    if (dx >= max - 4 && k) { K.tick('critical'); el.classList.add('fired'); await K.fire(k, el); setTimeout(() => el.classList.remove('fired'), 1200); }
    dx = 0; grip.style.transform = '';
  };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  return el;
}

/** A hinged red cover: the first tap lifts it, a second tap within 3 s sends the key. */
export function guard(x, y, w, ht, l, { text } = {}) {
  const k = keyOf(l);
  if (!k || !K.fitted(k)) return blank(x, y, w, ht);
  const el = h(`<div class="guard ${w > ht * 3 ? 'row' : ''}" style="${box(x, y, w, ht)}">
    <div class="under">${icon(k.icon, 22)}<span>${lbl(k, text)}</span><span class="kb">${esc(K.bindText(k) || '')}</span></div>
    <div class="cover"><span class="hinge"></span>${icon(k.icon, 20)}<span>LIFT COVER</span></div></div>`);
  let timer;
  pressable(el, {
    up: async () => {
      clearTimeout(timer);
      if (!el.classList.contains('open')) {
        K.tick('arm'); el.classList.add('open');
        timer = setTimeout(() => el.classList.remove('open'), 3000);
      } else {
        K.tick('critical'); el.classList.remove('open');
        await K.fire(k, el);
      }
    },
  });
  return el;
}

// ---------- gear lever ----------

export function gearLever(x, y, l) {
  const k = keyOf(l);
  const el = h(`<div class="gear" style="${box(x, y, 226, 384)}">
    <div class="lights">${['NOSE', 'LEFT', 'RIGHT'].map(n => `<div><i></i><span>${n}</span></div>`).join('')}</div>
    <div class="placard gstate"></div>
    <div class="glab up">UP</div><div class="glab dn">DOWN</div>
    <div class="gslot"></div>
    <div class="arm"><div class="shaft"></div>
      <svg class="wheel" width="130" height="130" viewBox="0 0 130 130" filter="url(#drop)">
        <circle cx="65" cy="65" r="60" fill="#121416"/>
        ${Array.from({ length: 36 }, (_, i) => { const [x0, y0] = polar(65, 65, 52, i * 10), [x1, y1] = polar(65, 65, 60, i * 10); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#2e3338" stroke-width="5"/>`; }).join('')}
        <circle cx="65" cy="65" r="44" fill="url(#ball)"/><circle cx="65" cy="65" r="30" fill="none" stroke="#5c656e" stroke-width="2"/>
        ${[0, 72, 144, 216, 288].map(a => { const [px, py] = polar(65, 65, 20, a); return `<circle cx="${px}" cy="${py}" r="4" fill="#3a4148"/>`; }).join('')}
        <circle cx="65" cy="65" r="8" fill="#2a3036" stroke="#ffffff40"/></svg></div>
    <div class="lab" style="left:0;right:0;top:392px">slide the lever</div></div>`);
  if (!k) return el;
  el.dataset.state = JSON.stringify(k.state);
  const arm = el.querySelector('.arm');
  let y0 = null, dy = 0;
  const down = () => K.isOn(k.state);
  arm.addEventListener('pointerdown', e => { e.stopPropagation(); arm.setPointerCapture(e.pointerId); y0 = e.clientY; arm.style.transition = 'none'; });
  arm.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = (e.clientY - y0) / K.scale();
    dy = down() ? Math.max(-180, Math.min(0, dy)) : Math.max(0, Math.min(180, dy));
    arm.style.transform = `translateY(${dy}px)`;
  });
  const end = async () => {
    if (y0 === null) return;
    y0 = null; arm.style.transition = ''; arm.style.transform = '';
    if (Math.abs(dy) > 90) { K.tick('toggle'); if (await K.fire(k, el)) K.flip(k.state); }
    dy = 0;
  };
  arm.addEventListener('pointerup', end); arm.addEventListener('pointercancel', end);
  return el;
}

// ---------- quantum ----------

export function quantum(x, y, size, l) {
  const k = keyOf(l);
  const c = size / 2;
  const el = h(`<div class="quantum" style="${box(x, y, size, size)}">
    <svg viewBox="0 0 ${size} ${size}" class="ring">${Array.from({ length: 24 }, (_, i) => `<path d="${arc(c, c, c - 13, c - 3, i * 15 + 2, i * 15 + 13)}"/>`).join('')}</svg>
    <div class="bezel" style="inset:${size * .1}px;background:${knurl(120)}"></div>
    <div class="qbtn" style="inset:${size * .145}px">${icon('quantum', 40)}<b>QUANTUM</b><span class="st">HOLD</span><span class="bar"><i></i></span></div></div>`);
  if (k) K.bind(el.querySelector('.qbtn'), k);
  return el;
}

// ---------- big round push button (auto target, reload, revive) ----------

export function roundButton(x, y, size, l, { colour = 'var(--hold)', label, sub, is = 34 } = {}) {
  const k = keyOf(l);
  const el = h(`<div class="round" style="${box(x, y, size, size)};--rc:${colour}">
    <div class="rbtn">${icon(k?.icon, is)}<b>${lbl(k, label)}</b>${sub || k?.role === 'hold' ? `<span>${esc(sub || 'HOLD')}${K.bindText(k) ? ' · ' + esc(K.bindText(k)) : ''}</span>` : ''}<span class="bar"><i></i></span></div></div>`);
  if (k) { if (k.state) el.dataset.state = JSON.stringify(k.state); K.bind(el.querySelector('.rbtn'), k); }
  return el;
}

// ---------- target dial: wedge keys around a centre button ----------

/**
 * rings: [{ r0, r1, keys: [{ label, a0, a1, icon }] }]. centre: key label. Keys a
 * ship lacks show as empty wedges.
 */
export function dial(cx, cy, { bezel, rings, centre, centreR = 80, ringR = 0 }) {
  const size = bezel * 2 + 20, o = size / 2;
  const el = h(`<div class="dialw" style="left:${cx - o}px;top:${cy - o}px;width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" class="dsvg">
      <defs><radialGradient id="wedge" gradientUnits="userSpaceOnUse" cx="${o}" cy="${o - 60}" r="${bezel}"><stop offset="0" stop-color="#3a424c"/><stop offset="1" stop-color="#191d22"/></radialGradient></defs>
      <circle cx="${o}" cy="${o}" r="${bezel}" fill="#050607" stroke="#ffffff10"/>
      <circle cx="${o}" cy="${o}" r="${bezel - 6}" fill="none" stroke="#000" stroke-width="4"/>
      ${Array.from({ length: 72 }, (_, i) => i * 5).map(a => { const [x0, y0] = polar(o, o, bezel - 9, a), [x1, y1] = polar(o, o, a % 15 ? bezel - 14 : bezel - 19, a); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#ffffff26"/>`; }).join('')}
      <g filter="url(#drop)" class="wedges"></g>
      <circle cx="${o}" cy="${o}" r="${centreR + 8}" fill="#050607"/>
    </svg></div>`);
  const g = el.querySelector('.wedges');
  for (const ring of rings) {
    for (const w of ring.keys) {
      const k = keyOf(w.label);
      const fitted = k && K.fitted(k);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', arc(o, o, ring.r0, ring.r1, w.a0, w.a1));
      path.setAttribute('class', 'wedge' + (fitted ? '' : ' off') + (k && K.isWeapon(k) ? ' weapon' : ''));
      g.appendChild(path);
      const [lx, ly] = polar(o, o, (ring.r0 + ring.r1) / 2, (w.a0 + w.a1) / 2);
      const big = ring.r1 - ring.r0 > 70;
      const t = h(`<div class="wl ${big ? 'big' : ''} ${fitted ? '' : 'off'}" style="left:${lx - 60}px;top:${ly - (big ? 32 : 17)}px">${icon(w.icon || k?.icon, big ? 30 : 18)}<b>${esc(w.text || k?.label || '')}</b>${big && fitted && K.bindText(k) ? `<span>${esc(K.bindText(k))}</span>` : ''}</div>`);
      el.appendChild(t);
      if (fitted) {
        if (k.state) path.dataset.state = JSON.stringify(k.state);
        K.bind(path, k, { label: t });
      }
    }
  }
  if (centre) {
    const c = roundButton(o - centreR, o - centreR, centreR * 2, centre, { label: centre === 'Auto target' ? 'AUTO TARGET' : undefined });
    c.classList.add('centre');
    el.appendChild(c);
  }
  void ringR;
  return el;
}

// ---------- power triangle ----------

/** Tap a corner for one more pip there, hold for max, tap the middle to reset, or drag the dot. */
export function powerTriangle(x, y, w, ht) {
  const cx = w / 2, cy = ht / 2 + 20, r = Math.min(w, ht) * .36;
  const V = [0, 120, 240].map(a => polar(cx, cy, r, a));
  const sys = [['Weapons +', 'Weapons max', 'WEP', 'wpn'], ['Engines +', 'Engines max', 'ENG', 'eng'], ['Shields +', 'Shields max', 'SHD', 'shd']];
  const el = screen(x, y, w, ht, `
    <div class="lab" style="left:16px;top:14px;text-align:left">Power distribution</div><div class="lab pips" style="right:16px;top:14px;text-align:right;color:var(--accent)"></div>
    <svg class="tri" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">
      <polygon points="${V.map(p => p.join(',')).join(' ')}" fill="#ff6a5508" stroke="color-mix(in oklab,var(--accent) 35%,transparent)" stroke-width="1.5"/>
      ${[.33, .66].map(f => `<polygon points="${V.map(p => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f].join(',')).join(' ')}" fill="none" stroke="#ffffff14" stroke-dasharray="3 5"/>`).join('')}
      ${V.map(p => `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="#ffffff12"/>`).join('')}
      <polygon class="share" stroke-width="2.5" filter="url(#glow)"/>
      <circle class="halo" r="20" fill="none" stroke-opacity=".5"/><circle class="dot" r="9" fill="#fff" filter="url(#glow)"/>
      <circle class="mid" cx="${cx}" cy="${cy}" r="26" fill="transparent"/>
    </svg>
    ${V.map((p, i) => `<button class="corner" data-i="${i}" style="left:${p[0] - 56}px;top:${p[1] - 22}px">${esc(sys[i][0])}</button>
      <div class="lab cl" data-i="${i}" style="left:${p[0] - 60}px;top:${p[1] + (i === 0 ? -44 : 30)}px;width:120px"></div>`).join('')}
    <div class="lab" style="left:0;right:0;bottom:14px;color:var(--dim)">Drag the dot · tap a corner · hold for max · tap the middle to reset</div>`, 'power-tri');
  const P = () => (K.local.pips ||= [4, 4, 4]);
  const paint = () => {
    const p = P(), tot = p[0] + p[1] + p[2] || 1;
    const share = V.map((v, i) => [cx + (v[0] - cx) * (p[i] / tot) * 1.7, cy + (v[1] - cy) * (p[i] / tot) * 1.7]);
    el.querySelector('.share').setAttribute('points', share.map(s => s.join(',')).join(' '));
    const d = [0, 1].map(j => V.reduce((a, v, i) => a + v[j] * p[i] / tot, 0));
    for (const c of el.querySelectorAll('.dot, .halo')) { c.setAttribute('cx', d[0]); c.setAttribute('cy', d[1]); }
    el.querySelectorAll('.cl').forEach(c => { c.textContent = `${sys[c.dataset.i][2] === 'WEP' ? 'Weapons' : sys[c.dataset.i][2] === 'ENG' ? 'Engines' : 'Shields'} ${p[c.dataset.i]}`; });
    el.querySelector('.pips').textContent = 'Last set';
  };
  const add = async (i, b) => {
    const k = K.key(sys[i][0]);
    if (k && await K.fire(k, b)) { K.fired(b); const p = P(); p[i] = Math.min(10, p[i] + 1); const j = [0, 1, 2].filter(n => n !== i).sort((a, b) => p[b] - p[a])[0]; p[j] = Math.max(0, p[j] - 1); paint(); }
  };
  const max = async (i, b) => {
    const k = K.key(sys[i][1]);
    if (k && await K.fire(k, b)) { K.fired(b); const p = P(); p[i] = 8; for (const j of [0, 1, 2]) if (j !== i) p[j] = 2; paint(); toast(k.label); }
  };
  const toast = t => K.toast(t);
  el.querySelectorAll('.corner').forEach(b => {
    let t, long = false;
    pressable(b, {
      down: () => { long = false; t = setTimeout(() => { long = true; max(+b.dataset.i, b); }, 550); },
      up: () => { clearTimeout(t); if (!long) { K.tick('tap'); add(+b.dataset.i, b); } },
      cancel: () => clearTimeout(t),
    });
  });
  const reset = async () => { const k = K.key('Power reset'); if (k && await K.fire(k, el)) { K.local.pips = [4, 4, 4]; paint(); } };
  pressable(el.querySelector('.mid'), { up: () => { K.tick('tap'); reset(); } });
  // Dragging the dot: every 40 px towards a corner is one pip there.
  const dot = el.querySelector('.halo');
  let start = null;
  dot.addEventListener('pointerdown', e => { e.stopPropagation(); dot.setPointerCapture(e.pointerId); start = [e.clientX, e.clientY]; });
  dot.addEventListener('pointermove', e => {
    if (!start) return;
    const s = K.scale(), dx = (e.clientX - start[0]) / s, dy = (e.clientY - start[1]) / s;
    if (Math.hypot(dx, dy) < 40) return;
    const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const i = [0, 120, 240].map((a, n) => [Math.min(Math.abs(ang - a), 360 - Math.abs(ang - a)), n]).sort((a, b) => a[0] - b[0])[0][1];
    start = [e.clientX, e.clientY];
    K.tick('detent'); add(i);
  });
  const end = () => { start = null; };
  dot.addEventListener('pointerup', end); dot.addEventListener('pointercancel', end);
  dot.style.cursor = 'grab';
  paint();
  return el;
}

/** A small readout of missiles left: bars that follow your Missiles + presses. */
export function missileRack(x, y, w, ht) {
  const n = () => K.local.missiles ?? 2;
  const el = screen(x, y, w, ht, `<div class="rack"></div><div class="big"></div><div class="lab" style="left:0;right:0;bottom:12px">armed · last set</div>`, ht < 120 ? 'compact' : '');
  const paint = () => {
    el.querySelector('.rack').innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < n() ? 'on' : ''}"></i>`).join('');
    el.querySelector('.big').textContent = n();
    if (ht < 120) el.querySelector(".lab").textContent = `${n()} armed`;
  };
  el.paint = paint;
  el.classList.add('painted');
  paint();
  return el;
}
