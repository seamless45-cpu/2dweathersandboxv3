#!/usr/bin/env node
/*
 * Synthesizes the sci-fi interface sound set into resources/sounds/ui/.
 *
 * The cues are pure math (16-bit PCM, 44.1 kHz mono) rendered offline so the
 * app ships deterministic "recorded" media instead of oscillator graphs — the
 * interface theme check forbids Web Audio synthesis at runtime.
 *
 * Usage:  node tools/generate-ui-sounds.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(__dirname, '..', 'resources', 'sounds', 'ui');

const TAU = Math.PI * 2;
const fract = x => x - Math.floor(x);
// Deterministic hash noise in [-1, 1].
const noise = i => fract(Math.sin(i * 127.1 + 311.7) * 43758.5453) * 2 - 1;
const clampSoft = x => Math.tanh(x);
const expDecay = (t, tau) => Math.exp(-t / tau);
const attack = (t, ms) => Math.min(1, t / (ms / 1000));

function render(durationSeconds, sampleFn) {
  const length = Math.floor(durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = sampleFn(i / SAMPLE_RATE, i);
  // 2 ms edge fades avoid start/stop clicks.
  const fade = Math.floor(SAMPLE_RATE * 0.002);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    samples[i] *= k;
    samples[length - 1 - i] *= k;
  }
  // Peak-normalize to 0.89 to leave headroom for older amps.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const pcm = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) {
    const v = Math.max(-1, Math.min(1, clampSoft(samples[i] * gain)));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return pcm;
}

function writeWav(name, pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // PCM chunk size
  header.writeUInt16LE(1, 20);          // PCM format
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);          // block align
  header.writeUInt16LE(16, 34);         // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  console.log('wrote', path.relative(process.cwd(), file), `(${(pcm.length / 2 / SAMPLE_RATE * 1000).toFixed(0)} ms)`);
}

const SOUNDS = {
  // Console command blip: bright two-harmonic chirp with a contact transient.
  'activate.wav': render(0.19, (t, i) => {
    const env = attack(t, 3) * expDecay(t, 0.055);
    const body = Math.sin(TAU * 1175 * t) * 0.55 + Math.sin(TAU * 2350 * t) * 0.22 + Math.sin(TAU * 3525 * t) * 0.08;
    const transient = t < 0.006 ? noise(i) * (1 - t / 0.006) * 0.3 : 0;
    return body * env + transient;
  }),
  // Servo relay: low clack, then a resolving confirmation chirp.
  'toggle.wav': render(0.16, (t, i) => {
    if (t < 0.012) return noise(i) * expDecay(t, 0.004) * 0.5; // armature hits
    const a = t < 0.055 ? Math.tanh(Math.sin(TAU * 940 * t) * 3.5) * expDecay(t, 0.02) * 0.34 : 0;
    const b = t > 0.048 ? Math.sin(TAU * 1420 * (t - 0.048) + TAU * 940 * 0.048) * attack(t - 0.048, 2) * expDecay(t - 0.048, 0.035) * 0.42 : 0;
    const secondClack = t > 0.052 && t < 0.062 ? noise(i * 3.7) * 0.25 : 0;
    return a + b + secondClack;
  }),
  // Nano second tick for sliders: a dry 2.5 kHz data pip.
  'slider.wav': render(0.04, (t, i) => {
    const env = attack(t, 2) * expDecay(t, 0.009);
    return Math.sin(TAU * 2500 * t) * 0.5 * env + (t < 0.004 ? noise(i) * 0.12 : 0);
  }),
  // Denial buzz: two falling bars, all midrange, impossible to miss.
  'denial.wav': render(0.26, t => {
    const bar = (start, end, freq) => (t >= start && t < end)
      ? Math.tanh(Math.sin(TAU * freq * t - TAU * (t - start) * freq * 0.18) * 5.5) * attack(t - start, 3) * expDecay(t - start, (end - start) * 0.62) * 0.42
      : 0;
    return bar(0.0, 0.075, 208) + bar(0.095, 0.245, 155);
  }),
  // Confirmation sweep: an exponential glide with a fifth riding above it.
  'confirm.wav': render(0.42, t => {
    const g = Math.min(1, t / 0.34);
    const sweep = 620 * Math.pow(2, g); // one octave up
    const phase1 = TAU * 620 * (Math.pow(2, g) - 1) / Math.log(2);
    const env = attack(t, 6) * (t < 0.34 ? 0.9 : expDecay(t - 0.34, 0.045));
    const fundamental = Math.sin(phase1) * 0.5;
    const fifth = Math.sin(TAU * (sweep * 1.5) * t) * 0.18 * g;
    const sparkle = t > 0.3 ? Math.sin(TAU * 2480 * (t - 0.3)) * expDecay(t - 0.3, 0.03) * 0.3 : 0;
    return fundamental * env + fifth * env + sparkle;
  })
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, pcm] of Object.entries(SOUNDS)) writeWav(name, pcm);
