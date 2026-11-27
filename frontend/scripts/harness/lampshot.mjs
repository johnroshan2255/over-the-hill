// lampshot.mjs [outDir] [tier] [ids…] — EVERY CAR'S LAMPS (2026-11-27, the user: "the light must come exactly from the
// car's headlight and brake light; a round lamp's light round"): each car loaded (?car=<id>), its lamps printed (where
// each lens is, its size, its shape, how many of the model's own faces it is), then looked at square on, close — the
// nose and the tail by day with the lamps off (the lenses themselves) and at night with them on and the brake held.
// CHECKED per car: a head and a tail lamp each side, each from the model's own lens faces; the lit faces ARE the
// lens's (every lit vertex one of the body's, to the bit); the beams' two starts and the tail's pool at the lenses.
// Needs `npm run dev`.
//   node scripts/harness/lampshot.mjs screenshots/lamps ultra            env: PORT=5200, Q (extra URL switches), SHOTS=0 (the numbers only)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/lamps', tier = 'ultra', ...only] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const kit = Object.keys(JSON.parse(fs.readFileSync(new URL('../../src/gameplay/vehicle/cars.json', import.meta.url), 'utf8')))
const ids = only.length ? only : ['offroader', ...kit, 'g500', 'e30']
const SHOTS = process.env.SHOTS !== '0'
// (the E30: one painted skin, no lens of its own — its lamps the catalogue's measure, drawn on its surface)
const MEASURED = ['e30']
let bad = 0
const all = {}
for (const id of ids) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 }) } catch { console.log(id, 'NEVER READY', errs.join(' | ')); bad++; await p.close(); continue }
  await sleep(1500)
  const look = (from, at) => p.evaluate(([from, at]) => {
    const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
    const a = V(from), t = V(at)
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
  }, [from, at])
  // (the lamps on and the brake held a moment first: the beams' starts and the pool are this frame's)
  await p.evaluate(() => { const c = window.__oth.car; c.lightMode = 'on'; c.brakeHeld = true })
  await sleep(300)
  const info = await p.evaluate((measured) => window.__oth.car.lampCheck(window.__oth.atmos, measured), MEASURED.includes(id))
  all[id] = info
  const fails = info.fails ?? []
  if (SHOTS) {
    const m = await p.evaluate(() => { const m = window.__oth.car.model; return { front: m.front, rear: m.rear, hy: m.lamps.head ? m.lamps.head[1].c[1] : 1, ty: m.lamps.tail ? m.lamps.tail[1].c[1] : 1 } })
    const views = { nose: [[0, m.hy + 0.05, m.front - 2.0], [0, m.hy, m.front]], tail: [[0, m.ty + 0.05, m.rear + 2.0], [0, m.ty, m.rear]], nose34: [[-1.9, m.hy + 0.5, m.front - 2.2], [0, m.hy - 0.1, m.front]], tail34: [[1.9, m.ty + 0.5, m.rear + 2.2], [0, m.ty - 0.1, m.rear]] }
    await p.evaluate(() => { const c = window.__oth.car; c.lightMode = 'off'; c.brakeHeld = false })
    for (const v of ['nose', 'tail']) { await look(...views[v]); await sleep(450); await p.screenshot({ path: `${out}/${id}_${v}_day.png` }) }
    // (the same frames, the lamps on by day and the brake held: what is lit against what is the lens)
    await p.evaluate(() => { const c = window.__oth.car; c.lightMode = 'on'; c.brakeHeld = true })
    for (const v of ['nose', 'tail']) { await look(...views[v]); await sleep(450); await p.screenshot({ path: `${out}/${id}_${v}_lit.png` }) }
    await p.evaluate(() => window.__oth.setHour ? window.__oth.setHour(23) : null)
    await sleep(600)
    for (const v of ['nose34', 'tail34']) { await look(...views[v]); await sleep(450); await p.screenshot({ path: `${out}/${id}_${v}_night.png` }) }
  }
  if (errs.length || info.id !== id || fails.length) bad++
  console.log(JSON.stringify(info), errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : fails.length ? 'FAILS: ' + fails.join('; ') : 'ok')
  await p.close()
}
fs.writeFileSync(`${out}/lamps.json`, JSON.stringify(all, null, 1))
console.log(bad ? `${bad} with problems` : 'all ok')
await b.close()
