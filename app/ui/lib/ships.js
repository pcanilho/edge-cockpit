// Which role a ship has, from layouts/ships.json plus the player's own overrides.

export const KIT = ['missiles', 'qed', 'emp', 'tractor'];

/** Normalise one override value: 'mining' or { role, has, name }. */
function normalise(v) {
  return typeof v === 'string' ? { role: v } : v && typeof v === 'object' ? v : {};
}

/**
 * The ship for a Game.log model name. Exact class first, then the longest known
 * class it starts with (AEGS_Gladius_Valiant_Foo -> AEGS_Gladius_Valiant).
 */
export function lookup(db, overrides, model) {
  if (!model) return null;
  const find = table => {
    if (table[model]) return [model, table[model]];
    let best = null;
    for (const cls of Object.keys(table)) if (model.startsWith(cls + '_') && (!best || cls.length > best.length)) best = cls;
    return best ? [best, table[best]] : null;
  };
  const base = find(db);
  const over = find(overrides || {});
  if (!base && !over) return null;
  const ship = { name: model, role: null, has: [], ...(base ? base[1] : {}) };
  if (over) Object.assign(ship, Object.fromEntries(Object.entries(normalise(over[1])).filter(([k]) => ['name', 'role', 'has'].includes(k))));
  return ship;
}
