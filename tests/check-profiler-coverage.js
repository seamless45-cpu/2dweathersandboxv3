const assert = require('assert'), fs = require('fs'), vm = require('vm');
const source = fs.readFileSync('app.js', 'utf8');
const profiler = source.slice(source.indexOf('function createGpuPerformanceProfiler('), source.indexOf('// global framebuffers for measurements'));
let now = 0, active = false, queries = 0, deleted = 0;
const ext = {TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2};
const gl = {QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, getExtension: () => ext,
  createQuery: () => ({}), beginQuery: () => { assert(!active); active = true; queries++; },
  endQuery: () => { assert(active); active = false; }, getQueryParameter: (q, k) => k === 3 ? true : 2000000,
  getParameter: () => false, deleteQuery: () => deleted++};
const context = {performance: {now: () => now}, Object, Number};
vm.createContext(context); vm.runInContext(profiler, context);
const p = context.createGpuPerformanceProfiler(gl, true);
for (let frame = 0; frame < 180; frame++) {
  now = frame * 100; p.frame(frame);
  // Simulate a paused scene: simulation stages and bloom are never submitted.
  for (const name of ['lightning render state', 'sky', 'scene', 'post']) {
    p.begin(name); p.end(name);
  }
  now += 4; p.finish();
}
const report = p.report();
for (const name of ['lightning render state', 'sky', 'scene', 'post']) assert(report.gpu[name]?.samples >= 2, name);
assert.equal(report.gpu.velocity, null);
assert.equal(report.frameInterval.samples, 60);
assert.equal(report.frameInterval.medianMs, 100);
assert.equal(report.cpuFrame.medianMs, 4);
assert(queries > 0 && deleted >= queries - 1 && !active);
const noTimer = context.createGpuPerformanceProfiler({...gl, getExtension: () => null}, true);
now = 0; noTimer.frame(0); noTimer.finish(); now = 250; noTimer.frame(1); noTimer.finish();
assert.equal(noTimer.report().gpuTimerSupported, false);
assert.equal(noTimer.report().frameInterval.medianMs, 250);
console.log('Profiler samples available stages without starving paused scenes and records real frame intervals.');
