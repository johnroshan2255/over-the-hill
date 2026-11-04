// crawltest.mjs [tier] — can the car CRAWL UP the rock? (2026-11-04: the desert's slickrock — "rocks we can actually
// climb with the car, slowly"). For each site [x0, z0, x1, z1] (env SITES, JSON; WORLD=desert): the car set down at
// (x0, z0) facing (x1, z1), driven toward it at a crawl (~10 km/h held, full throttle when it slows on a step), for up
// to SECONDS (60) — reports the height gained, how close it got, the slowest stretch, any flip.
//   PORT=5200 WORLD=desert SITES='[[x0,z0,x1,z1], …]' [SHOTS=<dir>: a view at the end of each] node scripts/harness/crawltest.mjs low
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'low'
const SITES = JSON.parse(process.env.SITES || '[]')
const SECONDS = Number(process.env.SECONDS || 60)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=960,540'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&world=${process.env.WORLD || 'desert'}&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [x0, z0, x1, z1] of SITES) {
  await p.evaluate((x0, z0, x1, z1) => {
    const o = window.__oth, car = o.car, sim = car.sim
    o.drive(true)
    sim.place(x0, o.height(x0, z0) + 0.7, z0, Math.atan2(-(x1 - x0), -(z1 - z0)))
    car.shift(0, 0, 0)
    const bot = (window.__crawl = { y0: o.height(x0, z0), ymax: -1e9, dmin: 1e9, flips: 0, slow: 0, t: 0, done: false })
    if (!sim.__step0) sim.__step0 = sim.step.bind(sim)
    const step = sim.__step0
    sim.step = (dt) => {
      const t = sim.body.translation(), v = Math.abs(sim.speed)
      bot.t += dt
      const d = Math.hypot(x1 - t.x, z1 - t.z)
      bot.dmin = Math.min(bot.dmin, d); bot.ymax = Math.max(bot.ymax, t.y)
      if (d < 8) bot.done = true
      if (bot.done) { sim.controls.throttle = 0; sim.controls.brake = true; step(dt); return }
      let err = Math.atan2(-(x1 - t.x), -(z1 - t.z)) - sim.heading
      err = Math.atan2(Math.sin(err), Math.cos(err))
      sim.controls.steer = Math.max(-1, Math.min(1, -err * 2.0))
      const target = 10 / 3.6
      sim.controls.throttle = v < target ? Math.min(1, 0.35 + (target - v) * 0.6) : 0.1
      sim.controls.brake = false; sim.controls.handbrake = false
      if (v < 0.5 && bot.t > 3) bot.slow += dt
      step(dt)
    }
  }, x0, z0, x1, z1)
  const t0 = Date.now()
  let res = null
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(1000)
    res = await p.evaluate(() => {
      const o = window.__oth, B = window.__crawl, q = o.car.root.quaternion
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
      if (upY < 0.3) B.flips++
      return { gained: +(B.ymax - B.y0).toFixed(1), closest: +B.dmin.toFixed(0), stuck: +B.slow.toFixed(0), upY: +upY.toFixed(2), done: B.done, flipped: B.flips > 0 }
    })
    if (res.done || res.flipped || res.stuck > 12) break
  }
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/crawl_${x0}_${z0}.png` })
  console.log(`site [${x0}, ${z0}] → [${x1}, ${z1}]:`, JSON.stringify(res))
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
