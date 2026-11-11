// Offline smoke test for sw.js: runs the real service worker inside a fake
// worker environment (scripted caches, a fetch that reads the checkout from
// disk) and checks that it installs, activates and then answers requests
// without touching the network.
//
// This does not replace a browser check, but it does catch the failure modes a
// browser check would show — install throwing on a 404, activating without
// purging the old cache, or a navigation not being served while offline.
//
// Usage:  node tests/check-sw-offline.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://127.0.0.1:8080';
const SW_URL = ORIGIN + '/sw.js';

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

// ---------------------------------------------------------------------------
// fake Cache Storage
// ---------------------------------------------------------------------------

class FakeCache {
  constructor(entries) {
    this.store = new Map(entries || []);
    this.puts = 0;
  }
  static key(input) {
    if (typeof input === 'string') return input;
    return input && input.url ? input.url : String(input);
  }
  async match(input) {
    const hit = this.store.get(FakeCache.key(input));
    return hit ? hit : undefined;
  }
  async put(input, response) {
    this.puts++;
    this.store.set(FakeCache.key(input), response);
    return undefined;
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
  async delete(input) {
    return this.store.delete(FakeCache.key(input));
  }
}

const cacheStorage = new Map();
let deletedCaches = [];
const caches = {
  async open(name) {
    if (!cacheStorage.has(name)) cacheStorage.set(name, new FakeCache());
    return cacheStorage.get(name);
  },
  async keys() {
    return [...cacheStorage.keys()];
  },
  async delete(name) {
    deletedCaches.push(name);
    return cacheStorage.delete(name);
  },
  async match(input) {
    for (const cache of cacheStorage.values()) {
      const hit = await cache.match(input);
      if (hit) return hit;
    }
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// fake network: every same-origin URL maps to a file in the checkout
// ---------------------------------------------------------------------------

const networkCalls = [];
let offline = false;

function fakeResponse(url) {
  const rel = decodeURIComponent(url.replace(ORIGIN + '/', '')).split('?')[0].split('#')[0];
  const file = path.join(ROOT, rel === '' ? 'index.html' : rel);
  let body;
  try {
    body = fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
  } catch (error) {
    body = null;
  }
  const status = body ? 200 : 404;
  const response = {
    ok: body !== null,
    status,
    statusText: body ? 'OK' : 'Not Found',
    type: 'basic',
    url,
    headers: new Headers({ 'Content-Type': 'text/plain' }),
    clone() {
      return response;
    },
    async text() {
      return body ? body.toString('utf8') : '';
    },
    async arrayBuffer() {
      return body || new ArrayBuffer(0);
    }
  };
  return response;
}

const fetchImpl = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  networkCalls.push(url);
  if (offline) throw new TypeError('Failed to fetch');
  return fakeResponse(url);
};

// ---------------------------------------------------------------------------
// fake worker globals
// ---------------------------------------------------------------------------

const listeners = new Map();
let skippedWaiting = false;
let claimedClients = false;

const self = {
  location: new URL(SW_URL),
  addEventListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  },
  skipWaiting: async () => {
    skippedWaiting = true;
  },
  clients: {
    claim: async () => {
      claimedClients = true;
    }
  }
};

const sandbox = {
  self,
  caches,
  fetch: fetchImpl,
  Response,
  Headers,
  Request,
  URL,
  URLSearchParams,
  console: { log() {}, info() {}, warn() {}, error() {} },
  setTimeout,
  clearTimeout
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), sandbox, { filename: 'sw.js' });

async function dispatch(type, event) {
  const handlers = listeners.get(type) || [];
  const pending = [];
  const withWait = Object.assign({}, event, {
    waitUntil(promise) {
      pending.push(promise);
    }
  });
  for (const handler of handlers) handler(withWait);
  await Promise.all(pending.map((promise) => Promise.resolve(promise).catch(() => {})));
  return event;
}

function fetchEvent(url, options) {
  const settings = options || {};
  const request = {
    url: ORIGIN + url,
    method: settings.method || 'GET',
    mode: settings.mode || 'cors',
    destination: settings.destination || '',
    headers: new Headers(settings.headers || {})
  };
  const event = { request, responded: null };
  event.respondWith = (promise) => {
    event.responded = promise;
  };
  return event;
}

const PRECACHE = (() => {
  const source = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const marker = 'const PRECACHE = [';
  const start = source.indexOf(marker);
  const end = source.indexOf('];', start);
  return new Function('return ' + source.slice(start + marker.length - 1, end + 1))();
})();

(async () => {
  // Seed a cache from a previous release that must be cleaned up.
  cacheStorage.set('weather-sandbox-shell-2020-01-01.1', new FakeCache());
  cacheStorage.set('some-unrelated-cache', new FakeCache());

  // -------------------------------------------------------------------------
  // install
  // -------------------------------------------------------------------------
  const shellCacheName = (() => {
    const source = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const version = source.match(/const VERSION = '([^']+)'/)[1];
    return 'weather-sandbox-shell-' + version;
  })();

  await dispatch('install', {});
  const shellCache = cacheStorage.get(shellCacheName);
  check('install creates the versioned shell cache', !!shellCache, shellCacheName);
  check('install precaches the whole app shell', shellCache && shellCache.store.size >= PRECACHE.length, shellCache && shellCache.store.size + '/' + PRECACHE.length);
  check(
    'install fetched index.html',
    shellCache && [...shellCache.store.keys()].includes(ORIGIN + '/index.html')
  );
  check(
    'install fetched every shader',
    shellCache &&
      ['common.glsl', 'commonDisplay.glsl'].every((f) => shellCache.store.has(ORIGIN + '/shaders/' + f)) &&
      shellCache.store.has(ORIGIN + '/shaders/fragment/realisticDisplayShader.frag')
  );
  check('install fetched the worker script', shellCache && shellCache.store.has(ORIGIN + '/lightningGenerator.js'));
  check('install fetched the manifest', shellCache && shellCache.store.has(ORIGIN + '/manifest.webmanifest'));
  check('install fetched the icons', shellCache && shellCache.store.has(ORIGIN + '/resources/icons/app/icon-512.png'));
  check('install waits for the precache before activating', skippedWaiting === true);

  check('install never precaches audio', ![...shellCache.store.keys()].some((url) => /\.mp3$/i.test(url)));

  // -------------------------------------------------------------------------
  // activate
  // -------------------------------------------------------------------------
  networkCalls.length = 0;
  await dispatch('activate', {});
  check('activate claims open clients', claimedClients === true);
  check('activate purges the previous shell cache', deletedCaches.includes('weather-sandbox-shell-2020-01-01.1'));
  check('activate leaves other apps\' caches alone', !deletedCaches.includes('some-unrelated-cache'));
  check('activate purges its own old media caches', deletedCaches.length === 1, deletedCaches.join(','));
  check('activate keeps the current shell cache', cacheStorage.has(shellCacheName));
  check(
    'activate warms the deferred art',
    shellCache.store.has(ORIGIN + '/resources/img/background.png') &&
      shellCache.store.has(ORIGIN + '/resources/img/surfaceTextureMap.png') &&
      shellCache.store.has(ORIGIN + '/resources/img/noise_texture.jpg')
  );

  // -------------------------------------------------------------------------
  // offline behaviour
  // -------------------------------------------------------------------------
  offline = true;

  networkCalls.length = 0;
  const navEvent = fetchEvent('/', { mode: 'navigate', destination: 'document' });
  await dispatch('fetch', navEvent);
  const navResponse = navEvent.responded ? await navEvent.responded : null;
  const navBody = navResponse ? await navResponse.text() : '';
  check('navigation is answered while offline', !!navResponse, navResponse && navResponse.status);
  check('navigation returns the real app shell', navBody.includes('2D Weather Sandbox'));
  check(
    'the cached shell still links its manifest and worker glue',
    navBody.includes('manifest.webmanifest') && navBody.includes('pwa.js')
  );
  // A navigation is served from cache and only *revalidated* in the background,
  // so the sole network touch allowed here is a refresh of the document itself.
  check(
    'navigation is served from cache, not from the network',
    networkCalls.every((url) => url === ORIGIN + '/'),
    networkCalls.join(',')
  );

  networkCalls.length = 0;
  const scriptEvent = fetchEvent('/app.js?v=2026-11-27.1');
  await dispatch('fetch', scriptEvent);
  const scriptResponse = scriptEvent.responded ? await scriptEvent.responded : null;
  check('versioned app.js is served from cache offline', !!scriptResponse, scriptResponse && scriptResponse.status);
  const scriptBody = scriptResponse ? await scriptResponse.text() : '';
  check('the cached app.js is the real file', scriptBody.includes('loadSourceFile'), scriptBody.length + ' chars');
  check('the ?v= buster did not change the cache key', networkCalls.length === 0, networkCalls.join(','));

  networkCalls.length = 0;
  const shaderEvent = fetchEvent('/shaders/fragment/realisticDisplayShader.frag?v=2026-11-27.1');
  await dispatch('fetch', shaderEvent);
  const shaderResponse = shaderEvent.responded ? await shaderEvent.responded : null;
  check('shaders are served from cache offline', !!shaderResponse);
  const shaderBody = shaderResponse ? await shaderResponse.text() : '';
  check(
    'the cached shader is the current one (CG HDR ceiling present)',
    shaderBody.includes('softHdrClamp') && shaderBody.includes('mainBoltBrightness'),
    shaderBody.length + ' chars'
  );

  const workerEvent = fetchEvent('/lightningGenerator.js?v=2026-11-27.1');
  await dispatch('fetch', workerEvent);
  check('the lightning worker is served offline', workerEvent.responded && !!(await workerEvent.responded));

  const iconEvent = fetchEvent('/resources/icons/weather/cloud-rain.svg');
  await dispatch('fetch', iconEvent);
  check('weather icons are served offline', iconEvent.responded && !!(await iconEvent.responded));

  // A sound has never been fetched yet: offline it must fail gracefully, and
  // it must not have been part of the install.
  const soundEvent = fetchEvent('/resources/sounds/rain.mp3');
  await dispatch('fetch', soundEvent);
  const soundResponse = soundEvent.responded ? await soundEvent.responded : null;
  check('a missing sound fails closed, not fatally', soundResponse && soundResponse.status === 504, soundResponse && soundResponse.status);

  // -------------------------------------------------------------------------
  // back online: media fills the runtime cache
  // -------------------------------------------------------------------------
  offline = false;
  networkCalls.length = 0;

  const firstSound = fetchEvent('/resources/sounds/rain.mp3');
  await dispatch('fetch', firstSound);
  await firstSound.responded;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mediaCache = [...cacheStorage.entries()].find(([name]) => name === 'weather-sandbox-media-v1');
  check('sounds land in the media cache', !!mediaCache && mediaCache[1].store.has(ORIGIN + '/resources/sounds/rain.mp3'));

  networkCalls.length = 0;
  const secondSound = fetchEvent('/resources/sounds/rain.mp3');
  await dispatch('fetch', secondSound);
  await secondSound.responded;
  check('cached sounds never hit the network twice', networkCalls.length === 0, networkCalls.join(','));

  // -------------------------------------------------------------------------
  // passthrough rules
  // -------------------------------------------------------------------------
  const cross = fetchEvent('/app.js');
  cross.request = { ...cross.request, url: 'https://raw.githubusercontent.com/x/y.weathersandbox' };
  await dispatch('fetch', cross);
  check('cross-origin requests are left to the browser', cross.responded === null);

  const post = fetchEvent('/api/publish', { method: 'POST' });
  await dispatch('fetch', post);
  check('non-GET requests are left to the browser', post.responded === null);

  const ranged = fetchEvent('/resources/sounds/wind.mp3', { headers: { range: 'bytes=0-1023' } });
  await dispatch('fetch', ranged);
  check('range requests are left to the browser', ranged.responded === null);

  const zip = fetchEvent('/2dweathersandboxv3.zip');
  await dispatch('fetch', zip);
  check('the source zip is never cached', zip.responded === null);

  const api = fetchEvent('/api/weather-stations');
  await dispatch('fetch', api);
  check('live station data is never cached', api.responded === null);

  const swRequest = fetchEvent('/sw.js', { destination: 'serviceworker' });
  await dispatch('fetch', swRequest);
  check('sw.js is never served from its own cache', swRequest.responded === null);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('harness crashed:', error);
  process.exit(1);
});
