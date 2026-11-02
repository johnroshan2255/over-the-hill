import * as THREE from 'three'
import { isMobileDevice } from '../rendering/quality/DeviceProfile'
import { loadJournal, REWARD, saveJournal } from '../journal'
import { continueRequested, loadProgress, requestContinue, saveProgress } from '../save'
import { gameParams } from '../settings'
import { Menu } from '../ui/Menu'
import { installToneMap } from './toneMap'
import { Atmosphere } from './Atmosphere'
import { OthAudio } from './Audio'
import { Bridges } from './Bridges'
import { Bushes } from './Bushes'
import { Dust } from './Dust'
import { Falls } from './Falls'
import { ChaseCam } from './ChaseCam'
import { FlyCam } from './FlyCam'
import { Glow } from './Glow'
import { Grass } from './Grass'
import { Horizon } from './Horizon'
import { Landmarks } from './Landmarks'
import { MapData } from './MapData'
import { MapView } from './MapView'
import { OthPhysics } from './Physics'
import { placeThings } from './Places'
import { Props } from './Props'
import { createPaintTexture } from './noiseTex'
import { Post } from './Post'
import { Rain } from './Rain'
import { Rocks } from './Rocks'
import { pickTier } from './quality'
import { Sky } from './Sky'
import { Terrain } from './Terrain'
import { TerrainShadow } from './TerrainShadow'
import { Trees } from './Trees'
import { TyreTracks } from './TyreTracks'
import { Vehicle } from './Vehicle'
import { Water } from './Water'
import { Winch } from './Winch'

/**
 * OVERHILL — the game: its own world and renderer. Boot: tier → map data → paint texture → atmosphere, terrain, grass,
 * sky → the loop. Loaded by the title screen (../main.ts) when the player starts; `window.__oth` drives it from the
 * headless shot harness (scripts/shot.mjs).
 *
 * Switches (settings.ts `gameParams`: the menus' settings, under the page's URL): ?tier=low|medium|high|ultra
 *      ?car=gwagen|bmw ?paint=rrggbb ?gearbox=auto|manual ?aids=off|standard|full ?offroad=0|1 ?aa=0 ?scale=50…100
 *      ?sound=0 ?drive=0 (start in the free camera) ?x= &z= (m) ?h= (m above the ground) ?yaw= ?pitch= (rad) ?hour=
 *      ?tm=neutral|agx|aces ?exp= (exposure) ?stats=1
 * Keys: drive W A S D, Space handbrake, Shift boost, X / Z gears (manual), R reset, 1 / 2 the car, V free camera ⇄ the
 *      car, F3 stats, Esc pause.
 */
const q = gameParams()
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
const tier = pickTier()
const status = document.getElementById('status')!

async function boot() {
  // REVERSED-Z (the user: no Z-fighting far away): depth 1 at the near plane … 0 at the far one, in Post's 32-bit float
  // depth (Post.ts) — even precision from 0.3 m to the horizon (24-bit standard depth: ~20 cm steps at 1 km, ~7 m at
  // 6 km). three falls back to standard depth where the browser lacks EXT_clip_control. LOW draws to the canvas's
  // 24-bit depth: reversed there, no finer than before.
  // An OPAQUE canvas (2026-11-02, the user: "in the morning, evening and night a border of light on all trees"): three
  // always asks for an alpha channel, and the leaf cards' alpha-to-coverage leaves alpha < 1 at their edges — the
  // page's peach background showed through there, a light rim round every tree and bush, plainest against the dark.
  const antialias = tier.msaa && !tier.bloom
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { alpha: false, antialias, depth: true, stencil: false, powerPreference: 'high-performance' }) ?? undefined
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias, powerPreference: 'high-performance', stencil: false, reversedDepthBuffer: true })
  // (?scale=: the Resolution setting, a fixed share of the full pixel ratio)
  renderer.setPixelRatio(Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100)
  renderer.setSize(innerWidth, innerHeight)
  const tm = q.get('tm') ?? 'neutral-hue'
  // (the default: Neutral with a hue-keeping toe — toneMap.ts; ?tm=neutral the original, ?tm=aces / agx)
  installToneMap()
  renderer.toneMapping = tm === 'aces' ? THREE.ACESFilmicToneMapping : tm === 'agx' ? THREE.AgXToneMapping : tm === 'neutral' ? THREE.NeutralToneMapping : THREE.CustomToneMapping
  renderer.toneMappingExposure = num('exp', 1.0)
  renderer.info.autoReset = false
  document.body.appendChild(renderer.domElement)

  status.textContent = 'Loading the valley…'
  const map = await MapData.load('/oth/valley', (f) => (status.textContent = `Loading the valley… ${Math.round(f * 100)}%`))
  const noise = createPaintTexture()
  const atmos = new Atmosphere(noise)
  atmos.uniforms.uFogRange.value.set(tier.fogNear, tier.haze)
  atmos.hazeLen = tier.haze
  atmos.hour = num('hour', 15.5)
  // ?time=0 stops the clock (the shot harness); [ / ] an hour back / on, T stops / starts it
  if (q.get('time') === '0') atmos.dayMinutes = 0
  const runMinutes = num('day', 24)
  if (atmos.dayMinutes) atmos.dayMinutes = runMinutes
  window.addEventListener('keydown', (e) => {
    if (e.code === 'BracketRight') atmos.hour = (atmos.hour + 1) % 24
    if (e.code === 'BracketLeft') atmos.hour = (atmos.hour + 23) % 24
    if (e.code === 'KeyT') atmos.dayMinutes = atmos.dayMinutes ? 0 : runMinutes
    if (e.code === 'KeyK') toast(`Weather: ${atmos.stepWeather()}`)
    // G: the next time of day (morning → noon → evening → night); Shift + G: the next weather (2026-11-02, the user)
    if (e.code === 'KeyG') {
      if (e.shiftKey) toast(`Weather: ${atmos.stepWeather()}`)
      else {
        const P: [number, string][] = [[6.5, 'Morning'], [12, 'Noon'], [17.5, 'Evening'], [21.5, 'Night']]
        const next = P.find(([t]) => t > atmos.hour + 0.25) ?? P[0]
        atmos.hour = next[0]
        toast(`Time · ${next[1]}`)
      }
    }
  })
  // ?weather=clear|cloudy|rain pins the weather (settled at once: the shot harness)
  const wq = q.get('weather')
  if (wq === 'clear' || wq === 'cloudy' || wq === 'rain') { atmos.weather = wq; atmos.settleWeather() }

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, num('far', tier.far)) // (?far= m: cost tests)
  const scene = new THREE.Scene()
  const shadow = new TerrainShadow(map)
  let shadowReady = false
  shadow.onBaked = () => (shadowReady = true)
  const terrain = new Terrain(map, atmos, tier, shadow)
  const rocks = new Rocks(map, atmos, shadow, tier, terrain.uniforms.uFarGrid.value)
  const grass = new Grass(map, atmos, terrain, tier, rocks.footprint)
  const water = new Water(map, atmos, terrain, tier, rocks.footprint)
  const falls = new Falls(map, atmos)
  const sky = new Sky(atmos, !!tier.bloom) // (the sky marks itself for the god rays when Post draws)
  const trees = new Trees(map, atmos, shadow, tier, rocks)
  trees.bakeImpostors(renderer)
  const bushes = new Bushes(map, atmos, shadow, tier, rocks, trees.leafTexture)
  // OCCLUSION CULLING: what the hills hide (trees, rocks, bushes behind them are skipped); ?occlusion=0 turns it off
  const horizon = new Horizon(map, Math.max(tier.treeReach, tier.rockReach))
  horizon.enabled = q.get('occlusion') !== '0'
  trees.horizon = rocks.horizon = bushes.horizon = terrain.horizon = horizon
  const bridges = new Bridges(map, atmos, shadow, tier, terrain.uniforms.uFarGrid.value)
  const rain = new Rain(atmos, tier)
  // without the post pass: the bloom and the god rays painted forward (Glow.ts)
  const glow = tier.bloom ? null : new Glow(map, atmos)
  atmos.uniforms.uGlow.value = glow ? 1 : 0
  if (glow) scene.add(glow.group)
  // THE VALLEY'S SMALL THINGS (Places.ts picks where, seeded): the CAMPS join the landmarks (built, found, on the map
  // like them); the signposts, tables, fences, log piles, cairns, trucks, supply crates and fireflies are Props.ts
  const places = placeThings(map, rocks, trees)
  const allPlaces = (map.meta.landmarks = [...(map.meta.landmarks ?? []), ...places.camps])
  const landmarks = new Landmarks(map, atmos, shadow, tier, terrain.uniforms.uFarGrid.value)
  const journal = loadJournal()
  landmarks.onDiscover = (l, n, total) => {
    const pay = l.kind === 'camp' ? REWARD.camp : REWARD.place
    journal.coins += pay
    saveJournal(journal)
    readouts.coins(journal.coins, pay)
    toast(`Discovered · ${l.name}   +${pay} ◆   ${n} / ${total}`, 4200)
    audio.chime('place')
  }
  const props = new Props(places.props, allPlaces, places.swarms, atmos, shadow, tier, terrain.uniforms.uFarGrid.value, journal.crates, rocks.footprint, map.inner)
  journal.totals = { crates: props.crateCount, places: allPlaces.length }
  saveJournal(journal)
  landmarks.horizon = bridges.horizon = falls.horizon = props.horizon = horizon
  scene.add(props.group)
  scene.add(landmarks.group, terrain.mesh, grass.group, rocks.group, trees.group, bushes.group, water.group, falls.group, bridges.group, sky.mesh, rain.mesh)

  // THE 4×4: the game's vehicle physics on this map's ground and rocks
  status.textContent = 'Loading the 4×4…'
  const physics = await OthPhysics.create(map, rocks)
  physics.trees = trees
  physics.addLandmarks(landmarks.colliders)
  physics.addPropColliders(props.colliders)
  const car = new Vehicle(map, physics, atmos, shadow, tier, terrain.uniforms.uFarGrid.value)
  if (q.get('paint')) car.paint = '#' + q.get('paint')!.replace('#', '')
  // the GARAGE's driving settings
  car.driving = {
    manual: q.get('gearbox') === 'manual',
    aids: q.get('aids') === 'off' || q.get('aids') === 'standard' ? q.get('aids') as 'off' | 'standard' : 'full',
    offroadAssist: q.get('offroad') !== '0',
  }
  // CONTINUE (the title screen, APPLY & RESTART): back where the journey was saved, at its time of day
  const saved = continueRequested() ? loadProgress() : null
  requestContinue(false)
  if (saved && saved.map === map.meta.id) {
    car.spawnAt = { x: saved.x, z: saved.z, heading: saved.heading }
    if (!q.has('hour')) atmos.hour = saved.hour
  }
  await car.setCar(q.get('car') ?? 'gwagen')
  scene.add(car.root, car.shadowMesh)
  // the tyres' dust and the exhaust smoke
  const dust = new Dust(map, atmos, tier)
  scene.add(dust.mesh)
  const tyreTracks = new TyreTracks(map, tier)
  scene.add(tyreTracks.mesh)
  const winch = new Winch(map, car, trees, rocks)
  winch.onMessage = (m) => toast(m)
  scene.add(winch.mesh)
  const mapView = new MapView(map, landmarks, camera, () => car.pos, () => car.sim?.heading ?? 0)
  const chase = new ChaseCam(camera, map, car, renderer.domElement)
  chase.snap()
  let driving = q.get('drive') !== '0'

  const fly = new FlyCam(camera, map, renderer.domElement)
  const sp = map.meta.spawn
  fly.place(num('x', sp.x), num('z', sp.z), num('h', 1.7), num('yaw', sp.yaw), num('pitch', -0.04))
  // V: the free camera (from where the chase camera is) ⇄ back in the car
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV') return
    driving = !driving
    if (!driving) {
      const d = camera.getWorldDirection(new THREE.Vector3())
      fly.place(camera.position.x, camera.position.z, camera.position.y - map.height(camera.position.x, camera.position.z), Math.atan2(-d.x, -d.z), Math.asin(d.y))
    } else chase.snap()
  })
  const ui = driveUi(car)
  // SOUND: the engine, the tyres, the music and the valley's ambience (starts on the first key / tap — Audio.ts)
  const audio = new OthAudio(map, car, atmos)
  const readouts = gameHud(journal.coins)
  if (q.get('sound') === '0') audio.muted = true
  fullscreenButton()
  // ZOOM buttons (+ / −): the chase camera's distance while driving, the field of view in the free camera
  zoomButtons((k) => {
    if (driving) chase.zoom(k)
    else { camera.fov = THREE.MathUtils.clamp(camera.fov * k, 18, 80); camera.updateProjectionMatrix() }
  })

  const post = tier.bloom ? new Post(num('levels', tier.bloom), num('samples', tier.samples), num('bloom', 0.42), num('rays', 2.0), tier.bloomStart, tier.rayDiv) : null // (?levels= ?samples= ?rays=0: cost tests)
  const baseDpr = Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100 // (?maxdpr=: the pixel-ratio cap, cost tests)
  let dprScale = 1, dprT = performance.now() + 4000
  // (phones only: on a PC / laptop the resolution never drops — the user: "don't reduce resolution automatically, turn it
  //  off on PC / laptop"; ?adaptive=1 forces it on, ?dpr=fixed / ?adaptive=0 off)
  const adaptive = q.get('adaptive') === '1' || (isMobileDevice() && q.get('dpr') !== 'fixed' && q.get('adaptive') !== '0')
  const size = () => post?.setSize(Math.round(innerWidth * renderer.getPixelRatio()), Math.round(innerHeight * renderer.getPixelRatio()))
  size()
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight)
    size()
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  })

  // stats: frame / CPU / GPU ms (timer query where the browser has it), draws, triangles
  const gl = renderer.getContext() as WebGL2RenderingContext
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  let query: WebGLQuery | null = null
  let gpuMs = 0, cpuMs = 0, frameMs = 16.7, last = performance.now()
  const hud = document.getElementById('hud')!
  let showHud = q.get('stats') === '1'
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') { showHud = !showHud; e.preventDefault() } })
  let hudT = 0

  const clock = new THREE.Clock()
  // the view's frustum, once a frame: the car, its dust (their own tests — three's cull is off for the moving parts)
  const viewPV = new THREE.Matrix4(), view = new THREE.Frustum()

  // THE JOURNEY (save.ts): metres driven and seconds played add up over every session; saved every 20 s, when the page
  // is hidden or closed, and from the pause menu — at the car's last SAFE spot (on its wheels on the ground, out of
  // the water), so CONTINUE never starts it in a river or upside down
  let travelled = saved?.travelled ?? 0, playSeconds = saved?.playSeconds ?? 0, saveT = 0
  const safe = { x: Number.NaN, z: 0, heading: 0 }
  // the player's own camp (pitched with C), back where it was
  let myCamp: { x: number; y: number; z: number; rot: number } | null = saved?.camp ?? null
  if (myCamp) props.pitch(myCamp)
  const lastPos = new THREE.Vector3().copy(car.pos)
  const save = () => {
    if (Number.isNaN(safe.x)) return
    saveProgress({ v: 1, map: map.meta.id, car: car.id, x: safe.x, z: safe.z, heading: safe.heading, hour: atmos.hour, travelled, playSeconds, savedAt: Date.now(), camp: myCamp })
  }
  addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => { if (document.hidden) save() })

  // PAUSE (Esc, or the ❚❚ button): the frame stops entirely — no physics, no clock, no drawing (the last picture stays
  // on screen under the menu): a paused game costs nothing
  let pause: Menu | null = null
  const setPaused = (on: boolean) => {
    if (on === !!pause) return
    if (on) {
      save()
      pause = new Menu('pause', {
        onResume: () => setPaused(false),
        onRestart: () => { save(); requestContinue(true); location.reload() },
        onQuit: () => { save(); requestContinue(false); location.href = location.pathname },
      })
    } else {
      pause?.close()
      pause = null
      clock.getDelta() // (no jump: the paused time never reaches the physics)
      last = performance.now()
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || pause || document.querySelector('.oth-map.on')) return
    e.preventDefault()
    setPaused(true)
  })
  pauseButton(() => setPaused(true))

  // CAMPING (C, or the CAMP button): stopped on your wheels, on dry ground — at a campsite (≤ 22 m) you rest there,
  // by your own camp you rest at it, anywhere else you PITCH one beside the car. Resting skips to the hour you pick
  // (or waits out the weather) behind a fade, and saves the journey (a checkpoint)
  const campSites = allPlaces.filter((l) => l.kind === 'camp')
  const campHere = (): { name: string; own: boolean } | null => {
    const p = car.pos
    const site = campSites.find((l) => (l.x - p.x) ** 2 + (l.z - p.z) ** 2 < 22 * 22)
    if (site) return { name: site.name, own: false }
    if (myCamp && (myCamp.x - p.x) ** 2 + (myCamp.z - p.z) ** 2 < 25 * 25) return { name: 'Your camp', own: true }
    return null
  }
  const canCamp = () => driving && !!car.sim && car.speedKmh < 3 && car.grounded() && map.waterLevel(car.pos.x, car.pos.z) === null
  const closeMenu = () => {
    pause?.close()
    pause = null
    clock.getDelta()
    last = performance.now()
  }
  const rest = (apply: () => void) => {
    closeMenu()
    fadeThrough(() => { apply(); atmos.update(camera.position, clock.elapsedTime); save(); toast('Rested · progress saved') })
  }
  const openCamp = () => {
    if (pause || !canCamp()) return
    let here = campHere()
    if (!here) {
      // pitch it beside the car (its right, else its left), facing the car
      const h = car.sim!.heading, p = car.pos
      const spot = [4.6, -4.6].map((side) => [p.x + Math.cos(h) * side, p.z - Math.sin(h) * side]).find(([x, z]) => map.waterLevel(x, z) === null) ?? [p.x, p.z]
      myCamp = { x: spot[0], y: map.height(spot[0], spot[1]), z: spot[1], rot: h + Math.PI / 2 }
      props.pitch(myCamp)
      toast('Camp pitched · progress saved')
      here = { name: 'Your camp', own: true }
    }
    save()
    const wet = atmos.uniforms.uRain.value > 0.05 || atmos.uniforms.uCloud.value > 0.55
    pause = new Menu('camp', {
      heading: here.name,
      onResume: closeMenu,
      items: [
        { label: 'Rest until sunrise', note: '06:30', go: () => rest(() => (atmos.hour = 6.5)) },
        { label: 'Rest until noon', note: '12:00', go: () => rest(() => (atmos.hour = 12)) },
        { label: 'Rest until evening', note: '17:30', go: () => rest(() => (atmos.hour = 17.5)) },
        { label: 'Rest until night', note: '21:30', go: () => rest(() => (atmos.hour = 21.5)) },
        ...(wet ? [{ label: 'Wait out the weather', note: 'clear skies', go: () => rest(() => atmos.clearSky()) }] : []),
        ...(here.own ? [{ label: 'Pack up camp', go: () => { myCamp = null; props.pitch(null); save(); closeMenu(); toast('Camp packed up') } }] : []),
        { label: 'Back on the road', go: closeMenu },
      ],
    })
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat) openCamp() })
  readouts.onCamp(openCamp)
  // the SIGNPOST you've stopped by (≤ 15 m): its boards — the nearest places, which way (from where you look) and how far
  const signHud = () => {
    const s = driving ? props.signNear(car.pos.x, car.pos.z, 15) : null
    if (!s) { readouts.sign(null); return }
    camera.getWorldDirection(signDir)
    const head = Math.atan2(signDir.x, -signDir.z)
    const near = allPlaces.map((l) => ({ l, d: Math.hypot(l.x - s.x, l.z - s.z) })).filter((o) => o.d > 60).sort((a, b) => a.d - b.d).slice(0, 4)
    readouts.sign(near.map(({ l, d }) => ({ name: l.name, d, turn: Math.atan2(l.x - s.x, -(l.z - s.z)) - head })))
  }
  const signDir = new THREE.Vector3()
  let hudTick = 0

  const frame = () => {
    if (pause) { requestAnimationFrame(frame); return }
    const now = performance.now()
    frameMs += (now - last - frameMs) * 0.1
    // ADAPTIVE RESOLUTION, phones (PlayCanvas guidelines: device pixel ratio at runtime): once a second, a slow frame
    // (> 19 ms ≈ under 52 fps) lowers the pixel ratio 15 % (down to half the tier's), a fast one (< 12.5 ms) raises
    // it back — the look stays, only the sharpness gives. ?dpr=fixed turns it off.
    if (adaptive && now - dprT > 1000) {
      dprT = now
      const k = frameMs > 19 ? 0.85 : frameMs < 12.5 ? 1.08 : 1
      const next = Math.min(1, Math.max(0.5, dprScale * k))
      if (Math.abs(next - dprScale) > 0.02) {
        dprScale = next
        renderer.setPixelRatio(baseDpr * dprScale)
        size()
      }
    }
    last = now
    const dt = Math.min(clock.getDelta(), 0.1)
    car.wet = dust.wet = atmos.uniforms.uWet.value
    physics.pw.advance(dt, (fdt) => { car.fixed(fdt); winch.fixed(fdt) })
    car.update(physics.pw.alpha)
    // the journey: distance driven (not the jumps of a reset / a car change), the last safe spot, the autosave
    playSeconds += dt
    const moved = Math.hypot(car.pos.x - lastPos.x, car.pos.z - lastPos.z)
    if (moved < 5) travelled += moved
    lastPos.copy(car.pos)
    if (car.sim && car.grounded() && map.waterLevel(car.pos.x, car.pos.z) === null) { safe.x = car.pos.x; safe.z = car.pos.z; safe.heading = car.sim.heading }
    if ((saveT += dt) > 20) { saveT = 0; save() }
    // the supply crates the car reaches
    const got = props.pickUp(dt, car.pos.x, car.pos.y, car.pos.z)
    if (got.length) {
      for (const id of got) journal.crates.push(id)
      journal.coins += REWARD.crate * got.length
      saveJournal(journal)
      readouts.coins(journal.coins, REWARD.crate * got.length)
      toast(`Supply crate · +${REWARD.crate * got.length} ◆   ${journal.crates.length} / ${props.crateCount}`)
      audio.chime('crate')
    }
    // the HUD's slow parts (4× a second): the signpost, the camp prompt
    if ((hudTick += dt) > 0.25) { hudTick = 0; signHud(); const c = canCamp() ? campHere() : null; readouts.camp(canCamp() ? (c ? `Rest at ${c.name}` : 'Pitch camp') : null) }
    dust.update(dt, car)
    tyreTracks.update(car, clock.elapsedTime)
    car.lights(atmos, dt)
    if (driving) chase.update(dt)
    else fly.update(dt)
    ui.update(driving, atmos.clock)
    audio.update(dt, camera)
    atmos.tick(dt)
    atmos.update(camera.position, clock.elapsedTime)
    props.fireLight(camera.position, clock.elapsedTime, atmos.uniforms.uLamps.value, atmos.uniforms.uFire.value)
    rain.update()
    glow?.update(camera, dt)
    landmarks.update(dt, car.pos.x, car.pos.z)
    mapView.update(dt)
    winch.update(camera)
    shadow.update(atmos.uniforms.uSunDir.value)
    const t0 = performance.now()
    horizon.update(camera.position)
    terrain.update(camera)
    grass.update(camera)
    rocks.update(camera)
    trees.update(camera)
    bushes.update(camera)
    props.update(camera)
    // (what's out of view or behind the hills isn't drawn: 2026-11-02)
    viewPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    view.setFromProjectionMatrix(viewPV, THREE.WebGLCoordinateSystem, camera.reversedDepth)
    car.cull(view, horizon)
    dust.cull(view, horizon)
    tyreTracks.cull(camera.position, clock.elapsedTime)
    landmarks.cull()
    bridges.cull()
    falls.cull()
    if (timer && query) {
      const ready = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
      if (ready && !gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs += (gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 - gpuMs) * 0.15
      if (ready) { gl.deleteQuery(query); query = null }
    }
    let started = false
    if (timer && !query) { query = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, query!); started = true }
    renderer.info.reset()
    if (post) post.render(renderer, scene, camera, atmos.uniforms.uSunDir.value)
    else renderer.render(scene, camera)
    if (started) gl.endQuery(timer!.TIME_ELAPSED_EXT)
    cpuMs += (performance.now() - t0 - cpuMs) * 0.1
    if (showHud && now - hudT > 250) {
      hudT = now
      hud.style.display = 'block'
      const p = camera.position
      hud.textContent = `${tier.name.toUpperCase()}  res ${Math.round(dprScale * 100)}%  ${(1000 / frameMs).toFixed(0)} fps  frame ${frameMs.toFixed(1)} ms  cpu ${cpuMs.toFixed(2)} ms  gpu ${timer ? gpuMs.toFixed(2) : '–'} ms\n` +
        `draws ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k  patches ${terrain.patches}  blades ${(grass.blades / 1000).toFixed(0)}k  trees ${trees.drawn.join('/')} of ${trees.count}  culled: trees ${trees.occluded} tiles behind hills, rocks ${rocks.culled.frustum} off-view / ${rocks.culled.occluded} hidden cells, ${rocks.culled.small} tiny\n` +
        `x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} y ${p.y.toFixed(0)} (agl ${(p.y - map.height(p.x, p.z)).toFixed(1)})  yaw ${fly.yaw.toFixed(2)} pitch ${fly.pitch.toFixed(2)}  hour ${atmos.hour.toFixed(1)}`
    } else if (!showHud) hud.style.display = 'none'
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  status.remove()
  dispatchEvent(new Event('overhill:started')) // (the title screen closes)

  // the shot harness
  ;(window as unknown as { __oth: unknown }).__oth = {
    get ready() { return shadowReady },
    tier: tier.name,
    props,
    journal,
    openCamp,
    placesMs: places.ms,
    view: (x: number, z: number, h: number, yaw: number, pitch: number) => { driving = false; fly.place(x, z, h, yaw, pitch) },
    car,
    rain,
    winch,
    tyreTracks,
    scene,
    camera,
    post,
    atmos,
    /** The sound's state (Audio.ts debug). */
    audio: () => audio.debug(),
    /** Drive mode on / off (the chase camera). */
    drive: (on: boolean) => { driving = on; if (on) chase.snap() },
    setHour: (h: number) => { atmos.hour = h; atmos.update(camera.position, 0) },
    sunDir: () => atmos.uniforms.uSunDir.value.toArray(),
    stats: () => ({ fps: 1000 / frameMs, cpuMs, gpuMs, draws: renderer.info.render.calls, tris: renderer.info.render.triangles, patches: terrain.patches, blades: grass.blades, rocks: rocks.count, trees: trees.drawn.slice(), bushes: bushes.drawn.slice(), culled: { terrainPatches: terrain.occluded, treeTiles: trees.occluded, rocks: { ...rocks.culled }, horizonBuilds: horizon.builds }, pos: camera.position.toArray().map((v) => +v.toFixed(1)), ground: +map.height(camera.position.x, camera.position.z).toFixed(1) }),
    height: (x: number, z: number) => map.height(x, z),
    rockNear: (x: number, z: number, r: number) => rocks.biggestNear(x, z, r),
    treeNear: (x: number, z: number, r: number, species: number, minH: number) => trees.nearest(x, z, r, species, minH),
    /** The densest broadleaf grove within r of (x, z) (≥ n trees of species ≥ 3 within 25 m of its centre). */
    grove: (x: number, z: number, r: number, n: number) => {
      const d = trees.data, S = 8
      let best: [number, number] | null = null, bc = 0
      for (let i = 0; i < trees.count; i++) {
        const o = i * S
        if (d[o + 5] < 3 || (d[o] - x) ** 2 + (d[o + 2] - z) ** 2 > r * r) continue
        let c = 0
        for (let k = 0; k < trees.count; k++) { const q = k * S; if (d[q + 5] >= 3 && (d[q] - d[o]) ** 2 + (d[q + 2] - d[o + 2]) ** 2 < 625) c++ }
        if (c > bc) { bc = c; best = [d[o], d[o + 2]] }
      }
      return bc >= n ? { x: best![0], z: best![1], count: bc } : null
    },
    /** A camera spot near (x, z) whose ground for 4–45 m ahead (yaw) is all `kind` ('gold' / 'green' meadow): no rock,
     *  water, track or forest, no tree in the way. */
    findSpot: (kind: string, x: number, z: number, yaw: number) => {
      const mk: [number, number, number, number] = [0, 0, 0, 0]
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
      const ok = (px: number, pz: number) => {
        map.maskAt(px, pz, mk)
        if (mk[0] > 0.2 || mk[2] > 0.5 || mk[3] > 0.25 || map.trailDist(px, pz) < 5) return false
        return kind === 'gold' ? mk[1] > 0.72 : mk[1] < 0.25
      }
      for (let r = 0; r < 1500; r += 25) for (let a = 0; a < 16; a++) {
        const cx = x + Math.cos((a / 16) * 6.283) * r, cz = z + Math.sin((a / 16) * 6.283) * r
        let good = true
        for (let d = 0; d <= 45 && good; d += 5) for (const sd of [-12, 0, 12]) {
          if (!ok(cx + fx * d - fz * sd * (d / 45), cz + fz * d + fx * sd * (d / 45))) { good = false; break }
        }
        if (good && trees.clearLine(cx, cz, cx + fx * 60, cz + fz * 60, 9)) return [cx, cz]
      }
      return null
    },
    clearLineTrees: (ax: number, az: number, bx: number, bz: number, r: number) => trees.clearLine(ax, az, bx, bz, r),
    treeShot: (x: number, z: number, species: number, minH: number, dist: number, yaw: number) => trees.clearShot(x, z, species, minH, dist, yaw),
    rockShot: (x: number, z: number, r: number, dist: number, yaw: number) => {
      for (const k of rocks.candidates(x, z, r)) {
        const d = k.s * dist, cx = k.x + Math.sin(yaw) * d, cz = k.z + Math.cos(yaw) * d
        if (trees.clearLine(cx, cz, k.x, k.z, 7)) return { ...k, cx, cz }
      }
      return null
    },
    /** Stand on dirt track i at fraction t (0..1) of its length, looking along it. */
    trailView: (i: number, t: number, h: number, pitch: number) => {
      const L = map.meta.trails.lines[i % map.meta.trails.lines.length]
      const k = Math.min(L.length - 4, Math.max(0, Math.round(t * (L.length - 1))))
      const [x, z] = L[k], [x2, z2] = L[k + 3]
      driving = false
      fly.place(x, z, h, Math.atan2(-(x2 - x), -(z2 - z)), pitch)
    },
    map,
  }
}

/**
 * FULL SCREEN (top-left ⛶, on phones and desktop): the Fullscreen API on the page, then landscape locked where the
 * browser allows it (Android Chrome). iPhone Safari has no Fullscreen API for pages — there the button explains
 * "Share → Add to Home Screen", which opens the game full screen (oth.html is web-app capable).
 */
/** + / − (top left, under the full-screen button): zoom in / out; held down, it keeps zooming. */
function zoomButtons(zoom: (k: number) => void): void {
  const box = document.createElement('div')
  box.className = 'oth-zoom'
  for (const [label, k, title] of [['+', 0.86, 'Zoom in'], ['−', 1.16, 'Zoom out']] as const) {
    const b = document.createElement('button')
    b.textContent = label
    b.title = title
    let timer = 0
    const stop = () => { clearInterval(timer); timer = 0 }
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation()
      zoom(k)
      stop()
      timer = window.setInterval(() => zoom(Math.pow(k, 0.5)), 90)
    })
    b.addEventListener('pointerup', stop)
    b.addEventListener('pointerleave', stop)
    b.addEventListener('pointercancel', stop)
    box.appendChild(b)
  }
  document.body.appendChild(box)
}

/** The game's HUD readouts: COINS (top right — they pop when they change), the SIGNPOST's boards, the CAMP prompt (and
 *  on touch screens its round button). DOM written only when something changes (4× a second at most). */
function gameHud(coins0: number) {
  const coins = document.createElement('div')
  coins.className = 'oth-coins'
  coins.textContent = `${coins0} ◆`
  const sign = document.createElement('div')
  sign.className = 'oth-sign'
  const prompt = document.createElement('div')
  prompt.className = 'oth-prompt'
  const campBtn = document.createElement('button')
  campBtn.className = 'oth-campbtn'
  campBtn.textContent = 'CAMP'
  document.body.append(coins, sign, prompt, campBtn)
  let signKey = '', promptText: string | null = 'x'
  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  return {
    coins(n: number, delta: number) {
      coins.textContent = `${n} ◆`
      coins.dataset.d = `+${delta}`
      coins.classList.remove('pop')
      void coins.offsetWidth // (restart the animation)
      coins.classList.add('pop')
    },
    sign(rows: { name: string; d: number; turn: number }[] | null) {
      const html = rows ? '<b>Signpost</b>' + rows.map((r) => {
        const a = ((Math.round(r.turn / (Math.PI / 4)) % 8) + 8) % 8
        return `<div><i>${ARROWS[a]}</i>${r.name}<span>${r.d < 1000 ? `${Math.round(r.d / 10) * 10} m` : `${(r.d / 1000).toFixed(1)} km`}</span></div>`
      }).join('') : ''
      if (html === signKey) return
      signKey = html
      sign.innerHTML = html
      sign.classList.toggle('on', !!rows)
    },
    camp(text: string | null) {
      if (text === promptText) return
      promptText = text
      prompt.innerHTML = text ? `<kbd>C</kbd>${text}` : ''
      prompt.classList.toggle('on', !!text)
      campBtn.classList.toggle('on', !!text)
    },
    onCamp(f: () => void) {
      campBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); f() })
    },
  }
}

/** Fade to black, do `mid`, fade back (a rest at camp). */
function fadeThrough(mid: () => void): void {
  const f = document.createElement('div')
  f.className = 'oth-fade'
  f.textContent = 'Resting…'
  document.body.appendChild(f)
  requestAnimationFrame(() => f.classList.add('on'))
  setTimeout(() => { mid(); f.classList.remove('on'); setTimeout(() => f.remove(), 700) }, 900)
}

/** The pause button (touch screens have no Esc): top right, under the reset pad's column. */
function pauseButton(pause: () => void): void {
  const b = document.createElement('button')
  b.className = 'oth-pausebtn'
  b.title = 'Pause (Esc)'
  b.textContent = 'II'
  b.addEventListener('click', (e) => { e.stopPropagation(); pause() })
  document.body.appendChild(b)
}

function fullscreenButton(): void {
  const b = document.createElement('button')
  b.className = 'oth-fs'
  b.title = 'Full screen'
  b.textContent = '⛶'
  document.body.appendChild(b)
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  const can = !!(el.requestFullscreen || el.webkitRequestFullscreen)
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  if (standalone) { b.remove(); return }
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!can) {
      alert('On iPhone: tap Share → "Add to Home Screen", then open it from the home screen — it runs full screen.')
      return
    }
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) await document.exitFullscreen()
      else doc.webkitExitFullscreen?.()
      return
    }
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else el.webkitRequestFullscreen?.()
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await o?.lock?.('landscape').catch(() => {})
    } catch { /* (the browser refused: nothing to do) */ }
  })
}

/** The driving HUD (speed, gear, keys) and, on touch screens, the pedals and steering buttons. */
function driveUi(car: Vehicle): { update: (driving: boolean, time: string) => void } {
  const box = document.createElement('div')
  box.id = 'drive'
  box.innerHTML = '<div class="spd"><b>0</b><span>km/h</span><i></i><em></em></div><div class="help">W A S D drive · Space handbrake · Shift boost · X Z gears · E winch · C camp · R reset · Tab map · G time · Shift+G weather · V free camera · Esc pause</div>'
  document.body.appendChild(box)
  const spd = box.querySelector('b')!, gear = box.querySelector('i')!, clk = box.querySelector('em')!, help = box.querySelector('.help') as HTMLElement
  const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches
  if (touch) {
    // TOUCH: round thumb pads in the corners, the rest of the HUD small and out of the way (index.html, body.touch):
    // the game gets the screen
    document.body.classList.add('touch')
    help.style.display = 'none'
    const pad = document.createElement('div')
    pad.className = 'oth-touch'
    pad.innerHTML = '<button data-k="left">◀</button><button data-k="right">▶</button><button data-k="reset">⟲</button><button data-k="brake">BRAKE</button><button data-k="gas">GAS</button><button data-k="winch">WINCH</button>' +
      (car.driving.manual ? '<button data-k="up" data-key="KeyX">▲</button><button data-k="down" data-key="KeyZ">▼</button>' : '')
    document.body.appendChild(pad)
    // (one-shot pads — the winch, the manual gears — press the key they stand for)
    const tap = (code: string) => (e: Event) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { code })) }
    for (const b of pad.querySelectorAll('button')) {
      if (b.dataset.k === 'winch') { b.addEventListener('pointerdown', tap('KeyE')); continue }
      if (b.dataset.key) { b.addEventListener('pointerdown', tap(b.dataset.key)); continue }
      const k = b.dataset.k as keyof Vehicle['touch'] | 'reset'
      const on = (v: number) => (e: Event) => { e.preventDefault(); if (k === 'reset') { if (v) car.reset() } else car.touch[k] = v }
      b.addEventListener('pointerdown', on(1)); b.addEventListener('pointerup', on(0)); b.addEventListener('pointercancel', on(0)); b.addEventListener('pointerleave', on(0))
    }
  }
  return {
    update: (driving, time: string) => {
      box.style.display = driving ? 'block' : 'none'
      spd.textContent = car.speedKmh.toFixed(0)
      gear.textContent = car.gear
      clk.textContent = time
    },
  }
}

boot().catch((e) => {
  status.textContent = `Failed: ${e?.message ?? e}`
  console.error(e)
})

/** A short message at the top of the screen (the weather, a discovery), fading out after a few seconds. */
let toastEl: HTMLDivElement | null = null, toastT = 0
export function toast(msg: string, ms = 2600): void {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'oth-toast'; document.body.appendChild(toastEl) }
  toastEl.textContent = msg
  toastEl.classList.add('on')
  clearTimeout(toastT)
  toastT = window.setTimeout(() => toastEl!.classList.remove('on'), ms)
}
