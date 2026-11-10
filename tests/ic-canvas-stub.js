/*
 * A tiny, deterministic stand-in for the 2d canvas that lightningGenerator.js
 * draws its intra-cloud artwork on.
 *
 * The point of this file is that the IC artwork can be rendered and measured by
 * `node tests/check-ic-lightning.js` without a browser: the generator is the real
 * one, only the canvas underneath it is replaced. Strokes are rasterised with an
 * analytic coverage (a pixel is covered by the part of the stroke within half a
 * pixel of it), which is what a browser's antialiased line drawing does, and the
 * two composite modes the generator uses are honoured:
 *
 *   'lighten'     the pixel keeps the brighter of what was there and the stroke
 *   'source-over' the stroke is laid over the pixel by its coverage
 *
 * Everything the level designer can see is a byte, so the buffer is stored as
 * floats and handed out as bytes by transferToImageBitmap(), exactly like the
 * Uint8ClampedArray of a real R8 canvas.
 */

'use strict';

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 1e-9 ? ((px - x0) * dx + (py - y0) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  const cx = x0 + dx * t;
  const cy = y0 + dy * t;
  return Math.hypot(px - cx, py - cy);
}

class StubContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.buffer = new Float64Array(this.width * this.height); // 0 .. 1 luminance
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.strokeStyle = '#000';
    this.fillStyle = '#000';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this._path = [];
    this.strokeCount = 0;
    this.segmentCount = 0;
    this.lineWidths = [];
  }

  clearRect() { this.buffer.fill(0); }

  beginPath() { this._path = []; }
  moveTo(x, y) { this._path.push([x, y]); }
  lineTo(x, y) { this._path.push([x, y]); }
  closePath() { /* not used by the generator */ }

  _tone() {
    const style = String(this.strokeStyle).trim();
    const rgb = style.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb)
      return clamp(Number(rgb[1]) / 255, 0, 1);
    const hex = style.match(/^#([0-9a-f]{6})$/i);
    if (hex)
      return parseInt(hex[1].slice(0, 2), 16) / 255;
    if (style === 'white') return 1;
    if (style === 'black') return 0;
    throw new Error('unsupported strokeStyle: ' + style);
  }

  stroke() {
    const pts = this._path;
    if (pts.length < 2) return;
    const tone = this._tone();
    const alpha = clamp(this.globalAlpha, 0, 1);
    const mode = this.globalCompositeOperation;
    this.strokeCount++;
    this.lineWidths.push(this.lineWidth);
    for (let i = 1; i < pts.length; i++) {
      this.segmentCount++;
      this._segment(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1],
                    this.lineWidth, tone, alpha, mode);
    }
    this._path = [];
  }

  _segment(x0, y0, x1, y1, width, tone, alpha, mode) {
    const halfWidth = Math.max(0.5, width) * 0.5;
    const reach = halfWidth + 0.75;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + reach));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - reach));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + reach));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d = distanceToSegment(x + 0.5, y + 0.5, x0, y0, x1, y1);
        const coverage = clamp(halfWidth + 0.5 - d, 0, 1) * alpha;
        if (coverage <= 0) continue;
        const index = y * this.width + x;
        const source = tone * coverage;
        if (mode === 'lighten')
          this.buffer[index] = Math.max(this.buffer[index], source);
        else
          this.buffer[index] = source + this.buffer[index] * (1 - coverage);
      }
    }
  }

  /* Unused by the generator but present so a future call cannot silently no-op. */
  save() {} restore() {} translate() {} scale() {}
}

class StubCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._context = new StubContext(this);
  }

  getContext(kind) {
    if (kind !== '2d') throw new Error('only a 2d context exists');
    return this._context;
  }

  /* What the worker posts back: an 8-bit, single channel picture. */
  transferToImageBitmap() {
    const { buffer, width, height, strokeCount, segmentCount } = this._context;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < data.length; i++)
      data[i] = Math.round(clamp(buffer[i], 0, 1) * 255);
    return {
      width : width,
      height : height,
      data : data,
      strokeCount : strokeCount,
      segmentCount : segmentCount,
      close() {}
    };
  }
}

/* Install the globals the worker expects, and return a function that puts the
 * previous globals back. */
function installOffscreenCanvas() {
  const previous = global.OffscreenCanvas;
  global.OffscreenCanvas = class extends StubCanvas {};
  return () => {
    if (previous === undefined) delete global.OffscreenCanvas;
    else global.OffscreenCanvas = previous;
  };
}

module.exports = { StubCanvas, StubContext, installOffscreenCanvas, clamp };
