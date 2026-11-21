# Since May 2022:
- [x] Add controls for global drying and heating/cooling
- [x] Prevent whole width brush without tool
- [x] Add fire
- [x] Add smoke
- [x] Add variable moisture dissipation/removal to options
- [x] Fix GUI digits
- [x] Make vegitation amount (greenness) fixed
- [x] Make land evaporation proportional to amount of vegitation
- [x] Improve surface visualization
- [x] Add tree / vegetation textures
- [x] Make dust blow up with wind in areas without vegetation
- [x] Make fire spread and burn out, only in areas with vegetation
- [x] Improve fire visualization
- [x] Fix slope(green triangle) being lit up by fire
- [x] Snowy trees
- [x] Fix sounding aspect ratio
- [x] Extend sounding scale to 50°C
- [X] Add wind tool: move air by dragging

# December 18, 2022 Release:
- [x] Improve Lake/Sea editing
- [x] Improve sky visuals
- [x] Improve lighting and surface visuals
- [x] Make vertical resolution configurable from 100 to 300 cells
- [x] Don't show grass underwater
- [x] Fix snow landing underwater bug
- [x] Fix fire buring on water bug
- [x] Improve fire spreading system
- [x] Fix snow albedo
- [x] Scale tree height with vertical resolution
- [x] Add vector field velocity indicator
- [x] Make trees wave with the wind
- [x] Make behaviour of IR radiation scale with vertical resolution to fix unrealistic behavior at resolutions lower than 300

# In Between changes:
- [x] Improve droplet display
- [x] Lock vertical brush position when drawing lake / sea
- [x] Add Touch Screen Input for using tools
- [x] Add wind speed gauge to sounding display
- [x] Add Touch Screen Input for changing view
- [x] Add different colors for droplet display
- [x] Add weather stations showing current conditions
- [x] Add hail formation
- [x] Apply wind tool only horizontally in whole width mode
- [X] Smooth Camera Controls

# Juli 21, 2023 (500 Subsriber Special) Release:
- [x] Add Option to quickly reload simulation from save file
- [x] Optional Smooth Camera Controls with adjustable speed
- [x] Optional Horizontal View wrapping
- [x] Make simulation height adjustable from 5000m to 15000m
- [x] Make vertical resolution adjustable from 100 to 500
- [x] Save Weather Stations to Save File
- [x] Add option to turn off precipitation
- [x] Improve longwave (IR) simulation
- [x] Add Clock

# Changes since Juli 21
- [x] Adjustable water temperature
- [x] Show water temperature in sounding graph
- [x] Improve fire
- [x] Add plane flying mode. Experience the turbulent clouds by flying a realistic plane trough the clouds at realistic scale and speed!
- [x] Add urban surface type with building textures
- [x] Improve precipitation spawning system
- [x] Add lightning effect
- [x] Make soil and vegetation color change with soil moisture
- [x] Add dynamic vegetation option. Vegetation will grow when soil is wet, and die if to dry
- [x] Make soil and vegetation color change with soil moisture
- [x] Make weather stations show history in plots
- [x] Improve realistic hail formation and improve precipitation in general
- [x] Add ambient lighting
- [x] Make heating of sloped surfaces accurate
- [x] Display Solar and IR power in weather stations

# November 19, 2026:
- [x] Black screen after a successful load: texImage2D beyond MAX_TEXTURE_SIZE fails silently, and the 150% default HDR target is over that limit on some GPUs (e.g. Intel iGPUs at 4096) - the composite then rendered nothing with no message anywhere. createHdrFBO/createBloomFBOs now verify framebuffer completeness: the HDR target steps down a scale ladder (150% -> 200% -> 100% -> 85% -> ...; the ladder includes 1.5x), the bloom pyramid keeps the previous one, bloom is turned off only when no pyramid ever worked, and an exception with a visible alert is thrown only when no HDR target can exist at all; a resize that cannot recreate the target keeps the previous one. The draw loop also re-queues its next frame before doing any work and traps per-frame exceptions, so an exception inside one frame can never stop the loop - 120 consecutive failures show a visible 'stopped rendering' overlay with a reload button instead of a black tab. New tests/check-render-resilience.js (11 checks) pins the guards; tests/check-startup.js gained phase E (oversized HDR demotes instead of blacking out) and the stub now models FRAMEBUFFER_COMPLETE correctly
- [x] Lightning ultra-resolution without lagging: HDR render scale can now exceed 100% - '150%' is the new default (Extreme preset included) and '200%' is selectable in the Performance folder next to the other render scales; thin sub-pixel channels get more than one render-target sample per pixel, bloom stays at its own scale, and the LINEAR downsample in the post pass is an exact 2x2 box at 200%. Post-pass taps (neighbourhood clamp, FXAA) step by the HDR source texel instead of the canvas pixel; the TAA/motion-blur history texture (canvas-sized RGB8) is now allocated lazily; the post pass no longer clears the canvas behind its fullscreen draw. Hyperbolt camera shake raised 5x in both intensity (0.090 -> 0.450 of view height) and duration (2.5 s -> 12.5 s, decay 2.2 -> 0.44 to keep the same envelope); new Display-folder **Camera Shake** checkbox (default on) suppresses superbolt/hyperbolt shake entirely and forgets any pending shake. New tests/check-hdr-supersample.js (11 checks) pins the scale map, default, preset, dropdown, output texel contract, lazy history and the cleared canvas
- [x] Lightning sub-pixel coverage made continuous: every procedural fork/branch core (ccEvalBranch, all ten call sites) and the cloud-to-cloud main-channel core now integrate coverage over the render-target pixel with a 0.75-pixel Gaussian (channelGlow idiom, energy-normalised) instead of a fixed world-space edge that snapped sub-pixel channels to empty-or-full. Footprints come from the captured screenTexDx/Dy, so the filtering follows HDR render scale and zoom exactly; no extra pass, no resolution increase - frame cost is unchanged. tests/check-lightning-antialias.js pins the shader formula, all ten call-site footprints, numeric energy conservation (integral == bw*sqrt(pi) at every zoom), a real transition band (no 0-to-full snap) and dash-free sub-pixel shading
- [x] v2026-11-16.52's shader-retry constant was declared inside mainScript, below the hoisted loadSourceFile() that reads it — every simulation start aborted with "Cannot access 'LOAD_RETRY_DELAYS_MS' before initialization". Moved to module scope, and added tests/check-startup.js, which executes the real app.js in a sandboxed VM (stubbed DOM, WebGL2 context, network serving this checkout, fake AudioContext) and drives loadData() through the happy path, a flaky shader (retried, startup completes), a fatally failing shader (alert naming the file), and a fatally failing image (alert naming the image). It reproduces the 16.52 bug on the old build and passes on the fixed one
- [x] "Sometimes crashes on load": shader, include and image loads now get three attempts with a growing pause (a flaky fetch or a service worker 504 used to abort the start with an alert naming whichever file was unlucky, and a failed image started the sim with zero-filled textures and no message); the sim now awaits the texture uploads instead of loading them in the background; loadData is a single-flight entry point (double Start clicks used to run two mainScript() in parallel and double the GPU request); and before starting, the page asks the service worker which build it serves - a tab open across a deploy was pairing old code with the new shaders, and it now offers a reload instead of a crash on load; the worker also refuses to serve a cached index.html whose buster does not match its own VERSION
- [x] Motion blur reworked again: velocity-aware (the fluid velocity field is sampled per pixel and subtracted from the camera path), 12 raised-cosine taps, five-tap neighbourhood-clamped history, edge coverage fade, no ghost drag
- [x] Every lightning variant now has a Kelvin temperature driving its arc colour (Planckian, Tanner Helland) and a per-variant lifetime (time-stretched train shared with the slot manager): ordinary CG / IC / +IC / CC / +CC / GC / crawler / external positive; superbolt and hyperbolt keep their fictional hues
- [x] Branch counts are seeded per strike and differ by variant (CG 1-3, external positives by class, IC/+IC 0-2, -CC vs +CC, GC 3-5)
- [x] Red sprites (carrot head + 5-8 seeded tendrils + NT+ cap, stepped onset), blue jets (climbing V-fan + starter flash, ~40 km cap) and elves (thin expanding 1/r-dimmed ring) reworked on the physical picture
- [x] Precipitation falls at drag-limited terminal velocity (Clift-Gauvin sphere, exponential atmosphere, 65 mg mass unit); Fall Speed slider is now a 0.4-2.0 multiplier
- [x] All lightning channels (CG bolt, external positive CG incl. superbolt / hyperbolt, IC / +IC networks, GC leader, anvil crawler) now bend with the CC channel's fractal triangular-wave family; bounded amplitudes so no channel breaks into noise; bolt and network artwork untouched - the bend lives in how they are sampled
- [x] Reworked motion blur: shutter integral along the reprojected camera motion vector (8 taps, zoom- and shake-aware reprojection, static camera untouched); no longer a static cross-blur, no longer killed by camera moves
- [x] Fixed lightning variant scale-invariance: every world-unit constant re-expressed via lightningHeightScale() so IC/+IC networks, external CG jags, CC branches and strike lobes keep their kilometre size when horizontal/vertical resolution or simulation height change
- [x] Hyperbolt positive lightning: superbolt-class (meta.w integer 2), 720,000 K deeper blue, 30x superbolt brightness, 0.3 s lifetime, camera shake intensity 90 for 2.5 s, nested halved roll under the 7.2% external positive CG superbolt gate (~3.6%), 2.5x thunder, selectable as Artificial Lightning variant index 12; 80 TW / 120 GA nominal figures are fiction and not modelled
- [x] Super lake brush tool (WALLTYPE_SUPER_LAKE = 7, inputType 24): lake behaviour everywhere with a 5x waterEvaporation and 5x waterHeatExchangeRate for the air above, 5x entire heat budget for the body (air exchange, evaporative cooling, sun, IR), deeper rendered water colour; generated lakes unchanged; stations and save files compatible
- [x] Real Time Cycle toggle in the Radiation folder: sun advances at wall-clock speed, Accelerate Night ignored, old saves default off
- [x] Motion Blur toggle + 0-350 % strength slider in the Performance folder: post-pass long-exposure feedback (5-tap cross-blurred previous frame mixed back in after TAA and FXAA), history invalidated on view/display change and in setup mode, shares the canvas-history copy with TAA
- [x] Lightning no longer shows through opaque terrain foregrounds - wall faces and below-simulation pixels never accumulate the flash; the 45° slope triangles, urban and industrial silhouettes, and the tree/snow canopy clear what the air behind them accumulated; the rod's own corona and strike surge kept as the deliberate exception; the air band above a lake's waterline still renders the flash
- [x] Reverted the same-day GC/crawler CG-channel rewrite and the CC/IC halo smoothing after the visual regression report - the channel look is the previous one again (procedural GC spine and forks, connected crawler tendrils, slope-corrected halos)
- [x] Precise per-pixel collision detection for the flash: it is multiplied by the fragment's terrain coverage at the composite (the building/foliage texture alpha across silhouette edges, hard 1 for slope triangles and solid cells, 0 in open air), feathering the channel exactly at the silhouette instead of only clipping whole cells; the rod's light is not attenuated (separate accumulator)

# November 16, 2026:
- [x] Precipitation tool: paint rain or snow straight into the air, in any air, with droplets that wet the ground (Ctrl erases the painted precipitation field)
- [x] Artificial Lightning variant picker (12 events: ordinary CG, IC, +IC, -CC, +CC, +CG, superbolt, ground-to-cloud, anvil crawler, blue jet, red sprite, elve) via in-page option list
- [x] Rebuilt the ground-to-cloud (GC) leader as a stop-start stepped positive upward leader with advancing tip flare, conical two-generation forks and a descending hot return stroke
- [x] Rebuilt the anvil crawler as a rooted parent-IC-to-anvil-front: connected feeder tendrils, four left/right stop-start leader chains with upper/lower dendrites, parent restrike flicker, upstream cloud-gap severing and a ~1-2 km edge fringe

- [x] Still-black-screen-after-load, the sequel: the HDR/bloom completeness work in .56 was necessary but not sufficient - the fullscreen draw to the canvas never happened at all. GL draw-time sampler validation checks every statically used sampler, not just the ones the frame taps; with temporal anti-aliasing and motion blur off (the defaults) the lazy history texture does not exist, nothing re-bound unit 2, and the post pass kept pointing at the signed-integer wall texture (RGBA8I) that the HDR pass binds there for the display shader's isampler2D. The draw died with GL_INVALID_OPERATION (sampler/format mismatch), the canvas - already cleared opaque black - got nothing, every frame. Same hazard on unit 1 when every bloom target is unallocatable. The post pass now binds hdrFBO's float texture as the fallback on both units (verified end-to-end with an instrumented SwiftShader run: zero GL errors, the sky/terrain composite reaches the canvas), and tests/check-post-pass-textures.js (9 checks) pins the hazard and the fallbacks. Bonus culprit in the same path: #dropletInfoCanvas was an always-displayed 90x50 transparent box dead centre over the canvas with pointer events armed - it silently swallowed the click that starts the simulation; it now starts hidden with pointer-events:none and is shown only while following a droplet

- [x] Motion blur is now always on: the Performance-folder toggle is gone (strength 0 flattens the taps if anyone wants the bare frame), saved-off values from older settings are ignored on load, and the canvas-sized RGB8 history texture the effect shares with TAA is always allocated. Every ordinary arc (CG, IC, +IC, both CC polarities, external positive CG) and both leader types now run the same ~30,000 K blackbody (the corridor jitter survives); superbolt (52,000 K) and hyperbolt (720,000 K nominal) keep their pinned fictional hues. The five special variants were rebuilt from the observational literature: GC leaders fire in seeded step bursts with a streamer fan dragging ahead of the advancing tip, a ground-strike shock ring tears out along the surface at return and the channel re-brightens in two M-component waves after the stroke (forks are 4-6 now); red sprites render as seeded clusters of column/carrot bodies (up to two secondaries) with column cores, stalled-leader beads and forked tendril tips; elves add a brief inner NT 1P disk and a thin central EMP shaft inside the expanding 1/r rim; blue jets grow a stepped central bolt, a hot inner cone inside the outer V, and a lingering afterglow instead of an instant cutoff; anvil crawlers restrike along their established lanes root-to-tip (a hot dart that snaps the whole tree bright), sprout backward-drooping root stubble on the two parent-side nodes, and run 23,500 K at the deck junctioning to 30,000 K. tests/check-lightning-physics.js and the realtime-cycle-motion-blur suite pin the new contracts

- [x] Motion-blur strength was effectively capped: a hard inverted guard (`flowLength <= 0.05`) only let the shutter gather on near-static frames, so any real pan, zoom or superbolt shake fell straight through with zero blur, and the gather span was fixed at one frame no matter where the slider sat. The guard is gone (the horizontal seam jump is folded back into [-0.5, 0.5) uv, and only an absurd view jump is skipped), the strength slider now opens the shutter (one frame of motion at 0 %, ~2.1 at 100 %, five at 350 %), the integral runs sixteen cosine-weighted taps, and radial zoom and panning both engage at full strength

- [x] Motion blur has its Performance-folder toggle again (default on); saved-off values from older settings are respected again. The strength slider is unchanged (0 flattens the taps, 100 is a soft veil, 350 opens the shutter to five frames of gather)

- [x] Default HDR to 100% and motion blur off for fresh settings; preserve saved choices. Restore distinct discharge tints, temper bright channels and special optical effects, confine the blue-jet front, and reduce crawler/sprite rendering work during strikes. Appearance and performance still require real-GPU validation across zoom levels and overlapping events.

- [x] Preserve lightning hue before non-filmic RGB clipping, render upper-atmospheric transients inside tall domains as well as above them, retain saved and queued artificial-variant choices, and animate descending sprite tendrils. Real-GPU visual validation remains necessary.

- [x] Reproject motion blur through the previous camera, backtrace actual simulated fluid steps, and keep terrain and off-world pixels stationary in world space. Animate stepped ground leaders with upward return fronts, growing branches on CG/IC/CC channels, and independently growing blue-jet streamers. Real-GPU visual and performance validation remains necessary.

- [x] Restore lightning HDR energy before bloom, retain channel tint in the post-process highlight mapping, and rework motion-blur sampling with 24 midpoint taps and per-tap history bounds. Validate the artistic result on a real GPU; the post-process highlight mapping also changes other bright scene highlights.

- [x] Increase lightning-only emission before the bloom pyramid, including faint optical variants, without changing bloom or exposure settings. The stronger glow still needs real-GPU visual validation.

# In Progress


# Future:
- [ ] Improve Lake/Sea depth visualization, show the water depth under sim area and add 45 deg slopes underwater
- [ ] Add realistic albedo's for different surface types
- [ ] Make behaviour of precipitation scale with the vertical resolution to fix unrealistic behavior at resolution lower than 300
- [ ] Add Option to reset atmosphere while keeping terain
- [ ] Improve terain generation
- [ ] Allow editing while simulation paused
- [ ] Make precipitation work on all mobile devices
- [ ] Simulate realistic atmospheric pressure
- [ ] Add forces to simulate coriolis effect and pressure systems to make weather more dynamic
- [ ] Add sounds
- [ ] Add weather balloons
- [x] Raise pre-return CG and pre-illumination IC/CC leader emission at the stage source, rather than changing global bloom or exposure. SwiftShader buffer captures show increased leader bloom; real-GPU visual validation is still needed.

- [x] Avoid uniformly blue lightning channels by applying a stable per-strike apparent-colour variation before HDR bloom; leave upper-atmosphere emission colours separate. Validate the appearance on a real GPU.

- [x] Give discharge classes distinct apparent channel and illumination tints with stable strike variation, retaining the separate optical-event colours. Increase lightning-only HDR energy feeding bloom without changing user settings; real-GPU appearance remains unverified.

- [x] Remove upward GC, crawler, sprite, jet and elve generation, selection and rendering; preserve super-rod attraction and safely ignore legacy upward slots. Increase IC artwork resolution, retain fine coverage for remaining channels, and remove detached IC forks and the extra network warp. Correct CC distance slopes and reduce fine jaggedness. Real-GPU visual and performance validation remains needed.
