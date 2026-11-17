// Which deck page fits what you are doing.
import { lookup } from './ships.js';

const mainDeck = layout => layout.decks.find(d => d.id === 'main');
export const pageById = (layout, id) => mainDeck(layout).pages.find(p => p.id === id);

/**
 * The page for this moment: home at the menu, Downed when you go down, On foot
 * when standing, else the ship's role page with the kit it lacks hidden, else
 * Flight for a ship we don't know.
 */
export function pageFor(layout, state, db = {}, overrides = {}) {
  const pages = { seated: 'flight', onFoot: 'onfoot', ...layout.defaultPages };
  if (state.menu && pages.menu) return { id: pages.menu, ship: null };
  if (state.down && pages.downed) return { id: pages.downed, ship: null };
  if (!state.seated) return { id: pages.onFoot, ship: null };
  const ship = lookup(db, overrides, state.ship);
  if (!ship?.role) return { id: pages.seated, ship };
  const has = new Set(ship.has || []);
  // The role page hiding the most kit this ship lacks (a page may only hide what the ship lacks).
  const fits = mainDeck(layout).pages
    .filter(p => p.role?.id === ship.role && p.role.lacks.every(k => !has.has(k)))
    .sort((a, b) => b.role.lacks.length - a.role.lacks.length);
  return { id: fits[0]?.id || pages.seated, ship };
}
