// fppshot.mjs <outDir> <car,car,…> [extra] — each car from the driver's eye (V: first person), ahead and looking down at the dash
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out, cars = 'offroader', extra = ''] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const W = 1280, H = 720
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const id of cars.split(',')) {
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
  await p.evaluate(() => window.__oth.drive(true)); await sleep(2500)
  await p.keyboard.press('KeyV'); await sleep(1200)
  await p.screenshot({ path: `${out}/${id}_fpp.png` })
  // the inside looked over from a fixed camera: the dash from the driver's seat, tipped down
  const look = (from, at) => p.evaluate(([from, at]) => { const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P); const a = V(from), t = V(at)
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z))) }, [from, at])
  const m = await p.evaluate(() => { const c = window.__oth.car, t = c.model; return { hip: c.def?.cabin?.hip, sp: t.steeringPivot, half: t.half, controls: t.controls.map((k) => [k.kind, k.pivot.map((v) => +v.toFixed(2))]), dials: !!t.dials } })
  console.log(id, JSON.stringify(m), errs.length ? 'ERR ' + [...new Set(errs)].join(' | ') : '')
  const sx = m.sp[0], sy = m.sp[1], sz = m.sp[2]
  await p.evaluate(() => { window.__oth.car.inside = true })
  await look([sx, sy + 0.42, sz + 0.75], [sx + 0.15, sy - 0.05, sz - 0.4]); await sleep(700); await p.screenshot({ path: `${out}/${id}_dash.png` })
  await look([sx + 0.75, sy + 0.5, sz + 0.9], [sx + 0.25, sy - 0.45, sz - 0.1]); await sleep(700); await p.screenshot({ path: `${out}/${id}_lever.png` })
  await p.close()
}
await b.close()
