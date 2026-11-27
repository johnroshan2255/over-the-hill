import * as GFX from './gfx'
import { isMobileDevice } from '../rendering/quality/DeviceProfile'
import { loadJournal, REWARD, saveJournal } from '../journal'
import { lettersKnown, lettersTaught, wardenHtml } from './wardenScript'
import { SECRET } from './Wardens'
import { type Camp, continueRequested, loadProgress, requestContinue, saveProgress } from '../save'
import { gameParams, loadSettings, type Settings } from '../settings'
import { Menu } from '../ui/Menu'
import { Atmosphere, LOOK } from './Atmosphere'
import { Bike, MotoBike } from './Bike'
import motoUrl from '../assets/models/vehicles/moto.glb?url'
import riderUrl from '../assets/models/human/rider.glb?url'
import { MotoSim } from '../gameplay/vehicle/MotoSim'
import { Character, type ClipName } from './Character'
import charUrl from '../assets/models/human/character.glb?url'
import fightUrl from '../assets/models/human/fight.glb?url'
import ropeUrl from '../assets/models/human/rope.glb?url'
import { OthAudio } from './Audio'
import { Dust } from './Dust'
import DAMAGE from '../../../proto/damage.json'
import { DAMAGE_ON, DamageFx } from './Damage'
import { ChaseCam } from './ChaseCam'
import { Chart } from './Chart'
import { PassMist } from './PassMist'
import { FlyCam } from './FlyCam'
import { MapData } from './MapData'
import { MapView } from './MapView'
import { Guide, Obstacles } from './Nav'
import { Autopilot } from './Autopilot'
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
import { type TowCar, Winch } from './Winch'
import { ActionWheel, ICONS } from './Wheel'
import { liveMap, World, type WorldEnv, type WorldId, WORLDS } from './World'
import { caveUniforms } from './Sites'
import { Fsr } from './Fsr'
import { initMouseLook, lockMouse, lookBlocked, mouseLocked, onMouseLook, releaseMouse } from './mouseLook'
import { PerfMarks, type PerfSnap } from './PerfMarks'
import { carKind, Coop, type Local } from './Coop'
import { DEFAULT_VEHICLE, vehicleDef } from '../gameplay/vehicle/catalogue'
import { Gather } from './Gather'
import { GroundEdits } from './GroundEdits'
import { Trailer } from './Trailer'
import { Bot } from './Bot'
import { coopRequested, loadAccount, requestCoop } from '../net/api'
import { Kind } from '../net/pose'
import { Session } from '../net/Session'
import { Companion, type CompanionKind } from './Companion'
import type RAPIER_NS from '@dimforge/rapier3d-compat'
type RapierBody = RAPIER_NS.RigidBody
import { Arsenal, FPP_ARMED_FOV, Pickups, type WeaponId, weaponMaterial } from './Weapons'
import { aimLodEye, lodEye } from './LodEye'
import type { SkySet, WireWeapon } from '../net/wire'

/**
 * OVERHILL — the game: its own world and renderer. Boot: tier → map data → paint texture → atmosphere, terrain, grass,
 * sky → the loop. Loaded by the title screen (../main.ts) when the player starts; `window.__oth` drives it from the
 * headless shot harness (scripts/shot.mjs).
 *
 * Switches (settings.ts `gameParams`: the menus' settings, under the page's URL): ?tier=low|medium|high|ultra
 *      ?car=offroader (g500 | e30: the shelved models) ?paint=rrggbb ?gearbox=auto|manual ?aids=off|standard|full ?offroad=0|1 ?aa=0 ?scale=50…100
 *      ?sound=0 ?drive=0 (start in the free camera) ?x= &z= (m) ?h= (m above the ground) ?yaw= ?pitch= (rad) ?hour=
 *      ?tm=neutral|agx|aces ?exp= (exposure) ?stats=1 ?weather=clear|cloudy|rain
 *      ?save=0 (a test session: the journey and the journal never written) ?at=cave (start before Sky Hollow's mouth)
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
  // on phones (2026-11-03, the user), on a weak GPU (quality.ts: an Intel UHD / Mali Chromebook — its WebGPU drivers
  // the least tried, WebGL2 the phones' path) and wherever the browser has no WebGPU; ?api=webgl2 / webgpu forces one.
  // An OPAQUE canvas (2026-11-02, the user: "in the morning, evening and night a border of light on all trees"): the
  // leaf cards' alpha-to-coverage leaves alpha < 1 at their edges — the page's peach background showed through there.
  // Standard depth (PlayCanvas has no reversed-Z): 24-bit, the near plane 0.3 m.
  const antialias = tier.msaa
  const canvas = document.createElement('canvas')
  const renderer = await GFX.WebGLRenderer.create(canvas, { antialias, samples: tier.msaaSamples, api: q.get('api') === 'webgl2' ? 'webgl2' : q.get('api')?.startsWith('webgpu') ? 'webgpu' : isMobileDevice() || tier.weakGpu ? 'webgl2' : 'webgpu', powerPreference: 'high-performance' })
  // (?scale=: the Resolution setting, a fixed share of the full pixel ratio)
  renderer.setPixelRatio(Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100)
  renderer.setSize(innerWidth, innerHeight)
  // (the tone map: Neutral with a hue-keeping toe — gfx/material.ts OTH_OUTPUT_GLSL; ?tm=none: off, linear → sRGB only)
  renderer.toneMapping = q.get('tm') === 'none' ? GFX.NoToneMapping : GFX.CustomToneMapping
  renderer.toneMappingExposure = num('exp', 1.0)
  renderer.info.autoReset = false
  document.body.appendChild(renderer.domElement)

  // THE WORLD to start in (World.ts): the valley, or where the saved journey was (CONTINUE), or ?world=
  // CO-OP (docs/MULTIPLAYER.md — the title's CO-OP screen, or ?coop=<world>): joined below, once the world is built
  const coopWorld = coopRequested()
  const saved = continueRequested() && !coopWorld ? loadProgress() : null
  requestContinue(false)
  // (the one world since 2026-11-18 — the desert removed, the user: "delete the desert and the path to desert"; a
  //  journey saved there starts again in the valley)
  const startId: WorldId = 'valley'
  // ONE BAR from PLAY to playable (2026-11-17, the user: "why showing 2 loadings"): it read 100 % when the map's files
  // were in, sat there through the world's build, then began again at 0 for the 4×4 and the shaders. Now: the map
  // 0–40 %, the world's build 40–80 %, the 4×4 to 85 %, the shaders' warm-up to 100 % — one label, only forward.
  let shown = 0
  const loading = (f: number) => { shown = Math.max(shown, Math.min(1, f)); status.textContent = `Loading ${WORLDS[startId].name}… ${Math.round(shown * 100)}%` }
  loading(0)
  const first = await MapData.load(WORLDS[startId].path, tier.terrainLeaf, (f) => loading(f * 0.4))
  const noise = createPaintTexture()
  const atmos = new Atmosphere(noise)
  atmos.uniforms.uFogRange.value.set(tier.fogNear, tier.haze)
  atmos.hazeLen = tier.haze
  atmos.hour = num('hour', 15.5)
  // ?time=0 stops the clock (the shot harness); [ / ] an hour back / on, T stops / starts it
  if (q.get('time') === '0') atmos.dayMinutes = 0
  // ?freeze=1 (pixdiff.mjs): the shaders' clock held still — the wind, the water, the leaves the same in every capture,
  // so two builds' frames can be compared pixel for pixel (the physics and the day keep their own clocks)
  const FREEZE = q.get('freeze') === '1'
  const runMinutes = num('day', 24)
  if (atmos.dayMinutes) atmos.dayMinutes = runMinutes
  // (co-op: the hour and the weather are the world's — a change here is told to the server, which tells everyone;
  //  set once joined: `skyNet.set`)
  const skyNet: { set?: (hour: number | null, weather: SkySet, wait: boolean) => void } = {}
  window.addEventListener('keydown', (e) => {
    if (e.code === 'BracketRight') { atmos.hour = (atmos.hour + 1) % 24; skyNet.set?.(atmos.hour, 'keep', false) }
    if (e.code === 'BracketLeft') { atmos.hour = (atmos.hour + 23) % 24; skyNet.set?.(atmos.hour, 'keep', false) }
    if (e.code === 'KeyT') { if (atmos.followed) toast('The clock is the world\'s in co-op'); else atmos.dayMinutes = atmos.dayMinutes ? 0 : runMinutes }
    if (e.code === 'KeyK') { toast(`Weather: ${atmos.stepWeather()}`); skyNet.set?.(null, atmos.weather, false) }
    // G: the next time of day (morning → noon → evening → night); Shift + G: the next weather (2026-11-02, the user)
    if (e.code === 'KeyG') {
      if (e.shiftKey) { toast(`Weather: ${atmos.stepWeather()}`); skyNet.set?.(null, atmos.weather, false) }
      else {
        const P: [number, string][] = [[6.5, 'Morning'], [12, 'Noon'], [17.5, 'Evening'], [21.5, 'Night']]
        const next = P.find(([t]) => t > atmos.hour + 0.25) ?? P[0]
        atmos.hour = next[0]
        skyNet.set?.(atmos.hour, 'keep', false)
        toast(`Time · ${next[1]}`)
      }
    }
  })
  // ?weather=clear|cloudy|rain pins the weather (settled at once: the shot harness)
  const wq = q.get('weather')
  if (wq === 'clear' || wq === 'cloudy' || wq === 'rain') atmos.weather = wq
  let settled = false

  const camera = new GFX.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, num('far', tier.far)) // (?far= m: cost tests)
  const scene = new GFX.Scene()
  const shadow = new TerrainShadow(first)
  let shadowReady = false
  shadow.onBaked = () => (shadowReady = true)
  const sky = new Sky(atmos, false)
  const rain = new Rain(atmos, tier)
  const journal = loadJournal()
  const keepJournal = () => { if (saving) saveJournal(journal) }
  const env: WorldEnv = {
    renderer, camera, scene, atmos, tier, shadow,
    farGrid: new GFX.Vector4(),
    // BIRDS in the sky: ULTRA on a PC only, for now (the user, 2026-11-02); ?birds=1 / 0 forces them
    birds: q.get('birds') === '1' || (q.get('birds') !== '0' && tier.name === 'ultra' && !isMobileDevice()),
    // OCCLUSION CULLING: what the hills hide is skipped; ?occlusion=0 turns it off
    occlusion: q.get('occlusion') !== '0',
  }
  let world = await World.build(startId, env, undefined, (f) => loading(0.4 + 0.4 * f), first)
  // what lasts across worlds reads the current one's map through this
  const map = liveMap(() => world.map)
  const enterWorld = (w: World) => {
    caveUniforms(atmos, w.places) // (the caves' dark: Sites.ts)
    w.landmarks.onDiscover = (l, n, total) => {
      const pay = l.kind === 'camp' ? REWARD.camp : REWARD.place
      journal.coins += pay
      keepJournal()
      readouts.coins(journal.coins, pay)
      toast(`${SECRET.has(l.style ?? '') ? 'Secret place found' : 'Discovered'} · ${l.name}   +${pay} ◆   ${n} / ${total}`, 4200)
      audio.chime()
      // A BEACON reached: its crystal wakes (Wardens.light) — "light the chain"; the last one pays for them all
      if (l.kind === 'warden' && l.style === 'tower' && w.wardens) {
        w.wardens.light([l.id])
        const [lit, all] = w.wardens.beacons()
        setTimeout(() => {
          toast(lit < all ? `Beacon lit · ${lit} / ${all}` : `The last beacon burns — the chain is whole   +${REWARD.place * 10} ◆`, 5200)
          audio.chime()
          if (lit === all) { journal.coins += REWARD.place * 10; keepJournal(); readouts.coins(journal.coins, REWARD.place * 10) }
        }, 4400)
      }
    }
    // (a Warden vault's door fallen / standing: the physics re-streams the props' boxes)
    if (w.wardens) w.wardens.onColliders = () => physics.propsDirty()
    // (a pinned ?weather= settled at once)
    if (wq && !settled) { settled = true; atmos.settleWeather() }
    // (each world's own counts: the title screen's journal shows both)
    journal.totals = { ...journal.totals, [w.id]: { places: w.places.length } }
    keepJournal()
    scene.add(w.group)
  }
  enterWorld(world)
  scene.add(sky.mesh, rain.mesh)

  // THE 4×4: the game's vehicle physics on this map's ground and rocks
  loading(0.82) // (the 4×4)
  const physics = await OthPhysics.create(world.map, world.rocks)
  physics.trees = world.trees
  physics.addLandmarks(world.landmarks.colliders)
  physics.addTrimesh(world.cave?.collider)
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
  // ?at=cave (2026-11-07, the user: "a URL param that makes me spawn near the cave"): 30 m before Sky Hollow's mouth,
  // facing it (over a CONTINUE's spot)
  if (q.get('at') === 'cave') {
    const l = world.places.find((p) => p.kind === 'cave')
    if (l) car.spawnAt = { x: l.x + Math.sin(l.rot) * 30, z: l.z + Math.cos(l.rot) * 30, heading: l.rot }
  }
  await car.setCar(q.get('car') ?? DEFAULT_VEHICLE)
  scene.add(car.root, car.shadowMesh)
  // THE MOUNTAIN BIKE (Bike.ts): carried on the car, taken out with B
  // THE MOTORBIKE (MotoSim.ts, the same Bike drawing): taken out with F (GTA's key) — 2026-11-05
  const moto = new MotoBike(map, physics, atmos, shadow, env.farGrid)
  moto.makeSim = (ph) => new MotoSim(ph.pw)
  await moto.load(motoUrl, riderUrl)
  scene.add(moto.root, moto.shadowMesh)
  // (the two-wheeler: the MOTORBIKE — the bicycle taken out of the game, 2026-11-05, the user: "remove the cycle, we
  //  only need cars and the bike")
  const twos = [moto]
  /** On a two-wheeler (B the bicycle, H the motorbike) — the car parked where it was left; `two` the one ridden. */
  let riding = false
  let two: Bike = moto
  /** (the thrown rider's body, for the camera) */
  const bailAt = new GFX.Vector3()
  // THE CHARACTER ON FOOT (Character.ts — 2026-11-05): F gets out of the car (the driver's door opens) or off a bike,
  // and back in / on
  const hero = new Character(map, physics, atmos, shadow, env.farGrid)
  await hero.load(charUrl)
  // (its feet on what's solid under them: the terrain or a slab's top)
  // (from the terrain's own height: the slab's top if one stands there, else the terrain — asked from above, it
  //  answered with the height it was asked from)
  // (from the hips down: the first solid thing under the foot — the cave's floor stands over the land; at the land's
  //  height the feet reached down into it, 2026-11-07, the user: "inside, the human goes under the terrain")
  hero.ground = (x, z, y0) => physics.surface(x, z, map.height(x, z), y0)
  scene.add(hero.root, hero.shadowMesh)
  let onFoot = false
  /** (?chardraw=0: the character never drawn — the cost A/B) */
  const charHidden = q.get('chardraw') === '0'
  /** A scripted moment (getting in or out of the car): run each frame until it clears itself. */
  let cut: ((dt: number) => void) | null = null
  /** Where the driver's door is going (0 shut, 1 open) — eased each frame. */
  let doorTo = 0
  /** The CAMERA while getting in or out (GTA's): outside the driver's door, a little behind it, looking at the door —
   *  the chase camera, following the character in the seat, was stopped by the car's body and sat inside it. */
  let doorCam = 0
  const doorCamFrom = new GFX.Vector3(), doorCamLook = new GFX.Vector3()
  // FIRST PERSON (V): the eye in the head — the driver's in the car (his hands on the wheel in view), the rider's on a
  // bike, the character's on foot; the mouse (or a finger's drag) looks round (in a vehicle it eases back ahead a moment after)
  let fpp = false, fppClass = false
  const look ={ yaw: 0, pitch: 0, idle: 9, footYaw: 0 }
  {
    let dragId = -1, lx = 0, ly = 0
    // (the mouse: just moving it — mouseLook.ts; a finger drags)
    onMouseLook((dx, dy) => {
      if (!fpp) return
      // (in the scope: slower by the lens's share — a hand's move covers the same of the glass)
      const k = 0.0035 * (arsenal.scopeFov ?? 55) / 55
      if (onFoot) look.footYaw -= dx * k; else look.yaw = Math.atan2(Math.sin(look.yaw - dx * k), Math.cos(look.yaw - dx * k))
      look.pitch = Math.max(-1.2, Math.min(1.5, look.pitch - dy * k))
      look.idle = 0
    })
    renderer.domElement.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest?.('.oth-touch') || e.pointerType === 'mouse') return; dragId = e.pointerId; lx = e.clientX; ly = e.clientY })
    window.addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragId = -1 })
    window.addEventListener('pointermove', (e) => {
      if (!fpp || e.pointerId !== dragId) return
      const k = 0.0045
      if (onFoot) look.footYaw -= (e.clientX - lx) * k; else look.yaw -= (e.clientX - lx) * k
      look.pitch = Math.max(-1.2, Math.min(1.5, look.pitch - (e.clientY - ly) * k))
      look.idle = 0
      lx = e.clientX; ly = e.clientY
    })
  }
  const qYaw = new GFX.Quaternion(), qPitch = new GFX.Quaternion(), UP = new GFX.Vector3(0, 1, 0), RIGHT = new GFX.Vector3(1, 0, 0), eye = new GFX.Vector3()
  const eyeOff = new GFX.Vector3(), eyeAvg = new GFX.Vector3()
  let eyeAvgOn = false
  const FPP_TILT = num('fpptilt', 0.24), FPP_FOV = num('fppfov', 62)
  const fppOff = new GFX.Vector3(0, 1.66, -0.05)
  const placeFpp = (dt: number) => {
    if (!onFoot) eyeAvgOn = false
    look.idle += dt
    if (!onFoot && look.idle > 1.2) { const k = Math.min(1, dt * 3); look.yaw -= look.yaw * k; look.pitch -= look.pitch * k }
    // (a jolt, in first person: the view rattled a degree or two, dying away)
    let jp = 0, jy = 0
    if (fppJolt > 0.004) { fppJoltT += dt; jp = Math.sin(fppJoltT * 67) * 0.03 * fppJolt; jy = Math.sin(fppJoltT * 53 + 1.7) * 0.025 * fppJolt; fppJolt *= Math.exp(-dt * 9) } else fppJolt = 0
    qPitch.setFromAxisAngle(RIGHT, look.pitch + jp)
    if (onFoot) {
      // (his eyes — with the stride's bob and sway steadied as GTA's: 25 % of the head's swing round its 0.6 s
      //  average; a run's head bobs 16 cm)
      hero.headWorld(eye)
      eyeOff.copy(eye).sub(hero.pos)
      if (!eyeAvgOn) { eyeAvg.copy(eyeOff); eyeAvgOn = true }
      eyeAvg.lerp(eyeOff, Math.min(1, dt / 0.6))
      eye.copy(hero.pos).add(eyeAvg).addScaledVector(eyeOff.sub(eyeAvg), 0.25)
      qYaw.setFromAxisAngle(UP, look.footYaw + jy)
      hero.camYaw = look.footYaw
      camera.quaternion.copy(qYaw).multiply(qPitch)
    } else if (riding) {
      // (the rider's own eyes — the skinned character's head, leant with him; the view tipped down, as a rider looks
      // over the bars to the trail: the bars and his hands in the bottom of the frame)
      // (he sits up in first person — Character's FPP_SIT_UP — his eye behind the bars; with the 70° lens the view is
      //  tipped down to put the grips three-quarters of the way to its bottom edge: ~22° on the motorbike, more on the
      //  bicycle, whose bars sit lower under the eye)
      let tilt = 0.38
      if (hero.ridingOn(two.root) && !two.sim?.crashed) {
        hero.headWorld(eye)
        const lo = eye.clone().sub(two.root.position).applyQuaternion(two.root.quaternion.clone().invert()), g = two.riderT.grips[0]
        tilt = Math.max(0.3, Math.min(0.6, Math.atan2(lo.y - g[1], Math.max(0.05, lo.z - g[2])) - 0.75 * (35 * Math.PI) / 180))
      } else two.headWorld(eye)
      qYaw.setFromAxisAngle(UP, two.heading + look.yaw)
      qPitch.setFromAxisAngle(RIGHT, look.pitch - tilt)
      camera.quaternion.copy(qYaw).multiply(qPitch)
    } else {
      if (hero.seated) hero.headWorld(eye)
      else { const d = car.driverDoor; eye.copy(d ? d.seat : new GFX.Vector3(-0.4, 1.5, 0)).setY((d ? d.seat.y : 1.5) + 0.62).applyQuaternion(car.root.quaternion).add(car.root.position) }
      // (the eye kept under the roof lining: car space, clamped, back)
      const inv = car.root.quaternion.clone().invert(), lo = eye.clone().sub(car.root.position).applyQuaternion(inv)
      lo.y = Math.min(lo.y, car.roofY - 0.2)
      eye.copy(lo).applyQuaternion(car.root.quaternion).add(car.root.position)
      qYaw.setFromAxisAngle(UP, look.yaw)
      // (THE DRIVER'S VIEW TIPPED DOWN — 2026-11-16, the user: "in first person … no speedometer, nothing": the eye
      //  looked level, the top third of the frame the roof's lining and the dash wholly under it. Tipped ~14° — with
      //  the wider lens below — the wheel and the instruments behind it sit in the bottom of the view, the road still
      //  in its middle. `?fpptilt=` rad, `?fppfov=` °.)
      qPitch.setFromAxisAngle(RIGHT, look.pitch - FPP_TILT)
      camera.quaternion.copy(car.root.quaternion).multiply(qYaw).multiply(qPitch)
    }
    camera.position.copy(eye)
    camera.updateMatrixWorld()
    // (on foot: the eye from his feet — what he holds in first person is placed from it as he's posed next, Weapons.ts)
    if (onFoot) fppOff.copy(eye).sub(hero.pos)
  }
  /** The driver in his seat (the character seen through the windows — and his hands on the wheel in first person): his
   *  hips set from the steering wheel (behind and under its hub), his hands at ten to two on its rim, turning with it. */
  let seatedIn = ''
  const shiftHand = new GFX.Vector3()
  const seatDriver = () => {
    const rim = car.wheelRim, d = car.driverDoor
    // (under the roof: a low car — the E30 — sits the driver lower, his head clear of it)
    // (his hips in the SEAT: the kit's cars say where — `seatHip`: their wheel sits lower than the seat was once measured
    //  from; else under the hub, as it was)
    const hipY = vehicleDef(car.id).seatHip ?? (rim ? rim.hub.y - 0.36 : 0)
    const hips = rim ? new GFX.Vector3(rim.hub.x, Math.min(hipY, car.roofY - 0.92), rim.hub.z + 0.5) : d ? d.seat.clone() : null
    if (!hips) return
    hero.sitIn(car.root, hips, () => {
      const r = car.wheelRim
      if (!r) return null
      const a = r.axis, up = new GFX.Vector3(0, 1, 0).addScaledVector(a, -a.y).normalize(), right = new GFX.Vector3().crossVectors(a, up).normalize()
      const turn = Math.max(-1.4, Math.min(1.4, car.steerWheel))
      const hands = [150, 30].map((deg) => {
        const t = (deg * Math.PI) / 180 - turn
        return r.hub.clone().addScaledVector(right, Math.cos(t) * r.r).addScaledVector(up, Math.sin(t) * r.r)
      }) as [GFX.Vector3, GFX.Vector3]
      // THE GEAR CHANGE (2026-11-16, Cockpit.ts): his right hand leaves the wheel for the lever's knob as the box
      // shifts — down on it while it goes through the gate — and comes back
      const gr = car.shiftGrip
      if (gr && gr.k > 0.001) { const k = gr.k * gr.k * (3 - 2 * gr.k); hands[1].lerp(shiftHand.copy(gr.pos).setY(gr.pos.y + 0.02), k) }
      return hands
    })
    seatedIn = car.id
  }
  const placeDoorCam = (dt: number) => {
    const d = car.driverDoor
    if (!d) return false
    const at = new GFX.Vector3(d.hinge.x, d.hinge.y + 0.2, d.hinge.z + d.length * 0.6).applyQuaternion(car.root.quaternion).add(car.root.position)
    const out = new GFX.Vector3(-1, 0, 0).applyQuaternion(car.root.quaternion), back = new GFX.Vector3(0, 0, 1).applyQuaternion(car.root.quaternion)
    const want = at.clone().addScaledVector(out, 3.6).addScaledVector(back, 2.2)
    want.y = Math.max(want.y + 0.6, map.height(want.x, want.z) + 1.4)
    doorCam = Math.min(1, doorCam + dt / 0.5)
    const k = doorCam * doorCam * (3 - 2 * doorCam)
    camera.position.lerpVectors(doorCamFrom, want, k)
    doorCamLook.copy(at); doorCamLook.y -= 0.2
    camera.lookAt(doorCamLook)
    camera.updateMatrixWorld()
    return true
  }
  /** WHAT THE PLAYER IS ON — the car, or the bike while riding: the cameras, the map and the GPS, the
   *  pickups, the camp, the saved spot follow it. */
  const ride = {
    // (thrown off the bike: the camera follows the rider's body, not the bike — GTA's)
    get pos(): GFX.Vector3 { const bl = riding ? two.sim?.bail : null; return onFoot ? hero.pos : bl ? bailAt.set(bl.x, bl.y - 0.9, bl.z) : riding ? two.pos : car.pos },
    get sim() { return onFoot ? hero.sim : riding ? two.sim : car.sim },
    get heading(): number { return onFoot ? hero.heading : riding ? two.heading : car.sim?.heading ?? 0 },
    get speedKmh(): number { return onFoot ? hero.speed * 3.6 : riding ? two.speedKmh : car.speedKmh },
    get gear(): string { return onFoot ? '' : riding ? two.gear : car.gear },
    get body() { return onFoot ? (hero.rigid as typeof car.sim.body | undefined) : riding ? two.sim?.body : car.sim?.body },
    grounded: (): boolean => (onFoot ? hero.isGrounded() : riding ? two.grounded() : car.grounded()),
  }
  // (B in solo play: building is co-op's — a world on the server holds the land)
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.code === 'KeyB' && !e.repeat && !coop && !pause && !document.querySelector('.oh-front')) toast('Building needs a co-op world — CO-OP on the title screen', 3500) })
  // CO-OP: the session (null: playing alone), and what we are this frame for it — Coop.ts
  let coop: Coop | null = null
  /** (co-op) hooks our car's damage to the wire — again whenever the car is changed (a new car, a new CarDamage). */
  let coopTellDamage: (() => void) | null = null
  /** (co-op) s left till our car is set down clear of the others' (everyone starts on one track: the last to come stood
   *  in the others' cars) — once their poses are in. */
  let coopSpread = 0
  const spreadOut = () => {
    if (!coop || !car.sim || onFoot || riding || cut || car.speedKmh > 3) return
    const occ = coop.remotes.occupied(), half = car.half, me = Math.hypot(half.x, half.z)
    const clash = (x: number, z: number) => occ.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + me + 1)
    if (!clash(car.pos.x, car.pos.z)) return
    const h = car.sim.heading, P = car.pos
    for (const [sx, sz] of [[7, 0], [-7, 0], [14, 0], [-14, 0], [0, 12], [0, -12], [7, 12], [-7, 12], [21, 0], [-21, 0], [7, -12], [-7, -12], [28, 0], [-28, 0]] as [number, number][]) {
      const x = P.x + Math.cos(h) * sx + Math.sin(h) * sz, z = P.z - Math.sin(h) * sx + Math.cos(h) * sz
      if (clash(x, z) || !clearAt(x, z, half.x + 0.4) || map.waterAt(x, z) !== null) continue
      car.placeAt(x, z, h)
      return
    }
  }
  /** THE COMPANION (Companion.ts — SETTINGS › PLAY, off by default; `?companion=friend|enemy`): an NPC, solo play
   *  only — a FRIEND who walks with you, rides with you or follows in his own car, or an ENEMY who fights you on foot
   *  and rams your car. Made below, once getting in and out is. */
  let companion: Companion | null = null
  /** THE WEAPONS lying in the ruins (Weapons.ts — made below, with what's in your hands). */
  let pickups: Pickups | null = null
  /** Gathering on foot (Gather.ts) — a co-op world's. */
  let gather: Gather | null = null
  let ground: GroundEdits | null = null
  const coopQ = new GFX.Quaternion(), coopUp = new GFX.Vector3(0, 1, 0), coopQ2 = new GFX.Quaternion(), coopX = new GFX.Vector3(1, 0, 0)
  const coopLocal: Local = { kind: Kind.Jeep, p: new GFX.Vector3(), q: new GFX.Quaternion(), parked: null, trailer: null }
  /** Our trailer (Trailer.ts) — a co-op world's: hauling what's gathered. */
  let trailer: Trailer | null = null
  /** THE TRAILER SET DOWN BEHIND THE CAR ONCE THE CAR STANDS (`trailerDue`, how long it has stood: `trailerStill`). The
   *  car is placed in the air and drops (Vehicle.placeAt), and the tow ball is found from the ground under it
   *  (Trailer.ensureBall): set down while the car still fell — the second player's, placed along the track as its
   *  trailer loaded — the ball was 0.6 m low in the car, the coupler forced into the ground as it landed: the pair
   *  thrown up a metre and the car rolled over, 2 joins in 5 (scripts/harness/spawnprobe.mjs, 2026-11-24 — "the
   *  joiner's car rocks", MULTIPLAYER.md §7). Again whenever the car is put somewhere else hitched (it was dragged
   *  there by the joint). */
  let trailerDue: Trailer | null = null, trailerStill = 0
  /** THE HELPER BOT (Bot.ts — SETTINGS › CO-OP, ?bot=1): a second player from this tab, in a co-op world in the valley.
   *  (?botspeed=N: everything N times faster — the harness; ?botlog=1: what he does, in the console) */
  let bot: Bot | null = null
  const startBot = () => {
    if (bot || !coop || coop.session.closed) return
    const log = q.get('botlog') === '1' ? (m: string) => console.info(m) : undefined
    bot = new Bot({ owner: coop.session, world: () => ({ map: world.map, trees: world.trees, rocks: world.rocks }), near: () => ride.pos, speed: num('botspeed', 1), first: num('botfirst', -1), log })
  }
  const stopBot = () => { void bot?.stop(); bot = null }
  let towCam = false
  const coopParked = { kind: Kind.Jeep as Kind, p: new GFX.Vector3(), q: new GFX.Quaternion() }
  const localNow = (): Local => {
    const L = coopLocal
    const out = onFoot || riding
    // (which car is ours: the others draw that one — sent when it changes, and to each who joins: Session.ride)
    if (car.id) coop?.session.ride(car.id)
    // (on foot with the gun up: the others raise it on our walker, at our aim's pitch — the rotation's)
    L.aim = onFoot && !cut && arsenal.aiming && arsenal.aimK > 0.5
    if (onFoot) { L.kind = Kind.Foot; L.p.copy(hero.pos); L.q.copy(coopQ.setFromAxisAngle(coopUp, hero.heading)); if (L.aim) L.q.multiply(coopQ2.setFromAxisAngle(coopX, arsenal.aimPitch)) }
    else if (riding) { L.kind = Kind.Moto; L.p.copy(two.root.position); L.q.copy(two.root.quaternion) }
    else { L.kind = carKind(car.id); L.p.copy(car.root.position); L.q.copy(car.root.quaternion) }
    if (out && car.sim) { coopParked.kind = carKind(car.id); coopParked.p.copy(car.root.position); coopParked.q.copy(car.root.quaternion); L.parked = coopParked }
    else L.parked = null
    L.trailer = trailer?.pose() ?? null
    return L
  }
  // the tyres' dust and the exhaust smoke
  const dust = new Dust(map, atmos, tier)
  scene.add(dust.mesh)
  // CAR DAMAGE (Damage.ts — docs/DAMAGE.md; SETTINGS › PLAY, `?damage=0`): what a crash throws off, the engine's smoke,
  // the fire — the cars' own state is theirs (Vehicle.damage, the companion's car's)
  const damageFx = DAMAGE_ON ? new DamageFx(scene, map, atmos, shadow, env.farGrid, dust) : null
  const tyreTracks = new TyreTracks(map, tier, atmos)
  scene.add(tyreTracks.mesh)
  // THE WINCH AND ITS TOW ROPE (Winch.ts — 2026-11-25: by hand, onto another player's car; no more onto trees)
  let coopWinch: { carOf: (sid: number) => TowCar | null; walkerOf: (sid: number) => Character | null } | null = null
  const winch = new Winch({
    hero, car, map: () => world.map,
    onFoot: () => onFoot && !riding && !cut && !pause && driving,
    inCar: () => driving && !onFoot && !riding && !cut && !!car.sim,
    getOut: (then) => getOut(then),
    session: () => (coop && !coop.session.closed ? coop.session : null),
    carOf: (sid) => coopWinch?.carOf(sid) ?? null,
    walkerOf: (sid) => coopWinch?.walkerOf(sid) ?? null,
    toast: (m) => toast(m),
    // THE SEALED VAULTS' KEYSTONES (Wardens.ts): what else the hook goes on — pulled out, the vault's door falls
    extra: () => (world.wardens?.keystones() ?? []).filter((k) => (k.x - car.root.position.x) ** 2 + (k.z - car.root.position.z) ** 2 < 60 * 60).map((k) => ({
    x: k.x, y: k.y, z: k.z, what: 'the keystone',
    onPulled: () => {
      const w = world.wardens
      if (!w?.openVault(k.site)) return
      physics.propsDirty()
      const pay = REWARD.place * 4, [n, all] = w.vaultCount
      journal.coins += pay
      keepJournal()
      readouts.coins(journal.coins, pay)
      toast(`The keystone comes free — ${k.name} stands open   +${pay} ◆   ${n} / ${all}`, 6000)
      audio.chime()
    },
  })),
  }, ropeUrl)
  winch.setLook(weaponMaterial(atmos, shadow, env.farGrid))
  scene.add(winch.group)
  // THE MAP, THE RADAR and THE GPS (Nav.ts: the waypoint and the fastest way there — it lasts across worlds; the
  // chart, the map and the radar are each world's)
  const guide = new Guide()
  // (what an off-road leg must go round: this world's trunks and big boulders)
  const obstacles = (w: World) => () => {
    const o = new Obstacles(), d = w.trees.data
    for (let i = 0; i < w.trees.count; i++) o.add(d[i * TREE_STRIDE], d[i * TREE_STRIDE + 2], 0.6)
    w.rocks.each((k) => { if (k.s > 1.3) o.add(k.x, k.z, 0.55 * k.s) })
    // (and the PLACES — the cabins, the ruins, the towers, the camps: an off-road leg goes round a building, not through
    //  it — 2026-11-11, the autopilot drove the route into the Old Hut's wall)
    for (const l of w.places) if (l.r > 0) o.add(l.x, l.z, Math.min(14, l.r * 0.8 + 1))
    return o
  }
  guide.setWorld(world.id, world.map, obstacles(world))
  guide.onArrive = (w) => { toast(`Arrived · ${w.name}`, 3200); audio.chime() }
  // THE AUTOPILOT (Autopilot.ts — 2026-11-11, the user: "an option to turn on autopilot and off, so it will safely go
  // there"): it drives the 4×4 along the GPS's route; O, the action wheel, the button over the speed. The player's
  // hands on the controls take it back
  const autopilot = new Autopilot(guide, physics.pw, (x, z) => world.map.height(x, z))
  autopilot.onMessage = (m) => toast(m, 2600)
  car.pilot = (dt, sim, manual, up) => autopilot.drive(dt, sim, manual, up)
  // (its reset — the R key's: back on its wheels where it is, on what's under it — facing along the route)
  autopilot.resetCar = (heading) => {
    const s = car.sim
    if (!s) return
    const t = s.body.translation()
    physics.follow(t.x, t.z)
    s.place(t.x, physics.surface(t.x, t.z, Math.max(world.map.height(t.x, t.z), t.y - 1.5)) + 0.8, t.z, heading)
  }
  const toggleAutopilot = () => {
    if (!autopilot.on && (!driving || riding || onFoot)) { toast('Autopilot drives the 4×4 — get in first'); return }
    autopilot.toggle()
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyO' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !pause) toggleAutopilot() })
  const chartSize = isMobileDevice() ? 768 : 1024
  /** Who and what the map and the minimap mark: the others (co-op) or the companion, the weapons' places — one list,
   *  filled again each time it's asked for (every frame, by the minimap: no new arrays). */
  const othersOut: { x: number; z: number; heading: number; colour: string; name: string; site?: boolean }[] = []
  const others = () => {
    othersOut.length = 0
    const who = coop?.remotes.list ?? companion?.list, marks = pickups?.marks()
    if (who) for (const o of who) othersOut.push(o)
    if (marks) for (const o of marks) othersOut.push(o)
    return othersOut
  }
  const charts = (w: World) => {
    const chart = new Chart(w.map, chartSize)
    const o = { world: w.id, lm: w.landmarks, meta: w.map.meta, chart, guide, camera, carPos: () => ride.pos, carHeading: () => ride.heading, myCamp: () => myCamp, perfMarks: () => (perf.on ? perf.marks : []), others, claims: () => coop?.claims.list ?? [] }
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
  }
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggleRadar() })
  const chase = new ChaseCam(camera, map, ride, renderer.domElement)
  // (the chase camera stops in front of the rock: a ray from the car out to it, against the slab stacks, formations,
  //  ramps and bridges — StaticMesh — never the car itself)
  {
    let ray: InstanceType<typeof physics.pw.R.Ray> | null = null
    // (and the cars: on foot the camera stops in front of the 4×4 too — its own body is left out while driving)
    const camGroups = group(0xffff, Groups.StaticMesh | Groups.VehicleMesh)
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
  // (the haze's floor — the frame loop, before atmos.update)
  const mistHs = new Float64Array(25)
  /** The grade's strength (`?grade=`, 1 the default). */
  const GRADE_K = num('grade', 1)
  let mistInit = false
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
  const bringCar = (unpark: boolean) => bringCarTo(two.pos.x, two.pos.z, two.heading, unpark)
  const bringCarTo = (px: number, pz: number, h: number, unpark: boolean) => {
    const p = { x: px, z: pz }, half = car.half
    const at = besides(p.x, p.z, h, [[half.x + 1.6, 0], [-(half.x + 1.6), 0], [0, half.z + 2], [0, -(half.z + 2)]], half.x + 0.4) ?? { x: p.x + Math.cos(h) * 4, z: p.z - Math.sin(h) * 4 }
    if (unpark) car.unpark({ x: at.x, z: at.z, heading: h })
    else car.placeAt(at.x, at.z, h)
  }
  const NAME = (_b: Bike) => 'motorbike'
  /** Onto `which` from the car (it parks), straight across from the other two-wheeler (left where it stood), or back
   *  in the car from it (the car brought to you from > 15 m away). */
  const toggleRide = (which: Bike = moto) => {
    if (!car.sim || !which.makeSim || cut) return
    if (onFoot) {
      // on foot: onto it where it's parked (near), or off the car beside you (it's carried on it)
      const pk = which.parkedAt
      const near = pk && Math.hypot(pk.x - hero.pos.x, pk.z - hero.pos.z) < 2.6
      const carNear = Math.hypot(car.pos.x - hero.pos.x, car.pos.z - hero.pos.z) < 14
      if (!near && !carNear) { toast(`The ${NAME(which)} is ${pk ? 'parked where you left it' : 'on the car'}`); return }
      const at = near ? pk! : besides(hero.pos.x, hero.pos.z, hero.heading, [[1.0, 0], [-1.0, 0], [0, -1.4]], 0.7) ?? { x: hero.pos.x, z: hero.pos.z, heading: hero.heading }
      hero.hide(); onFoot = false; winch.keysOn = false
      which.mount(at.x, at.z, near ? pk!.heading : hero.heading)
      two = which
      riding = true
      chase.frame(which === moto ? 6.2 : 5.2, which === moto ? 1.4 : 1.25)
      chase.snap()
      return
    }
    if (riding && two !== which) {
      if (two.speedKmh > 8) { toast(`Stop to change to the ${NAME(which)}`); return }
      const h = two.heading, p = two.pos
      const at = besides(p.x, p.z, h, [[1.2, 0], [-1.2, 0], [0, 1.6]], 0.7) ?? { x: p.x, z: p.z }
      two.dismount()
      which.mount(at.x, at.z, h)
      two = which
      chase.frame(which === moto ? 6.2 : 5.2, which === moto ? 1.4 : 1.25)
      chase.snap()
      return
    }
    if (!riding) {
      if (car.speedKmh > 8) { toast(`Stop the car to take the ${NAME(which)}`); return }
      const h = car.sim.heading, p = car.pos, half = car.half
      const at = besides(p.x, p.z, h, [[half.x + 1.1, 0], [-(half.x + 1.1), 0], [0, half.z + 1.6], [0, -(half.z + 1.6)]], 0.9)
      if (!at) { toast(`No room here for the ${NAME(which)}`); return }
      car.park()
      hero.hide() // (out of the driver's seat: the bike has its own rider)
      which.mount(at.x, at.z, h)
      two = which
      riding = true
      chase.frame(which === moto ? 6.2 : 5.2, which === moto ? 1.4 : 1.25)
      chase.snap()
    } else {
      const far = Math.hypot(two.pos.x - car.pos.x, two.pos.z - car.pos.z) > 15
      if (far) bringCar(true)
      else car.unpark()
      two.dismount()
      riding = false
      chase.frame(9, 1.6)
      chase.snap()
      winch.keysOn = true
      toast(far ? 'Your 4×4 is brought to you' : 'Back in the 4×4')
    }
  }
  const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k) }
  const toWorld = (v: GFX.Vector3) => v.clone().applyQuaternion(car.root.quaternion).add(car.root.position)
  /** Model space (heading h) → world offset along the ground. */
  const rot = (x: number, z: number, h: number): [number, number] => [x * Math.cos(h) + z * Math.sin(h), -x * Math.sin(h) + z * Math.cos(h)]
  const footCam = () => { chase.frame(4.2, 1.45); chase.snap(); look.footYaw = hero.heading }
  /** F: OUT of the car (stopped — the driver's door opens, the character climbs out) or off the bike (parked there). */
  const getOut = (then?: () => void) => {
    if (cut || onFoot || !car.sim) return
    if (riding) {
      if (two.speedKmh > 8) { toast('Slow down to get off'); return }
      const h = two.heading, p = two.pos.clone()
      two.park()
      riding = false
      const at = besides(p.x, p.z, h, [[-0.85, 0], [0.85, 0], [0, 1.2]], 0.35) ?? { x: p.x - Math.cos(h) * 0.85, z: p.z + Math.sin(h) * 0.85 }
      hero.appear(at.x, at.z, h, undefined, p.y + 1.5)
      onFoot = true
      footCam()
      then?.()
      return
    }
    if (car.speedKmh > 5) { toast('Stop the car to get out'); return }
    car.park()
    winch.keysOn = false
    const d = car.driverDoor, h = car.sim.heading
    if (!d || !hero.has('car_exit')) {
      const p = car.pos, half = car.half
      const at = besides(p.x, p.z, h, [[-(half.x + 0.8), 0], [half.x + 0.8, 0]], 0.4) ?? { x: p.x - Math.cos(h) * (half.x + 0.8), z: p.z + Math.sin(h) * (half.x + 0.8) }
      hero.appear(at.x, at.z, h, undefined, p.y + 1.5); onFoot = true; footCam(); then?.(); return
    }
    // the clip starts seated: its hips put on the driver's seat; it climbs out to the left (out of the door)
    const seat = toWorld(d.seat), [hx, hy, hz] = hero.hipsAt('car_exit', 0)
    const [ox, oz] = rot(hx, hz, h), x0 = seat.x - ox, z0 = seat.z - oz, y0 = seat.y - hy
    const e = hero.hipsAt('car_exit', 1), [ex, ez] = rot(e[0], e[2], h)
    const gy = physics.surface(x0 + ex, z0 + ez, map.height(x0 + ex, z0 + ez), car.pos.y + 1.5)
    hero.stage(x0, y0, z0, h)
    onFoot = true
    chase.frame(4.8, 1.4)
    hero.play('car_exit', { fade: 0, rate: 1.3, then: () => {
      const tr = hero.travel(), [tx, tz] = rot(tr.dx, tr.dz, h)
      hero.appear(x0 + tx, z0 + tz, h + tr.yaw, undefined, car.pos.y + 1.5)
      doorTo = car.doorOpen = 0
      // (then he turns to face along the car — GTA's: the camera comes round behind him down its flank, never into it)
      cut = (dt) => {
        let dh = h - hero.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        hero.heading += Math.max(-dt * 7, Math.min(dt * 7, dh))
        if (Math.abs(dh) < 0.02) { cut = null; then?.() }
      }
    } })
    // IN STEP WITH THE CLIP (the left hand's path in it — 2026-11-05, the user: "the door and the animation aren't
    // synced"): the hand pushes the door open over 7–27 % of it, the body leaves the seat over 34–55 % (the clip's car
    // is lower than the 4×4: the step down to the ground there), the hand pushes it shut from outside over 62–74 %
    cut = () => {
      const p = hero.progress
      doorTo = car.doorOpen = smooth((p - 0.07) / 0.2) * (1 - smooth((p - 0.62) / 0.12))
      hero.pos.y = y0 + (gy - y0) * smooth((p - 0.34) / 0.21)
    }
  }
  /** F on foot: onto a parked bike close by, else INTO the car from its driver's door (walk up to it). */
  const getIn = () => {
    if (cut || !onFoot || hero.state !== 'move' || !car.sim) return
    winch.letGo() // (the hook in your hand: let go, wound back in)
    const fb = fallenNear()
    if (fb) { pickUp(fb); return }
    for (const b of twos) if (b.parkedAt && Math.hypot(b.parkedAt.x - hero.pos.x, b.parkedAt.z - hero.pos.z) < 2.3) { clearFallen(); toggleRide(b); return }
    const d = car.driverDoor, h = car.sim.heading
    const doorAt = d ? toWorld(new GFX.Vector3(d.hinge.x - 0.4, d.hinge.y, d.hinge.z + d.length * 0.5)) : car.pos
    if (Math.hypot(doorAt.x - hero.pos.x, doorAt.z - hero.pos.z) > (d ? 3.2 : 4.5)) return
    clearFallen()
    if (!d || !hero.has('car_enter')) { hero.hide(); onFoot = false; car.unpark(); winch.keysOn = true; chase.frame(9, 1.6); chase.snap(); return }
    // the clip starts facing the car's side and ends seated: its end put on the driver's seat
    const hs = h - Math.PI / 2, seat = toWorld(d.seat), e = hero.hipsAt('car_enter', 1)
    const [ex, ez] = rot(e[0], e[2], hs), x0 = seat.x - ex, z0 = seat.z - ez
    const gy = physics.surface(x0, z0, map.height(x0, z0)), y1 = seat.y - e[1]
    // a few steps to the start, then the clip
    const fx = hero.pos.x, fz = hero.pos.z, fh = hero.heading
    hero.stage(fx, hero.pos.y, fz, fh)
    hero.play('walk', { fade: 0.15 })
    let t = 0
    const walkT = Math.max(0.25, Math.hypot(x0 - fx, z0 - fz) / 1.7)
    // (walking there facing the way it goes, turned to the car on the last steps)
    const go = Math.atan2(-(x0 - fx), -(z0 - fz))
    cut = (dt) => {
      t += dt
      const k = smooth(t / walkT), q = smooth((t / walkT - 0.6) / 0.4)
      const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
      hero.pos.set(fx + (x0 - fx) * k, gy, fz + (z0 - fz) * k)
      const h1 = Math.hypot(x0 - fx, z0 - fz) > 0.3 ? go : fh
      hero.heading = fh + wrap(h1 - fh) * Math.min(1, t / 0.25) + wrap(hs - h1) * q
      if (t < walkT) return
      hero.heading = hs
      hero.play('car_enter', { fade: 0.2, rate: 1.3, then: () => {
        onFoot = false; doorTo = car.doorOpen = 0; cut = null
        seatDriver()
        car.unpark(); winch.keysOn = true
        chase.frame(9, 1.6); chase.snap()
      } })
      // in step with the clip: the hand pulls the door open over 12–30 %, the body climbs up and sits over 36–55 %,
      // the hand pulls it shut over 60–75 %
      cut = () => {
        const p = hero.progress
        doorTo = car.doorOpen = smooth((p - 0.12) / 0.18) * (1 - smooth((p - 0.6) / 0.15))
        hero.pos.y = gy + (y1 - gy) * smooth((p - 0.36) / 0.19)
      }
    }
  }
  /** THE BAIL (2026-11-05, GTA's): thrown off, the rider tumbles with the crash's body (Character follows it); come to
   *  rest, he GETS UP — off his back or his front, as he lies (Mixamo's get-ups: the lying start laid where the body
   *  lies, his head where its head is) — and you're on foot, the bike lying where it fell (F by it: back on). */
  let bailT = 0, bailSlow = 0, rising = false
  const bailPrev = new GFX.Vector3()
  const watchBail = (dt: number) => {
    const bl = riding && !cut ? two.sim?.bail : null
    if (!bl) { bailT = bailSlow = 0; return }
    const v = bailT > 0 ? Math.hypot(bl.x - bailPrev.x, bl.y - bailPrev.y, bl.z - bailPrev.z) / Math.max(1e-3, dt) : 9
    bailPrev.set(bl.x, bl.y, bl.z)
    bailT += dt
    bailSlow = v < 0.8 ? bailSlow + dt : 0
    if ((bailT > 0.9 && bailSlow > 0.35) || bailT > 4) getUp(bl)
  }
  const getUp = (bl: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }) => {
    const q = new GFX.Quaternion(bl.qx, bl.qy, bl.qz, bl.qw)
    const face = new GFX.Vector3(0, 0, -1).applyQuaternion(q), head = new GFX.Vector3(0, 1, 0).applyQuaternion(q)
    const name: ClipName = face.y > 0 ? 'getup_back' : 'getup_front'
    if (!hero.has(name)) { two.reset(); return }
    // (the clips' lying still before they move, and their standing after: the middle of each, played quicker)
    const t0 = name === 'getup_back' ? 1.9 : 1.25, t1 = 6.3
    const lie = hero.lieOf(name, t0)
    const h = Math.hypot(head.x, head.z) > 0.25 ? Math.atan2(-head.x, -head.z) - lie.headYaw : two.heading
    const [ox, oz] = rot(lie.hips[0], lie.hips[2], h)
    const x0 = bl.x - ox, z0 = bl.z - oz, y0 = physics.surface(x0, z0, map.height(x0, z0), bl.y + 1.5)
    riding = false
    onFoot = true
    rising = true
    winch.keysOn = false
    hero.stage(x0, y0, z0, h)
    const done = () => {
      if (!rising) return
      rising = false
      cut = null
      const tr = hero.travel(), [tx, tz] = rot(tr.dx, tr.dz, h)
      hero.appear(x0 + tx, z0 + tz, h + tr.yaw, undefined, bl.y + 1.5)
      look.footYaw = hero.heading
      chase.frame(4.2, 1.45)
    }
    hero.play(name, { fade: 0, at: t0, rate: 1.8, then: done })
    const endP = t1 / Math.max(1e-3, hero.clipLength(name))
    cut = () => { if (hero.progress >= endP) done() }
  }
  /** Back on a bike lying where it fell (F by it, on foot): stood up, ridden off. */
  const pickUp = (b: Bike) => {
    const p = b.pos.clone(), h = b.heading
    hero.hide(); onFoot = false; winch.keysOn = false
    b.mount(p.x, p.z, h)
    two = b; riding = true
    chase.frame(b === moto ? 6.2 : 5.2, b === moto ? 1.4 : 1.25); chase.snap()
  }
  const fallenNear = (): Bike | null => twos.find((b) => !!b.sim?.crashed && Math.hypot(b.pos.x - hero.pos.x, b.pos.z - hero.pos.z) < 2.6) ?? null
  /** A bike left lying (you went off in something else): stood where it lies, parked. */
  const clearFallen = (keep?: Bike) => { for (const b of twos) if (b !== keep && b.sim?.crashed && !(riding && two === b)) b.park() }
  /** THE GARAGE's pick taken where you are (2026-11-05, the user: "car to bike must be chosen where we choose the jeep
   *  and the BMW"): the car (another model swapped in; you're put in it — it's brought to you if it's far), or a
   *  two-wheeler (taken off the car beside you — on foot, beside you; the car parked where it is). */
  const applyRide = async (r: 'car' | 'moto', carId: string) => {
    if (cut || !car.sim) return
    clearFallen(r === 'moto' ? moto : undefined)
    if (r === 'car') {
      // (each car its own paint — settings `paints`; none: its factory colour)
      if (car.id !== carId) { car.paint = loadSettings().paints[carId] ?? null; await car.setCar(carId) }
      if (riding) { toggleRide(two); return }
      if (onFoot) {
        const p = hero.pos.clone(), h = hero.heading
        hero.hide(); onFoot = false
        if (Math.hypot(car.pos.x - p.x, car.pos.z - p.z) > 15) bringCarTo(p.x, p.z, h, true)
        else car.unpark()
        winch.keysOn = true
        chase.frame(9, 1.6); chase.snap()
      }
      return
    }
    const which = moto
    if (riding && two === which) return
    if (onFoot) {
      const at = besides(hero.pos.x, hero.pos.z, hero.heading, [[1.0, 0], [-1.0, 0], [0, -1.4]], 0.7) ?? { x: hero.pos.x, z: hero.pos.z }
      hero.hide(); onFoot = false; winch.keysOn = false
      which.mount(at.x, at.z, hero.heading)
      two = which; riding = true
      chase.frame(which === moto ? 6.2 : 5.2, which === moto ? 1.4 : 1.25); chase.snap()
      return
    }
    toggleRide(which)
  }
  /** What F would do now (null: nothing) — the touch screen's DOOR button and, on foot, the prompt. */
  const actionNow = (): string | null => {
    if (cut || !car.sim || !driving) return null
    if (onFoot) {
      if (hero.state !== 'move') return null
      if (fallenNear()) return 'Get on'
      for (const b of twos) if (b.parkedAt && Math.hypot(b.parkedAt.x - hero.pos.x, b.parkedAt.z - hero.pos.z) < 2.3) return 'Get on'
      const d = car.driverDoor
      const at = d ? toWorld(new GFX.Vector3(d.hinge.x - 0.4, d.hinge.y, d.hinge.z + d.length * 0.5)) : car.pos
      return Math.hypot(at.x - hero.pos.x, at.z - hero.pos.z) < (d ? 3.2 : 4.5) ? 'Get in' : null
    }
    if (riding) return two.speedKmh < 8 ? 'Get off' : null
    return car.speedKmh < 5 ? 'Get out' : null
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !driving || pause) return
    // (F — GTA's: out of / into what's nearest. Which vehicle you have is chosen in the GARAGE — 2026-11-05, the user)
    if (e.code === 'KeyF') { if (onFoot) getIn(); else getOut() }
    if (e.code === 'KeyR' && riding) two.reset()
    // (H: call the companion — to you on foot, into your car when you're stopped; J / U: a punch / a kick — the enemy's game)
    if (e.code === 'KeyH') companion?.call()
    if (e.code === 'KeyJ' && onFoot && !cut && !arsenal.current) companion?.attack('punch')
    if (e.code === 'KeyU' && onFoot && !cut && !arsenal.current) companion?.attack('kick')
  })
  /** Your car's PASSENGER seat (the companion's): the driver's mirrored across the car — his hips (car space) and the
   *  spot outside its door (world). */
  const passengerSeat = () => {
    if (!car.sim || riding) return null
    const rim = car.wheelRim, d = car.driverDoor
    const hipY = vehicleDef(car.id).seatHip ?? (rim ? rim.hub.y - 0.36 : 0)
    const hips = rim ? new GFX.Vector3(-rim.hub.x, Math.min(hipY, car.roofY - 0.92), rim.hub.z + 0.5) : d ? d.seat.clone().setX(-d.seat.x) : null
    if (!hips) return null
    const door = toWorld(d ? new GFX.Vector3(-(d.hinge.x - 0.5), d.hinge.y, d.hinge.z + d.length * 0.5) : new GFX.Vector3(car.half.x + 0.8, 0, 0))
    return { root: car.root as GFX.Object3D, hips, door, key: car.id, heading: car.sim.heading }
  }
  const yourBox = { x: 0, z: 0, hx: 1, hz: 2.2, yaw: 0 }
  const STILL = { x: 0, y: 0, z: 0 }
  const companionKind = (v: string | null | undefined): CompanionKind | null => (v === 'enemy' ? 'enemy' : v === 'friend' || v === '1' ? 'friend' : null)
  /** The companion as the setting says: made, changed (friend ↔ enemy) or sent away. Never in a co-op world. */
  const setCompanion = (kind: CompanionKind | null) => {
    if (!kind || coop || coopWorld) { companion?.dispose(); companion = null; return }
    if (companion) { companion.setKind(kind); return }
    companion = new Companion({
      onFoot: () => onFoot,
      riding: () => riding,
      playing: () => driving && !pause,
      pos: () => ride.pos,
      heading: () => ride.heading,
      speed: () => Math.abs(ride.speedKmh) / 3.6,
      car: () => (car.sim ? { id: car.id, root: car.root } : null),
      passenger: passengerSeat,
      toast: (m) => toast(m),
      jolt: (k, x, y, z) => jolt(k, x, y, z),
      you: () => hero,
      // (your vehicle's own box: the car's body about its root, turned as it stands; the bike a man's width)
      box: () => {
        const o = yourBox, h = ride.heading
        if (riding) { o.x = ride.pos.x; o.z = ride.pos.z; o.hx = 0.4; o.hz = 1.0 }
        else { const b = car.bodyBox, c = Math.cos(h), s = Math.sin(h); o.x = car.pos.x + c * b.cx + s * b.cz; o.z = car.pos.z - s * b.cx + c * b.cz; o.hx = b.hx; o.hz = b.hz }
        o.yaw = h
        return o
      },
      // (rammed, pushed: the body shoved on — a ram's a little up too, and spun about its height — by its own mass;
      //  a ram on the car: where it lands, for the damage — Vehicle.hitHint)
      shove: (dx, dz, dv, spin, at, by) => {
        const b = onFoot ? null : (ride.body as RapierBody | undefined)
        if (!b) return
        const m = b.mass()
        if (at && !riding) car.hitHint(at.x, at.y, at.z, by ?? null)
        // (a ram: the blow where his car met it — off its middle, it turns the car as such a blow does; a third of
        //  the way from its centre of mass's height to there: it does not stand it on its nose)
        if (at) { const c = b.worldCom(); b.applyImpulseAtPoint({ x: dx * dv * m, y: 0.06 * dv * m, z: dz * dv * m }, { x: at.x, y: c.y + (at.y - c.y) * 0.3, z: at.z }, true) }
        else b.applyImpulse({ x: dx * dv * m, y: 0, z: dz * dv * m }, true)
        if (spin) b.applyTorqueImpulse({ x: 0, y: spin * m * 1.5, z: 0 }, true)
      },
      // (his car on a body that is not what you're on — your parked car: live again for it, the blow placed there for
      //  its damage; anything else that can move: pushed)
      knock: (b, dx, dz, dv, at, by) => {
        if (car.sim && b.handle === car.sim.body.handle) { car.knocked(); car.hitHint(at.x, at.y, at.z, by) }
        if (!b.isDynamic()) return
        const m = b.mass(), c = b.worldCom()
        b.applyImpulseAtPoint({ x: dx * dv * m, y: 0.06 * dv * m, z: dz * dv * m }, { x: at.x, y: c.y + (at.y - c.y) * 0.3, z: at.z }, true)
      },
      vel: () => { const b = onFoot ? null : (ride.body as { linvel(): { x: number; y: number; z: number } } | undefined); return b ? b.linvel() : STILL },
      body: () => (onFoot ? null : ((ride.body as RapierBody | undefined) ?? null)),
    }, scene, map, physics, atmos, shadow, env.farGrid, charUrl, fightUrl, kind)
  }
  setCompanion(companionKind(q.get('companion')))
  // THE WEAPONS (Weapons.ts — docs/WEAPONS.md): what you've found, the one in your hands; `?weapons=all` has them all
  // for a test — nothing of it kept
  const arsenal = new Arsenal({
    onFoot: () => onFoot && !cut,
    playing: () => driving && !pause,
    // (co-op: the others on foot — a hit goes to the server; solo: the enemy)
    targets: () => (coop && !coop.session.closed ? coop.remotes.targets(hero.pos) : companion?.targets() ?? []),
    shot: (w, from, dir) => coop?.session.shot(w, from, dir),
    armed: (id) => coop?.session.arm(id ?? 'fists'),
    kick: (up, side) => { if (fpp) { look.pitch = Math.max(-1.2, Math.min(1.5, look.pitch + up)); look.footYaw += side } else chase.kick(up, side) },
    fpp: () => fpp && onFoot && !cut,
    lookYaw: () => look.footYaw,
    lookPitch: () => look.pitch,
    eye: () => fppOff,
    toast: (m) => toast(m),
    // (where a bullet stops: the dust it knocks out of the ground, the rock, the tree)
    impact: (x, y, z, who) => dust.puff(x, y, z, 0.22, who ? 2 : 4, who ? HIT_DUST : SHOT_DUST),
    // (a round that stops on a car — yours, his: Damage.ts)
    struck: (body, x, y, z, dx, dy, dz) => {
      if (car.sim && body === car.sim.body.handle) car.shot(x, y, z, dx, dy, dz)
      else if (companion?.carBody?.handle === body) companion.carBlow(x, y, z, dx, dy, dz, 0, true)
    },
    // (nothing in the hands: the phone's FIRE / AIM are a punch and a kick — the enemy's game)
    fists: (what) => { if (onFoot && !cut) companion?.attack(what === 'fire' ? 'punch' : 'kick') },
    fistsOn: () => companion?.kind === 'enemy',
  }, hero, camera, scene, map, physics, atmos, shadow, env.farGrid, saving && q.get('weapons') !== 'all')
  if (q.get('weaponsites') !== '0') pickups = new Pickups(arsenal, {
    onFoot: () => onFoot && !cut,
    pos: () => ride.pos,
    toast: (m, ms) => toast(m, ms),
    surface: (x, z) => physics.surface(x, z, map.height(x, z), map.height(x, z) + 8),
  }, world.landmarks.list, map.meta.spawn, map.half, world.id, scene, atmos, shadow, env.farGrid, saving && q.get('weapons') !== 'all')
  if (q.get('weapons') === 'all') {
    for (const id of ['pistol', 'ak47', 'sniper'] as WeaponId[]) arsenal.give(id)
  }
  const landH = (x: number, z: number): number => map.height(x, z)
  /** A JOLT felt — a ram, a blow that lands, a bolt (Companion.ts, Weapons.ts): the view shaken by k (0 … 1) — the chase
   *  camera's own shake; first person's a kick of the view that comes back — and the dust knocked up where it was. */
  let fppJolt = 0, fppJoltT = 0
  const jolt = (k: number, x: number, y: number, z: number) => {
    chase.shake(k)
    fppJolt = Math.max(fppJolt, k)
    if (k > 0.2) dust.puff(x, y, z, 0.5 + k, Math.round(3 + k * 6), SHOT_DUST)
  }
  const HIT_DUST: [number, number, number] = [0.42, 0.2, 0.17], SHOT_DUST: [number, number, number] = [0.5, 0.46, 0.4]
  // ------------------------------------------------------------------------------------------ car damage (Damage.ts)
  // YOUR CAR'S CRASH: felt — the view jolts by how hard, the thud —, and when it was against the companion's car (or
  // his ram on you) his car takes the same blow, the other way
  car.onCrash = (c) => {
    const k = Math.min(1, c.dv / 14)
    // (his ram has given its own jolt)
    if (!onFoot && !riding && !(companion && performance.now() / 1000 - companion.rammedAt < 0.15)) jolt(Math.max(0.25, k), c.x, c.y, c.z)
    audio.impact('crash', k)
    const his = companion?.carBody
    if (companion && his && (c.other?.handle === his.handle || performance.now() / 1000 - companion.rammedAt < 0.15)) companion.carBlow(c.x, c.y, c.z, -c.dx, -c.dy, -c.dz, c.dv)
  }
  /** THROWN OUT of your car as it goes up: on the ground beside it, down. */
  const blownOut = () => {
    if (onFoot || riding || cut || !car.sim) return
    car.park()
    winch.keysOn = false
    const p = car.pos, h = car.sim.heading, half = car.half
    const at = besides(p.x, p.z, h, [[-(half.x + 1.8), 0], [half.x + 1.8, 0]], 0.4) ?? { x: p.x - Math.cos(h) * (half.x + 1.8), z: p.z + Math.sin(h) * (half.x + 1.8) }
    hero.appear(at.x, at.z, h, undefined, p.y + 1.5)
    onFoot = true
    footCam()
    hero.knockdown(2.4)
  }
  if (damageFx) damageFx.onEvent = (dm, e, x, y, z) => {
    const mine = dm === car.damage
    if (e.kind === 'glass' || e.kind === 'lamp') audio.impact('glass', e.kind === 'lamp' ? 0.4 : 0.9)
    else if (e.kind === 'tyre') audio.impact('crash', 0.5)
    else if (e.kind === 'explode') {
      // THE BLAST: heard and felt; who is in the car is thrown out of it; what stands near takes it — the other car,
      // you on foot, him on foot
      audio.impact('boom')
      jolt(1, x, y, z)
      const R = DAMAGE.explosion.radius, X = DAMAGE.explosion
      const near = (px: number, pz: number) => Math.max(0, 1 - Math.hypot(px - x, pz - z) / R)
      if (mine) {
        blownOut()
        // (the shell thrown up a little, turning)
        const b = car.sim?.body
        if (b && !car.parked) { const m = b.mass(); b.applyImpulse({ x: 0, y: m * 3.5, z: 0 }, true); b.applyTorqueImpulse({ x: m * 0.8, y: m * 0.5, z: 0 }, true) }
        const cp = companion?.carShown ? companion.car.root.position : null
        if (companion && cp && near(cp.x, cp.z) > 0) { const d = Math.hypot(cp.x - x, cp.z - z) || 1; companion.carBlow(x + (cp.x - x) * 0.6, y, z + (cp.z - z) * 0.6, (cp.x - x) / d, 0.1, (cp.z - z) / d, X.pushDv * near(cp.x, cp.z)) }
      } else {
        companion?.carBlown()
        // (your car beside his: shoved off — its own crash watch makes the dent of it)
        const k = near(car.pos.x, car.pos.z), b = car.sim?.body
        if (k > 0 && b && !car.parked) { const d = Math.hypot(car.pos.x - x, car.pos.z - z) || 1, m = b.mass(); b.applyImpulse({ x: ((car.pos.x - x) / d) * m * X.pushDv * k, y: m * 1.5 * k, z: ((car.pos.z - z) / d) * m * X.pushDv * k }, true) }
      }
      companion?.blast(x, z, R, X.hurt)
      if (onFoot) {
        const k = near(hero.pos.x, hero.pos.z)
        if (k > 0.15) { hero.knockdown(1.6 + k); if (companion?.kind === 'enemy') companion.yours = Math.max(1, companion.yours - X.hurt * k) }
      }
    }
    if (!mine) return
    const W = dm.wheels[e.k]
    const say = e.kind === 'tyre' ? 'Tyre burst' : e.kind === 'axle' ? (W?.jam ? 'Axle broken — the wheel is jammed' : 'Axle bent') : e.kind === 'wheel' ? 'Wheel torn off'
      : e.kind === 'engine' ? (e.k === 1 ? 'Radiator hit — the engine is steaming' : e.k === 2 ? 'Engine damaged' : 'The engine is failing') : e.kind === 'dead' ? 'The engine is dead' : e.kind === 'fire' ? 'The engine is on fire — get out!'
      : e.kind === 'explode' ? 'The car is wrecked' : null
    if (say) toast(say, e.kind === 'fire' || e.kind === 'explode' ? 4200 : 2600)
  }
  const yourWheel = () => car.wheelPart, hisWheel = () => companion?.car.wheelPart ?? null
  let deadHint = 0
  /** REPAIR (the wheel; a rest at camp mends it for nothing): the car as it left the works, for what it costs — or
   *  for what you have. */
  const repairCar = () => {
    const dm = car.damage
    if (!dm || dm.whole) { toast('Nothing to repair'); return }
    if (car.speedKmh > 5) { toast('Stop the car to repair it'); return }
    const cost = Math.min(dm.cost, journal.coins)
    dm.repair()
    if (cost > 0) { journal.coins -= cost; keepJournal(); readouts.coins(journal.coins, -cost) }
    toast(cost > 0 ? `Car repaired   −${cost} ◆` : 'Car repaired')
  }
  /** (`?lodeye=0`: the scope as a bare lens — the A/B of LodEye.ts) */
  const LODEYE = q.get('lodeye') !== '0'
  /** (a harness's eye — scripts/harness/weaponshots.mjs) the frame drawn from [right, up, back] m off what's followed,
   *  in its own frame, looking `lookH` over its feet — while the game plays on with its own camera; null: off. */
  let spectate: { x: number; y: number; z: number; lookH: number } | null = null
  /** (the harness) a camera put anywhere for a frame's draw — from (px py pz) at (tx ty tz) — the play unchanged. */
  let specAt: [number, number, number, number, number, number] | null = null
  const specPos = new GFX.Vector3(), specQuat = new GFX.Quaternion(), specLook = new GFX.Vector3()
  let specOn = false
  // CO-OP'S FIGHT (docs/WEAPONS.md — the server owns the health): ours shown, a hit staggers us, down — out 5 s — then
  // back at our camp (or by our car, or the start) whole; the others' shots drawn (Arsenal.ghost); who downed whom told
  // to everyone
  const hpBar = document.createElement('div'), hpFill = document.createElement('div')
  hpBar.style.cssText = 'position:fixed;left:24px;bottom:72px;width:200px;height:10px;background:rgba(8,8,8,0.72);border:1px solid rgba(255,255,255,0.18);z-index:4;display:none;pointer-events:none'
  hpFill.style.cssText = 'height:100%;width:100%;background:#e0a040'
  hpBar.appendChild(hpFill)
  document.body.appendChild(hpBar)
  const drawHp = (hp: number) => {
    hpBar.style.display = hp < 100 ? 'block' : 'none'
    hpFill.style.width = `${Math.max(0, hp)}%`
    hpFill.style.background = hp < 30 ? '#d04030' : '#e0a040'
  }
  const WHAT: Record<WireWeapon, string> = { fists: '', pistol: 'the pistol', ak47: 'an AK-47', sniper: 'the sniper rifle' }
  const fightOn = (session: Session) => {
    if (arsenal.current) session.arm(arsenal.current)
    void hero.loadClips(fightUrl)
    session.on((e) => {
      const me = session.me.sid
      if (e.t === 'shot') { if (e.sid !== me) arsenal.ghost(e.weapon, new GFX.Vector3(e.x, e.y, e.z), new GFX.Vector3(e.dx, e.dy, e.dz)) }
      else if (e.t === 'health' && e.sid === me) {
        drawHp(e.hp)
        if (e.hp > 0 && onFoot && !cut && !hero.isDown) hero.strike(e.zone === 'head' ? 'hit_head' : 'hit_body', { force: true })
      } else if (e.t === 'down') {
        const w = WHAT[e.weapon], with_ = w ? ` with ${w}` : ''
        if (e.sid === me) { drawHp(0); arsenal.press('fire', false); if (onFoot && !cut) hero.knockdown(600); if (e.by) toast(`${e.by_name} downed you${with_} — back in 5 s`, 5000) }
        else if (e.by) toast(`${e.by === me ? 'You' : e.by_name} downed ${session.remotes.get(e.sid)?.name ?? 'someone'}${with_}`, 3500)
      } else if (e.t === 'up' && e.sid === me) {
        drawHp(100)
        if (!onFoot || cut) return
        // (back at the camp — beside the tent; no camp: beside your car, where you left it; else the start)
        const c = myCamp, s = map.meta.spawn, cp = car.sim ? car.pos : null, ch = car.sim?.heading ?? 0, hx = car.half.x + 0.8
        const by = cp ? besides(cp.x, cp.z, ch, [[-hx, 0], [hx, 0], [0, car.half.z + 1.2]], 0.4) ?? { x: cp.x - Math.cos(ch) * hx, z: cp.z + Math.sin(ch) * hx } : null
        if (c) hero.appear(c.x + Math.cos(c.rot) * 4, c.z - Math.sin(c.rot) * 4, c.rot)
        else if (by && cp) hero.appear(by.x, by.z, ch, undefined, cp.y + 1.5)
        else hero.appear(s.x, s.z, s.yaw)
        footCam()
        toast(c ? 'Back at your camp' : by ? 'Back by your car' : 'Back at the start', 3000)
      }
    })
  }
  /** The view for what's in the hands: over the shoulder with a gun (third person), through the glass in the scope. */
  let gunView = false, scopedWas = false, fppBefore = false
  const weaponView = () => {
    // (third person, GTA's: the camera comes in over his right shoulder only while the gun is AIMED — carried, it is
    //  the walker's own camera)
    const gun = onFoot && !cut && arsenal.aiming
    if (gun !== gunView) { gunView = gun; chase.side = gun ? 0.5 : 0; if (onFoot) chase.frame(gun ? 2.7 : 4.2, gun ? 1.62 : 1.45) }
    const sc = arsenal.scoped
    if (sc !== scopedWas) {
      scopedWas = sc
      const cd = camera.getWorldDirection(new GFX.Vector3())
      if (sc) { fppBefore = fpp; fpp = true; look.footYaw = Math.atan2(-cd.x, -cd.z); look.pitch = Math.asin(Math.max(-1, Math.min(1, cd.y))) }
      else { fpp = fppBefore; if (!fpp) chase.snap() }
    }
    if (gun && !fpp) chase.aimHold()
  }
  // (?ride=moto | foot with ?save=0: start on it / out of the car — the harnesses; ?bikedraw=0: the two-wheelers not drawn — the cost A/B)
  moto.hidden = q.get('bikedraw') === '0'
  // (… once the car has stood on the ground for a moment: at this point it has no physics yet, and on its first frames
  //  it isn't at its spot — the flag did nothing)
  // (only in a TEST session — ?save=0, the harnesses' — never in play: every game starts IN THE CAR and the motorbike is
  //  taken from the GARAGE only — 2026-11-05, the user: "he must stay in his car; the bike only if you select it in the
  //  garage" — an old link with ?ride= kept starting him on a bike)
  let rideAsk = q.get('save') === '0' ? q.get('ride') : null, rideWait = 0

  const fly = new FlyCam(camera, map, renderer.domElement)
  const sp = map.meta.spawn
  fly.place(num('x', sp.x), num('z', sp.z), num('h', 1.7), num('yaw', sp.yaw), num('pitch', -0.04))
  // V (2026-11-05, the user): FIRST PERSON ⇄ third (third the default); SHIFT + V the free camera (from where the
  // camera is) ⇄ back
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || pause) return
    if (!e.shiftKey) { if (driving) { fpp = !fpp; look.yaw = look.pitch = 0; look.footYaw = hero.heading; if (!fpp) chase.snap() } return }
    driving = !driving
    if (!driving) {
      const d = camera.getWorldDirection(new GFX.Vector3())
      fly.place(camera.position.x, camera.position.z, camera.position.y - map.height(camera.position.x, camera.position.z), Math.atan2(-d.x, -d.z), Math.asin(d.y))
    } else chase.snap()
  })
  const ui = driveUi(car, ride, twos, hero, () => onFoot, () => (onFoot ? getIn() : getOut()))
  // (the autopilot's button: over the speed, while a destination is set — amber while it drives)
  const apBtn = document.createElement('button')
  apBtn.className = 'oth-ap'
  apBtn.title = 'Autopilot (O)'
  apBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggleAutopilot(); apHud() })
  document.getElementById('drive')?.querySelector('.spd')?.before(apBtn)
  let apKey = ''
  const apHud = () => {
    const show = autopilot.on || (!!guide.waypoint && !!guide.route && driving && !riding && !onFoot)
    const st = autopilot.state
    const html = !show ? '' : autopilot.on ? `<kbd>O</kbd>Autopilot<small>${st === 'back' ? 'backing up' : st === 'stop' ? 'stopping' : st === 'round' ? 'going round' : st === 'slope' ? 'easing off the slope' : 'on'}</small>` : '<kbd>O</kbd>Autopilot'
    const key = html + autopilot.on
    if (key === apKey) return
    apKey = key
    apBtn.innerHTML = html
    apBtn.classList.toggle('show', show)
    apBtn.classList.toggle('on', autopilot.on)
    // (on a phone the CAMP button stood ON this one — a tap on AUTOPILOT pitched a camp: it moves up while this shows)
    document.body.classList.toggle('oth-ap-shown', show)
  }
  // SOUND: the engine, the tyres, the music and the valley's ambience (starts on the first key / tap — Audio.ts)
  const audio = new OthAudio(map, car, atmos)
  audio.moto = moto
  audio.fires = world.props.fires
  const readouts = gameHud(journal.coins)
  if (q.get('sound') === '0') audio.muted = true

  // THE CLOUD ON THE PASS (PassMist.ts): thickening up the Great Cliff's ledge road, thickest at its top
  const passMist = new PassMist({ world: () => world, atmos })

  let baseDpr = Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * num('scale', 100) / 100 // (?maxdpr=: the pixel-ratio cap, cost tests)
  let dprScale = 1, dprT = performance.now() + 4000, dprFrames = 0, dprSlow = 0, dprGood = 0, dprWait = 8, sinceUp = 99
  // (EVERY device now — 2026-11-07, the user: "do all optimization works, so that even a Chromebook …" — it was phones
  //  only, "turn it off on PC / laptop". It acts only on a SLOW machine: a PC at 500 fps never comes near 52 fps, so its
  //  resolution never moves. The Resolution setting at a fixed % (?dpr=fixed) or ?adaptive=0 turns it off; ?adaptive=1 on)
  let adaptive = q.get('adaptive') === '1' || (q.get('dpr') !== 'fixed' && q.get('adaptive') !== '0')
  const size = () => {}
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  })

  // STATS: PlayCanvas's own panel (MiniStats — FPS, frame time, draw calls, CPU / GPU timings, VRAM): F3 or ?stats=1
  let cpuMs = 0, frameMs = 16.7, last = performance.now(), poolT = 5
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
    if (Number.isNaN(safe.x) || !saving || coop) return
    saveProgress({ v: 1, map: map.meta.id, car: car.id, x: safe.x, z: safe.z, heading: safe.heading, hour: atmos.hour, travelled, playSeconds, savedAt: Date.now(), camp: myCamp, camps: { ...camps, [world.id]: myCamp } })
  }
  addEventListener('pagehide', save)
  // A LOST GRAPHICS DEVICE (2026-11-18, the user: "yes do it"): the page is RELOADED and the journey continued from
  // where it was saved just now — nothing on the GPU can be put back as it was (the ground's bakes; the buffers whose
  // CPU copies were let go to save memory: gfx/scene.ts), and a restored device drew a black ground. A hidden tab
  // waits until it's shown again (a phone takes the GPU from a backgrounded page). Three losses in two minutes: no
  // more reloads — the message stays.
  renderer.onDeviceLost(() => {
    save()
    const now = Date.now()
    let lost: number[] = []
    try { lost = (JSON.parse(sessionStorage.getItem('overhill.lost') ?? '[]') as number[]).filter((t) => now - t < 120000) } catch { /* (none kept) */ }
    lost.push(now)
    try { sessionStorage.setItem('overhill.lost', JSON.stringify(lost)) } catch { /* (not kept) */ }
    if (lost.length >= 3) { toast('The graphics device keeps failing — close other tabs and reload the page', 3600000); return }
    toast('The graphics device was lost — reloading…', 60000)
    const go = () => { requestContinue(true); location.reload() }
    if (document.hidden) document.addEventListener('visibilitychange', () => { if (!document.hidden) go() })
    else go()
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) save() })

  // PAUSE (Esc, or the ❚❚ button): the frame stops entirely — no physics, no clock, no drawing (the last picture stays
  // on screen under the menu): a paused game costs nothing
  let pause: Menu | null = null
  const setPaused = (on: boolean) => {
    if (on === !!pause) return
    if (on) {
      save()
      releaseMouse()
      pause = new Menu('pause', {
        onResume: () => setPaused(false),
        onRestart: () => { save(); requestContinue(true); location.reload() },
        onQuit: () => { save(); requestContinue(false); requestCoop(null); location.href = location.pathname },
        onVehicle: (r, carId) => { void applyRide(r, carId) },
        onSettings: (st, key) => applySettings(st, key),
      })
    } else {
      pause?.close()
      pause = null
      // (Quality / Anti-aliasing changed: the world rebuilt with them — saved, and back right here)
      if (restartPending) { save(); requestContinue(true); location.reload(); return }
      clock.getDelta() // (no jump: the paused time never reaches the physics)
      perf.hold(3000)
      lockMouse() // (Resume was a click: the mouse turns the camera again at once)
      last = performance.now()
    }
  }
  // SETTINGS CHANGED IN PLAY (2026-11-08, the user: "we can press Escape and change settings but it doesn't take
  // effect in the game"): taken at once — the gearbox, the aids, the off-road assist (the car being driven), the paint,
  // the sound, the FPS overlay, the resolution, FSR; Quality and Anti-aliasing build the world differently: the game
  // restarts right here when you resume. (The page's own URL switches still win, as at boot — the harnesses.)
  let restartPending = false
  const applySettings = (st: Settings, key: keyof Settings) => {
    const url = new URLSearchParams(location.search)
    if (key === 'gearbox' || key === 'aids' || key === 'offroadAssist') car.setDriving({ manual: st.gearbox === 'manual', aids: st.aids, offroadAssist: st.offroadAssist })
    else if (key === 'paints') car.setPaint(st.paints[car.id] ?? null)
    else if (key === 'sound') audio.muted = !st.sound
    else if (key === 'fpsOverlay') { showStats = st.fpsOverlay; renderer.showStats(showStats) }
    else if (key === 'resolution' && !url.has('scale')) {
      baseDpr = Math.min(devicePixelRatio, num('maxdpr', tier.dpr)) * (st.resolution === 'auto' ? 100 : Number(st.resolution)) / 100
      adaptive = st.resolution === 'auto' && url.get('adaptive') !== '0'
      dprScale = 1
      renderer.setPixelRatio(baseDpr)
    } else if (key === 'upscale' && !url.has('fsr')) {
      const k = { off: 1, quality: 0.77, balanced: 0.67, performance: 0.5 }[st.upscale]
      if (k >= 0.99) { fsr?.dispose(); fsr = null }
      else if (fsr) fsr.scale = k
      else fsr = new Fsr(renderer, k)
    } else if (key === 'companion') {
      if (st.companion !== 'off' && (coop || coopWorld)) toast('The companion is for solo play — not in a co-op world', 3500)
      else if (!url.has('companion')) setCompanion(companionKind(st.companion))
    } else if (key === 'bot') { if (st.bot) { if (coop) startBot(); else toast('The bot joins in a co-op world — CO-OP on the title screen', 3500) } else stopBot() }
    else if (key === 'quality' || key === 'antialias' || key === 'damage') restartPending = true
  }
  // MOUSE LOOK (mouseLook.ts): the lock lost to Esc pauses — the browser keeps that Esc, the keydown below never sees it
  initMouseLook(renderer.domElement, () => { if (!pause) setPaused(true) })
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || pause || document.querySelector('.oth-map.on')) return
    e.preventDefault()
    setPaused(true)
  })
  // THE ACTION WHEEL (Wheel.ts): top right beside full screen, Q on a keyboard — everything that isn't driving
  {
    // (a key the game already listens for, pressed and let go — the keys' held sets see it come and go)
    const press = (code: string, shiftKey = false) => () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey }))
      window.dispatchEvent(new KeyboardEvent('keyup', { code, shiftKey }))
    }
    const keyboard = !document.body.classList.contains('touch')
    const wheel = new ActionWheel([
      { id: 'pause', label: 'Pause', icon: ICONS.pause, key: 'Esc', run: () => setPaused(true) },
      { id: 'map', label: 'Map', icon: ICONS.map, key: 'Tab', run: () => mapView.toggle() },
      ...(radar ? [{ id: 'radar', label: 'Minimap', icon: ICONS.radar, key: 'N', run: toggleRadar, on: () => radarOn }] : []),

      { id: 'winch', label: () => winch.label(), icon: ICONS.winch, key: 'E', run: () => winch.button(), show: () => driving && !riding && !cut },
      { id: 'autopilot', label: () => (autopilot.on ? 'Autopilot off' : 'Autopilot'), icon: ICONS.pilot, key: 'O', run: toggleAutopilot, on: () => autopilot.on, show: () => driving && !riding && !onFoot },
      { id: 'reset', label: 'Reset', icon: ICONS.reset, key: 'R', run: () => { if (riding) two.reset(); else car.reset() }, show: () => driving && !onFoot },
      // (car damage — Damage.ts: shown once there is something to mend)
      { id: 'repair', label: () => `Repair · ${Math.min(car.damage?.cost ?? 0, journal.coins)} ◆`, icon: ICONS.repair, run: repairCar, show: () => driving && !riding && !!car.damage && !car.damage.whole },
      { id: 'lights', label: 'Lights', icon: ICONS.lights, key: 'L', run: press('KeyL'), show: () => !riding && !onFoot },
      { id: 'build', label: 'Build', icon: ICONS.flag, key: 'B', run: () => { if (coop) coop.build.toggle(); else toast('Building needs a co-op world — CO-OP on the title screen', 3500) }, on: () => !!coop?.build.on },
      { id: 'time', label: 'Time', icon: ICONS.time, key: 'G', run: press('KeyG') },
      { id: 'weather', label: 'Weather', icon: ICONS.weather, key: 'Shift G', run: press('KeyG', true) },
      { id: 'sound', label: () => (audio.muted ? 'Sound off' : 'Sound'), icon: () => (audio.muted ? ICONS.mute : ICONS.sound), key: 'M', run: press('KeyM') },
      // (the views — on every device: a phone has no V — 2026-11-05, the user)
      { id: 'view', label: () => (fpp ? 'Third person' : 'First person'), icon: () => (fpp ? ICONS.tpp : ICONS.eye), key: 'V', run: press('KeyV'), show: () => driving },
      { id: 'freecam', label: () => (driving ? 'Free camera' : 'Back to play'), icon: ICONS.camera, key: 'Shift V', run: press('KeyV', true), on: () => !driving },
    ], keyboard)
    // (its second mode — the small button under the ring: the weapons you've found; a sector puts that one in your hands)
    const WICON: Record<string, string> = { pistol: ICONS.pistol, ak47: ICONS.rifle, sniper: ICONS.scope }
    wheel.weapons = () => arsenal.list().map((w) => ({ id: `w:${w.id}`, label: w.name.split(' — ')[0], icon: w.id ? WICON[w.id] : ICONS.fist, on: () => w.on, run: () => { if (!onFoot) toast('Weapons are for when you are on foot'); arsenal.equip(w.id) } }))
  }  // THE API BADGE (2026-11-05, the user: "a small icon in the top-right corner for WebGPU or WebGL"): a tag on the
  // menu button's corner — amber GPU, grey GL2
  {
    const gpu = renderer.backend === 'webgpu'
    const mb = document.querySelector('.oth-menubtn') as HTMLElement | null
    if (mb) { mb.dataset.api = gpu ? 'GPU' : 'GL2'; mb.classList.toggle('gl2', !gpu); mb.title += gpu ? ' · WebGPU' : ' · WebGL2' }
  }


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
  const rest = (apply: () => void, waitOut = false) => {
    closeMenu()
    // (co-op: the rest moves the world's clock — everyone's — and a wait clears everyone's sky)
    fadeThrough(() => { apply(); skyNet.set?.(waitOut ? null : atmos.hour, 'keep', waitOut); car.damage?.repair(); atmos.update(camera.position, clock.elapsedTime); save(); toast('Rested · progress saved') })
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
        ...(wet ? [{ label: 'Wait out the weather', note: 'clear skies', go: () => rest(() => atmos.clearSky(), true) }] : []),
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
    const near = world.places.filter((l) => !SECRET.has(l.style ?? '') || world.landmarks.found.has(l.id)).map((l) => ({ l, d: Math.hypot(l.x - s.x, l.z - s.z) })).filter((o) => o.d > 60).sort((a, b) => a.d - b.d).slice(0, 4)
    readouts.sign(near.map(({ l, d }) => ({ name: l.name, d, turn: Math.atan2(l.x - s.x, -(l.z - s.z)) - head })))
  }
  const signDir = new GFX.Vector3()
  let hudTick = 0
  // the NOTES (Sites.ts): stopped (or on foot) within 11 m of a place that has one — its card; the first read pays and
  // is kept (localStorage `oth.notes.<map>`)
  const notesRead = (id: string) => { try { return new Set(JSON.parse(localStorage.getItem(`oth.notes.${id}`) ?? '[]') as number[]) } catch { return new Set<number>() } }
  let wardenSeen: Set<number> | null = null, wardenSeenKey = ''
  const noteHud = () => {
    const p = ride.pos, slow = onFoot || Math.abs(ride.speedKmh) < 12
    const l = slow ? world.places.find((q) => q.note && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 11 * 11) : undefined
    // (or the WARDENS' WRITING on a stone — Wardens.ts: stopped within 9 m of one; the first read pays, kept apart)
    const wt = !l && slow ? world.wardens?.textNear(p.x, p.z) ?? null : null
    if (wt) {
      // THE WARDENS' SCRIPT (wardenScript.ts): the stone's words in their letters — the ones learned so far plain. Each
      // stone read for the first time teaches three more (this one's are known as its card comes up).
      const key = `oth.wtexts.${world.map.meta.id}`
      if (!wardenSeen || wardenSeenKey !== key) { wardenSeenKey = key; try { wardenSeen = new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as number[]) } catch { wardenSeen = new Set() } }
      const seen = wardenSeen, fresh = !seen.has(wt.id)
      if (fresh) {
        seen.add(wt.id)
        try { localStorage.setItem(key, JSON.stringify([...seen])) } catch { /* (not kept) */ }
      }
      // (2026-11-12, the user after playing it: "you made some story restriction … boring, I want exploration" — the
      //  stones read PLAIN now; the script that had to be learned stone by stone is ?wscript=1)
      const plain = q.get('wscript') !== '1'
      readouts.note({ place: wt.place, title: wt.title, text: plain ? wt.text : wardenHtml(wt.text, seen.size) })
      if (!fresh) return
      journal.coins += 10
      keepJournal()
      readouts.coins(journal.coins, 10)
      const taught = plain ? '' : lettersTaught(seen.size)
      toast(`Warden writing read · ${seen.size} / ${world.wardens?.textCount ?? 0}${taught ? ` · learned ${taught}` : ''}`, 3600)
      if (!plain && lettersKnown(seen.size) >= 26 && lettersKnown(seen.size - 1) < 26) setTimeout(() => { toast('You can read the Wardens\' script now', 5200); audio.chime() }, 3800)
      return
    }
    readouts.note(l?.note ? { place: l.name, ...l.note } : null)
    if (!l) return
    const read = notesRead(world.map.meta.id)
    if (read.has(l.id)) return
    read.add(l.id)
    try { localStorage.setItem(`oth.notes.${world.map.meta.id}`, JSON.stringify([...read])) } catch { /* (not kept) */ }
    journal.coins += 15
    keepJournal()
    readouts.coins(journal.coins, 15)
    toast(`Note found · ${read.size} / ${world.places.filter((q) => q.note).length}`, 2800)
  }

  // PERF MARKS (PerfMarks.ts — F9, ?perfmark=1): the spots where the frame rate falls, marked as you play, with why
  const perf = new PerfMarks((m, merged) => toast(`FPS drop ${merged ? 'again ' : ''}marked · ${m.fps} fps (usual ${m.baseFps})${m.kind === 'hitch' ? ' · a stall' : ''}`, 2200))
  // (the GPU's timestamps only on ?perfgpu=1 — 2026-11-17, scripts/harness/hitchprof.mjs: once on, PlayCanvas's GPU
  //  profiler times every pass of every frame and reads it back — the median frame 2.9 → 6.2 ms and a 150–180 ms stall
  //  every two seconds, the marks marking the tool itself. A mark keeps the CPU's share and what was drawn; the GPU's
  //  per part is the harness's `why`)
  const perfGpu = q.get('perfgpu') === '1'
  if (perf.on && perfGpu) renderer.gpuTime()
  const perfSnap = (): PerfSnap => ({
    world: world.id, camera, ground: map.height(camera.position.x, camera.position.z), player: ride.pos,
    mode: !driving ? 'fly' : fpp ? 'fpp' : onFoot ? 'foot' : riding ? 'bike' : 'chase', cpuMs,
    gpu: () => (perfGpu ? renderer.gpuTime() : { frame: undefined, passes: {} }), hour: atmos.hour, weather: atmos.weather, zoom: !fpp && driving ? chase.distance : undefined,
    drawn: () => ({ draws: renderer.info.render.calls, tris: renderer.info.render.triangles, patches: world.terrain.patches, blades: world.grass.blades, trees: world.trees.drawn.slice(), bushes: world.bushes.drawn.slice(), rocks: world.rocks.count, dpr: +(baseDpr * dprScale).toFixed(2), fsr: fsr?.scale ?? 1 }),
  })

  const frame = () => {
    renderer.drawing = !pause
    if (pause) return
    const now = performance.now()
    frameMs += (now - last - frameMs) * 0.1
    perf.frame(now, now - last, lookBlocked, perfSnap, camera.position)
    // ADAPTIVE RESOLUTION (PlayCanvas guidelines: device pixel ratio at runtime): once a second, the second's AVERAGE
    // frame (its time over its frames — a garbage-collection stall or one hitch barely moves it, as the old smoothed
    // frame did) — slow (> 19 ms ≈ under 52 fps) TWO seconds running lowers the pixel ratio 15 % (down to half the
    // tier's), fast (< 12.5 ms) raises it back 8 % — the look stays, only the sharpness gives. A frame over 250 ms (the
    // tab hidden, a load) starts the second again. ?dpr=fixed turns it off.
    if (adaptive) {
      if (now - last > 250) { dprT = Math.max(dprT, now); dprFrames = 0 }
      else if (now > dprT) dprFrames++
      if (now - dprT > 1000 && dprFrames > 0) {
        const avg = (now - dprT) / dprFrames
        dprT = now; dprFrames = 0
        dprSlow = avg > 19 ? dprSlow + 1 : 0
        // (a 60 Hz screen never shows a frame under 12.5 ms: held at its cap — ≥ 57 fps — for dprWait seconds, it TRIES
        //  a step up; a try that turns slow comes back down and waits twice as long before the next — max 2 min)
        dprGood = avg < 17.5 ? dprGood + 1 : 0
        const up = avg < 12.5 || (dprScale < 1 && dprGood >= dprWait)
        const k = dprSlow >= 2 ? 0.85 : up ? 1.08 : 1
        sinceUp++
        if (dprSlow >= 2) { dprSlow = 0; if (sinceUp <= 4) dprWait = Math.min(120, dprWait * 2) } // (the try it undoes)
        if (up) { dprGood = 0; sinceUp = 0 }
        const next = Math.min(1, Math.max(0.5, dprScale * k))
        if (Math.abs(next - dprScale) > 0.02 || (next === 1 && dprScale !== 1)) {
          dprScale = next
          renderer.setPixelRatio(baseDpr * dprScale)
          size()
        }
      }
    }
    last = now
    const dt = Math.min(clock.getDelta(), 0.1)
    // (PlayCanvas's idle uniform buffers let go — renderer.trimPools: a few seconds in, then now and then)
    if ((poolT -= dt) <= 0) { poolT = 20; if (q.get('trim') !== '0') { renderer.trimPools(); world.map.inner.dropRaw() } }
    car.wet = dust.wet = atmos.uniforms.uWet.value
    moto.wet = car.wet
    cut?.(dt)
    car.doorOpen += Math.max(-dt * 1.8, Math.min(dt * 1.8, doorTo - car.doorOpen))
    if (rideAsk && car.sim && driving && (rideWait += dt) > 0.8) { if (rideAsk === 'foot') getOut(); else toggleRide(moto); rideAsk = null }
    passMist.update(dt, camera.position)
    {
      // (on foot, W walks away from the camera)
      const cd = camera.getWorldDirection(new GFX.Vector3())
      hero.camYaw = Math.atan2(-cd.x, -cd.z)
    }
    // (the companion: solo play only — gone once a co-op world is joined)
    if (coop && companion) { companion.dispose(); companion = null }
    companion?.update(dt)
    physics.pw.advance(dt, (fdt) => { car.fixed(fdt); moto.fixed(fdt); hero.fixed(fdt); companion?.fixed(fdt); winch.fixed(fdt); trailer?.fixed(fdt) })
    car.update(physics.pw.alpha)
    moto.update(physics.pw.alpha, dt)
    hero.update(dt)
    arsenal.update(dt)
    winch.hands()
    pickups?.update(dt)
    weaponView()
    companion?.animate(dt)
    if (coop && car.damage && !car.damage.onHit) coopTellDamage?.()
    if (coopSpread > 0 && (coopSpread -= dt) <= 0) spreadOut()
    coop?.frame(dt, localNow())
    if (trailerDue && car.sim) {
      // (stood a moment: every wheel on the ground, not dropping, not rolling — placed, the car is held in the air a
      //  while as the ground under it is made: still, and a tow ball found then was as low as before)
      const sim = car.sim, onWheels = sim.wheels.every((w) => w.contact)
      trailerStill = onWheels && Math.abs(sim.body.linvel().y) < 0.2 && car.speedKmh < 1 ? trailerStill + dt : 0
      if (trailerStill > 0.4) {
        const t = trailerDue
        trailerDue = null
        if (!t.model.root.parent) scene.add(t.model.root)
        trailer = t
        t.spawnBehind()
      }
    }
    trailer?.update(dt)
    // (towing: the chase camera further back and higher — the trailer in view behind the car, not filling it)
    const towing = !!trailer?.hitched && !onFoot && !riding && driving
    if (towing !== towCam) { towCam = towing; if (!onFoot && !riding) chase.frame(towing ? 12.5 : 9, towing ? 2.0 : 1.6) }
    gather?.update(dt)
    ground?.update(dt)
    guide.update(dt, ride.pos.x, ride.pos.z)
    // (the autopilot lets go when the 4×4 isn't what's driven: on foot, the bike, the free camera)
    if (autopilot.on && (onFoot || riding || !driving)) autopilot.stop('Autopilot off')
    // the journey: distance driven (not the jumps of a reset / a car change), the last safe spot, the autosave
    playSeconds += dt
    const moved = Math.hypot(ride.pos.x - lastPos.x, ride.pos.z - lastPos.z)
    if (moved < 5) travelled += moved
    lastPos.copy(ride.pos)
    if (ride.sim && ride.grounded() && map.waterAt(ride.pos.x, ride.pos.z) === null) { safe.x = ride.pos.x; safe.z = ride.pos.z; safe.heading = ride.heading }
    if ((saveT += dt) > 20) { saveT = 0; save() }
    // the HUD's slow parts (4× a second): the signpost, the camp prompt
    if ((hudTick += dt) > 0.25) {
      hudTick = 0; signHud(); noteHud(); apHud()
      const act = actionNow() // (was: const c = canCamp() ? campHere() : null — the camp's prompt, below)
      // (on foot by a vehicle: "F Get in" — GTA's; else the camp's)
      // (the camp's prompt and its CAMP button no longer come up whenever the car stops — commented out at the user's
      //  word, 2026-11-25: "when we stop car or human moving it show camp here btn appears, comment that"; C still opens
      //  the camp)
      // readouts.prompt(onFoot && act ? ['F', act] : gather?.prompt ?? (canCamp() ? ['C', c ? `Rest at ${c.name}` : 'Pitch camp'] : null))
      // (the rope's prompt TAPPABLE — a phone has no E: tapped, it does what it says)
      const wp = onFoot && act ? null : winch.prompt()
      readouts.prompt(onFoot && act ? ['F', act] : wp ?? gather?.prompt ?? null, wp ? () => winch.press() : null)
      ui.action(act)
    }
    dust.update(dt, car)
    // (car damage: what has just broken made seen, the engines' smoke and fire, the pieces' flight)
    if (damageFx) {
      if (car.damage && car.sim) { const v = car.sim.body.linvel(); damageFx.car(dt, car.damage, car.root, v.x, v.y, v.z, car.paintColor, yourWheel) }
      if (companion?.car.damage && companion.carShown) { const v = companion.carVel; damageFx.car(dt, companion.car.damage, companion.car.root, v.x, v.y, v.z, companion.car.paintColor, hisWheel) }
      // (co-op: the others' cars, dented as their games say — the smoke, the fire, the pieces)
      if (coop) for (const o of coop.remotes.damaged()) damageFx.car(dt, o.car.damage!, o.car.root, o.vx, 0, o.vz, o.car.paintColor, () => o.car.wheelPart)
      damageFx.update(dt)
      // (the gas pressed in a car whose engine is gone: told why nothing happens — once every 8 s)
      if ((deadHint -= dt) <= 0 && car.damage?.dead && car.sim && !onFoot && !riding && car.sim.controls.throttle > 0.5) { deadHint = 8; toast(car.damage.wrecked ? 'The car is wrecked — repair it: the wheel › Repair, or rest at a camp' : 'The engine is dead — repair it: the wheel › Repair, or rest at a camp', 4200) }
    }
    // (the meadow pressed flat under the car — its blades grew up through the floor and the dash)
    if (car.sim && car.root.visible) world.grass.car(car.root.position.x, car.root.position.z, car.sim.heading, car.half.x + 0.1, car.half.z + 0.1)
    else world.grass.car(0, 0, 0, 0, 0)
    tyreTracks.update(car, clock.elapsedTime)
    if (riding && two.sim) {
      const sb = two.sim, wheels = [sb.front, sb.rear]
      dust.bikeTyres(dt, wheels, sb.body.linvel())
      tyreTracks.bikeMarks(wheels, clock.elapsedTime)
    }
    car.lights(atmos, dt)
    car.weather(atmos, dt)
    // (the driver in his seat whenever you're in the car — a new car, sat in again)
    if (!onFoot && !riding && !cut && car.sim && (!hero.seated || seatedIn !== car.id)) seatDriver()
    // (on a bike the skinned character rides it — the bike's own segment rider not drawn)
    for (const b of twos) b.skinned = hero.loaded
    if (riding && !cut && two.sim && hero.loaded && !hero.ridingOn(two.root)) hero.rideOn(two)
    watchBail(dt)
    if (driving) {
      // (getting in or out: the door's camera; back to the chase camera after, from where it is)
      if (!rising && (cut || (onFoot && hero.state === 'action'))) { if (doorCam === 0) doorCamFrom.copy(camera.position); if (!placeDoorCam(dt)) chase.update(dt) }
      // (no snap after it: from the door's camera — outside, by the car's flank — the chase camera eases round behind)
      else if (fpp) { if (doorCam > 0) doorCam = 0; placeFpp(dt) }
      else { if (doorCam > 0) doorCam = 0; chase.update(dt) }
    } else fly.update(dt)
    arsenal.afterCamera()
    // (the mouse turns the camera in use only; a menu, the map or the wheel takes the cursor back — mouseLook.ts)
    chase.enabled = driving && !fpp; fly.enabled = !driving
    if (mouseLocked() && lookBlocked()) releaseMouse()
    // (first person: the head out of the way, the near plane close — the cabin's insides at arm's length)
    const inFpp = fpp && driving && !cut
    hero.hideHead = inFpp && (onFoot || hero.seated || riding)
    car.inside = inFpp && !onFoot && !riding
    if (car.inside !== fppClass) { fppClass = car.inside; document.body.classList.toggle('oth-fpp', fppClass) } // (the camp prompt off the dials)
    { const dc = camera.position.distanceTo(car.pos); car.near = car.inside || dc < 14; car.close = car.inside || dc < 6 }
    const nearWant = inFpp ? 0.05 : 0.3
    // (on a bike in first person, a wider lens — 70° — as games give it: the bars and the hands in the bottom of the view)
    const fovWant = arsenal.scopeFov ?? (inFpp && riding ? 70 : inFpp && !onFoot ? FPP_FOV : inFpp && arsenal.current ? FPP_ARMED_FOV : 55)
    if (camera.near !== nearWant || camera.fov !== fovWant) { camera.near = nearWant; camera.fov = fovWant; camera.updateProjectionMatrix() }
    ui.update(driving, atmos.clock)
    audio.update(dt, camera)
    atmos.tick(dt)
    // THE HAZE'S FLOOR (Atmosphere uHaze, the look): the low ground round the camera — the lowest fifth of the land
    // within 1.2 km, eased over a few seconds — so the haze lies in the valley you're in, thinner on the ridges
    {
      const c = camera.position, hs = mistHs
      let n = 0
      hs[n++] = map.height(c.x, c.z)
      for (const r of [180, 450, 1200]) for (let a = 0; a < 8; a++) hs[n++] = map.height(c.x + Math.cos(a * 0.785 + r) * r, c.z + Math.sin(a * 0.785 + r) * r)
      // (the ground mist's floor — uHazeLow: the third lowest of the ground under the camera and 180 m round it)
      //  — three passes for the three smallest: no array made a frame)
      {
        let a = Infinity, b2 = Infinity, wl = Infinity
        for (let k = 0; k < 9; k++) { const v = hs[k]; if (v < a) { wl = b2; b2 = a; a = v } else if (v < b2) { wl = b2; b2 = v } else if (v < wl) wl = v }
        atmos.mistFloorLow = mistInit && Math.abs(wl - atmos.mistFloorLow) < 80 ? atmos.mistFloorLow + (wl - atmos.mistFloorLow) * Math.min(1, dt * 0.6) : wl
      }
      hs.sort()
      const want = hs[4]
      atmos.mistFloor = mistInit && Math.abs(want - atmos.mistFloor) < 150 ? atmos.mistFloor + (want - atmos.mistFloor) * Math.min(1, dt * 0.4) : want
      mistInit = true
    }
    atmos.update(camera.position, FREEZE ? 100 : clock.elapsedTime)
    // (the look's grade — gfx/material.ts othGrade: the valley's; the desert keeps its own calibrated colours)
    GFX.outputState.grade = LOOK * GRADE_K
    GFX.outputState.warm = 1 - atmos.uniforms.uNight.value
    rain.update()
    // (in the cave world no rain but down its skylight — Rain.setCave)
    {
      const cw = world.cave
      if (cw?.cameraInside) {
        const l = cw.site, W = (a: number, c: number) => [l.x + a * Math.cos(l.rot) + c * Math.sin(l.rot), l.z - a * Math.sin(l.rot) + c * Math.cos(l.rot)]
        const [sx, sz, sr] = cw.meta.sky, [s2x, s2z, s2r] = cw.meta.sky2 ?? [0, 0, 0], a = W(sx, sz), b2 = W(s2x, s2z)
        rain.setCave(true, a[0], a[1], sr * 1.3, b2[0], b2[1], s2r * 1.3)
      } else rain.setCave(false)
    }
    mapView.update(dt)
    radar?.update(dt, radarOn && driving && !mapView.isOpen, ride.speedKmh)
    winch.update(dt, camera)
    shadow.update(atmos.uniforms.uSunDir.value)
    // (the trees' see-through round what the camera follows — Trees.seeThrough: the car, the bike, the walker; off in
    //  first person, on the map, in the free camera)
    world.trees.seeThrough(ride.pos, driving && !inFpp && !mapView.isOpen ? (onFoot ? 1.1 : riding ? 1.5 : 2.8) : 0)
    const t0 = performance.now()
    // (a harness's eye: this frame drawn from beside what's followed — the game's own camera put back after the render)
    if (specAt) {
      specPos.copy(camera.position); specQuat.copy(camera.quaternion); specOn = true
      camera.position.set(specAt[0], specAt[1], specAt[2])
      camera.lookAt(specLook.set(specAt[3], specAt[4], specAt[5]))
      camera.updateMatrixWorld()
    } else if (spectate) {
      const s = spectate, h = ride.heading, p = ride.pos
      specPos.copy(camera.position); specQuat.copy(camera.quaternion); specOn = true
      camera.position.set(p.x + Math.cos(h) * s.x + Math.sin(h) * s.z, p.y + s.y, p.z - Math.sin(h) * s.x + Math.cos(h) * s.z)
      camera.lookAt(specLook.set(p.x, p.y + s.lookH, p.z))
      camera.updateMatrixWorld()
    }
    // (THE SCOPE — LodEye.ts: the world's detail measured from the sight line, not from where you stand)
    aimLodEye(camera, LODEYE ? arsenal.lens : 1, dt, landH)
    ;(atmos.uniforms.uLodPos.value as GFX.Vector3).set(lodEye.bx, lodEye.by, lodEye.bz)
    atmos.uniforms.uLens.value = lodEye.on ? Math.pow(lodEye.k, -0.7) : 1
    world.update(camera, FREEZE ? 0 : dt, FREEZE ? 100 : clock.elapsedTime, atmos.uniforms.uLamps.value, atmos.uniforms.uFire.value, ride.pos.x, ride.pos.z)
    // (what's out of view or behind the hills isn't drawn: 2026-11-02)
    viewPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    view.setFromProjectionMatrix(viewPV, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    caveUniforms(atmos, world.places, camera.position) // (the three nearest caves' dark: Sites.ts)
    car.cull(view, world.horizon)
    moto.cull(view, world.horizon)
    hero.cull(view, world.horizon)
    if (charHidden) hero.root.visible = hero.shadowMesh.visible = false
    coop?.cull(view, world.horizon, camera)
    companion?.cull(view, world.horizon, camera, innerWidth, innerHeight)
    dust.cull(view, world.horizon)
    damageFx?.cull(view, world.horizon)
    tyreTracks.cull(camera.position, clock.elapsedTime)
    fsr?.begin()
    renderer.prepare(scene, camera)
    cpuMs += (performance.now() - t0 - cpuMs) * 0.1
  }
  // FSR 1 (Fsr.ts — the Upscaling setting / ?fsr=0.77 | 0.67 | 0.5): the world drawn smaller, upscaled to the canvas
  const fsrK = num('fsr', 1)
  let fsr = fsrK > 0.3 && fsrK < 0.99 ? new Fsr(renderer, fsrK) : null
  renderer.onPostRender(() => {
    fsr?.end()
    if (specOn) { specOn = false; camera.position.copy(specPos); camera.quaternion.copy(specQuat); camera.updateMatrixWorld() }
  })
  // PlayCanvas's frame loop: the game in its 'update', then it renders
  renderer.start(frame)
  if (coopWorld) {
    const acct = loadAccount()
    status.textContent = 'Joining the co-op world…'
    try {
      if (!acct) throw new Error('no account here — open CO-OP on the title screen')
      const session = await Session.connect(acct, coopWorld)
      coop = new Coop(session, scene, () => world.map, physics, atmos, shadow, env.farGrid, { char: charUrl, moto: motoUrl, rider: riderUrl, fight: fightUrl, rope: ropeUrl }, toast, tier, camera, renderer.domElement, () => ride.pos)
      // (the tow ropes: the others' cars and walkers, ours told)
      { const R = coop.remotes; coopWinch = { carOf: (sid) => R.towCar(sid), walkerOf: (sid) => R.walker(sid) } }
      winch.joined(session)
      // THE SKY (sky.rs): the world's hour and weather, followed — told on joining, every 5 s, at once on a change
      if (session.sky) atmos.follow(session.sky, true)
      session.on((e) => { if (e.t === 'sky') atmos.follow(e) })
      skyNet.set = (h, w, wait) => session.setSky(h, w, wait)
      // (our car's blows and its repair, told: the others dent the car they draw of ours)
      const tellDamage = () => {
        const dm = car.damage
        if (!dm) return
        dm.onHit = (px, py, pz, dx, dy, dz, dv, kind) => session.dent(px, py, pz, dx, dy, dz, dv, kind)
        dm.onRepair = () => session.dent(0, 0, 0, 0, 0, 0, 0, 'repair')
        dm.onLand = (k, sv) => session.dent(k, 0, 0, 0, 0, 0, sv, 'land')
        dm.onBlast = () => session.dent(0, 0, 0, 0, 0, 0, 0, 'blast')
      }
      tellDamage()
      coopTellDamage = tellDamage
      // (ours, for the others' solids: theirs is made only once it's clear of our car and of us — Remotes.clear)
      const ourBox = { x: 0, z: 0, h: 0, hx: 1, hz: 2.3 }
      coop.remotes.ours = () => {
        let cb: typeof ourBox | null = null
        if (car.sim) {
          const bb = car.bodyBox, h = car.sim.heading, c = Math.cos(h), sn = Math.sin(h), P = car.pos
          ourBox.x = P.x + bb.cx * c + bb.cz * sn; ourBox.z = P.z - bb.cx * sn + bb.cz * c; ourBox.h = h; ourBox.hx = bb.hx; ourBox.hz = bb.hz
          cb = ourBox
        }
        return { car: cb, me: onFoot ? hero.pos : riding ? two.pos : null }
      }
      coopSpread = 2.5
      coop.build.onToggle = (on) => { chase.aerial = on }
      fightOn(session)
      coop.worldParts = () => ({ rocks: world.rocks, grass: world.grass })
      coop.build.obstacle = (x, z) => (world.trees.nearest(x, z, 4.5) ? 'Too close to a tree — its branches would hide your flag' : world.rocks.biggestNear(x, z, 1.5) ? 'Not on a boulder' : '')
      gather = new Gather(session, () => ({ id: world.id, map: world.map, trees: world.trees, rocks: world.rocks, grass: world.grass }), physics, hero, atmos, shadow, env.farGrid, toast,
        () => onFoot && driving && !cut && !pause && !coop?.build.on && !winch.wantsE(), () => trailer)
      scene.add(gather.group)
      // THE CLAIMS' GROUND (GroundEdits.ts — step 5: shaped, paved, ponds)
      ground = new GroundEdits(session, () => world, physics)
      coop.ground = ground
      if (q.get('bot') === '1') startBot()
      ground.onSettle = (x0, z0, x1, z1) => coop?.claims.reground(x0, z0, x1, z1)
      // THE BUILDER'S WORK SEEN: he swings the pick into the ground he shapes, stoops to lay paving or a piece; the
      // dust where the ground moves and where a piece lands (Pieces.ts animates it in)
      coop.build.onWork = (kind, x, z, r) => {
        gather?.work(kind, x, z, () => {})
        dust.puff(x, world.map.height(x, z), z, Math.min(r, 6), kind === 'dig' ? Math.round(6 + r * 1.5) : 4, kind === 'dig' ? [0.34, 0.27, 0.2] : [0.42, 0.4, 0.37])
      }
      if (coop.build.builder) coop.build.builder.onPlace = (pl) => gather?.work('lay', pl.x, pl.z, () => {})
      coop.pieces.onDust = (x, y, z, r, soil) => dust.puff(x, y, z, r, soil ? 5 : Math.round(5 + r * 3), soil ? [0.3, 0.24, 0.18] : [0.46, 0.43, 0.38])
      // THE TRAILER (Trailer.ts): behind the car, hitched, from the start
      const tr = new Trailer(physics, () => world.map, car)
      tr.onMessage = (m) => toast(m, 2200)
      // (held asleep till the car stands — then set down behind it, hitched: the frame's `trailerDue`)
      void tr.load(atmos, shadow, env.farGrid).then(() => { tr.body?.sleep(); trailerDue = tr; trailerStill = 0 })
      car.onPlaced = () => { if (trailer?.hitched) { trailer.unhitch(true); trailerDue = trailer; trailerStill = 0 } }      // (each player 12 m on from the one before, along the start's track — back along it where it goes back, else on
      //  ahead (the valley's start is the track's first point) — never all on the one spot; facing along the track)
      const k = (session.me.sid - 1) % 8
      if (k && car.sim && !onFoot && !riding) {
        const L = map.meta.trails.lines[0]
        let i = 0
        for (let j = 1; j < L.length; j++) if ((L[j][0] - car.pos.x) ** 2 + (L[j][1] - car.pos.z) ** 2 < (L[i][0] - car.pos.x) ** 2 + (L[i][1] - car.pos.z) ** 2) i = j
        const step = i > 0 ? -1 : 1
        for (let d = 0, n = 0; n < 400 && i + step >= 0 && i + step < L.length - 5 && d < 12 * k; n++, i += step) d += Math.hypot(L[i + step][0] - L[i][0], L[i + step][1] - L[i][1])
        const n = L[Math.min(L.length - 1, i + 4)]
        car.placeAt(L[i][0], L[i][1], Math.atan2(-(n[0] - L[i][0]), -(n[1] - L[i][1])))
      }
    } catch (e) {
      toast(`Co-op: ${e instanceof Error ? e.message : 'no connection'} — driving alone`, 6000)
    }
  }
  // THE WARM-UP behind the loading text (gfx/scene.ts): every shader and pipeline of the world made now, 12 a frame —
  // not a stall each time a new kind of thing first comes into view (2026-11-08, the perf marks). In play it goes on
  // at 2 a frame for what's added later (a crossing's world: compileAsync, a new car, a variant)
  {
    loading(0.85)
    GFX.warm.perFrame = 12
    const t0 = performance.now()
    let p0 = 0
    await new Promise<void>((res) => {
      let n = 0
      const tick = () => {
        n++
        p0 = Math.max(p0, GFX.warm.pending)
        if (p0 > 0) loading(0.85 + 0.15 * (1 - GFX.warm.pending / p0))
        if ((n > 3 && GFX.warm.pending === 0) || performance.now() - t0 > 20000) res(); else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    GFX.warm.perFrame = 1
  }
  status.remove()
  dispatchEvent(new Event('overhill:started')) // (the title screen closes)

  // the shot harness
  ;(window as unknown as { __oth: unknown }).__oth = {
    get ready() { return shadowReady },
    tier: tier.name,
    /** (quality.ts) drawn the weak GPU's way — and the resolution share the adaptive resolution is at */
    weakGpu: !!tier.weakGpu,
    get dprScale() { return dprScale },
    /** the canvas's MSAA samples as drawn (1: none) */
    get samples() { return renderer.samples },
    get props() { return world.props },
    get birds() { return world.birds },
    get world() { return world },
    moto,
    /** On / off the motorbike. */
    ride: () => toggleRide(moto),
    hero,
    /** F: out of the vehicle / back in. */
    foot: () => (onFoot ? getIn() : getOut()),
    /** the foot camera snapped behind him (a harness's walk: W then goes the way he faces) */
    footCam,
    get onFoot() { return onFoot },
    youPos: () => ({ x: ride.pos.x, y: ride.pos.y, z: ride.pos.z }),
    youHeading: () => ride.heading,
    get riding() { return riding },
    /** (co-op) the session and the others as drawn (scripts/harness/coop.mjs) */
    get coop() { return coop },
    /** (the helper bot — scripts/harness/bottest.mjs) */
    get bot() { return bot },
    /** (the companion — scripts/harness/companion.mjs) */
    get companion() { return companion },
    /** (a harness's eye — weaponshots.mjs) */
    spectate: (x?: number, y = 1.2, z = 0, lookH = 1.1) => { spectate = x === undefined ? null : { x, y, z, lookH } },
    /** (the harness) the camera from (px py pz) at (tx ty tz) for the draws to come — none: back to play's */
    camAt: (c?: [number, number, number, number, number, number]) => { specAt = c ?? null },
    /** (a harness's: the companion made / changed / sent away — scripts/harness/weaponcost.mjs) */
    setCompanion: (kind: string | null) => setCompanion(companionKind(kind)),
    /** (the weapons — scripts/harness/weapons.mjs) */
    get arsenal() { return arsenal },
    get pickups() { return pickups },
    /** (the detail's eye — LodEye.ts; scripts/harness/scopeshots.mjs) */
    get lodEye() { return lodEye },
    /** (a harness's aim) first person, looking this way (rad: the heading, the pitch up) */
    aim: (yaw: number, pitch: number) => { fpp = true; look.footYaw = yaw; look.pitch = pitch },
    thirdPerson: () => { fpp = false; chase.snap() },
    get fpp() { return fpp },
    get camDir() { const d = camera.getWorldDirection(new GFX.Vector3()); return [d.x, d.y, d.z] },
    startBot,
    stopBot,
    /** (co-op) gathering on foot (scripts/harness/gathertest.mjs) */
    get gather() { return gather },
    /** (co-op) our trailer (scripts/harness/trailertest.mjs) */
    get trailer() { return trailer },
    /** (the harness's probes: offscreen bakes re-run, targets read back) */
    renderer,
    /** The drawn parts, each with `visible` (scripts/harness/ablate.mjs: the GPU's frame, system by system). */
    parts: () => ({ terrain: world.terrain.mesh, grass: world.grass.group, trees: world.trees.group, bushes: world.bushes.group, rocks: world.rocks.group, water: world.water.group, falls: world.falls.group, bridges: world.bridges.group, landmarks: world.landmarks.group, props: world.props.group, ...(world.glow ? { glow: world.glow.group } : {}), ...(world.birds ? { birds: world.birds.mesh } : {}), ...(world.cave ? { cave: world.cave.group } : {}), sky: sky.mesh, car: car.root, carShadow: car.shadowMesh, dust: dust.mesh, tracks: tyreTracks.mesh }),
    journal,
    openCamp,
    /** (car damage — scripts/harness/damagetest.mjs) the effects; the wheel's repair */
    damageFx,
    repairCar,
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
    passMist,
    guide,
    autopilot,
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
    /** (PerfMarks.ts) the spots marked where the frame rate fell — the harness reads them back */
    perfMarks: () => perf.marks,
    /** (gfx/scene.ts) the shader warm-up: layouts warmed, still waiting */
    warm: () => ({ total: GFX.warm.total, pending: GFX.warm.pending }),
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

/** The game's HUD readouts: COINS (top right — they pop when they change), the SIGNPOST's boards, the CAMP prompt (and
 *  on touch screens its round button). DOM written only when something changes (4× a second at most). */
function gameHud(coins0: number) {
  const coins = document.createElement('div')
  coins.className = 'oth-coins'
  coins.textContent = `${coins0} ◆`
  const sign = document.createElement('div')
  sign.className = 'oth-sign'
  const note = document.createElement('div')
  note.className = 'oth-sign oth-note'
  const prompt = document.createElement('div')
  prompt.className = 'oth-prompt'
  const campBtn = document.createElement('button')
  campBtn.className = 'oth-campbtn'
  campBtn.textContent = 'CAMP'
  document.body.append(coins, sign, note, prompt, campBtn)
  let signKey = '', promptText: string | null = 'x', noteKey = ''
  let promptTap: (() => void) | null = null
  prompt.addEventListener('pointerdown', (e) => { if (!promptTap) return; e.preventDefault(); e.stopPropagation(); promptTap() })
  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  return {
    coins(n: number, delta: number) {
      coins.textContent = `${n} ◆`
      coins.dataset.d = delta < 0 ? `−${-delta}` : `+${delta}`
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
    /** A NOTE left at a place (Sites.ts), while you're stopped by it. */
    note(n: { place: string; title: string; text: string } | null) {
      const html = n ? `<small>${n.place} · ${n.title}</small>${n.text}` : ''
      if (html === noteKey) return
      noteKey = html
      if (n) note.innerHTML = html
      note.classList.toggle('on', !!n)
    },
    prompt(p: [string, string] | null, tap: (() => void) | null = null) {
      promptTap = tap
      prompt.classList.toggle('tap', !!tap)
      const text = p ? p.join(' ') : null
      if (text === promptText) return
      promptText = text
      prompt.innerHTML = p ? `<kbd>${p[0]}</kbd>${p[1]}` : ''
      prompt.classList.toggle('on', !!p)
      campBtn.classList.toggle('on', !!p && p[0] === 'C')
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

/** The driving HUD (speed, gear, keys) and, on touch screens, the pedals and steering buttons. */
function driveUi(car: Vehicle, ride: { readonly speedKmh: number; readonly gear: string; readonly sim: unknown }, twos: Bike[], hero: Character, onFoot: () => boolean, doAct: () => void): { update: (driving: boolean, time: string) => void; action: (label: string | null) => void } {
  const box = document.createElement('div')
  box.id = 'drive'
  box.innerHTML = '<div class="spd"><b>0</b><span>km/h</span><i></i><em></em></div><div class="help">W A S D drive · Space handbrake · Shift boost · E winch · F get out · C camp · R reset · B build · Tab map · O autopilot · Q menu · Esc pause</div>'
  // THE GEARS (2026-11-08, the user: "the manual gear shift — arrows for it in game; on mobile a small gear section"):
  // with the Manual gearbox, a small box by the speed — ▲ up, the gear, ▼ down — clicked or tapped (the keys X / Z
  // shown beside them on a keyboard); hidden on the bike, on foot and with the automatic
  const gears = document.createElement('div')
  gears.className = 'oth-gears'
  gears.innerHTML = '<button data-g="KeyX" title="Shift up (X)">▲<kbd>X</kbd></button><b>N</b><button data-g="KeyZ" title="Shift down (Z)">▼<kbd>Z</kbd></button>'
  for (const b of gears.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new KeyboardEvent('keydown', { code: (b as HTMLElement).dataset.g })); window.dispatchEvent(new KeyboardEvent('keyup', { code: (b as HTMLElement).dataset.g })) })
  box.prepend(gears)
  document.body.appendChild(box)
  const gearNow = gears.querySelector('b')!
  let gearsOn = false, gearsTxt = ''
  const spd = box.querySelector('.spd b')!, gear = box.querySelector('.spd i')!, clk = box.querySelector('em')!, help = box.querySelector('.help') as HTMLElement
  const CAR_HELP = help.textContent ?? ''
  const MOTO_HELP = 'W throttle · S brake · A D steer · ↓ wheelie · ↑ stoppie · ↑ ↓ flips · Space jump · R back on · F off · Q menu · Esc pause'
  const FOOT_HELP = 'W A S D move · Shift sprint · Ctrl walk · Space jump · F get in · Q menu · Esc pause'
  let onBike = -1, pad: HTMLElement | null = null, door: HTMLButtonElement | null = null
  const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches
  if (touch) {
    // TOUCH: round thumb pads in the corners, the rest of the HUD small and out of the way (index.html, body.touch):
    // the game gets the screen
    document.body.classList.add('touch')
    help.style.display = 'none'
    // (the gear box on the page itself, above the pedals: the HUD plate is centred with a transform — a fixed box inside
    //  it was placed against the plate, mid-screen)
    document.body.appendChild(gears)
    pad = document.createElement('div')
    pad.className = 'oth-touch'
    // (only what you drive with: the rest — winch, bike, reset, map, pause … — is in the action wheel, Wheel.ts)
    // (the manual gears: the HUD's gear box, .oth-gears — shown when the setting is Manual, even if changed in play)
    pad.innerHTML = '<button data-k="left">◀</button><button data-k="right">▶</button><button data-k="brake">BRAKE</button><button data-k="gas">GAS</button><button data-k="hop" class="bk">HOP</button><button data-k="leanF" class="bk">▲</button><button data-k="leanB" class="bk">▼</button>'
    document.body.appendChild(pad)
    // THE STICK (on foot — 2026-11-05: "think as a game developer"): the left thumb steers the walk from the camera's
    // view; a little = walk, most = run, to the rim = sprint. It lives where the steering pads are (hidden on foot).
    const stick = document.createElement('div')
    stick.className = 'oth-stick'
    stick.innerHTML = '<i></i>'
    pad.appendChild(stick)
    const knob = stick.querySelector('i') as HTMLElement
    let sid = -1
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(), R = r.width / 2
      let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R
      const m = Math.hypot(dx, dy)
      if (m > 1) { dx /= m; dy /= m }
      hero.touch.mx = dx; hero.touch.my = -dy
      knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`
    }
    const end = () => { sid = -1; hero.touch.mx = hero.touch.my = 0; knob.style.transform = '' }
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sid = e.pointerId; stick.setPointerCapture(e.pointerId); move(e) })
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e) })
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end)
    // SPRINT (held, beside JUMP — on foot)
    const spr = document.createElement('button')
    spr.className = 'oth-sprint'
    spr.textContent = 'SPRINT'
    const sset = (v: number) => (e: Event) => { e.preventDefault(); e.stopPropagation(); hero.touch.sprint = v }
    spr.addEventListener('pointerdown', sset(1)); spr.addEventListener('pointerup', sset(0)); spr.addEventListener('pointercancel', sset(0)); spr.addEventListener('pointerleave', sset(0))
    pad.appendChild(spr)
    // THE DOOR (GTA's car-door button): out of / into what's nearest, shown only when there's something to do
    door = document.createElement('button')
    door.className = 'oth-door'
    door.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5l9-2v18 M13 4h5v17 M10 12h.01 M2 21h20"/></svg><span></span>'
    door.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); doAct() })
    document.body.appendChild(door)
    // (one-shot pads — the manual gears — press the key they stand for)
    const tap = (code: string) => (e: Event) => { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { code })) }
    for (const b of pad.querySelectorAll('button')) {
      if (b.dataset.k === 'hop' || b.dataset.k === 'leanF' || b.dataset.k === 'leanB') {
        const set = (v: number) => (e: Event) => { e.preventDefault(); if (b.dataset.k === 'hop') hero.touch.hop = v; for (const bk of twos) { if (b.dataset.k === 'hop') bk.touch.hop = v; else bk.touch.lean = b.dataset.k === 'leanF' ? v : -v } }
        b.addEventListener('pointerdown', set(1)); b.addEventListener('pointerup', set(0)); b.addEventListener('pointercancel', set(0)); b.addEventListener('pointerleave', set(0))
        continue
      }
      if (b.dataset.key) { b.addEventListener('pointerdown', tap(b.dataset.key)); continue }
      const k = b.dataset.k as 'gas' | 'brake' | 'left' | 'right'
      const on = (v: number) => (e: Event) => { e.preventDefault(); car.touch[k] = v; hero.touch[k] = v; for (const bk of twos) bk.touch[k] = v }
      b.addEventListener('pointerdown', on(1)); b.addEventListener('pointerup', on(0)); b.addEventListener('pointercancel', on(0)); b.addEventListener('pointerleave', on(0))
    }
  }
  let actLabel: string | null = ''
  // (2026-11-07, docs/PERF.md: written only when it CHANGES — the same text set again still replaces the text node, and
  //  the page re-lays out and repaints the HUD: every frame at 500 fps, ~0.3 ms of the frame's main thread)
  const spdBox = box.querySelector('.spd') as HTMLElement
  let shown = '', free: boolean | null = null, spdTxt = '', gearTxt = '', clkTxt = '', spdShown = ''
  return {
    action: (label) => {
      if (!door || label === actLabel) return
      actLabel = label
      door.classList.toggle('on', !!label)
      ;(door.querySelector('span') as HTMLElement).textContent = label ?? ''
    },
    update: (driving, time: string) => {
      const disp = driving ? 'block' : 'none'
      if (disp !== shown) { shown = disp; box.style.display = disp }
      if (free !== !driving) { free = !driving; document.body.classList.toggle('oth-free', free) } // (the free camera: no pads — its own touch: one finger looks, two fly)
      const s = ride.speedKmh.toFixed(0)
      if (s !== spdTxt) { spdTxt = s; spd.textContent = s }
      if (ride.gear !== gearTxt) { gearTxt = ride.gear; gear.textContent = gearTxt }
      // (the gear box: the car, driven, with the Manual gearbox — the setting can change while playing)
      const gOn = car.driving.manual && !onFoot() && !twos.some((b) => !!b.sim)
      if (gOn !== gearsOn) { gearsOn = gOn; gears.classList.toggle('on', gOn) }
      if (gOn) { const g = ride.gear.replace(/^[MD]/, ''); if (g !== gearsTxt) { gearsTxt = g; gearNow.textContent = g || 'N' } }
      const on = onFoot() ? 2 : twos.some((b) => !!b.sim) ? 1 : -1 // (1 the motorbike, 2 on foot, −1 the car)
      if (on !== onBike) {
        onBike = on
        help.textContent = on === 1 ? MOTO_HELP : on === 2 ? FOOT_HELP : CAR_HELP
        pad?.classList.toggle('bike', on === 1)
        pad?.classList.toggle('foot', on === 2)
      }
      // (on foot: no speedometer)
      const sd = onFoot() ? 'none' : ''
      if (sd !== spdShown) { spdShown = sd; spdBox.style.display = sd }
      if (time !== clkTxt) { clkTxt = time; clk.textContent = time }
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
