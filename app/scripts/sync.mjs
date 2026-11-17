// Copies the layout, ship data, keybind file and fonts into ui/vendor, so the
// app ships with exactly what is in layouts/ and binds/.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(app, '..');
const out = join(app, 'ui', 'vendor');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

const copy = (from, to) => cpSync(join(repo, from), join(out, to));
copy('layouts/star-citizen.json', 'star-citizen.json');
copy('layouts/ships.json', 'ships.json');
copy('layouts/ship-overrides.json', 'ship-overrides.json');
copy('binds/layout_xeneon_exported.xml', 'xeneon-binds.xml');
const fonts = { 'chakra-petch': [500, 600, 700], inter: [400, 500, 600], 'jetbrains-mono': [500] };
for (const [name, weights] of Object.entries(fonts))
  for (const w of weights)
    cpSync(join(app, 'node_modules/@fontsource', name, 'files', `${name}-latin-${w}-normal.woff2`), join(out, 'fonts', `${name}-${w}.woff2`));
console.log('ui/vendor synced');
