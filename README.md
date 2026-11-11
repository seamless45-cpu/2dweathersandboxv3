# 2D Weather Sandbox

Previously called "Weather_Sim_4"

This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.

The simulation requires a browser with WebGL2 and `EXT_color_buffer_float`; open it through a local web server rather than `file://`. Firefox performance depends on hardware acceleration being available. In Firefox, check the Graphics section of `about:support` if rendering is unexpectedly slow or WebGL is unavailable.

Audio assets use MP3 for broad Web Audio decoding support and load on demand, so unused sounds do not delay startup. Ambient sound-field samples use asynchronous GPU readback and update at most ten times per second.

The fluid solver bounds sounding-profile lookups at the bottom of the grid and sanitizes non-finite or runaway state values between update passes. These safeguards are intended to prevent a single unstable cell from corrupting the wider simulation; they only intervene outside broad physical ranges and do not replace the model's simplified physics.

The realistic display renders its HDR scene at 75% of the window dimensions and bloom at 50%, reducing their respective pixel workloads by about 44% and 75%. Thunder detection reads its GPU result once per rendered frame instead of synchronously after every simulation step. Startup fetches shader and image files concurrently; lightning artwork is generated in the background by at most two workers, at half the former dimensions, and transferred as image bitmaps instead of copied pixel arrays. Its aspect ratio and relative line width are preserved. Every strike owns its own lightning slot for the length of its animation, so a newer strike can never cut a running one short; slots are only reused once a flash has finished. The weather simulation grid, timestep, precipitation, and measurements remain unchanged; the upscaled image may look slightly softer.


Lightning brightness is bounded by arithmetic, not by a clamp. The scene lives in a 16-bit float buffer (largest finite value 65504) and a cloud-to-ground return stroke is written at a hundred thousand units and up, so the fragment is written through `softHdrClamp()`: the identity below a few hundred units, monotonic, and asymptotic to `HDR_CEILING`, with an infinity mapped to the ceiling and a NaN to zero. Compressing the top of the range rather than cutting it off is what keeps a bolt *brighter than white* - the tonemap flattens everything over ~3 to the same white, so a stroke's surplus energy can only arrive on screen as the halo it scatters, and the bloom's bright pass (`isolateBrightPartsShader.frag`, knee 32, gain 0.45, its own bounded ceiling) is built from that buffer. Above the knee there is nothing in a normal frame except lightning, so a bolt's halo can grow into a blaze while the clouds, sky and airplane lights keep exactly the glow they had. The tonemap itself reads both buffers through a NaN and infinity guard, so no single sample can become a dead pixel that FXAA and temporal AA then smear across the frame.

A cloud-to-ground stroke lights the frame, not just its own halo. The bolt and the glow around it were never enough on their own - a discharge that draws a bright line and leaves the rest of the picture alone reads as a spark rather than as lightning - so the stroke's own intensity curve now drives a frame-wide term. The scene pass adds it to `onLight`, which multiplies the scene's own colour, so the cloudscape jumps several stops with its structure intact; the additive intra-cloud pass carries the same flash into the sky above the cloud deck, which the scene pass never touches. Both take the strongest running stroke (`max`, not a sum) and both are bounded (`icScreenFlashCeiling` 4.2 HDR, `lightningScreenFlashBrightness` 0.02 per unit of curve). Measured on a cloud pixel: a storm-core stroke (intensity 2.5) takes it from 156/255 to 254/255 at night, and the *dark* scene around it - unlit ground at a tenth of that light - goes from 218/255 to 251/255, which is where a flash reads as brightness rather than as a white bolt on an unchanged picture. The weakest cloud-to-ground stroke still lifts the same pixel to 236/255.

A cloud-to-ground channel is crooked now, not just noisy. It used to be one heading, kicked by up to 40 degrees a pixel and pulled back toward vertical by 8% every step - and the pull is what decided the shape: every kick decayed in a dozen pixels and the next one cancelled it, so the bolt came out as a vertical wire with a buzz on it, 17 direction changes along its length but no bend. The heading is now two scales, the same pair `icStepHeading()` uses for a filament: a slow *aim* that wanders and relaxes over ~800 artwork pixels, which is what gives the channel its arcs, and a fast *jag* pulled back hard, which is the electrical zigzag on top. Measured over forty seeded bolts, the channel turns 5 times instead of 17 and sweeps 20-30% of the sprite's width instead of buzzing around a fixed line. The aim is also what steers the channel back inside the sprite when it nears the edge - a fork is still free to run off the tile, but a trunk that did left half a bolt on screen, because the display shader drops those fragments.

There is no leader stage. A stepped leader is real, but drawing it as a lit stage meant a strike spent its first iterations with the bolt held at one fixed brightness - the flicker curve is still near zero while a leader would be crawling - so the glow on screen was static: a frozen bright shape before the flash it was announcing. A return stroke is tens of microseconds of light, so the whole channel is now there in the iteration the strike is booked, and the curve (sampled one unit in, for both kinds of strike) is what the player sees from the first frame on. `strikeAnimEnd()` follows: a slot is released at `start + 5 * (period * flickers + 2.924)`.

A cloud-to-ground channel fades out now instead of blinking out. The channel is the one thing in the scene written four decades over the white point - 100000 HDR units against a tonemap that is white from 6.3 up - so feeding it the intensity curve straight (`curve * mainBoltBrightness`) made it pure white for every iteration of the strike and then gone in the iteration the curve reached zero: its last lit iteration still carried 355 units, and the one after it carried nothing. On screen the halo faded and the channel vanished. The share of the strike's own peak light is now raised to `cgChannelFalloff` (1.6) before it is multiplied by `mainBoltBrightness` - the same compression `softHdrClamp` applies at the top of the scene's range, applied to the bottom of the channel's - which pulls the tail of the curve down into the band the display can show. A stroke now spends eight iterations (about 130 ms at 60 iterations/s) coming down from white, and its last lit iteration is worth 29/255: it arrives at black before it goes. Every flicker peak is still exactly 1.0, i.e. the full 100000, so a stroke is as over-bright as it ever was; only the way it lets go has changed. The envelope is taken as a share of the peak (`lightningCurvePeak`, the curve at T = 0), so a weak stroke and a storm core fade over the same part of their lives.

A stroke is brighter than it was, on every surface it touches. The bolt's core has always been clipped white, so what "brighter" can mean here is the light *around* it: the bright pass now hands the bloom pyramid 5400 HDR units per texel instead of 4000 (the most it may carry - twelve levels of the pyramid add up, and a 16F texel ends at 65504), the two lobes the stroke throws on its own clouds went up by half again (`lightningOnLightBrightness` 0.0075, `lightningSkyLightBrightness` 0.0042), the frame-wide flash roughly doubled on both the scene pass and the additive one, and `mainBoltBrightness` doubled to 200000 so the surplus of a strong stroke still orders itself above a weak one. At a storm core: the light on the clouds 0.15 sim-heights from the channel is 30 HDR units instead of 16, and the frame-wide additive light is 2.9 instead of 1.3.

Intra-cloud channels are drawn the way a discharge is, not the way a line is: every stroke fades toward its tip (`IC_TIP_TONE`), each is drawn a second time as a narrower, hotter centreline inside its sheath, and every fork is a hot junction. Every tier is thinner than a hair strand now: 1.3 artwork pixels for a trunk, 1.0 for an arm, 0.75 for a hair and 0.6 for a wisp, and one artwork pixel is about 0.4 screen pixels at the default camera, so the whole network is sub-pixel on screen. What makes a trunk the trunk is no longer its width - it is its tone (1.0/0.70/0.44/0.28 across trunk, arm, hair and wisp) and its hot centreline, which is what survives the mip chain when the sprite is minified. The tones went up when the widths came down, because a sub-pixel line loses ink to coverage: the flash as a whole carries about the same light, in thinner strokes.

An intra-cloud flash also carries a glare now. Everything it writes is squeezed under 1.0 by its soft knee, which is what keeps its channels apart - but the bloom's bright pass only sees light above 32, so a channel could never glow the way a bolt does. The two rings that hug a channel (a screen-pixel flare and the light it scatters a few pixels out) are lifted past that knee against their own ceiling (`icFlareBoost` / `icFlareCeiling`), which puts them in the bright pass; the wide ring, the cloud glow and the tiers of the network stay under the knee, so the glow hangs on the channels instead of flooding the sprite. Measured at the default camera: glare peak 50 HDR units with 0.8 % of the frame above the bloom knee.

A **lightning rod** is drawn as an air terminal rather than a stick: a pedestal where it is grounded, a mast that tapers to a point, a cylindrical highlight down its length and a corona at the tip that is visible at night. When a mast takes a strike the current is drawn down it, brightest at the point the bolt entered, so a capture is something to watch. The threshold between an intra-cloud flash and a cloud-to-ground stroke (`LIGHTNING_IC_MAX_INTENSITY`) is 0.9: strikes a tenth of an intensity unit below the old line now reach the ground.

The dat.GUI **Performance** folder, below **Exclusive Features**, contains Extreme, Quality, Balanced, and Performance presets for HDR and bloom rendering scale. Extreme uses full-resolution HDR and bloom, plus cloud self-shadowing with cool cloud shadows and sun-warmed edges and a richer time-of-day sky gradient. Filmic ACES tone mapping, FXAA anti-aliasing, and temporal anti-aliasing are **off by default** (temporal smoothing, when enabled, is clipped to current-frame neighbors and reset when the camera or display mode changes rather than motion-reprojected); each can be switched on individually. These post effects increase GPU load, especially at high window resolutions. Individual effect controls are also available. The folder additionally includes controls for plant, precipitation-particle, and weather-station overlays, simulation iterations per frame, and an Auto FPS Target that defaults to 120 FPS, with targets up to 240 FPS and an Unlocked option. Unlocked leaves the iteration count unchanged and lets `requestAnimationFrame` run at the maximum rate supported by the browser and display. Numeric targets adjust simulation iterations, which affects simulation-time throughput and may change how quickly simulated time advances. A 120 FPS target does not guarantee 120 rendered FPS: actual rate is limited by the display refresh, browser, and rendering workload. Lower display scales only soften the rendered image; hiding overlays or bloom only affects presentation, while station measurements, precipitation, and plant growth continue. Hover performance controls for descriptions and color-coded impact levels; actual FPS gains depend on the workload and hardware bottleneck. The **Current Performance** section reports frame rate, frame time, simulation steps per second, render quality, and a face-icon score based on measured FPS.

The **Display** menu includes estimated reflectivity and surface-parcel CAPE views. Reflectivity is a radar-style visualization derived from cloud and precipitation fields, not calibrated dBZ or a radar product. CAPE is an approximate model-derived surface-parcel diagnostic; its column calculation refreshes periodically while the view is active, and hovering shows the latest CAPE, surface temperature/dew point, and LCL estimate for that column. Neither view replaces an operational weather analysis.

The **Wind Push** tool can push air left or right and optionally set the pushed band's air temperature and relative humidity, allowing users to create contrasting air masses and experiment with front-like boundaries. Temperature and humidity overrides are off by default; band width and height use the whole-width and brush-size controls.


## Clouds and precipitation
Simulating clouds and precipitation are the main objectives of this project.
All the equations relating to water phase change are simplified versions of the real ones, to improve performance and ease programming.
Precipitation is simulated using discrete particles but can be viualized as both partiles and smooth realistic looking curtains.

Weather stations estimate cloud cover from a batched sample of the liquid cloud-water column above each station, using a 21-cell-wide viewing cone (10 cells to either side). Cloud fraction uses the same optical-density relationship as the renderer, and solid terrain/building cells are excluded from the sky scan. Station cards have separate Weather and Rain pages; scroll up or down over a station to switch between them. Their cards stay a fixed screen size while zooming, but remain anchored to their simulation locations. The current temperature and rain rate are shown prominently without labels in adaptive high-contrast text. The station icon and regular weather readings are on the Weather page, while precipitation totals, duration, peak rate, and sky conditions are on the Rain page. A hover hint indicates the scroll interaction, and page transitions fade text at the card edges. Station labels and the simulation clock sample the scene periodically and switch between light and dark text for contrast. The icon assets and license notice are in `resources/icons/weather`. Rain totals use liquid precipitation deposited at the surface within the station's existing 2.5 km sampling radius. A GPU-side accumulator retains deposition between station samples; the 0.2 mm tipping bucket reports rate over a simulation-time-based rolling window. Rain duration tracks intervals with at least 0.01 mm of deposited rain, while the rain icon requires a bucket tip. Totals retain sampled deposition. Deposition mass is model-calibrated rather than expressed in kilograms, so millimeter conversion uses the same calibration as soil-water accumulation.

## Sharing weather-station data on a LAN
The **Exclusive Features** menu includes **Share Weather Data to LAN**. To use it, run `python lan_weather_server.py` from this project folder on the computer running the simulation, then open the app on that computer (either `http://127.0.0.1:8000/` from this helper or a local development server such as `http://127.0.0.1:5500/`) and enable sharing. The helper's publishing API is always at `http://127.0.0.1:8000`; the server prints the LAN URL for the JSON endpoint:

```text
http://<server-LAN-IP>:8000/api/weather-stations
```

Other devices on the same private network can fetch that URL with an ordinary browser `fetch()`; the endpoint allows cross-origin GET requests and requires no token. It is read-only, returns HTTP 503 when sharing is off or its update is older than 10 seconds, and returns JSON with this shape:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-06T00:16:16.952Z",
  "simulationTime": "2000-06-28T21:39:49.536Z",
  "simulation": {
    "resolutionX": 7000,
    "resolutionY": 390,
    "cellSizeMeters": 38.46,
    "worldWidthMeters": 269230.77,
    "worldHeightMeters": 12000,
    "wrapsHorizontally": true
  },
  "units": {
    "temperature": "degrees Celsius",
    "windSpeed": "meters per second",
    "precipitation": "millimeters",
    "altitude": "meters",
    "soilMoisture": "millimeters",
    "snowDepth": "centimeters",
    "cloudCover": "percent and oktas",
    "solarAndInfraredPower": "watts per square meter"
  },
  "stations": [
    {
      "id": 29,
      "position": {
        "xCell": 3894,
        "yCell": 132,
        "xMeters": 149769.23,
        "altitudeMeters": 5076.92
      },
      "observedAt": "2000-06-28T21:39:30.048Z",
      "surfaceType": "land",
      "airTemperatureC": -12.15,
      "nearSurfaceAirTemperatureC": -12.15,
      "dewPointC": -15.0,
      "relativeHumidityPercent": 80.5,
      "windSpeedMetersPerSecond": 4.2,
      "groundTemperatureC": null,
      "waterTemperatureC": null,
      "soilMoistureMm": 12.3,
      "snowDepthCm": 0.0,
      "snowDepthChangeThisSampleCm": 0.0,
      "snowDepthChangeLastHourCm": 0.0,
      "rainRateMmPerHour": 0.0,
      "rainSinceLastSampleMm": 0.0,
      "rainTipsSinceLastSample": 0,
      "rainBucketWaterMm": 0.03,
      "rainTotalLastHourMm": 0.0,
      "rainTotalLast24HoursMm": 0.0,
      "peakRainRateLastHourMmPerHour": 0.0,
      "rainDurationMinutes": 0.0,
      "airQualityIndex": 0.5,
      "cloudCoverPercent": 35.0,
      "cloudCoverOktas": 3,
      "cloudCeilingMeters": 1200.0,
      "skyCondition": "SCT",
      "weatherIcon": "cloud-sun",
      "solarPowerWattsPerSquareMeter": 200.0,
      "netInfraredPowerWattsPerSquareMeter": -40.0
    }
  ]
}
```

The sample values above illustrate field types and are not live readings. All fields are present in each station object. `schemaVersion` identifies the response schema. `generatedAt` is the UTC time the response was built; `simulationTime` is the simulation's UTC clock. `simulation` describes the grid: `resolutionX`/`resolutionY` are cell counts, `cellSizeMeters` is the cell width/height, `worldWidthMeters` and `worldHeightMeters` are dimensions, and `wrapsHorizontally` reports whether the simulation wraps at its sides. `units` states the units used by measurements.

Station field reference:

| Field | Meaning |
|---|---|
| `id` | Stable numeric identifier for this station during the current page session. |
| `position.xCell`, `position.yCell` | Station grid coordinates. |
| `position.xMeters`, `position.altitudeMeters` | Horizontal position and altitude derived from the grid and cell size. |
| `observedAt` | UTC timestamp of the station's most recent measurement. |
| `surfaceType` | `land`, `water`, or `air`, based on the sampled cell below the station. |
| `airTemperatureC` | Air temperature at the station's grid cell, in °C. |
| `nearSurfaceAirTemperatureC` | Same measured air temperature, provided with an explicit near-surface name; not a separate ground measurement. |
| `dewPointC` | Dew point in °C. |
| `relativeHumidityPercent` | Relative humidity in percent. It can exceed 100% when supersaturated unless the simulation's real-dew-point option caps it. |
| `windSpeedMetersPerSecond` | Wind-speed magnitude in m/s. |
| `groundTemperatureC` | Always `null`; the simulation does not provide a separate ground-temperature measurement. |
| `waterTemperatureC` | Water-surface temperature in °C for water stations; otherwise `null`. |
| `soilMoistureMm` | Soil moisture for land stations; otherwise `null`. |
| `snowDepthCm` | Snow depth for land stations; otherwise `null`. |
| `snowDepthChangeThisSampleCm` | Snow-depth change since the preceding station measurement. |
| `snowDepthChangeLastHourCm` | Accumulated sampled snow-depth change over approximately the previous simulation hour. |
| `rainRateMmPerHour` | Tipping-bucket-derived rain rate in mm/h, averaged over a 10-minute simulation-time window. |
| `rainSinceLastSampleMm` | Precipitation deposited in the station's sampling area since its previous measurement. |
| `rainTipsSinceLastSample` | Number of 0.2 mm bucket tips since the preceding station measurement. |
| `rainBucketWaterMm` | Remaining water in the bucket toward its next tip, in mm. |
| `rainTotalLastHourMm` | Sampled precipitation total over the previous simulation hour, in mm. |
| `rainTotalLast24HoursMm` | Sampled precipitation total over the previous simulation day, in mm. |
| `peakRainRateLastHourMmPerHour` | Highest sampled interval rain rate during the previous simulation hour, in mm/h. |
| `rainDurationMinutes` | Continuous measurable-rain duration in simulation minutes. |
| `airQualityIndex` | Model-derived smoke concentration scaled to an AQI-like value; not an official air-quality index. |
| `cloudCoverPercent` | Estimated cloud cover in percent over the station's overhead sampling area. |
| `cloudCoverOktas` | Cloud cover rounded to eighths, from 0 to 8. |
| `cloudCeilingMeters` | Estimated lowest overhead cloud base in meters; `null` if none is detected. |
| `skyCondition` | Cloud-cover category: `CLR`, `FEW`, `SCT`, `BKN`, or `OVC`. |
| `weatherIcon` | Icon key: `sun`, `moon`, `cloud`, `cloud-sun`, `cloud-rain`, or `cloud-snow`. |
| `solarPowerWattsPerSquareMeter` | Direct solar power at the station, in W/m². |
| `netInfraredPowerWattsPerSquareMeter` | Downward minus upward infrared power, in W/m²; negative values mean net upward infrared power. |

Measurement values are JSON numbers, not display-formatted strings; unavailable measurements use `null`. Temperatures are Celsius, wind is meters per second, and precipitation is millimeters regardless of the simulation UI's selected display units. Humidity is a percentage and can exceed 100% in supersaturated air. Station IDs are stable only for the current page session and are not persisted across reloads. Sharing is opt-in and is reset to off when a save is loaded. The helper accepts publishing only from the sandbox opened at localhost, limits network clients to private/loopback/link-local addresses, and serves the sandbox on port 8000; your firewall may still need to allow Python on the private network. Stop the helper with Ctrl+C to close the endpoint.

Example client code:

```js
const response = await fetch('http://<server-LAN-IP>:8000/api/weather-stations');
if (!response.ok)
  throw new Error(`Weather data unavailable: HTTP ${response.status}`);
const weather = await response.json();
console.log(weather.simulationTime, weather.stations[0]?.airTemperatureC);
```

## Plant ecosystem
Land surfaces support a lightweight plant community that responds to local near-surface temperature, wind, atmospheric relative humidity, soil moisture, snow cover, latitude, and elevation. Air humidity and soil moisture both affect biome classification, species establishment, reproduction, and drought stress. Hovering over a plant shows its health, wind damage and force, local air humidity, soil moisture, and temperature. The desert catalog includes specialized ultra-arid species such as welwitschia and resurrection plants. Plants are rooted at the terrain surface, flex under a damped wind-force model, and accumulate stress and structural damage when winds exceed species resistance; grasses, flowers, mosses, and shrubs can form visible clumps. Plants in dry biomes use muted, drought-adapted colors. Suitable bare ground can germinate from a dormant seed bank even without nearby parent plants. Plants grow when conditions are suitable, reproduce into nearby open ground, become stressed when conditions deteriorate, and eventually die if they cannot recover. The Ecosystem controls can pause plant growth or hide the plant layer.

Ecosystem controls are grouped in the dat.GUI **Exclusive Features** folder. The page title fades out when the simulation starts.

The plant community includes at least ten species in each of the ten supported biomes. Every plant is drawn procedurally in code; no plant image files are loaded. This is a qualitative ecosystem model for the 2D weather sandbox, not a detailed ecological or vegetation simulation.

Forming Cell:
![Screenshot (7)](https://user-images.githubusercontent.com/42830240/232745061-25c860c3-8c52-4704-86af-bcba13f74cd6.png)

Mature Cell 1:
![Screenshot (23)](https://user-images.githubusercontent.com/42830240/232744315-5207396b-57e4-4aaa-968a-e85cd9283f3d.png)
Mature Cell 1 with Precipitation Particles:
![Screenshot (26)](https://user-images.githubusercontent.com/42830240/232744406-ba1c7230-a8b2-492a-85bb-c1c57c1c8a81.png)


Mature Cell 2:
![Screenshot (10)](https://user-images.githubusercontent.com/42830240/232746561-341b867e-9fcd-4d34-b200-61c403695d5a.png)


Mature Cell 3 zoomed out:
![Screenshot (17)](https://user-images.githubusercontent.com/42830240/232746022-dcb4755a-219c-474e-8ae6-8a6ebfadbd0e.png)


Sunlight with realistic colors makes clouds and precipitation look real
![Screenshot (31)](https://user-images.githubusercontent.com/42830240/232749322-d4602f66-015e-4405-9da7-2e4969473c55.png)
![Screenshot (32)](https://user-images.githubusercontent.com/42830240/232749511-1e5c2010-e65a-44eb-bbfe-f9e9b87f5c10.png)



![Bui5](https://user-images.githubusercontent.com/42830240/160260713-32ffee8a-18a2-45bc-98be-b4396793b466.PNG)


## Limitations
Due to the two-dimensional nature of the simulation, it cannot simulate 3D vortices such as tornadoes, dust devils or hurricanes. It can only simulate linear storm systems.


# Example: low intensity cell analysis
Warm moist air is rising into the cloud on the right condensing water and releasing heat until it eventually rises well above the freezing level and forming ice (snow), realeasing even more heat. The snow grows until it descents down under the freezing level and melts into rain, absorbing heat and creating a downdraft. Below the cloud level some of the rain evaporates, absorbing even more heat and strengtening the downward motion. Near the surface the air spreads out sideways and in this case mostly to the right, creating a small low level cold front. This cold front pushes even more warm air up.
![Schermopname (92)_LI](https://user-images.githubusercontent.com/42830240/173361271-23383858-f0d3-485d-91b9-21e0d3c75211.jpg)
The dew points and cape are very low in this example, but it's just enough to form a nice stable cell.
![Naamloos](https://user-images.githubusercontent.com/42830240/173365013-cdea3b40-f470-4390-a8fa-b8d93025d893.png)

# The Code
The simulation is based on a simple fluid simulation topology.
All code was written by me (Niels Daemen) except for the libraries included

## Fluid Model
The fluid model consists of a 2 dimensional grid of cells. 
Each cell has the following properties:

<img width="1095" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/f08e08e9-4d96-4d80-b890-1f213085668f">


These properties are not simply defined at the center of each cell, but using a so called staggered grid. the velocities are defined exactly on the border between cells. They are therefore exactly in between the centers of the cells, which is where the pressures are defined. In this way the velocities define the exact flow rate from one cell to its neighbor. This makes calculating new velocities and pressures very simple.

![image](https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/107d58f9-359c-4507-b7a9-bb1019a60934)


### Iteration
One iteration or timestep consists of the following steps:
1.	Calculating pressure 
2.	Calculating velocities
3.	Advection
Every step is completed for each cell in the grid, before the next step is executed.



### Calculating pressure
Pressure can be imagined as being the amount of fluid that is in a cell.
The velocities can be imagined as a flow of fluid from a cell to a neighbouring cell. Therefore the change in pressure is equal to the net inflow to the cell this is also known as the divergence (or convergence) in the velocity vector field. To calculate the net inflow to the cell, the total outflow is simply subtracted from the total inflow. This is done for both x and y directions. 

<img width="460" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/b2500548-5145-451f-b67b-84d2d8673811">

![image](https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/83ea332f-c5c9-46de-8afb-5a0bf28c7b31)



### Calculating velocities

The change in the velocity trough a point is proportional to the pressure across it. This is basically just Newton's 2nd law (F = m * a) Pressure is force / area, and since the area of the cell is constant, the force (F) is simply the pressure gradient across the point. The mass (M) is also assumed to be constant as if the fluid has a constant density, this is not physically accurate. The acceleration (a) is then simply a function of the pressure gradient. Acceleration is simply the change in velocity / time, and because the timestep is constant all that remains is simply adding the pressure gradients to the velocities for both x and y axis:


<img width="566" alt="image" src="https://github.com/niels747/2D-Weather-Sandbox/assets/42830240/3c8714fc-8b32-4fa8-8591-3a07509001a7">




## Libraries

The simulation and visualization itself is entirely custom js and glsl written by me (Niels Daemen). The sounding graph, keyboard and mouse controls are also custom code. The simulation can run and be partly controlled without any libraries. I do however use the following libraries for part of the user interface and file compression:

DatGui: Used for the user interface because it's very easy to add more controllable variables. It is however getting a bit cluttered and other options should be evaluated. Building a custom interface is also an option.

Pako: Only used for data compression to reduce save file sizes. Size reduction can be 2-4 times depending on the state of the simulation. Not essential. Downside is that it takes longer to save and load files.
  
# How to run it locally and modify code
  1. Install VS code: https://code.visualstudio.com/
  2. Install VS Code extensions:
   * Live Server (required)
   * GLSL lint (recommended)
   * Clang-Format, requires installing CLANG/LLVM: https://github.com/llvm/llvm-project/releases/tag/llvmorg-16.0.0 (recommended)
  
  3. Clone project using GIT, or just download ZIP
  4. Open project folder in VS Code
  5. Open index.html
  6. Start live server (Go Live), automatically opens page in browser

## Installing as an app (PWA)
The sandbox is installable: open it from `http://` or `https://` (not `file://`) and use the browser's install action, or the **Install app** button that appears next to *Create new simulation* / *Load existing save* once the browser offers the prompt. Installed copies open in their own window at the shell's size and start without a network.

* `manifest.webmanifest` declares the name, standalone display, theme colours and the 192/512 icons (`any` and `maskable`). Icon sources live in `resources/icons/app`.
* `sw.js` precaches the app shell on install — HTML, JS, shader sources, fonts, weather icons and the small sprites — about 1.5 MB. The background image, ground texture and noise texture are fetched right after the worker activates, and the 17 MB of mp3 ambience plus thunder fills a separate media cache as it is played, so neither blocks the install or the first offline start.
* `pwa.js` registers the worker and drives the install button. Everything is guarded, so browsers without service workers, and `file://` copies, behave exactly as before.

Cache keys are stored without their query strings, and freshness comes from a single value: `VERSION` in `sw.js`. **Bump `VERSION` together with the `?v=` cache busters in `index.html` and `app.js` whenever a precached file changes** — `tests/check-pwa.js` fails if they drift apart, and a stale worker would otherwise keep serving the old shell.

Checks (all plain Node, no browser needed):

```text
node tests/check-pwa.js        # manifest, icons, tags, precache completeness + weight
node tests/check-sw-offline.js # runs sw.js against a fake cache and network
node tests/check-shaders.js    # glslangValidator on every shader
node tests/check-lightning-rods.js
node tests/check-ic-lightning.js # the intra-cloud artwork, rendered and measured
node tests/check-lightning-bolt.js # the cloud-to-ground channel's shape, drawn and measured
node tests/check-lightning-strikes.js # how often lightning may strike, and when
```

`tests/check-lightning-strikes.js` runs the slot manager - the six slots a strike
can own, and the rule that a new strike may only start when one is idle - against
the real intensity curve. A slot is booked for exactly as long as its own strike
can be seen; booking it for the longest strike there can be instead (which is what
it used to do) meant every flash held a slot for three or four times its own
length, and a storm could only manage a strike every ~28 iterations.

Two things decide how long a lightning event takes to show up, and both are
pinned down there. The slot: a storm in a cold cloud asks for a strike on almost
every iteration, so the slots are the rate, and an attempt that finds all of them
busy is dropped - which is why a flash could arrive at a moment nothing in the
cloud asked for. Six slots instead of four shorten that wait. The curve: it used to
spend its first unit - five iterations - ramping a stepped leader down the
channel, which a cloud-to-ground stroke wants but an intra-cloud flash does not,
and that stage is gone for both kinds of strike now. Every strike, intra-cloud
and cloud-to-ground, starts at its peak and is at full brightness in the
iteration it is booked. Measured with that suite's
own model: the dimmest first iteration of an IC flash is 100% of its peak, and the
worst gap between strikes in a saturated storm falls from 27 to 22 iterations.

`tests/check-ic-lightning.js` is the one that does not just read source: it loads
`lightningGenerator.js` with a stubbed 2D canvas (`tests/ic-canvas-stub.js`),
draws the eight intra-cloud tiles, and checks them as pictures - stroke width,
brightness hierarchy, connectivity, and that no two tiles are the same flash. It
then ports the intra-cloud maths out of `realisticDisplayShader.frag` so the
artwork can be judged at the size and the zoom a player sees it at, in cloud and
in clear air. If you touch the IC artwork, that is the suite to run.

`tests/check-sw-offline.js` executes the real worker in a scripted environment: it must precache every shell file, purge the previous version's cache, warm the large art, answer navigations and versioned asset requests from cache with the network switched off, and leave cross-origin, non-GET, range and `.zip` requests untouched.

## Deploying a GitHub Pages copy

This project is a static site and can be deployed directly from GitHub Pages. The workflow in `.github/workflows/pages.yml` publishes the repository root whenever code is pushed to `main` or `master`, and can also be started manually from the repository's Actions tab.

For `zaioiemeerkat-commits/2dweathersimoptimized`, push this project to that repository. The deployment workflow enables GitHub Pages and publishes the repository root. After the workflow succeeds, the site will be available at:

https://zaioiemeerkat-commits.github.io/2dweathersimoptimized/

The site name and simulation performance defaults are unchanged. GitHub Pages only hosts the files; it does not change the browser, GPU, or simulation workload.
