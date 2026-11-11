/*
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details. You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

function updateSetupSliders()
{
  let simResX = parseInt(simResSelX.value);
  let simResY = parseInt(simResSelY.value);
  let simHeight = parseInt(simHeightSel.value);

  let cellHeight = simHeight / simResY;
  let simWidth = cellHeight * simResX;

  document.getElementById('simWorldProperties').innerHTML = 'cellHeight: ' + cellHeight.toFixed(1) + ' m  &nbsp&nbsp&nbsp   Simulation width: ' + (simWidth / 1000).toFixed(1) + ' km';

  document.getElementById('simHeightWarning').style.display = (simHeight == 12000) ? 'none' : 'block';
  document.getElementById('simResYWarning').style.display = (simResY == 300) ? 'none' : 'block';
  document.getElementById('simResShowX').value = simResX;
  document.getElementById('simResShowY').value = simResY
  document.getElementById('simHeightShow').value = simHeight + ' m';
  document.querySelectorAll('#startBtn input[type="range"]').forEach((slider) => {
    const min = Number(slider.min);
    const max = Number(slider.max);
    const value = Number(slider.value);
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--range-progress', `${progress}%`);
  });
  updatePerformanceEstimate(simResX, simResY);
}

function updatePerformanceEstimate(simResX, simResY)
{
  const estimate = document.getElementById('performanceEstimate');
  if (!estimate)
    return;

  const cellCount = simResX * simResY;
  const deviceMemory = navigator.deviceMemory;
  const logicalCores = navigator.hardwareConcurrency;
  const memoryBudget = Number.isFinite(deviceMemory)
    ? clamp(deviceMemory * 350000, 1000000, 4200000)
    : 1500000;
  const coreBudget = Number.isFinite(logicalCores)
    ? clamp(logicalCores * 250000, 1000000, 2500000)
    : 1500000;
  const estimatedCapacity = Math.min(memoryBudget, coreBudget);
  const workloadRatio = cellCount / estimatedCapacity;
  const level = workloadRatio <= 0.7 ? 'good'
    : workloadRatio <= 1.25 ? 'moderate'
    : workloadRatio <= 2 ? 'challenging'
    : 'demanding';
  const labels = {
    good : 'Should run smoothly',
    moderate : 'Moderate workload',
    challenging : 'May run slowly',
    demanding : 'Very demanding'
  };
  const deviceDetails = [
    Number.isFinite(deviceMemory) ? `about ${deviceMemory} GB memory` : null,
    Number.isFinite(logicalCores) ? `${logicalCores} logical CPU cores` : null
  ].filter(Boolean);

  estimate.dataset.level = level;
  estimate.querySelector('[data-performance-estimate-label]').textContent = labels[level];
  estimate.querySelector('[data-performance-estimate-details]').textContent =
    `${cellCount.toLocaleString()} simulation cells` +
    (deviceDetails.length ? ` · browser reports ${deviceDetails.join(' and ')}` : ' · device details unavailable');
}

function showNewSimulationSetup()
{
  const menu = document.getElementById('mainMenuContent');
  const setup = document.getElementById('mainMenuSetup');
  const form = document.getElementById('startBtn');
  if (!menu || !setup || !form)
    return;

  setup.insertBefore(form, document.getElementById('performanceEstimate'));
  menu.classList.add('is-configuring');
  setup.setAttribute('aria-hidden', 'false');
  updateSetupSliders();
}

var FPS = 60.0;


function mixGeneric(a, b, t, {clamp = false} = {})
{
  const clampT = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  if (typeof a === 'number' && typeof b === 'number') {
    const tt = clamp ? clampT(t) : t;
    return a * (1 - tt) + b * tt;
  }

  // arrays / typed arrays
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    if (!Array.isArray(b) && !ArrayBuffer.isView(b))
      throw new TypeError('mismatched types');
    if (a.length !== b.length)
      throw new RangeError('length mismatch');
    const out = new (Array.isArray(a) ? Array : a.constructor)(a.length);
    for (let i = 0; i < a.length; i++) {
      const tt = clamp ? clampT(t[i] ?? t) : (Array.isArray(t) ? t[i] ?? t : t);
      out[i] = a[i] * (1 - tt) + b[i] * tt;
    }
    return out;
  }

  // vector-like object with same keys
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    for (const k of Object.keys(a)) {
      if (typeof a[k] === 'number' && typeof b[k] === 'number') {
        const tt = clamp ? clampT(t[k] ?? t) : (t && typeof t === 'object' ? (t[k] ?? t) : t);
        out[k] = a[k] * (1 - tt) + b[k] * tt;
      }
    }
    return out;
  }

  throw new TypeError('Unsupported types for mixGeneric');
}

const corsUrl = 'https://my-cors-proxy.nielsdaemen747.workers.dev/?url='; // my own proxy worker on cloudfare

async function getSoundingGraphImgUrl(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    if (!response.ok)
      throw new Error(`Sounding graph request failed with HTTP ${response.status}`);

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const img = doc.querySelectorAll('img')[0];
    const imageSrc = img && img.getAttribute('src');
    if (!imageSrc)
      throw new Error('Sounding graph image was not found in the response');

    return new URL(imageSrc, 'https://www.meteociel.fr/').href;
  } catch (error) {
    console.error('Error fetching the data:', error);
    return null;
  }
}

// Function to scrape table data from the given URL
async function scrapeTableData(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    if (!response.ok)
      throw new Error(`Sounding data request failed with HTTP ${response.status}`);

    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Select the rows of the main table (starting at line 51)
    const rows = doc.querySelectorAll('table:nth-of-type(2) tr:not(:first-child)');

    const tableData = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 7)
        return;

      const rowData = {
        alt : parseFloat(cells[0].textContent),
        p : parseFloat(cells[1].textContent),
        t : parseFloat(cells[2].textContent),
        tw : parseFloat(cells[3].textContent),
        td : parseFloat(cells[4].textContent),
        rh : parseFloat(cells[5].textContent),
        vel : parseFloat(cells[6].textContent.split(' / ')[1]),
        angle : parseFloat(cells[6].textContent.split(' / ')[0]),
      };

      const hasNaN = Object.values(rowData).some(v => Number.isNaN(v));

      if (!hasNaN) // discard if the row contains any NaN
        tableData.push(rowData);
    });
    return tableData;

  } catch (error) {
    console.error('Error fetching the data:', error);
    return [];
  }
}

async function loadSounding(stationID, timeStamp, requestId)
{

  const imgMapType = 1; // 0 = large classic emagram   1 = small emagram
  const graphPageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=' + imgMapType + '&date=' + timeStamp;
  const tablePageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=4&date=' + timeStamp;

  const soundingGraphImgUrl = await getSoundingGraphImgUrl(graphPageUrl);
  if (requestId !== soundingRequestId)
    return null;

  const soundingImgEl = document.getElementById('soundingPreview');
  if (soundingGraphImgUrl)
    soundingImgEl.src = soundingGraphImgUrl;
  else
    soundingImgEl.removeAttribute('src');

  // console.log(graphPageUrl, SoundingGraphImgUrl, tablePageUrl);

  return scrapeTableData(tablePageUrl);
}

function sampleIsInvalid(s)
{
  return !s || !Number.isFinite(s.alt) || !Number.isFinite(s.t) || !Number.isFinite(s.td) ||
    !Number.isFinite(s.vel) || !Number.isFinite(s.angle);
}

function rawSoundingToSimSounding(soundingData, simHeight, inSimSoundingRes)
{
  const validSoundingData = soundingData
    .filter(sample => !sampleIsInvalid(sample))
    .sort((a, b) => a.alt - b.alt);
  if (validSoundingData.length == 0)
    throw new Error('The sounding profile contains no valid samples.');

  const soundingForSim = [];
  let soundingDataIndex = 0;

  for (let y = 0; y < inSimSoundingRes; y++) {

    const inSimAlt = y * (simHeight / sim_res_y);

    while (soundingDataIndex < validSoundingData.length - 1 &&
           validSoundingData[soundingDataIndex].alt < inSimAlt) {
      soundingDataIndex++;
    }

    const sampleAboveOrEqual = validSoundingData[soundingDataIndex];
    const sampleBelow = validSoundingData[Math.max(soundingDataIndex - 1, 0)];
    let sample = sampleAboveOrEqual;
    if (sampleAboveOrEqual.alt != sampleBelow.alt &&
        inSimAlt > sampleBelow.alt && inSimAlt < sampleAboveOrEqual.alt) {
      const interpolation = (inSimAlt - sampleBelow.alt) /
        (sampleAboveOrEqual.alt - sampleBelow.alt);
      sample = mixGeneric(sampleBelow, sampleAboveOrEqual, interpolation);
    }

    const twoDimentionalVel = sample.vel * Math.cos(sample.angle * degToRad); // km/h

    const inSimVel = msToRawVelocity(twoDimentionalVel / 3.6); // convert to m/s first

    soundingForSim[y] = {'t' : sample.t, 'td' : sample.td, 'vel' : inSimVel};
  }

  return soundingForSim;
}

var stationSelector;

const presets = [
  {name : 'Summer storms in northern Italy', location : 'Milan', date : '2025-06-05', hour : 12}, {name : 'Some cells in the Netherlands', location : 'Essen', date : '2016-06-23', hour : 12},
  {name : 'Supercell in the Netherlands', location : 'De Bilt', date : '2014-06-09', hour : 12}, {name : 'Cold winter on Gotland', location : 'Gotland', date : '2025-01-03', hour : 12},
  {name : 'Spring cells in Germany', location : 'Stuttgart', date : '2021-06-09', hour : 12}, {name : 'Hot summer in Spain', location : 'Madrid', date : '2018-07-07', hour : 12},
  {name : 'Double inversion over Sicily', location : 'Sicily', date : '2021-07-14', hour : 12}, {name : 'Low base with CAPE in Rome', location : 'Rome', date : '2021-07-16', hour : 12},
  {name : 'High low level cape over mediterranean in fall', location : 'Ajaccio', date : '2025-10-23', hour : 12}
];

var startDate;
var startLatitude;

function createPresetSelect()
{
  let select = document.getElementById('presetSelect');

  //  console.log(presets);

  presets.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = preset.name;
    select.appendChild(option);
  });
  select.value = -1;

  select.onchange = function() {
    const presetIndex = Number(select.value);
    if (select.value === '' || !Number.isInteger(presetIndex))
      return;
    const preset = presets[presetIndex];
    if (!preset)
      return;
    const station = soundingStations[preset.location];
    if (!station)
      throw new Error(`Unknown sounding station in preset: ${preset.location}`);

    document.getElementById('datePicker').value = preset.date;

    startDate = new Date(preset.date + 'T00:00:00');

    document.getElementById('hourSelector').value = preset.hour;

    stationSelector.value = station.id;
    stationSelector.dispatchEvent(new Event('change', {bubbles : true}));
  };
}

const soundingStations = {
  'Andoya' : {id : 1010, lat : 69.1144},
  'Lapland' : {id : 2836, lat : 67.4160},
  'Iceland' : {id : 4018, lat : 64.9631},
  'Trondheim' : {id : 1241, lat : 63.4305},
  'Helsinki' : {id : 2963, lat : 60.1699},
  'Stavanger' : {id : 1415, lat : 58.9700},
  'Gotland' : {id : 2591, lat : 57.6359},
  'North Sea' : {id : 1400, lat : 56.5333},
  'Moscow' : {id : 27730, lat : 55.7558},
  'Gdańsk' : {id : 12120, lat : 54.3520},
  'Greifswald' : {id : 10184, lat : 54.0833},
  'Norderney' : {id : 10113, lat : 53.7000},
  'Hamburg' : {id : 10035, lat : 53.5507},
  'Nottingham' : {id : 3354, lat : 52.9500},
  'Bergen(DE)' : {id : 10238, lat : 52.8092},
  'Meppen' : {id : 10304, lat : 52.7928},
  'Berlin' : {id : 10393, lat : 52.5235},
  'Warsaw' : {id : 12374, lat : 52.2297},
  'De Bilt' : {id : 6260, lat : 52.1085},
  'Essen' : {id : 10410, lat : 51.4556},
  'Wroclaw' : {id : 12425, lat : 51.1079},
  'Brussels' : {id : 6458, lat : 50.8371},
  'Meiningen' : {id : 10548, lat : 50.5678},
  'Kraków' : {id : 12575, lat : 50.0647},
  'Idar-Oberstein' : {id : 10618, lat : 49.7167},
  'Nuremberg' : {id : 10771, lat : 49.4521},
  'Paris' : {id : 7145, lat : 48.8567},
  'Stuttgart' : {id : 10739, lat : 48.7758},
  'Brest' : {id : 7110, lat : 48.3900},
  'Vienna' : {id : 11035, lat : 48.2092},
  'Altenstadt' : {id : 10954, lat : 48.3556},
  'Munich' : {id : 10868, lat : 48.1333},
  'peißenberg' : {id : 10962, lat : 47.7975},
  'Insbruck' : {id : 11120, lat : 47.2692},
  'Bern' : {id : 6610, lat : 46.9480},
  'Udine' : {id : 16045, lat : 46.0713},
  'Zagreb' : {id : 14240, lat : 45.8150},
  'Milan' : {id : 16064, lat : 45.4642},
  'Bordeaux' : {id : 7510, lat : 44.8378},
  'Bologna' : {id : 16144, lat : 44.4968},
  'Bucharest' : {id : 15420, lat : 44.4268},
  'Cuneo' : {id : 16113, lat : 44.3843},
  'Zadar' : {id : 14430, lat : 44.1194},
  'Montpellier' : {id : 7645, lat : 43.6119},
  'Barcelona' : {id : 8190, lat : 41.3851},
  'Ajaccio' : {id : 7761, lat : 41.9192},
  'Rome' : {id : 16245, lat : 41.9028},
  'Istanbul' : {id : 17064, lat : 41.0082},
  'Madrid' : {id : 8221, lat : 40.4168},
  'Sardinia' : {id : 16546, lat : 40.1209},
  'Lisbon' : {id : 8536, lat : 38.7223},
  'Athens' : {id : 16716, lat : 37.9792},
  'Sicily' : {id : 16429, lat : 37.6000},
  'Krete' : {id : 16754, lat : 35.2401},
  'Cyprus' : {id : 17607, lat : 35.1264},
  'Palestine' : {id : 40179, lat : 32.0853},
  'Cairo' : {id : 62378, lat : 30.0444},
};

function createStationSelect()
{
  let select = document.getElementById('stationSelect');

  for (const [key, value] of Object.entries(soundingStations)) {
    let option = document.createElement('option');
    option.value = value.id;
    option.innerHTML = key + ' ' + value.lat.toFixed(1) + '° N';
    select.appendChild(option);
  }
  select.value = 10868;

  select.onchange = function() {
    const station = Object.values(soundingStations)[select.selectedIndex];
    if (!station)
      throw new Error('The selected sounding station is not available.');
    startLatitude = station.lat;
    prepareSounding();
  };

  let datePicker = document.getElementById('datePicker');
  datePicker.onchange = function() {
    startDate = datePicker.value ? new Date(datePicker.value + 'T00:00:00') : null;
    prepareSounding();
  };

  return select;
}


// Ensure the DOM is fully loaded before running the function
document.addEventListener('DOMContentLoaded', () => {
  createPresetSelect();
  stationSelector = createStationSelect();
  prepareSounding();
});


var canvas;
var gl;

var clockEl;
var clockFpsEl;

var simDateTime;

var SETUP_MODE = false;

var loadingBar;
var cam;
var soundSystem;

const PI = 3.14159265359;
const degToRad = 0.0174533;
const radToDeg = 57.2957795;
const kmToMil = 0.62137;
const mToFt = 3.28084;

const saveFileVersionID = 263574036; // Uint32 id to check if save file is compatible

const guiControls_default = {
  vorticity : 0.005,
  dragMultiplier : 0.001, // 0.01
  wind : 0.0,
  globalEffectsStartAlt : 0,
  globalEffectsEndAlt : 10000,
  globalDrying : 0.000000, // 0.000010
  globalHeating : 0.0,
  soundingForcing : 0.0,
  sunIntensity : 1.0,
  waterTemperature : 25.0, // °C
  dynamicWaterTemperature : true,
  landEvaporation : 0.00005,
  waterEvaporation : 0.0001,
  evapHeat : 2.90,          //  Real: 2260 J/g
  meltingHeat : 0.43,       //  Real:  334 J/g
  condensationRate : 0.0050,
  waterWeight : 0.25,       // 0.50
  inactiveDroplets : 0,
  aboveZeroThreshold : 1.0, // PRECIPITATION
  subZeroThreshold : 0.005, // 0.01
  spawnChance : 0.00005,    // 30. 10 to 50
  snowDensity : 0.2,        // 0.3
  fallSpeed : 0.0003,
  growthRate0C : 0.0001,    // 0.0005
  growthRate_30C : 0.001,   // 0.01
  freezingRate : 0.01,
  meltingRate : 0.01,
  evapRate : 0.0008, // 0.0005
  displayMode : 'DISP_REAL',
  wrapHorizontally : true,
  SmoothCam : true,
  camSpeed : 0.01,
  exposure : 1.0,
  timeOfDay : 9.9,
  latitude : 45.0,
  month : 6.65, // Northern hemisphere summer solstice
  sunAngle : 9.9,
  dayNightCycle : true,
  accelerateNight : true,
  greenhouseGases : 0.0010,
  waterGreenHouseEffect : 0.0023,
  IR_rate : 1.0,
  tool : 'TOOL_NONE',
  brushSize : 20,
  plantGrowth : true,
  showPlants : true,
  wholeWidth : false,
  wholeWidthBrushWidth : 100,
  brushIntensity : 0.01,
  windPushStrengthMph : 50,
  windPushDirection : 'right',
  windPushSetTemperature : false,
  windPushAirTemperatureC : 15,
  windPushSetHumidity : false,
  windPushRelativeHumidity : 60,
  allowCaves : true,
  showGraph : false,
  realDewPoint : false, // show real dew point in graph, instead of dew point with cloud water included
  enablePrecipitation : true,
  showDrops : false,
  paused : false,
  IterPerFrame : 10,
  auto_IterPerFrame : true,
  autoFpsTarget : '120',
  performancePreset : 'Extreme',
  hdrQuality : '100%',
  bloomQuality : '100%',
  bloomEnabled : true,
  filmicToneMapping : false,
  fxaaEnabled : false,
  volumetricCloudLighting : true,
  temporalAAEnabled : false,
  showWeatherStations : true,
  shareWeatherDataToLan : false,
  sound : true,
  dryLapseRate : 10.0,     // Real: 9.8 degrees / km
  simHeight : 12000,       // meters
  twelveHourClock : false, // only for display.  false = metric
  lengthUnit : 'LENGTH_UNIT_METRIC',
  tempUnit : 'TEMP_UNIT_C',
  speedUnit : 'SPEED_UNIT_KMH',
};

var horizontalDisplayMult = 3.0; // 3.0 to cover srceen while zoomed out

var guiControls;
var windPushControlsVisibilityUpdater = function() {};

function setBrushCursor(program, cursorType, cursorX, cursorY)
{
  cursorX = guiControls.wrapHorizontally ? mod(cursorX, 1.0) : clamp(cursorX, 0.0, 1.0);
  gl.uniform4f(gl.getUniformLocation(program, 'cursor'), cursorX, cursorY, guiControls.brushSize * 0.5, cursorType);
  gl.uniform1f(gl.getUniformLocation(program, 'wholeWidthBrushWidth'), guiControls.wholeWidthBrushWidth * 0.01);
  gl.uniform1f(gl.getUniformLocation(program, 'windPushWidth'), guiControls.wholeWidthBrushWidth * 0.01);
  gl.uniform1f(gl.getUniformLocation(program, 'windPushDepth'), guiControls.brushSize / sim_res_y);
  gl.uniform1i(gl.getUniformLocation(program, 'cursorWrapHorizontally'), guiControls.wrapHorizontally);
}

var displayVectorField = false;

var displayWeatherStations = true;

var sunIsUp = true;

var airplaneMode = false;

var dropletFollowID = -1;

var minShadowLight = 0.02;

var saveFileName = '';

var guiControlsFromSaveFile = null;
var datGui;

var sim_res_x;
var sim_res_y;
var sim_aspect; //  = sim_res_x / sim_res_y
var sim_height = 12000;

var cellHeight = 12000. / 300.; // guiControls.simHeight / sim_res_y;  // in meters // cell width is the same

var frameNum = 0;
var lastClockContrastSampleTime = -Infinity;
const sceneContrastSamples = new Uint8Array(9 * 9 * 4);
function interpolateTextColor(fromColor, toColor, progress)
{
  const t = clamp(progress, 0, 1);
  const easedT = t * t * (3 - 2 * t);
  const from = [1, 3, 5].map(index => parseInt(fromColor.slice(index, index + 2), 16));
  const to = [1, 3, 5].map(index => parseInt(toColor.slice(index, index + 2), 16));
  const channels = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * easedT).toString(16).padStart(2, '0')
  );
  return '#' + channels.join('');
}

function getSceneContrastTextColor(screenX, screenY)
{
  if (!gl || !canvas || gl.isContextLost() || canvas.width < 1 || canvas.height < 1)
    return '#ffffff';

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0)
    return '#ffffff';

  const centerX = Math.floor((screenX - bounds.left) * canvas.width / bounds.width);
  const centerY = Math.floor((screenY - bounds.top) * canvas.height / bounds.height);
  const sampleSize = Math.min(9, canvas.width, canvas.height);
  const x = clamp(centerX - Math.floor(sampleSize / 2), 0, canvas.width - sampleSize);
  const y = clamp(canvas.height - centerY - Math.floor(sampleSize / 2) - 1, 0, canvas.height - sampleSize);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readBuffer(gl.BACK);
  gl.readPixels(x, y, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, sceneContrastSamples);

  let luminanceSum = 0;
  const sampleLength = sampleSize * sampleSize * 4;
  for (let i = 0; i < sampleLength; i += 4) {
    const r = sceneContrastSamples[i] / 255;
    const g = sceneContrastSamples[i + 1] / 255;
    const b = sceneContrastSamples[i + 2] / 255;
    const linearR = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    const linearG = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    const linearB = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    luminanceSum += 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
  }

  return luminanceSum / (sampleSize * sampleSize) > 0.43 ? '#111820' : '#ffffff';
}
var lastFrameNum = 0;

var iterNum = 0;
var pauseController = null;
const depositionMassToWaterMm = 0.1; // Matches the shader calibration; particle mass has no kg unit.
const rainGaugeBucketCapacityMm = 0.2;
const rainGaugeRateWindowMinutes = 10;
const rainGaugeMeasurableIntervalMm = 0.01;
const stationCloudCoverRadiusCells = 10;
var weatherStationSamplingBuffers = {
  base : new Float32Array(0),
  water : new Float32Array(0),
  light : new Float32Array(0),
  cloudWater : new Float32Array(0),
  cloudWalls : new Int8Array(0),
  rainRegions : []
};
var plantEnvironmentSamplingBuffers = {
  walls : new Int8Array(0),
  base : new Float32Array(0),
  water : new Float32Array(0)
};

function readRgbaChannel(data, pixelOffset, channel)
{
  return pixelOffset < 0 ? 0 : data[pixelOffset + channel];
}

// global framebuffers for measurements
var frameBuff_0;
var lightFrameBuff_0;
var precipitationFeedbackFrameBuff;

var dryLapse;


const timePerIteration = 0.00008; // in hours (0.00008 = 0.288 sec, at 40m cell size that means the speed of light & sound = 138.88 m/s = 500 km/h)

var NUM_DROPLETS;
const NUM_DROPLETS_DEVIDER = 25; // 25

let hdrFBO;
let temporalHistoryTexture;
let temporalHistoryValid = false;
let temporalPreviousView = null;
let temporalPreviousDisplayMode = null;
let capeColumnFBO;

let bloomFBOs = [];

let ambientLightFBOs = [];
let emittedLightFBO;
let hdrRenderScale = 0.75;
let bloomRenderScale = 0.5;


function clamp(num, min, max) { return Math.min(Math.max(num, min), max); }

function screenToSimX(screenX)
{
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(screenX, leftEdge, rightEdge, 0.0, 1.0) - cam.curXpos / 2.0;
}

function screenToSimY(screenY)
{
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(screenY, bottemEdge, topEdge, 0.0, 1.0) - (cam.curYpos / 2.0) * sim_aspect;
}

function simToScreenX(simX)
{
  simX += 0.5;
  simX /= sim_res_x;
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(simX + cam.curXpos / 2.0, 0.0, 1.0, leftEdge, rightEdge);
}

function simToScreenY(simY)
{
  simY += 0.5; // center in cell
  simY /= sim_res_y;
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(simY + (cam.curYpos / 2.0) * sim_aspect, 0.0, 1.0, bottemEdge, topEdge);
}

function download(filename, data)
{
  var url = URL.createObjectURL(data);
  const element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  try {
    element.click();
  } finally {
    element.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Universal Functions

function mod(a, b)
{
  // proper modulo to handle negative numbers
  return ((a % b) + b) % b;
}

function map_range(value, low1, high1, low2, high2) { return low2 + ((high2 - low2) * (value - low1)) / (high1 - low1); }

function map_range_C(value, low1, high1, low2, high2) { return clamp(low2 + ((high2 - low2) * (value - low1)) / (high1 - low1), Math.min(low2, high2), Math.max(low2, high2)); }

// Temperature Functions

function CtoK(C) { return C + 273.15; }

function KtoC(K) { return K - 273.15; }

function CtoF(C) { return C * 1.8 + 32.0; }


function dT_saturated(dTdry, dTl)
{
  // dTl = temperature difference because of latent heat
  // if (dTl == 0.0)
  //   return dTdry;
  //  else {
  var multiplier = dTdry / (dTdry - dTl);
  return dTdry * multiplier;
  // }
}

const IR_constant = 5.670374419; // ×10−8

function IR_emitted(T)
{
  return Math.pow(T * 0.01, 4) * IR_constant; // Stefan–Boltzmann law
}

function IR_temp(IR)
{
  // inversed Stefan–Boltzmann law
  return Math.pow(IR / IR_constant, 1.0 / 4.0) * 100.0;
}

////////////// Water Functions ///////////////
const wf_devider = 250.0;
const wf_pow = 17.0;

function maxWater(Td)
{
  return Math.pow(Td / wf_devider,
                  wf_pow); // w = ((Td)/(250))^(18) // Td in Kelvin, w in grams per m^3
}

function dewpoint(W)
{
  //  if (W < 0.00001) // can't remember why this was here...
  //    return 0.0;
  //  else
  return wf_devider * Math.pow(W, 1.0 / wf_pow);
}

function relativeHumd(T, W) { return (W / maxWater(T)) * 100.0; }

// Print funtions:

function convertTempToSelectedUnit(tempC)
{
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempC;
  case 'TEMP_UNIT_F':
    return CtoF(tempC);
  case 'TEMP_UNIT_K':
    return (tempC + 273.15);
  }
}

function printTemp(tempC)
{
  let tempStr = convertTempToSelectedUnit(tempC).toFixed(1);
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempStr + '°C';
  case 'TEMP_UNIT_F':
    return tempStr + '°F';
  case 'TEMP_UNIT_K':
    return tempStr + ' K';
  }
}

function mmToIn(mm) { return mm * 0.393701; }

function msToKnots(ms) { return ms * 1.94384; };

function msToMPH(ms) { return ms * 2.23694; };

function knotsToMs(kt) { return kt * 0.514444; };

function printSnowHeight(snowHeight_cm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(snowHeight_cm).toFixed(1) + '"'; // inches
  } else
    return snowHeight_cm.toFixed(1) + ' cm';
}

function printSoilMoisture(soilMoisture_mm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(soilMoisture_mm).toFixed(1) + '"'; // inches
  } else
    return soilMoisture_mm.toFixed(1) + ' mm';
}


function printDistance(m)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let miles = m * kmToMil / 1000;
    let ft = m * mToFt;
    return miles < 1.0 ? ft.toFixed(0) + ' ft' : miles.toFixed(1) + ' miles';
  } else {
    let km = m / 1000;
    return m < 1000 ? m.toFixed(0) + ' m' : km.toFixed(1) + ' km';
  }
}

function printAltitude(meters)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let feet = meters * mToFt;
    return feet.toFixed() + ' ft';
  } else
    return meters.toFixed() + ' m';
}

function convertVelocityToSelectedUnit(ms)
{
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return ms * 3.6;
  case 'SPEED_UNIT_MS':
    return ms;
  case 'SPEED_UNIT_MPH':
    return msToMPH(ms);
  case 'SPEED_UNIT_KT':
    return msToKnots(ms);
  }
}

function printVelocity(ms)
{
  let velStr = convertVelocityToSelectedUnit(ms).toFixed();
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return velStr + ' km/h';
  case 'SPEED_UNIT_MS':
    return velStr + ' m/s';
  case 'SPEED_UNIT_MPH':
    return velStr + ' MPH';
  case 'SPEED_UNIT_KT':
    return velStr + ' kt';
  }
}

function printVerticalVelocity(ms)
{
  let veloStr = ms >= 0. ? '+' : '';
  let unitStr = '';

  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    veloStr += (ms * 196.8504).toFixed(0);
    unitStr = ' ft/m';
  } else {
    veloStr += ms.toFixed(1);
    unitStr = ' m/s';
  }
  return [ veloStr, unitStr ];
}

function rawVelocityTo_ms(vel)
{                          // Raw velocity is in cells/iteration
  vel /= timePerIteration; // convert to cells per hour
  vel *= cellHeight;       // convert to meters per hour
  vel /= 3600.0;           // convert to m/s
  return vel;
}

function msToRawVelocity(vel)
{                          // Raw velocity is in cells/iteration
  vel *= 3600;             // convert to meters per hour
  vel /= cellHeight;       // convert to cells per hour
  vel *= timePerIteration; // convert to raw (cells per iteration)
  return vel;
}

function CtoK(c) { return c + 273.15; }

function realToPotentialT(realT, y) { return realT + (y / sim_res_y) * dryLapse; }

function potentialToRealT(potentialT, y) { return potentialT - (y / sim_res_y) * dryLapse; }


// Global Classes:

class Vec2D // simple 2D vector
{
  x;
  y;
  constructor(x = 0, y = 0)
  {
    this.x = x;
    this.y = y;
  }
  static fromAngle(angle, mag) // create vector from angle and optional magnitude
  {
    if (mag == null)
      mag = 1.0;
    let x = -Math.cos(angle) * mag;
    let y = Math.sin(angle) * mag;
    return new Vec2D(x, y);
  }

  copy() { return new Vec2D(this.x, this.y); }
  add(other)
  {
    this.x += other.x;
    this.y += other.y;
    return this;
  }
  subtract(other)
  {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }
  mult(mult)
  {
    this.x *= mult;
    this.y *= mult;
    return this;
  }
  div(div)
  {
    this.x /= div;
    this.y /= div;
    return this;
  }

  rotate(angle) // rotate vector
  {
    let newX = Math.sin(angle) * this.y + Math.cos(angle) * this.x;
    this.y = Math.cos(angle) * this.y - Math.sin(angle) * this.x;
    this.x = newX;
    return this;
  }

  mag() { return Math.sqrt(this.x * this.x + this.y * this.y); } // get magnitude of vector

  magSq() { return this.x * this.x + this.y * this.y; }          // square of magnitude

  angle()                                                        // get angle of vector
  {
    return Math.atan2(this.y, -this.x);
  }
}

class FBO // wraps texture, frambuffer and info in one
{
  width;
  height;
  texelSizeX;
  texelSizeY;
  texture;
  frameBuffer;

  constructor(w, h, internalFormat, format, type, texFilter, wrapMode_S)
  {
    this.width = w;
    this.height = h;
    gl.activeTexture(gl.TEXTURE0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texFilter);

    if (!wrapMode_S)
      wrapMode_S = gl.CLAMP_TO_EDGE;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode_S);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    this.frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.texelSizeX = 1.0 / this.width;
    this.texelSizeY = 1.0 / this.height;
  }

  dispose()
  {
    gl.deleteFramebuffer(this.frameBuffer);
    gl.deleteTexture(this.texture);
  }
}

function createHdrFBO()
{
  if (hdrFBO)
    hdrFBO.dispose();
  const width = Math.max(1, Math.floor(canvas.width * hdrRenderScale));
  const height = Math.max(1, Math.floor(canvas.height * hdrRenderScale));
  hdrFBO = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
}

function createBloomFBOs()
{
  for (const fbo of bloomFBOs)
    fbo.dispose();

  let res = new Vec2D(
    Math.max(1, Math.floor(canvas.width * bloomRenderScale)),
    Math.max(1, Math.floor(canvas.height * bloomRenderScale))
  );

  bloomFBOs.length = 0;           // empty array
  for (let i = 0; i < 100; i++) { // max bloom iterations
    let width = res.x >> i;       // right shift to devide by 2 multiple times
    let height = res.y >> i;

    //  console.log('BloomFBO', i, width, height)

    if (width < 2 || height < 2)
      break; // stop when texture resolution is 2 x 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    bloomFBOs.push(fbo);
  }
}

function createTemporalHistoryTexture()
{
  if (temporalHistoryTexture)
    gl.deleteTexture(temporalHistoryTexture);

  temporalHistoryTexture = gl.createTexture();
  if (!temporalHistoryTexture)
    throw new Error('Unable to allocate temporal anti-aliasing history texture.');

  gl.bindTexture(gl.TEXTURE_2D, temporalHistoryTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, canvas.width, canvas.height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
  temporalHistoryValid = false;
}


function createAmbientLightFBOs()
{
  emittedLightFBO = new FBO(sim_res_x, sim_res_y, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);

  let res = new Vec2D(sim_res_x, sim_res_y);

  // console.log('createAmbientLightFBOs');

  ambientLightFBOs.length = 0;   // empty array
  for (let i = 0; i < 80; i++) { // max iterations
    let width = res.x >> i;      // right shift to devide by 2 multiple times
    let height = res.y >> i;

    if (width < 2 || height < 2)
      break; // stop when texture width or height is <= 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.REPEAT);
    ambientLightFBOs.push(fbo);
  }
}

var weatherStationLayer;

function getWeatherStationLayer()
{
  if (!weatherStationLayer) {
    weatherStationLayer = document.createElement('div');
    weatherStationLayer.id = 'weatherStationLayer';
    weatherStationLayer.setAttribute('aria-label', 'Weather stations');
    document.body.appendChild(weatherStationLayer);
  }
  return weatherStationLayer;
}

var nextWeatherStationId = 1;

class Weatherstation
{
  #id = nextWeatherStationId++;
  #width = 260;
  #height = 125;
  #mainDiv;
  #menuPage = 0;
  #menuFromPage = 0;
  #menuTransitionDirection = 0;
  #menuTransitionStart = null;
  #menuTransitionDuration = 320;
  #canvas;
  #c; // 2d canvas context
  #menuHint;
  #stationMarker;
  #stationMarkerLabel;
  #x; // position in simulation
  #y;

  #isOnLand = false;
  #isOnWater = false;

  #time;             // ISO time string of moment of last measurement
  #temperature = 0;  // °C
  #dewpoint = 0;     // °C
  #relativeHumd = 0; // %
  #velocity = 0;     // ms
  #soilMoisture = 0; // mm
  #snowHeight = 0;   // cm
  #airQuality = 0;   // AQI
  #waterTemperature = 0;
  #rainRate = 0;
  #rainHistory = [];
  #rainBucketWaterMm = 0;
  #rainTipHistory = [];
  #rainIntervalMm = 0;
  #rainIntervalTips = 0;
  #lastRainMeasurementIteration;
  #hourlyRainTotal = 0;
  #dailyRainTotal = 0;
  #peakHourlyRainRate = 0;
  #rainDurationMinutes = 0;
  #nearSurfaceAirTemperature = 0;
  #previousSnowHeight = null;
  #snowDepthChangeCm = 0;
  #snowDepthChangeHistory = [];
  #snowDepthChangeLastHourCm = 0;
  #cloudCoverFraction = 0;
  #cloudOktas = 0;
  #cloudCeilingMeters = null;
  #skyCondition = 'CLR';
  #weatherIconElement;
  #textColor = '#ffffff';
  #textColorFrom = '#ffffff';
  #textColorTarget = '#ffffff';
  #textColorTransitionStartTime = -Infinity;
  #lastContrastSampleTime = -Infinity;

  #netIRpow = 0;
  #solarPower = 0;

  #chartCanvas;
  #historyChart;

  #displaySunAndIRPower;


  constructor(xIn, yIn)
  {
    this.#x = Math.floor(xIn);
    this.#y = Math.floor(yIn);
    this.#lastRainMeasurementIteration = iterNum;
    this.#mainDiv = document.createElement('div');
    this.#mainDiv.className = 'weather-station';
    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'weather-station-display';
    this.#mainDiv.appendChild(this.#canvas);
    this.#menuHint = document.createElement('div');
    this.#menuHint.className = 'weather-station-menu-hint';
    this.#menuHint.setAttribute('aria-hidden', 'true');
    this.#menuHint.innerHTML = `
      <div class="scroll-downs" aria-hidden="true">
        <div class="mousey"><div class="scroller"></div></div>
      </div>
      <span>Scroll to change menus</span>
    `;
    this.#mainDiv.appendChild(this.#menuHint);
    this.#stationMarker = document.createElement('div');
    this.#stationMarker.className = 'weather-station-marker';
    this.#stationMarker.setAttribute('aria-hidden', 'true');
    this.#stationMarker.style.left = this.#width / 2 + 'px';
    this.#mainDiv.addEventListener('mouseenter', () => this.#mainDiv.classList.add('is-hovered'));
    this.#mainDiv.addEventListener('mouseleave', () => this.#mainDiv.classList.remove('is-hovered'));
    this.#weatherIconElement = document.createElement('img');
    this.#weatherIconElement.alt = '';
    this.#weatherIconElement.setAttribute('aria-hidden', 'true');
    this.#stationMarkerLabel = document.createElement('span');
    this.#stationMarkerLabel.textContent = 'St ' + this.#id;
    this.#stationMarker.append(this.#weatherIconElement, this.#stationMarkerLabel);
    this.#mainDiv.appendChild(this.#stationMarker);
    getWeatherStationLayer().appendChild(this.#mainDiv);
    this.#canvas.height = this.#height;
    this.#canvas.width = this.#width;

    this.#mainDiv.style.position = 'absolute';
    this.#mainDiv.style.width = '0px';
    this.#mainDiv.style.height = '0px';
    this.#mainDiv.style.setProperty('--weather-station-width', this.#width + 'px');
    this.#mainDiv.style.setProperty('--weather-station-height', this.#height + 'px');

    this.#c = this.#canvas.getContext('2d');

    this.#canvas.style.position = 'absolute';
    this.#canvas.style.zIndex = 1; // z-index
    this.#canvas.style.width = this.#width + 'px';
    this.#canvas.style.height = this.#height + 'px';
    this.#canvas.style.maxWidth = 'none';
    this.#canvas.style.transform = 'none';
    this.#canvas.style.pointerEvents = 'auto';

    this.#displaySunAndIRPower = false;

    let thisObj = this;
    this.#canvas.addEventListener('mousedown', function(event) {
      if (event.button == 0) {     // left mouse button
        if (guiControls.tool == 'TOOL_STATION') {
          thisObj.destroy();       // remove weather station
          event.stopPropagation(); // prevent mousedown on body from firing
        } else {
          if (guiControls.dayNightCycle == true) {
            thisObj.#chartCanvas.style.display = (thisObj.#chartCanvas.style.display == 'none') ? 'block' : 'none'; // toggle visibility of chart canvas
          }
        }
      } else if (event.button == 2) {                                   // right mouse button
        thisObj.#displaySunAndIRPower = !thisObj.#displaySunAndIRPower; // toggle display of radiation flux
      }
    });

    this.#canvas.addEventListener('contextmenu', function(event) { event.preventDefault(); }); // Prevent the browser's context menu from appearing
    this.#mainDiv.addEventListener('wheel', function(event) {
      if (event.deltaY == 0)
        return;
      event.preventDefault();
      event.stopPropagation();
      thisObj.#scrollMenu(event.deltaY);
    }, {passive : false});

    this.createChartJSCanvas();
  }

  createChartJSCanvas()
  {
    this.#chartCanvas = document.createElement('canvas');

    this.#mainDiv.appendChild(this.#chartCanvas);

    const ctx = this.#chartCanvas.getContext('2d');

    this.#chartCanvas.height = 400;
    this.#chartCanvas.width = 500;

    let style = this.#chartCanvas.style;

    style.marginTop = '100px';
    style.pointerEvents = 'auto';

    style.position = 'relative';

    style.left = '-200px';

    style.display = 'none'; // hide initially


    this.#historyChart = new Chart(ctx, {
      type : 'line',
      data : {
        labels : [], // Time-based labels
        datasets : [
          {
            label : 'Temperature',
            data : [],
            backgroundColor : 'rgba(255, 0, 0, 0.9)',
            borderColor : 'rgba(255, 0, 0, 1)',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {
            label : 'Dew Point',
            data : [],
            backgroundColor : '#00FFFF',
            borderColor : '#00FFFF',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {label : 'Wind Speed', data : [], backgroundColor : '#AAAAAA', borderColor : '#AAAAAA', radius : 0, borderWidth : 1, fill : false, hidden : true},                            //
          {label : 'Air Quality', data : [], backgroundColor : '#803c00', borderColor : '#803c00', radius : 0, borderWidth : 1, fill : false, hidden : true},                           //
          {label : 'Precipitation', data : [], backgroundColor : '#0055FF', borderColor : '#0055FF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},    //
          {label : 'Snow Height', data : [], backgroundColor : '#FFFFFF', borderColor : '#FFFFFF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},      //
          {label : 'Water Temperature', data : [], backgroundColor : '#406cff', borderColor : '#406cff', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true} //
        ]
      },
      options : {
        scales : {
          x : {
            type : 'time', // Set the x-axis to use a time scale
            time : {unit : 'minute', tooltipFormat : 'HH:mm'},
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            ticks : {
              color : 'white' // White color for the x-axis labels
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          },
          y : {
            beginAtZero : false, // Start the y-axis at 0
            ticks : {
              color : 'white'    // White color for the y-axis labels
            },
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          }
        },
        plugins : {
          legend : {
            display : true,
            labels : {
              color : 'white', // White color for legend text
              font : {
                size : 14,
                family : 'Plus Jakarta Sans'
              },
              filter : function(item, chart) { return !chart.datasets[item.datasetIndex].reallyHidden; }
            }
          }
        },
        responsive : false, // Auto rescale on canvas resize
        maintainAspectRatio : false,
        animation : false,  // Disables all animations
        font : {family : 'Plus Jakarta Sans'},
        normalized : true
        // parsing : false
      }
    });
  }

  updateChartJS() // add newest measurement to chart
  {
    if (this.#historyChart) {
      this.#historyChart.data.datasets[0].data.push(convertTempToSelectedUnit(this.#temperature));
      this.#historyChart.data.datasets[1].data.push(convertTempToSelectedUnit(this.#dewpoint));
      this.#historyChart.data.datasets[2].data.push(convertVelocityToSelectedUnit(this.#velocity));
      this.#historyChart.data.datasets[3].data.push(this.#airQuality);

      if (this.#isOnLand) {
        this.#historyChart.data.datasets[4].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#soilMoisture) : this.#soilMoisture);
        this.#historyChart.data.datasets[5].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#snowHeight) : this.#snowHeight);
      } else if (this.#isOnWater) {
        this.#historyChart.data.datasets[6].data.push(convertTempToSelectedUnit(this.#waterTemperature));
      }

      this.#historyChart.data.labels.push(this.#time);

      if (this.#historyChart.data.labels.length > 60 * 24) { // max 24 hour history. Remove the oldest data and label
        this.#historyChart.data.labels.shift();
        this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data.shift(); });
      }

      if (guiControls.dayNightCycle == true) {
        if (this.#chartCanvas.style.display != 'none') // only update if visible
          this.#historyChart.update();
      } else {
        this.#chartCanvas.style.display = 'none';
      }
    }
  }

  clearChart()
  {
    this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data = []; });
    this.#historyChart.data.labels = [];
    this.#historyChart.update();
  }

  destroy()
  {
    this.#historyChart.destroy();
    this.#mainDiv.remove();
    let index = weatherStations.indexOf(this);
    if (index >= 0)
      weatherStations.splice(index, 1);
  }

  measure(measurements = null)
  {
    let baseTextureValues;
    let waterTextureValues;
    let lightTextureValues;
    let baseRow0Offset;
    let baseRow1Offset;
    let baseRow2Offset;
    let waterRow0Offset;
    let waterRow1Offset;
    let lightPixelOffset;
    if (measurements) {
      baseTextureValues = measurements.baseData;
      waterTextureValues = measurements.waterData;
      lightTextureValues = measurements.lightData;
      baseRow0Offset = measurements.baseRow0Offset;
      baseRow1Offset = measurements.baseRow1Offset;
      baseRow2Offset = measurements.baseRow2Offset;
      waterRow0Offset = baseRow0Offset;
      waterRow1Offset = baseRow1Offset;
      lightPixelOffset = baseRow1Offset;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); // basetexture
      const baseRow0Y = Math.max(0, this.#y - 1);
      const baseRow1Y = this.#y;
      const baseRow2Y = Math.min(sim_res_y - 1, this.#y + 1);
      const baseStartY = baseRow0Y;
      const baseEndY = baseRow2Y;
      baseTextureValues = new Float32Array(4 * (baseEndY - baseStartY + 1));
      gl.readPixels(this.#x, baseStartY, 1, baseEndY - baseStartY + 1, gl.RGBA, gl.FLOAT, baseTextureValues);
      baseRow0Offset = (baseRow0Y - baseStartY) * 4;
      baseRow1Offset = (baseRow1Y - baseStartY) * 4;
      baseRow2Offset = (baseRow2Y - baseStartY) * 4;

      gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
      const waterStartY = baseRow0Y;
      const waterEndY = baseRow1Y;
      waterTextureValues = new Float32Array(4 * (waterEndY - waterStartY + 1));
      gl.readPixels(this.#x, waterStartY, 1, waterEndY - waterStartY + 1, gl.RGBA, gl.FLOAT, waterTextureValues);
      waterRow0Offset = (baseRow0Y - waterStartY) * 4;
      waterRow1Offset = (baseRow1Y - waterStartY) * 4;

      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); // light texture
      lightTextureValues = new Float32Array(4);
      gl.readPixels(this.#x, this.#y, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);
      lightPixelOffset = 0;
    }

    let T = potentialToRealT(readRgbaChannel(baseTextureValues, baseRow1Offset, 3), this.#y); // temperature in kelvin

    this.#temperature = KtoC(T);
    this.#nearSurfaceAirTemperature = this.#temperature;
    this.#velocity = rawVelocityTo_ms(Math.hypot(
      readRgbaChannel(baseTextureValues, baseRow2Offset, 0),
      readRgbaChannel(baseTextureValues, baseRow1Offset, 1)
    ));

    if (readRgbaChannel(waterTextureValues, waterRow1Offset, 0) > 1000.) { // is not air
      this.destroy();                        // remove weather station
      return;
    }

    if (readRgbaChannel(waterTextureValues, waterRow0Offset, 0) > 1001.5) { // water wall
      this.#waterTemperature = KtoC(readRgbaChannel(baseTextureValues, baseRow0Offset, 3));
    } else {
      this.#waterTemperature = -100.;
    }

    this.#dewpoint = KtoC(dewpoint(readRgbaChannel(waterTextureValues, waterRow1Offset, 0)));

    if (guiControls.realDewPoint) {
      this.#dewpoint = Math.min(this.#temperature, this.#dewpoint);
    }

    this.#relativeHumd = relativeHumd(T, readRgbaChannel(waterTextureValues, waterRow1Offset, 0));
    if (guiControls.realDewPoint) {
      this.#relativeHumd = Math.min(this.#relativeHumd, 100.0);
    }


    if (readRgbaChannel(waterTextureValues, waterRow0Offset, 0) > 1000.5 && readRgbaChannel(waterTextureValues, waterRow0Offset, 0) < 1001.5) { // on land surface
      this.#soilMoisture = readRgbaChannel(waterTextureValues, waterRow0Offset, 2);
      this.#snowHeight = readRgbaChannel(waterTextureValues, waterRow0Offset, 3);

      if (!this.#isOnLand) {
        this.clearChart();
        this.#isOnLand = true;
        this.#isOnWater = false;
        this.#historyChart.data.datasets[4].reallyHidden = false;
        this.#historyChart.data.datasets[5].reallyHidden = false;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }

    } else if (readRgbaChannel(waterTextureValues, waterRow0Offset, 0) > 1001.5) { // on water surface
      if (!this.#isOnWater) {
        this.clearChart();
        this.#isOnWater = true;
        this.#isOnLand = false;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = false;
      }
    } else { // in air
      if (this.#isOnLand || this.#isOnWater) {
        this.clearChart();
        this.#isOnLand = false;
        this.#isOnWater = false;
        this.#soilMoisture = 0;
        this.#snowHeight = 0;
        this.#waterTemperature = -10.0;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }
    }


    this.#airQuality = readRgbaChannel(waterTextureValues, waterRow1Offset, 3) * 300.0; // read smoke

    this.#netIRpow = readRgbaChannel(lightTextureValues, lightPixelOffset, 2) - readRgbaChannel(lightTextureValues, lightPixelOffset, 3); // IR_DOWN - IR_UP
    // this.#netIRpow = lightTextureValues[1] / 0.000002; // or calculate from NET_HEATING

    let directSunlight = Math.max(readRgbaChannel(lightTextureValues, lightPixelOffset, 0) * Math.sin(guiControls.sunAngle * degToRad), 0.0);

    this.#solarPower = directSunlight;

    this.#snowDepthChangeCm = this.#previousSnowHeight === null || !this.#isOnLand ?
      0 : this.#snowHeight - this.#previousSnowHeight;
    this.#previousSnowHeight = this.#isOnLand ? this.#snowHeight : null;
    this.#snowDepthChangeHistory.push({iteration : iterNum, changeCm : this.#snowDepthChangeCm});
    const hourAgo = iterNum - 1 / timePerIteration;
    while (this.#snowDepthChangeHistory.length &&
        this.#snowDepthChangeHistory[0].iteration <= hourAgo)
      this.#snowDepthChangeHistory.shift();
    this.#snowDepthChangeLastHourCm = this.#snowDepthChangeHistory.reduce(
      (total, sample) => total + sample.changeCm, 0
    );
    this.#time = simDateTime.toISOString();
    this.updateChartJS(); // update chart
  }

  measureRain(rainSamples = null)
  {
    let totalRainDeposition = 0;
    let sampledCells = 0;
    if (guiControls.enablePrecipitation && rainSamples) {
      const { prefixes, xStart, width, yStart, height } = rainSamples;
      const requestedRadius = Math.ceil(2500 / cellHeight);
      const radius = guiControls.wrapHorizontally ?
        Math.min(requestedRadius, Math.floor((sim_res_x - 1) / 2)) : Math.max(1, requestedRadius);
      for (let dy = -radius; dy <= radius; dy++) {
        const y = this.#y + dy;
        if (y < yStart || y >= yStart + height)
          continue;

        const halfWidth = Math.floor(Math.sqrt(radius * radius - dy * dy));
        const leftX = this.#x - halfWidth;
        const rightX = this.#x + halfWidth;
        const rowStart = (y - yStart) * (width + 1);
        if (guiControls.wrapHorizontally) {
          if (leftX < 0 || rightX >= sim_res_x) {
            const wrappedLeftX = mod(leftX, sim_res_x);
            const wrappedRightX = mod(rightX, sim_res_x);
            totalRainDeposition += prefixes[rowStart + width] - prefixes[rowStart + wrappedLeftX];
            totalRainDeposition += prefixes[rowStart + wrappedRightX + 1];
          } else {
            totalRainDeposition += prefixes[rowStart + rightX - xStart + 1] - prefixes[rowStart + leftX - xStart];
          }
          sampledCells += halfWidth * 2 + 1;
        } else {
          const clippedLeftX = Math.max(leftX, 0);
          const clippedRightX = Math.min(rightX, sim_res_x - 1);
          if (clippedLeftX <= clippedRightX) {
            totalRainDeposition += prefixes[rowStart + clippedRightX - xStart + 1] - prefixes[rowStart + clippedLeftX - xStart];
            sampledCells += clippedRightX - clippedLeftX + 1;
          }
        }
      }
    }

    const elapsedIterations = Math.max(0, iterNum - this.#lastRainMeasurementIteration);
    const elapsedHours = elapsedIterations * timePerIteration;
    const intervalMinutes = elapsedHours * 60;
    this.#lastRainMeasurementIteration = iterNum;
    const intervalMm = sampledCells ?
      totalRainDeposition / sampledCells * depositionMassToWaterMm : 0;
    this.#rainIntervalMm = Number.isFinite(intervalMm) && intervalMm > 0 ? intervalMm : 0;
    const bucketWaterMm = this.#rainBucketWaterMm + this.#rainIntervalMm;
    this.#rainIntervalTips = Math.floor((bucketWaterMm + 1e-9) / rainGaugeBucketCapacityMm);
    this.#rainBucketWaterMm = Math.max(0, bucketWaterMm - this.#rainIntervalTips * rainGaugeBucketCapacityMm);
    if (this.#rainIntervalTips > 0)
      this.#rainTipHistory.push({iteration : iterNum, tips : this.#rainIntervalTips});
    const rateWindowIterations = rainGaugeRateWindowMinutes / 60 / timePerIteration;
    while (this.#rainTipHistory.length &&
        iterNum - this.#rainTipHistory[0].iteration > rateWindowIterations)
      this.#rainTipHistory.shift();
    const recentTips = this.#rainTipHistory.reduce((total, sample) => total + sample.tips, 0);
    this.#rainRate = recentTips * rainGaugeBucketCapacityMm /
      (rainGaugeRateWindowMinutes / 60);

    this.#rainHistory.push({
      iteration : iterNum,
      rate : elapsedHours > 0 ? this.#rainIntervalMm / elapsedHours : 0,
      millimeters : this.#rainIntervalMm,
      intervalMinutes,
      measurable : this.#rainIntervalMm >= rainGaugeMeasurableIntervalMm
    });
    const iterationsPerDay = 24 / timePerIteration;
    const oldestIteration = iterNum - iterationsPerDay;
    while (this.#rainHistory.length && this.#rainHistory[0].iteration < oldestIteration)
      this.#rainHistory.shift();

    this.#hourlyRainTotal = 0;
    this.#dailyRainTotal = 0;
    this.#peakHourlyRainRate = 0;
    this.#rainDurationMinutes = 0;
    const hourAgo = iterNum - 1 / timePerIteration;
    let measuringContinuousRain = true;
    for (let i = this.#rainHistory.length - 1; i >= 0; i--) {
      const sample = this.#rainHistory[i];
      this.#dailyRainTotal += sample.millimeters;
      if (sample.iteration > hourAgo) {
        this.#hourlyRainTotal += sample.millimeters;
        this.#peakHourlyRainRate = Math.max(this.#peakHourlyRainRate, sample.rate);
      }

      if (measuringContinuousRain) {
        if (sample.measurable)
          this.#rainDurationMinutes += sample.intervalMinutes;
        else
          measuringContinuousRain = false;
      }
    }
  }

  getXpos() { return this.#x; }

  getYpos() { return this.#y; }

  toShareData()
  {
    return {
      id : this.#id,
      position : {
        xCell : this.#x,
        yCell : this.#y,
        xMeters : this.#x * cellHeight,
        altitudeMeters : this.#y * cellHeight
      },
      observedAt : this.#time || null,
      surfaceType : this.#isOnLand ? 'land' : this.#isOnWater ? 'water' : 'air',
      airTemperatureC : Number.isFinite(this.#temperature) ? this.#temperature : null,
      nearSurfaceAirTemperatureC : Number.isFinite(this.#nearSurfaceAirTemperature) ?
        this.#nearSurfaceAirTemperature : null,
      dewPointC : Number.isFinite(this.#dewpoint) ? this.#dewpoint : null,
      relativeHumidityPercent : Number.isFinite(this.#relativeHumd) ? this.#relativeHumd : null,
      windSpeedMetersPerSecond : Number.isFinite(this.#velocity) ? this.#velocity : null,
      groundTemperatureC : null,
      waterTemperatureC : this.#isOnWater && Number.isFinite(this.#waterTemperature) ? this.#waterTemperature : null,
      soilMoistureMm : this.#isOnLand && Number.isFinite(this.#soilMoisture) ? this.#soilMoisture : null,
      snowDepthCm : this.#isOnLand && Number.isFinite(this.#snowHeight) ? this.#snowHeight : null,
      snowDepthChangeThisSampleCm : Number.isFinite(this.#snowDepthChangeCm) ?
        this.#snowDepthChangeCm : null,
      snowDepthChangeLastHourCm : Number.isFinite(this.#snowDepthChangeLastHourCm) ?
        this.#snowDepthChangeLastHourCm : null,
      rainRateMmPerHour : Number.isFinite(this.#rainRate) ? this.#rainRate : null,
      rainSinceLastSampleMm : Number.isFinite(this.#rainIntervalMm) ? this.#rainIntervalMm : null,
      rainTipsSinceLastSample : Number.isFinite(this.#rainIntervalTips) ? this.#rainIntervalTips : null,
      rainBucketWaterMm : Number.isFinite(this.#rainBucketWaterMm) ? this.#rainBucketWaterMm : null,
      rainTotalLastHourMm : Number.isFinite(this.#hourlyRainTotal) ? this.#hourlyRainTotal : null,
      rainTotalLast24HoursMm : Number.isFinite(this.#dailyRainTotal) ? this.#dailyRainTotal : null,
      peakRainRateLastHourMmPerHour : Number.isFinite(this.#peakHourlyRainRate) ?
        this.#peakHourlyRainRate : null,
      rainDurationMinutes : Number.isFinite(this.#rainDurationMinutes) ? this.#rainDurationMinutes : null,
      airQualityIndex : Number.isFinite(this.#airQuality) ? this.#airQuality : null,
      cloudCoverPercent : Number.isFinite(this.#cloudCoverFraction) ?
        this.#cloudCoverFraction * 100 : null,
      cloudCoverOktas : Number.isFinite(this.#cloudOktas) ? this.#cloudOktas : null,
      cloudCeilingMeters : Number.isFinite(this.#cloudCeilingMeters) ? this.#cloudCeilingMeters : null,
      skyCondition : this.#skyCondition,
      weatherIcon : this.getWeatherIcon(),
      solarPowerWattsPerSquareMeter : Number.isFinite(this.#solarPower) ? this.#solarPower : null,
      netInfraredPowerWattsPerSquareMeter : Number.isFinite(this.#netIRpow) ? this.#netIRpow : null
    };
  }

  calculateOverheadClouds(waterColumnData, wallColumnData, width, height, stationLocalX, surfaceY, cellHeightMeters)
  {
    const fovRadius = stationCloudCoverRadiusCells;
    const cloudWaterThreshold = 0.05;
    let totalCloudCover = 0;
    let totalLines = 0;
    let lowestBaseMeters = null;

    if (waterColumnData && wallColumnData && Number.isInteger(width) && width > 0 &&
        Number.isInteger(height) && height > 0 &&
        Number.isInteger(stationLocalX) && Number.isInteger(surfaceY) &&
        Number.isFinite(cellHeightMeters) && cellHeightMeters > 0 &&
        waterColumnData.length >= width * height * 4 &&
        wallColumnData.length >= width * height * 4) {
      for (let dx = -fovRadius; dx <= fovRadius; dx++) {
        let colX = stationLocalX + dx;
        if (guiControls.wrapHorizontally) {
          colX = mod(colX, width);
        } else if (colX < 0 || colX >= width) {
          continue;
        }

        totalLines++;
        let lineTransmission = 1;
        for (let y = Math.max(0, surfaceY + 1); y < height; y++) {
          const pixelOffset = (y * width + colX) * 4;
          if (wallColumnData[pixelOffset + 1] === 0)
            continue;
          const cloudLiquidWater = waterColumnData[pixelOffset + 1];
          if (Number.isFinite(cloudLiquidWater) && cloudLiquidWater >= cloudWaterThreshold) {
            const cloudDensity = cloudLiquidWater * 13.6;
            lineTransmission /= 1 + cloudDensity;
            const baseAlt = (y - surfaceY) * cellHeightMeters;
            if (lowestBaseMeters === null || baseAlt < lowestBaseMeters) {
              lowestBaseMeters = baseAlt;
            }
          }
        }
        totalCloudCover += 1 - lineTransmission;
      }
    }

    this.#cloudCoverFraction = totalLines > 0 ? totalCloudCover / totalLines : 0;
    this.#cloudOktas = Math.round(this.#cloudCoverFraction * 8);
    this.#cloudCeilingMeters = lowestBaseMeters;

    if (this.#cloudOktas === 0)
      this.#skyCondition = 'CLR';
    else if (this.#cloudOktas <= 2)
      this.#skyCondition = 'FEW';
    else if (this.#cloudOktas <= 4)
      this.#skyCondition = 'SCT';
    else if (this.#cloudOktas <= 7)
      this.#skyCondition = 'BKN';
    else
      this.#skyCondition = 'OVC';
  }

  setHidden(hidden)
  {
    this.#mainDiv.style.display = hidden ? 'none' : 'block';
    this.#chartCanvas.style.display = 'none'; // hide charts
  }

  #scrollMenu(deltaY)
  {
    const now = performance.now();
    if (this.#menuTransitionStart !== null && now - this.#menuTransitionStart < this.#menuTransitionDuration)
      return;
    this.#menuTransitionDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 320;
    this.#menuFromPage = this.#menuPage;
    this.#menuTransitionDirection = deltaY > 0 ? 1 : -1;
    this.#menuTransitionStart = now;
  }

  updateCanvas()
  {
    let screenX = simToScreenX(this.#x) - this.#width / 2;
    let screenY = simToScreenY(this.#y) - this.#height;

    // if (screenX > 0 && screenX < canvas.width && screenY > 0 && screenY < canvas.height) {
    this.#mainDiv.style.left = screenX + 'px';
    this.#mainDiv.style.top = screenY + 'px';
    const contrastSampleTime = performance.now();
    if (contrastSampleTime - this.#lastContrastSampleTime >= 1000) {
      const targetTextColor = getSceneContrastTextColor(screenX + this.#width / 2, screenY + this.#height * 0.4);
      if (targetTextColor != this.#textColorTarget) {
        this.#textColorFrom = this.#textColor;
        this.#textColorTarget = targetTextColor;
        this.#textColorTransitionStartTime = contrastSampleTime;
      }
      this.#lastContrastSampleTime = contrastSampleTime;
    }
    this.#textColor = interpolateTextColor(
      this.#textColorFrom,
      this.#textColorTarget,
      (contrastSampleTime - this.#textColorTransitionStartTime) / 500
    );
    this.#stationMarkerLabel.style.color = this.#textColor;
    this.#menuHint.dataset.contrast = this.#textColor == '#111820' ? 'dark' : 'light';
    // this.#canvas.style.left = screenX + 'px';
    // this.#canvas.style.top = screenY + 'px';
    let c = this.#c;
    c.clearRect(0, 0, this.#width, this.#height);
    c.fillStyle = '#00000000';
    c.fillRect(0, 0, this.#width, this.#height);

    const useImperialRainUnits = guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL';
    const convertRainAmount = amount => useImperialRainUnits ? amount * 0.0393701 : amount;
    const rainAmountUnit = useImperialRainUnits ? 'in' : 'mm';
    const rainRateUnit = useImperialRainUnits ? 'in/h' : 'mm/h';
    const roundedRainDurationMinutes = Math.round(this.#rainDurationMinutes);
    const durationHours = Math.floor(roundedRainDurationMinutes / 60);
    const durationMinutes = roundedRainDurationMinutes % 60;
    const cloudText = Math.round(this.#cloudCoverFraction * 100) + '% (' + this.#skyCondition + ')' +
      (this.#cloudCeilingMeters === null ? ' (No ceiling)' : ' @ ' + printAltitude(this.#cloudCeilingMeters));
    const iconPath = 'resources/icons/weather/' + this.getWeatherIcon() + '.svg';
    if (this.#weatherIconElement.getAttribute('src') != iconPath)
      this.#weatherIconElement.src = iconPath;

    const weatherDetails = [];
    if (this.#displaySunAndIRPower) {
      weatherDetails.push(
        ['Relative humidity', this.#relativeHumd.toFixed(1) + ' %'],
        ['Solar radiation', this.#solarPower.toFixed(1) + ' W/m²'],
        ['Net IR radiation', this.#netIRpow.toFixed(1) + ' W/m²']
      );
    } else {
      weatherDetails.push(
        ['Dew point', printTemp(this.#dewpoint)],
        ['Wind', printVelocity(this.#velocity)]
      );
      if (this.#soilMoisture > 0)
        weatherDetails.push(['Soil moisture', printSoilMoisture(this.#soilMoisture)]);
      else if (this.#waterTemperature > -1)
        weatherDetails.push(['Water temperature', printTemp(this.#waterTemperature)]);
      if (this.#snowHeight > 0)
        weatherDetails.push(['Snow depth', printSnowHeight(this.#snowHeight)]);
    }
    weatherDetails.push(['Sky', cloudText]);
    const rainDetails = [
      ['Last hour', convertRainAmount(this.#hourlyRainTotal).toFixed(2) + ' ' + rainAmountUnit],
      ['Last 24 hours', convertRainAmount(this.#dailyRainTotal).toFixed(2) + ' ' + rainAmountUnit],
      ['Raining', durationHours + 'h ' + durationMinutes + 'm'],
      ['Peak 1-hour rate', convertRainAmount(this.#peakHourlyRainRate).toFixed(2) + ' ' + rainRateUnit],
      ['Sky', cloudText]
    ];
    const now = performance.now();
    let activePage = this.#menuPage;
    let transitionProgress = 1;
    if (this.#menuTransitionStart !== null) {
      transitionProgress = clamp((now - this.#menuTransitionStart) / this.#menuTransitionDuration, 0, 1);
      transitionProgress = 1 - Math.pow(1 - transitionProgress, 3);
      if (transitionProgress >= 1) {
        this.#menuPage = 1 - this.#menuFromPage;
        this.#menuTransitionStart = null;
        this.#menuTransitionDirection = 0;
        activePage = this.#menuPage;
      }
    }
    const markerVisibility = this.#menuTransitionStart === null ? 1 : Math.abs(2 * transitionProgress - 1);
    this.#stationMarker.style.opacity = markerVisibility;
    this.#mainDiv.style.setProperty('--weather-marker-transition-y', -12 * (1 - markerVisibility) + 'px');
    const drawMenuPage = (page, offsetY) => {
      c.save();
      c.beginPath();
      c.rect(0, 0, this.#width, this.#height - 20);
      c.clip();
      c.translate(0, offsetY);
      c.font = '600 11px "Plus Jakarta Sans", sans-serif';
      c.fillStyle = this.#textColor;
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      const title = page == 0 ? 'Weather' : 'Rain';
      const details = page == 0 ? weatherDetails : rainDetails;
      const lineHeight = 9;
      const contentTop = 12;
      const drawFadedText = (text, x, y, font) => {
        const edgeFade = Math.min(clamp((y - 4) / 12, 0, 1), clamp((this.#height - 24 - y) / 12, 0, 1));
        if (edgeFade <= 0)
          return;
        c.globalAlpha = edgeFade;
        c.font = font;
        c.fillText(text, x, y, this.#width - 16);
      };
      const isWeatherPage = page == 0;
      const headlineValue = isWeatherPage
        ? printTemp(this.#temperature)
        : convertRainAmount(this.#rainRate).toFixed(2) + ' ' + rainRateUnit;
      c.textAlign = 'center';
      c.globalAlpha = 1;
      c.fillStyle = this.#textColor;
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.font = '600 16px "Plus Jakarta Sans", sans-serif';
      c.fillText(headlineValue, this.#width / 2, contentTop + 25, this.#width - 24);
      drawFadedText(title, this.#width / 2, contentTop + 41, '600 10px "Plus Jakarta Sans", sans-serif');
      details.forEach(([label, value], index) => {
        drawFadedText(label + ': ' + value, this.#width / 2, contentTop + 55 + index * lineHeight, '400 10px "Plus Jakarta Sans", sans-serif');
      });
      c.restore();
    };

    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.globalAlpha = 1;
    if (this.#menuTransitionStart !== null) {
      const offset = this.#menuTransitionDirection * (this.#height - 20);
      drawMenuPage(this.#menuFromPage, -offset * transitionProgress);
      drawMenuPage(1 - this.#menuFromPage, offset * (1 - transitionProgress));
    } else {
      drawMenuPage(activePage, 0);
    }

    //  }
  }

  getWeatherIcon()
  {
    if (this.#snowDepthChangeCm > 0 && this.#nearSurfaceAirTemperature <= 0)
      return 'cloud-snow';
    if (this.#rainIntervalTips > 0)
      return 'cloud-rain';
    if (this.#skyCondition == 'OVC')
      return 'cloud';
    if (this.#skyCondition == 'BKN')
      return 'cloud-sun';
    if (this.#skyCondition == 'SCT' || this.#skyCondition == 'FEW')
      return 'cloud-sun';
    return this.#solarPower >= 100 ? 'sun' : this.#solarPower >= 5 ? 'cloud-sun' : 'moon';
  }

}


let weatherStations = []; // array holding all weather stations

// Lightning rods. The Lightning Rod tool plants one of these masts on the
// terrain; clicking the open sky does nothing. Each rod is { x, y } in
// normalized sim coordinates, where y is the height of the terrain surface it
// stands on. Keep MAX_LIGHTNING_RODS in sync with #define MAX_LIGHTNING_RODS in
// shaders/common.glsl. Rods belong to the running simulation, so they are
// cleared whenever a new simulation (or a save file) is loaded.
let lightningRods = [];
const MAX_LIGHTNING_RODS = 6;
const lightningRodStatus = { placed : '0 / ' + MAX_LIGHTNING_RODS };

function updateLightningRodStatus()
{
  lightningRodStatus.placed = lightningRods.length + ' / ' + MAX_LIGHTNING_RODS;
}

async function loadData()
{
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if (!file) {
    sim_res_x = Number.parseInt(document.getElementById('simResSelX').value, 10);
    sim_res_y = Number.parseInt(document.getElementById('simResSelY').value, 10);
    sim_height = Number.parseInt(document.getElementById('simHeightSel').value, 10);
    const cellCount = sim_res_x * sim_res_y;
    if (!Number.isInteger(sim_res_x) || !Number.isInteger(sim_res_y) || !Number.isInteger(sim_height) ||
        sim_res_x < 100 || sim_res_x > 16000 || sim_res_y < 100 || sim_res_y > 500 ||
        sim_height < 5000 || sim_height > 15000 || cellCount % NUM_DROPLETS_DEVIDER != 0) {
      alert('Invalid simulation dimensions. Please choose valid resolution settings.');
      return;
    }

    NUM_DROPLETS = cellCount / NUM_DROPLETS_DEVIDER;
    SETUP_MODE = true;
    try {
      await setLoadingBar('Preparing new simulation');
      await mainScript(null);
    } catch (error) {
      console.error('The simulation could not be initialized.', error);
      loadingBar?.remove();
      alert('The simulation could not be initialized: ' + (error instanceof Error ? error.message : String(error)));
    }
    return;
  }

  await setLoadingBar('Reading save file');
  try {
    if (file.size < Uint32Array.BYTES_PER_ELEMENT)
      throw new Error('The file is too small to contain a valid save header.');

    const versionBuffer = await file.slice(0, Uint32Array.BYTES_PER_ELEMENT).arrayBuffer();
    const version = new DataView(versionBuffer).getUint32(0, true);
    if (version != saveFileVersionID && version != 1939327491) {
      alert('Incompatible file!');
      fileInput.value = '';
      loadingBar?.remove();
      return;
    }

    await loadingBar.set(2, 'Reading compressed simulation data');
    const compressedData = new Uint8Array(await file.slice(Uint32Array.BYTES_PER_ELEMENT).arrayBuffer());
    await new Promise(resolve => requestAnimationFrame(resolve));
    await loadingBar.set(3, 'Decompressing simulation data');
    const data = window.pako.inflate(compressedData);
    await loadingBar.set(5, 'Restoring simulation grid and precipitation');
    await new Promise(resolve => requestAnimationFrame(resolve));
    let offset = 0;
    const readArray = (ArrayType, count, label) => {
      const byteLength = ArrayType.BYTES_PER_ELEMENT * count;
      if (!Number.isSafeInteger(byteLength) || byteLength < 0 || offset + byteLength > data.byteLength)
        throw new Error(`The save file is incomplete or invalid (${label}).`);
      const values = new ArrayType(data.slice(offset, offset + byteLength).buffer);
      offset += byteLength;
      return values;
    };

    const resolution = readArray(Uint16Array, 2, 'resolution');
    const loadedWidth = resolution[0];
    const loadedHeight = resolution[1];
    const cellCount = loadedWidth * loadedHeight;
    if (loadedWidth < 100 || loadedWidth > 16000 || loadedHeight < 100 || loadedHeight > 500 ||
        cellCount % NUM_DROPLETS_DEVIDER != 0) {
      throw new Error('The save file contains unsupported simulation dimensions.');
    }

    const loadedDropletCount = cellCount / NUM_DROPLETS_DEVIDER;
    const baseTexture = readArray(Float32Array, cellCount * 4, 'air data');
    const waterTexture = readArray(Float32Array, cellCount * 4, 'water data');
    const wallTexture = readArray(Int8Array, cellCount * 4, 'terrain data');
    const precipitation = readArray(Float32Array, loadedDropletCount * 5, 'precipitation data');
    let loadedStationPositions = new Int16Array(0);
    let loadedSettings = null;

    if (version == saveFileVersionID) {
      const stationCount = readArray(Uint16Array, 1, 'weather station count')[0];
      loadedStationPositions = readArray(Int16Array, stationCount * 2, 'weather station positions');
      for (let stationIndex = 0; stationIndex < stationCount; stationIndex++) {
        const x = loadedStationPositions[stationIndex * 2];
        const y = loadedStationPositions[stationIndex * 2 + 1];
        if (x < 0 || x >= loadedWidth || y < 0 || y >= loadedHeight)
          throw new Error('The save file contains an out-of-range weather station.');
      }
      const settingsText = new TextDecoder().decode(data.slice(offset));
      const parsedSettings = JSON.parse(settingsText);
      if (!parsedSettings || typeof parsedSettings != 'object' || Array.isArray(parsedSettings))
        throw new Error('The save file contains invalid simulation settings.');
      loadedSettings = settingsText;
    }
    const loadedWeatherStations = Array.from({length: loadedStationPositions.length / 2}, (_, stationIndex) =>
      new Weatherstation(loadedStationPositions[stationIndex * 2], loadedStationPositions[stationIndex * 2 + 1]));

    sim_res_x = loadedWidth;
    sim_res_y = loadedHeight;
    NUM_DROPLETS = loadedDropletCount;
    weatherStations = loadedWeatherStations;
    guiControlsFromSaveFile = loadedSettings;
    saveFileName = file.name.includes('.') ? file.name.split('.').slice(0, -1).join('.') : file.name;

    console.log('loading file: ' + saveFileName);
    console.log('File versionID: ' + version);
    console.log('sim_res_x: ' + sim_res_x);
    console.log('sim_res_y: ' + sim_res_y);
    if (version != saveFileVersionID)
      alert('Save File from older version, settings will not be loaded');

    await mainScript(baseTexture, waterTexture, wallTexture, precipitation);
  } catch (error) {
    console.error('The simulation save could not be loaded.', error);
    loadingBar?.remove();
    alert('The simulation save could not be loaded: ' + (error instanceof Error ? error.message : String(error)));
    fileInput.value = '';
  }
}

function loadImage(url)
{
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

class LoadingBar
{
  #screen;
  #progress;
  #task;
  #bar;

  constructor(percentIn)
  {
    this.percent = percentIn == null ? 0 : percentIn;
    this.description = 'Preparing simulation';

    this.#screen = document.createElement('div');
    this.#screen.id = 'loadingScreen';
    this.#screen.className = 'loading-screen';
    this.#screen.setAttribute('role', 'progressbar');
    this.#screen.setAttribute('aria-live', 'polite');
    this.#screen.setAttribute('aria-label', 'Simulation loading progress');
    this.#screen.setAttribute('aria-valuemin', '0');
    this.#screen.setAttribute('aria-valuemax', '100');
    this.#screen.innerHTML = `
      <div class="loading-brand">
        <svg class="loading-bolt" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#ffd76a" d="M13 2 L5 13 h4 L8 24 L19.5 10 h-4.5 L17 2 Z"></path>
        </svg>
        <div class="loading-title">2D Weather Sandbox</div>
        <div class="loading-tagline">Particle microphysics &middot; cloud dynamics &middot; emergent lightning —
          every storm grows out of the fluid physics</div>
      </div>
      <div class="loading-progress">
        <span class="loading-percentage"></span>
        <span class="loading-complete">Complete</span>
      </div>
      <div class="loading-bar-track"><div class="loading-bar-fill"></div></div>
      <div class="loading-task"></div>
    `;
    this.#progress = this.#screen.querySelector('.loading-percentage');
    this.#task = this.#screen.querySelector('.loading-task');
    this.#bar = this.#screen.querySelector('.loading-bar-fill');
    document.body.appendChild(this.#screen);
    this.#update();
  }

  async add(num, text)
  {
    return this.set(this.percent + num, text);
  }

  async set(num, text)
  {
    this.percent = clamp(Number(num) || 0, 0, 100);
    this.description = text;
    this.#update();
  }

  async showError(error)
  {
    this.#screen.classList.add('has-error');
    this.description = error;
    this.#update();
  }

  #update()
  {
    const percent = Math.round(this.percent);
    this.#progress.textContent = percent + '%';
    this.#screen.setAttribute('aria-valuenow', String(percent));
    this.#task.textContent = this.description || '';
    if (this.#bar)
      this.#bar.style.width = percent + '%';
  }

  async remove(completed = false)
  {
    if (completed) {
      document.body.classList.add('is-finishing');
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        await new Promise(resolve => setTimeout(resolve, 700));
      document.getElementById('IntroScreen')?.remove();
    }
    this.#screen.remove();
    document.body.classList.remove('is-loading', 'is-finishing');
    if (loadingBar == this)
      loadingBar = null;
  }
}


async function setLoadingBar(task)
{
  if (!loadingBar) {
    loadingBar = new LoadingBar(0);
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.add('is-loading');
          setTimeout(resolve, 350);
        });
      });
    });
  }
  if (task)
    await loadingBar.set(loadingBar.percent, task);
}

var soundingData;
var soundingRequestId = 0;

async function prepareSounding()
{
  const requestId = ++soundingRequestId;
  const dateSel = document.getElementById('datePicker');
  const date = new Date(dateSel.value);
  const station = stationSelector.options[stationSelector.selectedIndex];
  if (!dateSel.value || !Number.isFinite(date.getTime()) || !station) {
    soundingData = [];
    document.getElementById('soundingPreview').removeAttribute('src');
    return;
  }

  let epochTime = Math.floor(date.getTime() / 1000);

  const hourSelector = document.getElementById('hourSelector');
  const hour = Number(hourSelector.value);
  if (!Number.isFinite(hour)) {
    soundingData = [];
    document.getElementById('soundingPreview').removeAttribute('src');
    return;
  }

  epochTime += hour * 3600;

  const nextSoundingData = await loadSounding(station.value, epochTime, requestId);
  if (requestId === soundingRequestId && nextSoundingData !== null)
    soundingData = nextSoundingData;
}

async function mainScript(initialBaseTex, initialWaterTex, initialWallTex, initialRainDrops)
{
  // A rod belongs to the terrain it was planted on, so a new simulation (or a
  // loaded save file) starts without any.
  lightningRods = [];
  updateLightningRodStatus();

  let sliderGradientObserver;
  let loadedShaderCount = 0;
  const totalShaderCount = 30;

  await setLoadingBar();

  let lastSaveTime = new Date();
  let simElapsedMilliseconds = 0;
  let clockTimeEl;
  let clockDateEl;
  let clockRunningForEl;
  let clockSolarEventEl;
  let clockSolarCountdownEl;
  let clockSolarIconEl;
  let weatherStationsVisibilityController;
  let weatherShareStatusController;
  const weatherShareStatus = { status : 'Off' };
  let weatherShareRevision = 0;
  let weatherShareRequestInProgress = false;
  let lastWeatherShareErrorLogTime = 0;
  let nextWeatherShareAttemptTime = 0;
  let weatherShareRetryDelayMs = 1000;
  let currentPerformanceReadouts;
  let currentPerformanceReadoutControllers;
  let currentPerformanceScoreIcon;
  let displayModeController;
  let previousDisplayMode = guiControls_default.displayMode;
  let displayModeOverlay;
  let displayModeToast;
  let displayModeTransitionTimer;
  let capeHoverTooltip;
  let diagnosticLegend;
  let lastCapeColumnUpdateFrame = -Infinity;
  let lastCapeHoverUpdateTime = 0;
  const capeHoverValues = new Float32Array(4);
  let measuredSimulationStepsPerSecond = 0;
  let lastPerformanceIterationNum = iterNum;

  function showDisplayModeTransition(mode)
  {
    if (mode == previousDisplayMode)
      return;
    previousDisplayMode = mode;

    const options = displayModeController ? displayModeController.domElement.querySelectorAll('option') : [];
    let option = null;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value == mode) {
        option = options[i];
        break;
      }
    }
    const modeName = option ? option.textContent.replace(/^\d+\s*/, '') : mode.replace(/^DISP_/, '').replace(/_/g, ' ');
    if (!displayModeOverlay) {
      displayModeOverlay = document.createElement('div');
      displayModeOverlay.className = 'display-mode-overlay';
      displayModeOverlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(displayModeOverlay);
      displayModeToast = document.createElement('div');
      displayModeToast.className = 'display-mode-toast';
      displayModeToast.setAttribute('aria-live', 'polite');
      document.body.appendChild(displayModeToast);
    }

    clearTimeout(displayModeTransitionTimer);
    displayModeOverlay.classList.remove('is-transitioning');
    displayModeToast.classList.remove('is-visible');
    void displayModeOverlay.offsetWidth;
    displayModeToast.textContent = modeName;
    displayModeOverlay.classList.add('is-transitioning');
    displayModeToast.classList.add('is-visible');
    displayModeTransitionTimer = setTimeout(function() {
      displayModeOverlay.classList.remove('is-transitioning');
      displayModeToast.classList.remove('is-visible');
    }, 850);
  }

  function setDisplayMode(mode)
  {
    if (guiControls.displayMode == mode)
      return;
    guiControls.displayMode = mode;
    if (displayModeController)
      displayModeController.updateDisplay();
    showDisplayModeTransition(mode);
  }

  function setWeatherStationsVisible(visible)
  {
    displayWeatherStations = visible;
    if (guiControls)
      guiControls.showWeatherStations = visible;
    if (Array.isArray(weatherStations)) {
      for (let stationIndex = 0; stationIndex < weatherStations.length; stationIndex++)
        weatherStations[stationIndex].setHidden(!visible);
    }
    if (weatherStationsVisibilityController)
      weatherStationsVisibilityController.updateDisplay();
  }

  function updateWeatherShareStatus(status)
  {
    weatherShareStatus.status = status;
    if (weatherShareStatusController)
      weatherShareStatusController.updateDisplay();
  }

  function createWeatherDataSnapshot()
  {
    return {
      schemaVersion : 1,
      generatedAt : new Date().toISOString(),
      simulationTime : simDateTime instanceof Date && Number.isFinite(simDateTime.getTime()) ?
        simDateTime.toISOString() : null,
      simulation : {
        resolutionX : sim_res_x,
        resolutionY : sim_res_y,
        cellSizeMeters : cellHeight,
        worldWidthMeters : sim_res_x * cellHeight,
        worldHeightMeters : sim_height,
        wrapsHorizontally : guiControls.wrapHorizontally
      },
      units : {
        temperature : 'degrees Celsius',
        windSpeed : 'meters per second',
        precipitation : 'millimeters',
        altitude : 'meters',
        soilMoisture : 'millimeters',
        snowDepth : 'centimeters',
        cloudCover : 'percent and oktas',
        solarAndInfraredPower : 'watts per square meter'
      },
      stations : weatherStations.map(station => station.toShareData())
    };
  }

  async function sendWeatherDataSharingState(enabled)
  {
    const revision = ++weatherShareRevision;
    const body = enabled ?
      {enabled, revision, snapshot : createWeatherDataSnapshot()} :
      {enabled, revision};
    const requestController = new AbortController();
    const requestTimeout = setTimeout(() => requestController.abort(), 3000);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/publish', {
        method : 'POST',
        headers : {'Content-Type' : 'application/json'},
        body : JSON.stringify(body),
        signal : requestController.signal
      });
      const responseText = await response.text();
      let result = {};
      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          if (response.ok)
            throw new Error('LAN sharing server returned invalid JSON.');
        }
      }
      if (!response.ok)
        throw new Error(result.error || `LAN sharing request failed with HTTP ${response.status}. ${responseText}`);
      if (revision === weatherShareRevision) {
        weatherShareRetryDelayMs = 1000;
        nextWeatherShareAttemptTime = 0;
        updateWeatherShareStatus(enabled ?
          `Live: ${weatherStations.length} station(s)` : 'Off');
      }
    } catch (error) {
      if (revision === weatherShareRevision) {
        updateWeatherShareStatus(enabled ? 'Unavailable; check server and console' : 'Off');
        const now = Date.now();
        if (now - lastWeatherShareErrorLogTime >= 10000) {
          console.error('Could not update the LAN weather data server.', error);
          lastWeatherShareErrorLogTime = now;
        }
      }
      if (enabled && revision === weatherShareRevision) {
        nextWeatherShareAttemptTime = Date.now() + weatherShareRetryDelayMs;
        weatherShareRetryDelayMs = Math.min(weatherShareRetryDelayMs * 2, 30000);
      }
    } finally {
      clearTimeout(requestTimeout);
    }
  }

  function publishWeatherDataIfEnabled()
  {
    if (!guiControls.shareWeatherDataToLan || weatherShareRequestInProgress ||
        Date.now() < nextWeatherShareAttemptTime)
      return;
    weatherShareRequestInProgress = true;
    sendWeatherDataSharingState(true).finally(() => {
      weatherShareRequestInProgress = false;
    });
  }

  function updateCurrentPerformanceDisplay()
  {
    if (!currentPerformanceReadouts)
      return;

    const fps = Math.max(0, FPS);
    const frameTime = fps > 0 ? 1000 / fps : 0;
    currentPerformanceReadouts.fps = Math.round(fps) + ' FPS';
    currentPerformanceReadouts.frameTime = frameTime.toFixed(1) + ' ms';
    currentPerformanceReadouts.simulationRate = measuredSimulationStepsPerSecond + ' steps/s';
    currentPerformanceReadouts.renderQuality = 'HDR ' + guiControls.hdrQuality +
      ' / Bloom ' + (guiControls.bloomEnabled ? guiControls.bloomQuality : 'Off') +
      (guiControls.filmicToneMapping ? ' / ACES' : '') +
      (guiControls.fxaaEnabled ? ' / FXAA' : '') +
      (guiControls.temporalAAEnabled ? ' / TAA' : '') +
      (guiControls.volumetricCloudLighting ? ' / Volumetric' : '');

    const performanceLevel = fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'poor';
    const performanceLabel = performanceLevel == 'good' ? 'Good' : performanceLevel == 'warn' ? 'Fair' : 'Low';
    currentPerformanceReadouts.overall = performanceLabel;
    if (currentPerformanceScoreIcon) {
      currentPerformanceScoreIcon.dataset.level = performanceLevel;
      const mouth = currentPerformanceScoreIcon.querySelector('[data-face-mouth]');
      mouth.setAttribute('d', performanceLevel == 'good'
        ? 'M8 13c1.1 1.3 2.4 2 4 2s2.9-.7 4-2'
        : performanceLevel == 'warn' ? 'M8 14h8' : 'M8 16c1.1-1.3 2.4-2 4-2s2.9.7 4 2');
      currentPerformanceScoreIcon.setAttribute('aria-label', performanceLabel + ' performance');
    }

    const timeLevel = frameTime > 0 && frameTime <= 20 ? 'good' : frameTime <= 33.3 && frameTime > 0 ? 'warn' : 'poor';
    currentPerformanceReadoutControllers.fps.domElement.closest('li').dataset.level = performanceLevel;
    currentPerformanceReadoutControllers.frameTime.domElement.closest('li').dataset.level = timeLevel;
    currentPerformanceReadoutControllers.simulationRate.domElement.closest('li').dataset.level = performanceLevel;
    currentPerformanceReadoutControllers.renderQuality.domElement.closest('li').dataset.level = guiControls.hdrQuality == '50%' ? 'good' :
      guiControls.hdrQuality == '75%' ? 'warn' : 'poor';
    currentPerformanceReadoutControllers.overall.domElement.closest('li').dataset.level = performanceLevel;
  }

  function updateDiagnosticOverlays()
  {
    if (!diagnosticLegend || !capeHoverTooltip)
      return;

    const capeMode = guiControls.displayMode == 'DISP_CAPE';
    const reflectivityMode = guiControls.displayMode == 'DISP_REFLECTIVITY';
    diagnosticLegend.hidden = !capeMode && !reflectivityMode;
    diagnosticLegend.classList.toggle('diagnostic-legend-cape', capeMode);
    diagnosticLegend.classList.toggle('diagnostic-legend-reflectivity', reflectivityMode);

    const canvasBounds = canvas.getBoundingClientRect();
    const pointerOverCanvas = canvas.matches(':hover') && mouseX >= 0 && mouseX <= canvas.width &&
      mouseY >= 0 && mouseY <= canvas.height;
    if (!capeMode || !pointerOverCanvas || mouseXinSim == null || mouseYinSim == null || SETUP_MODE) {
      capeHoverTooltip.hidden = true;
      return;
    }

    const now = performance.now();
    if (now - lastCapeHoverUpdateTime < 150)
      return;
    lastCapeHoverUpdateTime = now;

    let column = Math.floor(mouseXinSim * sim_res_x);
    column = guiControls.wrapHorizontally
      ? mod(column, sim_res_x)
      : clamp(column, 0, sim_res_x - 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, capeColumnFBO.frameBuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(column, 0, 1, 1, gl.RGBA, gl.FLOAT, capeHoverValues);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    capeHoverTooltip.innerHTML =
      '<strong>Surface-parcel CAPE estimate: ' + Math.round(capeHoverValues[0]) + ' J/kg</strong>' +
      '<span>Surface temperature: ' + capeHoverValues[1].toFixed(1) + ' °C</span>' +
      '<span>Surface dew point: ' + capeHoverValues[2].toFixed(1) + ' °C</span>' +
      '<span>LCL: ' + (capeHoverValues[3] / 1000).toFixed(2) + ' km</span>' +
      '<small>Approximate model-derived diagnostic</small>';
    capeHoverTooltip.style.left = Math.max(0, Math.min(canvasBounds.left + mouseX + 16, window.innerWidth - 270)) + 'px';
    capeHoverTooltip.style.top = Math.max(0, Math.min(canvasBounds.top + mouseY + 16, window.innerHeight - 130)) + 'px';
    capeHoverTooltip.hidden = false;
  }

  class Camera
  {
    #spring = 0.02;   // 0.02
    #damp = 0.70;     // 0.70
    wrapHorizontally; // bool
    smooth;           // bool
    curXpos;
    curXposLin;
    curYpos;
    curZoom;
    tarXpos;
    tarYpos;
    tarZoom;
    #Xvel;
    #Yvel;
    #Zvel;

    constructor()
    {
      this.curXpos = 0;
      this.curXposLin = 0;
      this.curYpos = -0.5 + sim_res_y / sim_res_x; // viewYpos = -0.5 + sim_res_y / sim_res_x;// match bottem of sim area to bottem of screen
      this.curZoom = 1.0001;
      this.tarXpos = 0;
      this.tarYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = 1.0001;
      this.wrapHorizontally = true;
      this.smooth = true;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    resetMotion()
    {
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    center()
    {
      this.tarXpos = this.curXpos = this.curXposLin = 0.0;
      this.tarYpos = this.curYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = this.curZoom = 1.0001;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    changeCurXpos(change)
    {
      this.curXposLin = this.curXposLin + change;
      this.curXpos = mod(this.curXposLin + 1.0, 2.0) - 1.0;
    }

    setPosition(x, y, zoom)
    {
      this.curXpos = this.tarXpos = x;
      this.curYpos = this.tarYpos = y;

      if (zoom)
        this.curZoom = this.tarZoom = zoom;
    }

    move()
    {
      let xDif = this.tarXpos - this.curXposLin;
      let yDif = this.tarYpos - this.curYpos;
      let zoomDif = this.tarZoom - this.curZoom;
      if (this.smooth) {
        this.#Xvel += xDif * this.#spring;
        this.#Xvel *= this.#damp;
        this.changeCurXpos(this.#Xvel);

        this.#Yvel += yDif * this.#spring;
        this.#Yvel *= this.#damp;
        this.curYpos += this.#Yvel;

        this.#Zvel += zoomDif * this.#spring;
        this.#Zvel *= this.#damp;
        this.curZoom += this.#Zvel;
      } else {
        this.changeCurXpos(xDif);
        this.curYpos += yDif;
        this.curZoom += zoomDif;
      }

      if (guiControls.sound && !guiControls.paused) {
        soundSystem.updateAmbientSound(this.curXpos, this.curYpos, this.curZoom);
      }
    }

    changeViewZoom(change)
    {
      this.tarZoom *= 1.0 + change;

      let minZoom = 0.5;
      let maxZoom = 35.0 * sim_aspect;

      if (this.tarZoom > maxZoom) {
        this.tarZoom = maxZoom;
        return false;
      } else if (this.tarZoom < minZoom) {
        this.tarZoom = minZoom;
        return false;
      } else {
        return true;
      }
    }

    changeViewXpos(change)
    {
      this.tarXpos += change;
      if (!this.wrapHorizontally)
        this.tarXpos = clamp(this.tarXpos, -0.99, 0.99);
    }

    changeViewYpos(change) { this.tarYpos = clamp(this.tarYpos + change, -2.50, 0.50); }

    zoomAtMousePos(delta)
    {
      if (cam.changeViewZoom(delta)) {
        // zoom center at mouse position
        var mousePositionZoomCorrectionX = (((mouseX - canvas.width / 2 + this.tarXpos) * delta) / cam.tarZoom / canvas.width) * 2.0;
        var mousePositionZoomCorrectionY = ((((mouseY - canvas.height / 2 + this.tarYpos) * delta) / cam.tarZoom / canvas.height) * 2.0) / canvas_aspect;
        this.changeViewXpos(-mousePositionZoomCorrectionX);
        this.changeViewYpos(mousePositionZoomCorrectionY);
      }
    }
  }

  cam = new Camera();


  class JetEngineSoundGenerator
  {
    constructor(ctx) { this.audioCtx = ctx; }

    createSource(bufferSize)
    {
      const bufferSource = this.audioCtx.createBufferSource();
      bufferSource.buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      return bufferSource;
    }

    createLowNoiseSource()
    {
      const bufferSize = 20 * this.audioCtx.sampleRate;
      const bufferSource = this.createSource(bufferSize);
      const data = bufferSource.buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 2)
        data[i] = Math.random() * 2 - 1;
      for (let i = 1; i < bufferSize - 1; i += 2)   // Fill in the gaps
        data[i] = (data[i - 1] + data[i + 1]) / 2.; // average of surrounding samples
      return bufferSource;
    }

    start()
    {
      // High-pitch turbine whine
      this.lowWhine = this.audioCtx.createOscillator();
      this.lowWhine.type = "sine";
      this.lowWhineGain = this.audioCtx.createGain();

      this.highWhine = this.audioCtx.createOscillator();
      this.highWhine.type = "sine";
      this.highWhineGain = this.audioCtx.createGain();

      // low rumble noise
      this.lowNoiseSource = this.createLowNoiseSource();
      this.lowNoiseSource.loop = true;
      this.lowNoiseFilter = this.audioCtx.createBiquadFilter();
      this.lowNoiseFilter.type = "lowpass";
      this.lowNoiseFilter.Q.value = 5.5;
      this.lowNoiseGain = this.audioCtx.createGain();

      // stereo pan
      this.pan = this.audioCtx.createStereoPanner();

      // Master mix
      this.mix = this.audioCtx.createGain();
      this.mix.gain.value = 0.;

      // Connect graph
      this.lowWhine.connect(this.lowWhineGain).connect(this.mix);
      this.highWhine.connect(this.highWhineGain).connect(this.mix);
      this.lowNoiseSource.connect(this.lowNoiseFilter).connect(this.lowNoiseGain).connect(this.mix);
      this.mix.connect(this.pan).connect(this.audioCtx.destination);

      // Start
      this.lowWhine.start();
      this.highWhine.start();
      this.lowNoiseSource.start();
    }

    update(N1, dist, horizontalAngle)
    {
      const rpm = N1 * 7000;
      const whineFreq = 100 + rpm * 1.0; // 300 + rpm * 0.8;
      const noiseFreq = N1 * 600;        // 200 + N1 * 300;

      this.lowWhine.frequency.value = whineFreq / 2.;
      this.highWhine.frequency.value = whineFreq;
      this.lowNoiseFilter.frequency.value = noiseFreq;

      const airVol = Math.sqrt(N1) * 3.;
      const whineVol = Math.sqrt(Math.min(N1, 0.3)) * 0.005;

      this.lowNoiseGain.gain.value = airVol;
      this.lowWhineGain.gain.value = whineVol;
      this.highWhineGain.gain.value = whineVol;

      dist += 1.0; // prevent devide by 0

      this.pan.pan.value = -horizontalAngle / 90.;
      this.mix.gain.value = 170.0 / dist;
    }

    mute()
    {
      if (this.mix)
        this.mix.gain.value = 0.;
    }

    stop()
    {
      this.mix.gain.value = 0;
      this.lowWhine.stop();
      this.highWhine.stop();
      this.lowNoiseSource.stop();
    }
  }

  class SoundSystem
  {
    audioCtx;
    jetEngineSound;

    #soundBufferPromises = new Map();
    #ambientSoundLoads = new Set();
    #ambientSoundLevels = new Map();
    #ambientWallReadbackBuffer = null;
    #ambientWeatherReadbackBuffer = null;
    #ambientReadbackSync = null;
    #ambientReadbackSample = null;
    #ambientReadbackWallValues = new Int8Array(800);
    #ambientReadbackBaseValues = new Float32Array(4);
    #ambientReadbackWaterValues = new Float32Array(4);
    #lastAmbientReadbackRequest = 0;
    #ambientSoundRevision = 0;

    urban_sound;
    forest_sound;
    beach_sound;
    rain_sound;
    wind_sound;


    constructor()
    {
      this.audioCtx = new window.AudioContext();
      this.jetEngineSound = new JetEngineSoundGenerator(this.audioCtx);
    }

    loadSound(url)
    {
      if (!this.#soundBufferPromises.has(url)) {
        const soundPromise = (async() => {
          const response = await fetch('resources/sounds/' + url);
          if (!response.ok)
            throw new Error(`Sound request failed with HTTP ${response.status}: ${url}`);
          const arrayBuffer = await response.arrayBuffer();
          return await this.audioCtx.decodeAudioData(arrayBuffer);
        })().catch(error => {
          console.error(`Unable to load sound "${url}".`, error);
          return null;
        });
        this.#soundBufferPromises.set(url, soundPromise);
      }
      return this.#soundBufferPromises.get(url);
    }

    setAmbientSoundGainAndPan(property, filename, gain, pan = 0.0)
    {
      const level = {
        gain : Number.isFinite(gain) ? gain : 0,
        pan : Number.isFinite(pan) ? pan : 0
      };
      this.#ambientSoundLevels.set(property, level);

      if (this[property]) {
        this.setSoundGainAndPan(this[property], level.gain, level.pan);
        return;
      }

      if (level.gain <= 0 || this.#ambientSoundLoads.has(property))
        return;

      this.#ambientSoundLoads.add(property);
      this.loadSound(filename).then(buffer => {
        if (!buffer)
          return;
        this[property] = this.playLoop(buffer, 0.0);
        const latestLevel = this.#ambientSoundLevels.get(property);
        this.setSoundGainAndPan(this[property], latestLevel.gain, latestLevel.pan);
      });
    }

    setAmbientSoundLeftRight(property, filename, left, right)
    {
      const gain = Math.max(left, right);
      const pan = gain > 0 ? (right - left) / gain : 0;
      this.setAmbientSoundGainAndPan(property, filename, gain, pan);
    }

    soundThunder(x, y, intensity)
    {
      let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;

      let camDistFromSim = cellHeight * sim_res_x * 0.5 / cam.curZoom; // asuming 90° HFOV

      let camHorDistFromStrike = (x - camXnorm) * cellHeight * sim_res_x;

      let vecStrikeToCam = new Vec2D(camDistFromSim, camHorDistFromStrike);

      let distance = vecStrikeToCam.mag();

      let leftRightBalance = -vecStrikeToCam.angle();

      // console.log(camDistFromSim, camHorDistFromStrike, distance, leftRightBalance);

      // Speed of sound ≈ 343 m/s
      let soundDelay = distance / 343;                                            // in seconds

      let simTimeMult = timePerIteration * guiControls.IterPerFrame * FPS * 3600; // how much faster sime time is than real time

      soundDelay /= simTimeMult;

      const soundType = intensity > 1.0 ? 'cg' : 'cc';
      const soundNumber = Math.floor(Math.random() * 13) + 1;
      this.loadSound(`${soundType}${soundNumber}.mp3`).then(buffer => {
        if (buffer)
          this.playOnce(buffer, intensity / (distance * 0.001), leftRightBalance, soundDelay);
      });
    }

    playOnce(buffer, volume = 1, leftRightBalance = 0, delay = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = false;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start(this.audioCtx.currentTime + delay);
    }

    playLoop(buffer, volume = 1, leftRightBalance = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = true;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start();
      return {gain : gain.gain, pan : pan.pan};
    }

    updateAmbientSound(Xpos, Ypos, zoom)
    {
      this.#pollAmbientSoundReadback();

      const now = performance.now();
      const camDistFromSim = cellHeight * sim_res_x * 0.5 / zoom; // assuming 90° HFOV
      if (!this.#ambientReadbackSync && camDistFromSim < 5000 &&
          now - this.#lastAmbientReadbackRequest >= 100) {
        const sampleWidth = Math.floor(clamp(camDistFromSim / cellHeight * 3, 30, 200));
        const sampleWidth_2 = Math.floor(sampleWidth / 2);
        const simXpos = Math.floor((-Xpos + 1) * 0.5 * sim_res_x);
        const simYpos = clamp(Math.floor((-Ypos * sim_aspect + 1) * 0.5 * sim_res_y), 0, sim_res_y - 1);
        if (!this.#ambientWallReadbackBuffer) {
          this.#ambientWallReadbackBuffer = gl.createBuffer();
          if (!this.#ambientWallReadbackBuffer)
            throw new Error('Unable to allocate ambient-audio surface readback buffer.');
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#ambientWallReadbackBuffer);
          gl.bufferData(gl.PIXEL_PACK_BUFFER, this.#ambientReadbackWallValues.byteLength, gl.STREAM_READ);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#ambientWallReadbackBuffer);
        gl.readBuffer(gl.COLOR_ATTACHMENT2);
        gl.readPixels(simXpos - sampleWidth_2, simYpos, sampleWidth, 1, gl.RGBA_INTEGER, gl.BYTE, 0);
        const readbackSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (!readbackSync) {
          gl.deleteBuffer(this.#ambientWallReadbackBuffer);
          this.#ambientWallReadbackBuffer = null;
          throw new Error('Unable to synchronize ambient-audio pixel readback.');
        }

        this.#ambientReadbackSync = readbackSync;
        this.#ambientReadbackSample = {
          sampleWidth,
          sampleWidth_2,
          camDistFromSim,
          simXpos,
          simYpos,
          soundRevision : this.#ambientSoundRevision,
          stage : 'wall'
        };
        this.#lastAmbientReadbackRequest = now;
      }

      if (airplaneMode) {
        let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;
        let camYnorm = 1. - (cam.curYpos * sim_aspect + 1.0) / 2.0;

        //    console.log(camXnorm, airplane.phys.pos.x);

        const vecCamToPlaneOnFlatSimArea = airplane.phys.pos.copy().subtract(new Vec2D(camXnorm * cellHeight * sim_res_x, camYnorm * cellHeight * sim_res_y));

        const distCamToPlane = new Vec2D(vecCamToPlaneOnFlatSimArea.mag(), camDistFromSim).mag();

        const horizontalAngleCamToPlane = new Vec2D(camDistFromSim, vecCamToPlaneOnFlatSimArea.x).angle() * radToDeg;

        this.jetEngineSound.update(airplane.getN1(), distCamToPlane, horizontalAngleCamToPlane);
      }
    }

    #pollAmbientSoundReadback()
    {
      if (!this.#ambientReadbackSync)
        return;

      const status = gl.clientWaitSync(this.#ambientReadbackSync, 0, 0);
      if (status == gl.WAIT_FAILED) {
        this.#cancelAmbientSoundReadback();
        throw new Error('Unable to wait for ambient-audio pixel readback.');
      }
      if (status != gl.ALREADY_SIGNALED && status != gl.CONDITION_SATISFIED)
        return;

      const sample = this.#ambientReadbackSample;
      gl.deleteSync(this.#ambientReadbackSync);
      this.#ambientReadbackSync = null;

      if (sample.stage == 'wall') {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#ambientWallReadbackBuffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.#ambientReadbackWallValues);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteBuffer(this.#ambientWallReadbackBuffer);
        this.#ambientWallReadbackBuffer = null;
        sample.justAboveSurfaceCellY = clamp(
          sample.simYpos - this.#ambientReadbackWallValues[sample.sampleWidth_2 * 4 + 2] + 3,
          0,
          sim_res_y - 1
        );
        this.#ambientWeatherReadbackBuffer = gl.createBuffer();
        if (!this.#ambientWeatherReadbackBuffer)
          throw new Error('Unable to allocate ambient-audio weather readback buffer.');
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#ambientWeatherReadbackBuffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, Float32Array.BYTES_PER_ELEMENT * 8, gl.STREAM_READ);
        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(sample.simXpos, sample.justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, 0);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(sample.simXpos, sample.justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, 16);
        this.#ambientReadbackSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (!this.#ambientReadbackSync) {
          gl.deleteBuffer(this.#ambientWeatherReadbackBuffer);
          this.#ambientWeatherReadbackBuffer = null;
          throw new Error('Unable to synchronize ambient-audio weather readback.');
        }
        sample.stage = 'weather';
        return;
      }

      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#ambientWeatherReadbackBuffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.#ambientReadbackBaseValues);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 16, this.#ambientReadbackWaterValues);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(this.#ambientWeatherReadbackBuffer);
      this.#ambientWeatherReadbackBuffer = null;
      this.#ambientReadbackSample = null;
      this.#applyAmbientSoundSample(sample);
    }

    #cancelAmbientSoundReadback()
    {
      if (this.#ambientReadbackSync)
        gl.deleteSync(this.#ambientReadbackSync);
      if (this.#ambientWallReadbackBuffer)
        gl.deleteBuffer(this.#ambientWallReadbackBuffer);
      if (this.#ambientWeatherReadbackBuffer)
        gl.deleteBuffer(this.#ambientWeatherReadbackBuffer);
      this.#ambientReadbackSync = null;
      this.#ambientWallReadbackBuffer = null;
      this.#ambientWeatherReadbackBuffer = null;
      this.#ambientReadbackSample = null;
    }

    #applyAmbientSoundSample(sample)
    {
      if (sample.soundRevision != this.#ambientSoundRevision || !guiControls.sound || guiControls.paused)
        return;

      const {sampleWidth, sampleWidth_2, camDistFromSim, justAboveSurfaceCellY} = sample;
      const cellsAboveSurface = this.#ambientReadbackWallValues[sampleWidth_2 * 4 + 2];
      const camHeightAboveSurface = cellsAboveSurface * cellHeight;
      const distanceToSurface = new Vec2D(camDistFromSim, camHeightAboveSurface).mag();
      const distVolumeMult = map_range_C(
        1.0 / (clamp(distanceToSurface, 1000, 5000) / 1000.0), 0.2, 1.0, 0.0, 1.0
      );
      const sampleWidth_3 = Math.floor(sampleWidth / 3);
      const forest = new Vec2D();
      const beach = new Vec2D();
      const urban = new Vec2D();

      for (let i = 0; i < sampleWidth; i++) {
        const leftGain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
        const rightGain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3 * 2)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
        const gain = new Vec2D(leftGain, rightGain);

        if (this.#ambientReadbackWallValues[i * 4] == 1) {
          const vegetationNorm = this.#ambientReadbackWallValues[i * 4 + 3] / 127.0;
          forest.add(gain.mult(vegetationNorm));
        } else if (this.#ambientReadbackWallValues[i * 4] == 2) {
          beach.add(gain);
        } else if (this.#ambientReadbackWallValues[i * 4] == 4 || this.#ambientReadbackWallValues[i * 4] == 6) {
          urban.add(gain);
        }
      }

      forest.mult(distVolumeMult * 0.15);
      beach.mult(distVolumeMult);
      urban.mult(distVolumeMult);
      this.setAmbientSoundLeftRight('forest_sound', 'forest.mp3', forest.x, forest.y);
      this.setAmbientSoundLeftRight('beach_sound', 'beach.mp3', beach.x, beach.y);
      this.setAmbientSoundLeftRight('urban_sound', 'urban.mp3', urban.x, urban.y);

      const baseTextureValues = this.#ambientReadbackBaseValues;
      const windVolume = Math.abs(baseTextureValues[0]) * 10.0 * distVolumeMult;
      this.setAmbientSoundGainAndPan('wind_sound', 'wind.mp3', windVolume);

      const tempC = KtoC(potentialToRealT(baseTextureValues[3], justAboveSurfaceCellY));
      let rainVolume = 0;
      if (tempC > 0) {
        rainVolume = Math.pow(this.#ambientReadbackWaterValues[2] * 0.5, 0.5);
        rainVolume *= map_range_C(tempC, 0., 3., 0., 1.);
        rainVolume *= distVolumeMult;
      }
      this.setAmbientSoundGainAndPan('rain_sound', 'rain.mp3', rainVolume);
    }

    setSoundGainAndPan(sound, gain, pan = 0.0)
    {
      if (!sound)
        return;

      sound.gain.value = Number.isFinite(gain) ? gain : 0;
      sound.pan.value = Number.isFinite(pan) ? pan : 0;
    }

    mute()
    {
      this.#ambientSoundRevision++;
      this.#cancelAmbientSoundReadback();
      this.setAmbientSoundGainAndPan('forest_sound', 'forest.mp3', 0);
      this.setAmbientSoundGainAndPan('beach_sound', 'beach.mp3', 0);
      this.setAmbientSoundGainAndPan('urban_sound', 'urban.mp3', 0);
      this.setAmbientSoundGainAndPan('rain_sound', 'rain.mp3', 0);
      this.setAmbientSoundGainAndPan('wind_sound', 'wind.mp3', 0);
      this.jetEngineSound.mute();
    }
  }

  // AIRPLANE

  class PIDController
  {
    #previousValue;
    #previousError;
    integral;

    constructor(kp, ki, kd, iThreshold)
    {
      this.kp = kp; // Proportional gain
      this.ki = ki; // Integral gain
      this.kd = kd; // Derivative gain
      this.iThreshold = iThreshold;
      this.resetState();
    }

    resetState()
    {
      this.#previousValue = 0;
      this.#previousError = 0;
      this.integral = 0;
    }

    update(setpoint, measuredValue)
    {
      const error = setpoint - measuredValue;

      const derivative = error - this.#previousError;

      let integralActive =
        this.iThreshold == null || (Math.abs(error) < this.iThreshold && Math.abs(derivative) < this.iThreshold / 100.); // only adjust integral if already close and stable to target

      if (integralActive)
        this.integral += error;
      else
        this.integral = 0;

      this.#previousError = error;
      this.#previousValue = measuredValue;

      let totalOutput = this.kp * error + this.kd * derivative;

      if (integralActive) {
        totalOutput += this.ki * this.integral;
      }

      return totalOutput;
    }
  }

  class Autopilot
  {
    mode;
    autoThrottleEnabled;
    targetPitch;
    targetAltitude;
    targetIAS;
    targetGlideslope;

    // dependencies:
    #instrumentPanel;
    #airplane;

    constructor(airplane)
    {
      this.#airplane = airplane;
      // PID for altitude to pitch
      this.altitudePID = new PIDController(0.04, 0.00003, 20.0, 100.0);
      // PID for pitch to elevator
      this.pitchPID = new PIDController(0.4, 0.001, 20.0, 5.0, true); // 0.5, 0.001, 100.0

      this.speedPID = new PIDController(0.05, 0.00005, 1.0, 10.0);

      // PID for glideslope to pitch
      this.glideslopePID = new PIDController(2.0, 0.0015, 5.0, 3.0);

      this.targetPitch = 0.0;
      this.targetAltitude = 5000.0;
      this.targetIAS = 0.0;
      this.mode = 'ALTITUDE';

      this.autoThrottleEnabled = false;

      this.targetGlideslope = -3.0;
    }

    bindInstrumentPanel(instrumentPanel) { this.#instrumentPanel = instrumentPanel; }

    setMode(mode) { this.mode = mode; }

    setAutoThrottle(ATHR_state) { this.autoThrottleEnabled = ATHR_state; }

    resetState()
    {
      this.altitudePID.resetState();
      this.pitchPID.resetState();
      this.speedPID.resetState();
      this.glideslopePID.resetState();
    }

    update(pitchAttitude, altitude, trueVel, IAS, vecToRunway, gearOnGround)
    {
      let targetIAS = this.targetIAS;

      switch (this.mode) {

      case 'ALTITUDE':
        this.targetPitch = clamp(this.altitudePID.update(this.targetAltitude, altitude) + 3.0, -6.0, 10.0); // add 3.0 degree pitch bias

        this.targetPitch *= 1.0 - Math.abs(trueVel.y) * 0.03;                                               // limit vertical speed

        break;
      case 'AUTOLAND':

        if (vecToRunway.x <= 4000) {
          this.#airplane.setGear(true);
        }

        let currentGlideslope = trueVel.angle() * radToDeg;
        let adjustedTargetGlideslope = 0.0;

        if (vecToRunway.x <= 200) {
          adjustedTargetGlideslope = Math.max((vecToRunway.y - 10) * -0.08, -2.0); // flare
          // targetGlideslope = Math.max(targetGlideslope, currentGlideslope); // prevent acelerating down when entering at shallow angle
          targetIAS = 0.0;

        } else {

          let slopeToRunway = vecToRunway.angle() * radToDeg;

          adjustedTargetGlideslope = this.targetGlideslope + clamp((slopeToRunway - this.targetGlideslope) * 3.0, -5.0, 3.0); // move towards ideal glideslope

          targetIAS = map_range_C(vecToRunway.x, 2000, 15000, 95, 128);                                                       // target speed depend on distance to runway
          this.#instrumentPanel.setTargetIAS(msToKnots(targetIAS));
        }

        this.targetPitch = clamp(this.glideslopePID.update(adjustedTargetGlideslope, currentGlideslope) + 0.0, -6.0, 10.0);

        break;
      }


      let throttle = clamp(this.speedPID.update(targetIAS, IAS) + 0.60, 0.0, 1.0); // add 60% thrust bias

      // console.log(this.targetAltitude, altitude, this.targetPitch);

      let elevator = clamp(this.pitchPID.update(this.targetPitch, pitchAttitude) + 0.2, -1.0, 1.0);


      if (gearOnGround) {
        elevator = 0.40;
        throttle = -1.0;
      }

      //  console.log(this.#desiredPitch, pitchAttitude, elevator);

      return [ elevator, throttle ];
    }
  }

  class N1Indicator
  {
    container;
    percentText;
    fillArc;
    arcLength;

    constructor(parentElement)
    {
      this.container = document.createElement('div');
      this.container.innerHTML += `
          <svg class="gauge" viewBox="0 90 320 90" aria-hidden="true">
            <path class="bg-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <path id="fillArc" class="fill-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <text id="percentText" x="160" y="140" class="value">0%</text>
          </svg>
      `;

      this.percentText = this.container.querySelector('#percentText');
      this.fillArc = this.container.querySelector('#fillArc');

      this.arcLength = this.fillArc.getTotalLength();
      this.fillArc.style.strokeDasharray = this.arcLength + ' ' + this.arcLength;
      this.fillArc.style.strokeDashoffset = this.arcLength;

      parentElement.appendChild(this.container);
    }

    getColor(p)
    {
      if (p < 80) {
        const ratio = p / 80;
        const r = Math.round(0 + ratio * 255);
        const g = 255;
        return `rgb(${r},${g},0)`;
      } else if (p < 100) {
        const ratio = (p - 90) / 10;
        const r = 255;
        const g = Math.round(255 - ratio * 155);
        return `rgb(${r},${g},0)`;
      } else {
        return `rgb(255,0,0)`;
      }
    }

    update(N1)
    {
      const p = N1 * 100.;
      this.percentText.textContent = p.toFixed(1) + '%';
      this.fillArc.style.stroke = this.getColor(p);
      const offset = this.arcLength * (1 - p / 100);
      this.fillArc.style.strokeDashoffset = offset;
    }
  }

  class InstrumentPanel
  {
    #instrumentCanvas;
    #panelImg;
    #targetAltInput;
    #targetIASInput;
    #targetGlideslopeInput;
    #autolandButton;
    #autoThrottleButton;
    #altHoldButton;
    #panelDiv;
    #N1Indicator;

    // dependencies:
    #autopilot

    constructor(autopilot)
    {
      this.#autopilot = autopilot;
      this.#panelDiv = document.createElement('div');
      this.#instrumentCanvas = document.createElement('canvas');
      this.#instrumentCanvas.width = 800;
      this.#instrumentCanvas.height = 660;
      this.#panelDiv.style.opacity = 0.7;
      this.#panelDiv.style.position = 'absolute';
      this.#panelDiv.style.bottom = 0;
      this.#panelDiv.style.right = 0;
      this.#panelDiv.style.left = 'auto';
      this.loadImages();
      this.genAutopilotBar(this.#panelDiv);
      this.#panelDiv.appendChild(this.#instrumentCanvas);
      body.appendChild(this.#panelDiv);
    }

    setDisplaySideRight(right)
    {
      if (right) {
        this.#panelDiv.style.right = 0;
        this.#panelDiv.style.left = 'auto';
      } else { // left
        this.#panelDiv.style.right = 'auto';
        this.#panelDiv.style.left = 0;
      }
    }

    setMode_AUTOLAND(on)
    {
      if (on) {
        this.#autopilot.setMode('AUTOLAND');
        this.#altHoldButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setMode_ALTITUDE(on)
    {
      if (on) {
        this.#autopilot.setMode('ALTITUDE');
        this.#autolandButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setAutoThrottle(ATHR_state) { this.#autopilot.setAutoThrottle(ATHR_state); }

    genAutopilotBar(panelDiv)
    {
      const container = document.createElement('div');

      const speedLabel = document.createElement('label');
      speedLabel.style = 'position: absolute; left: 10px;';

      this.#targetIASInput = document.createElement('input');
      this.#targetIASInput.type = 'number';
      this.#targetIASInput.id = 'speed';
      this.#targetIASInput.className = 'autopilotNumberInput';
      this.#targetIASInput.min = '0';
      this.#targetIASInput.max = '330';
      this.#targetIASInput.step = '5';
      this.#targetIASInput.value = '220';
      this.#targetIASInput.style = 'width: 150px;';
      this.#targetIASInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetIASInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      speedLabel.appendChild(this.#targetIASInput);

      const speedSpan = document.createElement('span');
      speedSpan.textContent = 'KT';
      speedSpan.style = 'position: absolute; right: 100px;';
      speedLabel.appendChild(speedSpan);
      container.appendChild(speedLabel);

      this.#autoThrottleButton = document.createElement('input');
      this.#autoThrottleButton.type = 'checkbox';
      this.#autoThrottleButton.id = 'athr';
      this.#autoThrottleButton.className = 'airbus-switch';
      this.#autoThrottleButton.addEventListener('change', () => this.setAutoThrottle(this.#autoThrottleButton.checked));
      container.appendChild(this.#autoThrottleButton);

      let athrLabel = document.createElement('label');
      athrLabel.htmlFor = 'athr';
      athrLabel.className = 'airbus-label';
      athrLabel.innerHTML = 'A/THR';
      athrLabel.style = 'position: absolute; left: 200px;';
      container.appendChild(athrLabel);

      this.#N1Indicator = new N1Indicator(container);

      const glideSlopeLabel = document.createElement('label');
      glideSlopeLabel.style = 'position: absolute; left: 420px;';

      this.#targetGlideslopeInput = document.createElement('input');
      this.#targetGlideslopeInput.type = 'number';
      this.#targetGlideslopeInput.id = 'targetGlideSlopeInput';
      this.#targetGlideslopeInput.className = 'autopilotNumberInput';
      this.#targetGlideslopeInput.name = 'altitude';
      this.#targetGlideslopeInput.min = '2';
      this.#targetGlideslopeInput.max = '6';
      this.#targetGlideslopeInput.step = '1';
      this.#targetGlideslopeInput.value = '3';
      this.#targetGlideslopeInput.style.width = '55px';
      this.#targetGlideslopeInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetGlideslopeInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      glideSlopeLabel.appendChild(this.#targetGlideslopeInput);

      const glidSlopeSpan = document.createElement('span');
      glidSlopeSpan.textContent = '°';
      glidSlopeSpan.style = 'position: absolute; right: 20px;';
      glideSlopeLabel.appendChild(glidSlopeSpan);
      container.appendChild(glideSlopeLabel);

      this.#autolandButton = document.createElement('input');
      this.#autolandButton.type = 'checkbox';
      this.#autolandButton.id = 'autoland';
      this.#autolandButton.className = 'airbus-switch';
      this.#autolandButton.addEventListener('change', e => {this.setMode_AUTOLAND(e.target.checked)});
      container.appendChild(this.#autolandButton);

      let autolandLabel = document.createElement('label');
      autolandLabel.htmlFor = 'autoland';
      autolandLabel.className = 'airbus-label';
      autolandLabel.innerHTML = 'LAND';
      autolandLabel.style = 'position: absolute; left: 500px;';
      container.appendChild(autolandLabel);

      this.#altHoldButton = document.createElement('input');
      this.#altHoldButton.type = 'checkbox';
      this.#altHoldButton.id = 'althold';
      this.#altHoldButton.className = 'airbus-switch';
      this.#altHoldButton.addEventListener('change', e => {this.setMode_ALTITUDE(e.target.checked)});
      container.appendChild(this.#altHoldButton);

      let altLabel = document.createElement('label');
      altLabel.htmlFor = 'althold';
      altLabel.className = 'airbus-label';
      altLabel.innerHTML = 'ALT';
      altLabel.style = 'position: absolute; left: 600px;';
      container.appendChild(altLabel);


      const targetAltitudeLabel = document.createElement('label');

      this.#targetAltInput = document.createElement('input');
      this.#targetAltInput.type = 'number';
      this.#targetAltInput.id = 'altitude';
      this.#targetAltInput.className = 'autopilotNumberInput';
      this.#targetAltInput.name = 'altitude';
      this.#targetAltInput.min = '0';
      this.#targetAltInput.max = '40000';
      this.#targetAltInput.step = '100';
      this.#targetAltInput.value = '10000';
      this.#targetAltInput.style.width = '55px';
      this.#targetAltInput.style = 'position: absolute; left: 670px;';
      this.#targetAltInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetAltInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      targetAltitudeLabel.appendChild(this.#targetAltInput);

      const targetAltSpan = document.createElement('span');
      targetAltSpan.textContent = 'ft';
      targetAltSpan.style = 'position: absolute; right: 70px;';
      targetAltitudeLabel.appendChild(targetAltSpan);

      container.appendChild(targetAltitudeLabel);


      container.style = 'height: 60px; display: flex; justify-content: space-between; align-items: center; background-color: #222222; color: white';

      panelDiv.appendChild(container);

      this.setMode_ALTITUDE();
    }

    setTargetIAS(targetIAS) { this.#targetIASInput.value = targetIAS.toFixed(0); }


    getTargetAlt() { return this.#targetAltInput.value / mToFt; }
    getTargetIAS() { return knotsToMs(this.#targetIASInput.value); }
    getTargetGlideslope() { return -this.#targetGlideslopeInput.value; }

    remove()
    {
      this.#instrumentCanvas.remove();
      this.#panelDiv.remove()
    }

    async loadImages() { this.#panelImg = await loadImage('resources/img/Panel.png'); }

    async display(pitchAngle, airAngle, altitude, radarAltitude, IAS, trueVel, OAT_C, throttle, N1, elevator, targetPitch, autopilotEn, gearStatus, runwayPointer, vecToRunway, brake)
    {
      let ctx = this.#instrumentCanvas.getContext('2d');
      let width = this.#instrumentCanvas.width - 50;
      let height = this.#instrumentCanvas.height;
      const topBarHeight = 50;
      let mainHeight = height - topBarHeight; // height of virtual horizon part

      let targetAltitude = this.getTargetAlt();
      let targetIAS = this.getTargetIAS();

      // ATTITUDE INDICATOR / VIRTUAL HORIZON:

      const pixPerDeg = 15.0;

      let y0 = mainHeight / 2 + topBarHeight + pitchAngle * pixPerDeg; // y pos of 0 deg pitch line

      ctx.beginPath();
      ctx.rect(0, -1000, width, 1000 + y0);
      ctx.fillStyle = '#05A3ED'; // blue
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0, y0, width, 1500);
      ctx.fillStyle = '#F0843C'; // brown
      ctx.fill();


      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      for (let i = Math.round((pitchAngle) / 10) * 10 - 50; i < pitchAngle + 50; i += 2.5) {
        let y = y0 - i * pixPerDeg;
        if (i % 10 == 0) {
          ctx.moveTo(width / 2 - width * 0.15, y);
          ctx.lineTo(width / 2 + width * 0.15, y);
          if (i != 0) {
            ctx.fillText(i, width / 2 - width * 0.25, y + 12);
            ctx.fillText(i, width / 2 + width * 0.21, y + 12);
          }
        } else if (i % 5 == 0) {
          ctx.moveTo(width / 2 - width * 0.075, y);
          ctx.lineTo(width / 2 + width * 0.075, y);
        } else { // 2.5 deg
          ctx.moveTo(width / 2 - width * 0.0375, y);
          ctx.lineTo(width / 2 + width * 0.0375, y);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = 'yellow';
      ctx.beginPath();
      let moveIndY = mainHeight / 2 + topBarHeight + (pitchAngle - trueVel.angle() * radToDeg) * pixPerDeg; // airAngle
      ctx.moveTo(width / 2 - width * 0.15, moveIndY);
      ctx.lineTo(width / 2 + width * 0.15, moveIndY);
      ctx.stroke();

      ctx.strokeStyle = 'green';
      ctx.beginPath();
      let targIndY = mainHeight / 2 + topBarHeight + (pitchAngle - targetPitch) * pixPerDeg;
      ctx.moveTo(width / 2 - width * 0.15, targIndY);
      ctx.lineTo(width / 2 + width * 0.15, targIndY);
      ctx.stroke();

      if (vecToRunway.x < 150000) {
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        let runwayIndY = mainHeight / 2 + topBarHeight + (pitchAngle - runwayPointer) * pixPerDeg;
        ctx.moveTo(width / 2 - width * 0.15, runwayIndY);
        ctx.lineTo(width / 2 + width * 0.15, runwayIndY);
        ctx.stroke();
        ctx.fillStyle = 'blue';
        ctx.font = '20px serif';
        ctx.fillText(printDistance(vecToRunway.x), width / 2 - width * 0.15 - 70, runwayIndY - 5);
        ctx.fillText(printDistance(vecToRunway.y + 7.5), width / 2 + width * 0.15, runwayIndY - 5);
        ctx.fillText((vecToRunway.angle() * radToDeg).toFixed(1) + ' °', width / 2 + width * 0.23, runwayIndY - 5);
      }

      if (this.#panelImg)
        ctx.drawImage(this.#panelImg, 0, topBarHeight, width, mainHeight);

      // ALTITUDE INDICATOR:

      const altIndXpos = 640; // pos of vertical line

      ctx.beginPath();
      ctx.moveTo(altIndXpos, topBarHeight);
      ctx.lineTo(altIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let unit = ' m'

      if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL')
      {
        altitude *= mToFt;
        radarAltitude *= mToFt;
        targetAltitude *= mToFt;
        unit = ' ft'
      }

      const pxPerAlt = 0.65;
      const altRange = 500; // + and -

      ctx.beginPath();
      for (let i = Math.round((altitude - altRange) / 100) * 100; i < altitude + altRange; i += 50) {
        let y = mainHeight / 2 + topBarHeight - (i - altitude) * pxPerAlt;
        if (i % 100 == 0) {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 20, y);
          ctx.fillText(i, altIndXpos + 25, y + 12);
        } else {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 10, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight - 25, 113, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(altitude.toFixed(0) + unit, altIndXpos, mainHeight / 2 + topBarHeight + 10);

      // Show ground level
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight + radarAltitude * pxPerAlt, 100, 500);

      // Show target altitude
      ctx.beginPath();
      let targetAltY = mainHeight / 2 + topBarHeight + (altitude - targetAltitude) * pxPerAlt;
      ctx.moveTo(altIndXpos, targetAltY);
      ctx.lineTo(altIndXpos + 100, targetAltY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VELOCITY INDICATOR:
      const velIndXpos = 110;
      ctx.beginPath();
      ctx.moveTo(velIndXpos, topBarHeight);
      ctx.lineTo(velIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let stallSpeed = 70.0; // m/s
      let overSpeed = 173.0; // m/s

      if (guiControls.speedUnit == 'SPEED_UNIT_KT') {
        IAS = msToKnots(IAS);
        targetIAS = msToKnots(targetIAS);
        stallSpeed = msToKnots(stallSpeed);
        overSpeed = msToKnots(overSpeed);
        unit = ' kt'
      } else {
        unit = ' km/h'
        IAS *= 3.6; // convert m/s to km/h
        targetIAS *= 3.6;
        stallSpeed *= 3.6;
        overSpeed *= 3.6;
      }

      const pxPerVel = 10.0;
      const velRange = 35; // + and -

      ctx.beginPath();
      for (let i = Math.max(Math.round((IAS) / 10) * 10 - velRange, 0); i < IAS + velRange; i += 5) {
        let y = mainHeight / 2 + topBarHeight - (i - IAS) * pxPerVel;
        if (i % 10 == 0) {
          ctx.moveTo(velIndXpos - 20, y);
          ctx.lineTo(velIndXpos, y);
          ctx.fillText(i, 0, y + 12);
        } else {
          ctx.moveTo(velIndXpos - 10, y);
          ctx.lineTo(velIndXpos, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight - 25, velIndXpos + 3, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(IAS.toFixed(0) + unit, 0, mainHeight / 2 + topBarHeight + 10);

      // Show stall speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - stallSpeed) * pxPerVel, velIndXpos + 3, 5000);

      // Show over speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - overSpeed) * pxPerVel - 5000, velIndXpos + 3, 5000);

      // Show target IAS
      ctx.beginPath();
      let targetIasY = mainHeight / 2 + topBarHeight + (IAS - targetIAS) * pxPerVel;
      ctx.moveTo(0, targetIasY);
      ctx.lineTo(velIndXpos + 3, targetIasY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VERTICAL VElOCITY INDICATOR
      ctx.fillStyle = 'black';
      ctx.fillRect(width, topBarHeight, 50, mainHeight);
      let hue = clamp(120.0 + trueVel.y * 10.0, 0.0, 200.0);
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

      let verticalSpeedIndicatorVal = trueVel.y < 0 ? Math.sqrt(-trueVel.y) : -Math.sqrt(trueVel.y);
      ctx.fillRect(width + 10, mainHeight / 2 + topBarHeight, 30, verticalSpeedIndicatorVal * 40.);

      ctx.fillStyle = 'black';
      ctx.fillRect(width, mainHeight / 2 + topBarHeight - 13, 50, 26);

      const [veloStr, unitStr] = printVerticalVelocity(trueVel.y);

      ctx.font = '20px serif';
      ctx.fillStyle = 'white';
      ctx.fillText(veloStr, width, mainHeight / 2 + topBarHeight + 6);
      ctx.fillText(unitStr, width + 10, mainHeight / 2 + topBarHeight + 22);

      // OVERHEAD
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, this.#instrumentCanvas.width, topBarHeight);

      ctx.fillStyle = '#00FFFF';
      ctx.font = '30px serif';
      ctx.fillText('🌡 ' + printTemp(OAT_C), 0, 40);

      ctx.fillStyle = '#FFFF00';
      ctx.fillText('🎚️ ' + throttle.toFixed() + ' %', 140, 40);

      this.#N1Indicator.update(N1);

      let gearStatusIndicator = '';
      if (gearStatus == 'UP') {
        gearStatusIndicator = 'UP';
        ctx.fillStyle = '#444444';
      } else if (gearStatus == 'EXTENDING' || gearStatus == 'RETRACTING') {
        gearStatusIndicator = 'UNLK';
        ctx.fillStyle = '#FF0000';
      } else if (gearStatus == 'DOWN') {
        gearStatusIndicator = '▽▽▽';
        ctx.fillStyle = '#00FF00';
      }
      ctx.fillText(gearStatusIndicator, 290, 40);


      let AOA = pitchAngle - airAngle;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('∠ ' + AOA.toFixed(1) + '°', 410, 40);

      if (AOA > 14.0) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('STALL!', 605, 40);
      }

      if (autopilotEn) {
        ctx.fillStyle = '#00FF00';
        ctx.fillText('AP', 540, 40);
      }

      if (IAS > overSpeed) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('Overspeed!', 605, 40);
      }

      // BELOW VIRTUAL HORIZON

      ctx.fillStyle = '#AAA';
      ctx.fillText('GS: ' + printVelocity(trueVel.mag()), 130, 640);

      if (brake) {
        ctx.fillStyle = '#F00';
        ctx.fillText('BRAKE', 340, 640);
      }

      ctx.fillStyle = '#AAA';
      ctx.fillText('ELE: ' + elevator.toFixed(2), 500, 640);
    }
  }


  const dt = 1. / FPS;

  class PhysicsObject
  {        // 2D PhysicsObject
    m;     // mass in kg
    I;     // moment of inertia
    pos;   // in meters
    vel;   // in m/s
    angle; // radians
    aVel;  // angular velocity in rad/s

    constructor(m, I, x, y, vx, vy)
    {
      this.m = m;
      this.I = I;
      this.pos = new Vec2D(x, y);
      this.vel = new Vec2D(vx, vy);
      this.angle = 0.0;
      this.aVel = 0.0;
    }

    applyAcceleration(a) { this.vel.add(a.mult(dt)); }

    applyForce(F, pos) // position relative to center
    {
      F.mult(dt);
      this.vel.add(F.copy().div(this.m)); // simply apply force at center of mass
      if (pos != null) {                  // apply torque if force not applied at the center of mass

        let angleToCm = pos.angle();      // angle to center of mass

                                          // console.log(F);
        F.rotate(-angleToCm); // make force vector perpendicular to vector to center off mass

                              // console.log('After rotating ', F, angleToCm * radToDeg);

        let torque = -F.y * pos.mag(); // if force perpendicular to vector from center, mult by dist from center
        this.aVel += torque / this.I;
      }
    }

    move(directionIsLeft)
    {
      let movementPerFrame = this.vel.copy();
      movementPerFrame.mult(dt);
      if (!directionIsLeft)
        movementPerFrame.x = -movementPerFrame.x;
      this.pos.add(movementPerFrame);
      this.pos.x = mod(this.pos.x, sim_res_x * cellHeight); // make sure airplane position stays within sim area
      this.angle += this.aVel * dt;                         // rotate
    }
  }

  class JetEngine
  {
    N1;     // 0. to 1.
    thrust; // 0. to 1.
    starting;
    started;

    constructor()
    {
      this.N1 = 0.186;
      this.starting = false;
      this.started = true;
    }

    toggle()
    {
      if (this.started) {
        this.stop();
      } else {
        this.start();
      }
    }

    start()
    {
      if (!this.started) {
        this.starting = true;
      }
    }

    stop()
    {
      this.started = false;
      this.starting = false;
    }

    update(throttle)
    {
      if (this.starting) {
        this.N1 += 0.00008;
        this.N1 *= 1.006;
        if (this.N1 >= 0.15) {
          this.starting = false;
          this.started = true;
        }
      } else if (this.started)
        this.N1 += (Math.abs(throttle) + 0.223) * 0.0042;

      this.N1 *= 0.995; // drag

      this.thrust = Math.pow(this.N1, 2.0);

      return throttle < 0. ? this.thrust * -0.7 : this.thrust;
    }
  }

  class Airplane
  {
    #instrumentPanel;
    #autopilot;

    directionIsLeft; // false means right

    #relVelAngle;    // angle of velocity relative to air
    #airspeed;       // true airspeed, m/s
    #groundSpeed;
    #IAS;            // indicated airspeed, m/s
    #camFollow;
    #OAT;            // outdoor air temperature

    #radarAltitude;  // meters above ground
    #framesSinceCrash;
    #gearExtPos;     // down: 0.0  up: 7.0
    #gearOnGround;   // if the wheels are touching the ground
    #braking;

    #runwayThresholdPos;

    // Controls
    elevator;
    throttle;
    prevThrottle;

    #gearStatus; // UP EXTENDING DOWN RETRACTING
    #autopilotEnabled;

    jetEngine;

    phys; // physics object, containing all physical properties including position and velocity

    getClosestRunwayPos()
    {
      let Xpos = Math.floor(mod(this.phys.pos.x / cellHeight, sim_res_x));
      // let Ypos = Math.floor(clamp(this.phys.pos.y / cellHeight + 1.0, 100, sim_res_y - 1));

      let Ypos = 90;

      // console.log(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
      var wallTextureValues = new Int8Array(sim_res_x * 4);
      gl.readPixels(0, Ypos, sim_res_x, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      if (this.directionIsLeft) {
        let x = Xpos - 1;
        while (x != Xpos) {
          if (x < 0)
            x = sim_res_x - 1;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x--;
        }
      } else { // direction is right
        let x = Xpos + 1;
        while (x != Xpos) {
          if (x > sim_res_x - 1)
            x = 0;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x++;
        }
      }
      return new Vec2D(0, 0);
    }

    constructor()
    {
      this.#camFollow = true;
      this.phys = new PhysicsObject(1, 1, 0, 0);
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#IAS = 0.0;
      this.#OAT = 0.0;
      this.#airspeed = 0.0;
      this.#groundSpeed = 0.0;
      this.#autopilotEnabled = false;
      this.#gearOnGround = false;
      this.#braking = false;
      this.#runwayThresholdPos = new Vec2D(0, 0);
    }

    toggleCamFollow()
    {
      if (airplaneMode)
        this.#camFollow = !this.#camFollow;
    }

    enableAirplaneMode(autopilotEn)
    {
      this.#autopilot = new Autopilot(this);
      this.setAutopilot(autopilotEn);
      this.#instrumentPanel = new InstrumentPanel(this.#autopilot);
      this.#autopilot.bindInstrumentPanel(this.#instrumentPanel);
      airplaneMode = true;
      this.directionIsLeft = true; // left
      this.#camFollow = true;
      let M = 400 * 1000;          // mass: 400 tons
      let L = 50.0;                // effective length in meters
      let I = 1 / 12 * M * L * L;  // moment of inertia

      let simXpos = Math.floor(mouseXinSim * sim_res_x);
      let simYpos = findSimYposAboveSurfaceAtMouseX();

      let startsOnSurface = simYpos > (mouseYinSim * sim_res_y); // It is placed above the mouse position

      let planePosX = simXpos * cellHeight;
      let planePosY = Math.min(simYpos * cellHeight - (startsOnSurface ? 32.0 : 0.0), 15000.0);

      let velX = startsOnSurface ? 0.0 : map_range_C(mouseYinSim, 0.0, 1.0, -100.0, -200);

      this.phys = new PhysicsObject(M, I, planePosX, planePosY, velX, 0.0);
      this.phys.angle = startsOnSurface ? 0.0 : 5.0 * degToRad;
      this.throttle = startsOnSurface ? 0.00 : 0.40; // %

      if (startsOnSurface) {
        this.#gearStatus = 'DOWN';
        this.#gearExtPos = 0.0;
      } else {
        this.#gearStatus = 'UP';
        this.#gearExtPos = 7.0;

        this.#runwayThresholdPos = this.getClosestRunwayPos();
      }

      cam.tarZoom = 100.0;

      this.jetEngine = new JetEngine();
      soundSystem.jetEngineSound.start();
    }

    changeDirection()
    {
      if (this.directionIsLeft) {
        if (!confirm('Do you want to change the flight direction to Right?'))
          return;
      } else {
        if (!confirm('Do you want to change the flight direction to Left?'))
          return;
      }
      this.directionIsLeft = !this.directionIsLeft;
      this.#instrumentPanel.setDisplaySideRight(this.directionIsLeft);
      this.#runwayThresholdPos = this.getClosestRunwayPos();
    }

    disableAirplaneMode()
    {
      airplaneMode = false;
      this.#framesSinceCrash = -1;
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#camFollow = false;
      this.display(); // run display function one more time to update uniforms
      this.#instrumentPanel.remove();
      document.body.style.cursor = 'default';
      soundSystem.jetEngineSound.stop();
    }

    getN1() { return this.jetEngine ? this.jetEngine.N1 : 0.0; }

    onUpPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = +0.01;
      }
    }

    onDownPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = -0.01;
      }
    }

    setBrakes(enabled) { this.#braking = enabled; }

    toggleEngine() { this.jetEngine.toggle(); }

    toggleGear() { this.setGear(this.#gearStatus == 'UP'); }

    setGear(boolDown)
    {
      if (boolDown) {
        if (this.#gearStatus == 'UP')
          this.#gearStatus = 'EXTENDING';

      } else {
        if (this.#gearStatus == 'DOWN')
          this.#gearStatus = 'RETRACTING';
      }
    }

    // https://aviation.stackexchange.com/questions/64490/is-there-a-simple-relationship-between-angle-of-attack-and-lift-coefficient/97747#97747?newreg=547ea95b1d784abf993b7d1850dcc938
    Cl(AOA) // lift coefficient https://www.desmos.com/calculator/aeeizqvarp
    {
      let lift = 0.0;
      if ((AOA > 0. && AOA < PI / 7.23) || (AOA > 7. / 8.124 * PI && AOA < PI)) {
        lift = Math.sin(6. * AOA);
      } else {
        lift = Math.sin(2. * AOA);
      }
      return lift;
    }

    Cd(AOA) // drag coefficient
    {
      return 1.0 - Math.cos(2 * AOA);
    }

    move()
    {
      if (this.#framesSinceCrash >= 0) {
        this.#framesSinceCrash++;
        if (this.#framesSinceCrash > 30)
          this.disableAirplaneMode();
        return;
      }

      let Xpos = mod(this.phys.pos.x / cellHeight - 1., sim_res_x);
      let Ypos = Math.min(this.phys.pos.y / cellHeight + 1.0, sim_res_y - 1);

      let fractX = fract(Xpos);
      let fractY = fract(Ypos);

      Xpos = Math.floor(Xpos);
      Ypos = Math.floor(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);                                   // basetexture
      var baseTextureValues = new Float32Array(4 * 2 * 2);
      gl.readPixels(Xpos, Ypos, 2, 2, gl.RGBA, gl.FLOAT, baseTextureValues); // order bottem up: x0y0 x1y0 x0y1 x1y1

      let temperature = KtoC(potentialToRealT(baseTextureValues[3], Ypos));

      function fract(f) { return f % 1.; }
      function mix(x, y, a) { return x * (1. - a) + y * a; }

      function bilerp(array, ind, fractX, fractY) // ind: index of value in array to get
      {
        let top = mix(array[2 * 4 + ind], array[3 * 4 + ind], fractX);
        let bottem = mix(array[0 * 4 + ind], array[1 * 4 + ind], fractX);
        return mix(bottem, top, fractY);
      }


      // Linearly interpolatate velocity
      let Vx = bilerp(baseTextureValues, 0, fractX, fractY);
      let Vy = bilerp(baseTextureValues, 1, fractX, fractY);

      let airVel = new Vec2D(this.directionIsLeft ? Vx : -Vx, Vy);

      if (this.phys.pos.y > guiControls.simHeight) {
        airVel.mult(0.0);              // still air above sim area
      } else {
        airVel.mult(cellHeight * 3.6); // convert to m/s
      }

      this.#OAT = temperature;

      // gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
      // var waterTextureValues = new Float32Array(4);
      // gl.readPixels(Xpos, Ypos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);
      // let dewpoint = KtoC(dewpoint(waterTextureValues[0]));

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int8Array(4 * 3 * 1);
      gl.readPixels(Xpos, Ypos, 3, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      // wrap arround the edge of the sim area
      if (Xpos == sim_res_x - 2) {
        gl.readPixels(0, Ypos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(2 * 4));
      } else if (Xpos == sim_res_x - 1) {
        gl.readPixels(0, Ypos, 2, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(1 * 4));
      }

      let radarAltL = (wallTextureValues[0 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltM = (wallTextureValues[1 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltR = (wallTextureValues[2 * 4 + 2] + fractY - 1.) * cellHeight;


      let radarAltFrontGear = this.directionIsLeft ? mix(radarAltL, radarAltM, Math.min(fractX + 0.14, 1.)) : mix(radarAltM, radarAltR, Math.min(fractX, 1.));

      this.#radarAltitude = Math.min(mix(radarAltL, radarAltM, fractX), mix(radarAltM, radarAltR, fractX));

      // console.log(Xpos, Ypos, radarAltL.toFixed(1), radarAltM.toFixed(1), radarAltR.toFixed(1), fractX);

      if (this.#gearStatus == 'EXTENDING') {
        this.#gearExtPos = Math.max(this.#gearExtPos - 0.01, 0.0);
        if (this.#gearExtPos == 0.0)
          this.#gearStatus = 'DOWN';
      } else if (this.#gearStatus == 'RETRACTING') {
        this.#gearExtPos = Math.min(this.#gearExtPos + 0.01, 7.0);
        if (this.#gearExtPos == 7.0)
          this.#gearStatus = 'UP';
      }

      let heightAboveGround = this.#radarAltitude;

      let heightAboveObstacles = radarAltM;

      let gearTouchAlt = 8.0 - this.#gearExtPos;

      let bounceForceMult = 100000.0;

      if (wallTextureValues[1 * 4 + 0] == 1) { // over land

        let treeHeight = map_range_C(wallTextureValues[1 * 4 + 3], 80, 127, 0., 15.);
        heightAboveObstacles -= treeHeight;

      } else if (wallTextureValues[1 * 4 + 0] == 2) { // over water
        heightAboveObstacles += 20.;
        gearTouchAlt = -5.0;                          // + (7.0 - this.#gearExtPos) * 0.2;
        bounceForceMult = 9000.0 + Math.abs(this.phys.vel.x) * 600.0;

        let draught = gearTouchAlt - heightAboveGround;
        if (draught > 0.0) {
          let waterDragForce = this.phys.vel.x * -50000.0 * draught;
          // console.log(waterDragForce);
          if (waterDragForce > 3000000 || this.#gearExtPos < 7.0) { // crash on water
            guiControls.IterPerFrame = 1;
            guiControls.auto_IterPerFrame = false;
            this.#framesSinceCrash = 0;
            soundSystem.jetEngineSound.stop();
          }

          this.phys.applyForce(new Vec2D(waterDragForce, 0.));

          this.jetEngine.stop();
        }

      } else if (wallTextureValues[1 * 4 + 0] == 4) { // over urban
        heightAboveObstacles -= 80.0;
      }

      let mainGearForce = Math.max(gearTouchAlt - heightAboveGround, 0.0) * bounceForceMult * 100.0;

      if (mainGearForce > 0.0) {
        this.#gearOnGround = true;
        mainGearForce -= this.phys.vel.y * 500000; // damping
      } else {
        this.#gearOnGround = false;
      }

      this.phys.applyForce(new Vec2D(0.0, mainGearForce), new Vec2D(1., 0.));

      let frontGearPosX = 36.0;                                                         // m

      let frontGearAlt = radarAltFrontGear + Math.sin(this.phys.angle) * frontGearPosX; // front gear altitude is not completely acurate yet

      let frontGearForce = Math.max(gearTouchAlt - frontGearAlt, 0.0) * bounceForceMult * 5.0;

      if (frontGearForce > 0.0)
        frontGearForce -= this.phys.aVel * 5000000; // damping

      this.phys.applyForce(new Vec2D(0.0, -frontGearForce), new Vec2D(-frontGearPosX, 0.));

      let gearPos = clamp(-(heightAboveGround - gearTouchAlt), 0.0, 5.0) + this.#gearExtPos; // 0 is all the way down, positive is up into the airplane

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeDirectionAndGearPos'), this.directionIsLeft, gearPos);

      if (wallTextureValues[0] != 2 && (heightAboveObstacles < 6.0 || radarAltL < 6.0 || (heightAboveObstacles < 10.0 && Math.abs(this.phys.angle) > 0.25))) { // crash into the surface
        guiControls.IterPerFrame = 1;
        guiControls.auto_IterPerFrame = false;
        this.#framesSinceCrash = 0;
        soundSystem.jetEngineSound.stop();
      }

      this.#groundSpeed = this.phys.vel.mag();

      let relVel = this.phys.vel.copy().subtract(airVel);           // velocity relative to air
      this.#airspeed = relVel.mag();                                // true airspeed in m/s
      let relAlt = this.phys.pos.y / 12000.0;                       // 12000 m = 1.0
      let relAirDensity = Math.pow(1. - relAlt * 0.47, 2.0);        // 1.0 is sea level, 0.28 is 12000 meters
      let relIndVel = relVel.copy().mult(Math.sqrt(relAirDensity)); // convert velocity relative to air to indicated, wich is also what the airplane feels

      this.#IAS = relIndVel.mag();

      // this.phys.angle += this.elevator * 0.001; // simple pitch control for testing

      // this.#relVelAngle = this.phys.vel.angle(); // ignore air movement for testing
      this.#relVelAngle = relVel.angle();


      let AOA = this.phys.angle - this.#relVelAngle;
      let dynamicPressMult = relIndVel.magSq(); // dynamic pressure
      let liftForce = this.Cl(AOA) * dynamicPressMult * 800.0;
      let dragForce = this.Cd(AOA) * dynamicPressMult * 800.0;

      // console.log(Math.round(liftForce, 1), Math.round(dragForce, 1));
      // console.log((liftForce / dragForce).toFixed(1));
      // console.log(Math.abs(this.phys.vel.x));

      let mainWingForce = new Vec2D(dragForce, liftForce);
      mainWingForce.rotate(this.#relVelAngle);
      this.phys.applyForce(mainWingForce); // Apply Main wing force at center off mass

      // console.log('this.elevator ' + this.elevator);

      let vertStabilAOA = AOA - (this.elevator * 15.0 + 3.0) * degToRad; // angled at -12 to 18 degrees relative to main wing with 3 deg center position

      // console.log('vertStabilAOA ', vertStabilAOA * radToDeg);

      let vertStabilPos = new Vec2D(35., 0.); // 35 meters to the right of the center of mass
      vertStabilPos.rotate(this.phys.angle);
      // console.log('vertStabilPos ', vertStabilPos);
      let vertStabilForce = new Vec2D(this.Cd(vertStabilAOA) * dynamicPressMult * 40.0, this.Cl(vertStabilAOA) * dynamicPressMult * 40.0);
      vertStabilForce.rotate(this.#relVelAngle);

      // console.log((vertStabilAOA * radToDeg).toFixed(2), vertStabilForce.copy().div(10000));

      let thrust = this.jetEngine.update(this.throttle);

      let thrustAltMult = 0.5 + relAirDensity * 0.5;

      this.phys.applyForce(vertStabilForce, vertStabilPos);                                        // apply vertical stabiliser force
      this.phys.applyForce(Vec2D.fromAngle(this.phys.angle, thrust * thrustAltMult * 311000 * 4)); // Thrust 4 X 311 kN
      this.phys.applyAcceleration(new Vec2D(0.0, -9.81));                                          // gravity

      let normRelVel = new Vec2D(Math.cos(this.#relVelAngle), Math.sin(this.#relVelAngle));
      let dragMult = (this.#gearStatus == 'UP' ? 25.0 : 35.0) + Math.abs(Math.sin(AOA) * 150.0);
      let dragMag = dynamicPressMult * dragMult;

      this.phys.applyForce(new Vec2D(normRelVel.x * dragMag, -normRelVel.y * dragMag));

      if (this.#gearOnGround) {
        let gearDragForce = (this.#braking ? 1100000.0 : 50000.0); // braking and wheel friction

        this.phys.applyForce(new Vec2D(this.phys.vel.x > 0.0 ? -gearDragForce : gearDragForce, 0.));
      }

      this.phys.aVel *= 1. - 0.15 * dt; // angular velocity drag

      this.phys.move(this.directionIsLeft);
    }

    hasCrashed() { return this.#framesSinceCrash >= 0; }

    setAutopilot(enabledIn)
    {
      document.body.style.cursor = enabledIn ? 'default' : 'crosshair';
      this.#autopilotEnabled = enabledIn;

      if (enabledIn == true) {
        this.#runwayThresholdPos = this.getClosestRunwayPos();
        this.#autopilot.resetState();
        this.#autopilot.targetPitch = this.phys.angle * radToDeg;
      }
    }

    calcVecToRunway()
    {
      if (this.directionIsLeft) {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x > this.#runwayThresholdPos.x) {               // to the right of runway
          distToRunwayX = this.phys.pos.x - this.#runwayThresholdPos.x;
        } else if (this.phys.pos.x > this.#runwayThresholdPos.x - 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      } else {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x < this.#runwayThresholdPos.x) {               // to the left of runway
          distToRunwayX = this.#runwayThresholdPos.x - this.phys.pos.x;
        } else if (this.phys.pos.x < this.#runwayThresholdPos.x + 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      }
    }

    takeUserInput()
    {
      this.prevThrottle = this.throttle;

      if (upPressed) {
        this.throttle += 0.01;
      } else if (downPressed) {
        this.throttle -= 0.01;
      }

      const [autopilotElevator, autopilotThrottle] = this.#autopilot.update(this.phys.angle * radToDeg, this.phys.pos.y, this.phys.vel, this.#IAS, this.calcVecToRunway(), this.#gearOnGround);

      this.#autopilot.targetAltitude = this.#instrumentPanel.getTargetAlt();
      this.#autopilot.targetIAS = this.#instrumentPanel.getTargetIAS();
      this.#autopilot.targetGlideslope = this.#instrumentPanel.getTargetGlideslope();

      if (this.#autopilot.autoThrottleEnabled) {
        this.throttle = autopilotThrottle;

        if (this.throttle < 0.0)
          this.#braking = true;
      }

      const gp = navigator.getGamepads()[0];

      if (this.#autopilotEnabled) {

        this.elevator = autopilotElevator;
      } else if (gp) {
        this.elevator = -gp.axes[1];
      } else {                                                              // manual elevator control
        this.elevator = (mouseY - canvas.height / 2) / canvas.height * 2.0; // pitch input -1.0 to +1.0
      }

      // this.elevator /= 1.0 + Math.max(this.#airspeed - 80, 0.) * 0.01;          // limit elevator throw at higher airspeed
      this.elevator += Math.max(-this.phys.angle * radToDeg - 50.0, 0.) * 0.03; // limit elevator to prevent going down steeper than vertical
      this.elevator -= Math.max(this.phys.angle * radToDeg - 50.0, 0.) * 0.03;  // limit elevator to prevent going up steeper than vertical

      // console.log(this.phys.angle * radToDeg, this.elevator);

      if (gp) {
        if (!this.#autopilot.autoThrottleEnabled) {
          this.throttle = (gp.axes[2] + 1.) / 2.;
          this.throttle *= -gp.axes[4]; // reverse thrust
        }
        this.#braking = gp.buttons[0].pressed;

        this.setGear(gp.axes[7] > 0.)
      }

      this.throttle = clamp(this.throttle, (this.#gearOnGround && (this.prevThrottle < 0. || this.#autopilot.autoThrottleEnabled || gp)) ? -0.3 : 0.0,
                            (this.prevThrottle > 0. || this.#autopilot.autoThrottleEnabled || gp) ? 1.0 : 0.0);
    }

    display()
    {
      let normXpos = this.phys.pos.x / cellHeight / sim_res_x;
      let normYpos = (this.phys.pos.y / cellHeight + 1.0) / sim_res_y;

      // console.log(normXpos, normYpos);
      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planePos'), normXpos, normYpos, this.directionIsLeft ? this.phys.angle : -this.phys.angle);
      gl.useProgram(advectionProgram);
      gl.uniform4f(gl.getUniformLocation(advectionProgram, 'airplaneValues'), normXpos, normYpos, this.throttle, this.#framesSinceCrash > 0 ? 1.0 : (zPressed ? -1.0 : 0.0));
      gl.useProgram(skyBackgroundDisplayProgram);

      if (this.#camFollow) {
        cam.tarXpos = -normXpos * 2.0 + 1.0;
        cam.tarYpos = -normYpos * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x);
      }

      let vecToRunway = this.calcVecToRunway();

      this.#instrumentPanel.display(this.phys.angle * radToDeg, this.#relVelAngle * radToDeg, this.phys.pos.y, this.#radarAltitude, this.#IAS, this.phys.vel, this.#OAT, this.throttle * 100.0,
                                    this.jetEngine.N1, this.elevator, this.#autopilot.targetPitch, this.#autopilotEnabled, this.#gearStatus, vecToRunway.angle() * radToDeg, vecToRunway,
                                    this.#braking);
    }
  }

  var airplane = new Airplane();

  document.body.style.overflow = 'hidden'; // prevent scrolling bar from apearing

  const plantEcosystem = new PlantEcosystem();
  const ecosystemStatus = {population : 'Waiting for simulation'};
  const ecosystemCanvas = document.createElement('canvas');
  ecosystemCanvas.style.position = 'fixed';
  ecosystemCanvas.style.left = '0';
  ecosystemCanvas.style.top = '0';
  ecosystemCanvas.style.width = '100vw';
  ecosystemCanvas.style.height = '100vh';
  ecosystemCanvas.style.zIndex = '0';
  ecosystemCanvas.style.pointerEvents = 'none';
  ecosystemCanvas.style.display = 'none';
  document.body.appendChild(ecosystemCanvas);
  const ecosystemContext = ecosystemCanvas.getContext('2d');
  const ecosystemTooltip = document.createElement('div');
  ecosystemTooltip.style.position = 'fixed';
  ecosystemTooltip.style.zIndex = '10';
  ecosystemTooltip.style.display = 'none';
  ecosystemTooltip.style.padding = '7px 10px';
  ecosystemTooltip.style.borderRadius = '5px';
  ecosystemTooltip.style.background = 'rgba(20, 27, 21, 0.94)';
  ecosystemTooltip.style.border = '1px solid rgba(190, 210, 170, 0.55)';
  ecosystemTooltip.style.color = '#f2f5e9';
  ecosystemTooltip.style.font = '12px/1.45 Arial, sans-serif';
  ecosystemTooltip.style.whiteSpace = 'pre-line';
  ecosystemTooltip.style.pointerEvents = 'none';
  document.body.appendChild(ecosystemTooltip);
  const ecosystemPointer = {x : -1, y : -1};
  let ecosystemLastIteration = 0;
  let ecosystemLastPhysicsTime = 0;
  let ecosystemHoursAccumulator = 0;
  let ecosystemSampleCursor = 0;

  canvas = document.getElementById('mainCanvas');

  var contextAttributes = {
    alpha : false,
    desynchronized : false,
    antialias : true,
    depth : false,
    failIfMajorPerformanceCaveat : false,
    powerPreference : 'high-performance',
    premultipliedAlpha : true, // true
    preserveDrawingBuffer : false,
    stencil : false,
  };
  gl = canvas.getContext('webgl2', contextAttributes);
  // console.log(gl.getContextAttributes());

  if (!gl) {
    alert('Your browser does not support WebGL2, Download a new browser.');
    throw new Error('Your browser does not support WebGL2.');
  }

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (sim_res_x > maxTextureSize || sim_res_y > maxTextureSize) {
    const message = `This device supports simulation textures up to ${maxTextureSize} cells per side. Reduce the resolution and try again.`;
    await loadingBar.showError(message);
    throw new Error(message);
  }

  if (!gl.getExtension('EXT_color_buffer_float')) {
    const message = 'This browser or graphics device cannot render the floating-point textures required by the simulation.';
    await loadingBar.showError(message);
    throw new Error(message);
  }

  /*
   * A lost graphics context is what a crash looks like from the outside: the frame
   * goes black, the sound keeps playing and nothing responds. It is normally the
   * device reclaiming graphics memory (or a driver reset), not a bug in the page,
   * and the page can at least say so instead of sitting there dead.
   *
   * Carrying on in place would mean rebuilding every framebuffer, VAO and texture
   * this app owns by hand, so the honest recovery is a reload - offered, rather
   * than leaving a black tab behind. preventDefault() keeps the door open for a
   * browser that restores the context on its own.
   */
  let graphicsContextLost = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (graphicsContextLost)
      return;
    graphicsContextLost = true;
    const note = document.createElement('div');
    note.id = 'graphicsContextLost';
    note.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(6,9,12,0.92);color:#e8eef6;font:16px/1.5 Arial,sans-serif;text-align:center;padding:24px;';
    note.innerHTML = '<div style="max-width:560px">' +
      '<h2 style="margin:0 0 12px;font-size:20px">The graphics device was reset</h2>' +
      '<p style="margin:0 0 18px;color:#b9c6d4">The browser took the WebGL context back, which usually means the ' +
      'device ran out of graphics memory. Reload to continue. If it happens again, lower the HDR and bloom ' +
      'resolution in the Performance folder, or use a smaller simulation resolution.</p>' +
      '<button id="graphicsContextReload" style="padding:10px 18px;border-radius:8px;border:1px solid #3a4a5c;' +
      'background:#182430;color:#e8eef6;font:inherit;cursor:pointer">Reload</button></div>';
    document.body.appendChild(note);
    const button = note.querySelector('#graphicsContextReload');
    if (button)
      button.addEventListener('click', () => location.reload());
  });

  // SETUP GUI

  if (guiControlsFromSaveFile == null) { // use default settings
    setupDatGui(JSON.stringify(guiControls_default));
    guiControls.simHeight = sim_height;
    guiControls.globalEffectsEndAlt = sim_height;

    if (startDate) {
      guiControls.month = startDate.getMonth() + 1 + startDate.getDate() / 30.5;
    }

    if (startLatitude) {
      guiControls.latitude = startLatitude;
    }

  } else {
    setupDatGui(guiControlsFromSaveFile);                     // use settings from save file

    for (const [key, value] of Object.entries(guiControls)) { // set numerical values that could not be loaded from the savefile to their defaults.
      if (value === -1) {
        guiControls[key] = guiControls_default[key];
      }
    }
  }
  guiControls.shareWeatherDataToLan = false;

  function setGuiUniforms()
  { // set all uniforms to new values
    gl.useProgram(boundaryProgram);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
    gl.useProgram(velocityProgram);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
    gl.useProgram(lightingProgram);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
    gl.useProgram(advectionProgram);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    gl.useProgram(precipitationProgram);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), guiControls.evapRate);
    gl.useProgram(postProcessingProgram);
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
  }

  function updateSliderGradient(foreground)
  {
    foreground.style.backgroundImage = 'none';
    foreground.style.backgroundColor = '#ffffff';
  }

  function setupDropdownWheelSelection()
  {
    datGui.domElement.querySelectorAll('select').forEach(function(select) {
      select.addEventListener('wheel', function(event) {
        if (event.deltaY == 0)
          return;
        event.preventDefault();
        event.stopPropagation();

        const direction = event.deltaY > 0 ? 1 : -1;
        let nextIndex = select.selectedIndex;
        for (let attempt = 0; attempt < select.options.length; attempt++) {
          nextIndex = (nextIndex + direction + select.options.length) % select.options.length;
          if (!select.options[nextIndex].disabled)
            break;
        }
        if (nextIndex == select.selectedIndex || select.options[nextIndex].disabled)
          return;

        select.selectedIndex = nextIndex;
        select.dispatchEvent(new Event('input', {bubbles: true}));
        select.dispatchEvent(new Event('change', {bubbles: true}));
        const row = select.closest('li');
        row.classList.remove('selection-wheel-change');
        void row.offsetWidth;
        row.classList.add('selection-wheel-change');
      }, {passive: false});
    });
  }

  function setupDatGui(strGuiControls)
  {
    if (sliderGradientObserver)
      sliderGradientObserver.disconnect();

    datGui = new dat.GUI();
    guiControls = { ...guiControls_default, ...JSON.parse(strGuiControls) }; // load settings object
    const renderQualityScales = {'25%': 0.25, '35%': 0.35, '50%': 0.5, '60%': 0.6, '75%': 0.75, '85%': 0.85, '100%': 1.0};
    if (!Object.prototype.hasOwnProperty.call(renderQualityScales, guiControls.hdrQuality))
      guiControls.hdrQuality = '75%';
    if (!Object.prototype.hasOwnProperty.call(renderQualityScales, guiControls.bloomQuality))
      guiControls.bloomQuality = '50%';
    if (!['right', 'left'].includes(guiControls.windPushDirection))
      guiControls.windPushDirection = 'right';
    guiControls.windPushSetTemperature = guiControls.windPushSetTemperature === true;
    guiControls.windPushAirTemperatureC = clamp(Number(guiControls.windPushAirTemperatureC) || 0, -40, 50);
    guiControls.windPushSetHumidity = guiControls.windPushSetHumidity === true;
    guiControls.windPushRelativeHumidity = clamp(Number(guiControls.windPushRelativeHumidity) || 0, 0, 100);
    if (!['SPEED_UNIT_KMH', 'SPEED_UNIT_MS', 'SPEED_UNIT_MPH', 'SPEED_UNIT_KT'].includes(guiControls.speedUnit))
      guiControls.speedUnit = 'SPEED_UNIT_KMH';
    hdrRenderScale = renderQualityScales[guiControls.hdrQuality];
    bloomRenderScale = renderQualityScales[guiControls.bloomQuality];
    if (!['Extreme', 'Quality', 'Balanced', 'Performance', 'Custom'].includes(guiControls.performancePreset))
      guiControls.performancePreset = 'Balanced';
    for (const setting of ['filmicToneMapping', 'fxaaEnabled', 'volumetricCloudLighting', 'temporalAAEnabled'])
      guiControls[setting] = guiControls[setting] === true;
    if (!['Unlocked', '30', '60', '90', '120', '144', '165', '240'].includes(guiControls.autoFpsTarget))
      guiControls.autoFpsTarget = '120';

    guiControls.tool = 'TOOL_NONE';

    cam.wrapHorizontally = guiControls.wrapHorizontally;
    cam.smooth = guiControls.SmoothCam;

    if (guiControls.wrapHorizontally)
      horizontalDisplayMult = 3.0;
    else
      horizontalDisplayMult = 1.0;


    if (frameNum == 0) {
      // only hide during initial setup. When resetting settings and
      // reinitializing datGui, H key no longer works to unhide it
      datGui.hide();
    }
    // add functions to guicontrols object
    guiControls.download = function() { prepareDownload(); };

    guiControls.resetSettings = function() {
      if (confirm('Are you sure you want to reset all settings to default?')) {
        datGui.destroy();                                 // remove datGui completely
        setupDatGui(JSON.stringify(guiControls_default)); // generate new one with new settings
        setGuiUniforms();
        hideOrShowGraph();
        updateSunlight();
      }
    };

    var fluidParams_folder = datGui.addFolder('Fluid');

    fluidParams_folder.add(guiControls, 'vorticity', 0.0, 0.010, 0.001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
      })
      .name('Vorticity');

    fluidParams_folder.add(guiControls, 'dragMultiplier', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
      })
      .name('Drag');

    fluidParams_folder.add(guiControls, 'wind', -1.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
      })
      .name('Wind');

    fluidParams_folder.add(guiControls, 'globalDrying', 0.0, 0.0001, 0.000001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
      })
      .name('Global Drying');

    fluidParams_folder.add(guiControls, 'globalHeating', -0.001, 0.001, 0.00001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
      })
      .name('Global Heating');

    // , 0, 1.0, 0.01
    fluidParams_folder.add(guiControls, 'soundingForcing', 0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
      })
      .name('Sounding Forcing');

    fluidParams_folder.add(guiControls, 'globalEffectsEndAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsEndAlt < guiControls.globalEffectsStartAlt) {
          guiControls.globalEffectsStartAlt = guiControls.globalEffectsEndAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
        }
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply below altitude');

    fluidParams_folder.add(guiControls, 'globalEffectsStartAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsStartAlt > guiControls.globalEffectsEndAlt) {
          guiControls.globalEffectsEndAlt = guiControls.globalEffectsStartAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
        }

        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply above altitude');


    var UI_folder = datGui.addFolder('User Interaction');

    const toolController = UI_folder
      .add(guiControls, 'tool', {
        'Flashlight' : 'TOOL_NONE',
        'Temperature' : 'TOOL_TEMPERATURE',
        'Water Vapor / Cloud' : 'TOOL_WATER',
        'Land' : 'TOOL_WALL_LAND',
        'Lake / Sea' : 'TOOL_WALL_SEA',
        'Urban' : 'TOOL_WALL_URBAN',
        'Runway' : 'TOOL_WALL_RUNWAY',
        'Industrial' : 'TOOL_WALL_INDUSTRIAL',
        'Fire' : 'TOOL_WALL_FIRE',
        'Smoke / Dust' : 'TOOL_SMOKE',
        'Soil Moisture' : 'TOOL_WALL_MOIST',
        'Vegetation' : 'TOOL_VEGETATION',
        'Snow' : 'TOOL_WALL_SNOW',
        'Wind' : 'TOOL_WIND',
        'Wind Push' : 'TOOL_WIND_PUSH',
        'Weather Station' : 'TOOL_STATION',
        'Lightning Rod' : 'TOOL_LIGHTNING_ROD',
      })
      .name('Tool')
      .listen();

    // Lightning rods: pick the Lightning Rod tool and click the terrain to
    // plant one. The counter and the clear button make it obvious what the
    // clicks are doing.
    updateLightningRodStatus();
    const lightningRodController = UI_folder.add(lightningRodStatus, 'placed')
      .name('Lightning Rods')
      .listen();
    const lightningRodInput = lightningRodController.domElement.querySelector('input');
    if (lightningRodInput) {
      lightningRodInput.readOnly = true;
      lightningRodInput.title = 'Pick the Lightning Rod tool, then click the ground in the simulation to place a rod. Clicking open sky does nothing.';
    }
    UI_folder.add({ clearLightningRods : function() {
                      lightningRods = [];
                      updateLightningRodStatus();
                    } }, 'clearLightningRods')
      .name('Clear Lightning Rods');
    const windPushControllers = [
      UI_folder.add(guiControls, 'windPushStrengthMph', 0, 300, 1).name('Wind Push Strength (mph)'),
      UI_folder.add(guiControls, 'windPushDirection', {
        'Toward Right' : 'right',
        'Toward Left' : 'left'
      }).name('Wind Push Direction')
    ];
    const windPushRows = windPushControllers.map(controller => {
      const row = controller.domElement.closest('li');
      row.classList.add('wind-push-strength-row', 'wind-push-strength-collapsed');
      return row;
    });

    const windPushExtrasFolder = UI_folder.addFolder('Wind Push Extras');
    windPushExtrasFolder.open();
    const windPushExtrasRow = windPushExtrasFolder.domElement.closest('li');
    windPushExtrasRow.classList.add('wind-push-extras-row');
    const windPushTemperatureToggle = windPushExtrasFolder.add(guiControls, 'windPushSetTemperature').name('Set Wind Push Temperature');
    const windPushTemperatureController = windPushExtrasFolder.add(guiControls, 'windPushAirTemperatureC', -40, 50, 1)
      .name('Wind Push Air Temperature (°C)');
    const windPushHumidityToggle = windPushExtrasFolder.add(guiControls, 'windPushSetHumidity').name('Set Wind Push Humidity');
    const windPushHumidityController = windPushExtrasFolder.add(guiControls, 'windPushRelativeHumidity', 0, 100, 1)
      .name('Wind Push Humidity (% RH)');
    const windPushExtraValueRows = [
      windPushTemperatureController.domElement.closest('li'),
      windPushHumidityController.domElement.closest('li')
    ];
    windPushExtraValueRows.forEach(row => row.classList.add('wind-push-strength-row', 'wind-push-strength-collapsed'));

    let previousWindPushControlsVisibility;
    let previousWindPushTemperatureVisibility;
    let previousWindPushHumidityVisibility;
    let windPushExtrasAnimationFrame = 0;
    function setWindPushExtrasVisibility(visible)
    {
      cancelAnimationFrame(windPushExtrasAnimationFrame);
      if (visible) {
        windPushExtrasRow.style.height = 'auto';
        const expandedHeight = windPushExtrasRow.scrollHeight;
        windPushExtrasRow.style.height = '0px';
        windPushExtrasRow.offsetHeight;
        windPushExtrasAnimationFrame = requestAnimationFrame(() => {
          windPushExtrasRow.style.height = expandedHeight + 'px';
        });
      } else {
        windPushExtrasRow.style.height = windPushExtrasRow.getBoundingClientRect().height + 'px';
        windPushExtrasRow.offsetHeight;
        windPushExtrasRow.style.height = '0px';
      }
    }

    windPushExtrasRow.addEventListener('transitionend', event => {
      if (event.target === windPushExtrasRow && event.propertyName === 'height' &&
          guiControls.tool == 'TOOL_WIND_PUSH') {
        windPushExtrasRow.style.height = 'auto';
      }
    });

    function updateWindPushControlsVisibility()
    {
      const visible = guiControls.tool == 'TOOL_WIND_PUSH';
      if (visible != previousWindPushControlsVisibility) {
        previousWindPushControlsVisibility = visible;
        windPushRows.forEach(row => row.classList.toggle('wind-push-strength-collapsed', !visible));
        setWindPushExtrasVisibility(visible);
      }

      const temperatureVisible = visible && guiControls.windPushSetTemperature;
      if (temperatureVisible != previousWindPushTemperatureVisibility) {
        previousWindPushTemperatureVisibility = temperatureVisible;
        windPushExtraValueRows[0].classList.toggle('wind-push-strength-collapsed', !temperatureVisible);
      }

      const humidityVisible = visible && guiControls.windPushSetHumidity;
      if (humidityVisible != previousWindPushHumidityVisibility) {
        previousWindPushHumidityVisibility = humidityVisible;
        windPushExtraValueRows[1].classList.toggle('wind-push-strength-collapsed', !humidityVisible);
      }
    }

    windPushControlsVisibilityUpdater = updateWindPushControlsVisibility;
    toolController.onChange(updateWindPushControlsVisibility);
    windPushTemperatureToggle.onChange(updateWindPushControlsVisibility);
    windPushHumidityToggle.onChange(updateWindPushControlsVisibility);
    setWindPushExtrasVisibility(false);
    updateWindPushControlsVisibility();
    UI_folder.add(guiControls, 'brushSize', 1, 200, 1).name('Brush Diameter / Band Height').listen();
    UI_folder.add(guiControls, 'wholeWidth').name('Whole Width Brush').listen();
    UI_folder.add(guiControls, 'wholeWidthBrushWidth', 1, 100, 1).name('Whole Width Brush Width (%)').listen();
    UI_folder.add(guiControls, 'brushIntensity', 0.005, 0.05, 0.001).name('Brush Intensity');
    UI_folder.add(guiControls, 'allowCaves')
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);
      })
      .name('Allow Caves');

    var radiation_folder = datGui.addFolder('Radiation');

    radiation_folder.add(guiControls, 'timeOfDay', 0.0, 23.96, 0.01).onChange(onUpdateTimeOfDaySlider).name('Time of day').listen();

    radiation_folder.add(guiControls, 'dayNightCycle').onChange(updateClockDisplay).name('Day/Night Cycle').listen();

    radiation_folder.add(guiControls, 'accelerateNight').name('Accelerate Night').listen();

    radiation_folder.add(guiControls, 'latitude', -90.0, 90.0, 0.1).onChange(function() { updateSunlight(); }).name('Latitude').listen();

    radiation_folder.add(guiControls, 'month', 1.0, 12.99, 0.01).onChange(onUpdateMonthSlider).name('Month').listen();

    radiation_folder.add(guiControls, 'sunAngle', -10.0, 190.0, 0.1)
      .onChange(function() {
        updateSunlight('MANUAL_ANGLE');
        guiControls.dayNightCycle = false;
      })
      .name('Sun Angle')
      .listen();

    radiation_folder.add(guiControls, 'sunIntensity', 0.0, 2.0, 0.01).onChange(function() { updateSunlight('MANUAL_ANGLE'); }).name('Sun Intensity');

    radiation_folder.add(guiControls, 'greenhouseGases', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
      })
      .name('Greenhouse Gases');

    radiation_folder.add(guiControls, 'waterGreenHouseEffect', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
      })
      .name('Water Vapor Greenhouse Effect');

    radiation_folder
      .add(guiControls, 'IR_rate', 0.0, 10.0, 0.1)
      /*.onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
      })*/
      .name('IR Multiplier');

    var water_folder = datGui.addFolder('Water');

    water_folder.add(guiControls, 'waterTemperature', 0.0, 40.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
      })
      .name('Lake / Sea Temperature (°C)');

    water_folder.add(guiControls, 'dynamicWaterTemperature').name('Dynamic Water Temperature').onChange(function() {
      gl.useProgram(boundaryProgram);
      gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    });

    water_folder.add(guiControls, 'landEvaporation', 0.0, 0.0002, 0.00001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
      })
      .name('Land Evaporation');
    water_folder.add(guiControls, 'waterEvaporation', 0.0, 0.0004, 0.00001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
      })
      .name('Lake / Sea Evaporation');
    water_folder.add(guiControls, 'evapHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
      })
      .name('Evaporation Heat');
    water_folder.add(guiControls, 'meltingHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
      })
      .name('Melting Heat');
    water_folder.add(guiControls, 'condensationRate', 0.001, 0.020, 0.001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
      })
      .listen()
      .name('Condensation Rate');
    water_folder.add(guiControls, 'waterWeight', 0.0, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
      })
      .name('Water Weight');

    var precipitation_folder = datGui.addFolder('Precipitation');

    precipitation_folder.add(guiControls, 'aboveZeroThreshold', 0.1, 2.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
      })
      .name('Precipitation Threshold +°C');

    precipitation_folder.add(guiControls, 'subZeroThreshold', 0.0, 1.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
      })
      .name('Precipitation Threshold -°C');

    precipitation_folder.add(guiControls, 'spawnChance', 0.00001, 0.0001, 0.00001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
      })
      .name('Spawn Rate')
      .listen();

    precipitation_folder.add(guiControls, 'snowDensity', 0.1, 0.9, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
      })
      .name('Snow Density');

    precipitation_folder.add(guiControls, 'fallSpeed', 0.0001, 0.001, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
      })
      .name('Fall Speed');

    precipitation_folder.add(guiControls, 'growthRate0C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
      })
      .name('Growth Rate 0°C');

    precipitation_folder.add(guiControls, 'growthRate_30C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
      })
      .name('Growth Rate -30°C');

    precipitation_folder
      .add(guiControls, 'freezingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
      })
      .name('Freezing Rate');

    precipitation_folder
      .add(guiControls, 'meltingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
      })
      .name('Melting Rate');

    precipitation_folder.add(guiControls, 'evapRate', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), guiControls.evapRate);
      })
      .name('Evaporation Rate');

    precipitation_folder.add(guiControls, 'inactiveDroplets', 0, NUM_DROPLETS).listen().name('Inactive Droplets');


    var display_folder = datGui.addFolder('Display');

    displayModeController = display_folder
      .add(guiControls, 'displayMode', {
        '1 Temperature -26°C to 30°C' : 'DISP_TEMPERATURE',
        '2 Water Vapor' : 'DISP_WATER',
        '3 Realistic' : 'DISP_REAL',
        '4 Horizontal Velocity' : 'DISP_HORIVEL',
        '5 Vertical Velocity' : 'DISP_VERTVEL',
        '6 IR Heating / Cooling' : 'DISP_IRHEATING',
        '7 IR Down -60°C to 26°C' : 'DISP_IRDOWNTEMP',
        '8 IR Up -26°C to 30°C' : 'DISP_IRUPTEMP',
        '9 Precipitation Mass' : 'DISP_PRECIPFEEDBACK_MASS',
        'Precipitation Heating/Cooling' : 'DISP_PRECIPFEEDBACK_HEAT',
        'Precipitation Condensation/Evaporation' : 'DISP_PRECIPFEEDBACK_VAPOR',
        'Rain Deposition' : 'DISP_PRECIPFEEDBACK_RAIN',
        'Snow Deposition' : 'DISP_PRECIPFEEDBACK_SNOW',
        'Precipitation/Soil Moisture' : 'DISP_SOIL_MOISTURE',
        'Curl' : 'DISP_CURL',
        'Relative Humidity / Cloud Density' : 'DISP_HUMD',
        'Air Quality' : 'DISP_AIRQUALITY',
        'Reflectivity Estimate' : 'DISP_REFLECTIVITY',
        'CAPE Estimate' : 'DISP_CAPE'
      })
      .name('Display Mode')
      .listen()
      .onChange(showDisplayModeTransition);
    previousDisplayMode = guiControls.displayMode;
    display_folder.add(guiControls, 'exposure', 0.5, 5.0, 0.01)
      .onChange(function() {
        gl.useProgram(postProcessingProgram);
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
      })
      .name('Exposure');

    display_folder.add(guiControls, 'camSpeed', 0.001, 0.050, 0.001).name('Camera Pan Speed');


    display_folder.add(guiControls, 'wrapHorizontally')
      .onChange(function() {
        cam.wrapHorizontally = guiControls.wrapHorizontally;
        cam.center();
        if (guiControls.wrapHorizontally)
          horizontalDisplayMult = 3.0;
        else
          horizontalDisplayMult = 1.0;
      })
      .name('Wrap Horizontally');

    display_folder.add(guiControls, 'SmoothCam').onChange(function() { cam.smooth = guiControls.SmoothCam; }).name('Smooth Camera');

    display_folder.add(guiControls, 'showGraph').onChange(hideOrShowGraph).name('Show Sounding Graph').listen();
    display_folder.add(guiControls, 'realDewPoint').name('Show Real Dew Point');

    const exclusiveFeaturesFolder = datGui.addFolder('Exclusive Features');
    exclusiveFeaturesFolder.add(guiControls, 'plantGrowth').name('Plant Growth & Reproduction');
    const ecosystemStatusController = exclusiveFeaturesFolder.add(ecosystemStatus, 'population').name('Living Plants').listen();
    const ecosystemStatusInput = ecosystemStatusController.domElement.querySelector('input');
    if (ecosystemStatusInput)
      ecosystemStatusInput.readOnly = true;
    exclusiveFeaturesFolder.add(guiControls, 'shareWeatherDataToLan')
      .name('Share Weather Data to LAN')
      .onChange(function(enabled) {
        nextWeatherShareAttemptTime = 0;
        weatherShareRetryDelayMs = 1000;
        if (enabled) {
          updateWeatherShareStatus('Connecting to local server...');
          publishWeatherDataIfEnabled();
        } else {
          updateWeatherShareStatus('Off');
          void sendWeatherDataSharingState(false);
        }
      })
      .listen();
    weatherShareStatusController = exclusiveFeaturesFolder.add(weatherShareStatus, 'status')
      .name('LAN Share Status');
    const weatherShareStatusInput = weatherShareStatusController.domElement.querySelector('input');
    if (weatherShareStatusInput)
      weatherShareStatusInput.readOnly = true;
    weatherShareStatusController.domElement.title =
      'Run lan_weather_server.py, then fetch /api/weather-stations from a device on your LAN.';

    const performanceFolder = datGui.addFolder('Performance');
    const performancePresets = {
      Extreme: {
        hdrQuality: '100%',
        bloomQuality: '100%',
        bloomEnabled: true,
        filmicToneMapping: false,
        fxaaEnabled: false,
        volumetricCloudLighting: true,
        temporalAAEnabled: false
      },
      Quality: {
        hdrQuality: '100%',
        bloomQuality: '75%',
        bloomEnabled: true,
        filmicToneMapping: false,
        fxaaEnabled: false,
        volumetricCloudLighting: false,
        temporalAAEnabled: false
      },
      Balanced: {
        hdrQuality: '75%',
        bloomQuality: '50%',
        bloomEnabled: true,
        filmicToneMapping: false,
        fxaaEnabled: false,
        volumetricCloudLighting: false,
        temporalAAEnabled: false
      },
      Performance: {
        hdrQuality: '50%',
        bloomQuality: '25%',
        bloomEnabled: false,
        filmicToneMapping: false,
        fxaaEnabled: false,
        volumetricCloudLighting: false,
        temporalAAEnabled: false
      },
    };
    const presetController = performanceFolder.add(guiControls, 'performancePreset', ['Extreme', 'Quality', 'Balanced', 'Performance', 'Custom'])
      .name('Quality Preset')
      .onChange(function(preset) {
        const settings = performancePresets[preset];
        if (!settings)
          return;
        guiControls.hdrQuality = settings.hdrQuality;
        guiControls.bloomQuality = settings.bloomQuality;
        guiControls.bloomEnabled = settings.bloomEnabled;
        for (const setting of ['filmicToneMapping', 'fxaaEnabled', 'volumetricCloudLighting', 'temporalAAEnabled'])
          guiControls[setting] = settings[setting];
        hdrQualityController.updateDisplay();
        bloomQualityController.updateDisplay();
        bloomEnabledController.updateDisplay();
        renderTechnologyControllers.forEach(controller => controller.updateDisplay());
        temporalHistoryValid = false;
        applyRenderQuality();
      });

    function applyRenderQuality()
    {
      hdrRenderScale = renderQualityScales[guiControls.hdrQuality];
      bloomRenderScale = renderQualityScales[guiControls.bloomQuality];
      if (hdrFBO)
        createHdrFBO();
      if (bloomFBOs.length)
        createBloomFBOs();
    }

    function updateRenderPresetLabel()
    {
      const matchingPreset = Object.keys(performancePresets).find(function(preset) {
        const settings = performancePresets[preset];
        return Object.keys(settings).every(key => settings[key] === guiControls[key]);
      });
      guiControls.performancePreset = matchingPreset || 'Custom';
      presetController.updateDisplay();
      temporalHistoryValid = false;
    }

    function markCustomRenderQuality()
    {
      updateRenderPresetLabel();
      applyRenderQuality();
    }

    const hdrQualityController = performanceFolder.add(guiControls, 'hdrQuality', ['25%', '35%', '50%', '60%', '75%', '85%', '100%'])
      .name('HDR Render Scale')
      .onChange(markCustomRenderQuality);
    const bloomQualityController = performanceFolder.add(guiControls, 'bloomQuality', ['25%', '35%', '50%', '60%', '75%', '85%', '100%'])
      .name('Bloom Quality')
      .onChange(markCustomRenderQuality);
    const bloomEnabledController = performanceFolder.add(guiControls, 'bloomEnabled')
      .name('Bloom Effects')
      .onChange(markCustomRenderQuality);
    const renderTechnologySettings = [
      ['filmicToneMapping', 'Filmic ACES Tone Mapping'],
      ['fxaaEnabled', 'FXAA Anti-Aliasing'],
      ['volumetricCloudLighting', 'Volumetric Cloud Lighting'],
      ['temporalAAEnabled', 'Temporal Anti-Aliasing']
    ];
    const renderTechnologyControllers = renderTechnologySettings.map(([setting, label]) =>
      performanceFolder.add(guiControls, setting).name(label).onChange(updateRenderPresetLabel));
    performanceFolder.add(guiControls, 'showPlants')
      .name('Render Plants')
      .listen();
    performanceFolder.add(guiControls, 'showDrops')
      .name('Render Precipitation Particles')
      .listen();
    weatherStationsVisibilityController = performanceFolder.add(guiControls, 'showWeatherStations')
      .name('Weather Station Overlays')
      .onChange(setWeatherStationsVisible)
      .listen();
    setWeatherStationsVisible(guiControls.showWeatherStations);
    performanceFolder.add(guiControls, 'IterPerFrame', 1, 50, 1)
      .onChange(function() { guiControls.auto_IterPerFrame = false; })
      .name('Iterations / Frame')
      .listen();
    performanceFolder.add(guiControls, 'auto_IterPerFrame').name('Auto Adjust').listen();
    performanceFolder.add(guiControls, 'autoFpsTarget', ['Unlocked', '30', '60', '90', '120', '144', '165', '240'])
      .name('Auto FPS Target');
    applyRenderQuality();

    const currentPerformanceFolder = performanceFolder.addFolder('Current Performance');
    currentPerformanceReadouts = {
      fps: '--',
      frameTime: '--',
      simulationRate: '--',
      renderQuality: '--',
      overall: '--',
    };
    currentPerformanceReadoutControllers = {};
    const currentPerformanceLabels = {
      fps: 'Frame Rate',
      frameTime: 'Frame Time',
      simulationRate: 'Simulation Rate',
      renderQuality: 'Render Quality',
      overall: 'Overall',
    };
    for (const [key, label] of Object.entries(currentPerformanceLabels)) {
      const controller = currentPerformanceFolder.add(currentPerformanceReadouts, key).name(label).listen();
      currentPerformanceReadoutControllers[key] = controller;
      const input = controller.domElement;
      if (input)
        input.readOnly = true;
      if (key == 'overall') {
        const labelElement = controller.domElement.closest('li').querySelector('.property-name');
        labelElement.insertAdjacentHTML('beforeend',
          ' <svg class="performance-score-face" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Performance score">' +
          '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r=".7" fill="currentColor"/><circle cx="15" cy="10" r=".7" fill="currentColor"/>' +
          '<path data-face-mouth d="M8 13c1.1 1.3 2.4 2 4 2s2.9-.7 4-2"/></svg>');
        currentPerformanceScoreIcon = labelElement.querySelector('.performance-score-face');
      }
    }

    const performanceHelp = {
      'Quality Preset': ['Choose a balanced default or favor image quality/performance. This changes HDR and bloom rendering quality only; weather calculations stay the same.', 'Varies', 'medium'],
      'HDR Render Scale': ['Sets the resolution used to render the HDR scene before it is upscaled. Lower values can improve rendering speed but make details softer.', 'Low', 'low'],
      'Bloom Quality': ['Controls the resolution used for bloom lighting. Lower settings reduce post-processing work and produce softer, less detailed glow.', 'Low', 'low'],
      'Bloom Effects': ['Turns the bloom post-processing passes on or off. Disabling bloom reduces GPU post-processing work and removes the soft glow around bright areas.', 'Medium', 'medium'],
      'Filmic ACES Tone Mapping': ['Applies ACES filmic tone mapping to compress bright HDR colors into the display range while preserving more highlight detail. This adds a small post-processing cost.', 'Low', 'low'],
      'FXAA Anti-Aliasing': ['Smooths jagged edges in the final image with a screen-space filter. It adds a small post-processing cost and can slightly soften fine details.', 'Low', 'low'],
      'Volumetric Cloud Lighting': ['Adds cloud self-shadowing, cool shaded interiors, sun-warmed edges, and a richer altitude- and time-of-day sky gradient. The extra lighting samples are most costly in scenes with widespread clouds.', 'High', 'high'],
      'Temporal Anti-Aliasing': ['Blends a small amount of the previous frame into the current frame to reduce flicker and jagged edges. History is neighborhood-clamped and reset on camera or display-mode changes; this is screen-space smoothing, not motion-reprojected TAA.', 'Low to medium', 'medium'],
      'Render Plants': ['Hides or draws the plant layer. Hiding plants reduces per-frame 2D rendering work; plant growth and weather simulation continue.', 'Low to medium', 'low'],
      'Render Precipitation Particles': ['Shows or hides individual falling-particle markers. Hiding them skips their display draw; precipitation simulation and deposition continue.', 'Low to medium', 'medium'],
      'Weather Station Overlays': ['Hides or updates station cards and charts. Hiding them can reduce browser rendering overhead; weather station measurements continue.', 'Low to medium', 'low'],
      'Iterations / Frame': ['Controls how many weather simulation steps run per rendered frame. Fewer steps reduce GPU work per frame but slow simulated-time progress; higher values can reduce frame rate.', 'High, with simulation-speed tradeoff', 'high'],
      'Auto Adjust': ['Automatically changes simulation steps per frame to meet the selected Auto FPS Target. This changes simulation-time throughput, not the result of an individual step. Unlocked leaves the iteration count unchanged and lets the browser run at the display refresh rate.', 'Medium, with simulation-speed tradeoff', 'medium'],
      'Auto FPS Target': ['Sets the frame-rate goal for Auto Adjust. Unlocked disables iteration auto-adjustment; the browser schedules rendering at the maximum rate supported by the display. Numeric targets may reduce iterations per frame. A 120 FPS target cannot override a lower display refresh rate or rendering workload.', 'Medium, with simulation-speed tradeoff', 'medium'],
    };
    let performanceHelpHideTimer;
    let performanceTooltip = document.querySelector('.performance-tooltip');
    if (!performanceTooltip) {
      performanceTooltip = document.createElement('div');
      performanceTooltip.className = 'performance-tooltip';
      performanceTooltip.setAttribute('role', 'tooltip');
      performanceTooltip.innerHTML = '<div class="performance-tooltip-description"></div><div class="performance-tooltip-impact"></div>';
      document.body.appendChild(performanceTooltip);
    }
    const performanceDescription = performanceTooltip.querySelector('.performance-tooltip-description');
    const performanceImpact = performanceTooltip.querySelector('.performance-tooltip-impact');
    const performanceRows = performanceFolder.domElement.querySelectorAll('.cr');
    performanceRows.forEach(function(row) {
      const settingName = row.querySelector('.property-name')?.textContent.trim();
      const help = performanceHelp[settingName];
      if (!help)
        return;
      row.addEventListener('mouseenter', function() {
        clearTimeout(performanceHelpHideTimer);
        performanceDescription.textContent = help[0];
        performanceImpact.textContent = 'Performance impact: ' + help[1];
        performanceImpact.dataset.level = help[2];
        const rect = row.getBoundingClientRect();
        performanceTooltip.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 100)) + 'px';
        performanceTooltip.style.left = rect.left > 300 ? (rect.left - 280) + 'px' : Math.min(rect.right + 12, window.innerWidth - 272) + 'px';
        performanceTooltip.classList.add('is-visible');
      });
      row.addEventListener('mouseleave', function() {
        performanceHelpHideTimer = setTimeout(function() {
          performanceTooltip.classList.remove('is-visible');
        }, 120);
      });
    });

    display_folder.add(guiControls, 'twelveHourClock').name('12-hour clock');

    display_folder
      .add(guiControls, 'lengthUnit', {
        'km / meters / cm / mm' : 'LENGTH_UNIT_METRIC',
        'miles / ft / inch' : 'LENGTH_UNIT_IMPERIAL',
      })
      .name('Length Unit')
      .onChange(function() {
        for (let i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'speedUnit', {
        'km/h' : 'SPEED_UNIT_KMH',
        'm/s' : 'SPEED_UNIT_MS',
        'mph' : 'SPEED_UNIT_MPH',
        'kt' : 'SPEED_UNIT_KT',
      })
      .name('Speed Unit')
      .onChange(function() {
        for (let i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'tempUnit', {
        '°C' : 'TEMP_UNIT_C',
        '°F' : 'TEMP_UNIT_F',
        'K' : 'TEMP_UNIT_K',
      })
      .name('Temperature Unit')
      .onChange(function() {
        for (let i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });


    var advanced_folder = datGui.addFolder('Advanced');

    advanced_folder.add(guiControls, 'enablePrecipitation')
      .onChange(function() {
        initRainDrops();
        setupPrecipitationBuffers();
        guiControls.inactiveDroplets = NUM_DROPLETS;
      })
      .name('Enable Precipitation');

    advanced_folder.add(guiControls, 'sound').name('Enable Sound').onChange(function() {
      if (guiControls.sound) {
        if (soundSystem == null) {
          soundSystem = new SoundSystem();
        }
      } else {
        soundSystem?.mute();
      }
    });

    advanced_folder.add(guiControls, 'resetSettings').name('Reset all settings');

    pauseController = datGui.add(guiControls, 'paused').onChange(handlePause).name('Paused').listen();
    datGui.add(guiControls, 'download').name('Save Simulation to File');
    datGui.domElement.querySelectorAll('.cr.boolean .c input[type="checkbox"]').forEach(function(checkbox) {
      const icon = document.createElement('span');
      icon.className = 'gui-lucide-check';
      icon.setAttribute('aria-hidden', 'true');

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      checkPath.setAttribute('d', 'm20 6-11 11-5-5');
      svg.appendChild(checkPath);
      icon.appendChild(svg);
      checkbox.insertAdjacentElement('afterend', icon);
    });
    datGui.width = 400;

    setupDropdownWheelSelection();

    const sliderForegrounds = datGui.domElement.querySelectorAll('.slider-fg');
    sliderForegrounds.forEach(updateSliderGradient);
    sliderGradientObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.target.matches('.slider-fg'))
          updateSliderGradient(mutation.target);
      });
    });
    sliderGradientObserver.observe(datGui.domElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
  }

  // guiControls.paused = true; // pause before first iteration for debugging

  await loadingBar.set(6, 'Initializing Sounding Graph');
  // END OF GUI

  function startSimulation()
  {
    SETUP_MODE = false;
    document.body.classList.add('simulation-started');
    gl.useProgram(postProcessingProgram);
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    datGui.show(); // unhide

    clockEl = document.createElement('div');
    clockEl.className = 'simulation-clock';
    document.body.appendChild(clockEl);
    clockEl.innerHTML = `
      <div class="simulation-clock-primary">
        <span class="simulation-clock-time"></span>
        <span class="simulation-clock-date"></span>
      </div>
      <div class="simulation-clock-detail">
        <span>Running For</span>
        <span class="simulation-clock-running-for"></span>
      </div>
      <div class="simulation-clock-detail">
        <span class="simulation-clock-event-icon">
          <svg data-solar-icon="sunrise" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden>
            <path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4-4-4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>
          </svg>
          <svg data-solar-icon="sunset" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>
          </svg>
        </span>
        <span class="simulation-clock-solar-event"></span>
        <span class="simulation-clock-solar-countdown"></span>
      </div>
      <div class="simulation-clock-detail simulation-clock-fps">
        <span>FPS</span>
        <span class="simulation-clock-fps-value">--</span>
      </div>`;
    clockTimeEl = clockEl.querySelector('.simulation-clock-time');
    clockDateEl = clockEl.querySelector('.simulation-clock-date');
    clockRunningForEl = clockEl.querySelector('.simulation-clock-running-for');
    clockSolarEventEl = clockEl.querySelector('.simulation-clock-solar-event');
    clockSolarCountdownEl = clockEl.querySelector('.simulation-clock-solar-countdown');
    clockSolarIconEl = clockEl.querySelector('.simulation-clock-event-icon');
    clockFpsEl = clockEl.querySelector('.simulation-clock-fps-value');

    diagnosticLegend = document.createElement('div');
    diagnosticLegend.className = 'diagnostic-legend';
    diagnosticLegend.hidden = true;
    diagnosticLegend.innerHTML = `
      <strong class="diagnostic-legend-title diagnostic-legend-reflectivity-title">Estimated Reflectivity</strong>
      <strong class="diagnostic-legend-title diagnostic-legend-cape-title">Surface-parcel CAPE estimate (J/kg)</strong>
      <div class="diagnostic-legend-scale diagnostic-legend-reflectivity-scale"></div>
      <div class="diagnostic-legend-labels diagnostic-legend-reflectivity-labels"><span>Light</span><span>Moderate</span><span>Heavy</span><span>Extreme</span></div>
      <div class="diagnostic-legend-scale diagnostic-legend-cape-scale"></div>
      <div class="diagnostic-legend-labels diagnostic-legend-cape-labels"><span>0</span><span>500</span><span>1000</span><span>2000</span><span>3000+</span></div>`;
    document.body.appendChild(diagnosticLegend);
    capeHoverTooltip = document.createElement('div');
    capeHoverTooltip.className = 'cape-hover-tooltip';
    capeHoverTooltip.hidden = true;
    document.body.appendChild(capeHoverTooltip);

    simElapsedMilliseconds = 0;
    simDateTime = new Date(2000, Math.floor(guiControls.month) - 1, (guiControls.month % 1) * 30.417);

    // initialize time and solar angle
    if (guiControls.dayNightCycle) {
      onUpdateTimeOfDaySlider();
      onUpdateMonthSlider();
    } else {
      updateSunlight('MANUAL_ANGLE'); // set angle from savefile
    }

    initializePlantEcosystem();
  }

  function readPlantSurfaceSites()
  {
    const sampleCount = Math.min(1800, Math.max(120, Math.ceil(sim_res_x / 5)));
    const wallData = initialWallTex || new Int8Array(sim_res_x * sim_res_y * 4);
    if (!initialWallTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallData);
    }

    const sites = [];
    for (let i = 0; i < sampleCount; i++) {
      const x = Math.min(sim_res_x - 1, Math.floor((i + 0.5) * sim_res_x / sampleCount));
      let surfaceY = -1;
      let vegetation = 0;
      let surfaceType = 0;
      for (let y = 0; y < sim_res_y; y++) {
        const offset = (y * sim_res_x + x) * 4;
        if (wallData[offset + 1] == 0) {
          surfaceY = y;
          surfaceType = wallData[offset];
          vegetation = wallData[offset + 3];
        }
      }
      if (surfaceY >= 0 && surfaceType == 1)
        sites.push({x, y : surfaceY, vegetation});
    }
    return sites;
  }

  function samplePlantEnvironment(sites, startIndex, sampleCount, surfacesKnown = false)
  {
    const samples = [];
    if (!sites.length || sim_res_x <= 0 || sim_res_y <= 0)
      return samples;

    const count = Number.isFinite(sampleCount) ?
      Math.min(sites.length, Math.max(0, Math.floor(sampleCount))) : 0;
    if (count === 0)
      return samples;
    const normalizedStart = Number.isFinite(startIndex) ? Math.floor(startIndex) : 0;
    const firstIndex = ((normalizedStart % sites.length) + sites.length) % sites.length;
    const selectedSites = [];
    let wallXStart = sim_res_x - 1;
    let wallXEnd = 0;
    for (let i = 0; i < count; i++) {
      const siteIndex = (firstIndex + i) % sites.length;
      const site = sites[siteIndex];
      const x = Number.isFinite(site.x) ? clamp(Math.floor(site.x), 0, sim_res_x - 1) : 0;
      selectedSites.push({siteIndex, site, x});
      wallXStart = Math.min(wallXStart, x);
      wallXEnd = Math.max(wallXEnd, x);
    }

    let wallWidth = 0;
    let wallData = plantEnvironmentSamplingBuffers.walls;
    if (!surfacesKnown) {
      wallWidth = wallXEnd - wallXStart + 1;
      const wallDataLength = wallWidth * sim_res_y * 4;
      if (wallData.length < wallDataLength) {
        wallData = new Int8Array(wallDataLength);
        plantEnvironmentSamplingBuffers.walls = wallData;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    if (!surfacesKnown) {
      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      gl.readPixels(wallXStart, 0, wallWidth, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallData);
    }

    const activeSites = [];
    for (const {siteIndex, site, x} of selectedSites) {
      if (surfacesKnown) {
        activeSites.push({siteIndex, site, x});
        continue;
      }
      let surfaceY = -1;
      let wallType = 0;
      for (let y = 0; y < sim_res_y; y++) {
        const offset = (y * wallWidth + x - wallXStart) * 4;
        if (wallData[offset + 1] == 0) {
          surfaceY = y;
          wallType = wallData[offset];
        }
      }

      if (surfaceY >= 0 && wallType == 1) {
        site.y = surfaceY;
        site.x = x;
        site.vegetation = wallData[(surfaceY * wallWidth + x - wallXStart) * 4 + 3];
        activeSites.push({siteIndex, site, x});
      } else {
        samples.push({
          siteIndex,
          wallType : surfaceY >= 0 ? wallType : 0,
          temperature : site.temperature,
          moisture : site.moisture,
          airMoisture : site.airMoisture || 0,
          wind : site.wind || 0,
          snow : site.snow
        });
      }
    }

    if (!activeSites.length)
      return samples;
    let dataXStart = sim_res_x - 1;
    let dataXEnd = 0;
    let dataYStart = sim_res_y - 1;
    let dataYEnd = 0;
    for (const {site, x} of activeSites) {
      dataXStart = Math.min(dataXStart, x);
      dataXEnd = Math.max(dataXEnd, x);
      dataYStart = Math.min(dataYStart, site.y);
      dataYEnd = Math.max(dataYEnd, Math.min(site.y + 1, sim_res_y - 1));
    }
    const dataWidth = dataXEnd - dataXStart + 1;
    const dataHeight = dataYEnd - dataYStart + 1;
    const dataLength = dataWidth * dataHeight * 4;
    if (plantEnvironmentSamplingBuffers.base.length < dataLength)
      plantEnvironmentSamplingBuffers.base = new Float32Array(dataLength);
    if (plantEnvironmentSamplingBuffers.water.length < dataLength)
      plantEnvironmentSamplingBuffers.water = new Float32Array(dataLength);
    const baseData = plantEnvironmentSamplingBuffers.base;
    const waterData = plantEnvironmentSamplingBuffers.water;

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(dataXStart, dataYStart, dataWidth, dataHeight, gl.RGBA, gl.FLOAT, baseData);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(dataXStart, dataYStart, dataWidth, dataHeight, gl.RGBA, gl.FLOAT, waterData);

    for (const {siteIndex, site, x} of activeSites) {
      const airY = Math.min(site.y + 1, sim_res_y - 1);
      const baseOffset = ((airY - dataYStart) * dataWidth + x - dataXStart) * 4;
      const surfaceOffset = ((site.y - dataYStart) * dataWidth + x - dataXStart) * 4;
      const temperatureK = potentialToRealT(baseData[baseOffset + 3], airY);
      const humidity = relativeHumd(temperatureK, waterData[baseOffset]) / 100;
      const wind = rawVelocityTo_ms(baseData[baseOffset]);
      samples.push({
        siteIndex,
        wallType : 1,
        temperature : Number.isFinite(temperatureK) ? KtoC(temperatureK) : guiControls.waterTemperature,
        moisture : Number.isFinite(waterData[surfaceOffset + 2]) ?
          clamp(waterData[surfaceOffset + 2] / 50, 0, 1) : 0,
        airMoisture : Number.isFinite(humidity) ? clamp(humidity, 0, 1) : 0,
        wind : Number.isFinite(wind) ? wind : 0,
        snow : Number.isFinite(waterData[surfaceOffset + 3]) ? Math.max(0, waterData[surfaceOffset + 3]) : 0
      });
    }
    return samples;
  }

  function initializePlantEcosystem()
  {
    const sites = readPlantSurfaceSites();
    const environments = samplePlantEnvironment(sites, 0, sites.length, true);
    const seed = (sim_res_x * 73856093) ^ (sim_res_y * 19349663) ^ simDateTime.getTime();
    plantEcosystem.initialize(sites, environments, seed, guiControls.latitude, cellHeight);
    ecosystemStatus.population = plantEcosystem.getStatus();
    ecosystemCanvas.width = canvas.width;
    ecosystemCanvas.height = canvas.height;
    ecosystemCanvas.style.display = 'block';
    ecosystemLastIteration = iterNum;
    ecosystemHoursAccumulator = 0;
    ecosystemSampleCursor = 0;
  }

  var soundingGraph = {
    graphCanvas : null,
    ctx : null,
    init : function() {
      this.graphCanvas = document.getElementById('graphCanvas');
      this.graphCanvas.height = window.innerHeight;
      this.graphCanvas.width = this.graphCanvas.height;
      this.ctx = this.graphCanvas.getContext('2d');
      var style = this.graphCanvas.style;
      if (guiControls.showGraph)
        style.display = 'block';
      else
        style.display = 'none';
    },
    draw : function(simXpos, simYpos) {
      // draw graph
      // mouse positions in sim coordinates

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      var baseTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT,
                    baseTextureValues); // read a vertical culumn of cells

      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      var waterTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues); // read a vertical culumn of cells

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.INT, wallTextureValues); // read a vertical column of cells


      const graphBottem = this.graphCanvas.height - 40; // in pixels

      var c = this.ctx;

      c.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      c.fillStyle = '#00000055';
      c.fillRect(0, 0, graphCanvas.width, graphCanvas.height);

      drawIsotherms();

      var reachedAir = false;
      var surfaceLevel;

      // Draw temperature line
      c.beginPath();
      for (var y = 0; y < sim_res_y; y++) {
        var potentialTemp = baseTextureValues[4 * y + 3];

        var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0 - 273.15;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.font = '15px Arial';
        c.fillStyle = 'white';

        if (wallTextureValues[4 * y + 1] != 0) { // if this is fluid cell
          if (!reachedAir) {
            // first non wall cell
            reachedAir = true;
            surfaceLevel = y;

            if (simYpos < surfaceLevel)
              simYpos = surfaceLevel;
          }
          if (reachedAir && y == simYpos) {
            // c.fillText('' + Math.round(map_range(y-1, 0, sim_res_y, 0,
            // guiControls.simHeight)) + ' m', 5, scrYpos + 5);
            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;
            c.strokeRect(T_to_Xpos(temp, scrYpos), scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(temp), T_to_Xpos(temp, scrYpos) + 20, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(temp, scrYpos), scrYpos);  // temperature
        } else if (wallTextureValues[4 * y + 2] == 0) { // is surface layer
          if (wallTextureValues[4 * y + 0] != 2) {      // is land, urban or fire
            c.fillStyle = 'white';
            c.lineWidth = 1.0;

            let soilMoisture_mm = waterTextureValues[4 * y + 2];
            if (soilMoisture_mm > 0.) {
              c.fillText('💧' + printSoilMoisture(soilMoisture_mm), 65, scrYpos + 17);
            }

            let snowHeight_cm = waterTextureValues[4 * y + 3];
            if (snowHeight_cm > 0.) {
              c.fillText('❄' + printSnowHeight(snowHeight_cm), 160, scrYpos + 17); // display snow height
            }
          } else if (wallTextureValues[4 * y + 0] == 2) {                          // is water
            c.fillStyle = 'lightblue';
            c.lineWidth = 1.0;
            let waterTempC = KtoC(potentialTemp);                                                           // water temperature is stored as absolute, not dependant on height
            c.fillText('🌊 🌡' + printTemp(waterTempC), T_to_Xpos(waterTempC, scrYpos) - 33, scrYpos + 17); // display water surface temperature
          }
        }
      }
      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#FF0000';
      c.stroke();


      // Draw wind indicators
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        var velocity = rawVelocityTo_ms(baseTextureValues[4 * y]); // horizontal wind velocity

        let Xpos = this.graphCanvas.width - 70;

        c.moveTo(Xpos, scrYpos);
        c.lineTo(Xpos + velocity * 2.5, scrYpos); // draw line segment
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#666666';
      c.stroke();


      // Draw Dew point line
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        if (wallTextureValues[4 * y + 1] != 0) { // fluid cell

          var dewPoint = KtoC(dewpoint(waterTextureValues[4 * y]));

          var temp = baseTextureValues[4 * y + 3] - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
          if (guiControls.realDewPoint) {
            dewPoint = Math.min(KtoC(temp), dewPoint);
          }

          var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

          var velocity = rawVelocityTo_ms(Math.sqrt(Math.pow(baseTextureValues[4 * y], 2) + Math.pow(baseTextureValues[4 * y + 1], 2)));

          c.font = '15px Arial';
          c.fillStyle = 'white';

          // c.fillText('Surface: ' + y, 10, scrYpos);
          if (y == simYpos) {
            c.fillText('' + printAltitude(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight)), 5, scrYpos + 5);

            let rh = relativeHumd(temp, waterTextureValues[4 * y]);

            if (guiControls.realDewPoint) {
              rh = Math.min(rh, 100.0);
            }

            c.fillText(rh.toFixed(1) + ' %', this.graphCanvas.width - 180, scrYpos + 20);

            c.fillText('' + printVelocity(velocity), this.graphCanvas.width - 113, scrYpos + 20);


            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;


            c.strokeRect(T_to_Xpos(dewPoint, scrYpos) - 10, scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(dewPoint), T_to_Xpos(dewPoint, scrYpos) - 70, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(dewPoint, scrYpos), scrYpos); // draw line segment
        }
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#0055FF';
      c.stroke();

      // Draw rising parcel temperature line
      var water = waterTextureValues[4 * simYpos];
      var potentialTemp = baseTextureValues[4 * simYpos + 3];
      var initialTemperature = potentialTemp - ((simYpos / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
      var initialCloudWater = waterTextureValues[4 * simYpos + 1];
      // var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight *
      // guiControls.dryLapseRate) / 1000.0 - 273.15;
      var prevTemp = initialTemperature;
      var prevCloudWater = initialCloudWater;

      var drylapsePerCell = ((-1.0 / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;

      reachedSaturation = false;

      c.beginPath();
      var scrYpos = map_range(simYpos, sim_res_y, 0, 0, graphBottem);
      c.moveTo(T_to_Xpos(KtoC(initialTemperature), scrYpos), scrYpos);
      for (var y = simYpos + 1; y < sim_res_y; y++) {
        var dT = drylapsePerCell;

        var cloudWater = Math.max(water - maxWater(prevTemp + dT),
                                  0.0); // how much cloud water there would be after that
        // temperature change

        var dWt = (cloudWater - prevCloudWater) * guiControls.evapHeat; // how much that water phase change would
        // change the temperature

        var actualTempChange = dT_saturated(dT, dWt);

        var T = prevTemp + actualTempChange;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.lineTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature

        prevTemp = T;
        prevCloudWater = Math.max(water - maxWater(prevTemp), 0.0);

        if (!reachedSaturation && prevCloudWater > 0.0) {
          reachedSaturation = true;
          c.strokeStyle = '#008800'; // dark green for dry lapse rate
          c.stroke();

          if (y - simYpos > 5) {
            c.beginPath();
            c.moveTo(T_to_Xpos(KtoC(T), scrYpos) - 0, scrYpos); // temperature
            c.lineTo(T_to_Xpos(KtoC(T), scrYpos) + 40,
                     scrYpos);                                  // Horizontal ceiling line
            c.strokeStyle = '#FFFFFF';
            c.stroke();
            c.fillText('' + printAltitude(Math.round(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight))), T_to_Xpos(KtoC(T), scrYpos) + 50, scrYpos + 5);
          }

          c.beginPath();
          c.moveTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature
        }
      }

      c.lineWidth = 2.0;           // 3
      if (reachedSaturation) {
        c.strokeStyle = '#00FF00'; // light green for saturated lapse rate
      } else
        c.strokeStyle = '#008800';

      c.stroke();


      c.fillText('' + printDistance(map_range(simXpos, 0, sim_res_y, 0, guiControls.simHeight)), this.graphCanvas.width - 70, 20);


      function T_to_Xpos(T, y)
      {
        // temperature to horizontal position
        var normX = T * 0.0115 + 1.18 - (y / graphBottem) * 0.8; // -30 to 50
        return normX * this.graphCanvas.width;                   // T * 7.5 + 780.0 - 600.0 * (y / graphBottem);
      }

      function drawIsotherms()
      {
        c.strokeStyle = '#964B00';
        c.beginPath();
        c.fillStyle = 'white';

        for (var T = -80.0; T <= 50.0; T += 10.0) {
          c.moveTo(T_to_Xpos(T, graphBottem), graphBottem);
          c.lineTo(T_to_Xpos(T, 0), 0);

          if (T >= -30.0)
            c.fillText(printTemp(Math.round(T)), T_to_Xpos(T, graphBottem) - 20, this.graphCanvas.height - 5);
        }
        c.lineWidth = 1.0;
        c.stroke();
        // draw 0 degree line thicker
        c.beginPath();
        c.moveTo(T_to_Xpos(0, graphBottem), graphBottem);
        c.lineTo(T_to_Xpos(0, 0), 0);
        c.lineWidth = 3.0;
        c.stroke();
      }
    }, // end of draw()
  };
  soundingGraph.init();

  function hideOrShowGraph()
  {
    soundingGraph.graphCanvas.style.display = guiControls.showGraph ? 'block' : 'none';
  }

  await loadingBar.set(7, 'Setting up eventlisteners');
  // END OF GRAPH


  sim_aspect = sim_res_x / sim_res_y;

  var canvas_aspect;

  canvas.width = Math.max(1, Math.floor(window.innerWidth));
  canvas.height = Math.max(1, Math.floor(window.innerHeight));
  canvas.style.display = 'block';
  canvas_aspect = canvas.width / canvas.height;

  var mouseXinSim, mouseYinSim;
  var prevMouseXinSim, prevMouseYinSim;
  let resizeTimeout;

  function resizeSimulationCanvases()
  {
    resizeTimeout = null;
    const width = Math.max(1, Math.floor(window.innerWidth));
    const height = Math.max(1, Math.floor(window.innerHeight));
    if (canvas.width == width && canvas.height == height)
      return;

    canvas.width = width;
    canvas.height = height;
    ecosystemCanvas.width = width;
    ecosystemCanvas.height = height;
    canvas_aspect = width / height;

    soundingGraph.graphCanvas.height = height;
    soundingGraph.graphCanvas.width = height;

    if (gl.isContextLost())
      return;

    createBloomFBOs();
    createHdrFBO();
    createTemporalHistoryTexture();
  }

  window.addEventListener('resize', function() {
    if (resizeTimeout !== undefined)
      clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(resizeSimulationCanvases, 250);
  });

  function logSample()
  {
    // mouse position in sim coordinates
    var simXpos = Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x)));
    var simYpos = Math.min(Math.max(Math.floor(mouseYinSim * sim_res_y), 0), sim_res_y - 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);                                         // basetexture
    var baseTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, baseTextureValues); // read single cell at mouse position

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
    var waterTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);

    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
    var wallTextureValues = new Int8Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // lighttexture_1
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    var precipitationFeedbackTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, precipitationFeedbackTextureValues);

    console.log(' ');
    console.log(' ');
    console.log('Sample at:      X: ' + simXpos + ' (' + simXpos * cellHeight / 1000 + ' km)', '  Y: ' + simYpos + ' (' + simYpos * cellHeight / 1000 + ' km)');
    console.log('BASE-----------------------------------------');
    console.log('[0] X-vel:', baseTextureValues[0]);
    console.log('[1] Y-vel:', baseTextureValues[1]);
    console.log('[2] Press:', baseTextureValues[2]);
    console.log('[3] Temp :', baseTextureValues[3].toFixed(2) + ' K   ', KtoC(baseTextureValues[3]).toFixed(2) + ' °C   ', KtoC(potentialToRealT(baseTextureValues[3], simYpos)).toFixed(2) + ' °C');

    console.log('WATER-----------------------------------------');
    console.log('[0] Water:     ', waterTextureValues[0]);
    console.log('[1] Cloudwater:', waterTextureValues[1]);
    console.log('[2] Soil Moisture / Precipitation:', waterTextureValues[2]);
    console.log('[3] Smoke/snow:', waterTextureValues[3]);

    console.log('WALL-----------------------------------------');
    console.log('[0] walltype :         ', wallTextureValues[0]);
    console.log('[1] distance:          ', wallTextureValues[1]);
    console.log('[2] Vertical distance :', wallTextureValues[2]);
    console.log('[3] Vegetation:        ', wallTextureValues[3]);

    console.log('LIGHT-----------------------------------------');
    console.log('[0] Sunlight:  ', lightTextureValues[0].toFixed(2), 'W/m²');
    console.log('[1] IR Heating:', (lightTextureValues[1] / 0.000002).toFixed(2), 'W/m²  (includes sunlight absorbed by smoke)'); // net effect of ir
    console.log('[2] IR down:   ', lightTextureValues[2].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[2])).toFixed(2) + ' °C');
    console.log('[3] IR up:     ', lightTextureValues[3].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[3])).toFixed(2) + ' °C');
    console.log('Net IR up:     ', (lightTextureValues[3] - lightTextureValues[2]).toFixed(2), 'W/m²');

    console.log('PRECIPITATION FEEDBACK-------------------------');
    console.log('[0] Mass:  ', precipitationFeedbackTextureValues[0]);
    console.log('[1] Heat:', precipitationFeedbackTextureValues[1]); // net effect of ir
    console.log('[2] Vapor:   ', precipitationFeedbackTextureValues[2]);
    console.log('[3] Snow deposition:     ', precipitationFeedbackTextureValues[3]);
  }


  var middleMousePressed = false;
  var leftMousePressed = false;
  var prevMouseX = 0;
  var prevMouseY = 0;
  var mouseX = 0;
  var mouseY = 0;
  var ctrlPressed = false;
  var rightCtrlPressed = false;
  var bPressed = false;
  var leftPressed = false;
  var downPressed = false;
  var rightPressed = false;
  var upPressed = false;
  var plusPressed = false;
  var minusPressed = false;
  var zPressed = false;

  // EVENT LISTENERS

  window.addEventListener('wheel', function(event) {
    if (event.target instanceof Element && event.target.closest('.weather-station')) {
      event.preventDefault();
      return;
    }

    var delta = 0.1;
    if (event.deltaY > 0)
      delta *= -1;
    if (typeof lastWheel == 'undefined')
      lastWheel = 0; // init static variable
    const now = new Date().getTime();

    if (bPressed) {
      const activeBrushControl = guiControls.wholeWidth ? 'wholeWidthBrushWidth' : 'brushSize';
      guiControls[activeBrushControl] *= 1.0 + delta * 1.0;
      if (guiControls[activeBrushControl] < 1)
        guiControls[activeBrushControl] = 1;
      else if (guiControls[activeBrushControl] > (guiControls.wholeWidth ? 100 : 200))
        guiControls[activeBrushControl] = guiControls.wholeWidth ? 100 : 200;
    } else {
      if (now - lastWheel > 20) {
        // change zoom
        lastWheel = now;

        cam.zoomAtMousePos(delta);
      }
    }
  }, {passive : false});

  window.addEventListener('mousemove', function(event) {
    var rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    ecosystemPointer.x = event.clientX;
    ecosystemPointer.y = event.clientY;

    if (!(guiControls.tool == 'TOOL_WALL_SEA' && leftMousePressed)) // lock y pos while drawing lake / sea
      mouseY = event.clientY - rect.top;

    if (middleMousePressed) {
      cam.changeViewXpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
      cam.changeViewYpos(-((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  });

  canvas.addEventListener('mousedown', function(e) { mouseDownEvent(e); });
  graphCanvas.addEventListener('mousedown', function(e) { mouseDownEvent(e); });


  function findSimYposAboveSurfaceAtMouseX() // find the lowest location that is not underground
  {
    let simXpos = clamp(Math.floor(mouseXinSim * sim_res_x), 0, sim_res_x - 1);
    let simYpos = clamp(Math.floor(mouseYinSim * sim_res_y), 0, sim_res_y - 1);
    // console.log(simYpos)

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture

    var wallTextureValues = new Int8Array(4 * sim_res_y);
    gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues); // read a vertical culumn of cells

    if (wallTextureValues[simYpos * 4 + 1] > 0) {                                         // place at mouse position of cell is not wall
      return simYpos;
    } else {
      for (let curSimYpos = simYpos; curSimYpos < sim_res_y; curSimYpos++) { // find first cell above that is not wall
        if (wallTextureValues[curSimYpos * 4 + 1] > 0) {                     // surface reached
          return curSimYpos;
        }
      }
    }
    return null;
  }

  // Height of the terrain surface in one column, as a cell index, or -1 when
  // the column is empty air all the way down. Wall cells have DISTANCE == 0;
  // the surface is the highest one.
  var terrainColumnValues = new Int8Array(0);
  function findTerrainSurfaceCell(simXpos)
  {
    if (terrainColumnValues.length != 4 * sim_res_y)
      terrainColumnValues = new Int8Array(4 * sim_res_y);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT2); // wall texture
    gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, terrainColumnValues);
    for (let simYpos = sim_res_y - 1; simYpos >= 0; simYpos--) {
      if (terrainColumnValues[simYpos * 4 + 1] == 0) // DISTANCE == 0 -> solid wall
        return simYpos;
    }
    return -1;
  }

  // Plant a lightning rod where the user clicked. Returns true when a rod was
  // placed; clicking the open sky (or a column without ground) does nothing,
  // because a mast standing in mid-air looks wrong.
  function tryPlaceLightningRod(simXpos, simYpos)
  {
    if (!Number.isFinite(simXpos) || !Number.isFinite(simYpos))
      return false;
    const cellX = clamp(Math.floor(clamp(simXpos, 0, 0.999999) * sim_res_x), 0, sim_res_x - 1);
    const cellY = clamp(Math.floor(clamp(simYpos, 0, 0.999999) * sim_res_y), 0, sim_res_y - 1);
    const surfaceCell = findTerrainSurfaceCell(cellX);
    if (surfaceCell < 0)
      return false; // nothing solid in this column

    const maxAirCells = Math.max(2, Math.round(sim_res_y * 0.02)); // ~240 m above the ground
    if (cellY > surfaceCell + maxAirCells)
      return false; // clicked the sky instead of the terrain

    const rodX = (cellX + 0.5) / sim_res_x;
    if (lightningRods.some(rod => Math.abs(rod.x - rodX) * sim_res_x < 2))
      return false; // a rod already stands here
    if (lightningRods.length >= MAX_LIGHTNING_RODS)
      lightningRods.shift(); // the oldest mast makes way for the new one
    lightningRods.push({ x : rodX, y : (surfaceCell + 1) / sim_res_y });
    updateLightningRodStatus();
    return true;
  }

  function placeLightningRodAtClientPoint(clientX, clientY)
  {
    const rect = canvas.getBoundingClientRect();
    return tryPlaceLightningRod(screenToSimX(clientX - rect.left), screenToSimY(clientY - rect.top));
  }

  function mouseDownEvent(e)
  {
    // event.preventDefault(); // caused problems with dat.gui
    // console.log('mousedown');
    if (e.button == 0) { // left
      leftMousePressed = true;
      if (SETUP_MODE) {
        startSimulation();
      } else if (guiControls.tool == 'TOOL_STATION') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();

        if (simXpos >= 0 && simXpos < sim_res_x && Number.isInteger(simYpos) &&
            simYpos >= 0 && simYpos < sim_res_y)
          weatherStations.push(new Weatherstation(simXpos, simYpos)); // add weather station
      } else if (guiControls.tool == 'TOOL_LIGHTNING_ROD') {
        // the Lightning Rod tool plants a mast on the terrain under the pointer
        placeLightningRodAtClientPoint(e.clientX, e.clientY);
      }
    } else if (e.button == 1) {
      // middle mouse button
      middleMousePressed = true;
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  }


  window.addEventListener('mouseup', function(event) {
    if (event.button == 0) {
      leftMousePressed = false;
    } else if (event.button == 1) {
      // middle mouse button
      middleMousePressed = false;
    }
  });


  var wasTwoFingerTouchBefore = false;

  var previousTouches;


  canvas.addEventListener('touchstart', function(event) { event.preventDefault(); }, {passive : false});

  canvas.addEventListener('touchend', function(event) {
    event.preventDefault();
    if (event.touches.length == 0) { // all fingers released
      leftMousePressed = false;
      //   }else if(event.touches.length == 1){
      wasTwoFingerTouchBefore = false;
      previousTouches = null;

      if (SETUP_MODE) {
        startSimulation();
      } else if (guiControls.tool == 'TOOL_LIGHTNING_ROD' && event.changedTouches.length) {
        placeLightningRodAtClientPoint(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
      }
    }
  }, {passive : false});

  canvas.addEventListener('touchmove', function(event) {
    event.preventDefault();

    if (event.touches.length == 1) { // single finger

      // console.log(event.touches[0]);
      if (!wasTwoFingerTouchBefore) {
        leftMousePressed = true; // treat just like holding left mouse button
        mouseX = event.touches[0].clientX;
        mouseY = event.touches[0].clientY;
      }
    } else {
      leftMousePressed = false;

      if (event.touches.length == 2 && previousTouches && previousTouches.length == 2) // 2 finger zoom
      {
        mouseX = (event.touches[0].clientX + event.touches[1].clientX) / 2.0;          // position inbetween two fingers
        mouseY = (event.touches[0].clientY + event.touches[1].clientY) / 2.0;

        let prevXsep = previousTouches[0].clientX - previousTouches[1].clientX;
        let prevYsep = previousTouches[0].clientY - previousTouches[1].clientY;
        let prevSep = Math.sqrt(prevXsep * prevXsep + prevYsep * prevYsep);

        let curXsep = event.touches[0].clientX - event.touches[1].clientX;
        let curYsep = event.touches[0].clientY - event.touches[1].clientY;
        let curSep = Math.sqrt(curXsep * curXsep + curYsep * curYsep);

        cam.zoomAtMousePos((curSep / prevSep) - 1.0);

        if (wasTwoFingerTouchBefore) {
          cam.changeViewYpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
          cam.changeViewYpos(((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
        }
        wasTwoFingerTouchBefore = true;
        prevMouseX = mouseX;
        prevMouseY = mouseY;
      }
    }

    previousTouches = event.touches;
  }, {passive : false});


  var lastBpressTime;

  function handlePause()
  {
    if (guiControls.paused) {
      soundSystem?.mute();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"]'))
      return;

    if (event.code == 'ControlLeft') {
      ctrlPressed = true;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = true;
    } else if (event.code == 'Space') {
      // space bar
      guiControls.paused = !guiControls.paused;
      handlePause();
    } else if (event.code == 'KeyD') {
      // D
      guiControls.showDrops = !guiControls.showDrops;
    } else if (event.code == 'KeyB') {
      // B: scrolling to change brush size
      bPressed = true;
      if (new Date().getTime() - lastBpressTime < 300 && guiControls.tool != 'TOOL_NONE')
        // double pressed B
        guiControls.wholeWidth = !guiControls.wholeWidth; // toggle whole width brush

      // lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyF') {
      airplane.toggleCamFollow();
    } else if (event.code == 'KeyV') {
      // V: reset view to full simulation area
      cam.center();
    } else if (event.code == 'KeyG') {
      // G
      guiControls.showGraph = !guiControls.showGraph;
      hideOrShowGraph();
    } else if (event.code == 'Tab') {
      // TAB
      event.preventDefault();
      displayVectorField = !displayVectorField;
    } else if (event.code == 'KeyS') {
      // S: log sample at mouse location
      logSample();
    } else if (event.code == 'KeyZ') {
      zPressed = true;
    } else if (event.code == 'KeyX') {
      // Sample droplets around mouse location
      logDropletsAndToggleFollow();
    } else if (event.code == 'KeyA') {
      if (airplaneMode) {
        airplane.changeDirection();
      } else if (!SETUP_MODE)
        airplane.enableAirplaneMode(event.getModifierState('CapsLock'));
    } else if (event.code == 'CapsLock') {
      if (airplaneMode)
        airplane.setAutopilot(event.getModifierState('CapsLock'));
    } else if (event.code == 'ShiftLeft') {
      airplane.toggleGear();
    } else if (event.key == '1') { // number keys for displaymodes
      setDisplayMode('DISP_TEMPERATURE');
    } else if (event.key == '2') {
      setDisplayMode('DISP_WATER');
    } else if (event.key == '3') {
      setDisplayMode('DISP_REAL');
    } else if (event.key == '4') {
      setDisplayMode('DISP_HORIVEL');
    } else if (event.key == '5') {
      setDisplayMode('DISP_VERTVEL');
    } else if (event.key == '6') {
      setDisplayMode('DISP_IRHEATING');
    } else if (event.key == '7') {
      setDisplayMode('DISP_IRDOWNTEMP');
    } else if (event.key == '8') {
      setDisplayMode('DISP_IRUPTEMP');
    } else if (event.key == '9') {
      setDisplayMode('DISP_PRECIPFEEDBACK_MASS');
    } else if (event.key == '0') {
      setDisplayMode('DISP_PRECIPFEEDBACK_HEAT');
    } else if (event.code == 'KeyK') {
      setDisplayMode('DISP_AIRQUALITY');
    } else if (event.code == 'KeyC') {
      setDisplayMode('DISP_HUMD');
    } else if (event.key == 'ArrowLeft') {
      leftPressed = true; // <
    } else if (event.key == 'ArrowUp') {
      if (!upPressed)
        airplane.onUpPressed();
      upPressed = true;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = true; // >
    } else if (event.key == 'ArrowDown') {
      if (!downPressed)
        airplane.onDownPressed();
      downPressed = true; // v
    } else if (event.key == '=' || event.key == '+') {
      event.preventDefault();
      plusPressed = true; // +
    } else if (event.key == '-') {
      event.preventDefault();
      minusPressed = true; // -
    } else if (event.code == 'Escape') {
      if (guiControls.tool == 'TOOL_NONE' && airplaneMode && confirm('Exit airplane mode?')) {
        airplane.disableAirplaneMode();
      } else {
        guiControls.tool = 'TOOL_NONE';
        guiControls.wholeWidth = false; // flashlight can't be whole width
      }
    } else if (event.code == 'KeyQ') {
      guiControls.tool = 'TOOL_TEMPERATURE';
    } else if (event.code == 'KeyW') {
      guiControls.tool = 'TOOL_WATER';
    } else if (event.code == 'KeyE') {
      guiControls.tool = 'TOOL_WALL_LAND';
    } else if (event.code == 'KeyR') {
      guiControls.tool = 'TOOL_WALL_SEA';
    } else if (event.code == 'KeyT') {
      guiControls.tool = 'TOOL_WALL_FIRE';
    } else if (event.code == 'KeyY') {
      guiControls.tool = 'TOOL_SMOKE';
    } else if (event.code == 'KeyU') {
      guiControls.tool = 'TOOL_WALL_MOIST';
    } else if (event.code == 'KeyI') {
      guiControls.tool = 'TOOL_VEGETATION';
    } else if (event.code == 'KeyO') {
      guiControls.tool = 'TOOL_WALL_SNOW';
    } else if (event.code == 'KeyP') {
      guiControls.tool = 'TOOL_WIND';
    } else if (event.code == 'BracketLeft') {
      guiControls.tool = 'TOOL_WALL_URBAN';
    } else if (event.code == 'BracketRight') {
      guiControls.tool = 'TOOL_WALL_RUNWAY';
    } else if (event.code == 'Backslash') {
      guiControls.tool = 'TOOL_WALL_INDUSTRIAL';
    } else if (event.code == 'KeyN') {
      setWeatherStationsVisible(!displayWeatherStations);

      if (guiControls.tool == 'TOOL_STATION') // prevent placing weather stations when not visible
        guiControls.tool = 'TOOL_NONE';
    } else if (event.code == 'KeyM') {
      guiControls.tool = 'TOOL_STATION';
      setWeatherStationsVisible(true);
    } else if (event.code == 'Period') {
      airplane.setBrakes(true);
    } else if (event.code == 'Slash') {
      if (airplaneMode)
        airplane.toggleEngine();
    } else if (event.code == 'KeyL') {
      if (new Date() - lastSaveTime > 120000) // more than 120 seconds)
        if (!confirm('Are you sure you want to reload without saving?'))
          return;                             // abort

      // reload simulation
      if (initialRainDrops) { // if loaded from save file
        setupPrecipitationBuffers();
        setupTextures();
        gl.bindVertexArray(fluidVao);
        // iterNum = 0;
        // frameNum = 0;
      }
    } else if (event.code == 'PageUp') {
      adjIterPerFrame(1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'PageDown') {
      adjIterPerFrame(-1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'End') {
      guiControls.auto_IterPerFrame = true;
    } else if (event.code == 'Home') {
      guiControls.auto_IterPerFrame = false;
      guiControls.IterPerFrame = 1;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code == 'ControlLeft') {
      ctrlPressed = false;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = false;
    } else if (event.code == 'KeyB') {
      bPressed = false;
      lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyZ') {
      zPressed = false;
    } else if (event.key == 'ArrowLeft') {
      leftPressed = false;  // <
    } else if (event.key == 'ArrowUp') {
      upPressed = false;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = false; // >
    } else if (event.key == 'ArrowDown') {
      downPressed = false;  // v
    } else if (event.key == '=' || event.key == '+') {
      plusPressed = false;  // +
    } else if (event.key == '-') {
      minusPressed = false; // -
    } else if (event.code == 'Period') {
      airplane.setBrakes(false);
    }
  });

  await loadingBar.set(9, 'Setting up WebGL');

  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  // gl.disable(gl.BLEND);
  // gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // load shaders
  var [commonSource, commonDisplaySource] = await Promise.all([
    loadSourceFile('shaders/common.glsl?v=2026-12-06.12'),
    loadSourceFile('shaders/commonDisplay.glsl?v=2026-12-06.12')
  ]);

  const [
    simVertexShader,
    dispVertexShader,
    realDispVertexShader,
    precipDisplayVertexShader,
    postProcessingVertexShader,
    pressureShader,
    velocityShader,
    advectionShader,
    curlShader,
    vorticityShader,
    boundaryShader,
    lightingShader,
    lightningLocationShader,
    setupShader,
    temperatureDisplayShader,
    airQualityDisplayShader,
    humidityDisplayShader,
    precipDisplayShader,
    universalDisplayShader,
    reflectivityDisplayShader,
    capeDisplayShader,
    capeColumnShader,
    skyBackgroundDisplayShader,
    realisticDisplayShader,
    IRtempDisplayShader,
    postProcessingShader,
    isolateBrightPartsShader,
    bloomBlurShader,
    precipitationVertexShader,
    precipitationShader
  ] = await Promise.all([
    'simShader.vert',
    'dispShader.vert',
    'realDispShader.vert',
    'precipDisplayShader.vert',
    'postProcessingShader.vert',
    'pressureShader.frag',
    'velocityShader.frag',
    'advectionShader.frag',
    'curlShader.frag',
    'vorticityShader.frag',
    'boundaryShader.frag',
    'lightingShader.frag',
    'lightningLocationShader.frag',
    'setupShader.frag',
    'temperatureDisplayShader.frag',
    'airQualityDisplayShader.frag',
    'humidityDisplayShader.frag',
    'precipDisplayShader.frag',
    'universalDisplayShader.frag',
    'reflectivityDisplayShader.frag',
    'capeDisplayShader.frag',
    'capeColumnShader.frag',
    'skyBackgroundDisplayShader.frag',
    'realisticDisplayShader.frag',
    'IRtempDisplayShader.frag',
    'postProcessingShader.frag',
    'isolateBrightPartsShader.frag',
    'bloomBlurShader.frag',
    'precipitationShader.vert',
    'precipitationShader.frag'
  ].map(name => loadShader(name)));


  // create programs
  const pressureProgram = createProgram(simVertexShader, pressureShader);
  const velocityProgram = createProgram(simVertexShader, velocityShader);
  const advectionProgram = createProgram(simVertexShader, advectionShader);
  const curlProgram = createProgram(simVertexShader, curlShader);
  const vorticityProgram = createProgram(simVertexShader, vorticityShader);
  const boundaryProgram = createProgram(simVertexShader, boundaryShader);

  const lightingProgram = createProgram(simVertexShader, lightingShader);

  const lightningLocationProgram = createProgram(simVertexShader, lightningLocationShader);

  const setupProgram = createProgram(simVertexShader, setupShader);

  const temperatureDisplayProgram = createProgram(dispVertexShader, temperatureDisplayShader);
  const airQualityDisplayProgram = createProgram(dispVertexShader, airQualityDisplayShader);
  const humidityDisplayProgram = createProgram(dispVertexShader, humidityDisplayShader);
  const precipDisplayProgram = createProgram(precipDisplayVertexShader, precipDisplayShader);
  const universalDisplayProgram = createProgram(dispVertexShader, universalDisplayShader);
  const reflectivityDisplayProgram = createProgram(dispVertexShader, reflectivityDisplayShader);
  const capeDisplayProgram = createProgram(dispVertexShader, capeDisplayShader);
  const capeColumnProgram = createProgram(simVertexShader, capeColumnShader);
  const skyBackgroundDisplayProgram = createProgram(realDispVertexShader, skyBackgroundDisplayShader);
  const realisticDisplayProgram = createProgram(realDispVertexShader, realisticDisplayShader);
  const IRtempDisplayProgram = createProgram(dispVertexShader, IRtempDisplayShader);

  const postProcessingProgram = createProgram(postProcessingVertexShader, postProcessingShader);
  const isolateBrightPartsProgram = createProgram(postProcessingVertexShader, isolateBrightPartsShader);
  const bloomBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);
  // const lightBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);


  await loadingBar.set(60, 'Uploading simulation textures');

  // // quad that fills the screen, so fragment shader is run for every pixel //
  // X, Y,  U, V  (x4)

  // Don't ask me why, but the * 1.0000001 is nesesary to get exactly round half
  // ( x.5 ) fragcoordinates in the fragmentshaders I figured this out
  // experimentally. It took me days! Without it the linear interpolation would
  // get fucked up because of the tiny offsets
  const fluidQuadVertices = [
    // X, Y,  U, V
    1.0,
    -1.0,
    sim_res_x * 1.0000001,
    0.0,
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    sim_res_x * 1.0000001,
    sim_res_y * 1.0000001,
    -1.0,
    1.0,
    0.0,
    sim_res_y * 1.0000001,
  ];

  var fluidVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(fluidVao);
  var fluidVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fluidVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fluidQuadVertices), gl.STATIC_DRAW);
  var positionAttribLocation = gl.getAttribLocation(pressureProgram,
                                                    'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  var texCoordAttribLocation = gl.getAttribLocation(pressureProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  const postProcessingQuadVertices = [
    1.0,  // X
    -1.0, // Y
    1.0,  // U
    0.0,  // V
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    1.0,
    1.0,
    -1.0,
    1.0,
    0.0,
    1.0,
  ];

  var postProcessingVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(postProcessingVao);
  var postProcessingVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, postProcessingVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(postProcessingQuadVertices), gl.STATIC_DRAW);
  positionAttribLocation = gl.getAttribLocation(postProcessingProgram,
                                                'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  texCoordAttribLocation = gl.getAttribLocation(postProcessingProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  // Precipitation setup

  const precipitationProgram = createProgram(precipitationVertexShader, precipitationShader, [ 'position_out', 'mass_out', 'density_out' ]);

  gl.useProgram(precipitationProgram);

  const dropPositionAttribLocation = 0;
  const massAttribLocation = 1;
  const densityAttribLocation = 2;

  var lightEven = true;
  var precipitationEven = true;

  const precipitationVao_0 = gl.createVertexArray();
  const precipVertexBuffer_0 = gl.createBuffer();
  const precipitationTF_0 = gl.createTransformFeedback();
  const precipitationVao_1 = gl.createVertexArray();
  const precipVertexBuffer_1 = gl.createBuffer();
  const precipitationTF_1 = gl.createTransformFeedback();


  var rainDrops;

  function initRainDrops()
  {
    rainDrops = [];
    // generate inactive droplets with random values to be used as seeds for random spawning
    for (var i = 0; i < NUM_DROPLETS; i++) {
      // seperate push for each element is fastest
      rainDrops.push(Math.random());         // X
      rainDrops.push(Math.random());         // Y
      rainDrops.push(-10.0 + Math.random()); // water negative to disable
      rainDrops.push(Math.random());         // ice
      rainDrops.push(Math.random());         // density
    }
  }

  function setupPrecipitationBuffers()
  {
    precipitationEven = true;
    gl.bindVertexArray(precipitationVao_0);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_0);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_0); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    // var precipitationVao_1 = gl.createVertexArray();
    gl.bindVertexArray(precipitationVao_1);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_1);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_1); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    gl.bindBuffer(gl.ARRAY_BUFFER, null); // buffers are bound via VAO's
    gl.bindVertexArray(fluidVao);         // set screenfilling rect again
  }


  const valsPerDroplet = 5;

  function logDropletsAndToggleFollow()
  {
    if (dropletFollowID >= 0) { // disable follow droplet
      dropletFollowID = -1;
      let dropletInfoCanvas = document.getElementById('dropletInfoCanvas');
      dropletInfoCanvas.style.display = 'none';
      return;
    }

    // log data of all the droplets within the brush
    let tempDroplets = new Float32Array(valsPerDroplet * NUM_DROPLETS);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, precipitationEven ? precipVertexBuffer_0 : precipVertexBuffer_1); // x, y, water, ice, density
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tempDroplets);

    console.log(' ');
    console.log(' ');
    console.log('DROPLETS:-----------------------------------------');
    console.log(' ');

    let numInBrush = 0;
    let duplicates = 0;

    for (let n = 0; n < NUM_DROPLETS; n++) {
      let i = n * valsPerDroplet;
      let X = tempDroplets[i + 0];
      let Y = tempDroplets[i + 1];
      let x = (X + 1.0) / 2.0;
      let y = (Y + 1.0) / 2.0;
      let water = tempDroplets[i + 2];
      let ice = tempDroplets[i + 3];
      let density = tempDroplets[i + 4];

      let dx = (mouseXinSim - x) * sim_aspect;
      let dy = mouseYinSim - y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < guiControls.brushSize / 2.0 / sim_res_y && water >= 0) { // if droplet is within the brush and active
        console.log('n:', n);
        console.log('x:', x);
        console.log('y:', y);
        console.log('water:', water);
        console.log('Ice:', ice);
        console.log('Density:', density);
        console.log(' ');
        numInBrush++;


        if (numInBrush == 1) { // first droplet found
          dropletFollowID = n;
          dropletInfoCanvas.style.display = 'block';
        }
      }
      /*
        // check for duplicates. Very slow!
        if (n < NUM_DROPLETS - 1) {
          for (let d = n + 1; d < NUM_DROPLETS; d++) {
            let j = d * valsPerDroplet;
            if (X == tempDroplets[j + 0] && Y == tempDroplets[j + 1]) {
              duplicates++;
              break;
            }
          }
        }
      */
    }
    console.log(NUM_DROPLETS, 'total droplets. ', numInBrush, 'droplets logged. ', duplicates, ' duplicates found');


    // dropletFollowMode = true;
  }


  function readDropletData(n)
  {
    let i = n * valsPerDroplet;
    let byteOffset = i * 4; // Convert to byte offset

    let dropletData = new Float32Array(valsPerDroplet);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, precipitationEven ? precipVertexBuffer_0 : precipVertexBuffer_1);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, byteOffset, dropletData, 0, valsPerDroplet);

    dropletData[0] = (dropletData[0] + 1.0) / 2.0;
    dropletData[1] = (dropletData[1] + 1.0) / 2.0;

    // let x = dropletData[0];
    // let y = dropletData[1];
    // let water = dropletData[2];
    // let ice = dropletData[3];
    // let density = dropletData[4];

    // console.log('Droplet ', n);
    // console.log('x:', x);
    // console.log('y:', y);
    // console.log('water:', water);
    // console.log('Ice:', ice);
    // console.log('Density:', density);
    // console.log(' ');

    return dropletData;
  }


  if (initialRainDrops) {
    rainDrops = initialRainDrops;
  } else {
    initRainDrops();
  }

  setupPrecipitationBuffers();


  /*

  TEXTURE DESCRIPTIONS

  base texture: RGBA32F
  [0] = Horizontal velocity                              -1.0 to 1.0
  [1] = Vertical   velocity                              -1.0 to 1.0
  [2] = Pressure                                          >= 0
  [3] = Temperature in air, indicator in wall

  water texture: RGBA32F
  [0] = total water                                        >= 0
  [1] = cloud water                                        >= 0
  [2] = precipitation in air, moisture in surface          >= 0
  [3] = smoke/dust in air, snow in surface                 >= 0 for smoke/dust
  0 to 100 for snow

  wall texture: RGBA8I
  [0] walltype
  [1] manhattan distance to nearest wall                   0 to 127
  [2] height above/below ground. Surface = 0               -127 to 127
  [3] vegetation                                           0 to 127     grass from 0 to 50, trees from 50 to 127

  lighting texture: RGBA32F
  [0] sunlight                                             0 to 1.0
  [1] net heating effect of IR + sun absorbed by smoke
  [2] IR coming down                                       >= 0
  [3] IR going  up                                         >= 0

  */

  const baseTexture_0 = gl.createTexture();
  const baseTexture_1 = gl.createTexture();
  const waterTexture_0 = gl.createTexture();
  const waterTexture_1 = gl.createTexture();
  const wallTexture_0 = gl.createTexture();
  const wallTexture_1 = gl.createTexture();

  const curlTexture = gl.createTexture();
  const vortForceTexture = gl.createTexture();

  const lightTexture_0 = gl.createTexture();
  const lightTexture_1 = gl.createTexture();
  const precipitationFeedbackTexture = gl.createTexture();
  const precipitationDepositionTexture = gl.createTexture();
  const rainDepositionAccumulationTexture = gl.createTexture();
  const zeroColorClearValue = new Float32Array(4);
  // Lightning slot array: one texel per strike (position, start iteration,
  // intensity). A strike owns its slot for its whole animation, so a newer
  // strike can never interrupt one that is still flashing. Two textures are
  // ping-ponged because the slot manager samples the previous state while it
  // writes the next one (sampling and rendering the same texture in one draw
  // is a feedback loop). Keep numLightningSlots in sync with LIGHTNING_SLOTS
  // in shaders/common.glsl.
  const numLightningSlots = 6;
  const START_ITERNUM_INDEX = 2; // matches #define START_ITERNUM in shaders/common.glsl
  const lightningDataTextures = [gl.createTexture(), gl.createTexture()];
  let lightningDataSrc = 0; // index of the slot array that is currently valid

  // Static texures:
  const noiseTexture = gl.createTexture();
  const A380Texture = gl.createTexture();
  const A380_R_Texture = gl.createTexture();
  const A380GearTexture = gl.createTexture();
  const surfaceTextureMap = gl.createTexture();
  const colorScalesTexture = gl.createTexture();

  const lightningTextures = [];
  // How many bolt artworks to keep resident. One tile is a whole bolt at
  // 2500 x 5000 texels, which is 12.5 MB of texture memory; the original ten is
  // 125 MB, and a GPU with a tight texture budget drops the context rather than
  // refuse it. Four is 50 MB and still gives the storm four different shapes to
  // cycle through.
  const numLightningTextures = 4;



  frameBuff_0 = gl.createFramebuffer(); // global for weather stations
  const frameBuff_1 = gl.createFramebuffer();

  const curlFrameBuff = gl.createFramebuffer();
  const vortForceFrameBuff = gl.createFramebuffer();

  lightFrameBuff_0 = gl.createFramebuffer();
  const lightFrameBuff_1 = gl.createFramebuffer();
  precipitationFeedbackFrameBuff = gl.createFramebuffer();
  const lightningDataFrameBuffs = [gl.createFramebuffer(), gl.createFramebuffer()];

  // Set up Textures
  async function setupTextures()
  {
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    lastSaveTime = new Date();
  }

  setupTextures();

  createAmbientLightFBOs();
  capeColumnFBO = new FBO(sim_res_x, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);

  // Set up Framebuffers


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_0, 0);


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_1, 0);


  gl.bindTexture(gl.TEXTURE_2D, curlTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim_res_x, sim_res_y, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, curlTexture,
                          0); // attach the texture as the first color attachment


  gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vortForceTexture, 0);

  gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
                null);                                               // HALF_FLOAT before, but problems with acuracy
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
                   gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);    // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindTexture(gl.TEXTURE_2D, rainDepositionAccumulationTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim_res_x, sim_res_y, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, precipitationFeedbackTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, precipitationDepositionTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, rainDepositionAccumulationTexture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  gl.clearBufferfv(gl.COLOR, 2, zeroColorClearValue);

  for (let i = 0; i < 2; i++) {
    gl.bindTexture(gl.TEXTURE_2D, lightningDataTextures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, numLightningSlots, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuffs[i]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightningDataTextures[i], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    // all slots idle
    gl.clearBufferfv(gl.COLOR, 0, zeroColorClearValue);
  }

  // Load images together so one request does not delay the rest.
  const [
    noiseImage,
    airplaneImage,
    airplaneReversedImage,
    airplaneGearImage,
    surfaceTextureImage,
    colorScalesImage
  ] = await Promise.all([
    'resources/img/noise_texture.jpg',
    'resources/img/A380.png',
    'resources/img/A380_R.png',
    'resources/img/A380_gear.png',
    'resources/img/surfaceTextureMap.png',
    'resources/img/ColorScales.png'
  ].map(url => loadImage(url)));

  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, noiseImage.width, noiseImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseImage);

  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,
  //     gl.REPEAT);  // default, so no need to set
  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
  //     gl.REPEAT);  // default, so no need to set

  gl.bindTexture(gl.TEXTURE_2D, A380Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, airplaneImage.width, airplaneImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, airplaneImage);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT
                                                                                   // NEAREST_MIPMAP_LINEAR create weird effects

  gl.bindTexture(gl.TEXTURE_2D, A380_R_Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, airplaneReversedImage.width, airplaneReversedImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, airplaneReversedImage);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, airplaneGearImage.width, airplaneGearImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, airplaneGearImage);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, surfaceTextureImage.width, surfaceTextureImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, surfaceTextureImage);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);        // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical


  gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, colorScalesImage.width, colorScalesImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorScalesImage);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical


  function generateLightningTexture(i, bitmap)
  {
    gl.bindTexture(gl.TEXTURE_2D, lightningTextures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bitmap);
    bitmap.close();
    // The bolt is a 9 pixel channel on a tile that is minified about ten texels per
    // screen pixel at the default camera, so a single level-0 fetch lands on the
    // channel or beside it from one screen row to the next. A stroke still takes
    // that fetch (textureLod 0.0, see displayLightning); a flash, which is drawn
    // inside a bright cloud where a miss is invisible, reads the mip chain instead
    // and gets the channel's average. The chain costs a third on top of the tile.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  }


  function generateLightningNetworkTexture(bitmap)
  {
    gl.bindTexture(gl.TEXTURE_2D, lightningNetworkTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bitmap);
    bitmap.close();
    // The network's channels are two to three artwork pixels wide on a tile that
    // lands about one texel per screen pixel, so it needs a mip chain for the same
    // reason the bolt does: at any zoom out, a level-0 fetch of a fine channel is a
    // dash, and a flash made of dashes is not a network.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  }


  /*
   * Lightning artwork, generated one tile at a time and only when it is needed.
   *
   * This used to start two workers right here, in the middle of shader
   * compilation and buffer creation, and each of them was a 2500 x 5000 canvas
   * (a 50 MB backing store) being drawn with tens of thousands of segments and
   * then uploaded as a 12.5 MB texture. That is the hitch at the end of the
   * loading bar, and on a device with a tight memory budget it is also what takes
   * the graphics context down with it.
   *
   * So: one worker at a time, never while the loading screen is still up, at
   * least a second apart, only for the tile the simulation has actually reached,
   * and never more than numLightningTextures of them. The display clamps to the
   * newest tile it has (see the draw loop), so a bolt is never invisible while
   * the artwork is still catching up.
   */
  let lightningTexturesReady = 0;        // tiles 0 .. ready-1 are filled
  let lightningNetworkReady = false;     // the intra-cloud network tile is up
  let lightningTextureWorkerBusy = false;
  let lightningTextureLastStart = 0;
  let lightningTextureFailures = 0;

  /*
   * Which piece of artwork to ask for next. The order matters: the first bolt tile
   * and then the flash network, so that both kinds of strike have a picture before
   * the rest of the bolt variants exist. Anything else would leave one kind
   * invisible for the first few seconds of a storm.
   */
  function nextLightningJob()
  {
    if (lightningTexturesReady < 1)
      return {kind : 'bolt', index : 0};
    if (!lightningNetworkReady)
      return {kind : 'network'};
    if (lightningTexturesReady < numLightningTextures)
      return {kind : 'bolt', index : lightningTexturesReady};
    return null;
  }

  function startLightningTextureWorker()
  {
    if (lightningTextureWorkerBusy)
      return;
    if (lightningTextureFailures >= 4)  // the worker is not coming back; stop asking
      return;
    if (document.hidden)               // nothing to show, nothing to draw
      return;
    if (performance.now() - lightningTextureLastStart < 1000)
      return;                          // one tile a second: this is not what loading is for

    const job = nextLightningJob();
    if (!job)
      return;

    lightningTextureLastStart = performance.now();
    lightningTextureWorkerBusy = true;

    const lightningGeneratorWorker = new Worker('./lightningGenerator.js?v=2026-12-06.12');
    const stop = () => {
      lightningGeneratorWorker.terminate();
      lightningTextureWorkerBusy = false;
    };
    lightningGeneratorWorker.onmessage = event => {
      if (job.kind === 'network') {
        generateLightningNetworkTexture(event.data);
        lightningNetworkReady = true;
      } else {
        generateLightningTexture(job.index, event.data);
        lightningTexturesReady = job.index + 1;
      }
      stop();
    };
    lightningGeneratorWorker.onerror = event => {
      console.error('Lightning texture generation failed.', event.message);
      lightningTextureFailures++;
      lightningTextureLastStart = performance.now() + 6000; // back off; do not spin
      stop();
    };

    if (job.kind === 'network') {
      // The intra-cloud channel network: 2048 x 512, a megabyte, one of them. The
      // display maps it onto 0.45 by 0.225 of the simulation, which puts one
      // artwork pixel on about one screen pixel.
      lightningGeneratorWorker.postMessage({kind : 'network', width : 2048, height : 512});
    } else {
      // The original tile: 2500 x 5000 at a 9 pixel channel. The fork this repo
      // started from halved both and doubled the brightness gain (1250 x 2500 at
      // 4.5 px); that keeps the relative width but loses half the texels, so the
      // channel is softer and breaks up sooner when the camera pulls back.
      lightningGeneratorWorker.postMessage({width : 2500, height : 5000}); // 10000 5000
    }
  }

  const emptyLightningTexturePixel = new Uint8Array([0]);
  for (let i = 0; i < numLightningTextures; i++) {
    lightningTextures[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lightningTextures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, emptyLightningTexturePixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  }
  // The intra-cloud network, one tile. Same storage as a bolt tile (R8, mip-mapped
  // once it is uploaded), a fifth of the size.
  const emptyLightningNetworkPixel = new Uint8Array([0]);
  const lightningNetworkTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lightningNetworkTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, emptyLightningNetworkPixel);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  // Nothing is generated while the loading screen is up: the first tile is asked
  // for once the simulation is running (see the draw loop), and the rest after it
  // as the strike windows come round.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden)
      startLightningTextureWorker();
  });

  await loadingBar.set(78, 'Preparing render buffers');

  createHdrFBO();

  createBloomFBOs();
  createTemporalHistoryTexture();

  var texelSizeX = 1.0 / sim_res_x;
  var texelSizeY = 1.0 / sim_res_y;

  dryLapse = (guiControls.simHeight * guiControls.dryLapseRate) / 1000.0; // total lapse rate from bottem to top of atmosphere


  // generate sounding data for forcing in sim

  var realWorldSounding_T = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_W = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_Vel = new Float32Array(504); // sim_res_y + 1
  if (soundingData && soundingData.length > 10) {
    var soundingForSim = rawSoundingToSimSounding(soundingData, guiControls.simHeight, sim_res_y + 1);

    for (var y = 0; y < sim_res_y + 1; y++) {

      let soundingSample = soundingForSim[y];

      realWorldSounding_T[y] = realToPotentialT(CtoK(soundingSample.t), y); // initial temperature profile
      realWorldSounding_W[y] = maxWater(CtoK(soundingSample.td), y);        // initial temperature profile
      realWorldSounding_Vel[y] = soundingSample.vel;
    }
    // console.log(realWorldSounding_T);
    // console.log(realWorldSounding_W);
    // console.log(realWorldSounding_Vel);
  } else {
    console.log('No valid sounding loaded!');
  }

  // generate Initial temperature profile

  var initial_T = new Float32Array(504); // sim_res_y + 1

  for (var y = 0; y < sim_res_y + 1; y++) {
    let altitude = y / (sim_res_y + 1) * guiControls.simHeight;
    var realTemp = Math.max(map_range(altitude, 0, 12000, 15.0, -70.0), -60);

    initial_T[y] = realToPotentialT(CtoK(realTemp), y); // initial temperature profile
  }

  cellHeight = guiControls.simHeight / sim_res_y; // in meters

  // Upload the initial temperature profile and the real-world sounding as a
  // float texture (504 x 4, one row per profile) instead of uniform arrays.
  // The advection program previously received this data as 4 vec4[126] uniform
  // arrays: 504 fragment uniform vectors, more than the 224 vectors WebGL2
  // guarantees (MAX_FRAGMENT_UNIFORM_VECTORS), which made shader compilation
  // fail with "too many uniforms" errors on many GPUs.
  var soundingTextureData = new Float32Array(504 * 4);
  soundingTextureData.set(initial_T, 0);              // row 0
  soundingTextureData.set(realWorldSounding_T, 504);  // row 1
  soundingTextureData.set(realWorldSounding_W, 1008); // row 2
  soundingTextureData.set(realWorldSounding_Vel, 1512); // row 3

  var soundingTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE15); // units 0-10 are used per pass; 15 stays untouched
  gl.bindTexture(gl.TEXTURE_2D, soundingTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 504, 4, 0, gl.RED, gl.FLOAT, soundingTextureData);
  gl.activeTexture(gl.TEXTURE0);

  // Set constant uniforms
  gl.useProgram(setupProgram);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'simHeight'), guiControls.simHeight);

  gl.uniform1i(gl.getUniformLocation(setupProgram, 'soundingTex'), 15);

  gl.useProgram(advectionProgram);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wallTex'), 2);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'soundingTex'), 15);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input

  gl.useProgram(pressureProgram);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'wallTex'), 1);
  gl.uniform2f(gl.getUniformLocation(pressureProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.useProgram(velocityProgram);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'wallTex'), 1);
  gl.uniform2f(gl.getUniformLocation(velocityProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'soundingTex'), 15);

  gl.useProgram(vorticityProgram);
  gl.uniform2f(gl.getUniformLocation(vorticityProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'curlTex'), 0);

  gl.useProgram(boundaryProgram);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'vortForceTex'), 2);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'wallTex'), 3);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'lightTex'), 4);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipFeedbackTex'), 5);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipDepositionTex'), 6);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'),
               guiControls.vorticity);              // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dryLapse'), dryLapse);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'soundingTex'), 15);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);

  gl.useProgram(curlProgram);
  gl.uniform2f(gl.getUniformLocation(curlProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(curlProgram, 'baseTex'), 0);

  gl.useProgram(lightingProgram);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'lightTex'), 3);
  gl.uniform1f(gl.getUniformLocation(lightingProgram, 'dryLapse'), dryLapse);

  // Display programs:
  gl.useProgram(temperatureDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(airQualityDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(humidityDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(humidityDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(humidityDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(humidityDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(humidityDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(humidityDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(humidityDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(humidityDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(precipDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'waterTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'wallTex'), 2);

  gl.useProgram(skyBackgroundDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'simHeight'), guiControls.simHeight);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'precipFeedbackTex'), 7);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeTex'), 8);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeGearTex'), 10);

  gl.useProgram(universalDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'anyTex'), 0);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'wallTex'), 2);

  gl.useProgram(realisticDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'noiseTex'), 4);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'surfaceTextureMap'), 5);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'curlTex'), 6);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningTex'), 7);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningNetworkTex'), 10);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningDataTex'), 8);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cellHeight'), cellHeight);

  gl.useProgram(precipitationProgram);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'lightningDataTex'), 2);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLapse'), dryLapse);
  gl.useProgram(IRtempDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'lightTex'), 0);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'wallTex'), 2);

  gl.useProgram(reflectivityDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(reflectivityDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(reflectivityDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(reflectivityDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(reflectivityDisplayProgram, 'wallTex'), 2);

  gl.useProgram(capeDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(capeDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(capeDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(capeDisplayProgram, 'capeTex'), 3);
  gl.uniform1i(gl.getUniformLocation(capeDisplayProgram, 'wallTex'), 2);

  gl.useProgram(capeColumnProgram);
  gl.uniform2f(gl.getUniformLocation(capeColumnProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1f(gl.getUniformLocation(capeColumnProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(capeColumnProgram, 'simHeight'), guiControls.simHeight);
  gl.uniform1i(gl.getUniformLocation(capeColumnProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(capeColumnProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(capeColumnProgram, 'wallTex'), 2);

  gl.useProgram(postProcessingProgram);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'hdrTex'), 0);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'bloomTex'), 1);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'historyTex'), 2);


  gl.useProgram(isolateBrightPartsProgram);
  gl.uniform1i(gl.getUniformLocation(isolateBrightPartsProgram, 'hdrTex'), 0);

  gl.useProgram(lightningLocationProgram);
  gl.uniform1i(gl.getUniformLocation(lightningLocationProgram, 'precipFeedbackTex'), 0);
  gl.uniform1i(gl.getUniformLocation(lightningLocationProgram, 'lightningDataTex'), 1);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'texelSize'), texelSizeX, texelSizeY);

  // Lightning rods. Geometry is expressed in cells so a mast keeps the same
  // physical size at any resolution; the placed rods themselves are uploaded
  // every frame because the Lightning Rod tool can add one at any time.
  const rodPositionData = new Float32Array(MAX_LIGHTNING_RODS * 2);
  const rodUniformLocations = new Map();
  const rodThickness = clamp(sim_res_x * 0.0025, 2.5, 28.0); // half width, in cells
  const rodHeight = clamp(600.0 / cellHeight, 6.0, 60.0);    // mast height, in cells
  const rodAttractRadius = 0.08;                             // reach, normalized sim width

  function lightningRodUniforms(program)
  {
    let locations = rodUniformLocations.get(program);
    if (locations == null) {
      locations = {
        positions : gl.getUniformLocation(program, 'rodPositions[0]'),
        count : gl.getUniformLocation(program, 'rodCount'),
        thickness : gl.getUniformLocation(program, 'rodThickness'),
        height : gl.getUniformLocation(program, 'rodHeight'),
        attractRadius : gl.getUniformLocation(program, 'rodAttractRadius')
      };
      rodUniformLocations.set(program, locations);
    }
    return locations;
  }

  function uploadLightningRodUniforms(program)
  {
    const locations = lightningRodUniforms(program);
    gl.useProgram(program); // uniform locations are only valid for the active program
    const count = Math.min(lightningRods.length, MAX_LIGHTNING_RODS);
    rodPositionData.fill(0);
    for (let i = 0; i < count; i++) {
      rodPositionData[i * 2] = lightningRods[i].x;
      rodPositionData[i * 2 + 1] = lightningRods[i].y;
    }
    if (locations.positions != null)
      gl.uniform2fv(locations.positions, rodPositionData);
    if (locations.count != null)
      gl.uniform1i(locations.count, count);
    if (locations.thickness != null)
      gl.uniform1f(locations.thickness, rodThickness);
    if (locations.height != null)
      gl.uniform1f(locations.height, rodHeight);
    if (locations.attractRadius != null)
      gl.uniform1f(locations.attractRadius, rodAttractRadius);
  }

  uploadLightningRodUniforms(lightningLocationProgram);

  // console.time('Set uniforms');
  setGuiUniforms(); // all uniforms changed by gui
  // console.timeEnd('Set uniforms')

  gl.bindVertexArray(fluidVao);

  // if no save file was loaded
  // Use setup shader to set initial conditions
  if (initialWallTex == null) {
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.useProgram(setupProgram);
    // Render to both framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  await loadingBar.set(86, 'Generating procedural plant sprites');
  try {
    await plantEcosystem.generateSprites();
  } catch (error) {
    console.error('Plant sprites could not be generated.', error);
    alert('Plant sprites could not be generated. The weather simulation will continue without plants.');
    guiControls.showPlants = false;
    guiControls.plantGrowth = false;
    ecosystemStatus.population = 'Plant sprites failed to generate';
  }

  if (!SETUP_MODE) {
    startSimulation();
  }

  if (guiControls.sound) {
    soundSystem = new SoundSystem();
  }

  await loadingBar.set(94, 'Loading sounds and preparing the simulation');

  var srcVAO;
  var destTF;
  let lastLightningSoundIteration = 0;
  let lastLightningSoundCheckIteration = 0;
  let lightningSoundFrame = 0;
  const lightningDataValues = new Float32Array(numLightningSlots * 4);

  // preload uniform locations for tiny performance gain
  var uniformLocation_boundaryProgram_iterNum = gl.getUniformLocation(boundaryProgram, 'iterNum');


  for (const station of weatherStations.slice()) // initial measurement may remove stations on solid terrain
    station.measure();

  setInterval(calcFps, 1000); // log fps
  setInterval(publishWeatherDataIfEnabled, 1000);
  // The first bolt, just after the loading screen has gone. One worker, and it
  // starts a second late on purpose: the first frames are the expensive ones.
  setTimeout(startLightningTextureWorker, 1200);
  requestAnimationFrame(draw);
  await loadingBar.set(100, 'Simulation ready');
  await new Promise(resolve => setTimeout(resolve, 350));
  await loadingBar.remove(true);

  function draw()
  { // Runs for every frame
    if (graphicsContextLost) // nothing left to draw with; the overlay explains why
      return;

    let camPanSpeed = guiControls.camSpeed;

    if (rightCtrlPressed) {
      camPanSpeed *= 0.2;
    }

    if (!airplaneMode) {
      if (upPressed) {
        // ^
        cam.changeViewYpos(-camPanSpeed / cam.curZoom);
      }
      if (downPressed) {
        // v
        cam.changeViewYpos(camPanSpeed / cam.curZoom);
      }
    }
    if (leftPressed) {
      // <
      cam.changeViewXpos(camPanSpeed / cam.curZoom);
    }
    if (rightPressed) {
      // >
      cam.changeViewXpos(-camPanSpeed / cam.curZoom);
    }
    if (plusPressed) {
      // +
      cam.changeViewZoom(camPanSpeed);
    }
    if (minusPressed) {
      // -
      cam.changeViewZoom(-camPanSpeed);
    }

    cam.move();

    prevMouseXinSim = mouseXinSim;
    prevMouseYinSim = mouseYinSim;

    mouseXinSim = screenToSimX(mouseX);
    mouseYinSim = screenToSimY(mouseY);

    if (SETUP_MODE) {
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.useProgram(setupProgram);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'seed'), mouseXinSim);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'heightMult'), ((canvas.height - mouseY) / canvas.height) * 2.0);
      // Render to both framebuffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // NOT SETUP MODE:

      // gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(advectionProgram);

      var inputType = -1;
      if (leftMousePressed) {
        if (guiControls.tool == 'TOOL_NONE')
          inputType = 0; // only flashlight on
        else if (guiControls.tool == 'TOOL_TEMPERATURE')
          inputType = 1;
        else if (guiControls.tool == 'TOOL_WATER')
          inputType = 2;
        else if (guiControls.tool == 'TOOL_SMOKE')
          inputType = 3;
        else if (guiControls.tool == 'TOOL_WIND')
          inputType = 4;
        else if (guiControls.tool == 'TOOL_WIND_PUSH')
          inputType = 5;
        else if (guiControls.tool == 'TOOL_WALL')
          inputType = 10;
        else if (guiControls.tool == 'TOOL_WALL_LAND')
          inputType = 11;
        else if (guiControls.tool == 'TOOL_WALL_SEA')
          inputType = 12;
        else if (guiControls.tool == 'TOOL_WALL_FIRE')
          inputType = 13;
        else if (guiControls.tool == 'TOOL_WALL_URBAN')
          inputType = 14;
        else if (guiControls.tool == 'TOOL_WALL_RUNWAY')
          inputType = 15;
        else if (guiControls.tool == 'TOOL_WALL_INDUSTRIAL')
          inputType = 16;

        // Surface environment modifiers
        else if (guiControls.tool == 'TOOL_WALL_MOIST')
          inputType = 20;
        else if (guiControls.tool == 'TOOL_WALL_SNOW')
          inputType = 21;
        else if (guiControls.tool == 'TOOL_VEGETATION')
          inputType = 22;

        var intensity = guiControls.brushIntensity;

        if (ctrlPressed) {
          intensity *= -1;
        }

        var posXinSim;

        if (guiControls.wrapHorizontally)
          posXinSim = mod(mouseXinSim, 1.0); // wrap mouse position around borders
        else
          posXinSim = clamp(mouseXinSim, 0.0, 1.0);


        let moveX = mouseXinSim - prevMouseXinSim;
        let moveY = mouseYinSim - prevMouseYinSim;

        gl.uniform4f(gl.getUniformLocation(advectionProgram, 'userInputValues'), posXinSim, mouseYinSim, intensity, guiControls.brushSize * 0.5);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wholeWidthBrush'), guiControls.wholeWidth);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'wholeWidthBrushWidth'), guiControls.wholeWidthBrushWidth * 0.01);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushVelocity'), msToRawVelocity(guiControls.windPushStrengthMph * 0.44704));
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushDirection'), guiControls.windPushDirection == 'left' ? -1.0 : 1.0);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'windPushSetTemperature'), guiControls.windPushSetTemperature);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushAirTemperatureC'), guiControls.windPushAirTemperatureC);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'windPushSetHumidity'), guiControls.windPushSetHumidity);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushRelativeHumidity'), guiControls.windPushRelativeHumidity * 0.01);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushWidth'), guiControls.wholeWidthBrushWidth * 0.01);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'windPushDepth'), guiControls.brushSize / sim_res_y);
        gl.uniform2f(gl.getUniformLocation(advectionProgram, 'userInputMove'), moveX, moveY);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wrapHorizontally'), guiControls.wrapHorizontally);
      }
      gl.uniform1i(gl.getUniformLocation(advectionProgram, 'userInputType'), inputType);


      // guiControls.IterPerFrame = 1.0 / timePerIteration * 3600 / 60.0;


      if (!guiControls.paused) { // Simulation part

        const sunAngle = guiControls.sunAngle;
        let nightAccelerationActive = !airplaneMode && guiControls.dayNightCycle && guiControls.accelerateNight && (sunAngle < 0. || sunAngle > 180.);

        if (guiControls.dayNightCycle) {
          if (airplaneMode) {
            updateSunlight(1.0 / 3600.0 / 60);                                                                    // increase solar time at real speed: 1/60 seconds per frame
          } else {
            updateSunlight(timePerIteration * guiControls.IterPerFrame * (nightAccelerationActive ? 10.0 : 1.0)); // increase solar time
          }
        }

        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate * (nightAccelerationActive ? 10.0 : 1.0));

        gl.viewport(0, 0, sim_res_x, sim_res_y);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        if (!airplaneMode || airplane.hasCrashed() || frameNum % 17 == 0) { // update every 17 frames because 60 * 0.288 secs per iteration = 17.28
          let numIterations = guiControls.IterPerFrame;
          if (airplaneMode)
            numIterations = 1;
          for (var i = 0; i < numIterations; i++) { // Simulation loop
            // calc and apply velocity
            gl.useProgram(velocityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc curl
            gl.useProgram(curlProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calculate vorticity
            gl.useProgram(vorticityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, curlTexture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // apply vorticity, boundary conditions and user input
            gl.useProgram(boundaryProgram);
            gl.uniform1f(uniformLocation_boundaryProgram_iterNum, iterNum);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);


            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply advection
            gl.useProgram(advectionProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply pressure
            gl.useProgram(pressureProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc light
            gl.useProgram(lightingProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE3);

            if (lightEven) {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);
            } else {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
            }
            lightEven = !lightEven;

            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]); // calc light
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


            gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
            gl.clearBufferfv(gl.COLOR, 0, zeroColorClearValue);
            gl.clearBufferfv(gl.COLOR, 1, zeroColorClearValue);

            if (guiControls.enablePrecipitation) { // move precipitation, HUGE PERFORMANCE BOTTLENECK!
              if (precipitationEven) {
                srcVAO = precipitationVao_0;
                destTF = precipitationTF_1;
              } else {
                srcVAO = precipitationVao_1;
                destTF = precipitationTF_0;
              }

              gl.useProgram(precipitationProgram);
              gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'iterNum'), iterNum);
              // cloud-density lightning is owned by the precipitation shader
              // (lightningCloudDensityThreshold / lightningChanceMultiplier)
              gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'legacyLightningGate'), 1.0);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.ONE, gl.ONE); // add everything together
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, lightningDataTextures[lightningDataSrc]);

              gl.bindVertexArray(srcVAO);
              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, destTF);
              gl.beginTransformFeedback(gl.POINTS);
              gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
              gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
              gl.endTransformFeedback();

              // sample to count number of inactive droplets
              if (iterNum % 600 == 0) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                var sampleValues = new Float32Array(4);
                // console.time('cnt');
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sampleValues);
                // console.timeEnd('cnt')         // 1 - 100 ms huge variation
                // console.log(sampleValues[0]);  // number of inactive droplets
                guiControls.inactiveDroplets = sampleValues[0];
                // gl.useProgram(precipitationProgram); // already set
                gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'inactiveDroplets'), sampleValues[0]);
              }

              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
              gl.disable(gl.BLEND);
              gl.bindVertexArray(fluidVao); // set screenfilling rect again
              precipitationEven = !precipitationEven;


              // Strike slot manager: a new strike takes a free slot and every
              // running strike keeps its own until its animation is over, so
              // strikes never cut each other short. Ping-pong the slot array.
              const lightningDst = 1 - lightningDataSrc;
              gl.useProgram(lightningLocationProgram);
              gl.uniform1f(gl.getUniformLocation(lightningLocationProgram, 'iterNum'), iterNum);
              uploadLightningRodUniforms(lightningLocationProgram); // rods capture CG strikes

              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, lightningDataTextures[lightningDataSrc]);

              gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuffs[lightningDst]);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              lightningDataSrc = lightningDst;

            }

            if (iterNum % 208 == 0) { // ~every 60 in game seconds:  0.00008 *3600 * 208 = 59.9
              measureWeatherStations();
            }
            if (!airplaneMode) {
              iterNum++;
            }
          }

        }

        if (airplaneMode) {
          iterNum++; // make sure iterNum increases every frame for nice lightning
          airplane.takeUserInput();
          airplane.move();
        }

        // Thunder is read back out of the GPU, and a readback waits for everything
        // queued to finish: doing it every frame is a sync on every frame, which on
        // a busy GPU is milliseconds of stall that no other optimisation can hide.
        // Every third frame is 20 Hz at 60 fps - far inside the tolerance of
        // hearing thunder - and no strike is missed, because a strike is found by
        // comparing its start iteration against the last one we heard, not against
        // the previous frame.
        const lightningSoundDue = guiControls.sound && guiControls.enablePrecipitation &&
                                  iterNum != lastLightningSoundCheckIteration &&
                                  (lightningSoundFrame++ % 3) === 0;
        if (lightningSoundDue) {
          lastLightningSoundCheckIteration = iterNum;
          gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuffs[lightningDataSrc]);
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.readPixels(0, 0, numLightningSlots, 1, gl.RGBA, gl.FLOAT, lightningDataValues);

          // thunder belongs to the newest strike in the slot array that we have
          // not heard yet (several strikes can be in flight at once now)
          let newestSlot = -1;
          let newestIteration = lastLightningSoundIteration;
          for (let slot = 0; slot < numLightningSlots; slot++) {
            const start = Math.round(lightningDataValues[slot * 4 + START_ITERNUM_INDEX]);
            if (start > newestIteration && start <= iterNum) {
              newestIteration = start;
              newestSlot = slot;
            }
          }
          if (newestSlot >= 0) {
            soundSystem.soundThunder(
              lightningDataValues[newestSlot * 4 + 0],
              lightningDataValues[newestSlot * 4 + 1],
              Math.pow(lightningDataValues[newestSlot * 4 + 3], 2.0)
            );
            lastLightningSoundIteration = newestIteration;
          }
        } else if (!guiControls.sound || !guiControls.enablePrecipitation) {
          lastLightningSoundIteration = iterNum;
          lastLightningSoundCheckIteration = iterNum;
        }

      } // end of simulation part

      if (guiControls.showGraph) {
        soundingGraph.draw(Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x))), Math.floor(mouseYinSim * sim_res_y));
      }

    } // END OF NOT SETUP MODE


    let cursorType = 1.0; // normal circular brush
    windPushControlsVisibilityUpdater();
    if (guiControls.tool == 'TOOL_WIND_PUSH') {
      cursorType = 3.0; // configurable wind push area
    } else if (guiControls.wholeWidth) {
      cursorType = 2.0;   // cursor whole width brush
    } else if (SETUP_MODE || (inputType <= 0 && !bPressed && (guiControls.tool == 'TOOL_NONE' || guiControls.tool == 'TOOL_STATION' || guiControls.tool == 'TOOL_LIGHTNING_ROD'))) {
      cursorType = 0;     // cursor off sig
    }

    gl.useProgram(postProcessingProgram);

    if (cursorType != 0 && !sunIsUp) {
      // working at night
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 2.0);
    } else {
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    }

    if (inputType == 0) {
      // clicking while tool is set to flashlight(NONE)
      // enable flashlight
      cursorType += 0.55;
    }

    // Follow droplet
    if (dropletFollowID >= 0) {
      let dropletInfo = readDropletData(dropletFollowID);
      cam.setPosition(-dropletInfo[0] * 2.0 + 1.0, -dropletInfo[1] * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x));

      let dropletInfoCanvas = document.getElementById('dropletInfoCanvas');
      let ctx = dropletInfoCanvas.getContext('2d');

      ctx.clearRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);
      ctx.fillStyle = '#00000055';
      ctx.fillRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);

      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 2, 2);

      ctx.font = '15px Arial';
      ctx.fillStyle = '#00AAFF';
      ctx.fillText('Water: ' + dropletInfo[2].toFixed(2), 0, 15);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('Ice     : ' + dropletInfo[3].toFixed(2), 0, 30);
      ctx.fillStyle = '#00FF00';
      ctx.fillText('Dens : ' + dropletInfo[4].toFixed(2), 0, 45);
    }

    if (airplaneMode) {
      airplane.display();
    }

    // render to canvas
    gl.useProgram(realisticDisplayProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
    gl.clear(gl.COLOR_BUFFER_BIT);


    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);

    if (!SETUP_MODE && guiControls.displayMode == 'DISP_CAPE' &&
        frameNum - lastCapeColumnUpdateFrame >= 30) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, capeColumnFBO.frameBuffer);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
      gl.viewport(0, 0, capeColumnFBO.width, capeColumnFBO.height);
      gl.useProgram(capeColumnProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
      gl.bindVertexArray(fluidVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      lastCapeColumnUpdateFrame = frameNum;
    }

    const currentTemporalView = [cam.curXpos, cam.curYpos, cam.curZoom];
    if (!guiControls.temporalAAEnabled || SETUP_MODE || guiControls.displayMode != 'DISP_REAL' ||
        temporalPreviousDisplayMode != guiControls.displayMode ||
        !temporalPreviousView ||
        currentTemporalView.some((value, index) => value != temporalPreviousView[index])) {
      temporalHistoryValid = false;
    }
    temporalPreviousView = currentTemporalView;
    temporalPreviousDisplayMode = guiControls.displayMode;

    if (guiControls.displayMode == 'DISP_REAL') {

      { //  Abient Light Calculation
        gl.bindVertexArray(postProcessingVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, ambientLightFBOs[0].frameBuffer);
        gl.viewport(0, 0, ambientLightFBOs[0].width, ambientLightFBOs[0].height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let prevFBO = emittedLightFBO; // the previous FBO

        gl.useProgram(bloomBlurProgram);
        gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);

        for (let blurTimes = 0; blurTimes < 2; blurTimes++) { // blur twice for smoother result

          // downsample
          for (let i = 1; i < ambientLightFBOs.length; i++) {
            let destFBO = ambientLightFBOs[i];
            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.viewport(0, 0, destFBO.width, destFBO.height);

            // bind texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }

          // upsample and add
          gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
          gl.enable(gl.BLEND);

          for (let i = ambientLightFBOs.length - 2; i >= 0; i--) {
            let destFBO = ambientLightFBOs[i];

            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.viewport(0, 0, destFBO.width, destFBO.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }
          gl.disable(gl.BLEND);
        }
        gl.bindVertexArray(fluidVao);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFBO.frameBuffer); // render to hdr framebuffer
      // gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.viewport(0, 0, hdrFBO.width, hdrFBO.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0); // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, curlTexture);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);


      // draw background
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, airplane.directionIsLeft ? A380Texture : A380_R_Texture); // A380Texture
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'iterNum'), iterNum);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'sunAngle'), (guiControls.sunAngle - 90.0) * degToRad);
      gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'extremeAtmosphere'), guiControls.volumetricCloudLighting);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdrFramebuffer

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


      // draw clouds and terrain
      gl.useProgram(realisticDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(realisticDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
      setBrushCursor(realisticDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'iterNum'), iterNum);

      // Don't display vectors when zoomed out because you would just see noise
      if (cam.curZoom / sim_res_x > 0.003) {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), displayVectorField);
      } else {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), 0.0);
      }
      gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'volumetricCloudLighting'), guiControls.volumetricCloudLighting);


      // Which bolt artwork this window uses, clamped to the ones that exist. The
      // artwork is generated a tile at a time (see startLightningTextureWorker),
      // so early on there may be fewer tiles than windows: a strike then draws the
      // newest bolt we have instead of a blank placeholder, and the next tile is
      // requested here, off the critical path of the frame.
      const wantedLightningTexNum = Math.floor(iterNum / 400) % numLightningTextures;
      if (wantedLightningTexNum >= lightningTexturesReady)
        startLightningTextureWorker();
      const lightningTexNum = Math.min(wantedLightningTexNum, Math.max(lightningTexturesReady - 1, 0));

      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, lightningTextures[lightningTexNum]);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, lightningNetworkTexture);
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, lightningDataTextures[lightningDataSrc]);

      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);

      uploadLightningRodUniforms(realisticDisplayProgram);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdr framebuffer

      gl.disable(gl.BLEND);

      // Post processing:

      gl.bindVertexArray(postProcessingVao);

      if (guiControls.bloomEnabled) {
      gl.useProgram(isolateBrightPartsProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].frameBuffer); // brightPartsFrameBuffer
      gl.viewport(0, 0, bloomFBOs[0].width, bloomFBOs[0].height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);                            // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // render bright parts to seperate texture


      // BLOOM

      let prevFBO = bloomFBOs[0]; // the previous FBO

      gl.useProgram(bloomBlurProgram);
      gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);


      // downsample
      for (let i = 1; i < bloomFBOs.length; i++) {
        let destFBO = bloomFBOs[i];
        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.viewport(0, 0, destFBO.width, destFBO.height);

        // bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      // upsample and add
      gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
      gl.enable(gl.BLEND);

      for (let i = bloomFBOs.length - 2; i >= 0; i--) {
        let destFBO = bloomFBOs[i];

        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.viewport(0, 0, destFBO.width, destFBO.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      gl.disable(gl.BLEND);
      }

      gl.useProgram(postProcessingProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[0].texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, temporalHistoryTexture);
      gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'bloomEnabled'), guiControls.bloomEnabled);
      gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'toneMappingEnabled'), guiControls.filmicToneMapping);
      gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'fxaaEnabled'), guiControls.fxaaEnabled);
      gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'temporalAAEnabled'), guiControls.temporalAAEnabled);
      gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'temporalHistoryValid'), temporalHistoryValid);
      gl.uniform2f(gl.getUniformLocation(postProcessingProgram, 'outputTexelSize'), 1.0 / canvas.width, 1.0 / canvas.height);

      if (SETUP_MODE) {
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 50.0);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.BACK ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas

      if (guiControls.temporalAAEnabled && !SETUP_MODE) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, temporalHistoryTexture);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, canvas.width, canvas.height);
        temporalHistoryValid = true;
      } else {
        temporalHistoryValid = false;
      }

      gl.bindVertexArray(fluidVao);

      if (guiControls.showDrops) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // draw drops over clouds
        // draw precipitation
        gl.useProgram(precipDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(precipDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.bindVertexArray(precipitationEven ? precipitationVao_0 : precipitationVao_1);
        gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
        gl.bindVertexArray(fluidVao); // set screenfilling rect again
        gl.disable(gl.BLEND);
      }


    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);

      if (guiControls.displayMode == 'DISP_REFLECTIVITY') {
        gl.useProgram(reflectivityDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(reflectivityDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(reflectivityDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform1f(gl.getUniformLocation(reflectivityDisplayProgram, 'Xmult'), horizontalDisplayMult);
        setBrushCursor(reflectivityDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
      } else if (guiControls.displayMode == 'DISP_CAPE') {
        gl.useProgram(capeDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(capeDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(capeDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform1f(gl.getUniformLocation(capeDisplayProgram, 'Xmult'), horizontalDisplayMult);
        setBrushCursor(capeDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, capeColumnFBO.texture);
      } else if (guiControls.displayMode == 'DISP_TEMPERATURE') {
        gl.useProgram(temperatureDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(temperatureDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(temperatureDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'Xmult'), horizontalDisplayMult);


        // Don't display vectors when zoomed out because you would just see
        // noise
        if (cam.curZoom / sim_res_x > 0.003) {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), displayVectorField);
        } else {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), 0.0);
        }

      } else if (guiControls.displayMode == 'DISP_AIRQUALITY') {
        gl.useProgram(airQualityDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(airQualityDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(airQualityDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'Xmult'), horizontalDisplayMult);

      } else if (guiControls.displayMode == 'DISP_HUMD') {
        gl.useProgram(humidityDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(humidityDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(humidityDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(humidityDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1f(gl.getUniformLocation(humidityDisplayProgram, 'Xmult'), horizontalDisplayMult);

      } else if (guiControls.displayMode == 'DISP_IRDOWNTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(IRtempDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 0);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else if (guiControls.displayMode == 'DISP_IRUPTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(IRtempDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 1);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else {
        gl.useProgram(universalDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(universalDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        setBrushCursor(universalDisplayProgram, cursorType, mouseXinSim, mouseYinSim);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'Xmult'), horizontalDisplayMult);

        switch (guiControls.displayMode) {
        case 'DISP_HORIVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_VERTVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_WATER':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), -0.06); // negative number so positive amount is blue
          break;
        case 'DISP_IRHEATING':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 50000.0);
          break;
        case 'DISP_PRECIPFEEDBACK_MASS':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.3);
          break;
        case 'DISP_PRECIPFEEDBACK_HEAT':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_VAPOR':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_RAIN':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_PRECIPFEEDBACK_SNOW':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_SOIL_MOISTURE':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.02);
          break;
        case 'DISP_CURL':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curlTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 7.0);
          break;
        }
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas
    }

    const ecosystemIterationDelta = iterNum - ecosystemLastIteration;
    ecosystemLastIteration = iterNum;
    if (ecosystemIterationDelta > 0) {
      ecosystemHoursAccumulator += ecosystemIterationDelta * timePerIteration;
      if (ecosystemHoursAccumulator >= 1) {
        const elapsedHours = ecosystemHoursAccumulator;
        ecosystemHoursAccumulator = 0;
        const sites = plantEcosystem.sites;
        const sampleCount = Math.min(120, sites.length);
        const environments = samplePlantEnvironment(sites, ecosystemSampleCursor, sampleCount);
        if (guiControls.plantGrowth) {
          plantEcosystem.update(
            elapsedHours,
            environments,
            guiControls.latitude,
            Math.max(0, Math.sin(guiControls.sunAngle * degToRad)) * guiControls.sunIntensity,
            cellHeight,
            guiControls.wrapHorizontally
          );
        } else {
          plantEcosystem.updateWind(environments);
        }
        ecosystemSampleCursor = sites.length ? (ecosystemSampleCursor + sampleCount) % sites.length : 0;
        if (guiControls.plantGrowth)
          ecosystemStatus.population = plantEcosystem.getStatus();
      }
    }

    const physicsTime = performance.now();
    if (ecosystemLastPhysicsTime > 0)
      plantEcosystem.stepWindPhysics((physicsTime - ecosystemLastPhysicsTime) / 1000);
    ecosystemLastPhysicsTime = physicsTime;

    ecosystemContext.clearRect(0, 0, ecosystemCanvas.width, ecosystemCanvas.height);
    if (guiControls.showPlants && !SETUP_MODE) {
      const cellPixels = canvas.width / sim_res_x * cam.curZoom;
      const hoveredPlant = plantEcosystem.draw(
        ecosystemContext,
        simToScreenX,
        simToScreenY,
        cellPixels,
        sim_res_x,
        guiControls.wrapHorizontally,
        ecosystemPointer.x,
        ecosystemPointer.y,
        performance.now() / 1000
      );
      if (hoveredPlant) {
        const health = Math.round(hoveredPlant.plant.health * 100);
        const damage = Math.round(hoveredPlant.plant.windDamage * 100);
        const airHumidity = Math.round(hoveredPlant.site.airMoisture * 100);
        const groundMoisture = Math.round(hoveredPlant.site.moisture * 100);
        ecosystemTooltip.textContent = hoveredPlant.plant.species.name +
          '\nHealth: ' + health + '% | Wind damage: ' + damage + '%' +
          '\nWind force: ' + hoveredPlant.plant.windForceN.toFixed(1) + ' N' +
          '\nAir humidity: ' + airHumidity + '% RH | Soil moisture: ' + groundMoisture + '%' +
          '\nTemperature: ' + hoveredPlant.site.temperature.toFixed(1) + ' °C' +
          '\nBiome: ' + hoveredPlant.site.biome.replace(/-/g, ' ');
        ecosystemTooltip.style.display = 'block';
        ecosystemTooltip.style.left = Math.min(ecosystemPointer.x + 14, window.innerWidth - 210) + 'px';
        ecosystemTooltip.style.top = Math.min(ecosystemPointer.y + 14, window.innerHeight - 76) + 'px';
      } else {
        ecosystemTooltip.style.display = 'none';
      }
    } else {
      ecosystemTooltip.style.display = 'none';
    }
    if (displayWeatherStations) {
      for (let i = 0; i < weatherStations.length; i++) {
        weatherStations[i].updateCanvas(); // update weather stations
      }
    }
    updateClockTextContrast();

    updateDiagnosticOverlays();
    frameNum++;
    requestAnimationFrame(draw);
  }

  //////////////////////////////////////////////////////// functions:

  function measureWeatherStations()
  {
    const stations = weatherStations.slice();
    if (stations.length == 0) {
      clearRainGaugeAccumulation();
      return stations;
    }

    let minStationX = sim_res_x - 1;
    let maxStationX = 0;
    let minStationY = sim_res_y - 1;
    let maxStationY = 0;
    for (const station of stations) {
      minStationX = Math.min(minStationX, station.getXpos());
      maxStationX = Math.max(maxStationX, station.getXpos());
      minStationY = Math.min(minStationY, station.getYpos());
      maxStationY = Math.max(maxStationY, station.getYpos());
    }
    const xStart = minStationX;
    const xEnd = maxStationX;
    const yStart = Math.max(0, minStationY - 1);
    const yEnd = Math.min(sim_res_y - 1, maxStationY + 1);
    const width = xEnd - xStart + 1;
    const height = yEnd - yStart + 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const stationDataLength = width * height * 4;
    if (weatherStationSamplingBuffers.base.length < stationDataLength) {
      weatherStationSamplingBuffers.base = new Float32Array(stationDataLength);
      weatherStationSamplingBuffers.water = new Float32Array(stationDataLength);
      weatherStationSamplingBuffers.light = new Float32Array(stationDataLength);
    }
    const baseData = weatherStationSamplingBuffers.base;
    gl.readPixels(xStart, yStart, width, height, gl.RGBA, gl.FLOAT, baseData);

    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const waterData = weatherStationSamplingBuffers.water;
    gl.readPixels(xStart, yStart, width, height, gl.RGBA, gl.FLOAT, waterData);

    const cloudRadius = stationCloudCoverRadiusCells;
    let cloudXStart = Math.max(0, minStationX - cloudRadius);
    let cloudXEnd = Math.min(sim_res_x - 1, maxStationX + cloudRadius);
    if (guiControls.wrapHorizontally &&
        stations.some(station => station.getXpos() - cloudRadius < 0 ||
          station.getXpos() + cloudRadius >= sim_res_x)) {
      cloudXStart = 0;
      cloudXEnd = sim_res_x - 1;
    }
    const cloudWidth = cloudXEnd - cloudXStart + 1;
    const cloudDataLength = cloudWidth * sim_res_y * 4;
    if (weatherStationSamplingBuffers.cloudWater.length < cloudDataLength) {
      weatherStationSamplingBuffers.cloudWater = new Float32Array(cloudDataLength);
      weatherStationSamplingBuffers.cloudWalls = new Int8Array(cloudDataLength);
    }
    const cloudWaterData = weatherStationSamplingBuffers.cloudWater;
    gl.readPixels(cloudXStart, 0, cloudWidth, sim_res_y, gl.RGBA, gl.FLOAT, cloudWaterData);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    const cloudWallData = weatherStationSamplingBuffers.cloudWalls;
    gl.readPixels(cloudXStart, 0, cloudWidth, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, cloudWallData);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const lightData = weatherStationSamplingBuffers.light;
    gl.readPixels(xStart, yStart, width, height, gl.RGBA, gl.FLOAT, lightData);

    const rainRadius = guiControls.wrapHorizontally
      ? Math.min(Math.ceil(2500 / cellHeight), Math.floor((sim_res_x - 1) / 2))
      : Math.max(1, Math.ceil(2500 / cellHeight));
    const rainRegions = [];
    const stationRainRegions = new Map();
    if (guiControls.enablePrecipitation) {
      for (const station of stations) {
        const stationX = station.getXpos();
        const stationY = station.getYpos();
        const wraps = guiControls.wrapHorizontally && (stationX - rainRadius < 0 || stationX + rainRadius >= sim_res_x);
        const box = {
          xStart : wraps ? 0 : Math.max(0, stationX - rainRadius),
          xEnd : wraps ? sim_res_x - 1 : Math.min(sim_res_x - 1, stationX + rainRadius),
          yStart : Math.max(0, stationY - rainRadius),
          yEnd : Math.min(sim_res_y - 1, stationY + rainRadius),
          stations : [station]
        };

        let merged = true;
        while (merged) {
          merged = false;
          for (let regionIndex = rainRegions.length - 1; regionIndex >= 0; regionIndex--) {
            const region = rainRegions[regionIndex];
            const overlaps = box.xStart <= region.xEnd && box.xEnd >= region.xStart &&
              box.yStart <= region.yEnd && box.yEnd >= region.yStart;
            if (overlaps) {
              box.xStart = Math.min(box.xStart, region.xStart);
              box.xEnd = Math.max(box.xEnd, region.xEnd);
              box.yStart = Math.min(box.yStart, region.yStart);
              box.yEnd = Math.max(box.yEnd, region.yEnd);
              box.stations.push(...region.stations);
              rainRegions.splice(regionIndex, 1);
              merged = true;
            }
          }
        }
        rainRegions.push(box);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      for (let regionIndex = 0; regionIndex < rainRegions.length; regionIndex++) {
        const region = rainRegions[regionIndex];
        const width = region.xEnd - region.xStart + 1;
        const height = region.yEnd - region.yStart + 1;
        const dataLength = width * height;
        const prefixLength = height * (width + 1);
        let buffers = weatherStationSamplingBuffers.rainRegions[regionIndex];
        if (!buffers || buffers.data.length < dataLength || buffers.prefixes.length < prefixLength) {
          buffers = {
            data : new Float32Array(dataLength),
            prefixes : new Float64Array(prefixLength)
          };
          weatherStationSamplingBuffers.rainRegions[regionIndex] = buffers;
        }

        gl.readPixels(region.xStart, region.yStart, width, height, gl.RED, gl.FLOAT, buffers.data);
        for (let y = 0; y < height; y++) {
          const rowStart = y * (width + 1);
          const dataStart = y * width;
          buffers.prefixes[rowStart] = 0;
          for (let x = 0; x < width; x++) {
            buffers.prefixes[rowStart + x + 1] = buffers.prefixes[rowStart + x] + buffers.data[dataStart + x];
          }
        }
        region.prefixes = buffers.prefixes;
        region.width = width;
        region.height = height;
        for (const station of region.stations) {
          stationRainRegions.set(station, region);
        }
      }
    }
    clearRainGaugeAccumulation();

    function pixelOffset(stationX, stationY)
    {
      const sampleY = Math.max(0, Math.min(sim_res_y - 1, stationY));
      if (sampleY < yStart || sampleY > yEnd) {
        return -1;
      }
      return ((sampleY - yStart) * width + stationX - xStart) * 4;
    }

    for (const station of stations) {
      const stationX = station.getXpos();
      const stationY = station.getYpos();
      station.measure({
        baseData,
        waterData,
        lightData,
        baseRow0Offset : pixelOffset(stationX, stationY - 1),
        baseRow1Offset : pixelOffset(stationX, stationY),
        baseRow2Offset : pixelOffset(stationX, stationY + 1)
      });
      station.calculateOverheadClouds(cloudWaterData, cloudWallData, cloudWidth, sim_res_y,
                                      stationX - cloudXStart, stationY, cellHeight);
      station.measureRain(stationRainRegions.get(station) || null);
    }

    return stations;
  }

  function clearRainGaugeAccumulation()
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
    gl.drawBuffers([gl.NONE, gl.NONE, gl.COLOR_ATTACHMENT2]);
    gl.clearBufferfv(gl.COLOR, 2, zeroColorClearValue);
  }

  function formatClockTime(date)
  {
    const locale = guiControls.twelveHourClock ? 'en-US' : 'en-GB';
    return date.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: guiControls.twelveHourClock
    });
  }

  function formatElapsedTime(milliseconds)
  {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0)
      return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0)
      return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function getNextSolarEvent()
  {
    const latitudeRad = guiControls.latitude * degToRad;
    const tiltDeg = Math.sin(guiControls.month * 0.5236 - 1.92) * 23.5;
    const tiltRad = tiltDeg * degToRad;
    const threshold = Math.sin(5.0 * degToRad);
    const denominator = Math.cos(tiltRad) * Math.cos(latitudeRad);
    const hourAngleSin = (threshold - Math.sin(tiltRad) * Math.sin(latitudeRad)) / denominator;

    if (!Number.isFinite(hourAngleSin) || hourAngleSin <= -1.0 || hourAngleSin >= 1.0)
      return { eventName: sunIsUp ? 'Sunset' : 'Sunrise', eventTime: null };

    const hourAngle = Math.asin(hourAngleSin);
    const sunriseHour = ((6.0 + hourAngle * 12.0 / Math.PI) % 24.0 + 24.0) % 24.0;
    const sunsetHour = ((18.0 - hourAngle * 12.0 / Math.PI) % 24.0 + 24.0) % 24.0;
    const upcomingEvents = [
      {eventName: 'Sunrise', eventHour: sunriseHour},
      {eventName: 'Sunset', eventHour: sunsetHour}
    ].map(({eventName, eventHour}) => {
      const eventTime = new Date(simDateTime);
      eventTime.setHours(Math.floor(eventHour), Math.floor((eventHour % 1) * 60), 0, 0);

      if (eventTime <= simDateTime)
        eventTime.setDate(eventTime.getDate() + 1);

      return {eventName, eventTime};
    });

    return upcomingEvents.reduce((nextEvent, event) =>
      event.eventTime < nextEvent.eventTime ? event : nextEvent);
  }

  function updateClockDisplay()
  {
    if (!clockEl)
      return;

    if (!guiControls.dayNightCycle) {
      clockEl.hidden = true;
      return;
    }

    clockEl.hidden = false;
    clockTimeEl.textContent = formatClockTime(simDateTime);
    clockDateEl.textContent = simDateTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    clockRunningForEl.textContent = formatElapsedTime(simElapsedMilliseconds);

    const {eventName, eventTime} = getNextSolarEvent();
    clockSolarEventEl.textContent = eventTime ? formatClockTime(eventTime) : `No ${eventName.toLowerCase()} today`;
    clockSolarCountdownEl.textContent = eventTime ? `in ${formatElapsedTime(eventTime - simDateTime)}` : '';
    clockSolarIconEl.querySelector('[data-solar-icon="sunrise"]').hidden = eventName != 'Sunrise';
    clockSolarIconEl.querySelector('[data-solar-icon="sunset"]').hidden = eventName != 'Sunset';
  }

  function updateClockTextContrast()
  {
    const contrastSampleTime = performance.now();
    if (!clockEl || clockEl.hidden || contrastSampleTime - lastClockContrastSampleTime < 1000)
      return;

    const bounds = clockEl.getBoundingClientRect();
    const textColor = getSceneContrastTextColor(bounds.left + bounds.width * 0.5, bounds.top + bounds.height * 0.5);
    clockEl.dataset.contrast = textColor == '#ffffff' ? 'light' : 'dark';
    clockEl.style.setProperty('--clock-text-color', textColor);
    lastClockContrastSampleTime = contrastSampleTime;
  }

  function onUpdateTimeOfDaySlider()
  {
    let minutes = (guiControls.timeOfDay % 1) * 60;
    simDateTime.setHours(guiControls.timeOfDay, minutes);
    updateSunlight();
  }

  function onUpdateMonthSlider()
  {
    let month = guiControls.month - 0.96;
    let date = (month % 1) * 30;
    simDateTime.setMonth(month, date);
    updateSunlight();
  }

  function updateSunlight(deltaT_hours)
  {
    if (deltaT_hours != 'MANUAL_ANGLE') {
      if (deltaT_hours != null) {                                                   // increment time
        simDateTime = new Date(simDateTime.getTime() + deltaT_hours * 3600 * 1000); // convert hours to ms and add to current date
        simElapsedMilliseconds += deltaT_hours * 3600000;
        guiControls.timeOfDay = simDateTime.getHours() + simDateTime.getMinutes() / 60. + simDateTime.getSeconds() / 3600.;
        guiControls.month = simDateTime.getMonth() + 1 + simDateTime.getDate() / 30.5 + simDateTime.getHours() / 720.;
      } else {
        for (let i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      }

      let timeOfDayRad = (guiControls.timeOfDay / 24.0) * 2.0 * Math.PI; // convert to radians

      timeOfDayRad -= Math.PI / 2.0;

      let tiltDeg = Math.sin(guiControls.month * 0.5236 - 1.92) * 23.5; // axis tilt
      let t = tiltDeg * degToRad;                                       // axis tilt in radians
      let l = guiControls.latitude * degToRad;                          // latitude

      guiControls.sunAngle = Math.asin(Math.sin(t) * Math.sin(l) + Math.cos(t) * Math.cos(l) * Math.sin(timeOfDayRad)) * radToDeg;

      if (guiControls.latitude - tiltDeg < 0.0) {
        // If sun is to the north, flip angle
        guiControls.sunAngle = 180.0 - guiControls.sunAngle;
      }
    }
    let solarZenithAngleDeg = (guiControls.sunAngle - 90);
    let solarZenithAngle = solarZenithAngleDeg * degToRad; // Solar zenith angle centered around 0. (0 = vertical)
    // Calculations visualized: https://www.desmos.com/calculator/kzr76zj5hq
    if (Math.abs(solarZenithAngle) < 85.0 * degToRad) {
      sunIsUp = true;
    } else {
      sunIsUp = false;
    }
    //		console.log(solarZenithAngle, sunIsUp);
    //	let sunIntensity = guiControls.sunIntensity *
    // Math.pow(Math.max(Math.sin((90.0 - Math.abs(guiControls.sunAngle)) *
    // degToRad) - 0.1, 0.0) * 1.111, 0.4);
    let sunIntensity = guiControls.sunIntensity * Math.pow(Math.max(Math.sin((180.0 - guiControls.sunAngle) * degToRad), 0.0), 0.1) * 1300.0; // max 1300 w/m2 at 12 km
    // console.log('sunIntensity: ', sunIntensity);

    // minShadowLight = clamp(((90 + 10) - Math.abs(solarZenithAngleDeg)) * 0.006, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    minShadowLight = map_range_C(Math.abs(solarZenithAngleDeg), 100.0, 85.0, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    gl.useProgram(boundaryProgram);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'sunAngle'), solarZenithAngle);
    gl.useProgram(lightingProgram);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunIntensity'), sunIntensity);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunAngle'), solarZenithAngle);
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'sunAngle'), solarZenithAngle);
    gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
    gl.useProgram(skyBackgroundDisplayProgram);
    gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);

    updateClockDisplay();
  }


  async function createSaveFileBlob()
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    let baseTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
    gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, baseTextureValues);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    let waterTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
    gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    let wallTextureValues = new Int8Array(4 * sim_res_x * sim_res_y);
    gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

    let precipBufferValues = new ArrayBuffer(rainDrops.length * Float32Array.BYTES_PER_ELEMENT);
    gl.bindBuffer(gl.ARRAY_BUFFER, precipitationEven ? precipVertexBuffer_0 : precipVertexBuffer_1);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(precipBufferValues));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    let weatherStationsPositions = new Int16Array(weatherStations.length * 2);
    for (let i = 0; i < weatherStations.length; i++) {
      weatherStationsPositions[i * 2] = weatherStations[i].getXpos();
      weatherStationsPositions[i * 2 + 1] = weatherStations[i].getYpos();
    }

    let strGuiControls = JSON.stringify(guiControls);
    let saveDataArray = [
      Uint16Array.of(sim_res_x), Uint16Array.of(sim_res_y), baseTextureValues, waterTextureValues, wallTextureValues,
      precipBufferValues, Uint16Array.of(weatherStations.length), weatherStationsPositions, strGuiControls
    ];
    let blob = new Blob(saveDataArray);
    let arr = new Uint8Array(await blob.arrayBuffer());
    let compressed = window.pako.deflate(arr);
    return new Blob([ Uint32Array.of(saveFileVersionID), compressed ], {type : 'application/x-binary'});
  }

  async function prepareDownload()
  {
    let newFileName = prompt('Please enter a file name. Can not include \'.\'', saveFileName);
    if (newFileName == null)
      return;
    if (newFileName == '' || newFileName.includes('.')) {
      alert('You didn\'t enter a valid file name!');
      return;
    }

    saveFileName = newFileName;
    let saveBlob = await createSaveFileBlob();
    download(saveFileName + '.weathersandbox', saveBlob);
    lastSaveTime = new Date();
  }

  function createProgram(vertexShader, fragmentShader, transform_feedback_varyings)
  {
    var program = gl.createProgram();
    if (!program)
      throw new Error('Unable to allocate a WebGL program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    if (transform_feedback_varyings != null)
      gl.transformFeedbackVaryings(program, transform_feedback_varyings, gl.INTERLEAVED_ATTRIBS);

    gl.linkProgram(program);
    gl.validateProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return program; // linked succesfully
    } else {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('ERROR: ' + error);
    }
  }

  async function loadSourceFile(fileName)
  {
    let response;
    try {
      response = await fetch(fileName);
    } catch (error) {
      await loadingBar.showError('ERROR loading shader files! If you just opened index.html, try again using a local server!');
      throw error;
    }

    if (response.status === 404)
      throw new Error('File not found: ' + fileName);
    if (!response.ok)
      throw new Error('File loading error ' + response.status + ': ' + fileName);
    return response.text();
  }

  async function loadShader(nameIn)
  {
    const re = /(?:\.([^.]+))?$/;

    let extension = re.exec(nameIn)[1]; // extract file extension

    let shaderType;
    let type;

    if (extension == 'vert') {
      type = 'vertex';
      shaderType = gl.VERTEX_SHADER;
    } else if (extension == 'frag') {
      type = 'fragment';
      shaderType = gl.FRAGMENT_SHADER;
    } else {
      throw 'Invalid shadertype: ' + extension;
    }

    let filename = 'shaders/' + type + '/' + nameIn;

    // version tag: browsers otherwise happily serve a stale .vert/.frag from
    // cache after the sources change (e.g. the cloud-density lightning tuning)
    var shaderSource = await loadSourceFile(filename + '?v=2026-12-06.12');
    if (shaderSource.includes('#include "common.glsl"')) {
      shaderSource = shaderSource.replace('#include "common.glsl"', commonSource);
    }

    if (shaderSource.includes('#include "commonDisplay.glsl"')) {
      shaderSource = shaderSource.replace('#include "commonDisplay.glsl"', commonDisplaySource);
    }

    const shader = gl.createShader(shaderType);
    if (!shader)
      throw new Error('Unable to allocate shader: ' + filename);
    gl.shaderSource(shader, shaderSource);
    // console.time('compileShader');
    gl.compileShader(shader);
    // console.timeEnd('compileShader')

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = new Error(filename + ' COMPILATION ' + gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      throw error;
    }
    loadedShaderCount++;
    const shaderProgress = 10 + loadedShaderCount / totalShaderCount * 40;
    await loadingBar.set(shaderProgress, 'Compiling shader: ' + nameIn);
    return shader;
  }

  function adjIterPerFrame(adj) { guiControls.IterPerFrame = Math.round(clamp(guiControls.IterPerFrame + adj, 1, 50)); }

  function isPageHidden() { return document.hidden || document.msHidden || document.webkitHidden || document.mozHidden; }

  function calcFps()
  {
    if (isPageHidden()) {
      lastFrameNum = frameNum;
      lastPerformanceIterationNum = iterNum;
      return;
    }

    if (!isPageHidden()) {
      FPS = frameNum - lastFrameNum;
      lastFrameNum = frameNum;
      measuredSimulationStepsPerSecond = iterNum - lastPerformanceIterationNum;
      lastPerformanceIterationNum = iterNum;
      updateCurrentPerformanceDisplay();
      if (clockFpsEl) {
        clockFpsEl.textContent = Math.round(FPS);
        clockFpsEl.classList.toggle('simulation-clock-fps-good', FPS >= 50);
        clockFpsEl.classList.toggle('simulation-clock-fps-warn', FPS >= 30 && FPS < 50);
        clockFpsEl.classList.toggle('simulation-clock-fps-poor', FPS < 30);
      }

      if (!guiControls.paused) {
        console.log(FPS + ' FPS   ' + guiControls.IterPerFrame + ' Iterations / frame      ' + FPS * guiControls.IterPerFrame + ' Iterations / second');

        if (guiControls.auto_IterPerFrame && !airplaneMode) {
          if (guiControls.autoFpsTarget != 'Unlocked') {
            const fpsTarget = Number(guiControls.autoFpsTarget);
            adjIterPerFrame((FPS / fpsTarget - 1.0) * 5.0); // example: ((30 / 60)-1.0) = -0.5

            if (FPS == fpsTarget)
              adjIterPerFrame(1);
          }
        }
      }
      // calculate total amounts of water and smoke for verification of fluid simulation
      /*
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
            var waterTextureValues = new Float32Array(sim_res_x * sim_res_y * 4);
            gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);

            let totalWaterVapor = 0.0;
            let totalCloudWater = 0.0;
            let totalSmoke = 0.0;

            for (let x = 0; x < sim_res_x; x++) {
              for (let y = 0; y < sim_res_y; y++) {
                let cellInd = (x + y * sim_res_x) * 4;
                let vapor = waterTextureValues[cellInd + 0];
                if (vapor < 1000.0) { // ignore wall
                  totalCloudWater += waterTextureValues[cellInd + 1];
                  totalWaterVapor += vapor;

                  totalSmoke += waterTextureValues[cellInd + 3];
                }
              }
            }

            let totalWater = totalWaterVapor + totalCloudWater;
            console.log('Water  Vapor  Cloud  Smoke\n', Math.round(totalWater), Math.round(totalWaterVapor), Math.round(totalCloudWater), Math.round(totalSmoke));
            */
    }
  }
} // end of mainscript