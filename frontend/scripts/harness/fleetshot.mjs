// fleetshot.mjs [outDir] [tier] [ids…] — EVERY garage car in the game, one after the other (2026-11-10, the kit's 18 —
// docs/VEHICLES.md): each loaded (?car=<id>), shot from the front three-quarter and the back, its parts counted (doors,
// moving controls, cabin, lamps found), the page's errors printed. Needs `npm run dev`.
//   node scripts/harness/fleetshot.mjs screenshots/fleet ultra            env: PORT=5200, Q (extra URL switches: Q=mobile=1 — the phones' way)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/fleet', tier = 'ultra', ...only] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ids = only.length ? only : JSON.parse(fs.readFileSync(new URL('../../src/gameplay/vehicle/cars.json', import.meta.url), 'utf8'))
let bad = 0
for (const id of Array.isArray(ids) ? ids : Object.keys(ids)) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 }) } catch { console.log(id, 'NEVER READY', errs.join(' | ')); bad++; await p.close(); continue }
  await sleep(1800)
  const look = (from, at) => p.evaluate(([from, at]) => {
    const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
    const a = V(from), t = V(at)
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
  }, [from, at])
  const info = await p.evaluate(() => { const c = window.__oth.car, m = c.model; return { id: c.id, doors: m.doors.length, controls: [...new Set(m.controls.map((k) => k.kind))].join(','), cabin: !!m.cabin, steer: !!m.steeringWheel, head: !!m.lamps.head, tail: !!m.lamps.tail, len: +(m.rear - m.front).toFixed(2) } })
  await look([-3.6, 1.7, -4.8], [0, 1.0, 0]); await sleep(500); await p.screenshot({ path: `${out}/${id}_front.png` })
  await look([3.8, 1.9, 5.0], [0, 1.0, 0]); await sleep(500); await p.screenshot({ path: `${out}/${id}_back.png` })
  if (errs.length || info.id !== id) bad++
  console.log(JSON.stringify(info), errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'ok')
  await p.close()
}
console.log(bad ? `${bad} with problems` : 'all ok')
await b.close()
