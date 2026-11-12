// PWA harness: checks that the app is actually installable and that its
// service worker can boot the sandbox with no network.
//
// Usage:  node tests/check-pwa.js
//
// Three groups of checks:
//   1. manifest.webmanifest  — fields, icon files, declared vs real icon sizes
//   2. index.html            — the tags a browser looks for, and the busters
//   3. sw.js + pwa.js        — precache completeness, weight, version lockstep
//
// The version lockstep is the important one: cache keys are query-stripped, so
// the ?v= busters in index.html/app.js and VERSION in sw.js must match or
// returning visitors get a half-updated app.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('OK  ', name);
  } else {
    fail++;
    console.log('FAIL', name, detail === undefined ? '' : '- ' + detail);
  }
}

function abs(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8');
}

function bytes(rel) {
  return fs.statSync(abs(rel)).size;
}

function pngSize(rel) {
  const buf = fs.readFileSync(abs(rel));
  if (buf.length < 24 || buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function humanBytes(n) {
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// 1. manifest
// ---------------------------------------------------------------------------

const MANIFEST_FILE = 'manifest.webmanifest';
check('manifest exists', exists(MANIFEST_FILE));

let manifest = null;
try {
  manifest = JSON.parse(read(MANIFEST_FILE));
  check('manifest is valid JSON', true);
} catch (error) {
  check('manifest is valid JSON', false, error.message);
  manifest = {};
}

check('manifest name', manifest.name === '2D Weather Sandbox', manifest.name);
check(
  'manifest short_name fits a launcher tile',
  typeof manifest.short_name === 'string' && manifest.short_name.length > 0 && manifest.short_name.length <= 15,
  manifest.short_name
);
check(
  'manifest description',
  typeof manifest.description === 'string' && manifest.description.length >= 40,
  manifest.description
);
check('manifest lang', manifest.lang === 'en', manifest.lang);
check(
  'manifest display is standalone',
  manifest.display === 'standalone' || manifest.display === 'fullscreen' || manifest.display === 'minimal-ui',
  manifest.display
);
check(
  'manifest display falls back cleanly',
  manifest.display_override === undefined || Array.isArray(manifest.display_override),
  JSON.stringify(manifest.display_override)
);

// start_url and scope must stay inside the app: this is served as plain files
// from whatever directory the repo is unpacked into, with no build step.
for (const field of ['start_url', 'scope']) {
  const value = manifest[field];
  const relative = typeof value === 'string' && value.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('/');
  check('manifest ' + field + ' is relative', relative, value);
  if (typeof value === 'string') {
    const resolved = new URL(value, 'https://example.test/sandbox/index.html');
    check(
      'manifest ' + field + ' stays in scope',
      resolved.pathname.startsWith('/sandbox'),
      resolved.pathname
    );
  }
}

const hex = /^#[0-9a-f]{6}$/i;
check('manifest theme_color', hex.test(manifest.theme_color || ''), manifest.theme_color);
check('manifest background_color', hex.test(manifest.background_color || ''), manifest.background_color);

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
check('manifest declares icons', icons.length >= 2, icons.length);

const purposes = (purpose) =>
  icons.filter((icon) => String(icon.purpose || 'any').split(/\s+/).includes(purpose));
const anyIcons = purposes('any');
const maskable = purposes('maskable');

check(
  'icons include a 192x192 "any"',
  anyIcons.some((icon) => icon.sizes === '192x192'),
  anyIcons.map((i) => i.sizes).join(',')
);
check(
  'icons include a 512x512 "any"',
  anyIcons.some((icon) => icon.sizes === '512x512'),
  anyIcons.map((i) => i.sizes).join(',')
);
check(
  'icons include a maskable 512x512',
  maskable.some((icon) => icon.sizes === '512x512'),
  maskable.map((i) => i.sizes).join(',')
);

for (const icon of icons) {
  const label = 'icon ' + icon.src;
  check(label + ' exists', typeof icon.src === 'string' && exists(icon.src), icon.src);
  check(label + ' type', icon.type === 'image/png', icon.type);

  if (typeof icon.src !== 'string' || !exists(icon.src)) continue;
  const size = pngSize(icon.src);
  check(label + ' is a PNG', size !== null, icon.src);
  if (!size) continue;
  check(
    label + ' real size matches ' + icon.sizes,
    icon.sizes === size.width + 'x' + size.height,
    size.width + 'x' + size.height
  );
}

// ---------------------------------------------------------------------------
// 2. index.html
// ---------------------------------------------------------------------------

const html = read('index.html');

check(
  'index.html declares a responsive viewport',
  /<meta[^>]+name="viewport"[^>]+content="[^"]*width=device-width/.test(html)
);
check('index.html links the manifest', /<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(html));
check(
  'index.html theme-color matches the manifest',
  new RegExp('<meta[^>]+name="theme-color"[^>]+content="' + manifest.theme_color + '"', 'i').test(html),
  manifest.theme_color
);
check(
  'index.html has an apple-touch-icon',
  /<link[^>]+rel="apple-touch-icon"[^>]+href="(resources\/icons\/app\/[^"]+\.png)"/.test(html)
);

const touchMatch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/);
if (touchMatch) {
  check('apple-touch-icon exists', exists(touchMatch[1]), touchMatch[1]);
  const size = pngSize(touchMatch[1]);
  check('apple-touch-icon is square', size !== null && size.width === size.height, JSON.stringify(size));
}

check('index.html loads pwa.js', /<script[^>]+src="pwa\.js"/.test(html));
check(
  'install button markup exists',
  /id="installAppButton"/.test(html) && /id="installAppWrap"[^>]*hidden/.test(html)
);
check(
  'install button starts hidden',
  /id="installAppWrap"[^>]*hidden/.test(html)
);

// ---------------------------------------------------------------------------
// 3. service worker
// ---------------------------------------------------------------------------

const sw = read('sw.js');
const pwa = read('pwa.js');

const versionMatch = sw.match(/const VERSION = '([^']+)'/);
const VERSION = versionMatch ? versionMatch[1] : null;
check('sw.js declares VERSION', /^\d{4}-\d{2}-\d{2}\.\d+$/.test(VERSION || ''), VERSION);

const BUSTER = /\?v=(\d{4}-\d{2}-\d{2}\.\d+)/g;
function busters(source) {
  return [...new Set([...source.matchAll(BUSTER)].map((m) => m[1]))];
}

const htmlBusters = busters(html);
const appBusters = busters(read('app.js'));
check('index.html has cache busters', htmlBusters.length > 0, htmlBusters.join(','));
check('app.js has cache busters', appBusters.length > 0, appBusters.join(','));
check(
  'index.html busters equal sw.js VERSION',
  htmlBusters.length === 1 && htmlBusters[0] === VERSION,
  htmlBusters.join(',') + ' vs ' + VERSION
);
check(
  'app.js busters equal sw.js VERSION',
  appBusters.length === 1 && appBusters[0] === VERSION,
  appBusters.join(',') + ' vs ' + VERSION
);

function arrayLiteral(name) {
  const marker = 'const ' + name + ' = [';
  const start = sw.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const end = sw.indexOf('];', start);
  const body = sw.slice(start + marker.length - 1, end + 1);
  return new Function('return ' + body)();
}

let PRECACHE = [];
let DEFERRED = [];
try {
  PRECACHE = arrayLiteral('PRECACHE');
  check('sw.js PRECACHE parses', PRECACHE.length > 10, PRECACHE.length + ' entries');
} catch (error) {
  check('sw.js PRECACHE parses', false, error.message);
}
try {
  DEFERRED = arrayLiteral('DEFERRED');
  check('sw.js DEFERRED parses', DEFERRED.length > 0, DEFERRED.length + ' entries');
} catch (error) {
  check('sw.js DEFERRED parses', false, error.message);
}

const precached = new Set(PRECACHE.map((entry) => entry.replace(/^\.\//, '')));
const deferred = new Set(DEFERRED.map((entry) => entry.replace(/^\.\//, '')));

for (const entry of PRECACHE.concat(DEFERRED)) {
  check('precache target exists: ' + entry, exists(entry.replace(/^\.\//, '')) || entry === './', entry);
}

// Everything the page requests must survive a cold, offline start.
const required = new Set();
for (const match of html.matchAll(/(?:src|href)="((?!#|https?:|mailto:|javascript:)[^"?]+)(?:\?[^"]*)?"/g)) {
  if (/\.(js|png|svg|ico|webmanifest|woff2)$/.test(match[1])) required.add(match[1]);
}
for (const match of read('app.js').matchAll(/'(resources\/(?:img|fonts|icons)\/[^'?]+)'/g)) {
  // asset prefixes are built at runtime (".../weather/" + name + ".svg")
  if (!match[1].endsWith('/')) required.add(match[1]);
}
for (const match of read('app.js').matchAll(/new Worker\('\.\/([^'?]+)/g)) {
  required.add(match[1]);
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

for (const file of walk('shaders', [])) required.add(file);
for (const file of walk('libraries', [])) required.add(file);
for (const file of walk('resources/fonts', [])) {
  if (file.endsWith('.woff2')) required.add(file);
}
for (const file of walk('resources/icons/weather', [])) {
  if (file.endsWith('.svg')) required.add(file);
}
for (const file of walk('resources/icons/app', [])) required.add(file);

// Deferred files are warmed right after activation, so they count as offline
// capable too — they just must not sit in front of the install.
const available = new Set([...precached, ...deferred]);
const missing = [...required].filter((file) => !available.has(file) && exists(file));
check(
  'every offline-critical asset is cached',
  missing.length === 0,
  missing.slice(0, 6).join(', ')
);
check('nothing precached outside the app roots', PRECACHE.every((entry) => !/^(\.\.|\/)/.test(entry)));

// The heavy stuff must stay out of the install path.
check(
  'no audio in the precache',
  PRECACHE.every((entry) => !/\.mp3$/i.test(entry)) && DEFERRED.every((entry) => !/\.mp3$/i.test(entry))
);
check('archive not cached', PRECACHE.every((entry) => !/\.zip$/i.test(entry)));
check(
  'large textures are deferred, not blocking',
  ['resources/img/surfaceTextureMap.png', 'resources/img/background.png', 'resources/img/noise_texture.jpg'].every(
    (file) => deferred.has(file)
  )
);

const precacheBytes = PRECACHE.filter((entry) => entry !== './' && exists(entry.replace(/^\.\//, ''))).reduce(
  (total, entry) => total + bytes(entry.replace(/^\.\//, '')),
  0
);
check(
  'install payload stays under 2.5 MB (' + humanBytes(precacheBytes) + ')',
  precacheBytes < 2.5 * 1024 * 1024,
  humanBytes(precacheBytes)
);

check('sw.js handles install', /addEventListener\('install'/.test(sw));
check('sw.js handles activate', /addEventListener\('activate'/.test(sw));
check('sw.js handles fetch', /addEventListener\('fetch'/.test(sw));
check('sw.js activates immediately', /skipWaiting\(\)/.test(sw));
check('sw.js claims open tabs', /clients\.claim\(\)/.test(sw));
check('sw.js purges stale shell caches', /SHELL_CACHE_PREFIX/.test(sw) && /caches\.delete/.test(sw));
check('sw.js only purges its own caches', /APP_CACHE_PREFIX/.test(sw) && /ours && !current/.test(sw));
check('sw.js refuses to install a broken shell', /keeping the previous worker/.test(sw));
check('sw.js strips query strings from cache keys', /\.search = ''/.test(sw));
check('sw.js serves navigations offline', /mode === 'navigate'/.test(sw) && /offlinePage/.test(sw));
check('sw.js ignores non-GET and range requests', /method !== 'GET'/.test(sw) && /has\('range'\)/.test(sw));
check('sw.js bounds the media cache', /MEDIA_CACHE_LIMIT/.test(sw) && /pruneMedia/.test(sw));
check('sw.js leaves the LAN API to the network', /API\.test\(url\.pathname\)/.test(sw));

check('pwa.js registers sw.js', /register\('sw\.js'|register\(SERVICE_WORKER/.test(pwa) && /sw\.js/.test(pwa));
check('pwa.js registers at the app scope', /scope: '\.\/'/.test(pwa));
check('pwa.js skips non-http origins (file://)', /https\?:/.test(pwa) && /protocol/.test(pwa));
check('pwa.js handles beforeinstallprompt', /beforeinstallprompt/.test(pwa));
check('pwa.js hides the button once installed', /appinstalled/.test(pwa));
check('pwa.js wires the same ids index.html ships', /installAppWrap/.test(pwa) && /installAppButton/.test(pwa));
check('index.html removes stray V1.0 version HUD', !/class="app-version"|>V1\.0</.test(html));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
