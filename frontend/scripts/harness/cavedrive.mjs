// cavedrive.mjs [outDir] — a STEERING BOT drives THE CAVE WORLD round (CaveWorld.ts: its physics one triangle mesh): from
// 25 m before the mouth up the way in, across the great hall, down the gallery to the far chamber, back by the loop and
// out of the mouth again (env CAR: offroader | g500 | e30). Reports where it
// is, its height over the terrain (the cave's floors stand above it: never under), its speed, any flip or stall, and
// shots from the chase camera on the way.   node scripts/harness/cavedrive.mjs screenshots/cave-drive   (PORT 5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'screenshots/cave-drive'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&dpr=fixed&time=0&hour=14&weather=clear&world=valley&sound=0&save=0&car=${process.env.CAR || 'offroader'}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 250 })
await p.addStyleTag({ content: 'body > :not(canvas) { display: none !important; }' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = await p.evaluate(() => {
  const o = window.__oth, l = o.world.places.find((q) => q.kind === 'cave')
  if (!l) return false
  const sn = Math.sin(l.rot), cs = Math.cos(l.rot), W = ([lx, lz]) => [l.x + lx * cs + lz * sn, l.z - lx * sn + lz * cs]
  // the way (local x, z): before the mouth, the way in, the hall, the gallery, the far chamber
  // (IN by the way in, the hall, the gallery to the far chamber; BACK by the loop, across the hall and out the mouth —
  //  the lane's points: caves.py LANE_FLOOR, local z = −(Blender y − the mouth's))
  const local = [[0, 25], [0, -7.8], [0, -13.8], [1, -27.8], [7, -41.8], [3, -55.8], [-5, -67.8], [-3, -75.8], [2, -81.8], [10, -82.8],
    [30, -79.8], [46, -87.8], [54, -103.8], [54, -117.8], [44, -129.8], [24, -139.8], [-4, -133.8], [-22, -115.8], [-22, -99.8],
    [-19, -91.8], [-14, -81.8], [-8, -73.8], [-5, -67.8], [3, -55.8], [7, -41.8], [1, -27.8], [0, -13.8], [0, -7.8], [0, 30]]
  const pts = []
  for (let i = 0; i < local.length - 1; i++) {
    const a = W(local[i]), c = W(local[i + 1]), n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2))
    for (let k = 0; k < n; k++) pts.push([a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n])
  }
  pts.push(W(local[local.length - 1]))
  const car = o.car, sim = car.sim
  o.drive(true)
  const [x0, z0] = pts[0], [x1, z1] = pts[3]
  car.placeAt(x0, z0, Math.atan2(-(x1 - x0), -(z1 - z0)))
  const bot = (window.__bot = { path: pts, i: 0, done: false, minAgl: 99, flips: 0 })
  const step = sim.step.bind(sim)
  sim.step = (dt) => {
    const t = sim.body.translation(), v = Math.abs(sim.speed), path = bot.path
    let bi = bot.i, bd = 1e18
    for (let i = Math.max(0, bot.i - 6); i < Math.min(path.length, bot.i + 30); i++) { const d = (path[i][0] - t.x) ** 2 + (path[i][1] - t.z) ** 2; if (d < bd) { bd = d; bi = i } }
    bot.i = bi
    if (bi >= path.length - 2) { bot.done = true; sim.controls.throttle = 0; sim.controls.brake = true; sim.controls.steer = 0; step(dt); return }
    const [tx, tz] = path[Math.min(path.length - 1, bi + Math.round((5 + 0.4 * v) / 2))]
    let err = Math.atan2(-(tx - t.x), -(tz - t.z)) - sim.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    sim.controls.steer = Math.max(-1, Math.min(1, -err * 2.2))
    const over = v - 16 / 3.6
    sim.controls.throttle = over < 0 ? Math.min(1, -over * 0.5 + 0.25) : over > 0.8 ? -Math.min(1, over * 0.6) : 0
    sim.controls.brake = over > 0.8; sim.controls.handbrake = false
    step(dt)
  }
  return true
})
if (!ok) { console.log('no cave in this valley'); await b.close(); process.exit(1) }
const state = () => p.evaluate(() => {
  const o = window.__oth, c = o.car.pos, B = window.__bot, q = o.car.root.quaternion, upY = 1 - 2 * (q.x * q.x + q.z * q.z)
  const agl = c.y - o.world.map.height(c.x, c.z); B.minAgl = Math.min(B.minAgl, agl); if (upY < 0.3) B.flips++
  return { at: `${B.i}/${B.path.length}`, x: +c.x.toFixed(1), z: +c.z.toFixed(1), agl: +agl.toFixed(2), kmh: +o.car.speedKmh.toFixed(0), upY: +upY.toFixed(2), done: B.done }
})
let last = '', still = 0, shot = 0
for (let s = 0; s < 240; s++) {
  await sleep(1000)
  const st = await state()
  if (s % 2 === 0) console.log(JSON.stringify(st))
  if (s % 6 === 3) await p.screenshot({ path: `${out}/drive_${String(shot++).padStart(2, '0')}.png` })
  if (st.at === last && !st.done) { if (++still > 8) { console.log('STALLED', JSON.stringify(st)); break } } else still = 0
  last = st.at
  if (st.done) { await p.screenshot({ path: `${out}/drive_end.png` }); break }
}
console.log(JSON.stringify(await p.evaluate(() => ({ minAgl: +window.__bot.minAgl.toFixed(2), flips: window.__bot.flips, done: window.__bot.done }))))
console.log('errors:', errs.length ? errs : 'none')
await b.close()
