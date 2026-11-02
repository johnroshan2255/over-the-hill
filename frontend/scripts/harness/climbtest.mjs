// climbtest.mjs — a STEERING BOT drives the crossing's road: the valley's approach and ledge road (7 legs, 6 hairpins)
// and the pass, the swap at the gate, the desert's pass and escarpment — or the other way. It holds the road's centre
// line (pure pursuit), slows for the hairpins, and reports where it is, how far off the line, any fall, flip or stall.
//   node scripts/harness/climbtest.mjs [tier] [dir]      env: START=world:x,z  DIR=out|in (toward the gate | away)
//                                                         SECONDS=600  (needs `npm run dev`, :5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [tier = 'low', dir = 'vg/climb'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const [startWorld, xz] = (process.env.START || 'valley:946,-1500').split(':')
const [sx, sz] = xz.split(',').map(Number)
const DIR = process.env.DIR || 'out'
const SECONDS = Number(process.env.SECONDS || 600)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=960,540'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:5200/?tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&world=${startWorld}&sound=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.evaluate((sx, sz, DIR) => {
  const o = window.__oth, car = o.car
  // the road out of each world from its gate: the valley's ledge road then its approach (reversed: they're stored
  // foot → top), the desert's pass then its escarpment legs
  const route = () => {
    const L = o.world.map.meta.trails.lines
    const pts = o.world.id === 'valley' ? [...L[L.length - 1].slice().reverse(), ...L[L.length - 2].slice().reverse()] : [...L[0], ...L[1]]
    const out = []
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 2))
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
    }
    out.push(pts[pts.length - 1])
    return out
  }
  const bot = (window.__bot = { path: [], i: 0, dir: DIR, world: '', lateral: 0, maxLateral: 0, done: false, target: 0, flips: 0 })
  const setPath = (dir) => {
    bot.world = o.world.id
    bot.dir = dir
    bot.path = dir === 'in' ? route() : route().reverse()
    const P = car.sim.body.translation() // (the body: the drawn pose follows a frame later)
    let best = 1e18
    for (let i = 0; i < bot.path.length; i++) { const d = (bot.path[i][0] - P.x) ** 2 + (bot.path[i][1] - P.z) ** 2; if (d < best) { best = d; bot.i = i } }
  }
  // put the car on the road at (sx, sz), facing along it
  const P0 = { x: sx, z: sz }
  bot.world = o.world.id
  bot.path = DIR === 'in' ? route() : route().reverse()
  let i0 = 0, best = 1e18
  bot.path.forEach(([x, z], i) => { const d = (x - P0.x) ** 2 + (z - P0.z) ** 2; if (d < best) { best = d; i0 = i } })
  const [x0, z0] = bot.path[i0], [x1, z1] = bot.path[Math.min(i0 + 3, bot.path.length - 1)]
  o.drive(true)
  car.sim.place(x0, o.height(x0, z0) + 0.7, z0, Math.atan2(-(x1 - x0), -(z1 - z0)))
  car.shift(0, 0, 0)
  bot.i = i0
  const sim = car.sim, step = sim.step.bind(sim)
  sim.step = (dt) => {
    if (o.world.id !== bot.world) setPath(bot.dir === 'out' ? 'in' : 'out') // (crossed: the other world's road on from its gate)
    const t = sim.body.translation(), path = bot.path, v = Math.abs(sim.speed)
    // the nearest point (searched ahead of the last), how far off the line
    let bi = bot.i, bd = 1e18
    for (let i = Math.max(0, bot.i - 8); i < Math.min(path.length, bot.i + 40); i++) { const d = (path[i][0] - t.x) ** 2 + (path[i][1] - t.z) ** 2; if (d < bd) { bd = d; bi = i } }
    bot.i = bi
    bot.lateral = Math.sqrt(bd)
    bot.maxLateral = Math.max(bot.maxLateral, bot.lateral)
    if (bi >= path.length - 3) { bot.done = true; sim.controls.throttle = 0; sim.controls.brake = true; sim.controls.steer = 0; step(dt); return }
    // pure pursuit: a point 6 m + 0.45 s ahead
    const look = Math.min(path.length - 1, bi + Math.round((6 + 0.45 * v) / 2))
    const [tx, tz] = path[look]
    const want = Math.atan2(-(tx - t.x), -(tz - t.z))
    let err = want - sim.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    // the bend ahead (the heading change over the next 36 m): slow for the hairpins
    const a = path[bi], m = path[Math.min(path.length - 1, bi + 9)], e = path[Math.min(path.length - 1, bi + 18)]
    const h1 = Math.atan2(m[0] - a[0], m[1] - a[1]), h2 = Math.atan2(e[0] - m[0], e[1] - m[1])
    const bend = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)))
    const target = (bend > 0.5 ? 14 : bend > 0.2 ? 24 : 38) / 3.6
    bot.target = target
    sim.controls.steer = Math.max(-1, Math.min(1, -err * 2.2))
    // (braking as the S key does: the pedal negative and the brake on)
    const over = v - target
    sim.controls.throttle = over < 0 ? Math.min(1, -over * 0.5 + 0.2) : over > 0.8 ? -Math.min(1, over * 0.6) : 0
    sim.controls.brake = over > 0.8
    sim.controls.handbrake = false
    step(dt)
  }
}, sx, sz, DIR)

const state = () => p.evaluate(() => {
  const o = window.__oth, c = o.car.pos, B = window.__bot, q = o.car.root.quaternion
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
  return { world: o.world.id, at: `${B.i}/${B.path.length}`, x: +c.x.toFixed(0), y: +c.y.toFixed(1), z: +c.z.toFixed(0), agl: +(c.y - o.height(c.x, c.z)).toFixed(2), kmh: +o.car.speedKmh.toFixed(0), off: +B.lateral.toFixed(1), maxOff: +B.maxLateral.toFixed(1), upY: +upY.toFixed(2), mist: +o.crossing.mist.toFixed(2), cross: o.crossing.state, done: B.done }
})
const t0 = Date.now()
let last = null, stall = 0, shot = 0
while ((Date.now() - t0) / 1000 < SECONDS) {
  await sleep(2000)
  const s = await state()
  console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`, JSON.stringify(s))
  if (s.upY < 0.3) { console.log('FLIPPED'); await p.screenshot({ path: `${dir}/flip.png` }); break }
  if (s.off > 8) { console.log('OFF THE ROAD'); await p.screenshot({ path: `${dir}/off.png` }); break }
  if (last && Math.hypot(s.x - last.x, s.z - last.z) < 1 && !s.done) { if (++stall > 4) { console.log('STALLED'); await p.screenshot({ path: `${dir}/stall.png` }); break } } else stall = 0
  if (last && s.world !== last.world) { console.log('— SWAPPED —'); await p.screenshot({ path: `${dir}/swap.png` }) }
  if (++shot % 15 === 0) await p.screenshot({ path: `${dir}/t${Math.round((Date.now() - t0) / 1000)}.png` })
  last = s
  if (s.done) { console.log('END OF THE ROAD'); break }
}
await p.screenshot({ path: `${dir}/end.png` })
console.log('errors:', errs.length ? errs : 'none')
await b.close()
