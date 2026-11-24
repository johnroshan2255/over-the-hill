// ramtest.mjs — THE ENEMY'S CAR ON YOURS (oth/Companion.ts; 2026-11-21, the user: "when it hits me it goes back like it
// bounced off a balloon … hit on the side, it does not touch my car's side … it must hit the car, not an invisible outer
// layer"): every physics step through a ram — how far his car's own nose is from your car's own body, his speed, yours.
//   1. from behind, you standing: his nose ON your body at the blow, never off it while he pushes, his car never going
//      backward in the second after;
//   2. your car across his way: his nose on your car's SIDE;
//   3. what is solid of him is his shape: a ray at his door stops at the door, not at a box round his mirrors.
//   node scripts/harness/ramtest.mjs     env: PORT (5200), TIER (low), SHOTS (a folder for the pictures)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = process.env.SHOTS
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const errs = []
let p
/** A game of its own: the enemy behind you, 20 m of way driven for him to come along — then, `side`: your car turned a
 *  quarter where it stands, before he is there. */
const game = async (side) => {
p = await b.newPage()
p.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message.slice(0, 400)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'low'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&companion=enemy`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
// (a way for him to come along: 20 m of it driven — no further: flat out for longer it leaves the track —, then stopped)
await p.keyboard.down('KeyW'); await sleep(2400); await p.keyboard.up('KeyW')
await p.keyboard.down('Space'); await sleep(1300); await p.keyboard.up('Space')
// (square across the way he comes along — its last 4 m —, not a quarter from your car's own heading: a braked stop
//  that slid left the car askew to its way, and he met its end, not its side)
if (side) await p.evaluate(() => {
  const o = window.__oth, c = o.car, t = c.sim.body.translation(), m = o.companion, n = m.xs.length
  let i = n - 1
  while (i > 0 && Math.hypot(m.xs[n - 1] - m.xs[i], m.zs[n - 1] - m.zs[i]) < 4) i--
  const way = n > 1 ? Math.atan2(-(m.xs[n - 1] - m.xs[i]), -(m.zs[n - 1] - m.zs[i])) : c.sim.heading
  c.placeAt(t.x, t.z, way + Math.PI / 2)
})
await p.evaluate(() => {
  const o = window.__oth, pw = o.physics.pw, R = pw.R
  /** his nose from your body (m): the two shapes, as they stand in the physics */
  window.__gap = () => {
    const c = o.companion, body = o.car.sim.body
    if (!c || !c.nose) return 9
    let gap = 9
    for (let i = 0; i < body.numColliders(); i++) {
      const col = body.collider(i)
      if (col.shapeType() !== R.ShapeType.TriMesh) continue
      const k = col.contactShape(c.nose, c.carP, c.carQ, 6)
      if (k) gap = Math.min(gap, k.distance)
    }
    return gap
  }
  /** his car's own SOLID pieces from your body (m; under 0: into it) — taken only when the nose's wrap says it is in:
   *  the wrap bridges the hollows of his front (over his bonnet, behind his bars), and your car rocking back into
   *  one of those reads as "in" with nothing touching */
  window.__solid = () => {
    const c = o.companion, body = o.car.sim.body
    let gap = 9, mine = null
    for (let i = 0; i < body.numColliders(); i++) if (body.collider(i).shapeType() === R.ShapeType.TriMesh) mine = body.collider(i)
    if (!mine || !c.solid) return gap
    for (let i = 0; i < c.solid.body.numColliders(); i++) {
      const h = c.solid.body.collider(i)
      if (h.shapeType() !== R.ShapeType.ConvexPolyhedron) continue
      const k = mine.contactCollider(h, 1)
      if (k) gap = Math.min(gap, k.distance)
    }
    return gap
  }
  // AT THE BLOW (his ram gives your car its shove — before the step that moves it on): the gap, where he met it in
  // your car's own space
  window.__blow = null
  const host = o.companion.host, shove = host.shove
  host.shove = (dx, dz, dv, spin, at, by) => {
    if (at) {
      const t = o.car.sim.body.translation(), r = o.car.sim.body.rotation()
      const l = at.clone().sub(o.car.root.position.clone().set(t.x, t.y, t.z)).applyQuaternion(o.car.root.quaternion.clone().set(r.x, r.y, r.z, r.w).invert())
      // (his car stands where it will be against yours at the END of this step — yours has its own step still to go:
      //  the gap now, and what your car's speed along his way adds to it in a step)
      const v = o.car.sim.body.linvel()
      window.__blow = { gap: +(window.__gap() + Math.max(0, v.x * dx + v.z * dz) / 60).toFixed(3), at: [+l.x.toFixed(2), +l.y.toFixed(2), +l.z.toFixed(2)], dv: +dv.toFixed(2) }
    }
    return shove(dx, dz, dv, spin, at, by)
  }
  // every step: the gap, his speed, yours along his way
  window.__steps = []
  window.__rec = false
  const prev = pw.afterStep
  pw.afterStep = () => {
    prev?.()
    const c = o.companion
    if (!window.__rec || !c || c.mode !== 'car') return
    const v = o.car.sim.body.linvel(), fx = -Math.sin(c.carYaw), fz = -Math.cos(c.carYaw)
    const g0 = window.__gap()
    window.__steps.push({ g: +g0.toFixed(3), in: g0 < -0.02 ? +window.__solid().toFixed(3) : 0, his: +c.carSpeed.toFixed(2), you: +(v.x * fx + v.z * fz).toFixed(2), rams: c.rams, push: +c.pushT.toFixed(2) })
  }
})
}
const shot = async (name, x, y, z, lookH = 0.8) => {
  if (!SHOTS) return
  await p.evaluate((x, y, z, l) => window.__oth.spectate(x, y, z, l), x, y, z, lookH)
  await sleep(250)
  await p.screenshot({ path: `${SHOTS}/${name}.png` })
  await p.evaluate(() => window.__oth.spectate())
}
/** Wait for his next ram (up to `s` seconds), recording every step; then `after` ms more. */
const ram = async (s, after, pic) => {
  const r0 = await p.evaluate(() => { window.__steps.length = 0; window.__blow = null; window.__rec = true; return window.__oth.companion.rams })
  for (let i = 0; i < s * 10; i++) { await sleep(100); if (await p.evaluate((r0) => window.__oth.companion.rams > r0, r0)) break }
  if (pic) { await sleep(350); await shot(...pic) }
  await sleep(after)
  return p.evaluate((r0) => { window.__rec = false; const S = window.__steps, i = S.findIndex((q) => q.rams > r0); return { at: i, blow: window.__blow, before: S.slice(Math.max(0, i - 3), Math.max(0, i)), steps: i < 0 ? [] : S.slice(i) } }, r0)
}
const tell = (st) => st.filter((_, i) => i < 6 || i % 12 === 0).map((q) => `${q.g}|${q.his}|${q.you}`).join('  ')

// 1. FROM BEHIND, you standing
await game(false)
let r = await ram(40, 2400, ['1_rear_ram_above', 0.01, 11, 3.5, 0.3])
console.log(`from behind — the 3 steps before: ${tell(r.before)}\n   from the blow (gap m | his m/s | yours m/s along his way): ${tell(r.steps)}`)
if (r.at < 0) console.log('   (no ram:', JSON.stringify(await p.evaluate(() => { const o = window.__oth, c = o.companion, S = window.__steps; return { mode: c.mode, speed: +c.carSpeed.toFixed(2), cool: +c.ramCool.toFixed(2), push: +c.pushT.toFixed(2), lean: +c.leanT.toFixed(2), joinK: +c.joinK.toFixed(2), onYou: c.onYou, rams: c.rams, d: +Math.hypot(c.carP.x - o.car.pos.x, c.carP.z - o.car.pos.z).toFixed(1), gap: +window.__gap().toFixed(2), fit: c.car.damage ? +c.car.damage.drive.toFixed(2) : 1, youOnFoot: o.onFoot, kmh: Math.round(o.car.speedKmh), up: +(1 - 2 * (o.car.root.quaternion.x ** 2 + o.car.root.quaternion.z ** 2)).toFixed(2), last: S.slice(-3) } })), ')')
check(r.at >= 0, 'he rams your standing car')
if (r.at >= 0) {
  const s = r.steps, sec = s.slice(0, 60), push = s.filter((q) => q.push > 0)
  check(r.blow && r.blow.gap < 0.05 && r.blow.gap > -0.05, `at the blow his nose is ON your car's body (${r.blow?.gap} m between the two shapes; the blow ${r.blow?.dv} m/s to each)`)
  // (the blow sends your car a hand's breadth on; he is on it again, pushing — and never INTO it)
  const gaps = push.map((q) => q.g).sort((a, b) => a - b)
  check(s.every((q) => q.in > -0.06), `he never goes into your car (his solid pieces in yours, the deepest in ${s.length} steps: ${Math.min(...s.map((q) => q.in)).toFixed(3)} m — they stand 2 cm inside his panels; the nose's wrap ${Math.min(...s.map((q) => q.g)).toFixed(3)} m)`)
  check(gaps.length > 20 && gaps[gaps.length >> 1] < 0.25, `while he pushes he is on it (half the ${gaps.length} steps within ${gaps[gaps.length >> 1]?.toFixed(3)} m; the furthest off ${gaps[gaps.length - 1]?.toFixed(3)} m)`)
  check(sec.every((q) => q.his > -0.05), `in the second after the blow his car never goes backward (its lowest speed: ${Math.min(...sec.map((q) => q.his)).toFixed(2)} m/s)`)
  check(Math.abs(s[1].his - s[1].you) < 2.5 && s[1].you > 0.5, `the blow is dead: the two go on together (the step after: his ${s[1].his}, yours ${s[1].you} m/s)`)
}

// 2. YOUR CAR ACROSS HIS WAY: turned a quarter where it stands, he comes along the way you drove
await p.close()
await game(true)
r = await ram(40, 900, ['2_side_ram_above', 0.01, 11, 1.5, 0.3])
await shot('2_side_ram_low', 5.5, 1.4, 0.2)
console.log(`across his way — from the blow: ${tell(r.steps)}`)
check(r.at >= 0, 'he rams your car\'s side')
if (r.at >= 0) {
  const s = r.steps
  const half = await p.evaluate(() => +window.__oth.car.bodyBox.hx.toFixed(2))
  check(r.blow && r.blow.gap < 0.05 && r.blow.gap > -0.05, `at the blow his nose is ON your car's side (${r.blow?.gap} m between the two shapes)`)
  check(r.blow && Math.abs(r.blow.at[0]) > half * 0.6 && Math.abs(r.blow.at[2]) < 1.9, `it met your car on its flank (at ${JSON.stringify(r.blow?.at)} in your car's space — its half width ${half})`)
  check(s.every((q) => q.in > -0.06), `he never goes into it (his solid pieces in yours, the deepest: ${Math.min(...s.map((q) => q.in)).toFixed(3)} m; the nose's wrap ${Math.min(...s.map((q) => q.g)).toFixed(3)} m)`)
}

// 3. WHAT IS SOLID OF HIM: a ray at his door from his right, in his car's own frame — it stops where his own mesh is
const solid = await p.evaluate(() => {
  const o = window.__oth, c = o.companion, pw = o.physics.pw, sh = c.car.shape, box = c.car.box, m = sh.mesh
  // (his body's own skin on that line — y 1.0, z 0, from +x: the ray against every triangle of the mesh, car space)
  let skin = -9
  for (let i = 0; i < m.length; i += 9) {
    const ay = m[i + 1] - 1.0, az = m[i + 2], by = m[i + 4] - 1.0, bz = m[i + 5], cy = m[i + 7] - 1.0, cz = m[i + 8]
    const d = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    if (Math.abs(d) < 1e-12) continue
    const u = ((0 - ay) * (cz - az) - (0 - az) * (cy - ay)) / d, v = ((by - ay) * (0 - az) - (bz - az) * (0 - ay)) / d
    if (u < 0 || v < 0 || u + v > 1) continue
    const x = m[i] + u * (m[i + 3] - m[i]) + v * (m[i + 6] - m[i])
    if (x > skin) skin = x
  }
  const at = c.carP.clone().set(4, 1.0, 0).applyQuaternion(c.carQ).add(c.carP), dir = c.carP.clone().set(-1, 0, 0).applyQuaternion(c.carQ)
  const hit = pw.world.castRay(new pw.R.Ray(at, dir), 6, true, undefined, undefined, undefined, o.car.sim.body, (col) => col.parent()?.handle === c.solid.body.handle)
  return { skin: +skin.toFixed(3), hit: hit ? +(4 - hit.timeOfImpact).toFixed(3) : null, box: +(box.c.x + box.h.x).toFixed(3), colliders: c.solid.body.numColliders() }
})
console.log('his car\'s side:', JSON.stringify(solid))
check(solid.hit !== null && Math.abs(solid.hit - solid.skin) < 0.02, `a ray at his door stops at the door (${solid.hit} m from his middle; his panel there is at ${solid.skin}; the old box stood at ${solid.box})`)
check(errs.length === 0, `no page errors (${errs.length})`)
await b.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
