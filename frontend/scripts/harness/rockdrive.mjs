// rockdrive.mjs [tier] — the car DRIVEN INTO THE DESERT'S ROCK (2026-11-04 — the user: "collider issues in some places,
// the tyres get stuck inside and the fps drops"). For each site [x0, z0, x1, z1] (env SITES, JSON; default: a few slab
// walls, massifs and terraces from meta.json) the car is set at (x0, z0) facing (x1, z1) and driven at it, full
// throttle, for SECONDS (25) — reports per site: the physics' step time (mean / worst, ms), the collider streaming's
// (follow: mean / worst), the frame time (worst), the colliders in the world, the time STUCK (< 0.5 m/s under
// throttle), a wheel's ray starting INSIDE rock (its hard point in a collider), any flip.
//   PORT=5200 [SITES='[[x0,z0,x1,z1], …]'] node scripts/harness/rockdrive.mjs ultra
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const tier = process.argv[2] || 'ultra'
const SECONDS = Number(process.env.SECONDS || 25)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
let SITES = JSON.parse(process.env.SITES || 'null')
if (!SITES) {
  // default: the car 30 m off a few big stacks of each kind, driven at their middles
  const meta = JSON.parse(fs.readFileSync('public/oth/desert/meta.json', 'utf8')), K = JSON.parse(fs.readFileSync('public/oth/desert/stacks.json', 'utf8')).kinds
  const want = { wall: 3, massif: 2, terrace: 2, mesa: 2, table: 1 }, got = {}
  SITES = []
  for (const [x, z, sc, , k] of meta.stacks) {
    const kind = K[k].kind
    if (!want[kind] || (got[kind] ?? 0) >= want[kind] || Math.abs(x) > 1700 || Math.abs(z) > 1700) continue
    got[kind] = (got[kind] ?? 0) + 1
    const R = K[k].radius * sc, a = (x * 7 + z * 3) % 6.28
    SITES.push([+(x + Math.cos(a) * (R * 0.6 + 30)).toFixed(1), +(z + Math.sin(a) * (R * 0.6 + 30)).toFixed(1), x, z])
  }
}
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=960,540'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&world=desert&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
await p.evaluate(() => {
  const o = window.__oth, ph = o.physics, w = ph.pw.world
  const P = (window.__probe = { follow: [], step: [], frame: [], last: performance.now() })
  const f0 = ph.follow.bind(ph)
  ph.follow = (x, z) => { const t = performance.now(); f0(x, z); P.follow.push(performance.now() - t) }
  const s0 = w.step.bind(w)
  w.step = (e) => { const t = performance.now(); s0(e); P.step.push(performance.now() - t) }
  const tick = () => { const t = performance.now(); P.frame.push(t - P.last); P.last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [x0, z0, x1, z1] of SITES) {
  await p.evaluate((x0, z0, x1, z1) => {
    const o = window.__oth, car = o.car, sim = car.sim, P = window.__probe
    o.drive(true)
    o.physics.follow(x0, z0)
    sim.place(x0, o.physics.surface(x0, z0, o.height(x0, z0)) + 0.7, z0, Math.atan2(-(x1 - x0), -(z1 - z0))) // (on top: never in a slab)
    car.shift(0, 0, 0)
    P.follow.length = P.step.length = P.frame.length = 0
    const bot = (window.__rd = { t: 0, stuck: 0, inside: 0, flips: 0, done: false, what: {} })
    if (!sim.__step0) sim.__step0 = sim.step.bind(sim)
    const step = sim.__step0, w = o.physics.pw.world
    sim.step = (dt) => {
      const t = sim.body.translation()
      bot.t += dt
      let err = Math.atan2(-(x1 - t.x), -(z1 - t.z)) - sim.heading
      err = Math.atan2(Math.sin(err), Math.cos(err))
      // (at it, then round it: once within 12 m, circle its middle)
      const d = Math.hypot(x1 - t.x, z1 - t.z)
      sim.controls.steer = Math.max(-1, Math.min(1, -err * 2.0 + (d < 12 ? 0.6 : 0)))
      sim.controls.throttle = 1; sim.controls.brake = false; sim.controls.handbrake = false
      if (Math.abs(sim.speed) < 0.5 && bot.t > 2) bot.stuck += dt
      // a wheel's hard point inside a collider (not the car's own): its ray starts in rock
      for (let i = 0; i < 4; i++) {
        const hp = sim.vc.wheelHardPoint(i)
        if (hp && w.intersectionsWithPoint) {
          let inn = false
          let what = 0
          w.intersectionsWithPoint(hp, (c) => { if (c.parent()?.handle !== sim.body.handle) { inn = true; what = c.collisionGroups() >>> 16; return false } return true })
          if (inn) { bot.inside += dt / 4; bot.what[what] = (bot.what[what] ?? 0) + 1 }
        }
      }
      step(dt)
      const q = sim.body.rotation(), upY = 1 - 2 * (q.x * q.x + q.z * q.z)
      if (upY < 0.2) bot.flips += dt
    }
  }, x0, z0, x1, z1)
  await sleep(SECONDS * 1000)
  const res = await p.evaluate(() => {
    const P = window.__probe, r = window.__rd, w = window.__oth.physics.pw.world
    const st = (a) => a.length ? { mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2), worst: +Math.max(...a).toFixed(1), p99: +a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.99)].toFixed(1) } : null
    let cols = 0; w.forEachCollider(() => cols++)
    return { step: st(P.step), follow: st(P.follow), frame: st(P.frame), colliders: cols, stuck: +r.stuck.toFixed(1), wheelInRock: +r.inside.toFixed(1), inGroups: r.what, flipped: +r.flips.toFixed(1) }
  })
  console.log(`site [${x0}, ${z0}] → [${x1}, ${z1}]:`, JSON.stringify(res))
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true }); await p.screenshot({ path: `${process.env.SHOTS}/rock_${x0}_${z0}.png` })
    // (and from above: where it ended, 14 m up and back, looking down at it)
    await p.evaluate(() => { const o = window.__oth, t = o.car.sim.body.translation(), h = o.car.sim.heading; o.view(t.x + Math.sin(h) * 10, t.z + Math.cos(h) * 10, 14 + t.y - o.height(t.x + Math.sin(h) * 10, t.z + Math.cos(h) * 10), h, -0.85) })
    await sleep(1500)
    await p.screenshot({ path: `${process.env.SHOTS}/rock_${x0}_${z0}_above.png` })
  }
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
