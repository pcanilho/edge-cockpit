// Reordering the ship plates. Long-press a plate's title strip to start; drag plates
// sideways; Done saves the order for that role (fighter, mining, ...), Reset restores it.
// Plates keep their widths, so any order fills the console exactly.

export const DEFAULT = ['power', 'role', 'flight', 'gear'];
const LEFT = 382, GAP = 6, HOLD_MS = 550;

let ctx = null; // { store, tick, role(), onDone() }
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
    if (!p) continue;
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
    timer = setTimeout(() => { timer = null; start(root); }, HOLD_MS);
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
  }
  bar = document.createElement('div');
  bar.className = 'arrange-bar';
  bar.innerHTML = `<span>Arrange the ${ctx.roleName()} console</span><button data-a="reset">Reset</button><button data-a="done" class="primary">Done</button>`;
  bar.addEventListener('pointerup', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'reset') { ctx.tick('tap'); place(root, DEFAULT); }
    if (a === 'done') finish(root);
  });
  root.parentElement.appendChild(bar);
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

function finish(root) {
  const order = current(root);
  const role = ctx.role();
  if (order.join() === DEFAULT.join()) ctx.store.set(key(role), null); else ctx.store.set(key(role), order);
  for (const g of root.querySelectorAll('.grab')) g.remove();
  root.classList.remove('arranging');
  bar?.remove(); bar = null;
  editing = false;
  ctx.tick('tap');
  ctx.onDone(role);
}
