// Instruments for the Telemetry pages, drawn as SVG strings. Each takes the value the game sent,
// or null when it didn't, and then says so ("Not sent") instead of drawing a number. Scales
// (vertical speed, G, heart rate) are the console's own, never a ship limit.
const C = { cyan: '#58d2f0', amber: '#ffb547', ok: '#5fe0a0', red: '#ff4232', ink: '#e4ebf1', paint: '#c3ccd5', muted: '#7f8c99', dim: '#56626e', glass: '#06121a' };
const rad = d => (d - 90) * Math.PI / 180;
const P = (cx, cy, r, d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];
const f1 = n => n.toFixed(1);
// Clip paths need ids unique on the page, and the same on every repaint so an unchanged
// drawing stays unchanged: one per place.
const clipId = (x, y, w, h) => `gx-c${Math.round(x)}-${Math.round(y)}-${Math.round(w)}-${Math.round(h)}`;
// Parts that move with the value are drawn once and moved: a new reading changes one transform,
// not every tick mark (the pages repaint only what changed). A tape's scale is redrawn only when
// the value passes another major mark.
const slide = (dx, dy, body) => `<g transform="translate(${f1(dx)} ${f1(dy)})">${body}</g>`;
const turn = (cx, cy, deg, body) => `<g transform="rotate(${f1(deg)} ${cx} ${cy})">${body}</g>`;
export function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = P(cx, cy, r, a0), [x1, y1] = P(cx, cy, r, a1);
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${f1(x1)} ${f1(y1)}`;
}
const T = (x, y, s, txt, o = {}) => `<text x="${f1(x)}" y="${f1(y)}" font-family="${o.f || 'Chakra Petch'}" font-weight="${o.w || 700}" font-size="${s}" fill="${o.c || C.paint}" text-anchor="${o.a || 'middle'}" ${o.ls ? `letter-spacing="${o.ls}"` : ''} ${o.op ? `opacity="${o.op}"` : ''} dominant-baseline="${o.b || 'middle'}">${txt}</text>`;
const mono = (x, y, s, txt, o = {}) => T(x, y, s, txt, { f: 'JetBrains Mono', w: 500, c: C.ink, ...o });
/** Shared filters and patterns; index.html carries them once. */
export const DEFS = `<defs>
  <filter id="gx-gl" filterUnits="userSpaceOnUse" x="-500" y="-500" width="3000" height="2000"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="gx-gl2" filterUnits="userSpaceOnUse" x="-500" y="-500" width="3000" height="2000"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="gx-fadeV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="1"/><stop offset=".18" stop-color="#000" stop-opacity="0"/><stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="1"/></linearGradient>
  <linearGradient id="gx-fadeH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="1"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="1"/></linearGradient>
  <radialGradient id="gx-nut" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#5a6670"/><stop offset=".6" stop-color="#232a30"/><stop offset="1" stop-color="#0b0e11"/></radialGradient>
  <pattern id="gx-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#1a1208"/><rect width="4" height="10" fill="#3a2a10"/></pattern>
</defs>`;
export const svg = (w, h, body) => `<svg class="gx" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Heading ribbon: degrees as the game sends them. null = not sent. */
export function heading(x, y, w, h, hdg) {
  const cx = x + w / 2, ppd = w / 120;
  let s = `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#071119" stroke="#ffffff14"/>`;
  if (hdg == null) {
    s += T(cx, y + h / 2, 15, 'HEADING · NOT SENT', { c: C.dim, ls: 3 });
    return s + '</g>';
  }
  const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const id = clipId(x, y, w, h), q = Math.round(hdg / 15) * 15;
  s += `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/></clipPath><g clip-path="url(#${id})">`;
  let marks = '';
  for (let d = Math.ceil((q - 75) / 5) * 5; d <= q + 75; d += 5) {
    const px = cx + (d - q) * ppd, dd = ((d % 360) + 360) % 360, big = dd % 15 === 0;
    marks += `<line x1="${f1(px)}" x2="${f1(px)}" y1="${y + h}" y2="${y + h - (big ? 18 : 9)}" stroke="${C.paint}" stroke-width="${big ? 2 : 1.2}" opacity="${big ? .9 : .5}"/>`;
    if (big) marks += names[dd] != null ? T(px, y + 22, 20, names[dd], { c: dd === 0 ? C.amber : C.cyan }) : mono(px, y + 22, 14, String(dd).padStart(3, '0'), { c: C.paint });
  }
  s += slide((q - hdg) * ppd, 0, marks);
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#gx-fadeH)"/></g>`;
  const v = String(Math.round(hdg) % 360).padStart(3, '0');
  s += `<path d="M${cx - 38} ${y - 2}h76v34h-30l-8 9-8-9h-30z" fill="#02080c" stroke="${C.cyan}" stroke-width="2" filter="url(#gx-gl)"/>` + mono(cx, y + 16, 24, v + '°', { c: C.cyan });
  return s + '</g>';
}

/** A moving tape: the value stays in the window, the scale slides. No maximum needed. */
export function tape(x, y, w, h, val, o) {
  const cy = y + h / 2, ppu = o.ppu, right = o.side === 'right';
  let s = `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#071119" stroke="#ffffff14"/>`;
  s += T(x + w / 2, y - 16, 12, o.title, { c: C.muted, ls: 3 });
  if (val == null) {
    s += T(x + w / 2, cy - 10, 14, 'NO', { c: C.dim, ls: 3 }) + T(x + w / 2, cy + 12, 14, 'READING', { c: C.dim, ls: 3 });
    return s + '</g>';
  }
  const id = clipId(x, y, w, h), q = Math.round(val / o.major) * o.major;
  s += `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/></clipPath><g clip-path="url(#${id})">`;
  // The scale is drawn around the nearest major mark and slides by the rest.
  const span = h / 2 / ppu + o.major + o.minor;
  let marks = '';
  if (o.ground) { const gy = cy + q * ppu; if (gy < y + h + o.major * ppu) marks += `<rect x="${x}" y="${f1(gy)}" width="${w}" height="${h}" fill="url(#gx-hatch)"/><line x1="${x}" x2="${x + w}" y1="${f1(gy)}" y2="${f1(gy)}" stroke="${C.amber}" stroke-width="2"/>`; }
  for (let u = Math.ceil((q - span) / o.minor) * o.minor; u <= q + span; u += o.minor) {
    if (u < (o.min ?? -1e9)) continue;
    const py = cy - (u - q) * ppu, big = Math.abs(u % o.major) < 1e-6;
    const tx = right ? x : x + w, len = big ? 22 : 11;
    marks += `<line x1="${tx}" x2="${right ? tx + len : tx - len}" y1="${f1(py)}" y2="${f1(py)}" stroke="${C.paint}" stroke-width="${big ? 2 : 1.2}" opacity="${big ? .9 : .45}"/>`;
    if (big) marks += mono(right ? x + 34 : x + w - 34, py, 17, u, { c: C.paint, a: right ? 'start' : 'end' });
  }
  s += slide(0, (val - q) * ppu, marks);
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#gx-fadeV)"/></g>`;
  // Readout box with a pointer toward the scale.
  const bw = w - 18, bx = right ? x + 18 : x, txt = o.fmt(val);
  const pt = right ? `M${bx} ${cy - 24}h${bw}v48h-${bw}v-16l-14-8 14-8z` : `M${bx} ${cy - 24}h${bw}v16l14 8-14 8v16h-${bw}z`;
  s += `<path d="${pt}" fill="#02080c" stroke="${o.c}" stroke-width="2.5" filter="url(#gx-gl)"/>`;
  s += mono(bx + bw / 2, cy - 2, o.fs || 30, txt, { c: o.c, w: 500 }) + T(bx + bw / 2, cy + 33, 11, o.unit, { c: o.c, ls: 2, op: .9 });
  return s + '</g>';
}

/** Vertical speed: 0 at 9 o'clock, climb clockwise up, descent down; square-root scale to ±50 m/s. */
export function vsi(cx, cy, r, v) {
  const ang = x => 270 + Math.sign(x) * Math.sqrt(Math.min(Math.abs(x), 50) / 50) * 165;
  let s = `<g><circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="#040b10" stroke="#ffffff10" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="none" stroke="#000" stroke-width="6"/>`;
  s += `<path d="${arc(cx, cy, r - 6, ang(0), ang(50))}" stroke="${C.ok}" stroke-width="5" fill="none" opacity=".35"/><path d="${arc(cx, cy, r - 6, ang(-50), ang(0))}" stroke="${C.amber}" stroke-width="5" fill="none" opacity=".35"/>`;
  for (const t of [0, 1, 2, 5, 10, 20, 30, 50]) for (const sg of t ? [1, -1] : [1]) {
    const a = ang(sg * t), [x0, y0] = P(cx, cy, r - 12, a), [x1, y1] = P(cx, cy, r - 34, a), [lx, ly] = P(cx, cy, r - 58, a);
    s += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${C.ink}" stroke-width="3"/>` + ([0, 5, 10, 20, 50].includes(t) ? mono(lx, ly, 20, t, { c: C.paint }) : '');
  }
  for (const t of [3, 4, 6, 7, 8, 9, 15, 25, 40]) for (const sg of [1, -1]) { const a = ang(sg * t), [x0, y0] = P(cx, cy, r - 12, a), [x1, y1] = P(cx, cy, r - 24, a); s += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${C.paint}" stroke-width="1.5" opacity=".6"/>`; }
  s += T(cx + r * .42, cy - r * .42, 14, 'UP', { c: C.ok, ls: 3 }) + T(cx + r * .42, cy + r * .42, 14, 'DOWN', { c: C.amber, ls: 3 });
  s += T(cx, cy - r * .3, 13, 'VERTICAL SPEED', { c: C.muted, ls: 3 }) + T(cx + r * .42, cy + 40, 12, 'M/S', { c: C.muted, ls: 3 });
  const vr0 = Math.round(v), t0 = vr0 > 0 ? '+' + vr0 : vr0 < 0 ? '−' + Math.abs(vr0) : '0', col = vr0 < 0 ? C.amber : vr0 > 0 ? C.ok : C.paint;
  s += `<rect x="${cx + r * .42 - 56}" y="${cy - 26}" width="112" height="52" rx="6" fill="#02080c" stroke="${col}" stroke-width="2"/>` + mono(cx + r * .42, cy + 1, 30, t0, { c: vr0 ? col : C.ink });
  s += turn(cx, cy, ang(v), `<line x1="${cx}" y1="${cy + 34}" x2="${cx}" y2="${cy - r + 16}" stroke="${C.ink}" stroke-width="7" stroke-linecap="round" filter="url(#gx-gl)"/>`) + `<circle cx="${cx}" cy="${cy}" r="16" fill="url(#gx-nut)" stroke="#000" stroke-width="2"/>`;
  return s + '</g>';
}

/** G meter: current needle, recorded peak as an amber mark. Scale 0-10 G is the console's own, not a ship limit. */
export function gmeter(cx, cy, r, g) {
  const A0 = -125, A1 = 125, max = 10, ang = x => A0 + Math.min(x, max) / max * (A1 - A0);
  let s = `<g><circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="#040b10" stroke="#ffffff10" stroke-width="2"/>`;
  s += `<path d="${arc(cx, cy, r - 4, A0, A1)}" stroke="#0c1a22" stroke-width="12" fill="none"/>`;
  if (g) s += `<path d="${arc(cx, cy, r - 4, A0, ang(g.current) + .01)}" stroke="${C.cyan}" stroke-width="12" fill="none" filter="url(#gx-gl)"/>`;
  for (let t = 0; t <= max; t++) { const a = ang(t), [x0, y0] = P(cx, cy, r - 14, a), [x1, y1] = P(cx, cy, r - (t % 2 ? 22 : 30), a), [lx, ly] = P(cx, cy, r - 46, a);
    s += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${C.ink}" stroke-width="${t % 2 ? 1.5 : 3}"/>` + (t % 2 ? '' : mono(lx, ly, 17, t, { c: C.paint })); }
  if (!g) return s + T(cx, cy, 14, 'NOT SENT', { c: C.dim, ls: 3 }) + '</g>';
  const pk = ang(g.max), [px, py] = P(cx, cy, r + 4, pk), [p1x, p1y] = P(cx, cy, r + 18, pk - 4), [p2x, p2y] = P(cx, cy, r + 18, pk + 4);
  s += `<path d="M${f1(px)} ${f1(py)}L${f1(p1x)} ${f1(p1y)}L${f1(p2x)} ${f1(p2y)}z" fill="${C.amber}" filter="url(#gx-gl)"/>`;
  s += turn(cx, cy, ang(g.current), `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 18}" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>`) + `<circle cx="${cx}" cy="${cy}" r="11" fill="url(#gx-nut)" stroke="#000" stroke-width="2"/>`;
  s += mono(cx, cy + r * .42, 34, g.current.toFixed(1), { c: C.cyan }) + T(cx, cy + r * .42 + 26, 12, 'G NOW', { c: C.muted, ls: 3 });
  s += T(cx, cy + r + 34, 12, `PEAK  ${g.max.toFixed(1)} G${g.max > max ? '  ▲' : ''}`, { c: C.amber, ls: 2 });
  return s + '</g>';
}

/** A ring gauge, 0-100 %, in segments. */
export function ring(cx, cy, r, pct, o) {
  const segs = 40, A0 = -135, A1 = 135, step = (A1 - A0) / segs, lit = Math.round(pct / 100 * segs);
  let s = `<g><circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="#040b10" stroke="#ffffff10" stroke-width="2"/>`;
  for (let i = 0; i < segs; i++) { const on = i < lit; s += `<path d="${arc(cx, cy, r - 6, A0 + i * step + .8, A0 + (i + 1) * step - .8)}" stroke="${on ? o.c : '#13212b'}" stroke-width="${o.sw || 18}" fill="none" ${on && o.glow ? 'filter="url(#gx-gl)"' : ''}/>`; }
  if (o.halo) s += `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="none" stroke="${o.c}" stroke-width="2" opacity=".8" filter="url(#gx-gl2)"/>`;
  if (!o.noNum) s += mono(cx, cy - 2, o.fs || 46, Math.floor(pct), { c: o.c }) + T(cx + (o.fs || 46) * .02, cy + (o.fs || 46) * .62, 12, '%', { c: o.c });
  s += T(cx, cy + r * .78, 13, o.title, { c: C.paint, ls: 3 });
  if (o.sub) s += T(cx, cy - r * .55, 12, o.sub, { c: o.c, ls: 3 });
  return s + '</g>';
}

/** Horizontal segmented bar with its readout. pct null = not sent. */
export function hbar(x, y, w, h, pct, o) {
  let s = `<g>` + T(x, y - 16, 12, o.title, { c: C.muted, ls: 3, a: 'start' });
  const n = o.n || 30, gap = 4, sw = (w - 120 - gap * (n - 1)) / n;
  if (pct == null) {
    for (let i = 0; i < n; i++) s += `<rect x="${f1(x + i * (sw + gap))}" y="${y}" width="${f1(sw)}" height="${h}" rx="2" fill="#0c151c" stroke="#ffffff0a"/>`;
    return s + T(x + w - 4, y + h / 2, 14, 'NOT SENT', { c: C.dim, ls: 2, a: 'end' }) + '</g>';
  }
  const lit = Math.round(pct / 100 * n);
  for (let i = 0; i < n; i++) s += `<rect x="${f1(x + i * (sw + gap))}" y="${y}" width="${f1(sw)}" height="${h}" rx="2" fill="${i < lit ? o.c : '#13212b'}" ${i < lit ? 'filter="url(#gx-gl)"' : ''}/>`;
  return s + mono(x + w - 4, y + h / 2, 30, Math.floor(pct) + '<tspan font-size="15" fill="' + C.muted + '"> %</tspan>', { c: o.c, a: 'end' }) + '</g>';
}

/** Semi-arc gauge for shields / hull. */
export function semi(cx, cy, r, pct, o) {
  let s = `<g><path d="${arc(cx, cy, r, -90, 90)}" stroke="#13212b" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  s += `<path d="${arc(cx, cy, r, -90, -90 + 180 * pct / 100 + .01)}" stroke="${o.c}" stroke-width="16" fill="none" stroke-linecap="round" filter="url(#gx-gl)"/>`;
  for (const t of [0, 25, 50, 75, 100]) { const a = -90 + t * 1.8, [x0, y0] = P(cx, cy, r + 12, a), [x1, y1] = P(cx, cy, r + 20, a); s += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${C.paint}" stroke-width="2" opacity=".6"/>`; }
  s += mono(cx, cy - 22, 40, Math.floor(pct) + '<tspan font-size="16" fill="' + C.muted + '"> %</tspan>', { c: o.c }) + T(cx, cy + 10, 13, o.title, { c: C.paint, ls: 3 });
  return s + '</g>';
}


/** A needle dial over a fixed scale (min..max), filled up to the value. */
export function dial(cx, cy, r, v, o) {
  const A0 = -130, A1 = 130, ang = x => A0 + (Math.max(o.min, Math.min(x, o.max)) - o.min) / (o.max - o.min) * (A1 - A0);
  let s = `<circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="#040b10" stroke="#ffffff10" stroke-width="2"/><path d="${arc(cx, cy, r - 4, A0, A1)}" stroke="#0c1a22" stroke-width="10" fill="none"/>`;
  s += `<path d="${arc(cx, cy, r - 4, A0, ang(v) + .01)}" stroke="${o.c}" stroke-width="10" fill="none" filter="url(#gx-gl)"/>`;
  for (let t = o.min; t <= o.max; t += o.step) { const a = ang(t), [x0, y0] = P(cx, cy, r - 12, a), [x1, y1] = P(cx, cy, r - 26, a), [lx, ly] = P(cx, cy, r - 44, a);
    s += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${C.ink}" stroke-width="2.5"/>` + mono(lx, ly, 15, t, { c: C.paint }); }
  s += turn(cx, cy, ang(v), `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 16}" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>`) + `<circle cx="${cx}" cy="${cy}" r="11" fill="url(#gx-nut)" stroke="#000" stroke-width="2"/>`;
  return s + mono(cx, cy + r * .74, 34, o.fmt(v), { c: o.c }) + T(cx, cy + r * .74 + 26, 12, o.unit, { c: C.muted, ls: 3 }) + T(cx, cy + r + 36, 13, o.title, { c: C.paint, ls: 3 });
}

/** A thermometer, °C. */
export function thermo(x, y, h, v, o) {
  const lo = o.min, hi = o.max, fy = y + h - (Math.max(lo, Math.min(v, hi)) - lo) / (hi - lo) * h;
  let s = `<rect x="${x - 14}" y="${y - 10}" width="28" height="${h + 20}" rx="14" fill="#0a141b" stroke="#ffffff18"/><circle cx="${x}" cy="${y + h + 30}" r="26" fill="${o.c}" filter="url(#gx-gl)"/>`;
  s += `<rect x="${x - 7}" y="${f1(fy)}" width="14" height="${f1(y + h + 20 - fy)}" rx="7" fill="${o.c}" filter="url(#gx-gl)"/>`;
  for (let t = lo; t <= hi; t += o.step) { const ty = y + h - (t - lo) / (hi - lo) * h; s += `<line x1="${x + 18}" x2="${x + 30}" y1="${f1(ty)}" y2="${f1(ty)}" stroke="${C.paint}" stroke-width="2" opacity=".7"/>` + mono(x + 38, ty, 14, t, { c: C.muted, a: 'start' }); }
  return s + mono(x, y - 52, 34, v.toFixed(o.dp) + `<tspan font-size="15" fill="${C.muted}"> °C</tspan>`, { c: o.c }) + T(x, y - 22, 12, o.title, { c: C.paint, ls: 3 });
}

export { C, T, mono };
