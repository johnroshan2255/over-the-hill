// outshot.mjs <outDir> <car,car,…> — each car from the front three-quarter in the game (its factory colour): one PNG a car.
// (2026-11-16, docs/NEXT_garage.md.) Needs `npm run dev`.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out, cars] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const id of cars.split(',')) {
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:5200/?tier=ultra&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
  await sleep(2500)
  await p.evaluate(() => { const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P); const a = V([-3.4, 1.8, -4.4]), t = V([0, 0.95, 0])
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z))) })
  await sleep(900); await p.screenshot({ path: `${out}/${id}_out.png` })
  if (errs.length) console.log(id, 'ERR', [...new Set(errs)].join(' | '))
  await p.close()
}
await b.close()
