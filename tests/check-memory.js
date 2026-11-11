// Graphics-memory audit.
//
// The app crashed twice on a machine with a small GPU budget, and both times the
// answer was "look at what is actually resident", not "the artwork is too big".
// This file does that: it reads the allocation sites out of app.js, adds them up
// at the default simulation resolution and a reference window, and prints the
// table. Then it holds the ceilings that came out of it.
//
// Nothing here draws anything. It is arithmetic over the source, so it stays
// honest when someone changes a format from RGBA32F to RGBA16F or doubles a
// texture count.
//
// Usage: node tests/check-memory.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? '\n     ' + detail : '')); }
}

const MB = 1024 * 1024;

/* The simulation's textures, in bytes per cell. Every one of these is allocated at
 * sim_res_x by sim_res_y, so the cost scales exactly with the resolution - which is
 * why the resolution is the lever the app offers. */
const SIM_ALLOCATIONS = [
  ['base texture pair (velocity, pressure, temperature)', 'RGBA32F', 2],
  ['water texture pair (vapour, cloud, precipitation, smoke)', 'RGBA32F', 2],
  ['light texture pair (sunlight, IR up and down)', 'RGBA32F', 2],
  ['precipitation feedback buffer', 'RGBA32F', 1],
  ['wall texture pair (type, distance, height, vegetation)', 'RGBA8I', 2],
  ['curl texture', 'R32F', 1],
  ['vorticity force texture', 'RG32F', 1],
  ['precipitation deposition texture', 'RG32F', 1],
  ['rain deposition accumulation texture', 'R32F', 1],
  ['emitted light map', 'RGBA16F', 1]
];

const BYTES_PER_FORMAT = { RGBA32F : 16, RGBA16F : 8, RGBA8I : 4, RG32F : 8, R32F : 4 };
const AMBIENT_CHAIN_FACTOR = 4 / 3;   // a mip chain is a third on top of its base level

function simBytesPerCell() {
  let bytes = 0;
  for (const [, format, count] of SIM_ALLOCATIONS)
    bytes += BYTES_PER_FORMAT[format] * count;
  // the ambient light chain: RGBA16F at the sim resolution, with its chain
  bytes += BYTES_PER_FORMAT.RGBA16F * AMBIENT_CHAIN_FACTOR;
  return bytes;
}

function simMemoryMB(x, y) { return (x * y * simBytesPerCell()) / MB; }

/* The reference window: a 1600 x 900 window, which is what the display targets at
 * hdrRenderScale 0.75 and bloomRenderScale 0.5 (both defaults). */
const WINDOW_W = 1600;
const WINDOW_H = 900;
const HDR_SCALE = 0.75;
const BLOOM_SCALE = 0.5;

function displayMemoryMB() {
  const hdr = WINDOW_W * HDR_SCALE * WINDOW_H * HDR_SCALE * 8;          // RGBA16F
  const bloomBase = WINDOW_W * BLOOM_SCALE * WINDOW_H * BLOOM_SCALE * 8; // RGBA16F, first level
  const bloom = bloomBase * AMBIENT_CHAIN_FACTOR;
  return (hdr + bloom) / MB;
}

const SURFACE_MAP = (2048 * 1280 * 4) / MB;                 // half of the 4096 x 2560 file
const NETWORK_TILE = (1024 * 256) / MB;

console.log('Graphics memory at the default resolution\n');
const DEFAULTS = { x : 2000, y : 300 };
const boltBudget = /const numLightningTextures = readLightningTileBudget\(\);/.test(app) ? 2 : 4;
const boltTiles = boltBudget * (2500 * 5000) / MB;          // R8, no mip chain

const rows = [
  ['simulation textures, ' + DEFAULTS.x + ' x ' + DEFAULTS.y + ' cells', simMemoryMB(DEFAULTS.x, DEFAULTS.y)],
  ['bolt artwork, ' + boltBudget + ' x 2500 x 5000 R8', boltTiles],
  ['intra-cloud network, 1024 x 256 R8', NETWORK_TILE],
  ['surface texture map, uploaded at 2048 x 1280', SURFACE_MAP],
  ['HDR + bloom at a ' + WINDOW_W + ' x ' + WINDOW_H + ' window', displayMemoryMB()]
];
let total = 0;
for (const [name, mb] of rows) {
  total += mb;
  console.log('  ' + name.padEnd(56) + mb.toFixed(1).padStart(7) + ' MB');
}
console.log('  ' + 'total'.padEnd(56) + total.toFixed(1).padStart(7) + ' MB\n');
console.log('  The same simulation at other resolutions:');
for (const [x, y] of [[3000, 300], [2500, 300], [2000, 300], [1500, 300], [1000, 200]]) {
  console.log('    ' + (x + ' x ' + y).padEnd(14) + simMemoryMB(x, y).toFixed(1).padStart(7) + ' MB of simulation textures');
}
console.log('');

check('the simulation costs 163 bytes a cell',
  Math.round(simBytesPerCell()) === 163,
  'got ' + simBytesPerCell().toFixed(2) + '; a format or a texture count changed, so the number in the setup screen is wrong');

check('app.js shows the memory cost next to the resolution sliders',
  /function simulationGraphicsMemoryMB\(cellCount\)/.test(app) &&
  /const BYTES_PER_CELL = 163;/.test(app) &&
  /data-performance-estimate-memory/.test(html),
  'the resolution slider is a memory slider whether or not anybody says so');

const sliderDefault = Number((html.match(/id="simResSelX"/) && html.match(/min="100" max="16000" value="(\d+)"/) || [])[1]);

check('the shipped default is the 2000 x 300 this file costs out',
  sliderDefault === DEFAULTS.x,
  'index.html starts the slider at ' + sliderDefault + ', this file counts ' + DEFAULTS.x +
  '; the table above is then not the default configuration');

check('the default resolution fits in 100 MB of simulation textures',
  simMemoryMB(DEFAULTS.x, DEFAULTS.y) <= 100,
  simMemoryMB(DEFAULTS.x, DEFAULTS.y).toFixed(1) + ' MB at ' + DEFAULTS.x + ' x ' + DEFAULTS.y);

check('the whole app at the default resolution fits in 160 MB',
  total <= 160,
  total.toFixed(1) + ' MB');

check('the 3000 x 300 request that used to be the default is no longer one',
  simMemoryMB(3000, 300) > 100 && sliderDefault < 3000,
  'this is the resolution the load used to ask for, and it is what took the context down');

check('the surface texture map is not uploaded at its authored 4096 x 2560',
  /const targetWidth = 2048;/.test(app) &&
  /context\.drawImage\(image, 0, 0, width, height\);/.test(app),
  '42 MB of texture for a map sampled at one texel per two simulation cells');

check('the decoded images are dropped once they are uploaded',
  /^  let \[$/m.test(app) &&
  /noiseImage = airplaneImage = airplaneReversedImage = airplaneGearImage = surfaceTextureImage = colorScalesImage = null;/.test(app),
  'the surface map decode alone is 42 MB of the page, held for the session, for a texture that is already on the GPU');

check('a lost context halves the default simulation resolution next time',
  /localStorage\.setItem\('lowGraphicsMemory', '1'\);/.test(app) &&
  /localStorage\.getItem\('lowGraphicsMemory'\) === '1'/.test(app) &&
  /simResSelX\.value = String\(Math\.max\(100, Math\.round\(horizontal \/ 2 \/ 100\) \* 100\)\);/.test(app) &&
  /id="lowGraphicsMemoryNote"/.test(html),
  'the resolution is the only lever that is large enough to matter, and it has to be a visible one');

check('the vertical resolution stays at the tuned 300',
  !/simResSelY\.value\s*=/.test(app),
  'the physics is tuned for 300 rows; the horizontal resolution is what gets halved');

/* The read side of the low-memory flag, run for real against stubs: the note the
 * setup screen shows, the halving, and the vertical resolution it must not touch. */
const bootstrap = app.slice(app.indexOf('function simulationGraphicsMemoryMB'),
                            app.indexOf('function showNewSimulationSetup'));

function runBootstrap(stored)
{
  const calls = [];
  const note = { style : { display : '' } };
  const sandbox = {
    document : {
      readyState : 'complete',
      getElementById : (id) => (id === 'lowGraphicsMemoryNote' ? note : null)
    },
    localStorage : { getItem : (key) => (key === 'lowGraphicsMemory' && stored ? '1' : null) },
    simResSelX : { value : '2000' },
    simResSelY : { value : '300' },
    updateSetupSliders : () => calls.push('updateSetupSliders'),
    console : console,
    Math : Math, Number : Number, String : String, parseInt : parseInt
  };
  vm.createContext(sandbox);
  vm.runInContext(bootstrap, sandbox);
  return { x : sandbox.simResSelX.value, y : sandbox.simResSelY.value, note : note.style.display, calls : calls.length };
}

const flagged = runBootstrap(true);
const unflagged = runBootstrap(false);

check('without the flag the setup screen starts at the shipped 2000 x 300 and says nothing',
  unflagged.x === '2000' && unflagged.y === '300' && unflagged.note === '' && unflagged.calls === 0,
  JSON.stringify(unflagged));

check('with the flag the default horizontal resolution halves and the note appears',
  flagged.x === '1000' && flagged.y === '300' && flagged.note === 'block' && flagged.calls === 1,
  JSON.stringify(flagged) + ' - the vertical resolution must stay at the tuned 300');

check('the halved default costs half the graphics memory',
  Math.abs(simMemoryMB(1000, 300) - simMemoryMB(2000, 300) / 2) < 0.01,
  simMemoryMB(1000, 300).toFixed(1) + ' MB against ' + simMemoryMB(2000, 300).toFixed(1) + ' MB');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
