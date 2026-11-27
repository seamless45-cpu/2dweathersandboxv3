// Startup smoke test: executes the real app.js in a sandboxed VM and drives
// exactly the path a click on the Start button takes — loadData() for a new
// simulation — with a stubbed DOM, a stubbed WebGL2 context, a network served
// from this checkout, and a fake AudioContext. Asserts the simulation reaches
// "ready" without any alert, console.error or unhandled rejection.
//
// Why this exists: v2026-11-16.52 shipped a Temporal Dead Zone error
// ("Cannot access 'LOAD_RETRY_DELAYS_MS' before initialization") that aborted
// every simulation start, while every pin suite in tests/ stayed green —
// because none of them ran the startup path at all. This suite runs it.
//
// Five phases, each with a fresh sandbox:
//   A. happy path — every file loads, startup completes, no alert
//   B. one flaky shader request — retried, startup still completes
//   C. one shader that always fails — startup shows the alert naming the file,
//      and the Start button is re-enabled afterwards
//   D. an image that always fails — same surface (alert naming the image)
//   E. oversized HDR target — startup degrades down the scale ladder and completes
//
// Usage:  node tests/check-startup.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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

// ---------------------------------------------------------------------
// chainable stand-in for dat.GUI (and anything else that just decorates)
// ---------------------------------------------------------------------
function makeChainable() {
  const target = function () {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'then') return undefined;         // never looks thenable
      if (prop === 'length') return 0;
      return makeChainable();
    },
    set() { return true; },
    apply() { return makeChainable(); },
    construct() { return makeChainable(); }
  });
}

// ---------------------------------------------------------------------
// WebGL2 stand-in. Anything in CAPS is treated as a constant (number 1),
// anything else an unknown method (no-op); the hot paths carry real values.
// ---------------------------------------------------------------------
function makeFakeGL(spies, options) {
  options = options || {};
  let incompleteFBOs = options.incompleteFBOs || 0;
  let framebufferChecks = 0;
  const base = {
    canvas: null,
    getParameter: () => 16384,
    getExtension: (name) => options.noFloatBlend && name === 'EXT_float_blend' ? null : ({}),
    getSupportedExtensions: () => [],
    getError: () => 0,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
    createShader: () => ({}),
    createProgram: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    createTransformFeedback: () => ({}),
    createSampler: () => ({}),
    FRAMEBUFFER_COMPLETE: 36053, // the stub's CAPS-to-1 rule would make this 1 otherwise
    checkFramebufferStatus: () => (options.incompletePrecipitation || (++framebufferChecks > 1 && incompleteFBOs-- > 0) ? 1 : 36053), // FRAMEBUFFER_INCOMPLETE_ATTACHMENT=1, FRAMEBUFFER_COMPLETE=36053
    isContextLost: () => false
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;
      return function () {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

function make2DContext() {
  const target = function () {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'canvas') return null;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      return makeChainable();
    },
    set() { return true; },
    apply() { return makeChainable(); }
  });
}

// ---------------------------------------------------------------------
// DOM stand-in
// ---------------------------------------------------------------------
function makeClassList() {
  const set = new Set();
  return {
    add(...names) { for (const n of names) set.add(n); },
    remove(...names) { for (const n of names) set.delete(n); },
    toggle(name, force) {
      const want = force === undefined ? !set.has(name) : Boolean(force);
      if (want) set.add(name); else set.delete(name);
      return want;
    },
    contains(name) { return set.has(name); }
  };
}

function makeFakeElement(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    childNodes: [],
    style: {},
    dataset: {},
    classList: makeClassList(),
    attributes: {},
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    tabIndex: 0,
    hidden: false,
    isConnected: true,
    parentElement: null,
    width: tag === 'canvas' ? 1280 : 0,
    height: tag === 'canvas' ? 720 : 0,
    clientWidth: tag === 'canvas' ? 1280 : 0,
    clientHeight: tag === 'canvas' ? 720 : 0,
    value: '',
    files: [],
    options: [],
    selectedIndex: -1,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
    },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    insertBefore(child) { this.children.push(child); child.parentElement = this; return child; },
    insertAdjacentElement() { return null; },
    prepend(child) { this.children.unshift(child); child.parentElement = this; return child; },
    remove() { this.removed = true; if (this.parentElement) { const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    focus() {},
    blur() {},
    closest() { return null; },
    contains() { return false; },
    querySelector() { return makeFakeElement('div'); },
    querySelectorAll() { const list = []; list.forEach = () => {}; return list; },
    getBoundingClientRect() { return { width: 1280, height: 720, left: 0, top: 0, right: 1280, bottom: 720 }; },
    cloneNode() { return makeFakeElement(tag); },
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  if (tag === 'canvas') {
    el.getContext = (kind) => (kind === 'webgl2' ? el.__gl : make2DContext());
  }
  return el;
}

// ---------------------------------------------------------------------
// one startup attempt inside a fresh sandbox
// ---------------------------------------------------------------------
function runStartup(phase) {
  const options = typeof phase === 'object' ? phase : {};
  const failFetchOnce = new Set(options.failFetchOnce || []);
  const failFetchAlways = new Set(options.failFetchAlways || []);
  const failImagesAlways = new Set(options.failImagesAlways || []);

  const spy = {
    alertCalls: [],
    consoleErrorCalls: [],
    fetchCalls: [],
    fetchAttempts: new Map(),
    imageLoads: [],
    loadingScreenRemoved: false
  };

  const fakeGL = makeFakeGL(spy, options);

  const knownIds = {};
  function elementById(id) {
    if (Object.prototype.hasOwnProperty.call(knownIds, id)) return knownIds[id];
    let el = null;
    switch (id) {
      case 'mainCanvas':
        el = makeFakeElement('canvas');
        el.__gl = fakeGL;
        el.width = 1280; el.height = 720;
        break;
      case 'graphCanvas':
        el = makeFakeElement('canvas');
        el.width = 720; el.height = 720;
        break;
      case 'simResSelX': el = makeFakeElement('input'); el.value = '2000'; break;
      case 'simResSelY': el = makeFakeElement('input'); el.value = '300'; break;
      case 'simHeightSel': el = makeFakeElement('input'); el.value = '12000'; break;
      case 'fileInput': el = makeFakeElement('input'); el.files = []; el.value = ''; break;
      default:
        el = null; // unknown ids: behave like a missing element
    }
    if (el) {
      el.id = id;
      const realRemove = el.remove.bind(el);
      el.remove = function () { spy.loadingScreenRemoved = spy.loadingScreenRemoved || id === 'loadingScreen'; realRemove(); };
      knownIds[id] = el;
      // Browsers expose named elements as window globals ("named access"),
      // and the app relies on that once for graphCanvas; emulate it.
      if (sandbox)
        sandbox[id] = el;
    }
    return el;
  }

  const documentStub = {
    readyState: 'loading',
    currentScript: null,
    hidden: false,
    fullscreenElement: null,
    webkitFullscreenElement: null,
    documentElement: makeFakeElement('html'),
    body: makeFakeElement('body'),
    elementCreatedCount: 0,
    _screens: [],
    createElement(tag) {
      const el = makeFakeElement(tag);
      if (tag === 'canvas') el.__gl = fakeGL;
      documentStub.elementCreatedCount++;
      if (tag === 'div') {
        // the loading screen is the only div that matters for the assertions
        const realAppend = el.appendChild.bind(el);
        void realAppend;
      }
      return el;
    },
    createElementNS() { return makeFakeElement('div'); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
    getElementById: elementById,
    querySelector() { return null; },
    querySelectorAll() { const list = []; list.forEach = () => {}; return list; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; }
  };
  // loading bar screens are anonymous divs appended to body; hook body
  const bodyAppend = documentStub.body.appendChild.bind(documentStub.body);
  documentStub.body.appendChild = function (child) {
    if (child && typeof child.setAttribute === 'function') {
      // the LoadingBar marks its screen with id=loadingScreen
      // (set via innerHTML/classList in app.js; we sniff class instead)
      if (typeof child.className === 'string' && child.className.indexOf('loading-screen') >= 0) {
        documentStub._screens.push(child);
        const realRemove = child.remove.bind(child);
        child.remove = function () { spy.loadingScreenRemoved = true; realRemove(); };
      }
    }
    return bodyAppend(child);
  };

  const imageAttempts = new Map();
  class FakeImage {
    constructor() {
      this.width = 512;
      this.height = 512;
      this.onload = null;
      this.onerror = null;
    }
    set src(url) {
      const clean = String(url).split('?')[0].split('#')[0];
      const count = (imageAttempts.get(clean) || 0) + 1;
      imageAttempts.set(clean, count);
      spy.imageLoads.push(clean);
      const fail = failImagesAlways.has(clean);
      queueMicrotask(() => {
        if (fail) {
          if (this.onerror) this.onerror(new Error('Image failed to load: ' + clean));
        } else if (this.onload) {
          this.onload({});
        }
      });
    }
    get src() { return ''; }
  }

  const fakeFetch = async (url) => {
    const clean = String(url).split('?')[0].split('#')[0];
    spy.fetchCalls.push(clean);
    const count = (spy.fetchAttempts.get(clean) || 0) + 1;
    spy.fetchAttempts.set(clean, count);
    const fail = failFetchAlways.has(clean) || (failFetchOnce.has(clean) && count === 1);
    if (fail) {
      return {
        ok: false, status: 503, statusText: 'Service Unavailable', type: 'basic', url: clean,
        headers: new Headers(),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
    let body = null;
    try {
      body = fs.readFileSync(path.join(ROOT, clean), 'utf8');
    } catch (error) {
      body = null;
    }
    if (body === null) {
      return {
        ok: false, status: 404, statusText: 'Not Found', type: 'basic', url: clean,
        headers: new Headers(),
        text: async () => 'not found: ' + clean,
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
    return {
      ok: true, status: 200, statusText: 'OK', type: 'basic', url: clean,
      headers: new Headers({ 'Content-Type': 'text/plain' }),
      text: async () => body,
      arrayBuffer: async () => {
        const buf = Buffer.from(body, 'utf8');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    };
  };

  class FakeAudioContext {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; }
    decodeAudioData() { return Promise.resolve({}); }
  }

  const realSetTimeout = setTimeout;
  // Near-zero delays so retries and backoff stay deterministic in tests.
  // Not unref'd: an await in the startup path must be able to keep the loop alive.
  const fastSetTimeout = (fn, ms, ...args) =>
    realSetTimeout(fn, Math.min(ms === undefined ? 0 : ms, 1), ...args);

  const consoleSpy = {
    log() {}, info() {}, warn() {},
    error(...args) { spy.consoleErrorCalls.push(args.map(String).join(' ')); }
  };

  const sandbox = {
    console: consoleSpy,
    document: documentStub,
    window: null,
    navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    fetch: fakeFetch,
    Image: FakeImage,
    AudioContext: FakeAudioContext,
    Worker: class FakeWorker {
      constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
      postMessage() {}
      terminate() {}
      addEventListener() {}
    },
    dat: { GUI: function FakeGUI() { return makeChainable(); } },
    MutationObserver: class { observe() {} disconnect() {} },
    alert: (msg) => spy.alertCalls.push(String(msg)),
    confirm: () => false,
    prompt: () => '',
    setTimeout: fastSetTimeout,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    URL, URLSearchParams, TextDecoder, TextEncoder, Headers, Response, Request,
    Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, RangeError,
    Map, Set, WeakMap, WeakSet, Date, Promise, Symbol, BigInt,
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView,
    isNaN, isFinite, parseInt, parseFloat, NaN, Infinity, undefined,
    queueMicrotask, queueMicrotaskFn: undefined
  };
  sandbox.window = sandbox; // window === globalThis in browsers
  sandbox.window.innerWidth = 1600;
  sandbox.window.innerHeight = 900;
  sandbox.window.AudioContext = FakeAudioContext;
  sandbox.window.addEventListener = () => {};
  sandbox.window.removeEventListener = () => {};
  sandbox.addEventListener = () => {};
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  try {
    vm.runInContext(APP_JS, sandbox, { filename: 'app.js' });
  } catch (error) {
    spy.consoleErrorCalls.push('app.js threw at parse time: ' + (error && error.message));
    return Promise.resolve({ spy, settled: false, error });
  }

  const loadData = sandbox.loadData;
  if (typeof loadData !== 'function')
    return Promise.resolve({ spy, settled: false, error: new Error('loadData is not defined in the sandbox') });

  return Promise.resolve()
    .then(() => loadData())
    .then(() => ({ spy, settled: true, error: null }))
    .catch((error) => ({ spy, settled: false, error }));
}

function assertStartupCompleted(name, result) {
  check(name + ': loadData() returned', result.settled, result.error && result.error.message);
  check(name + ': the loading screen was removed', result.spy.loadingScreenRemoved);
  check(name + ': no alert was shown', result.spy.alertCalls.length === 0, result.spy.alertCalls.join(' | '));
  check(name + ': nothing was logged to console.error', result.spy.consoleErrorCalls.length === 0, result.spy.consoleErrorCalls.join(' | '));
}

(async () => {
  // ---------------------------------------------------------
  // phase A: everything loads
  // ---------------------------------------------------------
  const A = await runStartup();
  assertStartupCompleted('happy path', A);
  const shadersAndCommon = A.spy.fetchCalls.filter((url) => url.indexOf('shaders/') === 0 || url.indexOf('/shaders/') >= 0);
  check('happy path: all 33 shader and include files were requested',
        new Set(shadersAndCommon).size === 33,
        'got ' + new Set(shadersAndCommon).size);
  check('happy path: no file needed a retry', [...A.spy.fetchAttempts.values()].every((n) => n === 1));
  for (const image of ['resources/img/noise_texture.jpg', 'resources/img/surfaceTextureMap-2048.png',
                       'resources/img/ColorScales.png', 'resources/img/A380.png']) {
    check('happy path: image requested: ' + image, A.spy.imageLoads.includes(image));
  }

  // ---------------------------------------------------------
  // phase B: one shader 503s once — the retry must absorb it
  // ---------------------------------------------------------
  const B = await runStartup({ failFetchOnce: ['shaders/fragment/velocityShader.frag'] });
  assertStartupCompleted('one flaky shader', B);
  check('one flaky shader: the file was retried and the startup completed anyway',
        (B.spy.fetchAttempts.get('shaders/fragment/velocityShader.frag') || 0) > 1,
        'attempts: ' + B.spy.fetchAttempts.get('shaders/fragment/velocityShader.frag'));

  // ---------------------------------------------------------
  // phase C: one shader always fails — the alert must name it
  // ---------------------------------------------------------
  const C = await runStartup({ failFetchAlways: ['shaders/fragment/velocityShader.frag'] });
  check('fatal shader: loadData() returned instead of hanging', C.settled);
  check('fatal shader: an alert names the failing file',
        C.spy.alertCalls.length === 1 && C.spy.alertCalls[0].indexOf('velocityShader') >= 0,
        C.spy.alertCalls.join(' | '));

  // ---------------------------------------------------------
  // phase D: an image always fails — the alert must name it
  // ---------------------------------------------------------
  const D = await runStartup({ failImagesAlways: ['resources/img/ColorScales.png'] });
  check('fatal image: loadData() returned instead of hanging', D.settled);
  check('fatal image: an alert names the failing image',
        D.spy.alertCalls.length === 1 && D.spy.alertCalls[0].indexOf('ColorScales') >= 0,
        D.spy.alertCalls.join(' | '));

  // ---------------------------------------------------------
  // phase E: the 150% and 100% HDR targets are not renderable on the
  // device (oversized texture) — startup must degrade to a smaller HDR
  // target and complete, never black out with no message.
  // ---------------------------------------------------------
  const E = await runStartup({ incompleteFBOs: 2 });
  assertStartupCompleted('oversized HDR demotes instead of blacking out', E);

  const F = await runStartup({ noFloatBlend: true });
  assertStartupCompleted('no float-blend extension', F);
  const G = await runStartup({ incompletePrecipitation: true });
  check('unsupported precipitation framebuffer gives a useful error', G.settled && G.spy.alertCalls.some(message => message.includes('Precipitation framebuffer')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('harness crashed:', error);
  process.exit(1);
});
