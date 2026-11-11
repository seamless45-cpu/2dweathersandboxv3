# 2D Weather Sandbox

Previously called "Weather_Sim_4"

This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.

The simulation requires a browser with WebGL2 and `EXT_color_buffer_float`; open it through a local web server rather than `file://`. Firefox performance depends on hardware acceleration being available. In Firefox, check the Graphics section of `about:support` if rendering is unexpectedly slow or WebGL is unavailable.

Audio assets use MP3 for broad Web Audio decoding support and load on demand, so unused sounds do not delay startup. Ambient sound-field samples use asynchronous GPU readback and update at most ten times per second.

The fluid solver bounds sounding-profile lookups at the bottom of the grid and sanitizes non-finite or runaway state values between update passes. These safeguards are intended to prevent a single unstable cell from corrupting the wider simulation; they only intervene outside broad physical ranges and do not replace the model's simplified physics.

The realistic display renders its HDR scene at 75% of the window dimensions and bloom at 50%, reducing their respective pixel workloads by about 44% and 75%. Thunder detection reads its GPU result once per rendered frame instead of synchronously after every simulation step. Startup fetches shader and image files concurrently; lightning artwork is generated in the background at the original 2500 x 5000 tile and transferred as image bitmaps instead of copied pixel arrays - but never while the loading screen is up. Nothing is generated during the load any more: one worker at a time, at least a second apart, only for the tile the simulation has actually reached, capped at four tiles (50 MB of texture rather than 125 MB for the original ten), and skipped entirely while the tab is hidden. A tile is a 50 MB canvas in a worker and a 12.5 MB texture upload, so two of them landing on top of shader compilation and buffer creation was the hitch at the end of the loading bar - and on a device with a tight memory budget, the lost context that followed it. Thunder detection no longer reads back from the GPU every frame either: a readback waits for the whole queue to finish, so it runs every third frame (20 Hz), which is well inside the tolerance of hearing thunder and no longer stalls the frame the simulation is trying to start. The fork this repo started from had halved the tile and the channel together (1250 x 2500 at a 4.5 pixel channel, with the brightness gain doubled to compensate): the relative width was identical, so nothing about the *look* depended on it, but half the texels were gone and the channel broke up sooner when the camera pulled back. The tile, the 9 pixel channel and the 0.2 pixel fork taper are the original ones again. Every strike owns its own lightning slot for the length of its animation, so a newer strike can never cut a running one short; slots are only reused once a flash has finished. The weather simulation grid, timestep, precipitation, and measurements remain unchanged; the upscaled image may look slightly softer.


Lightning brightness is bounded by arithmetic, not by a clamp. The scene lives in a 16-bit float buffer (largest finite value 65504) and a cloud-to-ground return stroke is written at a hundred thousand units and up, so the fragment is written through `softHdrClamp()`: the identity below a few hundred units, monotonic, and asymptotic to `HDR_CEILING`, with an infinity mapped to the ceiling and a NaN to zero. Compressing the top of the range rather than cutting it off is what keeps a bolt *brighter than white* - the tonemap flattens everything over ~3 to the same white, so a stroke's surplus energy can only arrive on screen as the halo it scatters, and the bloom's bright pass (`isolateBrightPartsShader.frag`) is built from that buffer by taking two percent of the whole frame, which is all it has ever taken. Nothing is singled out there - a bolt and a sunlit cloud go through the same multiply - so the halo around a stroke is the blurred remainder of the frame, exactly as it was when the app shipped. The tonemap itself reads both buffers through a NaN and infinity guard, so no single sample can become a dead pixel that FXAA and temporal AA then smear across the frame. If the browser does take the WebGL context away anyway - a driver reset, or a device running out of graphics memory - the page says so and offers a reload instead of leaving a black tab: the frame loop stops, and `webglcontextlost` is answered with `preventDefault()` so a browser that restores the context on its own still can. Rebuilding every framebuffer, VAO and texture in place would be the only way to carry on without a reload, and that is not what this app does.

A cloud-to-ground stroke lights the clouds around it, and no further. The bolt throws one lobe on the cloud it came out of (`lightningOnLightBrightness` 0.004), the value the app shipped with; it scales with the strike's own intensity curve and is added to `onLight`, which multiplies the scene's own colour - so a flash brightens what is there instead of painting a flat white over it. Later rounds had a second, wide lobe that lifted the sky and then a frame-wide flash driven by the strongest running stroke; both are gone.

A cloud-to-ground channel is the one the app shipped with. Its heading is a single jittered walk - step, kicked by up to 40 degrees, pulled 8% back toward vertical every pixel - so the channel buzzes down the picture around a vertical axis: 17 changes of direction over the height of the tile at about a third of a radian per pixel, with no long arc in it. The trunk is 9 artwork pixels wide on the 2500-pixel-wide tile and a fork leaves at up to half of that, shedding a fifth of a pixel each time it narrows (`CG_SHAPE.taper`); at the default camera that is about 1.8 screen pixels, because the tile and the channel scale together: a channel, not a slab. A two-scale heading (a slow aim for arcs, a fast jag for the buzz) and a hair-thin or a heavy channel were all tried here, and all of them were taken back out - a return stroke reads as a hard, straight, quick crack of light, and every one of those changed that. `tests/check-lightning-bolt.js` renders the artwork and measures the shape, the width and the buzz against these numbers.

A cloud-to-ground stroke has its leader stage, exactly as the original had it. The artwork is revealed down the tile by a threshold that grows with `lightningTime` (`1. - lightningTime * branchShowFactor`, plus `branchShowFactor` per unit down the tile), held at `leaderBrightness` (50000 HDR, half the return stroke) for the strike's first unit, and then the whole channel switches to `mainBoltBrightness` (100000) with the threshold held at 0.95 for the rest of the flickers. The reveal is quick - the threshold passes the whole tile within half a unit - so what a player sees is a bolt that is already there rather than a shape crawling down the screen, and it costs nothing in the way of a wait. It is booked: `strikeAnimEnd()` adds that unit for every strike, so a slot is released at `start + 5 * (1 + period * flickers + 2.924)` and the last iteration of every strike is still lit.

A cloud-to-ground channel is written four decades over the white point, and it goes out the way it went out when the app shipped: as a switch. `pixVal * currentLightningIntensity`, with `currentLightningIntensity` the strike's own curve times `mainBoltBrightness`, is 100000 HDR units against a tonemap that is white from 6.3 up, so the line is clipped white for every iteration the curve has light in it and black in the iteration it reaches zero. The curve's zero-crossing is exactly where `strikeAnimEnd()` ends the strike, so the channel is white right up to its last lit iteration and then it is not there. Measured on three hundred seeded strokes: 297 of them leave at 255/255, the worst three spend a single frame below white before they go, and nothing is lit after the last iteration. Round 16 through 20 eased this tail out so the channel came down through greys over about 200 ms; that easing is gone, because the look that was asked for back is the one that switches off. The channel's colour is the original violet-white (`vec3(0.70, 0.57, 1.0)`), and the emission is added to the fragment straight, not premultiplied, exactly as the original wrote it.

A stroke is written a hundred thousand units over the white point, which is all the brightness a channel can have: past roughly 3 the tonemap is already white, so what a player sees of a stronger stroke is more halo, not a whiter line. The bloom adds 0.990 of the blurred bright pass on top of the HDR scene in `postProcessingShader.frag`, and nothing bounds that buffer beyond `softHdrClamp()` at the write and the NaN guard at the read. At a storm core (intensity 2.5) the lobe on the clouds 0.15 sim-heights from the channel peaks at about ten HDR units against a cloud's own 1, which is what makes a return stroke read as lightning rather than as a bright line - and the rest of the cloudscape keeps the glow it already had. Rounds that raised these numbers, added a bright knee and a 4000-unit ceiling to the bloom, and widened the channel exist in the history; the look that was asked for back is this one.

An intra-cloud flash is a bolt now, drawn exactly like a cloud-to-ground stroke. It used to be a separate picture: a network of hair-thin filaments, generated as eight artwork tiles, drawn through a second additive light pass in the display shader, with its own tone hierarchy (1.0/0.70/0.44/0.28 from trunk to wisp), its own widths (1.3/1.0/0.75/0.6 artwork pixels, sub-pixel on screen), its own cold blue glow colour and a glare ring that was allowed past white so the filaments could bloom. None of that is drawn any more. Every strike uses the one bolt artwork, at the one brightness, in the one place - a link in the chain of what a flash costs to draw is gone with it, and a flash inside a cloud is as bright as the bolt that started it. What still separates the two kinds is what separated them physically: a strike at or below `LIGHTNING_IC_MAX_INTENSITY` is born inside a cloud rather than at its base, and only a stroke above it can be captured by a lightning rod.

Intra-cloud light is attenuated by the cloud it is born in, and a cloud-to-ground stroke is not. The bolt's light goes into `emittedLight`, which the fragment carries on top of the scene, and it is divided by `1 + cloudDensity * 100` on the way: light born deep inside a cloud reaches the eye scattered and dim, while the part of the same channel below the cloud base is seen directly. That is what makes a flash inside a cloud read as a glow through it instead of a sheet of light painted over the sky.

A **lightning rod** is drawn as an air terminal rather than a stick: a pedestal where it is grounded, a mast that tapers to a point, a cylindrical highlight down its length and a corona at the tip that is visible at night. When a mast takes a strike the current is drawn down it, brightest at the point the bolt entered, so a capture is something to watch. The mast pulls the strike onto its own x and the channel is drawn from the cloud base through it, as the shipped artwork does - it does not stop at the tip. The threshold between an intra-cloud flash and a cloud-to-ground stroke (`LIGHTNING_IC_MAX_INTENSITY`) is 1.0, as it was originally: a strike has to be a real charge separation before it reaches the ground. It no longer chooses artwork - only a stroke is snapped to by a rod - because both kinds are drawn with the same bolt.

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
node tests/check-lightning-bolt.js # the channel's shape, drawn and measured
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
cloud asked for. Six slots instead of four shorten that wait. The curve: a strike
spends its first unit - five iterations - on the leader running down the channel,
and it is drawn at `leaderBrightness` (half the return stroke) while it does, so a
strike is lit the moment it is booked. Measured with that suite's own model: the
worst gap between strikes in a saturated storm falls from 27 to 22 iterations.

`tests/check-lightning-bolt.js` is the one that does not just read source: it
loads `lightningGenerator.js` with a stubbed 2D canvas (`tests/ic-canvas-stub.js`)
and renders the real artwork, then measures what was drawn - the width of the
channel, where it starts and ends, how far it wanders, and that it forks. If you
touch the artwork, that is the suite to run.

`tests/check-sw-offline.js` executes the real worker in a scripted environment: it must precache every shell file, purge the previous version's cache, warm the large art, answer navigations and versioned asset requests from cache with the network switched off, and leave cross-origin, non-GET, range and `.zip` requests untouched.

## Deploying a GitHub Pages copy

This project is a static site and can be deployed directly from GitHub Pages. The workflow in `.github/workflows/pages.yml` publishes the repository root whenever code is pushed to `main` or `master`, and can also be started manually from the repository's Actions tab.

For `zaioiemeerkat-commits/2dweathersimoptimized`, push this project to that repository. The deployment workflow enables GitHub Pages and publishes the repository root. After the workflow succeeds, the site will be available at:

https://zaioiemeerkat-commits.github.io/2dweathersimoptimized/

The site name and simulation performance defaults are unchanged. GitHub Pages only hosts the files; it does not change the browser, GPU, or simulation workload.
