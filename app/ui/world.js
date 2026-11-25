// The World page: the executive hangar cycle, your own timers, server status, and the
// commodity market where you are. Painted once a minute while it shows; prices and status
// come from the Rust side, which fetches them at most every 30 and 5 minutes.
import * as W from './lib/world.js';
import { h, esc, pressable } from './controls.js';
import { shardName, placeName } from './lib/gamelog.js';

let K; // app: game(), store, bridge, raise, tick, hhmm, current()
let market = null, marketErr = null, status = null, statusAt = 0, statusErr = false, loop = null;
let cm = { mode: 'here', side: 'buy', page: 0, sys: null, chip: null, letter: null, pick: null };
let dlg = null;
const MIN = 60_000;
const timers = () => K.store.get('world-timers', {});
const fmt = n => Math.round(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);
// Opening your inventory is what makes Game.log name the place you are at.
const INVENTORY = { label: 'Inventory', action: 'pc_pit_inventory', actionmap: 'player_choice', defaultKey: 'i', activation: '', press: 'tap', role: 'action', icon: 'crate' };
const invKey = (label, cls = '', off = false) => `<button class="wbtn inv ${cls}" data-inv="1" ${off ? 'disabled' : ''}><svg class="i" viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>${label}<small>${esc((K.keyHint(INVENTORY) || 'I').toUpperCase())}</small></button>`;

export function init(ctx) {
  K = ctx;
  dlg = h('<div class="wdlg" role="dialog" hidden><div class="wd-card"></div></div>');
  document.getElementById('stage').appendChild(dlg);
  dlg.addEventListener('pointerup', e => { if (e.target === dlg) closeDialog(); });
  armTimers();
}

// ---------- data ----------
async function loadMarket() {
  try { market = await K.bridge.worldPrices(); marketErr = null; } catch (e) { marketErr = String(e?.message || e); }
  paint();
}
async function loadStatus() {
  try { status = await K.bridge.worldStatus(); statusAt = Date.now(); statusErr = false; } catch { statusErr = true; }
  paint();
}
/** The page shows or hides: fetch while it shows, every 5 minutes (Rust keeps prices for 30). */
export function showing(on) {
  clearInterval(loop); loop = null;
  if (!on) { closeDialog(); return; }
  loadMarket(); loadStatus();
  loop = setInterval(() => { loadMarket(); loadStatus(); }, 5 * MIN);
}

// ---------- executive hangar ----------
function hangarSync() {
  const s = K.store.get('world-hangar', null), build = K.game().build?.branch || null;
  // Synced with the game closed: the first build seen after counts as the sync's.
  if (s && !s.build && build) { s.build = build; K.store.set('world-hangar', s); }
  return { s, ok: W.syncValid(s, build), build };
}
const lamps = (ls, cls = '') => `<div class="lamps ${cls}">${ls.map(l => `<i class="lamp ${l === 'g' ? 'g' : l === 'r' ? 'r' : ''}"></i>`).join('')}</div>`;
const ver = b => (b || '').replace(/^sc-alpha-/, '');

function paintHangar(el, now) {
  const { s, ok, build } = hangarSync();
  const hhmm = K.hhmm;
  let body;
  if (!ok) {
    const why = s ? `<span class="src warn"><i></i>Game updated to ${esc(ver(build))}</span><span class="note warn">Patches can restart the cycle. Look at the lights in game, then tap Sync.</span>`
      : '<span class="src dim"><i></i>Not synced</span><span class="note">Tap Sync at the hangar and pick what the five lights show.</span>';
    body = `${lamps(Array(5).fill('q'), 'unk')}<div class="state unk">Not synced</div><div class="xsub unk">Times show after you sync</div>
      <div class="cycle"><div class="bar unk"><span class="c"></span><span class="o"></span><span class="z"></span></div>${ticks()}
      <div class="rows"><div><small>Next opening</small><b>—</b><p>Sync to see</p></div><div><small>After that</small><b>—</b><p>Sync to see</p></div></div></div>
      <div class="foot">${why}<span class="sp"></span></div>`;
  } else {
    const x = W.hangarAt(s.start, now);
    const state = { charging: 'Charging', open: 'Open', reset: 'Reset' }[x.phase];
    const sub = x.phase === 'open' ? `Closes at <em>${hhmm(x.ends)}</em> · in ${W.inMinutes(x.ends - now)}`
      : x.phase === 'charging' ? `Opens at <em>${hhmm(x.ends)}</em> · in ${W.inMinutes(x.ends - now)}`
        : `Charging again at <em>${hhmm(x.ends)}</em>`;
    const win = ([a, b], note) => `<div><small>${note[0]}</small><b>${hhmm(a)} – ${hhmm(b)}</b><p>${note[1]}</p></div>`;
    body = `<span class="t">Next light at ${hhmm(x.changes)}</span>${lamps(x.lights)}<div class="state ${x.phase}">${state}</div><div class="xsub">${sub}</div>
      <div class="cycle"><div class="bar"><span class="c"></span><span class="o"></span><span class="z"></span><i class="now" style="left:calc(${(x.progress * 100).toFixed(1)}% - 1px)"></i></div>${ticks()}
      <div class="rows">${win(x.windows[0], [x.phase === 'charging' ? 'Opens' : 'Next opening', 'All five lights green'])}${win(x.windows[1], ['After that', 'Same cycle on every server'])}</div></div>
      <div class="foot"><span class="src"><i></i>Synced by you · ${hhmm(s.at)}</span><span class="note">${s.build ? `Same game build since then (${esc(ver(s.build))})` : 'Synced with the game closed'}</span><span class="sp"></span></div>`;
  }
  el.innerHTML = `<small class="h">Executive hangars · PYAM-EXHANG-0-1</small>${body}`;
  const key = h('<div class="well key wsync"><div class="cap"><span class="led"></span><span class="lg">Sync</span></div></div>');
  pressable(key, { up: () => { K.tick('tap'); syncDialog(); } });
  el.querySelector('.foot').appendChild(key);
}
const ticks = () => '<div class="ticks"><span style="left:0">Charging · 2 h</span><span style="left:65%">Open · 1 h</span><span style="right:0">Reset · 5 min</span></div>';

function syncDialog() {
  const opts = W.LIGHT_STATES.map(s => `<button class="ls" data-s="${s.id}">${lamps(s.lights)}<span>${s.phase === 'charging' ? `${s.lights.filter(l => l === 'g').length} green, ${s.lights.filter(l => l === 'r').length} red` : s.phase === 'open' ? `${s.lights.filter(l => l === 'g').length} green` : 'All dark'}</span></button>`).join('');
  openDialog(`<small>Executive hangars</small><h3>What do the lights show?</h3>
    <p class="wd-p">Tap the moment a light changes, on what it shows now: the times are then exact. Tapped in between, they can be up to 24 minutes off.</p>
    <div class="ls-grid">${opts}</div><div class="upd-btns"><button class="later" data-x="close">Cancel</button></div>`, b => {
    if (b.dataset.s) { const s = W.syncAt(b.dataset.s, Date.now()); K.store.set('world-hangar', { ...s, build: K.game().build?.branch || null }); closeDialog(); paint(); }
  });
}

// ---------- your timers ----------
function paintTimers(el, now) {
  const runs = timers();
  el.innerHTML = '<small class="h">Your timers</small><div class="tm"></div>';
  const grid = el.querySelector('.tm');
  for (const def of W.TIMERS) {
    const run = runs[def.id], st = W.timerAt(def, run, now);
    let v, s;
    if (!st.running) { v = def.id === 'own' ? 'Tap to set' : 'Tap to start'; s = def.note; }
    else if (def.cycle) { v = st.open ? 'Open now' : `Opens in ${W.inMinutes(st.left)}`; s = st.open ? `Closes at ${K.hhmm(st.next)}` : `Opens at ${K.hhmm(st.next)} for 1 min`; }
    else { v = `${W.inMinutes(st.left)} left`; s = `Ready at ${K.hhmm(st.next)} · ${run.mins} min`; }
    const key = h(`<div class="well tmr ${st.running ? 'run' : ''} ${st.open ? 'open' : ''}"><div class="cap"><span class="led"></span><span class="lg">${esc(def.name)}</span>
      <span class="v ${st.running ? '' : 'idle'}">${esc(v)}</span><span class="s">${esc(s)}</span>${st.running ? `<span class="prog"><i style="width:${Math.round(st.progress * 100)}%"></i></span>` : ''}</div></div>`);
    pressable(key, { up: () => { K.tick('tap'); timerTap(def, st.running); } });
    grid.appendChild(key);
  }
}
function setTimer(id, run) {
  const all = timers();
  if (run) all[id] = run; else delete all[id];
  K.store.set('world-timers', all);
  armTimers(); paint();
}
function timerTap(def, running) {
  const start = mins => setTimer(def.id, { started: Date.now(), mins, shard: K.game().shard || null });
  if (!running && def.id !== 'own') return start(def.mins);
  const durations = def.id === 'own' ? `<div class="ls-grid mins">${W.OWN_MINUTES.map(m => `<button class="ls" data-m="${m}"><span>${m < 60 ? `${m} min` : `${m / 60} h`}</span></button>`).join('')}</div>` : '';
  openDialog(`<small>Your timers</small><h3>${esc(def.name)}</h3>${def.id === 'own' ? '<p class="wd-p">Starts now and chimes when it ends.</p>' : ''}${durations}
    <div class="upd-btns">${running ? '<button class="later" data-x="stop">Stop</button>' : ''}<button class="later" data-x="close">Cancel</button>${running && def.id !== 'own' ? '<button class="go" data-x="restart">Restart</button>' : ''}</div>`, b => {
    if (b.dataset.m) start(Number(b.dataset.m));
    else if (b.dataset.x === 'stop') setTimer(def.id, null);
    else if (b.dataset.x === 'restart') start(def.mins);
    closeDialog();
  });
}
// One wake-up per running timer, at its end, for the chime. Nothing ticks in between.
let timeouts = [];
function armTimers() {
  timeouts.forEach(clearTimeout); timeouts = [];
  const runs = timers(), now = Date.now();
  for (const def of W.TIMERS) {
    const run = runs[def.id];
    if (!run) continue;
    // The vault door is one server's: a new server ends it.
    const shard = K.game().shard;
    if (def.cycle && run.shard && shard && shard !== run.shard) { setTimer(def.id, null); return; }
    const st = W.timerAt(def, run, now);
    if (!st.running) { if (st.done) setTimer(def.id, null); continue; }
    timeouts.push(setTimeout(() => {
      K.raise({ text: def.cycle ? 'Ruin vault door opening' : `${def.name === 'Own timer' ? 'Your timer' : def.name} ready`, tone: 'good' });
      if (!def.cycle) setTimer(def.id, null); else armTimers();
      paint();
    }, Math.min(st.next - now + 50, 2 ** 31 - 1)));
  }
}

// ---------- servers ----------
// The status page's words (cState): operational, disrupted, down, maintenance.
const STATUS = { operational: 'Operational', ok: 'Operational', disrupted: 'Disrupted', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance', notice: 'Notice' };
function paintServers(el) {
  const fresh = status && Date.now() - statusAt < 15 * MIN;
  const rows = (status?.services?.length ? status.services : [{ name: 'Platform' }, { name: 'Persistent Universe' }, { name: 'Arena Commander' }])
    .map(s => `<li>${esc(s.name)}<span class="${fresh ? esc(s.status) : 'unk'}"><i></i>${fresh ? esc(STATUS[s.status] || s.status) : 'Not checked'}</span></li>`).join('');
  const g = K.game(), sh = shardName(g.shard);
  const me = sh ? `<b>${esc([sh.region, sh.n && `shard ${sh.n}`].filter(Boolean).join(' · '))}</b><p>${g.lag ? `Last lag spike ${Math.round(g.lag.len || 0)} s` : 'No lag spikes logged'}</p>` : '<b class="none">Not joined</b><p>Shows when you join a server</p>';
  el.innerHTML = `<small class="h">Servers</small><ul>${rows}</ul><div class="me"><small>Your server</small>${me}</div>
    <div class="chk">${fresh ? `RSI status page · checked ${K.hhmm(statusAt)}` : statusAt ? `Offline · last checked ${K.hhmm(statusAt)}` : statusErr ? 'Could not reach the RSI status page' : 'Checking the RSI status page'}</div>`;
}

// ---------- commodities ----------
function where() {
  const g = K.game(), loc = K.location();
  const i = market ? W.placeFor(market, loc.id, loc.sys || g.system) : -1;
  return { i, loc, sys: i >= 0 ? market.places[i].system : W.SYSTEMS.includes(g.system) ? g.system : null };
}
const seg = (items, cur, attr) => `<span class="seg">${items.map(([v, l]) => `<button data-${attr}="${v}" class="${v === cur ? 'cur' : ''}">${l}</button>`).join('')}</span>`;

function paintMarket(head, body, foot, now) {
  const w = where();
  const sys = cm.mode === 'find' ? (cm.sys || w.sys || 'Stanton') : w.sys;
  const src = !market ? `<b>${marketErr ? 'No prices' : 'Prices from UEX'}</b>${marketErr ? 'Could not reach UEX' : 'Loading'}`
    : market.offline ? `<b>Offline · saved prices</b>Saved at ${K.hhmm(market.fetched)}, ${W.inMinutes(now - market.fetched)} ago`
      : `<b>Prices from UEX</b>Reported by players · fetched ${K.hhmm(market.fetched)}`;
  head.innerHTML = seg([['here', 'Here'], ['nearby', 'Nearby'], ['find', 'Find']], cm.mode, 'mode')
    + (cm.mode === 'find' ? seg(W.SYSTEMS.map(s => [s, s]), sys, 'sys') : seg([['buy', 'Buy here'], ['sell', 'Sell here']], cm.side, 'side'))
    + `<div class="upd">${src}</div>`;
  foot.innerHTML = '';
  if (!market) { body.innerHTML = `<div class="cm-off"><b>${marketErr ? 'No prices yet' : 'Loading prices'}</b><p>${marketErr ? 'UEX could not be reached. Prices show once it answers.' : 'From UEX, reported by players'}</p></div>`; return; }
  if (cm.mode === 'find') return paintFind(body, foot, sys, now);
  const unknown = w.i < 0;
  if (unknown && w.loc.id) {
    body.innerHTML = `<div class="cm-off"><b>No trade terminal at ${esc(placeName(w.loc.id))}</b><p>UEX lists no commodity prices for this place. Find shows any commodity.</p></div>`;
    return;
  }
  const sysHere = W.SYSTEMS.includes(K.game().system) ? K.game().system : 'Stanton';
  const at = unknown ? [] : cm.mode === 'nearby' ? W.nearby(market, w.i) : [w.i];
  const p = unknown ? { system: sysHere, name: '' } : market.places[w.i];
  const rows = unknown ? W.routes(market, sysHere) : W.tradeRows(market, at, cm.side, p.system);
  const pages = Math.max(1, Math.ceil(rows.length / W.ROWS));
  cm.page = Math.min(cm.page, pages - 1);
  const shown = rows.slice(cm.page * W.ROWS, (cm.page + 1) * W.ROWS);
  const place = j => esc(market.places[j].name);
  const cell = (x, withPlace, l) => {
    if (!x) return `<td class="none" data-l="${esc(l)}"><b>—</b><p>No report this week</p></td>`;
    const a = W.age(x.at, now), stock = W.stockText(x);
    return `<td class="${a.old ? 'old' : ''}" data-l="${esc(l)}"><b>${fmt(x.price)} <span class="age">· ${a.text}</span></b><p>${[withPlace && place(x.place), stock && `<span class="stk ${stock.low ? 'low' : ''}">${stock.text}</span>`].filter(Boolean).join(' · ')}</p></td>`;
  };
  const near = cm.mode === 'nearby' || unknown;
  const hereLabel = unknown ? `Cheapest in ${p.system}` : cm.side === 'buy' ? (near ? 'Cheapest nearby' : 'Buy here') : (near ? 'Best nearby' : 'Sell here');
  const otherLabel = unknown ? `Best sell in ${p.system}` : cm.side === 'buy' ? `Best sell in ${p.system}` : `Cheapest buy in ${p.system}`;
  const body0 = shown.map(r => `<tr data-c="${esc(r.name)}"><td class="n">${esc(r.name)}</td>${cell(r.here, near, hereLabel)}${cell(r.other, true, otherLabel)}<td class="r p ${r.profit < 0 ? 'neg' : ''}">${r.profit === null ? '—' : (r.profit > 0 ? '+' : '') + fmt(r.profit)}</td></tr>`).join('');
  const what = near ? `around ${esc(p.planet || p.name)}` : '';
  const since = w.loc.at ? (w.loc.moved ? ` · seen at ${K.hhmm(w.loc.at)}` : ` · from Game.log at ${K.hhmm(w.loc.at)}`) : '';
  const seated = K.game().seated;
  const strip = unknown ? `<div class="cm-at unknown"><svg class="i pin" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><b>Location unknown</b><span>${seated ? 'Step out of your seat, then Locate' : 'Locate opens your inventory for a moment so Game.log names the place'}</span>${invKey('Locate', 'small', seated)}</div>`
    : null;
  body.innerHTML = (strip ? strip + `<div class="cm-sub">Best trades in ${esc(p.system)} until then</div>` : `<div class="cm-at ${w.loc.moved ? 'moved' : ''}"><b>${near ? `${at.length} places ${what}` : esc(p.name)}</b><span>${near ? esc(p.system) : esc([p.moon, p.planet, p.system].filter(Boolean).join(' · '))}${since}</span>${w.loc.moved ? `<em>You travelled since</em>${invKey('Locate', 'small', K.game().seated)}` : ''}</div>`)
    + (rows.length ? `<table class="${unknown ? 'short' : ''}"><thead><tr><th class="c1">Commodity</th><th class="c2">${hereLabel}</th><th class="c3">${otherLabel}</th><th class="r">Profit / SCU</th></tr></thead><tbody>${body0}</tbody></table>`
      : `<div class="cm-off in"><b>Nothing to ${cm.side} here</b><p>No price reported this week. Try ${cm.side === 'buy' ? 'Sell here' : 'Buy here'}, Nearby or Find.</p></div>`);
  foot.innerHTML = `<div class="lab">aUEC per SCU, best report per place this week.<br>Older than 2 days in grey. Tap a row to see where else.</div>${pages > 1 ? pager(pages) : ''}`;
}
const pager = pages => `<div class="pager wpg"><button class="pg" data-pg="-1" aria-label="Previous">‹</button><span><b>${cm.page + 1}</b> / ${pages}</span><button class="pg" data-pg="1" aria-label="Next">›</button></div>`;

function paintFind(body, foot, sys, now) {
  if (cm.pick) {
    const t = W.whereTo(market, cm.pick, sys);
    const list = (xs, empty) => xs.length ? xs.map(x => {
      const p = market.places[x.place], a = W.age(x.at, now);
      return `<li class="${a.old ? 'old' : ''}"><b>${fmt(x.price)}</b><span>${esc(p.name)}<small>${esc([p.moon, p.planet].filter(Boolean).join(' · ') || p.system)} · ${a.text}</small></span></li>`;
    }).join('') : `<li class="empty">${empty}</li>`;
    body.innerHTML = `<div class="cm-at"><b>${esc(cm.pick)}</b><span>${esc(sys)} · ${esc(market.kinds?.[cm.pick] || '')}</span></div>
      <div class="wt"><div><small>Cheapest to buy</small><ol>${list(t.buy, 'Nobody sells it here this week')}</ol></div><div><small>Best price to sell</small><ol>${list(t.sell, 'Nobody buys it here this week')}</ol></div></div>`;
    foot.innerHTML = '<div class="lab">aUEC per SCU, best report per place this week.<br>Older than 2 days in grey.</div><button class="wbtn" data-chart="1">Show on chart</button><button class="wbtn" data-back="1">All commodities</button>';
    return;
  }
  const names = W.findList(market, sys, { chip: cm.chip, letter: cm.letter });
  const have = new Set(W.letters(market, sys, cm.chip));
  const per = 20, pages = Math.max(1, Math.ceil(names.length / per));
  cm.page = Math.min(cm.page, pages - 1);
  body.innerHTML = `<div class="chips">${[['', 'All'], ...W.KIND_CHIPS.map(([c]) => [c, c])].map(([v, l]) => `<button data-chip="${v}" class="${(cm.chip || '') === v ? 'cur' : ''}">${l}</button>`).join('')}</div>
    <div class="az">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `<button data-l="${esc(l)}" class="${cm.letter === l ? 'cur' : ''}" ${have.has(l) ? '' : 'disabled'}>${l}</button>`).join('')}</div>
    <div class="names">${names.slice(cm.page * per, (cm.page + 1) * per).map(n => `<button data-c="${esc(n)}">${esc(n)}</button>`).join('') || '<p class="empty">Nothing with a price in this system</p>'}</div>`;
  foot.innerHTML = `<div class="lab">${names.length} commodities with a price in ${esc(sys)} this week.<br>Pick a kind or a letter, then a commodity.</div>${pages > 1 ? pager(pages) : ''}`;
}

function marketTap(e) {
  const b = e.target.closest('button, tr[data-c]');
  if (!b || b.disabled) return;
  K.tick('tap');
  const d = b.dataset;
  if (d.mode) { cm = { ...cm, mode: d.mode, page: 0, pick: null }; }
  else if (d.side) { cm = { ...cm, side: d.side, page: 0 }; }
  else if (d.sys) { cm = { ...cm, sys: d.sys, page: 0, pick: null, letter: null }; }
  else if (d.pg) { cm.page = Math.max(0, cm.page + Number(d.pg)); }
  else if (d.chip !== undefined) { cm = { ...cm, chip: d.chip || null, letter: null, page: 0 }; }
  else if (d.l) { cm = { ...cm, letter: cm.letter === d.l ? null : d.l, page: 0 }; }
  else if (d.back) { cm.pick = null; }
  else if (d.chart) { K.showOnChart?.(cm.pick); return; }
  else if (d.inv) { locate(b); return; }
  else if (d.c) { if (cm.mode !== 'find') cm = { ...cm, mode: 'find', sys: where().sys }; cm.pick = d.c; }
  else return;
  paint();
}

// Locate: open the inventory, and close it again once Game.log has named the place. In a seat the
// same key toggles thrusters, so it only goes on foot; if no line comes, the second press never goes.
let locating = null;
async function locate(node) {
  const g = K.game();
  if (g.seated || g.menu || locating) return;
  const was = K.location().at;
  if (!(await K.fire(INVENTORY, node))) return;
  locating = { was, until: setTimeout(() => { locating = null; }, 4000) };
}
function located() {
  if (!locating || K.location().at === locating.was) return;
  clearTimeout(locating.until); locating = null;
  setTimeout(() => K.fire(INVENTORY), 400);
}

// ---------- dialog ----------
let onPick = null;
function openDialog(html, pick) {
  dlg.querySelector('.wd-card').innerHTML = html;
  onPick = pick; dlg.hidden = false;
}
function closeDialog() { if (dlg) dlg.hidden = true; onPick = null; }

// ---------- painting ----------
let bound = false;
export function paint() {
  if (!K || K.current() !== 'world' || !$('wd-xh')) return;
  if (!bound) {
    bound = true;
    for (const id of ['wd-cmhead', 'wd-cm', 'wd-cmfoot']) $(id).addEventListener('pointerup', marketTap);
    dlg.addEventListener('pointerup', e => {
      const b = e.target.closest('button');
      if (!b) return;
      K.tick('tap');
      if (b.dataset.x === 'close') closeDialog(); else onPick?.(b);
    });
  }
  const now = Date.now();
  paintHangar($('wd-xh'), now);
  paintTimers($('wd-tm'), now);
  paintServers($('wd-sv'));
  paintMarket($('wd-cmhead'), $('wd-cm'), $('wd-cmfoot'), now);
  K.painted?.([$('wd-xh'), $('wd-cm'), $('wd-cmhead'), $('wd-cmfoot')]);
}
/** After new Game.log lines: a new server ends the vault timer, a new place changes Here. */
export function onLog() { if (K) { located(); armTimers(); paint(); } }
