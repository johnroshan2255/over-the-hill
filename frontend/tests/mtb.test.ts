/**
 * THE MOUNTAIN BIKE (gameplay/vehicle/MtbSim.ts): Node + real Rapier, a flat world plus ramps, ledges and a wall.
 * Every check prints PASS / FAIL with its numbers; the targets are the brief's (docs: the user's "each and every
 * physics for the bike, the shock absorber and all").
 */
import { group, Groups, PhysicsWorld } from '../src/physics/PhysicsWorld'
import { MtbSim, MTB_TUNE } from '../src/gameplay/vehicle/MtbSim'
import { MTB, type MtbControls } from '../src/gameplay/vehicle/mtbTypes'
import { blendRoughness, Surf, type SurfaceMix } from '../src/gameplay/vehicle/drivetrain/tyre'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const R = await PhysicsWorld.load()
const DEG = Math.PI / 180
const deg = (r: number) => r / DEG
const kmh = (v: number) => v * 3.6

/** Flat ground at y = 0 (Terrain). */
function world(): PhysicsWorld {
  const p = new PhysicsWorld(R)
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed())
  p.world.createCollider(R.ColliderDesc.cuboid(4000, 0.5, 4000).setTranslation(0, -0.5, 0).setCollisionGroups(group(Groups.Terrain, 0xffff)), g)
  return p
}
/** A flat slab whose TOP face starts at (z0, y0) and rises toward −z at `a` rad for `len` m; returns its far end. */
function slab(p: PhysicsWorld, z0: number, y0: number, a: number, len: number, grp: number = Groups.Terrain): [number, number] {
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed())
  const th = 0.25
  const cy = y0 + (len / 2) * Math.sin(a) - th * Math.cos(a), cz = z0 - (len / 2) * Math.cos(a) - th * Math.sin(a)
  p.world.createCollider(
    R.ColliderDesc.cuboid(8, th, len / 2).setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }).setTranslation(0, cy, cz).setCollisionGroups(group(grp, 0xffff)),
    g,
  )
  return [z0 - len * Math.cos(a), y0 + len * Math.sin(a)]
}
/** A box (Terrain or Static) from its min / max corners. */
function box(p: PhysicsWorld, min: [number, number, number], max: [number, number, number], grp: number = Groups.Terrain): void {
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed())
  p.world.createCollider(
    R.ColliderDesc.cuboid((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2)
      .setTranslation((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2)
      .setCollisionGroups(group(grp, 0xffff)),
    g,
  )
}
function bike(p: PhysicsWorld, surface?: number): MtbSim {
  const b = new MtbSim(p)
  if (surface !== undefined) b.surface = (_x: number, _z: number, out: SurfaceMix) => { out.w.fill(0); out.w[surface] = 1; out.wet = 0; out.rough = 0; out.stones = 0 }
  return b
}
const IDLE: MtbControls = { pedal: 0, brake: 0, steer: 0, lean: 0, hop: false, sprint: false }
function run(p: PhysicsWorld, b: MtbSim, seconds: number, ctl: Partial<MtbControls> | ((s: number) => Partial<MtbControls>), each?: (s: number) => boolean | void): number {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) {
    const s = i / 60
    Object.assign(b.controls, IDLE, typeof ctl === 'function' ? ctl(s) : ctl)
    b.step(1 / 60)
    p.world.step()
    if (each?.(s + 1 / 60)) return s + 1 / 60
  }
  return seconds
}
/** Start at speed (right after place: the sim reads it as its own). */
function launch(b: MtbSim, v: number, heading = 0): void {
  b.body.setLinvel({ x: -Math.sin(heading) * v, y: 0, z: -Math.cos(heading) * v }, true)
}
/** Hold a speed with the pedals (a rider's foot: PI on the speed). */
function cruise(b: MtbSim, target: number): () => number {
  let i = 0.3
  return () => {
    const e = target - b.speed
    i = Math.max(0, Math.min(1, i + e * 0.02))
    return Math.max(0, Math.min(1, i + e * 0.4))
  }
}
/** The tyres' lowest points (world y): the axles from the frame's pose + the fork's travel / the swingarm. */
function wheelBottoms(b: MtbSim): [number, number] {
  const q = b.body.rotation(), t = b.body.translation()
  const rot = (x: number, y: number, z: number): number => {
    // world y of q·(x, y, z)
    const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z
    return iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z
  }
  const ax = MTB.steer.axis, F = MTB.frontAxle, Rr = MTB.rearAxle, P = MTB.rear.pivot
  const fy = rot(F[0] + ax[0] * b.forkTravel, F[1] + ax[1] * b.forkTravel, F[2] + ax[2] * b.forkTravel)
  const a = b.swingarm, y0 = Rr[1] - P[1], z0 = Rr[2] - P[2]
  const ry = rot(Rr[0], P[1] + y0 * Math.cos(a) + z0 * Math.sin(a), P[2] - y0 * Math.sin(a) + z0 * Math.cos(a))
  return [t.y + fy - MTB.wheel.radius, t.y + ry - MTB.wheel.radius]
}
const pitchRate = (b: MtbSim) => {
  const q = b.body.rotation(), w = b.body.angvel()
  const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y)
  return w.x * rx + w.y * ry + w.z * rz
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// ------------------------------------------------------------------ the geometry the sim reports
{
  const p = world(), b = bike(p)
  b.place(0, 0, 0, 0)
  run(p, b, 2, {})
  const T = MTB_TUNE
  console.log(`  tune: ${T.power} W (sprint ${T.sprintPower} W for ${T.sprintTime} s), legs ${T.forceSeated} / ${T.forceStanding} N, sag ${T.sagFront * 100} / ${T.sagRear * 100} %, ζ ${T.zetaComp} / ${T.zetaReb}, brakes ${T.brakeTotal} g (${T.brakeFront * 100} % front), CdA ${T.cdaSeated} / ${T.cdaTuck} m², a full key ${(T.leanFull / DEG).toFixed(0)}° of lean`)
  console.log(`  geometry: sag front ${(b.forkShare * 100).toFixed(1)} %, rear ${(b.rearShare * 100).toFixed(1)} %, swingarm ${deg(b.swingarm).toFixed(2)}°, shock ${(b.shockLength * 1000).toFixed(1)} mm`)
  p.dispose()
}

// ------------------------------------------------------------------ 1. rest on the flat
{
  const p = world(), b = bike(p)
  b.place(0, 0, 0, 0)
  // (Rapier substeps its solver: at rest the body's vy reads −0.375·g·dt after each step — still is measured on the
  //  pose: less than 0.1 mm a step of height, 0.01° of pitch)
  let lastMove = 0, py = b.body.translation().y, pp = b.pitch
  const t0 = b.body.translation()
  run(p, b, 2, {}, (s) => {
    const y = b.body.translation().y
    if (Math.abs(y - py) > 1e-4 || Math.abs(b.pitch - pp) > 0.01 * DEG) lastMove = s
    py = y; pp = b.pitch
    return false
  })
  const settled = lastMove
  const x0 = b.body.translation()
  run(p, b, 3, {})
  const x1 = b.body.translation()
  const creep = Math.hypot(x1.x - x0.x, x1.z - x0.z)
  check('rest: settles in < 1 s', settled < 1, `still from ${settled.toFixed(2)} s (dropped ${((t0.y - x0.y) * 1000).toFixed(1)} mm)`)
  check('rest: sag front 25–35 %, rear 25–35 %', b.forkShare > 0.25 && b.forkShare < 0.35 && b.rearShare > 0.25 && b.rearShare < 0.35, `fork ${(b.forkShare * 100).toFixed(1)} % (${(b.forkTravel * 1000).toFixed(0)} mm), rear ${(b.rearShare * 100).toFixed(1)} % (${(b.rearShare * MTB.rear.wheelTravel * 1000).toFixed(0)} mm), shock ${(b.shockLength * 1000).toFixed(1)} mm`)
  check('rest: upright, no creep (< 1 cm in 3 s)', Math.abs(deg(b.roll)) < 0.5 && creep < 0.01 && !b.crashed, `roll ${deg(b.roll).toFixed(2)}°, crept ${(creep * 1000).toFixed(1)} mm`)
  // the geometry at full travel: push the frame down hard, read the shock at the bottom
  let minShock = 1, maxSwing = 0
  b.body.setLinvel({ x: 0, y: -4, z: 0 }, true) // (under the 6 m/s impact test)
  run(p, b, 1, {}, () => { minShock = Math.min(minShock, b.shockLength); maxSwing = Math.max(maxSwing, b.swingarm); return false })
  check('rest: a 4 m/s slam bottoms the rear on its geometry (shock ≥ 155 mm, swingarm ≤ max)', minShock >= 0.1545 && maxSwing <= MTB.rear.swingarmMaxRotation + 1e-3 && !b.crashed, `shock ${(minShock * 1000).toFixed(1)} mm, swingarm ${deg(maxSwing).toFixed(1)}° (max ${deg(MTB.rear.swingarmMaxRotation).toFixed(1)}°)`)
  p.dispose()
}

// ------------------------------------------------------------------ 2. pedalling on the flat
{
  const p = world(), b = bike(p)
  b.place(0, 0, 0, 0)
  run(p, b, 0.5, {})
  let t20 = NaN, maxGear = b.gear, minCad = 999, maxCad = 0, pedalK = 0
  const gears: number[] = []
  run(p, b, 60, () => ((pedalK = Math.min(1, pedalK + 1 / 60 / 0.35)), { pedal: pedalK }), (s) => {
    if (Number.isNaN(t20) && b.speed > 20 / 3.6) t20 = s
    if (b.gear !== gears[gears.length - 1]) gears.push(b.gear)
    maxGear = Math.max(maxGear, b.gear)
    if (s > 3 && b.pedalling) (minCad = Math.min(minCad, b.cadence)), (maxCad = Math.max(maxCad, b.cadence))
    return false
  })
  const seated = b.speed
  check('flat: 0 → 20 km/h in 3–6 s', t20 >= 3 && t20 <= 6, `${t20.toFixed(2)} s`)
  check('flat: seated top 32–38 km/h', kmh(seated) >= 32 && kmh(seated) <= 38, `${kmh(seated).toFixed(1)} km/h in gear ${b.gear} at ${b.cadence.toFixed(0)} rpm`)
  check('flat: shifts up through the cassette', maxGear >= 11 && gears.length >= 8, `gears ${gears.join(' ')}`)
  check('flat: cadence 60–110 rpm while pedalling', minCad >= 60 && maxCad <= 110, `${minCad.toFixed(0)}–${maxCad.toFixed(0)} rpm`)
  let top = 0, fadeAt = NaN
  run(p, b, 12, { pedal: 1, sprint: true }, (s) => {
    top = Math.max(top, b.speed)
    if (Number.isNaN(fadeAt) && b.sprintLeft < 0.15) fadeAt = s
    return false
  })
  const after = b.speed
  check('flat: sprint 42–50 km/h, fading after ~8 s', kmh(top) >= 42 && kmh(top) <= 50 && fadeAt > 6 && fadeAt < 9, `top ${kmh(top).toFixed(1)} km/h, fades from ${fadeAt.toFixed(1)} s, ${kmh(after).toFixed(1)} km/h at 12 s`)
  p.dispose()
}

// ------------------------------------------------------------------ 3. coasting down 10°
{
  const p = world(), a = 10 * DEG, L = 400
  slab(p, -4, 0, a, L)
  const b = bike(p, Surf.Dirt)
  // at the top, facing down (+z)
  const d = L - 6
  b.place(0, d * Math.sin(a), -4 - d * Math.cos(a), Math.PI, -a)
  launch(b, 3, Math.PI)
  let top = 0, anyPedal = false
  run(p, b, 25, {}, () => { top = Math.max(top, b.speed); anyPedal ||= b.pedalling; return b.body.translation().z > -20 })
  check('coast down 10° (dirt): > 50 km/h, not pedalling', kmh(top) > 50 && !anyPedal && !b.crashed, `${kmh(top).toFixed(1)} km/h, gear ${b.gear}, stand ${b.riderStand.toFixed(2)}`)
  p.dispose()
}

// ------------------------------------------------------------------ 4. climbing 15° seated
{
  const p = world(), a = 15 * DEG
  slab(p, -4, 0, a, 300)
  const b = bike(p, Surf.Dirt)
  const d = 4
  b.place(0, d * Math.sin(a), -4 - d * Math.cos(a), 0, a)
  run(p, b, 0.5, {})
  let frontOff = 0, sum = 0, n = 0, maxGear = 0
  run(p, b, 16, { pedal: 1 }, (s) => {
    if (s > 2 && !b.front.contact) frontOff += 1 / 60
    if (s > 8) (sum += b.speed), n++, (maxGear = Math.max(maxGear, b.gear))
    return false
  })
  const v = sum / n
  check('climb 15° (dirt) seated: 6–12 km/h in a low gear, front down', kmh(v) >= 6 && kmh(v) <= 12 && maxGear <= 3 && frontOff < 0.3 && !b.crashed, `${kmh(v).toFixed(1)} km/h, gear ≤ ${maxGear}, ${b.cadence.toFixed(0)} rpm, front off ${frontOff.toFixed(2)} s, shift ${b.riderShift.toFixed(2)}`)
  p.dispose()
}

// ------------------------------------------------------------------ 5. braking from 30 km/h on dirt
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 30 / 3.6)
  run(p, b, 0.5, {})
  const v0 = b.speed, z0 = b.body.translation().z
  let dist = NaN, maxSlipR = 0, minPitch = 0, maxFork = 0, k = 0, peak = 0
  const hist: number[] = []
  run(p, b, 5, () => ((k = Math.min(1, k + 1 / 60 / 0.2)), { brake: k }), () => {
    maxSlipR = Math.max(maxSlipR, b.rear.slip)
    minPitch = Math.min(minPitch, b.pitch)
    maxFork = Math.max(maxFork, b.forkShare)
    hist.push(b.speed)
    if (hist.length > 15 && b.speed > 0.5) peak = Math.max(peak, (hist[hist.length - 16] - b.speed) / 0.25)
    if (Number.isNaN(dist) && b.speed < 0.3) dist = Math.abs(b.body.translation().z - z0)
    return false
  })
  check('brake 30 → 0 on dirt: 4–8 m, peak ~0.8 g, no crash, the fork dives, the rear skids', dist >= 4 && dist <= 8 && peak / 9.81 > 0.7 && !b.crashed && maxFork > 0.45, `${dist.toFixed(2)} m from ${kmh(v0).toFixed(1)} km/h (mean ${((v0 * v0) / (2 * dist) / 9.81).toFixed(2)} g with the lever's 0.2 s, peak ${(peak / 9.81).toFixed(2)} g), fork ${(maxFork * 100).toFixed(0)} %, rear slip ${maxSlipR.toFixed(2)}, pitch ${deg(minPitch).toFixed(1)}°`)
  // held at a standstill: walked back slowly
  const z1 = b.body.translation().z
  run(p, b, 3, { brake: 1 })
  const back = b.body.translation().z - z1
  check('brake held at a standstill walks it back slowly', back > 0.5 && back < 3 && !b.crashed, `${back.toFixed(2)} m back in 3 s`)
  p.dispose()
}
// over the bars: weight forward + full front brake at speed
{
  const p = world(), b = bike(p, Surf.Asphalt)
  b.place(0, 0, 0, 0)
  launch(b, 32 / 3.6)
  run(p, b, 0.3, {})
  run(p, b, 3, { brake: 1, lean: 1 }, () => b.crashed)
  check('weight forward + full brake at 32 km/h on asphalt → over the bars', b.crashed && b.crashReason === 'over-the-bars', `${b.crashReason || 'no crash'}`)
  p.dispose()
}
// a stoppie: weight forward + brake at 15 km/h, held by the rider
{
  const p = world(), b = bike(p, Surf.Asphalt)
  b.place(0, 0, 0, 0)
  launch(b, 15 / 3.6)
  run(p, b, 0.3, {})
  let up = 0, minP = 0
  run(p, b, 2.5, { brake: 1, lean: 0.8 }, () => { if (b.stoppie) up += 1 / 60; minP = Math.min(minP, b.pitch); return b.crashed })
  check('stoppie: weight forward + brake at 15 km/h lifts the rear, no crash', up > 0.2 && !b.crashed, `rear up ${up.toFixed(2)} s, pitch ${deg(minP).toFixed(1)}°`)
  p.dispose()
}

// ------------------------------------------------------------------ 6. cornering at 20 km/h
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 20 / 3.6)
  const hold = cruise(b, 20 / 3.6)
  run(p, b, 1, () => ({ pedal: hold() }))
  let turned = 0, prev = b.heading, leanSum = 0, n = 0, maxLean = 0
  run(p, b, 5, () => ({ pedal: hold(), steer: 1 }), (s) => {
    turned += wrap(b.heading - prev); prev = b.heading
    if (s > 2.5) (leanSum += b.roll), n++
    maxLean = Math.max(maxLean, Math.abs(b.roll))
    return false
  })
  const lean = leanSum / n
  check('corner at 20 km/h (full key, dirt): leans 20–35° into the turn, turns, stays up', deg(lean) >= 20 && deg(lean) <= 35 && turned < -Math.PI && !b.crashed, `lean ${deg(lean).toFixed(1)}° (max ${deg(maxLean).toFixed(1)}°), turned ${deg(-turned).toFixed(0)}° right in 5 s, ${kmh(b.speed).toFixed(1)} km/h, bars ${deg(b.steerAngle).toFixed(1)}°`)
  // and back the other way, then straight: upright again
  run(p, b, 3, () => ({ pedal: hold(), steer: -1 }))
  const left = b.roll
  run(p, b, 2, () => ({ pedal: hold() }))
  check('… the other way leans left, and straightens up', deg(left) < -20 && Math.abs(deg(b.roll)) < 3 && !b.crashed, `left ${deg(left).toFixed(1)}°, then ${deg(b.roll).toFixed(1)}°`)
  p.dispose()
}
// wash-out: full key on wet mud at speed
{
  const p = world(), b = new MtbSim(p)
  b.surface = (_x, _z, out) => { out.w.fill(0); out.w[Surf.Mud] = 1; out.wet = 1; out.rough = 0; out.stones = 0 }
  b.place(0, 0, 0, 0)
  launch(b, 28 / 3.6)
  run(p, b, 0.5, {})
  let slid = 0
  run(p, b, 4, { steer: 1, pedal: 0.6 }, () => { slid = Math.max(slid, b.front.slip); return b.crashed })
  console.log(`  info: full key at 28 km/h on wet mud (μ ${(0.45 * 1.2 * 0.8).toFixed(2)}): ${b.crashed ? `crash (${b.crashReason})` : 'stays up'}, front slip ${slid.toFixed(2)}`)
  p.dispose()
}

// ------------------------------------------------------------------ 7. bunny hop at 15 km/h
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 15 / 3.6)
  const hold = cruise(b, 15 / 3.6)
  run(p, b, 1, () => ({ pedal: hold() }))
  let maxComp = 0
  run(p, b, 0.45, { hop: true }, () => { maxComp = Math.max(maxComp, b.forkShare, b.rearShare); return false })
  const crouch = b.riderCrouch
  let both = 0, clear = 0, frontFirst = NaN, rearOff = NaN, landed = false
  run(p, b, 2, {}, (s) => {
    const [f, r] = wheelBottoms(b)
    if (Number.isNaN(frontFirst) && !b.front.contact) frontFirst = s
    if (Number.isNaN(rearOff) && !b.rear.contact) rearOff = s
    if (!b.front.contact && !b.rear.contact) (both += 1 / 60), (clear = Math.max(clear, Math.min(f, r)))
    if (both > 0 && b.front.contact && b.rear.contact) landed = true
    return false
  })
  check('hop: holding crouches + preloads (~40 % travel, crouch → 1)', maxComp > 0.33 && maxComp < 0.55 && crouch > 0.8, `travel ${(maxComp * 100).toFixed(0)} %, crouch ${crouch.toFixed(2)}`)
  check('hop at 15 km/h: front first, both wheels off, clearance 0.3–0.6 m, clean landing', frontFirst < rearOff && both > 0.2 && clear >= 0.3 && clear <= 0.6 && landed && !b.crashed, `front off at ${(frontFirst * 1000).toFixed(0)} ms, rear ${(rearOff * 1000).toFixed(0)} ms, air ${both.toFixed(2)} s, clearance ${clear.toFixed(2)} m`)
  // a short preload hops lower
  run(p, b, 1, () => ({ pedal: hold() }))
  run(p, b, 0.12, { hop: true })
  let clear2 = 0
  run(p, b, 2, {}, () => { const [f, r] = wheelBottoms(b); if (!b.front.contact && !b.rear.contact) clear2 = Math.max(clear2, Math.min(f, r)); return false })
  check('hop: a short preload hops lower', clear2 < clear * 0.8 && !b.crashed, `${clear2.toFixed(2)} m after 0.12 s of crouch`)
  p.dispose()
}

// ------------------------------------------------------------------ 8. wheelie / manual / loop-out
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 10 / 3.6)
  const hold = cruise(b, 10 / 3.6)
  run(p, b, 1, () => ({ pedal: hold() }))
  let up = 0, best = 0, maxP = 0
  run(p, b, 4, { pedal: 1, lean: -0.6 }, () => {
    if (b.wheelie) (up += 1 / 60), (best = Math.max(best, up))
    else up = 0
    maxP = Math.max(maxP, b.pitch)
    return b.crashed
  })
  check('wheelie from 10 km/h (pedal + lean back): held ≥ 1 s', best >= 1 && !b.crashed, `held ${best.toFixed(2)} s, pitch up to ${deg(maxP).toFixed(1)}°, ${kmh(b.speed).toFixed(1)} km/h`)
  // let go of the lean: the front comes down
  run(p, b, 2, { pedal: 0.5 })
  check('… releasing the lean brings the front down', b.front.contact && !b.crashed, `pitch ${deg(b.pitch).toFixed(1)}°`)
  // loop it: sprint, full lean back
  let crashedAt = NaN
  run(p, b, 6, { pedal: 1, sprint: true, lean: -1 }, (s) => { if (b.crashed) crashedAt = s; return b.crashed })
  check('loop it out (sprint + full lean back) → crash', b.crashed && b.crashReason === 'loop-out', `${b.crashReason || 'no crash'} after ${crashedAt.toFixed(2)} s`)
  p.dispose()
}
{
  // manual: coasting at 15 km/h, lean back
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 15 / 3.6)
  run(p, b, 0.5, {})
  let up = 0, best = 0, z0 = 0, dist = 0
  run(p, b, 5, { lean: -1 }, () => {
    if (b.wheelie) { if (up === 0) z0 = b.body.translation().z; up += 1 / 60; best = Math.max(best, up); dist = Math.max(dist, z0 - b.body.translation().z) } else up = 0
    return b.crashed
  })
  check('manual (coast + lean back at 15 km/h): held a few metres, then the front comes down', dist > 2 && dist < 20 && !b.crashed && b.front.contact, `${best.toFixed(2)} s, ${dist.toFixed(1)} m`)
  p.dispose()
}

// ------------------------------------------------------------------ 9. drops to flat at 20 km/h
for (const h of [1.5, 5]) {
  const p = world()
  box(p, [-8, 0, -20], [8, h, 40])
  const b = bike(p, Surf.Dirt)
  b.place(0, h, -12, 0)
  launch(b, 20 / 3.6)
  const hold = cruise(b, 20 / 3.6)
  let maxF = 0, maxR = 0, flew = false, landedAt = NaN
  run(p, b, 4, () => ({ pedal: flew ? 0 : hold() }), (s) => {
    if (b.airborne) flew = true
    if (flew && !b.airborne && Number.isNaN(landedAt)) landedAt = s
    if (flew) (maxF = Math.max(maxF, b.forkShare)), (maxR = Math.max(maxR, b.rearShare))
    return false
  })
  if (h < 2) check(`${h} m drop to flat at 20 km/h: lands, ≥ 70 % of the travel used, rides away`, flew && !b.crashed && Math.max(maxF, maxR) >= 0.7 && b.speed > 3 && Math.abs(deg(b.roll)) < 5, `fork ${(maxF * 100).toFixed(0)} %, rear ${(maxR * 100).toFixed(0)} %, ${kmh(b.speed).toFixed(1)} km/h after`)
  else check(`${h} m drop to flat at 20 km/h: crash`, b.crashed, `${b.crashReason || 'no crash'}, fork ${(maxF * 100).toFixed(0)} %, rear ${(maxR * 100).toFixed(0)} %`)
  p.dispose()
}

// ------------------------------------------------------------------ 10. air control off a kicker
{
  const p = world()
  let [z, y] = slab(p, -4, 0, 10 * DEG, 1.5)
  ;[z, y] = slab(p, z, y, 20 * DEG, 1.5)
  ;[z, y] = slab(p, z, y, 30 * DEG, 2.2)
  const b = bike(p, Surf.Dirt)
  b.place(0, 0, 25, 0)
  launch(b, 13)
  const hold = cruise(b, 13)
  let maxRate = 0, rot = 0, air = 0, prevAir = false
  run(p, b, 4, () => (b.airborne ? { lean: -1 } : { pedal: hold() }), () => {
    if (b.airborne) {
      if (!prevAir) rot = 0
      air += 1 / 60
      const r = pitchRate(b)
      maxRate = Math.max(maxRate, r)
      rot += r / 60
    }
    prevAir = b.airborne
    return !b.airborne && air > 0.3
  })
  const perTurn = (2 * Math.PI) / maxRate
  check('air: full lean back flips at ~1.2 s a turn', maxRate > 4.5 && maxRate < 6.5, `${maxRate.toFixed(2)} rad/s (${perTurn.toFixed(2)} s a turn), ${deg(rot).toFixed(0)}° in ${air.toFixed(2)} s of air, stand ${b.riderStand.toFixed(2)}`)
  p.dispose()
}
{
  // spin: steer in the air off the same kicker; let go → the spin damps
  const p = world()
  let [z, y] = slab(p, -4, 0, 10 * DEG, 1.5)
  ;[z, y] = slab(p, z, y, 20 * DEG, 1.5)
  ;[z, y] = slab(p, z, y, 30 * DEG, 2.2)
  const b = bike(p, Surf.Dirt)
  b.place(0, 0, 25, 0)
  launch(b, 13)
  const hold = cruise(b, 13)
  let maxYaw = 0, t = 0, after = 0
  run(p, b, 4, () => (b.airborne ? (t < 0.6 ? { steer: 1 } : {}) : { pedal: hold() }), () => {
    if (b.airborne) {
      t += 1 / 60
      const w = b.body.angvel().y
      maxYaw = Math.max(maxYaw, -w)
      if (t > 0.6) after = -w
    }
    return !b.airborne && t > 0.3
  })
  check('air: steer spins (~360° in ~1 s), let go → it damps', maxYaw > 5 && maxYaw < 7.5 && after < maxYaw * 0.7, `${maxYaw.toFixed(2)} rad/s (${((2 * Math.PI) / maxYaw).toFixed(2)} s a turn), ${after.toFixed(2)} rad/s at the landing`)
  p.dispose()
}

// ------------------------------------------------------------------ 11. into a wall at 30 km/h, remount
{
  const p = world()
  box(p, [-6, 0, -31], [6, 4, -30], Groups.Static)
  const b = bike(p, Surf.Asphalt)
  b.place(0, 0, -12, 0)
  launch(b, 30 / 3.6)
  const hold = cruise(b, 30 / 3.6)
  run(p, b, 5, () => ({ pedal: hold() }), () => b.crashed)
  const bail = b.bail
  check('wall at 30 km/h: crash, the rider bails (a body)', b.crashed && b.crashReason === 'impact' && !!bail, `${b.crashReason}, bail at y ${bail?.y.toFixed(2)}`)
  run(p, b, 3, {})
  const lying = Math.abs(deg(b.roll))
  const bail2 = b.bail
  check('… the bike falls over and lies; the rider lands', lying > 50 && !!bail2 && bail2.y < 1, `bike roll ${lying.toFixed(0)}°, rider at y ${bail2?.y.toFixed(2)}`)
  b.remount()
  run(p, b, 1.5, {})
  check('remount(): upright, rider on, on its wheels', !b.crashed && b.bail === null && Math.abs(deg(b.roll)) < 2 && b.front.contact && b.rear.contact, `roll ${deg(b.roll).toFixed(2)}°, crashed ${b.crashed}`)
  p.dispose()
}

// ------------------------------------------------------------------ 12. a nose-down landing
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 3, 0, 0, -60 * DEG)
  launch(b, 5)
  run(p, b, 3, {}, () => b.crashed)
  check('nose-down (60°) landing → crash', b.crashed && b.crashReason === 'nose-in', `${b.crashReason || 'no crash'}`)
  p.dispose()
}
{
  // and landing sideways (heading 50° off the velocity)
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 1.5, 0, 0)
  b.body.setLinvel({ x: -Math.sin(50 * DEG) * 8, y: 0, z: -Math.cos(50 * DEG) * 8 }, true)
  run(p, b, 3, {}, () => b.crashed)
  check('landing 50° sideways at 8 m/s → crash', b.crashed && b.crashReason === 'sideways', `${b.crashReason || 'no crash'}`)
  p.dispose()
}

// ------------------------------------------------------------------ extra: kerbs, rough ground, the crossing
for (const h of [0.12, 0.2, 0.4]) {
  // a square-edged block (Static, as the game's rocks / kerbs) at 15 km/h: the tyre envelope rolls up a kerb under
  // ~0.55 r; taller, the tyre's face stops it
  const p = world()
  box(p, [-3, 0, -10.3], [3, h, -9.7], Groups.Static)
  const b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  launch(b, 15 / 3.6)
  let maxF = 0
  run(p, b, 5, () => ({ pedal: b.speed < 15 / 3.6 ? 0.6 : 0 }), () => { maxF = Math.max(maxF, b.forkShare); return b.crashed })
  const over = b.body.translation().z < -12
  if (h < 0.3) check(`a ${h * 100} cm kerb at 15 km/h rides over (the fork takes it)`, over && !b.crashed && b.speed > 3, `fork ${(maxF * 100).toFixed(0)} %, ${kmh(b.speed).toFixed(1)} km/h after`)
  else check(`a ${h * 100} cm block at 15 km/h without a hop → crash`, b.crashed, `${b.crashReason || 'no crash'}`)
  p.dispose()
}
{
  // rough dirt / grass (the game's surface sampler fills the roughness): 20 s weaving at ~25 km/h
  const p = world(), b = new MtbSim(p)
  b.surface = (_x, _z, out) => { out.w.fill(0); out.w[Surf.Dirt] = 0.7; out.w[Surf.Grass] = 0.3; out.wet = 0; blendRoughness(out) }
  b.place(0, 0, 0, 0)
  let maxF = 0, minF = 1
  run(p, b, 20, (s) => ({ pedal: b.speed < 7 ? 1 : 0.3, steer: Math.sin(s * 0.8) * 0.7 }), (s) => { if (s > 3) (maxF = Math.max(maxF, b.forkShare)), (minF = Math.min(minF, b.forkShare)); return b.crashed })
  check('rough ground: 20 s weaving at ~25 km/h, the fork working, no crash', !b.crashed && maxF - minF > 0.1 && b.speed > 5, `fork ${(minF * 100).toFixed(0)}–${(maxF * 100).toFixed(0)} %, ${kmh(b.speed).toFixed(1)} km/h`)
  p.dispose()
}
{
  // the crossing: shift() mid-ride keeps the speed and doesn't read as an impact
  const p = world(), b = bike(p)
  b.place(0, 0, 0, 0)
  launch(b, 30 / 3.6)
  run(p, b, 1, { pedal: 0.8 })
  b.shift(500, 2, -300)
  const v0 = b.speed
  run(p, b, 1, { pedal: 0.8 })
  const t = b.body.translation()
  check('shift(): moved with the same speed, no crash', !b.crashed && Math.abs(t.x - 500) < 0.5 && Math.abs(b.speed - v0) < 1, `at ${t.x.toFixed(1)}, ${t.z.toFixed(1)}, ${kmh(b.speed).toFixed(1)} km/h`)
  p.dispose()
}

// ------------------------------------------------------------------ the in-game ride's findings (2026-11-05)
// Driven as the game drives it (src/oth/Bike.ts): the pedal comes on over 0.35 s (off over 0.15), the brake over 0.2 s
// (off over 0.1); rough wet grass from the surface sampler.
function keysOf(): (W: boolean, S: boolean) => { pedal: number; brake: number } {
  let p = 0, k = 0
  return (W, S) => {
    p = W ? Math.min(1, p + 1 / 60 / 0.35) : Math.max(0, p - 1 / 60 / 0.15)
    k = S ? Math.min(1, k + 1 / 60 / 0.2) : Math.max(0, k - 1 / 60 / 0.1)
    return { pedal: p, brake: k }
  }
}
const wetGrass = (b: MtbSim) => (b.surface = (_x: number, _z: number, out: SurfaceMix) => { out.w.fill(0); out.w[Surf.Grass] = 1; out.wet = 1; blendRoughness(out) })
/** A wide slope rising toward −z from z = −4 (rough wet grass on the bike). */
function hill(deg: number): PhysicsWorld {
  const p = world(), a = deg * DEG, L = 200, th = 0.5
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed())
  p.world.createCollider(
    R.ColliderDesc.cuboid(200, th, L / 2).setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) })
      .setTranslation(0, (L / 2) * Math.sin(a) - th * Math.cos(a), -4 - (L / 2) * Math.cos(a) - th * Math.sin(a)).setCollisionGroups(group(Groups.Terrain, 0xffff)),
    g,
  )
  return p
}
{
  // 1. the AUTO-SHIFT on a climb: W (+ a little D) from 19 km/h up 18° of wet grass, the rear tyre scrabbling — it shifts
  // DOWN as it slows (it had climbed to gear 11 at 31 rpm: a spinning tyre read as a high cadence)
  const p = hill(18), b = new MtbSim(p)
  wetGrass(b)
  b.place(0, 0, 1, 0)
  launch(b, 19 / 3.6)
  const keys = keysOf()
  let upWhileSlowing = 0, prevG = b.gear, prevV = b.speed, lowCad = 999, slipMax = 0
  run(p, b, 7, (s) => ({ ...keys(true, false), steer: s > 1.5 ? 0.15 : 0 }), (s) => {
    if (b.gear > prevG && b.speed < prevV - 0.05 && s > 1) upWhileSlowing++
    if (s > 3 && b.pedalling && b.speed > 5.5 / 3.6) lowCad = Math.min(lowCad, b.cadence)
    slipMax = Math.max(slipMax, b.rear.slip)
    prevG = b.gear; prevV = b.speed
    return false
  })
  check('climb 18° wet grass from 19 km/h: shifts down as it slows, cadence held', upWhileSlowing === 0 && b.gear <= 2 && lowCad >= 55 && !b.crashed, `${upWhileSlowing} upshifts while slowing, gear ${b.gear} at ${kmh(b.speed).toFixed(1)} km/h, cadence ≥ ${lowCad.toFixed(0)} rpm above 5.5 km/h, rear slip ≤ ${slipMax.toFixed(2)}`)
  // 4. HILL HOLD: let go of everything up there — it stops and the rider holds it (a foot down), the front stays down
  let zStop = NaN, lift = 0, minV = 0
  run(p, b, 5, () => keys(false, false), (s) => {
    minV = Math.min(minV, b.speed)
    if (Number.isNaN(zStop) && s > 0.5 && Math.abs(b.speed) < 0.3) zStop = b.body.translation().z
    if (!Number.isNaN(zStop) && !b.front.contact) lift += 1 / 60
    return false
  })
  const crept = Math.abs(b.body.translation().z - zStop)
  check('hill hold: released on 18° it stops and holds (< 15 cm), front down, never rolls back fast', crept < 0.15 && minV > -1.5 && lift < 0.2 && !b.crashed, `crept ${(crept * 100).toFixed(1)} cm, slowest ${kmh(minV).toFixed(1)} km/h, front off ${lift.toFixed(2)} s`)
  p.dispose()
}
{
  // … and DOWNHILL from speed, nothing pressed, it still freewheels (the hold is for a standstill)
  const p = hill(10), b = bike(p, Surf.Dirt)
  const d = 60, a = 10 * DEG
  b.place(0, d * Math.sin(a), -4 - d * Math.cos(a), Math.PI, -a)
  launch(b, 4, Math.PI)
  let top = 0
  run(p, b, 4, {}, () => { top = Math.max(top, b.speed); return false })
  check('downhill from 14 km/h, hands off: freewheels on (no hold)', top > 6 && !b.pedalling, `${kmh(top).toFixed(1)} km/h`)
  p.dispose()
}
{
  // 2. the BUNNY HOP at ~10 km/h, pedalling (W), Space 0.5 s then released: it lands level and keeps its speed (it had
  // landed at 2.5 km/h near bottom-out — the wheelie balance took the pop for an unasked wheelie and braked it)
  const p = world(), b = new MtbSim(p)
  wetGrass(b)
  b.place(0, 0, 0, 0)
  launch(b, 10 / 3.6)
  const keys = keysOf()
  run(p, b, 2, () => ({ ...keys(b.speed < 10 / 3.6, false) }))
  const v0 = b.speed
  let flew = false, landedAt = NaN, maxRear = 0, landPitch = 0, minV = 99
  run(p, b, 2.5, (s) => ({ ...keys(true, false), hop: s < 0.5 }), (s) => {
    if (b.airborne) flew = true
    if (flew && !b.airborne && Number.isNaN(landedAt)) (landedAt = s), (landPitch = b.pitch)
    if (flew) (maxRear = Math.max(maxRear, b.rearShare)), (minV = Math.min(minV, b.speed))
    return false
  })
  check('hop at 10 km/h (pedalling, Space 0.5 s): keeps its speed, lands level, not bottomed', flew && minV > 0.75 * v0 && Math.abs(deg(landPitch)) < 10 && maxRear < 0.9 && !b.crashed, `${kmh(v0).toFixed(1)} → lowest ${kmh(minV).toFixed(1)} km/h after the pop, ${kmh(b.speed).toFixed(1)} km/h at the end, landing pitch ${deg(landPitch).toFixed(1)}°, rear ${(maxRear * 100).toFixed(0)} %`)
  p.dispose()
}
{
  // 3. BRAKE to a stop and hold S: it stops (no running back), and only after 0.6 s at a standstill walks back slowly
  const p = world(), b = new MtbSim(p)
  wetGrass(b)
  b.place(0, 0, 0, 0)
  launch(b, 7 / 3.6)
  const keys = keysOf()
  // (the walk is told by the frame's position: right after a hard stop the COM rocks back on the springs for a moment)
  let stopAt = NaN, zStop = 0, walkAt = NaN, walkV = 0
  run(p, b, 4, () => keys(false, true), (s) => {
    const z = b.body.translation().z
    if (Number.isNaN(stopAt) && b.speed < 0.3) (stopAt = s), (zStop = z)
    if (!Number.isNaN(stopAt) && Number.isNaN(walkAt) && z - zStop > 0.05) walkAt = s
    if (s > 3) walkV = Math.min(walkV, b.speed)
    return false
  })
  const wait = walkAt - stopAt
  check('brake held from 7 km/h: stops, walks back only after ≥ 0.6 s at a standstill, slowly (≤ 1.5 km/h)', wait >= 0.6 && walkV < -0.05 && walkV > -1.5 / 3.6 && !b.crashed, `stopped at ${stopAt.toFixed(2)} s, walking from ${wait.toFixed(2)} s later at ${kmh(-walkV).toFixed(2)} km/h`)
  p.dispose()
}

// ------------------------------------------------------------------ 13. cost
{
  const p = world(), b = bike(p, Surf.Dirt)
  b.place(0, 0, 0, 0)
  run(p, b, 1, {})
  let simMs = 0, worldMs = 0
  const N = 3000
  for (let i = 0; i < N; i++) {
    Object.assign(b.controls, IDLE, { pedal: 0.8, steer: Math.sin(i / 90) * 0.6 })
    const t0 = performance.now()
    b.step(1 / 60)
    const t1 = performance.now()
    p.world.step()
    worldMs += performance.now() - t1
    simMs += t1 - t0
  }
  const us = (simMs / N) * 1000
  check('cost: MtbSim.step ≤ 50 µs (Node, riding + steering)', us <= 50, `${us.toFixed(1)} µs / step (+ the world step ${((worldMs / N) * 1000).toFixed(1)} µs), ${kmh(b.speed).toFixed(0)} km/h`)
  p.dispose()
}

process.exit(failures ? 1 : 0)
