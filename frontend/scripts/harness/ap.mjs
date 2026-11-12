// ap.mjs [tier] "<from>><to>[,seconds]" … — THE AUTOPILOT driven (src/oth/Autopilot.ts): the car set down at <from>, the
// waypoint at <to>, O pressed; watched in real time until it arrives (within 25 m), gives the wheel back, or the time
// runs out (default 240 s). A place is "x:z" or a site's name (a regexp over the landmarks' names / styles / kinds).
//   node scripts/harness/ap.mjs ultra "Kneeling>Temple of the Hearth" "3300:-1100>Mirror Pool,300"
// Prints, per route: the distance at the start, how it ended, the time, the top speed, the resets / re-plans seen in the
// toasts, the longest stall (s under 0.5 m/s while on), and the states it passed through.
// env  Q (extra URL params), SHOT=<dir> (a screenshot at the end of each).   Needs `npm run dev` (PORT 5200).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [tier = 'ultra', ...routes] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage(); const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const where = (s) => p.evaluate((s) => {
  const o = window.__oth
  // (desert@x:z — a point in the OTHER world: the route goes by the pass, the autopilot through the crossing)
  if (/^[a-z]+@/.test(s)) { const [w, q] = s.split('@'), [x, z] = q.split(':').map(Number); return { x, z, name: s, world: w } }
  if (/^-?[\d.]+:-?[\d.]+$/.test(s)) { const [x, z] = s.split(':').map(Number); return { x, z, name: s } }
  const R = new RegExp(s), l = o.world.places.find((q) => R.test(q.name) || R.test(q.style ?? '') || R.test(q.kind)) ?? (o.world.map.meta.outland?.places ?? []).find((q) => R.test(q.name ?? '') || R.test(q.kind))
  return l ? { x: l.x, z: l.z, name: l.name, r: l.r } : null
}, s)
if (process.env.SHOT) fs.mkdirSync(process.env.SHOT, { recursive: true })
for (const [ri, spec] of routes.entries()) {
  const [path, secs = 240] = spec.split(','), [fs0, ts0] = path.split('>'), from = await where(fs0), to = await where(ts0)
  if (!from || !to) { console.log('no such place:', !from ? fs0 : ts0); continue }
  // (set down a little off the site itself: beside it, on open ground)
  const off = from.r === undefined ? 0 : from.r + 14   // (a point: there; a site: beside it)
  await p.evaluate((x, z, to) => { const o = window.__oth; o.drive(true); o.car.sim.place(x, o.world.map.height(x, z) + 0.9, z, 0); o.guide.set({ world: to.world ?? o.world.id, x: to.x, z: to.z, name: to.name }, { x, z }) }, from.x + off, from.z, to)
  await sleep(2500)
  const d0 = Math.hypot(to.x - from.x - off, to.z - from.z)
  await p.keyboard.press('KeyO'); await sleep(300)
  const t0 = Date.now(); let top = 0, stall = 0, worst = 0, end = 'time out', last = null, crossed = false; const states = new Set(), toasts = new Set()
  while ((Date.now() - t0) / 1000 < +secs) {
    await sleep(500)
    const s = await p.evaluate(() => { const o = window.__oth, P = o.car.root.position; return { x: P.x, z: P.z, w: o.world.id, v: Math.abs(o.car.sim.speed), on: o.autopilot.on, st: o.autopilot.state, toast: [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ') } })
    last = s; top = Math.max(top, s.v); states.add(s.st)
    for (const t of s.toast.split(' / ')) if (/Autopilot|reset|round|Winch|stuck/i.test(t)) toasts.add(t.trim())
    if (s.v < 0.5 && s.on) { stall += 0.5; worst = Math.max(worst, stall); if (stall === 6) { console.log(`   stalled at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) · ${s.st} ·`, JSON.stringify(await p.evaluate(() => { const o = window.__oth, P = o.car.root.position, m = o.world.map, a = o.autopilot; return { y: +P.y.toFixed(1), ground: +m.height(P.x, P.z).toFixed(1), slope: +(Math.hypot(m.height(P.x + 3, P.z) - m.height(P.x - 3, P.z), m.height(P.x, P.z + 3) - m.height(P.x, P.z - 3)) / 6).toFixed(2), lake: m.lakeAt(P.x, P.z), mud: +m.mudAt(P.x, P.z).toFixed(2), tries: a.tries, resets: a.resets, clear: a.clear ? [...a.clear].map((c) => +c.toFixed(0)) : null, along: a.guide?.route ? Math.round(a.guide.route.along) + '/' + Math.round(a.guide.route.length) : null, crag: o.world.rocks.onCrag(P.x, P.z, 3) } }))); if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}/stall_${ri}.png` }) } } else stall = 0
    if (to.world && s.w !== to.world) { if (!s.on) { end = `autopilot OFF before the crossing (in ${s.w})`; break } continue }   // (still this side of the pass)
    if (to.world && !crossed) { crossed = true; console.log(`   crossed into ${s.w} after ${((Date.now() - t0) / 1000).toFixed(0)} s · autopilot ${s.on ? 'still ON' : 'OFF'}`) }
    const d = Math.hypot(to.x - s.x, to.z - s.z)
    if (d < (to.r ?? 0) + 25) { end = `ARRIVED (${d.toFixed(0)} m from it)`; break }
    if (!s.on) { end = `autopilot OFF ${d.toFixed(0)} m short`; break }
  }
  if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}/ap_${ri}.png` })
  console.log(`${from.name} > ${to.name}: ${d0.toFixed(0)} m as the crow flies · ${end} · ${((Date.now() - t0) / 1000).toFixed(0)} s · top ${(top * 3.6).toFixed(0)} km/h · longest stall ${worst.toFixed(1)} s · states ${[...states].join(' ')}${last && end === 'time out' ? ` · ${Math.hypot(to.x - last.x, to.z - last.z).toFixed(0)} m left` : ''}`)
  if (toasts.size) console.log('   ', [...toasts].join(' | ').slice(0, 400))
  await p.keyboard.press('KeyO'); await sleep(300)
}
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 600) : 'none')
await b.close()
