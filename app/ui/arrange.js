// Reordering the ship plates. Long-press a plate's title strip to start; drag plates
// sideways; Done saves the order for that role (fighter, mining, ...), Reset restores it.
// Plates keep their widths, so any order fills the console exactly. The role plate also
// offers the other role modules, so a ship page can carry, say, the mining module.

export const DEFAULT = ['power', 'role', 'flight', 'gear'];
const LEFT = 382, GAP = 6, HOLD_MS = 550;

let ctx = null; // { store, tick, role(), roleName(), modules, module(), stockModule(), onDone(role, module) }
let picked = null; // the role module chosen in this session
let editing = false;
let bar = null;

const key = role => `order:${role}`;
export function orderFor(role) {
  const o = ctx?.store.get(key(role), null);
  return Array.isArray(o) && o.length === DEFAULT.length && DEFAULT.every(s => o.includes(s)) ? o : DEFAULT;
}

const platesIn = root => [...root.querySelectorAll(':scope > .plate[data-slot]')];

/** Places the plates in `order`, left to right. Cheap: four style writes. */
export function place(root, order) {
  const by = Object.fromEntries(platesIn(root).map(p => [p.dataset.slot, p]));
  let x = LEFT;
  for (const slot of order) {
    const p = by[slot];
    // A plate moved to a phone leaves no gap.
    if (!p || p.classList.contains('moved')) continue;
    p.style.left = `${x}px`;
    x += p.offsetWidth + GAP;
  }
}

export function init(root, c) {
  ctx = c;
  // Long press on a title strip enters edit mode.
  let timer = null;
  root.addEventListener('pointerdown', e => {
    if (editing || root.closest('.stacked') || !e.target.closest('.plate[data-slot] :is(.title, .rtitle)')) return;
    // A page of yours opens the page editor instead.
    const mine = ctx.canArrange?.() === false;
    if (mine && !ctx.onEdit) return;
    timer = setTimeout(() => { timer = null; if (mine) ctx.onEdit(); else start(root); }, HOLD_MS);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('pointermove', e => { if (timer && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel(); });
}

export const isEditing = () => editing;

function start(root) {
  const plates = platesIn(root);
  if (plates.length !== DEFAULT.length) return;
  editing = true;
  ctx.tick('toggle');
  root.classList.add('arranging');
  for (const p of plates) {
    const grab = document.createElement('div');
    grab.className = 'grab';
    grab.innerHTML = `<span>${p.dataset.slot === 'role' ? 'Role module' : p.querySelector('.title')?.textContent || ''}</span><small>Drag to move</small>`;
    p.appendChild(grab);
    drag(root, p, grab);
    if (p.dataset.slot === 'role' && ctx.modules) modules(grab);
  }
  bar = document.createElement('div');
  bar.className = 'arrange-bar';
  bar.innerHTML = `<span>Arrange the ${ctx.roleName()} console</span><button data-a="reset">Reset</button>${ctx.onNew ? '<button data-a="import">Import</button><button data-a="new">New blank page</button><button data-a="dup" class="accent">Duplicate &amp; edit</button>' : ''}<button data-a="done" class="primary">Done</button>`;
  bar.addEventListener('pointerup', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'reset') { ctx.tick('tap'); place(root, DEFAULT); picked = ctx.stockModule(); paintModules(root); }
    if (a === 'done') finish(root);
    if (a === 'new' || a === 'dup' || a === 'import') { const make = { new: ctx.onNew, dup: ctx.onDuplicate, import: ctx.onImport }[a]; finish(root, true); make(); }
  });
  root.parentElement.appendChild(bar);
}

/** Chips for the role modules; the pick applies on Done. */
function modules(grab) {
  picked = ctx.module();
  const row = document.createElement('div');
  row.className = 'mods';
  for (const [id, name] of Object.entries(ctx.modules)) {
    const b = document.createElement('button');
    b.dataset.m = id;
    b.textContent = name;
    row.appendChild(b);
  }
  const note = document.createElement('small');
  note.className = 'mods-note';
  grab.append(row, note);
  // A chip is a tap, not the start of a drag.
  row.addEventListener('pointerdown', e => e.stopPropagation());
  row.addEventListener('pointerup', e => {
    const m = e.target.closest('button')?.dataset.m;
    if (!m) return;
    ctx.tick('detent');
    picked = m;
    paintModules(grab.closest('#console') || document);
  });
  paintModules(grab);
}
function paintModules(root) {
  const stock = ctx.stockModule();
  root.querySelectorAll('.mods button').forEach(b => b.classList.toggle('cur', b.dataset.m === picked));
  const note = root.querySelector('.mods-note');
  if (note) note.textContent = picked === stock ? `${ctx.modules[stock]} is stock for this ship` : `${ctx.modules[picked]} module on this ship page. ${ctx.modules[stock]} is stock`;
}

function current(root) {
  return platesIn(root).sort((a, b) => a.offsetLeft - b.offsetLeft).map(p => p.dataset.slot);
}

function drag(root, p, grab) {
  let x0 = null;
  grab.addEventListener('pointerdown', e => {
    e.stopPropagation();
    x0 = e.clientX;
    grab.setPointerCapture(e.pointerId);
    p.classList.add('lifted');
  });
  grab.addEventListener('pointermove', e => {
    if (x0 === null) return;
    const dx = (e.clientX - x0) / ctx.scale();
    p.style.transform = `translateX(${dx}px)`;
    // Live preview: where would the plate land?
    const mid = p.offsetLeft + dx + p.offsetWidth / 2;
    const others = platesIn(root).filter(o => o !== p).sort((a, b) => a.offsetLeft - b.offsetLeft);
    const at = others.filter(o => o.offsetLeft + o.offsetWidth / 2 < mid).length;
    const order = others.map(o => o.dataset.slot);
    order.splice(at, 0, p.dataset.slot);
    if (order.join() !== current(root).join()) {
      const before = p.offsetLeft;
      place(root, order);
      x0 += (p.offsetLeft - before) * ctx.scale();
      p.style.transform = `translateX(${(e.clientX - x0) / ctx.scale()}px)`;
      ctx.tick('detent');
    }
  });
  const drop = () => { if (x0 === null) return; x0 = null; p.style.transform = ''; p.classList.remove('lifted'); };
  grab.addEventListener('pointerup', drop);
  grab.addEventListener('pointercancel', drop);
}

function finish(root, quiet = false) {
  const order = current(root);
  const role = ctx.role();
  if (order.join() === DEFAULT.join()) ctx.store.set(key(role), null); else ctx.store.set(key(role), order);
  for (const g of root.querySelectorAll('.grab')) g.remove();
  root.classList.remove('arranging');
  bar?.remove(); bar = null;
  editing = false;
  ctx.tick('tap');
  ctx.onDone(role, picked, quiet);
  picked = null;
}
