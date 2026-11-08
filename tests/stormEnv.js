/* Shared synthetic storm environment for stormsim tests/debug (Node only). */
'use strict';

/**
 * Synthetic thunderstorm-cell environment:
 *  - domain 40 km x 12 km, lapse-rate stratification
 *  - Gaussian updraft core (up to ~28 m/s) with downdraft flanks
 *  - saturated cloudy layer 1.2-10.8 km over the core
 *  - precipitation seeding aloft to bootstrap graupel
 * Units mirror what the app feeds stormsim.js (velocities in cells/iteration).
 */
function buildStormEnv() {
  const cellSizeM = 40, iterSeconds = 0.288;
  const wCells = 1000, hCells = 300;         // 40 km x 12 km
  const nx = 64, ny = 64;
  const widthM = wCells * cellSizeM, heightM = hCells * cellSizeM;
  const vx = new Float32Array(nx * ny), vy = new Float32Array(nx * ny);
  const tK = new Float32Array(nx * ny), vapor = new Float32Array(nx * ny);
  const cloud = new Float32Array(nx * ny), precip = new Float32Array(nx * ny);
  const wall = new Uint8Array(nx * ny);

  const T0 = 288.15, lapse = 6.5;
  const tropoM = 11000;

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      const i = ix * ny + iy;
      const xm = (ix + 0.5) / nx * widthM, ym = (iy + 0.5) / ny * heightM;
      tK[i] = Math.max(T0 - lapse * ym / 1000, 211);
      const dxc = (xm - widthM / 2) / (widthM * 0.16);
      const updraftMask = Math.exp(-dxc * dxc);
      // updraft peaks mid-storm and decays into the anvil above ~9 km so
      // hydrometeors sediment realistically instead of pooling at the ceiling
      const vertShape = (Math.sin(Math.PI * Math.min(ym / (tropoM * 1.15), 1.0)) ** 2) *
        (ym > 8500 ? Math.exp(-(ym - 8500) / 1600) : 1.0);
      const up = 28.0 * updraftMask * vertShape;
      const downArg = (Math.abs(xm - widthM / 2) - widthM * 0.16) / (widthM * 0.07);
      const down = -6.0 * Math.exp(-(downArg * downArg)) * vertShape;
      vy[i] = (up + down) / (cellSizeM / iterSeconds);
      vx[i] = 0.6 * Math.sin(ym / 2000) / (cellSizeM / iterSeconds);
      const inCloud = updraftMask > 0.18 && ym > 1200 && ym < 10800;
      cloud[i] = inCloud ? (0.8 + 1.6 * updraftMask * Math.min(1, ym / 7000)) : 0.02;
      const satW = Math.pow(Math.min(tK[i] / 250, 4), 17);
      vapor[i] = satW * (inCloud ? 1.04 : (ym < 1200 ? 0.7 : 0.35));
      precip[i] = inCloud && updraftMask > 0.5 && ym > 4000 && ym < 9000 ? 0.25 : 0.0;
      wall[i] = 0;
    }
  }
  for (let ix = 0; ix < nx; ix++) wall[ix * ny + 0] = 1;

  return {nx, ny, wCells, hCells, cellSizeM, iterSeconds, vx, vy, tK, vapor, cloud, precip, wall};
}

module.exports = {buildStormEnv};
