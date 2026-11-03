// gpsdrive.mjs — a STEERING BOT that drives wherever THE GPS says (Nav.ts): it sets a waypoint, then follows the guide's
// current route (pure pursuit on it — so a re-route or the other world's leg after a crossing is followed too), slowing
// for bends, until the guide calls the arrival. Reports progress, re-routes, the swap, falls / flips / stalls.
//   node scripts/harness/gpsdrive.mjs [outDir]    env: START=world:x,z (default: the valley's spawn)
//        DEST=world:name (a place's name in that world's meta, or 'gate') or DEST=world:x,z    SECONDS=600  TIER=low
// (needs `npm run dev`, :5200; ?save=0 — the player's journey is never written)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const dir = process.argv[2] || 'vg/gps'
fs.mkdirSync(dir, { recursive: true })
const [startWorld, sxz] = (process.env.START || 'valley:').split(':')
const [destWorld, dest] = (process.env.DEST || "valley:Trapper's Cabin").split(':')
const SECONDS = Number(process.env.SECONDS || 600)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:5200/?tier=${process.env.TIER || 'low'}&dpr=fixed&time=0&hour=12&weather=clear&world=${startWorld}&sound=0&save=0&radar=1`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(1500)

const setup = await p.evaluate(async (sxz, destWorld, dest) => {
  const o = window.__oth, car = o.car, g = o.guide
  o.drive(true)
  if (sxz) {
    const [x, z] = sxz.split(',').map(Number)
    car.sim.place(x, o.height(x, z) + 0.7, z, car.sim.heading)
  }
  // the waypoint: a place by name (that world's meta), its gate, or x,z
  const meta = await (await fetch(`/oth/${destWorld}/meta.json`)).json()
  let w
  if (/^-?\d/.test(dest)) { const [x, z] = dest.split(',').map(Number); w = { world: destWorld, x, z, name: 'Waypoint' } }
  else if (dest === 'gate') w = { world: destWorld, x: meta.gate.x, z: meta.gate.z, name: 'the gate' }
  else { const l = meta.landmarks.find((q) => q.name === dest); w = { world: destWorld, x: l.x, z: l.z, name: l.name } }
  const p0 = car.sim.body.translation()
  g.set(w, { x: p0.x, z: p0.z })
  // (wait for the other world's leg, if any)
  await new Promise((r) => setTimeout(r, 500))
  // face along the route
  const r = g.route
  const k = Math.min(r.pts.length / 2 - 1, 3)
  car.sim.place(p0.x, o.height(p0.x, p0.z) + 0.7, p0.z, Math.atan2(-(r.pts[2 * k] - p0.x), -(r.pts[2 * k + 1] - p0.z)))
  car.shift(0, 0, 0)
  const bot = (window.__bot = { arrived: null, reroutes: 0, target: 0, lateral: 0, maxLateral: 0, swaps: 0 })
  const onArrive = g.onArrive, onReroute = g.onReroute
  g.onArrive = (wp) => { bot.arrived = wp.name; onArrive?.(wp) }
  g.onReroute = () => { bot.reroutes++; onReroute?.() }
  // a point s m along a route (from its segment `seg` on)
  const at = (r, s) => {
    const n = r.pts.length / 2
    let i = Math.max(0, r.seg)
    while (i < n - 2 && r.cum[i + 1] < s) i++
    const L = r.cum[i + 1] - r.cum[i], f = L > 0 ? Math.min(1, Math.max(0, (s - r.cum[i]) / L)) : 0
    return [r.pts[2 * i] + (r.pts[2 * i + 2] - r.pts[2 * i]) * f, r.pts[2 * i + 1] + (r.pts[2 * i + 3] - r.pts[2 * i + 1]) * f]
  }
  const sim = car.sim, step = sim.step.bind(sim)
  sim.step = (dt) => {
    const r = g.route
    if (bot.arrived || !r) { sim.controls.throttle = 0; sim.controls.brake = true; sim.controls.steer = 0; step(dt); return }
    const t = sim.body.translation(), v = Math.abs(sim.speed)
    bot.lateral = r.lateral
    bot.maxLateral = Math.max(bot.maxLateral, r.lateral)
    // pure pursuit: a point 6 m + 0.45 s ahead along the route
    const [tx, tz] = at(r, r.along + 6 + 0.45 * v)
    let err = Math.atan2(-(tx - t.x), -(tz - t.z)) - sim.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    // the bend ahead (the route's heading change over the next 36 m); off-road slower
    const a = at(r, r.along), m = at(r, r.along + 18), e = at(r, r.along + 36)
    const h1 = Math.atan2(m[0] - a[0], m[1] - a[1]), h2 = Math.atan2(e[0] - m[0], e[1] - m[1])
    const bend = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)))
    // (and the route's own pace over the next 40 m: a rock crawl at its crawl, off-road at its toll)
    let pace = 99
    for (let s = r.seg; s < r.pts.length / 2 - 1 && r.cum[s] < r.along + 40; s++) {
      const dt = r.tcum[s + 1] - r.tcum[s]
      if (dt > 0) pace = Math.min(pace, (r.cum[s + 1] - r.cum[s]) / dt)
    }
    const target = Math.min((bend > 0.5 ? 14 : bend > 0.2 ? 24 : 38) / 3.6, Math.max(7 / 3.6, pace))
    bot.target = target
    sim.controls.steer = Math.max(-1, Math.min(1, -err * 2.2))
    const over = v - target
    sim.controls.throttle = over < 0 ? Math.min(1, -over * 0.5 + 0.2) : over > 0.8 ? -Math.min(1, over * 0.6) : 0
    sim.controls.brake = over > 0.8
    sim.controls.handbrake = false
    step(dt)
  }
  return { waypoint: w, km: +(g.remaining / 1000).toFixed(2), min: +(g.remainingTime / 60).toFixed(1), viaGate: g.viaGate }
}, sxz, destWorld, dest)
console.log('set:', JSON.stringify(setup))

const state = () => p.evaluate(() => {
  const o = window.__oth, c = o.car.pos, B = window.__bot, g = o.guide, q = o.car.root.quaternion
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
  return { world: o.world.id, x: +c.x.toFixed(0), z: +c.z.toFixed(0), kmh: +o.car.speedKmh.toFixed(0), left: +g.remaining.toFixed(0), off: +B.lateral.toFixed(1), maxOff: +B.maxLateral.toFixed(1), reroutes: B.reroutes, upY: +upY.toFixed(2), plate: document.querySelector('.oth-radar-plate')?.textContent ?? '', arrived: B.arrived }
})
const t0 = Date.now()
let last = null, stall = 0, n = 0
while ((Date.now() - t0) / 1000 < SECONDS) {
  await sleep(3000)
  const s = await state()
  console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`, JSON.stringify(s))
  if (s.upY < 0.3) { console.log('FLIPPED'); await p.screenshot({ path: `${dir}/flip.png` }); break }
  if (last && Math.hypot(s.x - last.x, s.z - last.z) < 1 && !s.arrived) { if (++stall > 4) { console.log('STALLED'); await p.screenshot({ path: `${dir}/stall.png` }); break } } else stall = 0
  if (last && s.world !== last.world) { console.log('— SWAPPED —'); await p.screenshot({ path: `${dir}/swap.png` }) }
  if (++n % 10 === 0) await p.screenshot({ path: `${dir}/t${Math.round((Date.now() - t0) / 1000)}.png` })
  last = s
  if (s.arrived) { console.log('ARRIVED:', s.arrived); break }
}
await p.screenshot({ path: `${dir}/end.png` })
console.log('errors:', errs.length ? errs : 'none')
await b.close()
