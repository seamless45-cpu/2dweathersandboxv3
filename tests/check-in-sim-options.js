'use strict';
// The controller bridge has no runtime dependencies. If jsdom is present,
// exercise it against the shipped dat.GUI as well as static wiring checks.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let passed = 0, failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) passed++; else failed++; }
check('every in-simulation dat.GUI option controller receives an in-page listbox',
  /function setupInSimOptionLists\(gui\)/.test(app) && /folder\.__controllers\.forEach\(setupController\)/.test(app) &&
  /Object\.values\(folder\.__folders\)\.forEach\(visit\)/.test(app) && /cleanupOptionLists = setupInSimOptionLists\(datGui\)/.test(app));
check('native select is hidden while the dat.GUI adapter remains wired to change events',
  /select\.style\.display = 'none'/.test(app) && /select\.setAttribute\('aria-hidden', 'true'\)/.test(app) &&
  /select\.dispatchEvent\(new Event\('change', \{bubbles: true\}\)\)/.test(app) &&
  /controller\.updateDisplay = function/.test(app));
check('in-page option panel has focus, listbox semantics, keyboard navigation, and wheel support',
  /aria-haspopup', 'listbox'/.test(app) && /menu\.setAttribute\('role', 'listbox'\)/.test(app) &&
  /item\.setAttribute\('role', 'option'\)/.test(app) && /event\.key === 'Escape'/.test(app) &&
  /'ArrowDown', 'ArrowUp', 'Home', 'End'/.test(app) && /trigger\.addEventListener\('wheel'/.test(app));
check('panel is inserted in fullscreen-compatible document body and cleaned up during GUI rebuild',
  /document\.body\.appendChild\(menu\)/.test(app) && /document\.addEventListener\('fullscreenchange', onResize\)/.test(app) &&
  /if \(cleanupOptionLists\)\s*\n\s*cleanupOptionLists\(\)/.test(app) && /controllerRestorers\.forEach/.test(app));
check('custom option list has visible in-app styling and bounded scrollable overlay',
  /\.sim-option-menu\s*\{[\s\S]{0,200}position: fixed;/.test(html) &&
  /\.sim-option-menu\s*\{[\s\S]{0,200}overflow-y: auto;/.test(html) && /\.sim-option-item\[aria-selected="true"\]/.test(html));

let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) { console.log('SKIP interactive DOM checks (optional jsdom is not installed)'); }
if (JSDOM) {
  const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://example.com', runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window;
  try {
    w.eval(fs.readFileSync(path.join(root, 'libraries/dat.gui.min.js'), 'utf8'));
    const a = app.indexOf('  function setupInSimOptionLists(gui)');
    const b = app.indexOf('  function setupDatGui(strGuiControls)', a);
    w.eval(app.slice(a, b) + ';window.setupInSimOptionLists=setupInSimOptionLists;');
    const state = {tool: 'none', mode: 'one'};
    const gui = new w.dat.GUI({autoPlace: false});
    w.document.body.appendChild(gui.domElement);
    const tool = gui.add(state, 'tool', {'None': 'none', 'Rod': 'rod', 'Lightning': 'bolt'}).name('Tool').listen();
    const mode = gui.addFolder('Display').add(state, 'mode', {'One': 'one', 'Two': 'two'}).name('Mode').listen();
    let changes = 0; tool.onChange(() => changes++);
    const cleanup = w.setupInSimOptionLists(gui);
    const btn = gui.domElement.querySelector('.sim-option-trigger');
    btn.getBoundingClientRect = () => ({width: 200, right: 300, bottom: 40, top: 15});
    check('real dat.GUI controllers, including nested folders, get custom triggers',
      gui.domElement.querySelectorAll('.sim-option-trigger').length === 2 && tool.__select.style.display === 'none');
    btn.click();
    let menu = w.document.querySelector('[role=listbox]');
    check('opening creates an in-page list with the current selection',
      !!menu && menu.children.length === 3 && menu.children[0].getAttribute('aria-selected') === 'true' && btn.getAttribute('aria-expanded') === 'true');
    menu.children[2].click();
    check('click selection calls the original controller exactly once and closes',
      state.tool === 'bolt' && changes === 1 && btn.textContent === 'Lightning' && !w.document.querySelector('[role=listbox]'));
    tool.setValue('rod');
    mode.setValue('two');
    check('programmatic controller updates synchronize both option labels',
      btn.textContent === 'Rod' && gui.domElement.querySelectorAll('.sim-option-trigger')[1].textContent === 'Two');
    btn.dispatchEvent(new w.WheelEvent('wheel', {deltaY: 10, bubbles: true, cancelable: true}));
    check('wheel cycles options through dat.GUI changes', state.tool === 'bolt' && btn.textContent === 'Lightning');
    btn.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true}));
    menu = w.document.querySelector('[role=listbox]');
    const openedAtSelected = menu && w.document.activeElement.textContent === 'Lightning';
    menu.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true}));
    check('keyboard opens at selection and navigates cyclically', openedAtSelected && w.document.activeElement.textContent === 'None');
    menu.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    check('Escape closes the panel and returns focus', !w.document.querySelector('[role=listbox]') && w.document.activeElement === btn);
    btn.click();
    w.document.body.dispatchEvent(new w.Event('pointerdown', {bubbles: true}));
    check('outside click closes the panel', !w.document.querySelector('[role=listbox]'));
    btn.click();
    cleanup();
    check('cleanup removes a live panel and trigger elements', !w.document.querySelector('[role=listbox]') && !gui.domElement.querySelector('.sim-option-trigger'));
    gui.destroy();
  } catch (error) {
    check('interactive dat.GUI integration: ' + error.message, false);
  } finally { dom.window.close(); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
