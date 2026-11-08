/* Regression: stormview.js loads from <head> where document.body is null.
 * Ensure the StormOverlay boots only after DOMContentLoaded and that the
 * module never throws at parse time. */
'use strict';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../stormview.js', 'utf8');

let booted = false;
const listeners = {};
function makeEl() {
  return {
    id: '', className: '', style: {}, textContent: '',
    setAttribute() {}, appendChild() {}, remove() {},
    classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => makeEl(),
  };
}
const doc = {
  body: null,                                            // <- <head> phase
  createElement: () => ({
    ...makeEl(),
    getContext: () => null,                              // no GL in harness
  }),
};
const win = {
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  setTimeout: (fn) => fn(), clearTimeout() {},
};
global.document = doc;
global.window = win;
global.location = { search: '' };
global.fetch = () => Promise.reject(new Error('no net in harness'));

// 1. parse-time evaluation with null body must NOT throw
eval(src);
const t1 = typeof global.window.stormOverlay === 'undefined';
console.log(`head-phase load: no crash, overlay deferred ... ${t1 ? 'PASS' : 'FAIL'}`);

// 2. fire DOMContentLoaded with body present → overlay must boot
doc.body = makeEl();
(listeners['DOMContentLoaded'] || []).forEach((fn) => fn());
const t2 = !!global.window.stormOverlay;
console.log(`DOMContentLoaded boots overlay .............. ${t2 ? 'PASS' : 'FAIL'}`);

// 3. no double-boot
(listeners['DOMContentLoaded'] || []).forEach((fn) => fn());
console.log(`boot is idempotent .......................... ${global.window.stormOverlay ? 'PASS' : 'FAIL'}`);

process.exit(t1 && t2 ? 0 : 1);
