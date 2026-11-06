/**
 * THE MOTORBIKE (gameplay/vehicle/MotoSim.ts — the bikes' shared simulation, MtbSim.ts buildBikeSim, with an engine):
 * Node + real Rapier, a flat world plus a ramp. Every check prints PASS / FAIL with its numbers.
 */
import { group, Groups, PhysicsWorld } from '../src/physics/PhysicsWorld'
import { MotoSim, MOTO, MOTO_TUNE } from '../src/gameplay/vehicle/MotoSim'
import type { MtbControls } from '../src/gameplay/vehicle/mtbTypes'
import { Surf, type SurfaceMix } from '../src/gameplay/vehicle/drivetrain/tyre'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
const R = await PhysicsWorld.load()
const DEG = Math.PI / 180
const kmh = (v: number) => v * 3.6

function world(): PhysicsWorld {
  const p = new PhysicsWorld(R)
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed())
  p.world.createCollider(R.ColliderDesc.cuboid(4000, 0.5, 4000).setTranslation(0, -0.5, 0).setCollisionGroups(group(Groups.Terrain, 0xffff)), g)
  return p
}
/** A slab whose top face starts at (z0, y0) and rises toward −z at `a` rad for `len` m. */
function slab(p: PhysicsWorld, z0: number, y0: number, a: number, len: number): void {
  const g = p.world.createRigidBody(R.RigidBodyDesc.fixed()), th = 0.25
  const cy = y0 + (len / 2) * Math.sin(a) - th * Math.cos(a), cz = z0 - (len / 2) * Math.cos(a) - th * Math.sin(a)
  p.world.createCollider(R.ColliderDesc.cuboid(8, th, len / 2).setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }).setTranslation(0, cy, cz).setCollisionGroups(group(Groups.Terrain, 0xffff)), g)
}
function moto(p: PhysicsWorld, surface = Surf.Dirt): MotoSim {
  const b = new MotoSim(p)
  b.surface = (_x: number, _z: number, out: SurfaceMix) => { out.w.fill(0); out.w[surface] = 1; out.wet = 0; out.rough = 0; out.stones = 0 }
  return b
}
const IDLE: MtbControls = { pedal: 0, brake: 0, steer: 0, lean: 0, hop: false, sprint: false }
function run(p: PhysicsWorld, b: MotoSim, seconds: number, ctl: Partial<MtbControls> | ((s: number) => Partial<MtbControls>), each?: (s: number) => boolean | void): number {
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
function launch(b: MotoSim, v: number): void { b.body.setLinvel({ x: 0, y: 0, z: -v }, true) }
/** Hold a speed on the throttle (PI). */
function cruise(b: MotoSim, target: number): () => number {
  let i = 0.2
  return () => {
    const e = target - b.speed
    i = Math.max(0, Math.min(1, i + e * 0.01))
    return Math.max(0, Math.min(1, i + e * 0.25))
  }
}

{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  run(p, b, 2, {})
  const E = MOTO_TUNE.engine!
  console.log(`  engine: ${Math.max(...E.torque.map((t) => t[1]))} N·m, ${E.idle}–${E.redline} rpm, ${E.gears.length} gears, overall ${(E.gears[0] * E.primary * E.final).toFixed(1)} … ${(E.gears[E.gears.length - 1] * E.primary * E.final).toFixed(1)}; mass ${MOTO.mass.bike} + ${MOTO.mass.rider} kg; travel ${MOTO.fork.travel * 1000} / ${MOTO.rear.wheelTravel * 1000} mm`)
  console.log(`  at rest: sag front ${(b.forkShare * 100).toFixed(1)} %, rear ${(b.rearShare * 100).toFixed(1)} %, ${Math.round(b.rpm)} rpm`)
  check('rest: sag front 20–30 %, rear 27–37 %', b.forkShare > 0.2 && b.forkShare < 0.3 && b.rearShare > 0.27 && b.rearShare < 0.37, `${(b.forkShare * 100).toFixed(1)} / ${(b.rearShare * 100).toFixed(1)} %`)
  const x0 = b.body.translation()
  run(p, b, 3, {})
  const x1 = b.body.translation()
  check('rest: stands still, upright (a foot down)', Math.hypot(x1.x - x0.x, x1.z - x0.z) < 0.02 && !b.crashed && Math.abs(b.roll) < 3 * DEG, `crept ${(Math.hypot(x1.x - x0.x, x1.z - x0.z) * 1000).toFixed(1)} mm, roll ${(b.roll / DEG).toFixed(1)}°`)
  p.dispose()
}

// full throttle from a standstill on dirt
{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  run(p, b, 1, {})
  let t60 = 0, frontUp = 0, maxGear = 1, maxRpm = 0
  run(p, b, 10, { pedal: 1 }, (s) => {
    if (!t60 && kmh(b.speed) >= 60) t60 = s
    if (!b.front.contact) frontUp += 1 / 60
    maxGear = Math.max(maxGear, b.gear); maxRpm = Math.max(maxRpm, b.rpm)
    return b.crashed
  })
  check('launch (dirt, full throttle): 0–60 km/h in 1.8–4.5 s (a 450 MX bike: ~2 s)', t60 > 1.8 && t60 < 4.5, `${t60.toFixed(2)} s`)
  check('launch: > 95 km/h after 10 s, shifting up (≥ 4th), no crash', kmh(b.speed) > 95 && maxGear >= 4 && !b.crashed, `${kmh(b.speed).toFixed(0)} km/h, gear ${b.gear} (max ${maxGear}), ${Math.round(maxRpm)} rpm max${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  check('launch: the front stays down unless asked (< 0.5 s off the ground)', frontUp < 0.5, `${frontUp.toFixed(2)} s`)
  p.dispose()
}

// top speed (hard ground)
{
  const p = world(), b = moto(p, Surf.Asphalt)
  b.place(0, 0, 0, 0)
  run(p, b, 35, { pedal: 1 }, () => b.crashed)
  check('top speed (hard ground, 35 s): 160–200 km/h in 5th (~80 hp), no crash', kmh(b.speed) > 160 && kmh(b.speed) < 200 && b.gear === 5 && !b.crashed, `${kmh(b.speed).toFixed(0)} km/h, gear ${b.gear}, ${Math.round(b.rpm)} rpm`)
  p.dispose()
}

// braking from 70 km/h on dirt
{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  launch(b, 70 / 3.6)
  run(p, b, 0.5, { pedal: 0.4 })
  const z0 = b.body.translation().z, v0 = b.speed
  const t = run(p, b, 8, { brake: 1 }, () => b.speed < 0.3 || b.crashed)
  const d = Math.abs(b.body.translation().z - z0)
  check('brakes (dirt, from ~70 km/h): stops in < 40 m, in < 4 s, no crash', d < 40 && t < 4 && !b.crashed, `${kmh(v0).toFixed(0)} km/h → stop in ${d.toFixed(1)} m, ${t.toFixed(2)} s${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  p.dispose()
}

// a wheelie: lean back on the throttle
{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  const c = cruise(b, 30 / 3.6)
  run(p, b, 6, () => ({ pedal: c() }))
  let up = 0, maxPitch = 0
  run(p, b, 5, { pedal: 0.8, lean: -1 }, () => { if (b.wheelie) up += 1 / 60; maxPitch = Math.max(maxPitch, b.pitch); return b.crashed })
  check('wheelie (↓ + throttle at 30 km/h): up ≥ 3 s of 5, held < 70°, no loop-out', up >= 3 && maxPitch < 70 * DEG && !b.crashed, `${up.toFixed(2)} s up, max pitch ${(maxPitch / DEG).toFixed(0)}°, ${kmh(b.speed).toFixed(0)} km/h${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  run(p, b, 3, { pedal: 0.3 }, () => b.crashed)
  check('wheelie: let go of the lean — the front comes down', !b.wheelie && b.front.contact && !b.crashed, `front ${b.front.contact ? 'down' : 'up'}`)
  p.dispose()
}

// a corner at 50 km/h
{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  launch(b, 50 / 3.6)
  const c = cruise(b, 50 / 3.6)
  run(p, b, 1, () => ({ pedal: c() }))
  let maxRoll = 0
  run(p, b, 5, () => ({ pedal: c(), steer: 0.7 }), () => { maxRoll = Math.max(maxRoll, Math.abs(b.roll)); return b.crashed })
  check('corner (50 km/h, 70 % key): leans 15–45°, holds it, no crash', maxRoll > 15 * DEG && maxRoll < 45 * DEG && !b.crashed, `max lean ${(maxRoll / DEG).toFixed(0)}°, ${kmh(b.speed).toFixed(0)} km/h${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  p.dispose()
}

// a jump: a 18° kicker, 4 m, at ~60 km/h; lands on the flat
{
  const p = world(), b = moto(p)
  slab(p, -30, 0, 18 * DEG, 4)
  b.place(0, 0, 0, 0)
  launch(b, 60 / 3.6)
  const c = cruise(b, 60 / 3.6)
  let air = 0, maxAir = 0, landedOk = false
  run(p, b, 7, () => ({ pedal: c() }), () => {
    if (b.airborne) { air += 1 / 60; maxAir = Math.max(maxAir, air) } else { if (air > 0.4) landedOk = true; air = 0 }
    return b.crashed
  })
  check('jump (18° kicker at 60 km/h): flies ≥ 0.6 s, lands it, rides away', maxAir >= 0.6 && landedOk && !b.crashed, `${maxAir.toFixed(2)} s in the air, ${kmh(b.speed).toFixed(0)} km/h after${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  p.dispose()
}

// air control: lean back off a kicker and it turns back (a backflip's start)
{
  const p = world(), b = moto(p)
  slab(p, -30, 0, 22 * DEG, 6)
  b.place(0, 0, 0, 0)
  launch(b, 55 / 3.6)
  const c = cruise(b, 55 / 3.6)
  let rot = 0, inAir = false, air = 0
  run(p, b, 5, () => ({ pedal: b.airborne ? 0.5 : c(), lean: b.airborne && b.airTime > 0.1 ? -1 : 0 }), () => {
    if (b.airborne && b.body.translation().z < -25) { rot += Math.abs(b.body.angvel().x) / 60; inAir = true; air = b.airTime }
    return inAir && !b.airborne
  })
  check('air control: leaning back in the air flips it (≥ 200° on a 22° kicker at 55 km/h)', rot > 200 * DEG, `${(rot / DEG).toFixed(0)}° turned back in ${air.toFixed(2)} s of air`)
  p.dispose()
}

// THE CLIMB ASSIST: a face of 30° … 70°, 15 m long, taken at 30 km/h on full throttle — to the top
for (const deg of [30, 45, 60, 70]) {
  const p = world(), b = moto(p)
  const a = deg * DEG, L = 15, z0 = -12
  // (a curved foot, as the terrain's: three slabs at ⅓, ⅔ and the full angle, ~1.6 m each, then the face)
  let zz = z0, yy = 0
  for (const f of [1 / 3, 2 / 3]) { slab(p, zz, yy, a * f, 1.6); zz -= 1.6 * Math.cos(a * f); yy += 1.6 * Math.sin(a * f) }
  slab(p, zz, yy, a, L)
  b.place(0, 0, 0, 0)
  launch(b, 30 / 3.6)
  const top = yy + L * Math.sin(a)
  let best = 0, steep = 0
  const t = run(p, b, 12, (s) => ({ pedal: s < 0.3 ? 0.4 : 1 }), () => {
    best = Math.max(best, b.body.translation().y)
    steep = Math.max(steep, b.steep)
    return b.crashed || best > top - 0.3
  })
  check(`climb: a ${deg}° face, 15 m (a curved foot), from 30 km/h — to the top, no crash`, best > top - 0.3 && !b.crashed, `${best.toFixed(1)} of ${top.toFixed(1)} m up in ${t.toFixed(1)} s, assist ${(steep * 100).toFixed(0)} %${b.crashed ? ', CRASHED ' + b.crashReason : ''}`)
  p.dispose()
}

// cost
{
  const p = world(), b = moto(p)
  b.place(0, 0, 0, 0)
  launch(b, 40 / 3.6)
  const c = cruise(b, 40 / 3.6)
  run(p, b, 1, () => ({ pedal: c(), steer: 0.3 }))
  const n = 600
  let simT = 0
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    Object.assign(b.controls, IDLE, { pedal: c(), steer: 0.3 * Math.sin(i / 40) })
    const a = performance.now(); b.step(1 / 60); simT += performance.now() - a
    p.world.step()
  }
  const all = performance.now() - t0
  check('cost: MotoSim.step ≤ 50 µs (Node)', (simT / n) * 1000 <= 50, `${((simT / n) * 1000).toFixed(1)} µs / step (+ the world step ${(((all - simT) / n) * 1000).toFixed(1)} µs)`)
  p.dispose()
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall passed')
