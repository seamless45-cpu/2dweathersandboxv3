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
 *   mode: 'IC'  Intra-cloud flash. Real IC lightning never reaches the ground,
 *               has dimmer/softer channels than a CG return stroke and comes in
 *               several shapes, so the generator draws one of four: 'spider',
 *               'crawler', 'canopy' and 'web' (see generateIntraCloudBolt).
 *               Every shape is confined to a horizontal band of the image, on
 *               top of a soft elliptical halo.
 *
 *               app.js renders all four into a 2x2 atlas (one tile per
 *               lightning slot) and realisticDisplayShader.frag draws them for
 *               every strike whose intensity is at or below
 *               LIGHTNING_IC_MAX_INTENSITY, i.e. every intra-cloud flash.
 *
 * Protocol (unchanged for the legacy caller):
 *   worker.postMessage({width, height})             -> CG bolt bitmap
 *   worker.postMessage({width, height, mode:'IC',
 *                       variant, seed})             -> IC flash bitmap
 * The worker always posts back the ImageBitmap itself.
 */
onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(32, Math.round(msg.width || 1250));
  const height = Math.max(32, Math.round(msg.height || 2500));
  const bitmap = (msg.mode === 'IC')
    ? generateIntraCloudBolt(width, height, msg.seed, msg.variant)
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
 * Intra-cloud flashes do not all look alike, so the generator draws four
 * different shapes and app.js puts one in each tile of the 2x2 atlas:
 *
 *   'spider'   layered bidirectional filaments running out from the flash
 *              origin: the classic wide, flat IC flash.
 *   'crawler'  one long horizontal channel with a comb of short,
 *              near-perpendicular branches: a fast horizontal crawl.
 *   'lattice'  two horizontal trunks stacked through the layer, tied together
 *              by steep cross-channels: the layered look of a large IC flash.
 *   'web'      several small centres joined by short radiating filaments, the
 *              mesh-like look of a dense charge layer.
 *
 * All of them stay inside the horizontal band that represents the charge layer,
 * keep clear of the tile margins (the four tiles share one atlas texture, so
 * artwork that touched the edge would bleed into its neighbour) and stay much
 * dimmer than a CG return stroke.
 */
const IC_VARIANTS = ['spider', 'crawler', 'lattice', 'web'];


function generateIntraCloudBolt(width, height, seed, variant)
{
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rand = makeRng(seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed);
  const style = IC_VARIANTS[(variant === undefined || variant === null
    ? Math.floor(rand() * IC_VARIANTS.length)
    : variant) % IC_VARIANTS.length];

  const cx = width * 0.5;
  const cy = height * 0.5;
  // Vertical thickness of the charge layer the flash spreads through.
  const band = height * (0.36 + rand() * 0.14);
  const bandLo = cy - band * 0.5;
  const bandHi = cy + band * 0.5;
  const stepLen = Math.max(0.9, width / 640);
  const marginX = Math.max(8, width * 0.03); // keeps atlas tiles free of bleed

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* single-channel tone: wider channels are brighter, IC stays soft */
  function tone(w, gain) {
    const v = Math.pow(Math.max(w, 0.05), 1.7) * 60.0 * gain;
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
   * Grow one filament. Fork targets are queued (never recursed) so a very
   * branchy flash cannot blow the stack inside a worker. `st` carries the
   * per-shape behaviour: how much the channel wanders, how strongly it is
   * pulled back along its own axis (horizontal, or vertical for 'canopy') and
   * how eagerly it forks.
   */
  function growFilament(x0, y0, ang, len, w0, gain, depth, queue, st) {
    let x = x0, y = y0, a = ang, w = w0;
    const pts = [x, y];
    let travelled = 0;
    const minW = Math.max(0.22, w0 * 0.12);
    const forkChance = depth === 0 ? st.fork0 : st.forkN;

    for (let i = 0; i < len; i++) {
      a += (rand() - 0.5) * st.wander;
      // Pull back toward the axis this filament is already travelling along
      // (NOT toward 0, which used to turn every left-going branch around and
      // pile the whole flash onto one side of the image).
      const target = st.vertical
        ? (Math.sin(a) >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5)
        : (Math.cos(a) >= 0 ? 0 : Math.PI);
      let da = target - a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      a += da * st.pull;
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
        const forkAng = a + (rand() < 0.5 ? -1 : 1) * st.spread * (0.5 + rand());
        queue.push({
          x, y,
          ang: forkAng,
          len: Math.max(7, Math.round(len * (0.22 + rand() * 0.30))),
          w: Math.max(0.26, w * (0.42 + rand() * 0.28)),
          gain: gain * 0.82,
          depth: depth + 1,
          st: st
        });
      }
    }
    strokePath(pts, w0, gain);
  }

  const queue = [];

  /*
   * A channel that sweeps the whole width of the charge layer, optionally
   * dropping branches as it goes. Used by 'crawler' (one trunk, branches both
   * ways) and 'lattice' (two trunks tied together by cross-channels).
   */
  function horizontalTrunk(yStart, trunkWidth, gain, opts) {
    const branchEvery = Math.max(0, Math.round(opts.branchEvery || 0));
    const branchLen = opts.branchLen || 0;
    let x = marginX;
    let y = clamp(yStart, bandLo, bandHi);
    let a = 0;                                     // travelling to the right
    const pts = [x, y];
    const steps = Math.ceil((width - marginX * 2) / stepLen);

    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * (opts.wander || 0.30);
      let da = -a;                                 // pull back to horizontal
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      a += da * (opts.pull || 0.22);

      x = Math.min(x + Math.cos(a) * stepLen, width - marginX);
      y = clamp(y + Math.sin(a) * stepLen, bandLo, bandHi);
      pts.push(x, y);

      if (branchEvery && i > 4 && i % branchEvery === 0) {
        const dir = opts.branchUp === 0 || opts.branchUp === undefined
          ? (rand() < 0.5 ? 1 : -1)
          : opts.branchUp;
        queue.push({
          x, y,
          ang: dir * (Math.PI * 0.5 + (rand() - 0.5) * 0.9),
          len: Math.max(5, Math.round(branchLen * (0.55 + rand() * 0.9))),
          w: Math.max(0.4, trunkWidth * (0.26 + rand() * 0.22)),
          gain: gain * 0.80,
          depth: 1,
          st: branchStyle
        });
      }
    }
    strokePath(pts, trunkWidth, gain);
  }

  /*
   * Soft halo. Real IC flashes light up the whole charge layer around them, and
   * without this the artwork reads as a few loose wires pasted on top of the
   * cloud instead of light coming from inside it. The halo is an ellipse that
   * fades to zero before the tile edge, so packing four tiles into one atlas
   * and sampling it with linear filtering cannot bleed across seams.
   */
  function drawHalo(alpha, coreAlpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, (band * 1.15) / Math.max(width * 0.5, 1));
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.5);
    halo.addColorStop(0.0, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
    halo.addColorStop(0.55, 'rgba(255,255,255,' + (alpha * 0.45).toFixed(3) + ')');
    halo.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-width, -width, width * 2, width * 2);
    ctx.restore();

    if (coreAlpha > 0) {
      // bright core where the bidirectional leader starts
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.2);
      coreGlow.addColorStop(0.0, 'rgba(255,255,255,' + coreAlpha.toFixed(3) + ')');
      coreGlow.addColorStop(0.45, 'rgba(255,255,255,' + (coreAlpha * 0.16).toFixed(3) + ')');
      coreGlow.addColorStop(1.0, 'rgba(255,255,255,0)');
      ctx.fillStyle = coreGlow;
      ctx.fillRect(0, 0, width, height);
    }
  }

  const spiderStyle = { wander : 0.55, pull : 0.05, fork0 : 0.014, forkN : 0.026, spread : 0.55, vertical : false };
  const branchStyle = { wander : 0.50, pull : 0.03, fork0 : 0.020, forkN : 0.030, spread : 0.70, vertical : true };
  const webStyle = { wander : 0.70, pull : 0.04, fork0 : 0.030, forkN : 0.050, spread : 0.80, vertical : false };

  if (style === 'spider') {
    drawHalo(0.07, 0.12);

    /* --- primary filaments: several layered spiders around the origin --- */
    const nPrimary = 7 + Math.floor(rand() * 3);          // 7..9
    for (let i = 0; i < nPrimary; i++) {
      const side = (i % 2 === 0) ? 1 : -1;                // spread both ways
      const yJitter = (rand() - 0.5) * band * 0.62;
      const startX = clamp(cx + (rand() - 0.5) * width * 0.07, marginX, width - marginX);
      const startY = clamp(cy + yJitter, bandLo, bandHi);
      const len = Math.round((width * (0.34 + rand() * 0.16)) / stepLen);
      const w = 2.6 + rand() * 1.4;
      growFilament(startX, startY, side > 0 ? 0 + (rand() - 0.5) * 0.40
                                            : Math.PI + (rand() - 0.5) * 0.40,
                   len, w, 1.0, 0, queue, spiderStyle);
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
                   dir, len, 1.1 + rand() * 0.9, 0.9, 1, queue, spiderStyle);
    }

    /* --- thin filaments offset above/below give the layered look --- */
    for (let i = 0; i < 3; i++) {
      const startY = clamp(cy + (rand() - 0.5) * band, bandLo, bandHi);
      const startX = cx + (rand() - 0.5) * width * 0.20;
      const len = Math.round((width * (0.20 + rand() * 0.18)) / stepLen);
      growFilament(startX, startY, (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.9,
                   len, 0.9 + rand() * 0.6, 0.70, 1, queue, spiderStyle);
    }
  } else if (style === 'crawler') {
    drawHalo(0.05, 0.09);

    /* one long channel sweeps the whole layer, dropping a comb of short, steep
       branches as it goes: the "crawler" look */
    horizontalTrunk(cy + (rand() - 0.5) * band * 0.25, 4.4 + rand() * 1.0, 1.0,
                    { branchEvery : 13 + Math.floor(rand() * 8), branchLen : (band * 0.42) / stepLen, branchUp : 0 });
    if (rand() < 0.85)
      horizontalTrunk(cy + (rand() - 0.5) * band * 0.9, 2.2 + rand() * 0.8, 0.75,
                      { branchEvery : 20 + Math.floor(rand() * 10), branchLen : (band * 0.30) / stepLen, branchUp : 0 });
  } else if (style === 'lattice') {
    drawHalo(0.06, 0.10);

    /*
     * Two trunks running through the layer at different heights, tied together
     * by steep cross-channels: a big IC flash lights up more than one layer of
     * charge, and the channels between the layers are what makes it look like a
     * lattice rather than a single stroke.
     */
    const upperY = cy - band * (0.18 + rand() * 0.14);
    const lowerY = cy + band * (0.18 + rand() * 0.14);
    const trunkOpts = { wander : 0.52, pull : 0.06 };          // undulating, not a ruler
    horizontalTrunk(upperY, 3.0 + rand() * 0.9, 1.0, trunkOpts);
    horizontalTrunk(lowerY, 2.8 + rand() * 0.9, 0.95, trunkOpts);

    /* cross-channels between the two trunks, at assorted angles */
    for (let i = 0; i < 9; i++) {
      const fromTop = rand() < 0.5;
      const x = marginX + rand() * (width - marginX * 2);
      growFilament(x, (fromTop ? upperY : lowerY) + (rand() - 0.5) * band * 0.1,
                   fromTop ? (Math.PI * 0.5 + (rand() - 0.5) * 1.1) : (-Math.PI * 0.5 + (rand() - 0.5) * 1.1),
                   Math.round((band * (0.25 + rand() * 0.45)) / stepLen),
                   1.0 + rand() * 1.0, 0.85, 1, queue, branchStyle);
    }

    /* a few forks along the trunks so they do not read as clean lines */
    for (let i = 0; i < 4; i++) {
      const onLower = rand() < 0.5;
      growFilament(marginX + rand() * (width - marginX * 2), onLower ? lowerY : upperY,
                   (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.5,
                   Math.round((width * (0.10 + rand() * 0.14)) / stepLen),
                   1.0 + rand() * 0.6, 0.75, 1, queue, webStyle);
    }
  } else { // 'web'
    drawHalo(0.04, 0.05);

    /*
     * Several small centres, each throwing out short rays: the mesh of a dense
     * charge layer rather than one flash with a single origin.
     */
    const centres = 4 + Math.floor(rand() * 3);           // 4..6
    for (let c = 0; c < centres; c++) {
      const ox = clamp(cx + (rand() - 0.5) * width * 0.74, marginX, width - marginX);
      const oy = clamp(cy + (rand() - 0.5) * band * 0.85, bandLo, bandHi);
      const rays = 3 + Math.floor(rand() * 3);            // 3..5
      for (let r = 0; r < rays; r++) {
        const ang = (r / rays) * Math.PI * 2 + (rand() - 0.5) * 0.85;
        const len = Math.round((width * (0.05 + rand() * 0.09)) / stepLen);
        growFilament(ox, oy, ang, len, 1.3 + rand() * 0.9, 0.85, 1, queue, webStyle);
      }
    }

    /* a couple of long filaments tie the mesh together */
    for (let i = 0; i < 2; i++) {
      growFilament(clamp(cx + (rand() - 0.5) * width * 0.45, marginX, width - marginX),
                   clamp(cy + (rand() - 0.5) * band * 0.55, bandLo, bandHi),
                   rand() < 0.5 ? 0 : Math.PI,
                   Math.round((width * (0.22 + rand() * 0.14)) / stepLen),
                   1.1 + rand() * 0.5, 0.70, 1, queue, webStyle);
    }
  }

  /* --- process forks (breadth first keeps all primary strokes first) --- */
  let guard = 0;
  while (queue.length && guard++ < 520) {
    const fork = queue.shift();
    growFilament(fork.x, fork.y, fork.ang, fork.len, fork.w, fork.gain, fork.depth, queue, fork.st || spiderStyle);
  }

  ctx.globalAlpha = 1.0;
  return canvas.transferToImageBitmap();
}
