/*
 * lightningGenerator.js — procedural lightning artwork, generated off the main
 * thread and transferred as an ImageBitmap.
 *
 * Two shapes are produced from the same single-channel (luminance) canvas:
 *
 *   mode: 'CG'  Cloud-to-ground bolt. One dominant channel grows downward with
 *               the classic dendritic forks. This is the original artwork used
 *               by the legacy (cloud-density triggered) lightning in app.js.
 *
 *   mode: 'IC'  Intra-cloud flash. Real IC lightning is a wide, flat, heavily
 *               forked "spider" that spreads horizontally through the charge
 *               layer inside a cloud — it never reaches the ground, and its
 *               channels are dimmer/softer than a CG return stroke. The
 *               generator reproduces that: several layered filaments spread
 *               out from the flash origin with many fine side branches, all
 *               confined to a horizontal band of the image.
 *
 * Protocol (unchanged for the legacy caller):
 *   worker.postMessage({width, height})             -> CG bolt bitmap
 *   worker.postMessage({width, height, mode:'IC'})  -> IC flash bitmap
 * The worker always posts back the ImageBitmap itself.
 */
onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(32, Math.round(msg.width || 1250));
  const height = Math.max(32, Math.round(msg.height || 2500));
  const bitmap = (msg.mode === 'IC')
    ? generateIntraCloudBolt(width, height, msg.seed)
    : generateLightningBolt(width, height);
  postMessage(bitmap, [bitmap]);
};


/* Deterministic little PRNG (mulberry32) so a seed gives a stable bolt. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/* ===================== cloud-to-ground bolt (original) ==================== */

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth * 2.0, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 4.5;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 1.4;  // 0.7

    angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();


  return lightningCanvas.transferToImageBitmap();


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * 0.7;

      angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) { // reduce width

        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.1;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1) { // branch 0.005

          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}


/* ========================= intra-cloud flash (IC) ======================= */

/**
 * Draw a horizontal, multiply-forked intra-cloud flash.
 *
 * Structure, from the physics of real IC flashes:
 *  - the flash origin sits in the middle of the charge layer;
 *  - a handful of primary filaments run both ways along the layer, each with
 *    slow angular wander, so the overall shape is wide and flat;
 *  - side branches (and side-branches of side-branches) taper quickly, giving
 *    the fine "spider" texture seen in high-speed video;
 *  - everything is confined to a horizontal band, and is deliberately dimmer
 *    than a CG return stroke (the renderer adds colour, bloom and flicker).
 */
function generateIntraCloudBolt(width, height, seed)
{
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rand = makeRng(seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const band = height * 0.42;            // vertical extent of the charge layer
  const bandLo = cy - band * 0.5;
  const bandHi = cy + band * 0.5;
  const stepLen = Math.max(0.9, width / 640);
  const marginX = width * 0.025;

  /* single-channel tone: wider channels are brighter, IC stays soft */
  function tone(w, gain) {
    const v = Math.pow(Math.max(w, 0.05), 1.7) * 46.0 * gain;
    const c = Math.max(0, Math.min(255, Math.round(v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
  }

  /* wide faint glow pass + narrow bright core pass */
  function strokePath(pts, w, gain) {
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);

    ctx.globalAlpha = 0.30;
    ctx.lineWidth = Math.max(0.9, w * 2.4);
    ctx.strokeStyle = tone(w, gain * 0.5);
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(0.4, w);
    ctx.strokeStyle = tone(w, gain);
    ctx.stroke();
  }

  /*
   * Grow one filament. Forks are queued (not recursed) so a very branchy flash
   * cannot blow the stack inside a worker.
   */
  function growFilament(x0, y0, ang, len, w0, gain, depth, queue) {
    let x = x0, y = y0, a = ang, w = w0;
    const pts = [x, y];
    let travelled = 0;
    const minW = Math.max(0.22, w0 * 0.12);
    const forkChance = depth === 0 ? 0.014 : 0.026;

    for (let i = 0; i < len; i++) {
      a += (rand() - 0.5) * 0.55;
      // pull back toward the horizontal direction this filament is already
      // travelling in (NOT toward 0, which used to turn every left-going
      // branch around and pile the whole flash onto one side of the image)
      const target = Math.cos(a) >= 0 ? 0 : Math.PI;
      let da = target - a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      a += da * 0.05;
      // soft confinement inside the charge layer
      if (y < bandLo) a += 0.05;
      else if (y > bandHi) a -= 0.05;

      const nx = x + Math.cos(a) * stepLen;
      const ny = y + Math.sin(a) * stepLen;
      if (nx < marginX || nx > width - marginX) break;
      if (ny < 3 || ny > height - 3) break;

      x = nx; y = ny;
      travelled += stepLen;
      pts.push(x, y);
      w = Math.max(minW, w * 0.9972);

      if (depth < 4 && travelled > stepLen * 6 && rand() < forkChance) {
        const forkAng = a + (rand() < 0.5 ? -1 : 1) * (0.30 + rand() * 0.85);
        queue.push({
          x, y,
          ang: forkAng,
          len: Math.max(7, Math.round(len * (0.22 + rand() * 0.30))),
          w: Math.max(0.26, w * (0.42 + rand() * 0.28)),
          gain: gain * 0.82,
          depth: depth + 1
        });
      }
    }
    strokePath(pts, w0, gain);
  }

  const queue = [];

  /* --- primary filaments: several layered spiders around the origin --- */
  const nPrimary = 6 + Math.floor(rand() * 3);          // 6..8
  for (let i = 0; i < nPrimary; i++) {
    const side = (i % 2 === 0) ? 1 : -1;                // spread both ways
    const yJitter = (rand() - 0.5) * band * 0.62;
    const startX = clamp(cx + (rand() - 0.5) * width * 0.07, marginX, width - marginX);
    const startY = clamp(cy + yJitter, bandLo, bandHi);
    const len = Math.round((width * (0.34 + rand() * 0.16)) / stepLen);
    const w = 1.7 + rand() * 1.1;
    growFilament(startX, startY, side > 0 ? 0 + (rand() - 0.5) * 0.40
                                          : Math.PI + (rand() - 0.5) * 0.40,
                 len, w, 1.0, 0, queue);
  }

  /* --- dense core burst around the origin ---------------------------- */
  // Real IC flashes have a bright, chaotic core where the bidirectional
  // leader starts; without it the texture reads as a few loose strands.
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 * 0.18 + (rand() - 0.5) * 0.9;
    const dir = i % 2 === 0 ? ang : Math.PI + ang;
    const len = Math.round((width * (0.06 + rand() * 0.10)) / stepLen);
    growFilament(cx + (rand() - 0.5) * width * 0.03,
                 clamp(cy + (rand() - 0.5) * band * 0.35, bandLo, bandHi),
                 dir, len, 1.1 + rand() * 0.9, 0.9, 1, queue);
  }

  /* --- thin filaments offset above/below give the layered look --- */
  for (let i = 0; i < 3; i++) {
    const startY = clamp(cy + (rand() - 0.5) * band, bandLo, bandHi);
    const startX = cx + (rand() - 0.5) * width * 0.20;
    const len = Math.round((width * (0.20 + rand() * 0.18)) / stepLen);
    growFilament(startX, startY, (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.9,
                 len, 0.9 + rand() * 0.6, 0.70, 1, queue);
  }

  /* --- process forks (breadth first keeps all primary strokes first) --- */
  let guard = 0;
  while (queue.length && guard++ < 420) {
    const fork = queue.shift();
    growFilament(fork.x, fork.y, fork.ang, fork.len, fork.w, fork.gain, fork.depth, queue);
  }

  ctx.globalAlpha = 1.0;
  return canvas.transferToImageBitmap();

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
}
