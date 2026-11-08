// Shader validation harness: runs glslangValidator on every shader in
// shaders/, honouring the app's #include "common.glsl" / "commonDisplay.glsl"
// convention (loadShader() in app.js inlines those at runtime).
//
// Usage:  node tests/check-shaders.js
// Expects glslangValidator at
//   ../node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux
// (npm i --no-save glslang-validator-prebuilt-predownloaded) or on PATH.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHADER_DIR = path.join(ROOT, 'shaders');

function findValidator() {
  const candidates = [
    path.join(ROOT, '..', 'node_modules', 'glslang-validator-prebuilt-predownloaded', 'bin', 'glslangValidator.linux'),
    path.join('/home/user', 'node_modules', 'glslang-validator-prebuilt-predownloaded', 'bin', 'glslangValidator.linux'),
    'glslangValidator'
  ];
  for (const c of candidates) {
    try { cp.execSync(JSON.stringify(c) + ' --version', {stdio: 'pipe'}); return c; } catch (e) { /* next */ }
  }
  throw new Error('glslangValidator not found');
}

function inlineIncludes(src, dir, seen) {
  return src.replace(/#include\s+"([^"]+)"/g, (m, name) => {
    const p = path.join(SHADER_DIR, name);
    const abs = path.resolve(dir, name);
    const file = fs.existsSync(abs) ? abs : p;
    if (!fs.existsSync(file)) throw new Error('missing include ' + name);
    if (seen && seen.has(file)) return ''; // guard against double-inclusion
    const body = fs.readFileSync(file, 'utf8');
    // strip nested #version from shared chunks; precision statements are
    // redeclarable and must survive (isampler2D has no default precision)
    const cleaned = body.replace(/^#version.*$/mg, '');
    return inlineIncludes(cleaned, path.dirname(file), new Set([...(seen || []), file]));
  });
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'disabled') walk(p, out); }
    else if (/\.(frag|vert)$/.test(ent.name)) out.push(p);
    else if (ent.name.endsWith('.glsl')) {
      // shared chunks are validated as fragments for completeness
      out.push(p);
    }
  }
  return out;
}

const validator = findValidator();
const files = walk(SHADER_DIR, []);
files.sort();

let pass = 0, fail = 0;
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadercheck-'));
for (const file of files) {
  const rel = path.relative(ROOT, file);
  let src = fs.readFileSync(file, 'utf8');
  let stage = file.endsWith('.vert') ? 'vert' : 'frag';
  if (file.endsWith('.glsl')) continue; // library chunks can't stand alone
  if (!/#version/.test(src)) {
    if (stage === 'vert') src = '#version 300 es\nprecision highp float;\n' + src;
    else src = '#version 300 es\nprecision highp float;\nprecision highp sampler2D;\nprecision highp isampler2D;\n' + src;
  }
  let compiled;
  try {
    compiled = inlineIncludes(src, path.dirname(file));
  } catch (e) {
    console.error('FAIL(include)', rel, '-', e.message); fail++; continue;
  }
  const tmp = path.join(tmpdir, path.basename(file));
  fs.writeFileSync(tmp, compiled);
  const r = cp.spawnSync(validator, [tmp], {encoding: 'utf8'});
  const out = (r.stdout + r.stderr).trim();
  if (r.status === 0 && !/ERROR/i.test(out)) { pass++; console.log('OK  ', rel); }
  else { fail++; console.log('FAIL', rel, '\n', out.split('\n').slice(0, 8).join('\n')); }
  fs.unlinkSync(tmp);
}
fs.rmdirSync(tmpdir);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
