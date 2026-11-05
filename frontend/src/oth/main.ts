import * as GFX from './gfx'
import { isMobileDevice } from '../rendering/quality/DeviceProfile'
import { loadJournal, REWARD, saveJournal } from '../journal'
import { type Camp, continueRequested, loadProgress, requestContinue, saveProgress } from '../save'
import { gameParams } from '../settings'
import { Menu } from '../ui/Menu'
import { Atmosphere } from './Atmosphere'
import { Bike } from './Bike'
import mtbUrl from '../assets/models/vehicles/mtb.glb?url'
import { MtbSim } from '../gameplay/vehicle/MtbSim'
import { OthAudio } from './Audio'
import { Dust } from './Dust'
import { ChaseCam } from './ChaseCam'
import { Chart } from './Chart'
import { Crossing } from './Crossing'
import { DESERT_IDS } from './Places'
import { FlyCam } from './FlyCam'
import { MapData } from './MapData'
import { MapView } from './MapView'
import { Guide, Obstacles } from './Nav'
import { OthPhysics } from './Physics'
import { group, Groups } from '../physics/PhysicsWorld'
import { createPaintTexture } from './noiseTex'
import { Rain } from './Rain'
import { pickTier } from './quality'
import { Radar } from './Radar'
import { Sky } from './Sky'
import { TerrainShadow } from './TerrainShadow'
import { TREE_STRIDE } from './Trees'
import { TyreTracks } from './TyreTracks'
import { Vehicle } from './Vehicle'
import { Winch } from './Winch'
import { liveMap, World, type WorldEnv, type WorldId, WORLDS } from './World'

/**
 * OVERHILL — the game: its own world and renderer. Boot: tier → map data → paint texture → atmosphere, terrain, grass,
 * sky → the loop. Loaded by the title screen (../main.ts) when the player starts; `window.__oth` drives it from the
 * headless shot harness (scripts/shot.mjs).
 *
 * Switches (settings.ts `gameParams`: the menus' settings, under the page's URL): ?tier=low|medium|high|ultra
 *      ?car=gwagen|bmw ?paint=rrggbb ?gearbox=auto|manual ?aids=off|standard|full ?offroad=0|1 ?aa=0 ?scale=50…100
 *      ?sound=0 ?drive=0 (start in the free camera) ?x= &z= (m) ?h= (m above the ground) ?yaw= ?pitch= (rad) ?hour=
 *      ?tm=neutral|agx|aces ?exp= (exposure) ?stats=1 ?world=valley|desert ?weather=clear|cloudy|rain|sandstorm
 *      ?save=0 (a test session: the journey and the journal never written)
 * Keys: drive W A S D, Space handbrake, Shift boost, X / Z gears (manual), R reset, 1 / 2 the car, V free camera ⇄ the
 *      car, F3 stats, Esc pause.
 */
const q = gameParams()
/** ?save=0: a session that never writes the journey or the journal (tests in a real browser: a test drive must not
 *  overwrite the player's saved progress — 2026-11-02, it did) */
const saving = q.get('save') !== '0'
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
const tier = pickTier()
const status = document.getElementById('status')!

async function boot() {
  // THE RENDERER (docs/MIGRATION.md): PlayCanvas, through the game's graphics layer (gfx/) — WebGPU on a desktop, WebGL2
  // on phones (2026-11-03, the user) and wherever the browser has no WebGPU; ?api=webgl2 / webgpu forces one.
  // An OPAQUE canvas (2026-11-02, the user: "in the morning, evening and night a border of light on all trees"): the
  // leaf cards' alpha-to-coverage leaves alpha < 1 at their edges — the page's peach background showed through there.
  // Standard depth (PlayCanvas has no reversed-Z): 24-bit, the near plane 0.3 m.
  const antialias = tier.msaa
  const canvas = document.createElement('canvas')
  const renderer = await GFX.WebGLRenderer.create(canvas, { antialias, api: q.get('api') === 'webgl2' ? 'webgl2' : q.get('api')?.startsWith('webgpu') ? 'webgpu' : isMobileDevice() ? 'webgl2' : 'webgpu', powerPreference: 'high-performance' })
  // (?scale=: the Resolution setting, a fixed share of the full pixel ratio)
  renderer.setPixelRatio(Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100)
  renderer.setSize(innerWidth, innerHeight)
  // (the tone map: Neutral with a hue-keeping toe — gfx/material.ts OTH_OUTPUT_GLSL; ?tm=none: off, linear → sRGB only)
  renderer.toneMapping = q.get('tm') === 'none' ? GFX.NoToneMapping : GFX.CustomToneMapping
  renderer.toneMappingExposure = num('exp', 1.0)
  renderer.info.autoReset = false
  document.body.appendChild(renderer.domElement)

  // THE WORLD to start in (World.ts): the valley, or where the saved journey was (CONTINUE), or ?world=
  const saved = continueRequested() ? loadProgress() : null
  requestContinue(false)
  const startId: WorldId = q.get('world') === 'desert' || (!q.has('world') && saved?.map === 'desert') ? 'desert' : 'valley'
  const loading = (f: number) => (status.textContent = `Loading ${WORLDS[startId].name}… ${Math.round(f * 100)}%`)
  loading(0)
  const first = await MapData.load(WORLDS[startId].path, tier.terrainLeaf, loading)
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
  // ?weather=clear|cloudy|rain|sandstorm pins the weather (settled at once: the shot harness)
  const wq = q.get('weather')
  if (wq === 'clear' || wq === 'cloudy' || wq === 'rain' || wq === 'sandstorm') atmos.weather = wq
  let settled = false

  const camera = new GFX.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, num('far', tier.far)) // (?far= m: cost tests)
  const scene = new GFX.Scene()
  const shadow = new TerrainShadow(first)
  let shadowReady = false
  shadow.onBaked = () => (shadowReady = true)
  const sky = new Sky(atmos, false)
  const rain = new Rain(atmos, tier)
  const sand = new Rain(atmos, tier, 'sand')
  const journal = loadJournal()
  const keepJournal = () => { if (saving) saveJournal(journal) }
  const env: WorldEnv = {
    renderer, camera, scene, atmos, tier, shadow,
    farGrid: new GFX.Vector4(),
    // BIRDS in the sky: ULTRA on a PC only, for now (the user, 2026-11-02); ?birds=1 / 0 forces them
    birds: q.get('birds') === '1' || (q.get('birds') !== '0' && tier.name === 'ultra' && !isMobileDevice()),
    // OCCLUSION CULLING: what the hills hide is skipped; ?occlusion=0 turns it off
    occlusion: q.get('occlusion') !== '0',
    crates: journal.crates,
  }
  let world = await World.build(startId, env, undefined, undefined, first)
  // what lasts across worlds reads the current one's map through this
  const map = liveMap(() => world.map)
  const enterWorld = (w: World) => {
    w.landmarks.onDiscover = (l, n, total) => {
      const pay = l.kind === 'camp' ? REWARD.camp : REWARD.place
      journal.coins += pay
      keepJournal()
      readouts.coins(journal.coins, pay)
      toast(`Discovered · ${l.name}   +${pay} ◆   ${n} / ${total}`, 4200)
      audio.chime('place')
    }
    atmos.desert = w.map.desert
    // (a pinned ?weather= settled at once, in the first world's own kind: rain or a sandstorm)
    if (wq && !settled) { settled = true; atmos.settleWeather() }
    // (each world's own counts: the title screen's journal shows both)
    journal.totals = { ...journal.totals, [w.id]: { crates: w.props.crateCount, places: w.places.length } }
    keepJournal()
    scene.add(w.group)
  }
  enterWorld(world)
  scene.add(sky.mesh, rain.mesh, sand.mesh)

  // THE 4×4: the game's vehicle physics on this map's ground and rocks
  status.textContent = 'Loading the 4×4…'
  const physics = await OthPhysics.create(world.map, world.rocks)
  physics.trees = world.trees
  physics.addLandmarks(world.landmarks.colliders)
  physics.addLandmarks(world.formations?.colliders ?? [])
  physics.addPropColliders(world.props.colliders)
  const car = new Vehicle(map, physics, atmos, shadow, tier, env.farGrid)
  if (q.get('paint')) car.paint = '#' + q.get('paint')!.replace('#', '')
  // the GARAGE's driving settings
  car.driving = {
    manual: q.get('gearbox') === 'manual',
    aids: q.get('aids') === 'off' || q.get('aids') === 'standard' ? q.get('aids') as 'off' | 'standard' : 'full',
    offroadAssist: q.get('offroad') !== '0',
  }
  // CONTINUE (the title screen, APPLY & RESTART): back where the journey was saved, at its time of day
  if (saved && saved.map === map.meta.id) {
    car.spawnAt = { x: saved.x, z: saved.z, heading: saved.heading }
    if (!q.has('hour')) atmos.hour = saved.hour
  }
  await car.setCar(q.get('car') ?? 'gwagen')
  scene.add(car.root, car.shadowMesh)
  // THE MOUNTAIN BIKE (Bike.ts): carried on the car, taken out with B
  const bike = new Bike(map, physics, atmos, shadow, env.farGrid)
  bike.makeSim = (ph) => new MtbSim(ph.pw)
  await bike.load(mtbUrl)
  scene.add(bike.root, bike.shadowMesh)
  /** On the bike (B) — the car parked where it was left. */
  let riding = false
  /** WHAT THE PLAYER IS ON — the car, or the bike while riding: the cameras, the crossing, the map and the GPS, the
   *  pickups, the camp, the saved spot follow it. */
  const ride = {
    get pos(): GFX.Vector3 { return riding ? bike.pos : car.pos },
    get sim() { return riding ? bike.sim : car.sim },
    get heading(): number { return riding ? bike.heading : car.sim?.heading ?? 0 },
    get speedKmh(): number { return riding ? bike.speedKmh : car.speedKmh },
    get gear(): string { return riding ? bike.gear : car.gear },
    get body() { return riding ? bike.sim?.body : car.sim?.body },
    grounded: (): boolean => (riding ? bike.grounded() : car.grounded()),
  }
  // the tyres' dust and the exhaust smoke
  const dust = new Dust(map, atmos, tier)
  scene.add(dust.mesh)
  const tyreTracks = new TyreTracks(map, tier, atmos)
  scene.add(tyreTracks.mesh)
  const winch = new Winch(map, car, world.trees, world.rocks)
  winch.onMessage = (m) => toast(m)
  scene.add(winch.mesh)
  // THE MAP, THE RADAR and THE GPS (Nav.ts: the waypoint and the fastest way there — it lasts across worlds; the
  // chart, the map and the radar are each world's)
  const guide = new Guide()
  // (what an off-road leg must go round: this world's trunks and big boulders)
  const obstacles = (w: World) => () => {
    const o = new Obstacles(), d = w.trees.data
    for (let i = 0; i < w.trees.count; i++) o.add(d[i * TREE_STRIDE], d[i * TREE_STRIDE + 2], 0.6)
    w.rocks.each((k) => { if (k.s > 1.3) o.add(k.x, k.z, 0.55 * k.s) })
    return o
  }
  guide.setWorld(world.id, world.map, obstacles(world))
  guide.onArrive = (w) => { toast(`Arrived · ${w.name}`, 3200); audio.chime('place') }
  const chartSize = isMobileDevice() ? 768 : 1024
  const charts = (w: World) => {
    const chart = new Chart(w.map, chartSize)
    const o = { world: w.id, lm: w.landmarks, meta: w.map.meta, chart, guide, camera, carPos: () => ride.pos, carHeading: () => ride.heading, myCamp: () => myCamp }
    const mapView = new MapView(o)
    return { chart, mapView, radar: q.get('radar') === '0' ? null : new Radar({ ...o, openMap: () => mapView.toggle() }) }
  }
  let { chart, mapView, radar } = charts(world)
  // THE MAP BUTTON (2026-11-03, the user: "move the map on top side with an icon — if I click, the map shows; else no
  // need to show the minimap"): the minimap stays hidden until the round map button (top left) or N shows it, beside
  // the buttons; tapping the minimap opens the full map (Tab too). ?radar=1 starts with it shown (the nav harnesses
  // read its plate), ?radar=0 builds none — the button then opens the full map.
  let radarOn = q.get('radar') === '1'
  const toggleRadar = () => {
    if (!radar) { mapView.toggle(); return }
    radarOn = !radarOn
    mapBtn.classList.toggle('on', radarOn)
  }
  const mapBtn = mapButton(toggleRadar)
  mapBtn.classList.toggle('on', radarOn)
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggleRadar() })
  const chase = new ChaseCam(camera, map, ride, renderer.domElement)
  // (the chase camera stops in front of the rock: a ray from the car out to it, against the slab stacks, formations,
  //  ramps and bridges — StaticMesh — never the car itself)
  {
    let ray: InstanceType<typeof physics.pw.R.Ray> | null = null
    const camGroups = group(0xffff, Groups.StaticMesh)
    chase.obstruct = (ox, oy, oz, dx, dy, dz, len) => {
      ray ??= new physics.pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
      ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz
      ray.dir.x = dx; ray.dir.y = dy; ray.dir.z = dz
      // (solid false: a ray starting in rock finds where it leaves it, not 0)
      const hit = physics.pw.world.castRay(ray, len, false, undefined, camGroups, undefined, ride.body)
      return hit ? hit.timeOfImpact : null
    }
  }
  chase.snap()
  let driving = q.get('drive') !== '0'

  // THE BIKE ⇄ THE CAR (B): off the car onto the bike (taken off it, stood beside it), back in by the car — or, far from
  // it, the car brought to you (as in GTA). Where a vehicle goes: beside the other, on dry ground clear of trunks.
  const clearAt = (x: number, z: number, r: number): boolean => {
    if (map.waterAt(x, z) !== null || !map.inBox(x, z)) return false
    const d = world.trees.data
    for (let i = 0; i < world.trees.count; i++) if ((d[i * TREE_STRIDE] - x) ** 2 + (d[i * TREE_STRIDE + 2] - z) ** 2 < r * r) return false
    // (not on a slope steeper than ~30 %)
    const h = map.height(x, z)
    return Math.abs(map.height(x + r, z) - h) < 0.3 * r && Math.abs(map.height(x, z + r) - h) < 0.3 * r
  }
  /** A spot beside (x, z) facing h: offsets [right, back] tried in turn (m). */
  const besides = (x: number, z: number, h: number, offs: [number, number][], r: number): { x: number; z: number } | null => {
    for (const [sx, sz] of offs) {
      const px = x + Math.cos(h) * sx + Math.sin(h) * sz, pz = z - Math.sin(h) * sx + Math.cos(h) * sz
      if (clearAt(px, pz, r)) return { x: px, z: pz }
    }
    return null
  }
  /** The car brought beside the bike (parked: keep — false while riding on; true: taken at once). */
  const bringCar = (unpark: boolean) => {
    const h = bike.heading, p = bike.pos, half = car.half
    const at = besides(p.x, p.z, h, [[half.x + 1.6, 0], [-(half.x + 1.6), 0], [0, half.z + 2], [0, -(half.z + 2)]], half.x + 0.4) ?? { x: p.x + Math.cos(h) * 4, z: p.z - Math.sin(h) * 4 }
    if (unpark) car.unpark({ x: at.x, z: at.z, heading: h })
    else car.placeAt(at.x, at.z, h)
  }
  const toggleRide = () => {
    if (!car.sim || !bike.makeSim) return
    if (!riding) {
      if (car.speedKmh > 8) { toast('Stop the car to take the bike'); return }
      const h = car.sim.heading, p = car.pos, half = car.half
      const at = besides(p.x, p.z, h, [[half.x + 1.0, 0], [-(half.x + 1.0), 0], [0, half.z + 1.4], [0, -(half.z + 1.4)]], 0.8)
      if (!at) { toast('No room here to take the bike off'); return }
      if (winch.attached) winch.toggle() // (the line lets go)
      car.park()
      bike.mount(at.x, at.z, h)
      riding = true
      chase.frame(5.2, 1.25)
      chase.snap()
      toast('On the bike · B back to the car')
    } else {
      const far = Math.hypot(bike.pos.x - car.pos.x, bike.pos.z - car.pos.z) > 15
      if (far) bringCar(true)
      else car.unpark()
      bike.dismount()
      riding = false
      chase.frame(9, 1.6)
      chase.snap()
      toast(far ? 'Your 4×4 is brought to you' : 'Back in the 4×4')
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !driving || pause) return
    if (e.code === 'KeyB') toggleRide()
    if (e.code === 'KeyR' && riding) bike.reset()
  })
  // (?ride=bike: start on the bike — the harnesses; ?bikedraw=0: the bike not drawn — the cost A/B)
  bike.hidden = q.get('bikedraw') === '0'
  if (q.get('ride') === 'bike' && driving) toggleRide()

  const fly = new FlyCam(camera, map, renderer.domElement)
  const sp = map.meta.spawn
  fly.place(num('x', sp.x), num('z', sp.z), num('h', 1.7), num('yaw', sp.yaw), num('pitch', -0.04))
  // V: the free camera (from where the chase camera is) ⇄ back in the car
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV') return
    driving = !driving
    if (!driving) {
      const d = camera.getWorldDirection(new GFX.Vector3())
      fly.place(camera.position.x, camera.position.z, camera.position.y - map.height(camera.position.x, camera.position.z), Math.atan2(-d.x, -d.z), Math.asin(d.y))
    } else chase.snap()
  })
  const ui = driveUi(car, ride, bike)
  // SOUND: the engine, the tyres, the music and the valley's ambience (starts on the first key / tap — Audio.ts)
  const audio = new OthAudio(map, car, atmos)
  audio.bike = bike
  audio.fires = world.props.fires
  const readouts = gameHud(journal.coins)
  if (q.get('sound') === '0') audio.muted = true
  fullscreenButton()
  // ZOOM buttons (+ / −): the chase camera's distance while driving, the field of view in the free camera
  zoomButtons((k) => {
    if (driving) chase.zoom(k)
    else { camera.fov = GFX.MathUtils.clamp(camera.fov * k, 18, 80); camera.updateProjectionMatrix() }
  })

  // ANOTHER WORLD (the crossing — Crossing.ts — or ?world / the harness): built a step a frame while this one plays
  // (in the background: what lasts is left alone until the swap), then everything that lasts is pointed at it; the
  // world left is DISPOSED whole (World.dispose: its GPU memory back) — by the crossing once the car is away from the
  // gate, at once by the harness
  const keep = new Set<GFX.Texture>([noise, shadow.box, shadow.world, shadow.treeTex])
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
  const buildWorld = (id: WorldId) => World.build(id, env, nextFrame, undefined, undefined, true)
  /** Enter `next`; returns the world left (out of the scene, still built). */
  const enter = (next: World): World => {
    const old = world
    next.adopt(env)
    world = next
    old.group.removeFromParent()
    enterWorld(next)
    physics.setWorld(next.map, next.rocks, next.trees)
    physics.addLandmarks(next.landmarks.colliders)
    physics.addLandmarks(next.formations?.colliders ?? [])
    physics.addPropColliders(next.props.colliders)
    winch.setWorld(next.trees, next.rocks)
    mapView.dispose()
    radar?.dispose()
    ;({ chart, mapView, radar } = charts(next))
    guide.setWorld(next.id, next.map, obstacles(next))
    audio.fires = next.props.fires
    audio.setWorld()
    // (your own camp is each world's: left pitched where it was, the one here back up)
    camps[old.id] = myCamp
    myCamp = camps[next.id] ?? null
    if (myCamp) next.props.pitch(myCamp)
    return old
  }
  // THE CROSSING: the mist on the pass, the other world built behind it, the swap at the gate
  const crossing = new Crossing({
    world: () => world,
    build: buildWorld,
    enter: (w) => { enter(w) },
    move: (dx, dy, dz) => {
      if (riding) bike.shift(dx, dy, dz)
      else car.shift(dx, dy, dz)
      dust.shift(dx, dy, dz)
      tyreTracks.clear()
      if (!driving) { camera.position.x += dx; camera.position.y += dy; camera.position.z += dz; camera.updateMatrixWorld() }
      lastPos.set(lastPos.x + dx, lastPos.y + dy, lastPos.z + dz)
      safe.x = Number.NaN
    },
    dispose: (w) => { shadow.forget(w.map); w.dispose(keep) },
    atmos,
  })
  crossing.onSwap = (_, to) => {
    regionTitle(WORLDS[to.id].name)
    if (riding) bringCar(false) // (the car was left in the other world: it comes along, parked by the road)
  }

  const baseDpr = Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100 // (?maxdpr=: the pixel-ratio cap, cost tests)
  let dprScale = 1, dprT = performance.now() + 4000
  // (phones only: on a PC / laptop the resolution never drops — the user: "don't reduce resolution automatically, turn it
  //  off on PC / laptop"; ?adaptive=1 forces it on, ?dpr=fixed / ?adaptive=0 off)
  const adaptive = q.get('adaptive') === '1' || (isMobileDevice() && q.get('dpr') !== 'fixed' && q.get('adaptive') !== '0')
  const size = () => {}
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  })

  // STATS: PlayCanvas's own panel (MiniStats — FPS, frame time, draw calls, CPU / GPU timings, VRAM): F3 or ?stats=1
  let cpuMs = 0, frameMs = 16.7, last = performance.now()
  renderer.offscreen = q.get('bench') === 'offscreen'
  let showStats = q.get('stats') === '1'
  renderer.showStats(showStats)
  window.addEventListener('keydown', (e) => { if (e.code === 'F3') { showStats = !showStats; renderer.showStats(showStats); e.preventDefault() } })

  const clock = new GFX.Clock()
  // the view's frustum, once a frame: the car, its dust (their own tests — three's cull is off for the moving parts)
  const viewPV = new GFX.Matrix4(), view = new GFX.Frustum()

  // THE JOURNEY (save.ts): metres driven and seconds played add up over every session; saved every 20 s, when the page
  // is hidden or closed, and from the pause menu — at the car's last SAFE spot (on its wheels on the ground, out of
  // the water), so CONTINUE never starts it in a river or upside down
  let travelled = saved?.travelled ?? 0, playSeconds = saved?.playSeconds ?? 0, saveT = 0
  const safe = { x: Number.NaN, z: 0, heading: 0 }
  // the player's own camp (pitched with C), back where it was
  // (one per world: `camps` keeps the other's while you're away — save.ts)
  const camps: Partial<Record<WorldId, Camp | null>> = { ...(saved?.camps ?? {}), ...(saved?.camp && saved.map ? { [saved.map]: saved.camp } : {}) }
  let myCamp: Camp | null = camps[world.id] ?? null
  if (myCamp) world.props.pitch(myCamp)
  const lastPos = new GFX.Vector3().copy(ride.pos)
  const save = () => {
    if (Number.isNaN(safe.x) || !saving) return
    saveProgress({ v: 1, map: map.meta.id, car: car.id, x: safe.x, z: safe.z, heading: safe.heading, hour: atmos.hour, travelled, playSeconds, savedAt: Date.now(), camp: myCamp, camps: { ...camps, [world.id]: myCamp } })
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
  const campHere = (): { name: string; own: boolean } | null => {
    const p = ride.pos
    const site = world.places.find((l) => l.kind === 'camp' && (l.x - p.x) ** 2 + (l.z - p.z) ** 2 < 22 * 22)
    if (site) return { name: site.name, own: false }
    if (myCamp && (myCamp.x - p.x) ** 2 + (myCamp.z - p.z) ** 2 < 25 * 25) return { name: 'Your camp', own: true }
    return null
  }
  const canCamp = () => driving && !!ride.sim && ride.speedKmh < 3 && ride.grounded() && map.waterAt(ride.pos.x, ride.pos.z) === null
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
      const h = ride.heading, p = ride.pos
      const spot = [4.6, -4.6].map((side) => [p.x + Math.cos(h) * side, p.z - Math.sin(h) * side]).find(([x, z]) => map.waterAt(x, z) === null) ?? [p.x, p.z]
      myCamp = { x: spot[0], y: map.height(spot[0], spot[1]), z: spot[1], rot: h + Math.PI / 2 }
      world.props.pitch(myCamp)
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
        ...(here.own ? [{ label: 'Pack up camp', go: () => { myCamp = null; world.props.pitch(null); save(); closeMenu(); toast('Camp packed up') } }] : []),
        { label: 'Back on the road', go: closeMenu },
      ],
    })
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat) openCamp() })
  readouts.onCamp(openCamp)
  // the SIGNPOST you've stopped by (≤ 15 m): its boards — the nearest places, which way (from where you look) and how far
  const signHud = () => {
    const s = driving ? world.props.signNear(ride.pos.x, ride.pos.z, 15) : null
    if (!s) { readouts.sign(null); return }
    camera.getWorldDirection(signDir)
    const head = Math.atan2(signDir.x, -signDir.z)
    const near = world.places.map((l) => ({ l, d: Math.hypot(l.x - s.x, l.z - s.z) })).filter((o) => o.d > 60).sort((a, b) => a.d - b.d).slice(0, 4)
    readouts.sign(near.map(({ l, d }) => ({ name: l.name, d, turn: Math.atan2(l.x - s.x, -(l.z - s.z)) - head })))
  }
  const signDir = new GFX.Vector3()
  let hudTick = 0

  const frame = () => {
    renderer.drawing = !pause
    if (pause) return
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
    // the crossing first: a swap moves the car before this frame's physics, pose and cameras
    bike.wet = car.wet
    crossing.update(dt, ride.sim ? ride.pos : null, camera.position)
    physics.pw.advance(dt, (fdt) => { car.fixed(fdt); bike.fixed(fdt); winch.fixed(fdt) })
    car.update(physics.pw.alpha)
    bike.update(physics.pw.alpha, dt)
    guide.update(dt, ride.pos.x, ride.pos.z)
    // the journey: distance driven (not the jumps of a reset / a car change), the last safe spot, the autosave
    playSeconds += dt
    const moved = Math.hypot(ride.pos.x - lastPos.x, ride.pos.z - lastPos.z)
    if (moved < 5) travelled += moved
    lastPos.copy(ride.pos)
    if (ride.sim && ride.grounded() && map.waterAt(ride.pos.x, ride.pos.z) === null) { safe.x = ride.pos.x; safe.z = ride.pos.z; safe.heading = ride.heading }
    if ((saveT += dt) > 20) { saveT = 0; save() }
    // the supply crates the car reaches
    const got = world.props.pickUp(dt, ride.pos.x, ride.pos.y, ride.pos.z)
    if (got.length) {
      for (const id of got) journal.crates.push(id)
      journal.coins += REWARD.crate * got.length
      keepJournal()
      readouts.coins(journal.coins, REWARD.crate * got.length)
      const here = journal.crates.filter((id) => (id >= DESERT_IDS) === world.map.desert).length
      toast(`Supply crate · +${REWARD.crate * got.length} ◆   ${here} / ${world.props.crateCount}`)
      audio.chime('crate')
    }
    // the HUD's slow parts (4× a second): the signpost, the camp prompt
    if ((hudTick += dt) > 0.25) { hudTick = 0; signHud(); const c = canCamp() ? campHere() : null; readouts.camp(canCamp() ? (c ? `Rest at ${c.name}` : 'Pitch camp') : null) }
    dust.update(dt, car)
    tyreTracks.update(car, clock.elapsedTime)
    if (riding && bike.sim) {
      const sb = bike.sim, wheels = [sb.front, sb.rear]
      dust.bikeTyres(dt, wheels, sb.body.linvel())
      tyreTracks.bikeMarks(wheels, clock.elapsedTime)
    }
    car.lights(atmos, dt)
    car.weather(atmos, dt)
    if (driving) chase.update(dt)
    else fly.update(dt)
    ui.update(driving, atmos.clock)
    audio.update(dt, camera)
    atmos.tick(dt)
    atmos.update(camera.position, clock.elapsedTime)
    rain.update()
    sand.update()
    mapView.update(dt)
    radar?.update(dt, radarOn && driving && !mapView.isOpen, ride.speedKmh)
    winch.update(camera)
    shadow.update(atmos.uniforms.uSunDir.value)
    const t0 = performance.now()
    world.update(camera, dt, clock.elapsedTime, atmos.uniforms.uLamps.value, atmos.uniforms.uFire.value, ride.pos.x, ride.pos.z)
    // (what's out of view or behind the hills isn't drawn: 2026-11-02)
    viewPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    view.setFromProjectionMatrix(viewPV, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    car.cull(view, world.horizon)
    bike.cull(view, world.horizon)
    dust.cull(view, world.horizon)
    tyreTracks.cull(camera.position, clock.elapsedTime)
    renderer.prepare(scene, camera)
    cpuMs += (performance.now() - t0 - cpuMs) * 0.1
  }
  // PlayCanvas's frame loop: the game in its 'update', then it renders
  renderer.start(frame)
  status.remove()
  dispatchEvent(new Event('overhill:started')) // (the title screen closes)

  // the shot harness
  ;(window as unknown as { __oth: unknown }).__oth = {
    get ready() { return shadowReady },
    tier: tier.name,
    get props() { return world.props },
    get birds() { return world.birds },
    get world() { return world },
    bike,
    /** On / off the bike (B). */
    ride: () => toggleRide(),
    get riding() { return riding },
    /** (the harness's probes: offscreen bakes re-run, targets read back) */
    renderer,
    /** The drawn parts, each with `visible` (scripts/harness/ablate.mjs: the GPU's frame, system by system). */
    parts: () => ({ terrain: world.terrain.mesh, grass: world.grass.group, trees: world.trees.group, bushes: world.bushes.group, rocks: world.rocks.group, water: world.water.group, falls: world.falls.group, bridges: world.bridges.group, landmarks: world.landmarks.group, props: world.props.group, ...(world.glow ? { glow: world.glow.group } : {}), ...(world.formations ? { formations: world.formations.group } : {}), ...(world.birds ? { birds: world.birds.mesh } : {}), sky: sky.mesh, car: car.root, carShadow: car.shadowMesh, dust: dust.mesh, tracks: tyreTracks.mesh }),
    journal,
    openCamp,
    view: (x: number, z: number, h: number, yaw: number, pitch: number) => { driving = false; fly.place(x, z, h, yaw, pitch) },
    car,
    rain,
    winch,
    tyreTracks,
    scene,
    camera,
    atmos,
    /** The sound's state (Audio.ts debug). */
    audio: () => audio.debug(),
    /** Build world `id` behind the play, enter it, the car at its spawn (the harness: a crossing's swap without the road). */
    swapTo: async (id: WorldId) => {
      crossing.forget()
      const w = await buildWorld(id)
      const old = enter(w)
      shadow.forget(old.map)
      old.dispose(keep)
      const sp = w.map.meta.spawn
      physics.follow(sp.x, sp.z)
      if (riding) { bike.mount(sp.x, sp.z, sp.yaw); bringCar(false) } // (the bike at the spawn, the car parked beside it)
      else car.sim?.place(sp.x, w.map.height(sp.x, sp.z) + 0.6, sp.z, sp.yaw)
      return w.timings
    },
    crossing,
    guide,
    get mapView() { return mapView },
    get radar() { return radar },
    /** This world's chart, painted to the end, as a WebP data URL (scripts/harness/chartbake.mjs → chart.webp). */
    chartWebp: () => { chart.finish(); return chart.canvas.toDataURL('image/webp', 0.86) },
    gpuMemory: () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 }),
    /** Drive mode on / off (the chase camera). */
    drive: (on: boolean) => { driving = on; if (on) chase.snap() },
    setHour: (h: number) => { atmos.hour = h; atmos.update(camera.position, 0) },
    sunDir: () => atmos.uniforms.uSunDir.value.toArray(),
    /** Resolves when the GPU has finished what's been submitted (fps.mjs: the honest frame time — WebGPU's rAF runs ahead). */
    gpuDone: () => renderer.gpuDone(),
    /** The physics (the harness: collider counts, step times — scripts/harness/rockdrive.mjs). */
    physics,
    gpuTime: () => renderer.gpuTime(),
    backend: renderer.backend,
    stats: () => ({ fps: 1000 / frameMs, cpuMs, draws: renderer.info.render.calls, tris: renderer.info.render.triangles, patches: world.terrain.patches, blades: world.grass.blades, rocks: world.rocks.count, trees: world.trees.drawn.slice(), bushes: world.bushes.drawn.slice(), culled: { terrainPatches: world.terrain.occluded, treeTiles: world.trees.occluded, rocks: { ...world.rocks.culled }, horizonBuilds: world.horizon.builds }, pos: camera.position.toArray().map((v) => +v.toFixed(1)), ground: +map.height(camera.position.x, camera.position.z).toFixed(1) }),
    height: (x: number, z: number) => map.height(x, z),
    rockNear: (x: number, z: number, r: number) => world.rocks.biggestNear(x, z, r),
    treeNear: (x: number, z: number, r: number, species: number, minH: number) => world.trees.nearest(x, z, r, species, minH),
    /** The densest broadleaf grove within r of (x, z) (≥ n trees of species ≥ 3 within 25 m of its centre). */
    grove: (x: number, z: number, r: number, n: number) => {
      const d = world.trees.data, S = 8
      let best: [number, number] | null = null, bc = 0
      for (let i = 0; i < world.trees.count; i++) {
        const o = i * S
        if (d[o + 5] < 3 || (d[o] - x) ** 2 + (d[o + 2] - z) ** 2 > r * r) continue
        let c = 0
        for (let k = 0; k < world.trees.count; k++) { const q = k * S; if (d[q + 5] >= 3 && (d[q] - d[o]) ** 2 + (d[q + 2] - d[o + 2]) ** 2 < 625) c++ }
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
        if (good && world.trees.clearLine(cx, cz, cx + fx * 60, cz + fz * 60, 9)) return [cx, cz]
      }
      return null
    },
    clearLineTrees: (ax: number, az: number, bx: number, bz: number, r: number) => world.trees.clearLine(ax, az, bx, bz, r),
    treeShot: (x: number, z: number, species: number, minH: number, dist: number, yaw: number) => world.trees.clearShot(x, z, species, minH, dist, yaw),
    rockShot: (x: number, z: number, r: number, dist: number, yaw: number) => {
      for (const k of world.rocks.candidates(x, z, r)) {
        const d = k.s * dist, cx = k.x + Math.sin(yaw) * d, cz = k.z + Math.cos(yaw) * d
        if (world.trees.clearLine(cx, cz, k.x, k.z, 7)) return { ...k, cx, cz }
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

/** The REGION's title (a crossing's arrival): big, centred, fading in and out over a few seconds. */
function regionTitle(name: string): void {
  const t = document.createElement('div')
  t.className = 'oth-region'
  t.innerHTML = `<small>Entering</small>${name}`
  document.body.appendChild(t)
  requestAnimationFrame(() => t.classList.add('on'))
  setTimeout(() => t.classList.remove('on'), 3800)
  setTimeout(() => t.remove(), 5200)
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

/** The round MAP button (top left, under + / −): a folded map; amber while the minimap shows. */
function mapButton(press: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'oth-mapbtn'
  b.title = 'Minimap (N)'
  b.setAttribute('aria-label', 'Minimap')
  b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>'
  b.addEventListener('pointerdown', (e) => { e.stopPropagation(); press() })
  document.body.appendChild(b)
  return b
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
function driveUi(car: Vehicle, ride: { readonly speedKmh: number; readonly gear: string; readonly sim: unknown }, bike: Bike): { update: (driving: boolean, time: string) => void } {
  const box = document.createElement('div')
  box.id = 'drive'
  box.innerHTML = '<div class="spd"><b>0</b><span>km/h</span><i></i><em></em></div><div class="help">W A S D drive · Space handbrake · Shift boost · X Z gears · E winch · B bike · C camp · R reset · N minimap · Tab map (click: waypoint) · G time · Shift+G weather · V free camera · Esc pause</div>'
  document.body.appendChild(box)
  const spd = box.querySelector('b')!, gear = box.querySelector('i')!, clk = box.querySelector('em')!, help = box.querySelector('.help') as HTMLElement
  const CAR_HELP = help.textContent ?? '', BIKE_HELP = 'W pedal · S brake · A D steer · ↑ ↓ lean (wheelie, manual, flips) · Space hop (hold to load) · Shift sprint · R back on · B to the car · Tab map · V free camera · Esc pause'
  let onBike = false, pad: HTMLElement | null = null
  const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches
  if (touch) {
    // TOUCH: round thumb pads in the corners, the rest of the HUD small and out of the way (index.html, body.touch):
    // the game gets the screen
    document.body.classList.add('touch')
    help.style.display = 'none'
    pad = document.createElement('div')
    pad.className = 'oth-touch'
    pad.innerHTML = '<button data-k="left">◀</button><button data-k="right">▶</button><button data-k="reset">⟲</button><button data-k="brake">BRAKE</button><button data-k="gas">GAS</button><button data-k="winch">WINCH</button><button data-k="ride">BIKE</button><button data-k="hop" class="bk">HOP</button><button data-k="leanF" class="bk">▲</button><button data-k="leanB" class="bk">▼</button>' +
      (car.driving.manual ? '<button data-k="up" data-key="KeyX">▲</button><button data-k="down" data-key="KeyZ">▼</button>' : '')
    document.body.appendChild(pad)
    // (one-shot pads — the winch, the manual gears — press the key they stand for)
    const tap = (code: string) => (e: Event) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { code })) }
    for (const b of pad.querySelectorAll('button')) {
      if (b.dataset.k === 'winch') { b.addEventListener('pointerdown', tap('KeyE')); continue }
      if (b.dataset.k === 'ride') { b.addEventListener('pointerdown', tap('KeyB')); continue }
      if (b.dataset.k === 'hop' || b.dataset.k === 'leanF' || b.dataset.k === 'leanB') {
        const set = (v: number) => (e: Event) => { e.preventDefault(); if (b.dataset.k === 'hop') bike.touch.hop = v; else bike.touch.lean = b.dataset.k === 'leanF' ? v : -v }
        b.addEventListener('pointerdown', set(1)); b.addEventListener('pointerup', set(0)); b.addEventListener('pointercancel', set(0)); b.addEventListener('pointerleave', set(0))
        continue
      }
      if (b.dataset.key) { b.addEventListener('pointerdown', tap(b.dataset.key)); continue }
      const k = b.dataset.k as 'gas' | 'brake' | 'left' | 'right' | 'reset'
      const on = (v: number) => (e: Event) => { e.preventDefault(); if (k === 'reset') { if (v) { if (bike.sim) bike.reset(); else car.reset() } } else { car.touch[k] = v; bike.touch[k] = v } }
      b.addEventListener('pointerdown', on(1)); b.addEventListener('pointerup', on(0)); b.addEventListener('pointercancel', on(0)); b.addEventListener('pointerleave', on(0))
    }
  }
  return {
    update: (driving, time: string) => {
      box.style.display = driving ? 'block' : 'none'
      spd.textContent = ride.speedKmh.toFixed(0)
      gear.textContent = ride.gear
      const on = !!bike.sim
      if (on !== onBike) { onBike = on; help.textContent = on ? BIKE_HELP : CAR_HELP; pad?.classList.toggle('bike', on) }
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
