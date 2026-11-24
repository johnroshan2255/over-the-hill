// rundown.mjs — THE ENEMY RUNS YOU DOWN, YOUR PARKED CAR BETWEEN (oth/Companion.ts `runDown` / `blocked`; NEXT_damage
// §2.4: "his own driving at you on foot does not try his nose against anything: he drives through your parked car").
// You out of your car, 7 m beyond its nose; his car put 25 m behind it, coming at 8 m/s, so his straight line to you runs
// through your car. Every physics step: how far his nose is from your car's solid pieces (under 0: into it).
//   - he never goes into your car; he stops at it;
//   - both cars take the blow (he came at more than 2 m/s); your car is moved by it, not held;
//   - the run is over: he gets out and comes on foot.
//   node scripts/harness/rundown.mjs     env: PORT (5200), TIER (low), SHOTS (a folder for the pictures)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = process.env.SHOTS
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const errs = []
const p = await b.newPage()
p.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message.slice(0, 400)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'low'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&companion=enemy`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
// (a way driven — 20 m, no further: flat out for longer it leaves the track —, then stopped; he comes along in his car)
await p.keyboard.down('KeyW'); await sleep(2400); await p.keyboard.up('KeyW')
await p.keyboard.down('Space'); await sleep(1500); await p.keyboard.up('Space')
for (let i = 0; i < 60 && (await p.evaluate(() => window.__oth.companion?.mode !== 'car')); i++) await sleep(500)
check(await p.evaluate(() => window.__oth.companion.mode === 'car'), 'he is in his car')
// out (F), till on foot and the car is held where it stands
for (let i = 0; i < 20 && !(await p.evaluate(() => window.__oth.onFoot)); i++) { await p.keyboard.down('KeyF'); await sleep(80); await p.keyboard.up('KeyF'); await sleep(900) }
for (let i = 0; i < 40 && (await p.evaluate(() => window.__oth.car.landing)); i++) await sleep(200)
await sleep(800)
const setup = await p.evaluate(() => {
  const o = window.__oth, c = o.car, m = o.companion, h = c.sim.heading, fx = -Math.sin(h), fz = -Math.cos(h), t = c.sim.body.translation()
  const L = c.half.z
  // you 7 m beyond its nose; his car 25 m behind its tail, facing it, coming at 8 m/s
  o.hero.appear(t.x + fx * (L + 7), t.z + fz * (L + 7), h)
  const bx = t.x - fx * (L + 25), bz = t.z - fz * (L + 25)
  // (you out, his car stopped: he had got out of it — back in, and on: moving, he stays in it to run you down)
  if (m.mode !== 'car') m.intoCar()
  m.carP.set(bx, t.y, bz)
  m.carYaw = h
  m.carSpeed = 8
  m.ranDown = false; m.downT = 0; m.joinK = 1
  const R = o.physics.pw.R, body = c.sim.body
  /** his nose from your car's solid pieces (its hulls; m — under 0: into it) */
  window.__gap = () => {
    if (!m.nose) return 9
    let gap = 9
    for (let i = 0; i < body.numColliders(); i++) {
      const col = body.collider(i)
      if (col.shapeType() !== R.ShapeType.ConvexPolyhedron) continue
      const k = col.contactShape(m.nose, m.carP, m.carQ, 6)
      if (k) gap = Math.min(gap, k.distance)
    }
    return gap
  }
  window.__steps = []
  const prev = o.physics.pw.afterStep
  o.physics.pw.afterStep = () => {
    prev?.()
    if (window.__steps.length > 900) return
    // (how far along his way he is from your car's middle: past it — through it)
    const q = c.sim.body.translation()
    window.__steps.push({ g: +window.__gap().toFixed(3), along: +((m.carP.x - q.x) * fx + (m.carP.z - q.z) * fz).toFixed(2), v: +m.carSpeed.toFixed(2), mode: m.mode, kin: !c.sim.body.isDynamic() })
  }
  return { L, at: [t.x, t.z], dmg0: { yours: c.damage ? c.damage.cost : null, his: m.car.damage ? m.car.damage.cost : null } }
})
console.log('setup', JSON.stringify(setup))
await sleep(7000)
const r = await p.evaluate(() => {
  const o = window.__oth, m = o.companion, s = window.__steps, t = o.car.sim.body.translation()
  return { n: s.length, minGap: Math.min(...s.map((q) => q.g)), maxAlong: Math.max(...s.map((q) => q.along)), topV: Math.max(...s.map((q) => q.v)), mode: m.mode,
    yours: o.car.damage ? o.car.damage.cost : null, his: m.car.damage ? m.car.damage.cost : null, moved: Math.hypot(t.x, t.z), live: s.some((q) => !q.kin), last: s.slice(-3) }
})
r.moved = Math.hypot((await p.evaluate(() => { const t = window.__oth.car.sim.body.translation(); return [t.x, t.z] }))[0] - setup.at[0], (await p.evaluate(() => { const t = window.__oth.car.sim.body.translation(); return [t.x, t.z] }))[1] - setup.at[1])
console.log('run', JSON.stringify(r))
check(r.n > 100, `steps recorded (${r.n})`)
check(r.minGap > -0.06, `he never goes into your car (his nose from its solid pieces, the least: ${r.minGap.toFixed(3)} m)`)
check(r.maxAlong < -setup.L, `he stops at it: his car's middle never past your car's tail (${r.maxAlong.toFixed(2)} m along, its tail at ${(-setup.L).toFixed(2)})`)
check(r.topV > 2, `he came at it (${r.topV.toFixed(1)} m/s)`)
check(r.live && r.moved > 0.05, `your car took the blow — live for it, moved ${r.moved.toFixed(2)} m`)
if (setup.dmg0.yours !== null) check(r.yours > setup.dmg0.yours, `your car is damaged by it (its repair ${setup.dmg0.yours} → ${r.yours})`)
if (setup.dmg0.his !== null) check(r.his > setup.dmg0.his, `his car is damaged by it (its repair ${setup.dmg0.his} → ${r.his})`)
check(r.mode === 'foot' || r.mode === 'toCar', `the run is over — he gets out (${r.mode})`)
if (SHOTS) { await p.screenshot({ path: `${SHOTS}/rundown.png` }) }
check(errs.length === 0, `no page errors (${errs.length})`)
await b.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
