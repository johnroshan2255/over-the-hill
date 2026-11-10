// carshot.mjs [outDir] [car] [tier] — A CAR in the game, looked over (2026-11-10: the off-roader, scripts/oth/offroader.py):
// round it at noon (three-quarter front / side / three-quarter back / the nose / from above), INSIDE from the driver's
// eye and across the cabin, the wipers mid-sweep (P), the driver's door open, three of the garage's paints, then F — out
// of the car and back in (the door swings with the character). Prints the page's errors. Needs `npm run dev`.
//   node scripts/harness/carshot.mjs screenshots/offroader offroader ultra        env: PORT=5200, QUICK=1 (the outside only), Q (extra URL switches: Q=mobile=1 — the phones' way)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/offroader', carId = 'offroader', tier = 'ultra'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const W = 1280, H = 720
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || /not set|uniform/i.test(m.text())) errs.push(m.text().slice(0, 300)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${carId}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
await sleep(2500)
const shot = async (name) => { await sleep(500); await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
// the camera at [right, up, back] m from the car (its own frame: −z forward), looking at the point [right, up, back]
const look = (from, at) => p.evaluate(([from, at]) => {
  const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
  const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
  const a = V(from), t = V(at)
  o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
}, [from, at])
const info = await p.evaluate(() => { const c = window.__oth.car, m = c.model; return { id: c.id, doors: m.doors.map((d) => ({ side: d.side, hinge: d.hinge.map((v) => +v.toFixed(2)), length: +d.length.toFixed(2) })), wheelPos: m.wheelPos.map((w) => w.map((v) => +v.toFixed(3))), r: +m.wheelRadius.toFixed(3), half: m.half, front: m.front, rear: m.rear, bottom: m.bottom, steer: m.steeringPivot.map((v) => +v.toFixed(2)), axis: m.steeringAxis.map((v) => +v.toFixed(2)), controls: m.controls.map((k) => k.kind), cabin: !!m.cabin, lamps: m.lamps, hulls: m.hulls.length } })
console.log(JSON.stringify(info))
await look([-3.6, 1.7, -4.6], [0, 1.0, 0]); await shot('a_front_34')
await look([-6.5, 1.3, 0], [0, 1.0, 0]); await shot('b_side')
await look([3.8, 1.9, 4.8], [0, 1.0, 0]); await shot('c_back_34')
await look([0, 1.3, -5.5], [0, 1.1, 0]); await shot('d_nose')
await look([-2.5, 5.5, 2.5], [0, 1.0, 0]); await shot('e_above')
await look([-2.2, 0.7, -2.6], [-0.6, 0.6, -1.3]); await shot('f_wheel')
await look([0, 1.5, 5.2], [0, 1.0, 0]); await shot('f2_back')                              // the back, square on: the spare, the tail
await look([1.6, 1.6, 3.6], [0.1, 1.1, 2.2]); await shot('f3_back_close')
if (process.env.QUICK) { console.log('errors:', errs.length ? [...new Set(errs)].join(' | ') : 'none'); await b.close(); process.exit(0) }   // QUICK=1: the outside only
// inside: the driver's eye, across the cabin from the passenger's side, from the back seat
await look([-0.37, 1.82, 0.42], [-0.37, 1.55, -3]); await shot('g_inside_driver')
await look([0.45, 1.7, 0.6], [-0.6, 1.3, -0.5]); await shot('h_inside_across')
await look([0, 1.8, 1.25], [0, 1.35, -1.5]); await shot('i_inside_back')
// the wipers: P, caught on their way up
await p.evaluate(() => { window.__oth.car.wipers = true })
await sleep(420)
await look([-0.9, 2.2, -3.4], [0, 1.6, -0.6]); await sleep(130); await p.screenshot({ path: `${out}/j_wipers.png` }); console.log('shot j_wipers')
await p.evaluate(() => { window.__oth.car.wipers = false })
// the driver's door held open
await p.evaluate(() => { window.__door = setInterval(() => { window.__oth.car.doorOpen = 1 }, 1) })
await look([-3.8, 1.6, -1.8], [-0.6, 1.1, 0.3]); await sleep(600); await shot('k_door_open')
await p.evaluate(() => { clearInterval(window.__door); window.__oth.car.doorOpen = 0 })
// the garage's paints
for (const [nm, hex] of [['red', '#e83a2a'], ['sand', '#c8b28a'], ['navy', '#1e3a78'], ['stock', '#ffffff'], ['gunmetal', '#5a616c']]) {
  await p.evaluate((h) => window.__oth.car.setPaint(h), hex)
  await look([-3.6, 1.7, -4.6], [0, 1.0, 0]); await shot(`l_paint_${nm}`)
}
await p.evaluate(() => window.__oth.car.setPaint(null))
// F: out (the door swings as he climbs out), then back in
await p.evaluate(() => window.__oth.foot())
await look([-4.2, 1.6, -1.2], [-0.8, 1.1, 0.2])
for (let i = 0; i < 4; i++) { await sleep(450); await p.screenshot({ path: `${out}/m_getout_${i}.png` }) }
await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 }).catch(() => console.log('(never on foot)'))
await sleep(1200)
await p.evaluate(() => window.__oth.foot())
await look([-4.2, 1.6, -1.2], [-0.8, 1.1, 0.2])
for (let i = 0; i < 5; i++) { await sleep(700); await p.screenshot({ path: `${out}/n_getin_${i}.png` }) }
await p.waitForFunction(() => !window.__oth.onFoot, { timeout: 30000, polling: 200 }).catch(() => console.log('(never back in)'))
await sleep(800)
await look([-3.4, 1.7, -1.4], [-0.4, 1.4, 0.2]); await shot('o_driver_seated')
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ') : 'none')
await b.close()
