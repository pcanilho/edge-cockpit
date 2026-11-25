// The system chart page, behind the Map softkey: the 3D view and the Location card.
// Nothing runs while the page is closed: three.js and the view load on the first visit, the
// view draws only on a change, and closing the page gives its graphics memory back.
import * as C from './lib/chart.js';
import { esc } from './controls.js';
import * as W from './lib/world.js';

let K; // app: game(), fix(), bridge, current()
let data = null, err = null, loading = null, view = null, making = null, pick = null, open = false, clock = null, failed = null;
// World's prices (the Rust side keeps them 30 minutes), asked for only once a body is tapped or a
// commodity shown; goods is the commodity World sent to the chart.
let market = null, marketAsked = false, goods = null;
const fmt = n => Math.round(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);

export function init(ctx) { K = ctx; }

function load() {
  if (data || loading) return;
  loading = K.bridge.worldChart().then(d => { data = d; err = null; }, e => { err = String(e?.message || e); })
    .finally(() => { loading = null; paint(); });
}

function loadMarket() {
  if (market || marketAsked) return;
  marketAsked = true;
  K.bridge.worldPrices().then(m => { market = m; paint(); }, () => { marketAsked = false; });
}
/** World's Show on chart: where a commodity sells best, lit on the chart. */
export function show(name) { goods = name ? { name } : null; pick = null; if (name) loadMarket(); paint(); }

/** The page opened or closed. Closed: the view and the minute clock go. */
export function showing(on) {
  open = on;
  clearInterval(clock); clock = null;
  if (!on) { view?.dispose(); view = null; return; }
  failed = null;
  load();
  // "14 minutes ago" moves on once a minute: the card only, not the chart.
  clock = setInterval(card, 60_000);
  paint();
}

let lays = new Map();
const layFor = sys => { if (!lays.has(sys.name)) lays.set(sys.name, { ...C.layout(sys), system: sys.name }); return lays.get(sys.name); };

/** Brings the chart and the card up to date; cheap when nothing changed. */
export function paint() {
  if (!open || !K || K.current() !== 'chart') return;
  const host = $('sc-host');
  if (!host) return;
  if (view && view.host !== host) { view.dispose(); view = null; }
  const w = where();
  const msg = !data ? (err ? 'UEX didn\'t send the places. The chart shows once it does.' : 'Loading places from UEX…')
    : !w.system ? 'The chart shows the system you are in once the game says which.'
      : !w.sys ? `UEX lists no places in ${w.system}.` : failed ? 'This screen\'s graphics can\'t draw 3D.' : '';
  $('sc-msg').textContent = msg;
  host.toggleAttribute('data-empty', !!msg);
  card(w);
  if (msg || !w.sys) return;
  const next = { lay: layFor(w.sys), you: w.body, route: routeOf(w), pick: pick && w.sys.bodies.some(b => b.name === pick) ? pick : null, goods: goodsMarks(w) };
  if (view) { view.set(next); return; }
  if (making) return;
  making = import('./chartview.js').then(m => m.view(host, { onPick: name => { pick = name; if (name) loadMarket(); paint(); } }))
    .then(v => { making = null; if (!open || $('sc-host') !== host) { v.dispose(); return; } view = v; view.set(next); },
      e => { making = null; failed = e; console.warn('chart', e.cause || e); paint(); });
}

const where = () => C.where(data, K.game(), K.fix());
/** The route as two bodies on the chart, when both ends are ones it shows. */
function routeOf(w) {
  if (!w.route || !w.sys) return null;
  const a = C.resolve(w.sys, w.route.from)?.body, b = C.resolve(w.sys, w.route.to)?.body;
  return a && b ? [a, b] : null;
}

/** Market places at a body of this system, by their index in World's prices. */
const marketAt = (w, body) => market ? market.places.map((p, i) => [p, i]).filter(([p]) => C.bodyOf(w.sys, p) === body).map(([, i]) => i) : [];
/** Where the shown commodity sells best: up to three bodies, each with its best price. */
function goodsBest(w) {
  if (!goods || !market || !w.sys) return [];
  const best = new Map();
  for (const x of W.whereTo(market, goods.name, w.sys.name, 12).sell) {
    const body = C.bodyOf(w.sys, market.places[x.place]);
    if (body && !best.has(body)) best.set(body, { ...x, body });
  }
  return [...best.values()].slice(0, 3);
}
const goodsMarks = w => goodsBest(w).map(x => ({ body: x.body, text: fmt(x.price) }));

const HOW = { arrived: 'Quantum arrival', inventory: 'Inventory opened', hangar: 'Hangar lift' };
const nav = n => String(n || '').replace(/^MISSION_(QT_)?/, '').replace(/_\d{6,}$/, '').replace(/^OM-?\d+_/i, '').replace(/_/g, ' ');
function card(w = where()) {
  const el = $('sc-card');
  if (!el) return;
  const row = (k, v) => `<div class="sc-row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`;
  const src = w.system ? `${esc(w.system)} · from Game.log` : 'From Game.log';
  let html;
  if (pick && w.sys?.bodies.some(b => b.name === pick)) {
    const b = w.sys.bodies.find(x => x.name === pick);
    const label = b.kind === 'lagrange' ? `${C.spell(b.parent)} Lagrange point ${b.point}` : C.spell(b.name);
    const places = C.placesAt(w.sys, pick).map(p => p.name);
    // The best trades from here: buy at a place on this body, sell elsewhere in the system.
    const at = marketAt(w, pick);
    const trades = at.length ? W.tradeRows(market, at, 'buy', w.sys.name).filter(r => r.profit > 0).slice(0, 2) : [];
    const tradeRows = trades.map(r => row(r.name, `Buy ${fmt(r.here.price)} at ${market.places[r.here.place].name}, sell ${fmt(r.other.price)} at ${market.places[r.other.place].name}`)).join('');
    const none = !market ? (marketAsked ? row('Trades', 'Loading prices from UEX…') : '') : at.length ? (trades.length ? '' : row('Trades', 'No profitable trade from here this week')) : '';
    html = `<small>You tapped</small><div class="sc-big">${esc(label)}</div>${row(C.kindText(w.sys, pick), places.length ? places.join(', ') : 'No stations or cities on UEX')}
      ${tradeRows}${none}<div class="sc-why">Set a route there on the game's Starmap.</div>`;
  } else if (goods && w.sys) {
    const best = goodsBest(w);
    const buy = market ? W.whereTo(market, goods.name, w.sys.name, 1).buy[0] : null;
    const age = x => W.age(x.at, Date.now()).text;
    html = `<small>${esc(w.sys.name)} · prices from UEX</small><button class="sc-x" data-clear="1">Clear</button><div class="sc-big">${esc(goods.name)}</div>
      ${!market ? row('Prices', 'Loading from UEX…') : best.length ? best.map(x => row(`Sells for ${fmt(x.price)}`, `${market.places[x.place].name} · ${age(x)}`)).join('') : row('Sells', 'Nobody buys it here this week')}
      ${buy ? row(`Cheapest at ${fmt(buy.price)}`, `${market.places[buy.place].name} · ${age(buy)}`) : ''}`;
  } else if (w.body) {
    const at = w.place || C.spell(w.body);
    const since = w.at ? C.ago(Date.now() - w.at) : null;
    html = `<small>${src}</small><div class="sc-big">${w.place ? 'At' : 'Near'} <em>${esc(at)}</em></div>
      ${w.place ? row('On', C.spell(w.body)) : ''}
      ${row(HOW[w.how] || 'Last seen', since || 'this session')}
      ${w.route ? row(w.route.active ? 'Quantum to' : 'Last route', w.route.active ? nav(w.route.to) : `${nav(w.route.from) || 'Unknown'} to ${nav(w.route.to)}`) : ''}`;
  } else if (w.system) {
    html = `<small>${src}</small><div class="sc-big">Place not known yet</div>
      ${w.route?.active ? row('Quantum to', nav(w.route.to)) : ''}
      <div class="sc-why">No marker until the game names a place: a quantum arrival, a hangar lift or opening your inventory. The chart never guesses.</div>`;
  } else {
    html = K.game().menu ? `<small>From Game.log</small><div class="sc-big">Not in the game</div><div class="sc-why">The chart follows you once you are in the universe.</div>`
      : `<small>From Game.log</small><div class="sc-big">System not known yet</div><div class="sc-why">Game.log names the system when you join a server or jump. The chart never guesses.</div>`;
  }
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = `<div class="sc-in">${html}</div>`; }
  if (!el.dataset.bound) { el.dataset.bound = 1; el.addEventListener('pointerup', e => { if (e.target.closest('[data-clear]')) { goods = null; paint(); } }); }
}

/** Something new in Game.log: a tap's pick stays, the marker follows. */
export function onLog() { if (open) paint(); }
/** For tests: what the chart shows now. */
export const state = () => ({ open, view: !!view, pick, goods: goods?.name || null, data: !!data, where: data ? (({ sys, ...w }) => ({ ...w, system: sys?.name ?? w.system }))(where()) : null });
