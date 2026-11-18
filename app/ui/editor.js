// The page editor: change a page of yours on the console itself. The controls palette takes
// the status display's place; drag a control onto a plate, tap one for its card, drag it to
// move, drag its corner to resize. Every change autosaves as a draft and can be undone; Done
// saves the page. Keys are picked with the same picker as everywhere, which refuses what the
// rules don't allow (a switch without set-on/set-off binds, an eject key without a cover).
import { TYPES, GRID, WIDTHS, PLATE_H, SPACE, GAP, FIELDS, cleanPage, refuse, unset } from './lib/custom.js';
import { esc, h } from './controls.js';

let ctx = null; // { K, keys, store, tick, toast, scale, preview(spec), save(spec), remove(id), pageName(id), openPicker(o), bound(label, base) }
let spec = null, undo = [], sel = null, trying = false, open = false;
let ui = {};

export const isOpen = () => open;
export const init = c => { ctx = c; };

const snap = n => Math.round(n / GRID) * GRID;
const clone = o => JSON.parse(JSON.stringify(o));
const draftKey = id => `draft:${id}`;
const $c = () => document.getElementById('console');
const platesEl = () => [...$c().querySelectorAll(':scope > .plate')];

// Palette: what you can drag onto a plate, at the size it lands.
const G = {
  key: '<rect x="5" y="6" width="14" height="12" rx="2"/>',
  wide: '<rect x="3" y="8" width="18" height="9" rx="2"/>',
  rocker: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 12h16"/>',
  round: '<circle cx="12" cy="12" r="7"/>',
  switch: '<rect x="9" y="3" width="6" height="18" rx="2"/><circle cx="12" cy="8" r="2"/>',
  onoffkey: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M12 6v12"/>',
  rotary: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3-5"/>',
  slider: '<path d="M12 3v18"/><rect x="8" y="10" width="8" height="4" rx="1"/>',
  guard: '<rect x="5" y="9" width="14" height="10" rx="2"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  slide: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="7" cy="12" r="2"/>',
  screen: '<rect x="3" y="5" width="18" height="12" rx="1"/><path d="M7 10h6M7 13h9"/>',
  label: '<path d="M5 12h14"/>',
  placard: '<rect x="4" y="9" width="16" height="6" rx="1"/>',
  plate: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/>',
};
const PALETTE = [
  ['Keys', [['key', 'Keycap', 'key', 96, 96], ['key', 'Wide key', 'wide', 192, 96], ['rocker', 'Rocker', 'rocker', 192, 96], ['round', 'Round button', 'round', 112, 112]]],
  ['Switches', [['switch', 'On / off switch', 'switch', 84, 196], ['onoffkey', 'On / off key', 'onoffkey', 160, 96], ['rotary', 'Rotary', 'rotary', 192, 192]]],
  ['Steps & safety', [['slider', 'Slider', 'slider', 112, 320], ['guard', 'Guarded cover', 'guard', 192, 96], ['slide', 'Slide to confirm', 'slide', 272, 96]]],
  ['Displays', [['screen', 'Status screen', 'screen', 272, 112], ['label', 'Label', 'label', 128, 32], ['placard', 'Placard', 'placard', 128, 32], ['plate', 'Blank plate', 'plate', 450, 0]]],
];
const glyph = g => `<svg class="i" viewBox="0 0 24 24" style="width:22px;height:22px">${G[g]}</svg>`;

/** Opens the editor on a page of yours (already showing). Resumes an unsaved draft. */
export function openEditor(id, saved) {
  if (open || !saved) return;
  const draft = ctx.store.get(draftKey(id), null);
  spec = (draft && cleanPage(draft)) || clone(saved);
  undo = []; sel = null; trying = false; open = true;
  build();
  paint();
  if (draft) ctx.toast('Your unsaved changes are back');
}

function close() {
  open = false; trying = false; ctx.K.dry = false;
  for (const el of Object.values(ui)) el?.remove?.();
  ui = {};
  document.getElementById('stage').classList.remove('editing', 'ed-try');
  $c().removeEventListener('pointerdown', down, true);
  ['pointerup', 'pointercancel', 'click'].forEach(t => $c().removeEventListener(t, swallow, true));
  const id = spec.id;
  spec = null; sel = null;
  ctx.preview(null, id);
}

// ---------- the editor's own parts ----------
function build() {
  const stage = document.getElementById('stage');
  stage.classList.add('editing');
  // Palette, over the status display.
  ui.pal = h(`<div class="ed-pal"><h3>Controls</h3><p>Drag onto a plate. They snap to the ${GRID} px grid.</p>${PALETTE.map(([g, tiles]) => `<h4>${g}</h4><div class="ed-tiles">${tiles.map(([t, name, gl, w, ht]) =>
    `<div class="ed-tile" role="button" data-t="${t}" data-w="${w}" data-h="${ht}" data-name="${esc(name)}">${glyph(gl)}<span>${esc(name)}</span></div>`).join('')}</div>`).join('')}</div>`);
  document.getElementById('status').appendChild(ui.pal);
  ui.pal.addEventListener('pointerdown', paletteDrag);
  // Bar: name, undo, size, try it, delete, done.
  ui.bar = h(`<div class="arrange-bar ed-bar"><span class="ed-name" role="button"></span><small class="ed-from"></small>
    <button data-a="undo">Undo</button><span class="ed-seg"><button data-a="fit">Fit</button><button data-a="actual">Actual size</button></span>
    <button data-a="try">Try it</button><button data-a="delete">Delete</button><button data-a="done" class="primary">Done</button></div>`);
  stage.appendChild(ui.bar);
  ui.bar.addEventListener('pointerup', barTap);
  ui.note = h('<div class="ed-note" hidden></div>');
  stage.appendChild(ui.note);
  ui.card = h('<div class="ed-card" hidden></div>');
  stage.appendChild(ui.card);
  ui.card.addEventListener('pointerup', cardTap);
  $c().addEventListener('pointerdown', down, true);
  ['pointerup', 'pointercancel', 'click'].forEach(t => $c().addEventListener(t, swallow, true));
}

let deleting = 0;
function barTap(e) {
  const b = e.target.closest('button, .ed-name');
  if (!b) return;
  const a = b.dataset.a;
  ctx.tick('tap');
  if (b.matches('.ed-name')) return type('Page name', spec.name, 24, v => commit(s => { s.name = v || s.name; }));
  if (a === 'undo' && undo.length) { spec = JSON.parse(undo.pop()); saveDraft(); paint(); }
  if (a === 'fit' || a === 'actual') commit(s => { s.size = a; });
  if (a === 'try') { trying = !trying; ctx.K.dry = trying; sel = trying ? null : sel; paint(); }
  if (a === 'delete') {
    if (Date.now() - deleting < 3000) { ctx.store.set(draftKey(spec.id), null); const id = spec.id; open = false; closeQuiet(); ctx.remove(id); return; }
    deleting = Date.now();
    b.textContent = 'Tap again to delete';
    setTimeout(() => { if (b.isConnected) b.textContent = 'Delete'; }, 3000);
  }
  if (a === 'done') done();
}
function closeQuiet() {
  for (const el of Object.values(ui)) el?.remove?.();
  ui = {}; ctx.K.dry = false; trying = false;
  document.getElementById('stage').classList.remove('editing', 'ed-try');
  $c().removeEventListener('pointerdown', down, true);
  ['pointerup', 'pointercancel', 'click'].forEach(t => $c().removeEventListener(t, swallow, true));
  spec = null; sel = null;
}

function done() {
  const problems = check();
  if (problems.length) { note(problems[0], 'bad'); ctx.tick('error'); return; }
  const saved = ctx.save(spec);
  if (!saved) { note('This page could not be saved', 'bad'); return; }
  ctx.store.set(draftKey(spec.id), null);
  ctx.toast(`${saved.name} saved`);
  close();
}

/** What stops a save: controls without keys, labels that don't fit. */
function check() {
  const out = [];
  const empty = spec.plates.reduce((n, p) => n + p.add.filter(unset).length, 0);
  if (empty) out.push(`${empty} control${empty > 1 ? 's have' : ' has'} no key yet. Pick one or remove ${empty > 1 ? 'them' : 'it'}`);
  const over = $c().querySelectorAll('.ed-overlap').length;
  if (over) out.push(`${over} control${over > 1 ? 's overlap' : ' overlaps'} another. Drag ${over > 1 ? 'them' : 'it'} apart`);
  const cut = $c().querySelectorAll('.ed-nofit').length;
  if (cut) out.push(`${cut} label${cut > 1 ? 's don\'t' : ' doesn\'t'} fit. Make the control bigger or the label shorter`);
  return out;
}

function note(text, cls = '') {
  if (!ui.note) return;
  ui.note.hidden = !text;
  ui.note.className = `ed-note ${cls}`;
  ui.note.textContent = text || '';
}

// ---------- changes ----------
function commit(fn) {
  undo.push(JSON.stringify(spec));
  if (undo.length > 60) undo.shift();
  const next = clone(spec);
  fn(next);
  spec = cleanPage(next) || spec;
  saveDraft();
  paint();
}
const saveDraft = () => ctx.store.set(draftKey(spec.id), spec);

/** Redraws the page from the draft, then marks it up for editing. */
function paint() {
  ctx.preview(spec);
  const stage = document.getElementById('stage');
  stage.classList.toggle('ed-try', trying);
  const plates = platesEl();
  // Labels that don't fit their control.
  // Your controls, and stock ones you moved; untouched stock controls are checked by the stock tests.
  const moved = new Set(spec.plates.flatMap((pl, i) => Object.keys(pl.edits.move).map(id => `${i}|${id}`)));
  for (const el of $c().querySelectorAll('[data-add], [data-cid]')) {
    if (el.dataset.cid && !moved.has(`${platesEl().indexOf(el.parentElement)}|${el.dataset.cid}`)) continue;
    const box = el.getBoundingClientRect();
    const leaves = [el, ...el.querySelectorAll('*')].filter(t => !t.children.length && t.textContent.trim() && t.offsetWidth);
    const bad = leaves.some(t => {
      const r = t.getBoundingClientRect();
      return t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflow !== 'visible'
        || r.right > box.right + 2 || r.left < box.left - 2 || r.bottom > box.bottom + 2;
    });
    el.classList.toggle('ed-nofit', bad);
  }
  // Controls that overlap another (yours, or stock ones you moved, against everything on the plate).
  for (const pl of plates) {
    const all = [...pl.querySelectorAll(':scope > [data-add], :scope > [data-cid]')].map(e => ({ e, r: e.getBoundingClientRect() })).filter(o => o.r.width);
    for (const o of all) {
      const mine = o.e.dataset.add !== undefined || moved.has(`${plates.indexOf(pl)}|${o.e.dataset.cid}`);
      o.e.classList.toggle('ed-overlap', mine && all.some(q => q !== o && q.r.left < o.r.right - 1 && o.r.left < q.r.right - 1 && q.r.top < o.r.bottom - 1 && o.r.top < q.r.bottom - 1));
    }
  }
  // The selection.
  const el = selected(plates);
  if (sel && !el && !sel.plate) sel = null;
  el?.classList.add('ed-sel');
  if (el && sel.add !== undefined && !TYPES[item().t]?.fixed) el.appendChild(h('<i class="ed-handle"></i>'));
  if (sel?.plate) plates[sel.p]?.classList.add('ed-psel');
  // Bar state.
  ui.bar.querySelector('.ed-name').textContent = spec.name;
  ui.bar.querySelector('.ed-from').textContent = spec.from ? `from ${ctx.pageName(spec.from) || spec.from}` : '';
  ui.bar.querySelector('[data-a="undo"]').disabled = !undo.length;
  const size = spec.size || ctx.size();
  ui.bar.querySelectorAll('.ed-seg button').forEach(b => b.classList.toggle('cur', b.dataset.a === size));
  ui.bar.querySelector('[data-a="try"]').classList.toggle('cur', trying);
  const problems = check();
  note(trying ? 'Try it: presses light up as in flight, but no keys are sent' : problems[0] || '', trying ? 'info' : problems.length ? 'warn' : '');
  card(el);
}

function selected(plates = platesEl()) {
  if (!sel) return null;
  const p = plates[sel.p];
  if (!p) return null;
  if (sel.add !== undefined) return p.querySelector(`:scope > [data-add="${sel.add}"]`);
  if (sel.cid) return [...p.querySelectorAll(':scope > [data-cid]')].find(e => e.dataset.cid === sel.cid) || null;
  return null;
}
const item = () => spec.plates[sel.p]?.add[sel.add];

// ---------- pointer: select, move, resize ----------
function swallow(e) { if (open && !trying) e.stopPropagation(); }

function down(e) {
  if (!open || trying) return;
  e.stopPropagation();
  const plate = e.target.closest('#console > .plate');
  if (!plate) { sel = null; paint(); return; }
  const p = platesEl().indexOf(plate);
  const handle = e.target.closest('.ed-handle');
  const el = e.target.closest('[data-add], [data-cid]');
  if (handle && sel?.add !== undefined) return resize(e, p);
  if (!el || el.parentElement !== plate) { sel = { p, plate: true }; ctx.tick('tap'); paint(); return; }
  sel = el.dataset.add !== undefined ? { p, add: +el.dataset.add } : { p, cid: el.dataset.cid };
  ctx.tick('tap');
  paint();
  move(e, p);
}

function boxOf(p, el) {
  if (sel.add !== undefined) { const it = item(); return [it.x, it.y, it.w, it.h]; }
  return spec.plates[p].edits.move[sel.cid] || [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight];
}

function move(e, p) {
  const el = selected();
  if (!el) return;
  const [bx, by, bw, bh] = boxOf(p, el);
  const s = ctx.scale(), x0 = e.clientX, y0 = e.clientY;
  let moved = false, nx = bx, ny = by;
  const plate = el.parentElement, pw = plate.offsetWidth;
  const mv = ev => {
    const dx = (ev.clientX - x0) / s, dy = (ev.clientY - y0) / s;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!moved) { moved = true; ui.card.hidden = true; el.classList.add('ed-lift'); }
    const free = sel.add !== undefined;  // a control of yours may leave for another plate
    nx = snap(bx + dx); ny = snap(by + dy);
    if (!free) { nx = Math.max(0, Math.min(pw - bw, nx)); ny = Math.max(0, Math.min(PLATE_H - bh, ny)); }
    el.style.translate = `${nx - bx}px ${ny - by}px`;
    guides(plate, el, nx, ny, bw, bh);
  };
  const up = ev => {
    removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
    plate.querySelectorAll('.ed-guide').forEach(g => g.remove());
    if (!moved) return;
    el.style.translate = '';
    if (sel.add !== undefined) {
      const to = plateAt(ev.clientX, ev.clientY);
      const q = to ? platesEl().indexOf(to) : p;
      if (q !== p && q >= 0) {
        const r = to.getBoundingClientRect(), grabX = (x0 - el.getBoundingClientRect().left) / s, grabY = (y0 - el.getBoundingClientRect().top) / s;
        const it = item();
        const tx = snap((ev.clientX - r.left) / s - grabX), ty = snap((ev.clientY - r.top) / s - grabY);
        commit(sp => { sp.plates[p].add.splice(sel.add, 1); sp.plates[q].add.push({ ...it, x: tx, y: ty }); });
        sel = { p: q, add: spec.plates[q].add.length - 1 };
        paint();
      } else commit(sp => Object.assign(sp.plates[p].add[sel.add], { x: nx, y: ny }));
    } else commit(sp => { sp.plates[p].edits.move[sel.cid] = [nx, ny, bw, bh]; });
    ctx.tick('detent');
  };
  // Capture: the console swallows pointerup while editing, so its controls never fire.
  addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
}

function resize(e, p) {
  const el = selected();
  const it = item();
  const t = TYPES[it.t];
  const s = ctx.scale(), x0 = e.clientX, y0 = e.clientY;
  let nw = it.w, nh = it.h;
  const plate = el.parentElement;
  const mv = ev => {
    nw = Math.max(t.min[0], Math.min(plate.offsetWidth - it.x - GRID, snap(it.w + (ev.clientX - x0) / s)));
    nh = Math.max(t.min[1], Math.min(PLATE_H - it.y - GRID, snap(it.h + (ev.clientY - y0) / s)));
    el.style.width = `${nw}px`; el.style.height = `${nh}px`;
    note(`${nw} × ${nh}`, 'info');
  };
  const up = () => {
    removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
    if (nw !== it.w || nh !== it.h) commit(sp => Object.assign(sp.plates[p].add[sel.add], { w: nw, h: nh })); else paint();
  };
  // Capture: the console swallows pointerup while editing, so its controls never fire.
  addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
}

/** Lines across the plate where the moving control lines up with another. */
function guides(plate, el, x, y, w, ht) {
  plate.querySelectorAll('.ed-guide').forEach(g => g.remove());
  const xs = new Set(), ys = new Set();
  for (const o of plate.querySelectorAll(':scope > [data-add], :scope > [data-cid]')) {
    if (o === el) continue;
    const ox = [o.offsetLeft, o.offsetLeft + o.offsetWidth, o.offsetLeft + o.offsetWidth / 2];
    const oy = [o.offsetTop, o.offsetTop + o.offsetHeight, o.offsetTop + o.offsetHeight / 2];
    for (const a of [x, x + w, x + w / 2]) for (const b of ox) if (Math.abs(a - b) <= 2) xs.add(b);
    for (const a of [y, y + ht, y + ht / 2]) for (const b of oy) if (Math.abs(a - b) <= 2) ys.add(b);
  }
  for (const v of xs) plate.appendChild(h(`<i class="ed-guide v" style="left:${v}px"></i>`));
  for (const v of ys) plate.appendChild(h(`<i class="ed-guide h" style="top:${v}px"></i>`));
}

const plateAt = (x, y) => document.elementsFromPoint(x, y).map(e => e.closest?.('#console > .plate')).find(Boolean) || null;

// ---------- palette ----------
function paletteDrag(e) {
  const tile = e.target.closest('.ed-tile');
  if (!tile || trying) return;
  e.preventDefault();
  const { t, name } = tile.dataset;
  const w = +tile.dataset.w, ht = +tile.dataset.h;
  const s = ctx.scale();
  const ghost = h(`<div class="ed-ghost">${esc(name)}</div>`);
  Object.assign(ghost.style, { width: `${w * s}px`, height: `${(ht || 160) * s}px` });
  let started = false;
  const x0 = e.clientX, y0 = e.clientY;
  const mv = ev => {
    if (!started && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 8) return;
    if (!started) { started = true; document.body.appendChild(ghost); ctx.tick('detent'); }
    ghost.style.left = `${ev.clientX - w * s / 2}px`; ghost.style.top = `${ev.clientY - (ht || 160) * s / 2}px`;
    platesEl().forEach(p => p.classList.toggle('ed-drop', p === plateAt(ev.clientX, ev.clientY)));
  };
  const up = ev => {
    removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
    ghost.remove();
    platesEl().forEach(p => p.classList.remove('ed-drop'));
    if (!started) { note(`Drag the ${name.toLowerCase()} onto a plate`, 'info'); return; }
    const to = plateAt(ev.clientX, ev.clientY);
    if (!to) return;
    const q = platesEl().indexOf(to);
    if (t === 'plate') return addPlate(q, ev.clientX < to.getBoundingClientRect().left + to.getBoundingClientRect().width / 2);
    const r = to.getBoundingClientRect();
    const x = snap((ev.clientX - r.left) / s - w / 2), y = snap((ev.clientY - r.top) / s - ht / 2);
    const it = { t, x, y, w, h: ht };
    if (t === 'label' || t === 'placard') it.text = 'Label';
    if (t === 'screen') it.field = 'location';
    commit(sp => { sp.plates[q].add.push(it); });
    sel = { p: q, add: spec.plates[q].add.length - 1 };
    paint();
    if (unset(item())) pick();
  };
  // Capture: the console swallows pointerup while editing, so its controls never fire.
  addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
}

function used(sp = spec) { return sp.plates.reduce((n, p) => n + p.w + GAP, 0) - GAP; }

function addPlate(at, before) {
  const room = SPACE - used() - GAP;
  const w = [WIDTHS.role, WIDTHS.flight, WIDTHS.power, WIDTHS.gear].find(v => v <= room);
  if (!w) { note('No room for another plate. Remove a plate or make one narrower first', 'warn'); ctx.tick('error'); return; }
  const i = before ? at : at + 1;
  commit(sp => { sp.plates.splice(i, 0, { w, title: 'Plate', add: [] }); });
  sel = { p: i, plate: true };
  paint();
}

// ---------- the card for the selection ----------
function card(el) {
  const c = ui.card;
  if (!sel || trying) { c.hidden = true; return; }
  const p = platesEl()[sel.p];
  const target = el || p;
  if (!target) { c.hidden = true; return; }
  const rows = [];
  let title = '';
  const btn = (a, t, cls = '') => `<button data-a="${a}" class="${cls}">${t}</button>`;
  if (sel.add !== undefined) {
    const it = item();
    const t = TYPES[it.t];
    title = t.name;
    const keyRow = (slot, label, value, base = false) => {
      const bound = value ? ctx.bound(value, base) : true;
      rows.push(`<div class="ed-row ${value ? '' : 'empty'}"><span><small>${label}</small><b>${esc(value || 'None yet')}</b>${bound ? '' : '<em class="amber">Not bound in your game yet</em>'}</span>${btn(`pick:${slot}`, value ? 'Change' : 'Pick', 'link')}</div>`);
    };
    if (t.takes === 'tap' || t.takes === 'danger') keyRow('key', 'Key', it.key);
    if (t.takes === 'set') keyRow('key', 'Switches', it.key, true);
    if (t.takes === 'pair') { keyRow('a', it.t === 'slider' ? 'Up' : 'Left / up', it.a); keyRow('b', it.t === 'slider' ? 'Down' : 'Right / down', it.b); }
    if (t.takes === 'positions') {
      const pos = it.positions || [];
      pos.forEach((q, i) => keyRow(`pos${i}`, `Position ${i + 1}`, q.key));
      if (pos.length < 4) rows.push(`<div class="ed-row">${btn('addpos', 'Add a position', 'link')}</div>`);
    }
    if (t.takes === 'text') rows.push(`<div class="ed-row"><span><small>Text</small><b>${esc(it.text || '')}</b></span>${btn('text', 'Edit', 'link')}</div>`);
    if (t.takes === 'field') rows.push(`<div class="ed-row col"><small>Shows</small><span class="ed-chips">${Object.entries(FIELDS).map(([f, n]) => `<button data-a="field:${f}" class="${it.field === f ? 'cur' : ''}">${esc(n)}</button>`).join('')}</span></div>`);
    if (['tap', 'set', 'danger'].includes(t.takes) && it.key) rows.push(`<div class="ed-row"><span><small>Label</small><b>${esc(it.label || `${it.key} (the key's own)`)}</b></span>${it.label ? btn('unlabel', 'Reset', 'link') : ''}${btn('label', 'Edit', 'link')}</div>`);
    rows.push(`<div class="ed-row"><span><small>Size</small><b>${t.fixed ? `${t.min[0]} × ${t.min[1]} · fixed` : `${it.w} × ${it.h} · drag the corner`}</b></span></div>`);
    rows.push(`<div class="ed-acts">${btn('dup', 'Duplicate')}${btn('remove', 'Remove', 'bad')}</div>`);
  } else if (sel.cid) {
    title = 'Stock control';
    const moved = !!spec.plates[sel.p].edits.move[sel.cid];
    rows.push(`<div class="ed-row"><span><small>${esc(sel.cid.replace(/^\d+:/, '') || 'Control')}</small><b>From the stock ${esc(spec.plates[sel.p].stock)} plate. Drag to move it</b></span></div>`);
    rows.push(`<div class="ed-acts">${moved ? btn('unmove', 'Back to place') : ''}${btn('hide', 'Remove', 'bad')}</div>`);
  } else {
    const pl = spec.plates[sel.p];
    title = pl.stock ? `${pl.stock[0].toUpperCase()}${pl.stock.slice(1)} plate (stock)` : 'Your plate';
    if (!pl.stock) {
      rows.push(`<div class="ed-row"><span><small>Title</small><b>${esc(pl.title || 'None')}</b></span>${btn('ptitle', 'Edit', 'link')}</div>`);
      const room = SPACE - used() + pl.w;
      rows.push(`<div class="ed-row col"><small>Width</small><span class="ed-chips">${Object.values(WIDTHS).sort((a, b) => a - b).map(w =>
        `<button data-a="w:${w}" class="${pl.w === w ? 'cur' : ''}" ${w > room ? 'disabled' : ''}>${w}</button>`).join('')}</span></div>`);
    } else {
      const n = pl.edits.hide.length + Object.keys(pl.edits.move).length;
      if (n) rows.push(`<div class="ed-row"><span><small>Your changes</small><b>${pl.edits.hide.length} removed, ${Object.keys(pl.edits.move).length} moved</b></span>${btn('restock', 'Back to stock', 'link')}</div>`);
    }
    rows.push(`<div class="ed-acts">${sel.p > 0 ? btn('left', 'Move left') : ''}${sel.p < spec.plates.length - 1 ? btn('right', 'Move right') : ''}${spec.plates.length > 1 ? btn('premove', 'Remove plate', 'bad') : ''}</div>`);
  }
  c.innerHTML = `<h4>${esc(title)}</h4>${rows.join('')}`;
  c.hidden = false;
  // Beside the selection, inside the stage.
  const stage = document.getElementById('stage').getBoundingClientRect(), s = ctx.scale();
  const r = target.getBoundingClientRect();
  const cw = 360, chh = c.offsetHeight;
  let x = (r.right - stage.left) / s + 16;
  if (x + cw > 2550) x = (r.left - stage.left) / s - cw - 16;
  if (sel.plate) x = (r.left - stage.left) / s + Math.max(16, (r.width / s - cw) / 2);
  const y = Math.max(70, Math.min(720 - chh - 10, (r.top - stage.top) / s + (sel.plate ? 70 : 0)));
  c.style.left = `${Math.max(390, x)}px`; c.style.top = `${y}px`;
}

function cardTap(e) {
  const a = e.target.closest('button')?.dataset.a;
  if (!a) return;
  ctx.tick('tap');
  const p = sel.p;
  if (a.startsWith('pick:')) return pick(a.slice(5));
  if (a === 'addpos') return commit(sp => { (sp.plates[p].add[sel.add].positions ||= []).push({ label: '', key: '' }); });
  if (a.startsWith('field:')) return commit(sp => { sp.plates[p].add[sel.add].field = a.slice(6); });
  if (a === 'text') return type('Text', item().text, 24, v => commit(sp => { sp.plates[p].add[sel.add].text = v; }));
  if (a === 'label') return type('Label', item().label || item().key, 24, v => commit(sp => { sp.plates[p].add[sel.add].label = v === item().key ? '' : v; }));
  if (a === 'unlabel') return commit(sp => { sp.plates[p].add[sel.add].label = ''; });
  if (a === 'dup') {
    const it = item();
    commit(sp => { sp.plates[p].add.push({ ...clone(it), x: it.x + GRID * 2, y: it.y + GRID * 2 }); });
    sel = { p, add: spec.plates[p].add.length - 1 };
    return paint();
  }
  if (a === 'remove') { const n = sel.add; sel = { p, plate: true }; return commit(sp => { sp.plates[p].add.splice(n, 1); }); }
  if (a === 'hide') { const id = sel.cid; sel = { p, plate: true }; return commit(sp => { sp.plates[p].edits.hide.push(id); delete sp.plates[p].edits.move[id]; }); }
  if (a === 'unmove') return commit(sp => { delete sp.plates[p].edits.move[sel.cid]; });
  if (a === 'restock') return commit(sp => { sp.plates[p].edits = { hide: [], move: {} }; });
  if (a === 'ptitle') return type('Plate title', spec.plates[p].title, 24, v => commit(sp => { sp.plates[p].title = v; }));
  if (a.startsWith('w:')) return commit(sp => { sp.plates[p].w = +a.slice(2); });
  if (a === 'left' || a === 'right') {
    const q = a === 'left' ? p - 1 : p + 1;
    commit(sp => { const [pl] = sp.plates.splice(p, 1); sp.plates.splice(q, 0, pl); });
    sel = { p: q, plate: true };
    return paint();
  }
  if (a === 'premove') { sel = null; return commit(sp => { sp.plates.splice(p, 1); }); }
}

/** Picks a key for the selected control, through the console's key picker. */
function pick(slot = 'key') {
  const it = item();
  if (!it) return;
  const t = TYPES[it.t];
  const pos = slot.startsWith('pos') ? +slot.slice(3) : -1;
  const now = pos >= 0 ? it.positions[pos]?.key : it[slot];
  const { p, add } = sel;
  ctx.openPicker({
    title: `${t.name}: ${t.takes === 'set' ? 'what it switches' : t.takes === 'pair' ? (slot === 'a' ? 'first key' : 'second key') : 'its key'}`,
    now, base: t.takes === 'set',
    refuse: label => refuse(it.t, label, ctx.keys),
    onPick: label => commit(sp => {
      const x = sp.plates[p].add[add];
      if (pos >= 0) x.positions[pos] = { label: x.positions[pos].label || '', key: label };
      else x[slot] = label;
    }),
  });
}

// ---------- typing, on the console's own keyboard (the game keeps focus) ----------
function type(title, value, max, done) {
  let v = value || '';
  ui.kb?.remove();
  const kb = h(`<div class="ed-kbw"><h4>${esc(title)}</h4><div class="ed-in"><span></span><i></i></div><div class="ed-kb"></div></div>`);
  const show = () => { kb.querySelector('.ed-in span').textContent = v; };
  const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL-', 'ZXCVBNM+&/'];
  let shift = true;
  const keys = kb.querySelector('.ed-kb');
  const key = (t, fn, cls = '') => { const b = h(`<button class="${cls}">${esc(t)}</button>`); b.addEventListener('pointerup', () => { ctx.tick('tap'); fn(); show(); paintCase(); }); return b; };
  const paintCase = () => keys.querySelectorAll('button.c').forEach(b => { b.textContent = shift ? b.dataset.c.toUpperCase() : b.dataset.c.toLowerCase(); });
  for (const r of rows) for (const ch of r) {
    const b = key(ch, () => { if (v.length < max) v += shift ? ch.toUpperCase() : ch.toLowerCase(); if (/[a-z]/i.test(ch)) shift = false; }, /[A-Z]/.test(ch) ? 'c' : '');
    b.dataset.c = ch;
    keys.appendChild(b);
  }
  keys.append(key('Shift', () => { shift = !shift; }, 'w'), key('Space', () => { if (v.length < max) { v += ' '; shift = false; } }, 'space'), key('⌫', () => { v = v.slice(0, -1); }, 'w'),
    key('Cancel', () => { kb.remove(); ui.kb = null; }, 'w'), key('Done', () => { kb.remove(); ui.kb = null; done(v.trim()); }, 'w primary'));
  document.getElementById('stage').appendChild(kb);
  ui.kb = kb;
  show(); paintCase();
}
