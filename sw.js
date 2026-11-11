/*
 * 2D Weather Sandbox — service worker
 * ---------------------------------------------------------------------------
 * Goals
 *   - The app is nothing but static files: HTML, JS, shader sources, fonts and
 *     a handful of images. All of it is precached so an installed app can be
 *     launched with no network at all.
 *   - The 17 MB of mp3 ambience and the multi-megabyte ground texture must not
 *     sit in front of the install/offline-start path, so they are handled by a
 *     separate, version-independent media cache that fills up as you play.
 *
 * Two caches
 *   weather-sandbox-shell-<VERSION>  precached app shell (+ warmed large art).
 *                                    Wiped and rebuilt on every VERSION bump,
 *                                    which is what keeps returning users from
 *                                    being served stale code.
 *   weather-sandbox-media-v1         sounds, textures — cache-first, kept across
 *                                    releases because those bytes never change.
 *
 * Bump VERSION whenever any precached file changes, and keep it in sync with
 * the ?v= cache busters in index.html / app.js (tests/check-pwa.js asserts it).
 */

'use strict';

const VERSION = '2026-12-06.14';

const APP_CACHE_PREFIX = 'weather-sandbox-';
const SHELL_CACHE_PREFIX = APP_CACHE_PREFIX + 'shell-';
const SHELL_CACHE = SHELL_CACHE_PREFIX + VERSION;
const MEDIA_CACHE = APP_CACHE_PREFIX + 'media-v1';

// Media cache housekeeping: 31 ambience/thunder mp3s + a few textures today,
// so this only ever bites if something starts writing unbounded URLs.
const MEDIA_CACHE_LIMIT = 200;

const INDEX_URL = './index.html';

// Install-blocking app shell (~1.6 MB). Everything the app needs to boot.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',
  './app.js',
  './pwa.js',
  './ecosystem.js',
  './lightningGenerator.js',
  './libraries/chart.js',
  './libraries/chartjs-adapter-date-fns.js',
  './libraries/dat.gui.min.js',
  './libraries/pako.min.js',
  './shaders/common.glsl',
  './shaders/commonDisplay.glsl',
  './shaders/fragment/IRtempDisplayShader.frag',
  './shaders/fragment/advectionShader.frag',
  './shaders/fragment/airQualityDisplayShader.frag',
  './shaders/fragment/bloomBlurShader.frag',
  './shaders/fragment/boundaryShader.frag',
  './shaders/fragment/capeColumnShader.frag',
  './shaders/fragment/capeDisplayShader.frag',
  './shaders/fragment/curlShader.frag',
  './shaders/fragment/humidityDisplayShader.frag',
  './shaders/fragment/isolateBrightPartsShader.frag',
  './shaders/fragment/lightingShader.frag',
  './shaders/fragment/lightningLocationShader.frag',
  './shaders/fragment/postProcessingShader.frag',
  './shaders/fragment/precipDisplayShader.frag',
  './shaders/fragment/precipitationShader.frag',
  './shaders/fragment/pressureShader.frag',
  './shaders/fragment/realisticDisplayShader.frag',
  './shaders/fragment/reflectivityDisplayShader.frag',
  './shaders/fragment/setupShader.frag',
  './shaders/fragment/skyBackgroundDisplayShader.frag',
  './shaders/fragment/temperatureDisplayShader.frag',
  './shaders/fragment/universalDisplayShader.frag',
  './shaders/fragment/velocityShader.frag',
  './shaders/fragment/vorticityShader.frag',
  './shaders/vertex/dispShader.vert',
  './shaders/vertex/postProcessingShader.vert',
  './shaders/vertex/precipDisplayShader.vert',
  './shaders/vertex/precipitationShader.vert',
  './shaders/vertex/realDispShader.vert',
  './shaders/vertex/simShader.vert',
  './resources/fonts/plus-jakarta-sans-latin.woff2',
  './resources/fonts/plus-jakarta-sans-latin-ext.woff2',
  './resources/fonts/roboto-latin.woff2',
  './resources/icons/weather/cloud.svg',
  './resources/icons/weather/cloud-rain.svg',
  './resources/icons/weather/cloud-snow.svg',
  './resources/icons/weather/cloud-sun.svg',
  './resources/icons/weather/moon.svg',
  './resources/icons/weather/sun.svg',
  './resources/icons/app/icon-192.png',
  './resources/icons/app/icon-512.png',
  './resources/icons/app/icon-maskable-192.png',
  './resources/icons/app/icon-maskable-512.png',
  './resources/icons/app/apple-touch-icon.png',
  './resources/img/ColorScales.png',
  './resources/img/Panel.png',
  './resources/img/Discord.png',
  './resources/img/Github.png',
  './resources/img/Patreon.png',
  './resources/img/Youtube.png',
  './resources/img/A380.png',
  './resources/img/A380_R.png',
  './resources/img/A380_gear.png'
];

// Too heavy to block the install on, but still needed for a fully offline
// session. Fetched one by one *after* the worker takes control.
const DEFERRED = [
  './resources/img/noise_texture.jpg',
  './resources/img/background.png',
  './resources/img/surfaceTextureMap.png'
];

// Files that must never be pulled into a cache (the repo ships a 21 MB source
// zip next to index.html, and range requests can't be stored reliably).
const SKIP = /\.(zip|weathersandbox|mp4|webm)$/i;

// The LAN helper's endpoints answer with live weather-station data; a cached
// reply would be a stale observation, so they always go to the network.
const API = /(^|\/)api\//;

const SHELL_PATHS = new Set(
  PRECACHE.concat(DEFERRED).map((path) => new URL(path, self.location.href).pathname)
);

/**
 * Cache keys are query-stripped: the page requests `app.js?v=2026-11-30.1`
 * while the cache holds the plain `app.js` URL. The ?v= buster therefore only
 * affects the HTTP cache; freshness here comes from VERSION alone.
 */
function cacheKey(url) {
  const parsed = new URL(url, self.location.href);
  parsed.search = '';
  parsed.hash = '';
  return parsed.href;
}

function offlinePage() {
  const body =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>2D Weather Sandbox — offline</title><style>' +
    'html,body{height:100%;margin:0}body{display:flex;align-items:center;' +
    'justify-content:center;background:#111820;color:#fff;font-family:system-ui,sans-serif;' +
    'text-align:center;padding:24px}main{max-width:26rem}h1{font-size:1.15rem;font-weight:600;' +
    'margin:0 0 .5rem}p{margin:0;color:rgba(255,255,255,.72);font-size:.9rem;line-height:1.6}' +
    '</style></head><body><main><h1>2D Weather Sandbox is offline</h1>' +
    '<p>The app shell has not been cached yet. Reconnect once and reload, ' +
    'and the sandbox will start without a network from then on.</p></main></body></html>';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ---------------------------------------------------------------------------
// install / activate
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One request at a time on purpose: a single missing optional file must
      // not throw away the whole precache, and phones dislike 60 parallel
      // connections. Slightly slower install, much better failure behaviour.
      const failures = [];
      for (const path of PRECACHE) {
        const key = cacheKey(path);
        try {
          if (await cache.match(key)) continue;
          const response = await fetch(key, { cache: 'reload' });
          if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
          await cache.put(key, response);
        } catch (error) {
          failures.push(path);
          console.warn('[sw] precache failed:', path, error && error.message);
        }
      }
      if (failures.length) console.warn('[sw] ' + failures.length + ' shell file(s) not cached');
      // A couple of optional files may 404 without hurting anything, but if a
      // large part of the shell is unreachable we would install a worker that
      // can never boot the app. Fail the install instead, so the previous
      // worker (or the plain network) keeps working.
      if (failures.length > Math.floor(PRECACHE.length / 4)) {
        throw new Error('[sw] ' + failures.length + ' shell files unavailable; keeping the previous worker');
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Only this app's own caches are touched: the origin may host other
      // projects, and their caches are none of our business.
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          const ours = name.startsWith(APP_CACHE_PREFIX);
          const current = name === SHELL_CACHE || name === MEDIA_CACHE;
          return ours && !current ? caches.delete(name) : null;
        })
      );

      await self.clients.claim();

      // Warm the heavy art in the background; the app is already usable and
      // the downloads are sequential so they don't fight the first frames.
      const cache = await caches.open(SHELL_CACHE);
      for (const path of DEFERRED) {
        const key = cacheKey(path);
        try {
          if (await cache.match(key)) continue;
          const response = await fetch(key);
          if (response.ok) await cache.put(key, response);
        } catch (error) {
          // Offline during activation: the runtime handler will pick this up
          // the first time the app asks for it while online.
        }
      }
    })()
  );
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  // Let the browser handle cross-origin traffic and the update checks.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === self.location.pathname) return;
  if (SKIP.test(url.pathname)) return;
  if (API.test(url.pathname)) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event, request));
    return;
  }

  event.respondWith(handleAsset(event, request, url));
});

/** Navigations: instant from cache, refreshed in the background when online. */
async function handleNavigation(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = cacheKey(INDEX_URL);
  const cached = await cache.match(key);

  if (cached) {
    event.waitUntil(revalidate(cache, key, request));
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch (error) {
    return offlinePage();
  }
}

/** Shell assets: cache-first. Everything else: cache-first, then network. */
async function handleAsset(event, request, url) {
  const key = cacheKey(url.href);
  const isShellAsset = SHELL_PATHS.has(url.pathname);
  const shellCache = await caches.open(SHELL_CACHE);

  const shellHit = await shellCache.match(key);
  if (shellHit) return shellHit;

  if (!isShellAsset) {
    const mediaCache = await caches.open(MEDIA_CACHE);
    const mediaHit = await mediaCache.match(key);
    if (mediaHit) return mediaHit;
    return fetchInto(event, request, key, mediaCache, true);
  }

  return fetchInto(event, request, key, shellCache, false);
}

async function fetchInto(event, request, key, cache, isMedia) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Offline' });
  }

  // Opaque/partial/error responses are served through but never stored.
  if (response.ok && response.status === 200 && response.type === 'basic') {
    event.waitUntil(
      (async () => {
        try {
          await cache.put(key, response.clone());
          if (isMedia) await pruneMedia(cache);
        } catch (error) {
          // Quota or a response that cannot be cloned: ignore.
        }
      })()
    );
  }

  return response;
}

async function revalidate(cache, key, request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) await cache.put(key, response);
  } catch (error) {
    // Offline: the cached copy stays in place.
  }
}

async function pruneMedia(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_CACHE_LIMIT) return;
  const excess = keys.length - MEDIA_CACHE_LIMIT;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

// Lets the page force an update right after a new worker is found.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
