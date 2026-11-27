# 2D Weather Sandbox

Previously called "Weather_Sim_4"

This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.

The simulation requires a browser with WebGL2 and `EXT_color_buffer_float`; open it through a local web server rather than `file://`. Firefox performance depends on hardware acceleration being available. In Firefox, check the Graphics section of `about:support` if rendering is unexpectedly slow or WebGL is unavailable.

Audio assets use MP3 for broad Web Audio decoding support and load on demand, so unused sounds do not delay startup. Ambient sound-field samples use asynchronous GPU readback and update at most ten times per second.

### Mobile GPU compatibility

Precipitation attributes have explicit locations across update and display programs. When `EXT_float_blend` is unavailable, precipitation feedback and deposition use blendable half-float targets; inactive particles are counted from the transform-feedback buffer at the existing sampling interval, and lightning feedback encodes a count rather than large iteration numbers. This fallback has lower precision and occasional CPU readback cost; rain gauges may be less precise in very intense rain. The simulation still requires WebGL 2 and `EXT_color_buffer_float`, and reports an error if the precipitation framebuffer cannot be created.

To reduce startup memory, the surface image is pre-sized to the resolution already used for GPU upload. On mobile browsers, lightning artwork uses one 1600 × 3200 tile (64% linear resolution), falling back to 1250 × 2500 when the GPU texture-size limit is below 3200. The tiles use the same logical shape. This does not change simulation resolution or saved display settings. A SwiftShader smoke test exercised the fallback, but physical Mali and Apple devices still need testing; a browser or GPU reset can have other causes.

### Lightning tools

Choose **Lightning Rod** or **Super Lightning Rod** from the Tool menu and click near the ground to place a mast (up to 12 total). The super rod is 1.8× taller, has 2.5 times the base attraction range and a larger guaranteed capture region; actual attraction also varies with height and current. Rod capture and its reach preview stop at the world seam, even when the simulation itself wraps. Shift-click or right-click either type to remove it, or use Clear Lightning Rods. Superbolts still obey their 9–37 km range even when rods attract them; other external positive CG strikes travel 5.5–34 km.

The in-simulation Tool, Display, and other option controls use in-page option lists instead of native browser dropdowns. Click or use the keyboard to open them; arrow keys navigate, Enter selects, Escape closes, and the mouse wheel cycles options. Setup-screen selections are unchanged.

Interface controls change state immediately without UI animations or transitions. Interface shadows are sharp or removed; glass backdrop blur and simulation lighting remain independent.

Choose **Precipitation** and paint with the brush to rain (or snow, where the painted air is below 0 °C) directly into the sky — no cloud is required. Painting injects into the precipitation field, which falls with the flow, feeds the radar/reflectivity display and the realistic display, and the same stroke releases real droplets from the brush, so painted rain wets the soil and builds snow on the ground exactly like cloud rain. Hold Ctrl to paint the precipitation field back out (no droplets spawn while erasing). The circular brush diameter, intensity and whole-width mode behave as everywhere else.

Choose **Artificial Lightning** and click or tap the simulation. The **Artificial Lightning Variant** list offers ordinary CG, IC, positive IC, negative and positive CC, positive CG, superbolt and hyperbolt. Ground-striking variants obey rod capture. A queued click retains its selected variant; up to 16 requests wait for a free slot, including while paused. Older saved choices for removed variants fall back to ordinary CG. Artificial strikes are visual sandbox actions and use a longer animation clock.

### Lightning rendering

Lightning paths, their illumination, and rod strike flashes render only in the original 0–1 world tile even if the simulation background wraps; neighboring repeated tiles do not display duplicate lightning. Rod attraction also stays within the original tile. If there is not enough same-tile space for the minimum external range, the event uses the normal non-external classification; a superbolt without 9 km of room falls back to an ordinary external strike when possible.

Ground-to-cloud leaders, anvil crawlers, blue jets, red sprites and elves are no longer generated or rendered. Legacy upward-leader slots are ignored.

The fluid solver bounds sounding-profile lookups at the bottom of the grid and sanitizes non-finite or runaway state values between update passes. These safeguards are intended to prevent a single unstable cell from corrupting the wider simulation; they only intervene outside broad physical ranges and do not replace the model's simplified physics.

The realistic display defaults to 100% HDR and bloom; the Balanced preset uses 75% HDR and 50% bloom. Artwork is generated in a background worker after loading, at most one job at a time and at most two bolt tiles on desktop (one on mobile). The active renderer uses only the original bolt artwork; each desktop RG8 tile costs about 33.3 MB including mipmaps. The worker no longer generates the unused legacy bolt or separate IC network during play. Lightning status checks use a reusable GPU readback buffer, with synchronous fallback if synchronization is unsupported. Device memory, display resolution and GPU performance still affect frame rate and reliability.


Special-lightning emission uses an 18× gain and a 24,000-unit HDR shoulder before the shared bloom pyramid. With filmic tone mapping off, the post pass uses the original exposure and gamma with per-component display clipping, so bright channels tend toward white and dimmer bloom retains colour. This also changes other bright scene highlights. Filmic tone mapping retains its existing highlight shoulder. The scene framebuffer is additionally protected by `softHdrClamp()` against 16-bit float overflow, and the post pass guards non-finite samples. Exposure, bloom and bright backgrounds can still change the perceived colour. A lost WebGL context surfaces a reload overlay instead of silently leaving a black canvas.



No channel shines through the terrain. The flash is accumulated while the air is drawn, and the display pass tracks the exact coverage of solid geometry standing in front of every fragment - from the same wall data the silhouette is drawn from - and multiplies the accumulated flash by (1 - coverage) at the composite: 1 deep inside solid ground, 0 in open air, and the building/foliage texture's alpha in between, so the channel collides with the silhouette pixel by pixel instead of bleeding through its anti-aliased edge. Every opaque terrain foreground that replaces the air behind it (the 45° slope triangles at shorelines and ridge edges, urban and industrial silhouettes, the tree canopy with its snow caps) additionally drops the accumulated flash outright. Wall faces and everything below the simulation area never call the air path at all. Buildings still light their windows at night and the fire forest still glows, because that light was never part of the flash. The rod's own light is the deliberate exception: the mast stands in front of the terrain, and its tip corona and the surge down the mast composite on top of whatever is behind it - they accumulate in a separate term that is never attenuated. The one terrain-adjacent case that renders as air and keeps the lightning is the air band above a lake's waterline. The bloom screen-space halo can still soften the silhouette around a strike; that is the bloom pass and is not affected by the channel's collision.

Ordinary cloud-to-ground lightning uses artwork adapted from [Niels747’s original](https://github.com/niels747/2D-Weather-Sandbox/blob/0fe98cf10bc844a41e3c5cdb91b897dfe2080e5f/lightningGenerator.js), without added warp or procedural forks. Positive ground lightning and both IC and CC polarities project that same artwork onto their paths. IC and CC use varied tilted, asymmetric arches; CC paths join their cloud endpoints. Their analytic projection avoids the old per-pixel cubic nearest-point search. The moving ordinary leader samples the original raw intensity; return strokes pre-threshold the same artwork before mip generation and filter coverage using projected pixel footprints. This helps narrow channels stay visible as zoom and resolution change without deliberately widening them. Close magnification is still limited by the source artwork resolution, and the result depends on exposure and display scale. Rod capture, manual strikes, variants and saved quality settings are retained. The RG8 bolt tile stores filtered coverage and raw leader data, reducing tile memory by one third compared with RGB8; unused legacy bolt and network artwork are no longer generated during play. Where the GPU supports anisotropic filtering, up to 4× anisotropy reduces over-blurring along angled channels; unsupported devices retain trilinear filtering. The source resolution and physical channel width are unchanged. A narrowly scoped guard suppresses repeated natural feedback at nearly the same origin within two simulation iterations, while leaving manual clicks and distinct storms independent. When zoom falls below 0.75, the realistic view can temporarily render into a 2×-per-axis HDR target and resolve four display-mapped samples per canvas pixel, with hysteresis until zoom reaches 0.85. This reduces blocky distant subpixel lightning without editing the saved HDR scale or motion-blur setting; the entire realistic scene is rendered at higher resolution while active, not only lightning. The extra RGBA16F target is limited to 64 MiB and allocation failures fall back to the selected scale. If Super Sharp Detail already doubles the canvas, no additional automatic target is allocated. This can substantially increase GPU load and memory while zoomed out, and very thin distant channels can still disappear. Real-device appearance and performance need verification.

Special discharges retain their existing first-return envelope; the short hyperbolt uses its own fast initial envelope. Ordinary CG uses the upstream leader and return-stroke curve. Lightning channels use Niels747's original linear RGB (0.70, 0.57, 1.0) across all variants; cloud illumination is neutral as in the upstream renderer. The special variants keep their path geometry, intensity and timing. Bloom follows Niels747's shared pipeline: it samples the HDR scene once, extracts 2% and adds the blurred bloom at 0.990 before the user's existing tone mapping. This applies to ordinary and special lightning and other highlights. The original bloom single sample can miss thin channels at low bloom resolutions, and clipping can flatten bright regions. The visible channel uses a separate coverage mask and bolt-free HDR background to resolve partially covered pixels after display mapping, while the original HDR scene remains the bloom source. These two extra targets use about 10 bytes per HDR pixel (plus GPU overhead), up to a 64 MiB budget; if allocation fails or the budget is exceeded the renderer falls back to the previous HDR path. Very small branches can still disappear under texture mipmap quantization, and physical-device appearance and performance remain unverified. Exposure, tone-mapping and saved settings remain unchanged. Supersampling and motion blur remain opt-in on a fresh install, and saved choices are preserved. Advection and realistic display share wall-aware interpolation work between fields at the same position, reducing repeated wall texture sampling without reducing resolution. The simulation skips inactive brush, aircraft, global drying and zero-weight sounding work; clear-air inactive droplets skip unnecessary sampling and only lightning-eligible droplets scan the strike slots. Long-expired lightning slots skip per-pixel lifetime calculations, while ordinary lightning and IC flashes skip special-variant calculations they do not use. GPU regression tests compare the simulation shader with its previous output across active controls and compare lightning variant timing before and after the fast paths. Lightning can still impact frame rate; real-device FPS and performance have not been benchmarked. Ambient-audio and precipitation count readback buffers are reused. Precipitation counts are staged asynchronously after GPU completion, including the compact mobile path; synchronization failure falls back to the original blocking read. The compact path allocates a staging buffer and CPU array of 20 bytes per droplet on first use and still scans the data on the CPU. Weather-station, clock contrast, manual strike and other reads can still block. These changes do not eliminate other simulation and rendering costs.

The finite simulation grid has an open upper edge: pressure can drive air outward or inward, incoming air uses the initial top-of-domain temperature and clear ambient humidity, and precipitation leaving the top is removed rather than trapped. This approximates an open atmosphere, not an infinitely tall simulation; clouds and particles that leave the grid are no longer simulated.

Lightning geometry uses a 12 km reference world scale, so channel dimensions and strike ranges remain stable as simulation resolution and height change.

A cloud-to-ground stroke lights the clouds around it, and no further. The bolt throws one lobe on the cloud it came out of (`lightningOnLightBrightness` 0.004), the value the app shipped with; it scales with the strike's own intensity curve and is added to `onLight`, which multiplies the scene's own colour - so a flash brightens what is there instead of painting a flat white over it. Later rounds had a second, wide lobe that lifted the sky and then a frame-wide flash driven by the strongest running stroke; both are gone.

A cloud-to-ground channel is the one the app shipped with. Its heading is a single jittered walk - step, kicked by up to 40 degrees, pulled 8% back toward vertical every pixel - so the channel buzzes down the picture around a vertical axis: 17 changes of direction over the height of the tile at about a third of a radian per pixel, with no long arc in it. The trunk is 9 artwork pixels wide on the 2500-pixel-wide tile and a fork leaves at up to half of that, shedding a fifth of a pixel each time it narrows (`CG_SHAPE.taper`); at the default camera that is about 1.8 screen pixels, because the tile and the channel scale together: a channel, not a slab. A two-scale heading (a slow aim for arcs, a fast jag for the buzz) and a hair-thin or a heavy channel were all tried here, and all of them were taken back out - a return stroke reads as a hard, straight, quick crack of light, and every one of those changed that. `tests/check-lightning-bolt.js` renders the artwork and measures the shape, the width and the buzz against these numbers.

Ordinary CG uses the original leader threshold followed by a return-stroke and restrike intensity curve. Special variants retain their own animation and brightness. Rod capture and manual strikes remain available.

Each retained lightning class uses Niels747's channel colour and neutral cloud illumination. Lightning HDR energy feeds bloom independently of the user’s bloom and exposure settings.

The growing CG and IC/CC leaders contribute more HDR energy to bloom before the return or reillumination, while remaining much dimmer than the fully lit channel. This is independent of the user’s bloom and exposure settings; the visual balance still needs validation on a real GPU.

IC, CC and positive ground strikes adapt the upstream bolt artwork to their respective paths. The cloud variants use their own growth and reillumination timing; the ordinary CG leader uses the original threshold animation. The brightness of channels seen through clouds is attenuated by cloud density. These are visual approximations, not microsecond-resolution electrical models.

**What the artwork costs in graphics memory.** One 2500 × 5000 RG8 bolt tile needs 25 MB at base level and about 33.3 MB including mipmaps; at most two are resident on desktop. Mobile uses one 1600 × 3200 tile (about 13.7 MB with mipmaps), or one 1250 × 2500 fallback tile (about 8.3 MB with mipmaps). The upstream artwork strokes are scaled to 70% width while retaining the original path and brightness calculations; this can also change the bloom. The worker creates only the original bolt for active rendering; IC and CC project the same artwork, and no separate network tile is generated or uploaded during play. A context loss reduces the next desktop load to one tile.

Simulation textures also consume substantial memory: the estimate is about 163 bytes per cell, or about 93 MiB at 2000 × 300. The setup screen reports this estimate and a context loss causes a lighter default on the next load. HDR, bloom, artwork, temporary zoom supersampling and driver overhead are additional costs; `tests/check-memory.js` prints a rough texture-only estimate.

**What crosses out of the artwork worker is data, and only data.** The tile arrives as `{width, height, data}` and `onmessage` builds that object field by field, because `postMessage` runs a structured clone and a structured clone refuses anything that is not data. When `readRedChannel()` replaced the `ImageBitmap` path it kept a `close()` method on the object it returned - a leftover of the bitmap it was written for - and the worker threw `DataCloneError` on the very first tile it tried to send. No artwork ever reached the main thread, both texture slots stayed at their empty 1 x 1 placeholder, and **every lightning channel disappeared, cloud-to-ground and intra-cloud alike**, while the rest of the app carried on as if nothing had happened. It cost one line in the console, because that is all the worker's `onerror` said.

So there are two fixes here, and the second is the one that lasts: the payload is built explicitly at the boundary, and a dying worker now logs the file and line it threw on, listens for `messageerror` as well, and says in plain words when it has given up trying. `tests/check-lightning-bolt.js` posts both pieces of artwork through a real structured clone with the transfer list and fails if the clone throws or comes back empty, and it measures that the trunk is still bright enough to survive the generator’s saturated trunk brightness. A silent worker looks exactly like "lightning does not work", which is a bug report about the wrong file.

**A strike only exists if it reaches a slot, and two numbers in that path said no to every one.** A freezing droplet writes its strike into one texel of the precipitation feedback, added up with every other droplet that strikes in the same iteration; the slot pass then reconstructs one strike out of that sum. That path had two faults that between them produced *no lightning at all* — no channel, no glow, no thunder, either kind, in any storm:

* **`lightningChanceMultiplier` was 2.72.** It multiplies cloud density to make the chance that a freezing droplet emits lightning, so it is a probability and has to sit well under one. At 2.72 the test `random2d(...) < lightningSpawnChance` was true for every freezing droplet in a dense cloud — hundreds of them per iteration, all summed into the same texel — where it should have been a rare event. It is 0.0075 now, the last value in its own tuning chain that was still a probability, and the gap between strikes is paced by `minIterationsSinceLastLightningBolt` (30 iterations, the original number) instead of by nothing at all.
* **The count recovered from that sum was capped at 64.** The texel holds `k * iterNum` in its start field, so it is divided by `k` to average the contributions; with `clamp(..., 1., 64.)` and `k` above 64 the division left a start iteration *ahead* of the current one, and the "is this strike from now?" test threw it away. So a dense storm dropped every strike it produced, silently, for the whole session — which is a `k` of hundreds, i.e. any storm that is freezing hard, i.e. always. The start iteration is no longer recovered by division at all (the texel is cleared every iteration, so anything in it formed this iteration), and the count is used only to average the position and intensity.

Because this is the kind of failure that leaves no trace, the app now says what it knows: the console prints the build it is running (the cache-buster on `app.js`, which is how you tell a stale service worker from a bug), and after twelve seconds it prints how many bolt tiles arrived and whether the artwork worker has failed.

Both are checks now: `tests/check-lightning-strikes.js` reads the multiplier and the cooldown out of the shader, runs a 6000-iteration storm through the spawn probability and the cooldown, and requires that strikes actually start and never start closer together than the cooldown; it also ports the reconstruction and requires a strike at k = 1, 2, 64, 65, 200, 1200 and 5000 contributions, with the right position and intensity.

Two more things were released rather than shrunk. The decoded pictures are dropped as soon as they are uploaded - the original 4096 x 2560 source is no longer decoded at startup; the pre-sized 2048 x 1280 upload is released after use. And `background.png`, a CSS backdrop at 2560 x 1600, is composited once by the browser rather than resident in the context.

The surface texture map was the other thing worth shrinking. It is authored at 4096 x 2560 - five ground surfaces stacked vertically, 42 MB of RGBA8 - and it is a tiling detail map whose finest features are fractions of a metre across on a 40 m simulation cell, sampled by `surfaceTexture()` as ground colour rather than as geometry. Its top octave lands on less than a screen pixel at any camera the app allows. `uploadSurfaceTextureMap()` halves it to 2048 x 1280 (10.5 MB) through a 2D canvas before the upload, with a plain `texImage2D` of the full image if there is no 2D context to do it with.

Four things are deliberately *not* shrunk, because each of them is the look or the physics that was asked for: the simulation's own float formats (halving their precision changes cloud shading and the display's light), the bolt artwork's 2500 x 5000 texels (the channel's width and fork taper are measured against them), the HDR and bloom targets (already at 75% and 50% of the window), and the second tile that gives the storm two shapes to alternate through.

Intra-cloud light is attenuated by the cloud it is born in, and a cloud-to-ground stroke is not. The bolt's light goes into `emittedLight`, which the fragment carries on top of the scene, and it is divided by `1 + cloudDensity * 100` on the way: light born deep inside a cloud reaches the eye scattered and dim, while the part of the same channel below the cloud base is seen directly. That is what makes a flash inside a cloud read as a glow through it instead of a sheet of light painted over the sky.

**Sometimes the app failed to start, and this round closed that path.** Starting the simulation only works after every file it needs has crossed the network or the service worker's cache: thirty shaders, two include files, and a handful of textures. A single dropped request used to abort the whole start with an alert that named whichever file was unlucky, and an image that failed to load was worse - it rejected unseen, so the simulation started with zero-filled textures and no message at all. Everything on that path now gets three attempts with a growing pause before it gives up (shaders, include files and images), the simulation waits for the textures instead of letting them upload in the background, and the startup alert names the file it failed on. Two more holes on the same path are closed: the Start button is a single-flight entry point (two clicks used to run two `mainScript()` in parallel, doubling the graphics-memory request and letting both runs fight over the same globals), and, before committing to a start, the page asks the service worker which build it is serving - a tab open across a deploy was pairing this page's code with the new shaders, the one combination neither version was ever tested in, and it now offers a reload instead. The service worker, for its part, will not serve a cached `index.html` whose `?v=` buster does not match its own VERSION, so a precache poisoned by a half-finished deploy cannot paint a stale page under the new shell. The one regression that survived all of this once — the shader-retry constant declared inside `mainScript` below the hoisted function that reads it, aborting every start with a Temporal Dead Zone error — is why there is now a startup smoke test: `tests/check-startup.js` runs the real `app.js` in a sandboxed VM with a stubbed DOM, WebGL2 context, network and audio, clicks Start in effect, and drives the happy path, a flaky shader, a fatal shader and a fatal image; it fails on the build that shipped the bug and passes on the fix.

A **lightning rod** is drawn as an air terminal with a mast, tip corona and strike surge. Up to 12 normal or super rods can be placed and removed with the rod tools. Ground strikes may be captured within a gameplay-scale rolling-sphere reach based on the displayed mast height and the strike's intensity index, calculated in metres so widening the simulated world does not increase a rod's physical reach. Normal rods guarantee capture inside 35% of their reach; super rods are taller, multiply reach by 2.5 and guarantee capture inside 70%, with probabilistic capture farther out. The placement preview uses a representative intensity and is not a safety boundary. This is a game approximation, not a real-world lightning-protection calculation: the intensity index is not measured electrical current. Rods do not convert or capture IC or CC lightning, capture never crosses the world-tile seam, and captured CG channels terminate at the mast tip. External positive strikes still respect their existing distance constraints. Cloud-to-cloud targeting now searches cloud decks only when the probability roll calls for it; rod shading also skips horizontal work and slot reads outside the mast's vertical bounds. These changes reduce work but have not been benchmarked on physical devices.

**External positive CG ("bolt from the blue")** strikes originate from the upper levels of tall convective clouds (`y >= 0.18`, ~14–24% of qualifying triggers) and travel far laterally outside the storm core into clear air (5.5–34 km for ordinary external strikes or 9–37 km for superbolts, limited by the available same-tile space) before plunging to the ground (or onto a capturing lightning rod's copper tip). `lightningDataTextures` uses a second metadata row (`numLightningSlots x 2` RGBA32F) to keep `(originX, type, targetY)` alongside the slot strike `(groundOrTargetX, originY, startIterNum, intensity)`, while `lightningLocationShader.frag` probes `waterTex` on both sides to steer external strikes out of wide anvils and neighboring storm cells into clear sky (still allowing distant lightning rods to capture them). In `realisticDisplayShader.frag`, `displayExternalLightning()` curves the bolt within the same world tile from `(originX, originY)` inside the storm out to `groundX` (stopping at `rodTipY` when captured) with the upstream channel colour at `extBoltBrightness = 60000.` and `2x` ground/origin `onLight` illumination, normalized onto normal CG's intensity scale (`extCurve` and contrast-shaped coverage) so it shares the same smooth HDR fade curve rather than snapping off harshly while keeping rare restrokes (0 restrikes ~85%, 1 rare restroke ~15%); thunder audio uses wrapped horizontal distance to pan and delay from the distant ground impact.

**Cloud-to-cloud (CC)** lightning bridges across separated convective storm cells and distant cloud decks (`selectCloudToCloudTarget()` probes `waterTex` across 8 lateral offsets and 4 vertical decks while skipping terrain walls, without being captured by ground rods). `displayCloudToCloudLightning()` draws a procedural slope-corrected tortuous plasma leader along an asymmetric cubic Bezier curve with forward-diverging dendritic branches (4 primary + 2 secondary sub-forks for `-CC` in violet-blue; 2 clean bold forks for `+CC` in white-peach) and three-lobe origin/midpoint/target cloud illumination (`onLight`). Positive cloud-to-cloud (`+CC`, `meta.y = 3.0`) fires predominantly as a single return stroke (`0` restrikes ~80% of the time) and shines **50% brighter (`1.5x`)** than negative CC (`-CC`, `meta.y = 2.0`). Both polarities play `cc*.mp3` thunder audio anchored at the same-tile cloud-to-cloud midpoint.

**Artificial lightning variants.** The selector maps ordinary CG, IC, +IC, -CC, +CC, +CG, superbolt and hyperbolt to shader indices 0–6 and 12. Artificial metadata retains the existing sentinel and +10 target-height encoding; removed saved selections fall back to ordinary CG.

The dat.GUI **Performance** folder, below **Exclusive Features**, contains Extreme, Quality, Balanced, and Performance presets for HDR and bloom rendering scale. Extreme uses full-resolution HDR and bloom, plus cloud self-shadowing with cool cloud shadows and sun-warmed edges and a richer time-of-day sky gradient. Filmic ACES tone mapping, FXAA anti-aliasing, temporal anti-aliasing, and **Super Sharp Detail Mode** (which shows a warning prompt before enabling and increases the rendering pixel ratio by 2x across HDR, bloom, and post-processing) are **off by default** (temporal smoothing, when enabled, is clipped to current-frame neighbors and reset when the camera or display mode changes rather than motion-reprojected); each can be switched on individually. These post effects increase GPU load, especially at high window resolutions. Individual effect controls are also available. The folder additionally includes controls for precipitation-particle and weather-station overlays, simulation iterations per frame, and an Auto FPS Target that defaults to 120 FPS, with targets up to 240 FPS and an Unlocked option. Unlocked leaves the iteration count unchanged and lets `requestAnimationFrame` run at the maximum rate supported by the browser and display. Numeric targets adjust simulation iterations, which affects simulation-time throughput and may change how quickly simulated time advances. Before simulation starts, the app estimates the browser animation-frame ceiling and uses the lower of that ceiling and the selected target for Auto Adjust. This avoids collapsing to one step per frame when a 120 FPS target runs on a 60 Hz display; it does not change the saved target or manual iteration settings. The startup probe times out after 750 ms and falls back to the selected target when no usable cadence is available. Actual FPS and simulation throughput remain subject to the rendering and simulation workload. Lower display scales only soften the rendered image; hiding overlays or bloom only affects presentation, while station measurements and precipitation continue. Hover performance controls for descriptions and color-coded impact levels; actual FPS gains depend on the workload and hardware bottleneck. The **Current Performance** section reports frame rate, frame time, simulation steps per second, render quality, and a face-icon score based on measured FPS.

The **Display** menu includes estimated reflectivity and surface-parcel CAPE views. Reflectivity is a radar-style visualization derived from cloud and precipitation fields, not calibrated dBZ or a radar product. CAPE is an approximate model-derived surface-parcel diagnostic; its column calculation refreshes periodically while the view is active, and hovering shows the latest CAPE, surface temperature/dew point, and LCL estimate for that column. Neither view replaces an operational weather analysis.

The **Wind Push** tool can push air left or right and optionally set the pushed band's air temperature and relative humidity, allowing users to create contrasting air masses and experiment with front-like boundaries. Temperature and humidity overrides are off by default; band width and height use the whole-width and brush-size controls.


### Hyperbolt positive lightning

A hyperbolt is the apex of the external positive CG path, and it is superbolt-class, so everything a superbolt can do, a hyperbolt does, harder. Nominal figures are 720,000 K, a notional 80 terrawatts and 120 gigaamps - the current and amps are fiction, are not modelled, and change nothing in the physics. What is modelled: the channel uses the same upstream colour as other lightning; the stroke writes at 30x a superbolt (360x an ordinary stroke); the lifetime window collapses to 0.3 s (`lightningTime` is accelerated past the tail exactly as the superbolt's 0.1 s shortcut accelerates it, just much further - `2.924 - 2.624`); and a captured-rod surge honours the same 0.3 s window and 30x gain. Hyperbolts spawn nested under the superbolt roll: the same 7.2% of external positive CG strikes, halved again by a second independent roll, so about 3.6% of external positive CG events are hyperbolts ("half as rare as an ordinary superbolt") with at least 9 km of same-tile room. Camera shake is intensity 450 over 12.5 s (5x the original 90 / 2.5 s; 40 Hz, random axis per 25 ms phase, exponential decay scaled by the same factor so it dies with the shake; hyperbolt alone fires it, stacked on top of nothing); the readback lives in the same 20 Hz lightning-sound tick but is independent of the sound system, so it fires even with sound off. Thunder for a hyperbolt plays at 2.5x the gain of an ordinary strike (1.5x for a superbolt). Rod capture follows the superbolt rules (9-37 km). Hyperbolts are also selectable directly in **Artificial Lightning Variant** as `Hyperbolt` (variant index 12) for a repeatable demo. `meta.w` encodes the class in its integer part (1 = superbolt, 2 = hyperbolt), which is why every existing `>= 0.5` superbolt consumer treats a hyperbolt as a superbolt; optical-effect fractional bits are added on top as usual.

### The super lake

Choose **Super Lake** from the Tool menu (listed right below Lake / Sea) and paint water with the same rules as the lake brush - the y position is locked while painting. A super lake is its own wall type (`WALLTYPE_SUPER_LAKE = 7`), because making it one was the only honest way to give it lake behaviour everywhere lakes already get it: dykes and land-fill rules next to water, the "no IR bonus above water" rule, IR surface emission, light absorbed by the water body, the humidity and CAPE/reflectivity displays (water body, and a deeper shade there than a lake), weather-station detection (the 1002 marker), and the lake pin in the NaN backstop. What it is not is a *look-alike* with different numbers bolted on: it is rendered with its own much deeper water colour (`vec3(0.0, 0.13, 0.34)` in the realistic display, `vec4(0.01, 0.09, 0.22, 1.0)` in the CAPE and reflectivity displays). Physics is 10x an ordinary lake where the lake touches the world: the air directly above it heats or cools from the water at 10x `waterHeatExchangeRate`, and the same air takes up water vapour at 10x `waterEvaporation`; the body itself runs its whole heat budget at 10x too - air exchange, evaporative cooling, sun heating and IR. Net effect: a super lake warms and moistens its boundary layer faster than anything else in the simulation and the storm initiates around it first. World-generated lakes stay ordinary lakes; only painted super lakes get the new type, and save files remain fully compatible (the wall texture is an Int8 and only type 7 is new).

### Real Time Cycle and Motion Blur

The Radiation folder has a **Real Time Cycle** toggle next to Day/Night Cycle. With it on, the simulation clock is synchronized to your real wall clock — date and time — so the sun tracks the actual sun for the chosen latitude year-round, including the seasonal declination, instead of being coupled to simulation iterations; **Accelerate Night** is ignored while it is on (a real night is a real night), and the clock display, sunrise/sunset countdown and run timer all follow the real time. Turn it off to go back to the simulated cycle, which resumes from its own time base. The setting round-trips through save files (older saves get it off).

The Performance folder has **Motion Blur** (default off) and **Motion Blur Strength %** (0–350). Existing settings are preserved. The post pass inverts the current camera transform, backtracks fluid velocity over the actual number of simulation steps, and projects that world point through the previous camera view to obtain a screen-space vector. Solid terrain and regions outside the simulation do not inherit fluid velocity; camera motion still affects them. A wrapped camera crossing uses the nearest periodic view, while a non-wrapped view does not fold the vector. Sixteen midpoint taps gather the current unblurred frame along the reprojected motion vector; no blurred frame is fed back into the trail. The strength slider controls shutter length, capped at 48 display pixels, and subpixel movement fades smoothly. Camera shake is included in the view. Pausing stops fluid advection but does not suppress blur from moving the camera. History is invalidated on setup or display-mode changes, not ordinary camera moves. This is a 2D approximation: separately moving particles and transient lightning do not have dedicated per-object velocity buffers.

## Clouds and precipitation
Simulating clouds and precipitation are the main objectives of this project.
All the equations relating to water phase change are simplified versions of the real ones, to improve performance and ease programming.
Precipitation is simulated using discrete particles but can be viualized as both partiles and smooth realistic looking curtains.

Weather stations estimate cloud cover from a batched sample of the liquid cloud-water column above each station, using a 21-cell-wide viewing cone (10 cells to either side). Cloud fraction uses the same optical-density relationship as the renderer, and solid terrain/building cells are excluded from the sky scan. Station cards have separate Weather and Rain pages; scroll up or down over a station to switch between them. Their cards stay a fixed screen size while zooming, but remain anchored to their simulation locations. The current temperature and rain rate are shown prominently without labels in adaptive high-contrast text. The station icon and regular weather readings are on the Weather page, while precipitation totals, duration, peak rate, and sky conditions are on the Rain page. A hover hint indicates the scroll interaction, and card text is clipped at the edges. Station labels and the simulation clock sample the scene periodically and switch between light and dark text for contrast. The icon assets and license notice are in `resources/icons/weather`. Rain totals use liquid precipitation deposited at the surface within the station's existing 2.5 km sampling radius. A GPU-side accumulator retains deposition between station samples; the 0.2 mm tipping bucket reports rate over a simulation-time-based rolling window. Rain duration tracks intervals with at least 0.01 mm of deposited rain, while the rain icon requires a bucket tip. Totals retain sampled deposition. Deposition mass is model-calibrated rather than expressed in kilograms, so millimeter conversion uses the same calibration as soil-water accumulation.

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
node tests/check-lightning-occlusion.js # no lightning light over solid terrain foregrounds; the rod glow stays
node tests/check-lightning-rods.js
node tests/check-shared-bilerp.js # shared wall-aware sampling
node tests/gpu-shared-bilerp.js # old/new interpolation parity at wall edges and seams
node tests/check-auto-simulation-throughput.js # refresh-aware simulation iteration controller
node tests/check-precipitation-fastpaths.js # precipitation and old-strike work guards
node tests/gpu-precipitation-fastpaths.js # pre/post particle and feedback parity
node tests/gpu-lightning-expiry-fastpath.js # strike lifetime guard parity
node tests/gpu-cloud-curve.js # curved cloud channels and analytic texture gradients
node tests/check-rod-sorted-lookup.js # uncapped rod table and wrapped lookup
node tests/gpu-lightning-culling-parity.js # generated-artwork visual parity for lightning fast paths
node tests/check-lightning-bolt.js # the channel's shape, drawn and measured
node tests/check-lightning-strikes.js # how often lightning may strike, and when
node tests/check-external-cg.js # positive external CG far clear-air targeting, 200000 brightness, smooth fade, single-stroke timing, and arc geometry
node tests/check-cloud-to-cloud.js # reworked organic cubic/fractal CC targeting & polarity (-CC vs +CC)
node tests/check-positive-ic.js # positive intra-cloud (+IC) anvil flash triggering, brightness, and rod isolation
node tests/check-artificial-super-rod.js # rod/trigger integration for both masts, and the crawler/GC shader structure
node tests/check-super-rod-upward.js # upward GC initiation from a super rod and its lifetime/render integration
node tests/check-artificial-variant.js # artificial lightning variant picker: options, uniforms and slot-manager dispatch
node tests/check-precipitation-tool.js # Precipitation paint tool: rain/snow into air and the droplet spawn path
node tests/check-super-sharp-detail.js # 2x pixel ratio toggle, warning confirmation, and CSS/backing coordinate alignment
node tests/check-display-aspect.js # canvas_aspect / CSS box alignment, resize resync, and plant-system removal
node tests/check-memory.js     # the graphics-memory bill, recounted from the source
node tests/check-in-sim-options.js # in-page option list behaviour for dat.GUI dropdowns
node tests/check-hyperbolt.js  # hyperbolt positive CG: 720,000 K, half-rarity nested roll, 0.3 s lifetime, intensity-90 shake
node tests/check-super-lake.js # super lake tool, wall type, 10x evaporation/heat, deeper water colours
node tests/check-realtime-cycle-motion-blur.js # Real Time Cycle sun pacing and the post-pass motion blur shutter integral
node tests/check-lightning-scale.js   # lightning variant sizes: resolution / sim-height invariance
node tests/check-cc-jaggedness.js     # CC-family fractal jag on all lightning channels, amplitude bounds
node tests/check-lightning-physics.js # blackbody Kelvin arc colours, per-variant lifetimes, branch budgets, TLE rework, drag-based fall physics
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
cloud asked for. Six slots instead of four shorten that wait. The curve: both IC
and CG strikes ignite immediately at peak brightness on the trigger iteration
(`T0 = Tin` with no 5-iteration fixed leader latency or `lightningTime > 1.0`
gate), and slot bookings drop the extra leader unit so slots recycle faster.
Measured with that suite's own model: the worst gap between strikes in a
saturated storm falls from 27 to 22 iterations.

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

### Search discovery

The GitHub Pages site has a canonical URL, indexable descriptive content and a sitemap at `https://seamless45-cpu.github.io/2dweathersandboxv3/sitemap.xml`. Search engines decide whether and when to index the site; the sitemap can be submitted in Google Search Console or Bing Webmaster Tools after verifying the site.

`robots.txt` is included for deployments at a domain root. On GitHub Pages project sites, crawlers look for `https://seamless45-cpu.github.io/robots.txt`, not the copy under `/2dweathersandboxv3/`. To advertise this sitemap via robots on GitHub Pages, the owner must place its `Sitemap:` line in the host-root robots file (typically published by the `seamless45-cpu.github.io` site); this project cannot publish that file at the host root. Submitting the sitemap directly does not require that change.
