// Copies the layout, ship data, keybind file and fonts into ui/vendor, so the
// app ships with exactly what is in layouts/ and binds/.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(app, '..');
const out = join(app, 'ui', 'vendor');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

const copy = (from, to) => cpSync(join(repo, from), join(out, to));
// JSON goes in without whitespace: the layout is the biggest file the console loads.
const json = (from, to) => writeFileSync(join(out, to), JSON.stringify(JSON.parse(readFileSync(join(repo, from), 'utf8'))));
json('layouts/star-citizen.json', 'star-citizen.json');
json('layouts/ships.json', 'ships.json');
json('layouts/ship-overrides.json', 'ship-overrides.json');
copy('binds/layout_edge_cockpit_exported.xml', 'binds.xml');
const fonts = { 'chakra-petch': [500, 600, 700], inter: [400, 500, 600], 'jetbrains-mono': [500] };
for (const [name, weights] of Object.entries(fonts))
  for (const w of weights)
    cpSync(join(app, 'node_modules/@fontsource', name, 'files', `${name}-latin-${w}-normal.woff2`), join(out, 'fonts', `${name}-${w}.woff2`));
// three.js (MIT) for the 3D ship: the module build, the glTF and Draco loaders with their imports
// pointed at the copies here, and the Draco decoder the loader runs in a worker.
mkdirSync(join(out, 'three', 'draco'), { recursive: true });
const three = join(app, 'node_modules/three');
cpSync(join(three, 'build/three.module.min.js'), join(out, 'three', 'three.module.js'));
for (const f of ['loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'utils/BufferGeometryUtils.js'])
  writeFileSync(join(out, 'three', f.split('/')[1]), readFileSync(join(three, 'examples/jsm', f), 'utf8')
    .replace(/from 'three'/g, "from './three.module.js'").replace("'../utils/BufferGeometryUtils.js'", "'./BufferGeometryUtils.js'"));
for (const f of ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'])
  cpSync(join(three, 'examples/jsm/libs/draco/gltf', f), join(out, 'three', 'draco', f));
cpSync(join(three, 'LICENSE'), join(out, 'three', 'LICENSE'));
console.log('ui/vendor synced');
