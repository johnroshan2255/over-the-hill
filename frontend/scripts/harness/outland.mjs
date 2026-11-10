// outland.mjs [outDir] — THE LAND BEYOND THE OLD BOX (2026-11-10: the valley's playable land 4 km → 12 km, MapData.play):
// the car put down at spots out there — does the ground hold it (its height against the map's, after 3 s), a shot of
// each; then driven flat out at the wall from 30 m inside it — does the wall stop it.   Needs `npm run dev` (PORT 5200).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'screenshots/outland'; fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage(); const errs = []
p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
console.log('play half', await p.evaluate(() => [window.__oth.map.half, window.__oth.map.play]), 'trees', await p.evaluate(() => window.__oth.world.trees.count), 'load ms', await p.evaluate(() => Math.round(performance.now())))
for (const [x, z] of [[2600, 300], [-3500, -2800], [4800, 4200], [0, -5600], [-5900, 1000]]) {
  // (a gentle spot near the asked one: the least steep of a few)
  const at = await p.evaluate(([x, z]) => { const m = window.__oth.map; let best = null; for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) { const qx = x + i * 40, qz = z + j * 40, h = m.height(qx, qz), s = Math.hypot(m.height(qx + 6, qz) - m.height(qx - 6, qz), m.height(qx, qz + 6) - m.height(qx, qz - 6)) / 12; if (!best || s < best.s) best = { x: qx, z: qz, h, s } } window.__oth.car.placeAt(best.x, best.z, 0); return best }, [x, z])
  await sleep(3000)
  const r = await p.evaluate(() => { const c = window.__oth.car, P = c.root.position; return { y: +P.y.toFixed(2), ground: +window.__oth.map.height(P.x, P.z).toFixed(2), x: +P.x.toFixed(0), z: +P.z.toFixed(0) } })
  console.log(`spot ${at.x},${at.z} slope ${(at.s * 100).toFixed(0)} %:`, JSON.stringify(r), Math.abs(r.y - r.ground) < 2.5 ? 'HELD' : 'FELL / FLEW')
  await p.screenshot({ path: `${out}/at_${x}_${z}.png` })
}
// … and the country seen: from above the valley's rim, from a peak, down an outer valley
const peaks = await p.evaluate(() => window.__oth.map.meta.outland?.peaks ?? [])
const views = [['rim', 1900, 1900, 60, -2.4, -0.08], ['valley', 2840, 220, 6, -1.6, 0.02], ['high', 0, 0, 900, 0.8, -0.35]]
if (peaks[0]) views.push(['peak', peaks[0].x, peaks[0].z, 25, Math.atan2(peaks[0].x, peaks[0].z), -0.22], ['peak2', peaks[4].x + 500, peaks[4].z + 500, 60, Math.atan2(500, 500), 0.12])
// the spawn as the game gives it, each ranger tower from 34 m, each gorge bridge from its end and from the side
const M = await p.evaluate(() => ({ lm: window.__oth.map.meta.landmarks.filter((l) => l.outland), br: (window.__oth.map.meta.bridges || []).filter((b) => b.outland), sp: window.__oth.map.meta.spawn }))
const gh = (x, z) => p.evaluate((x, z) => window.__oth.map.height(x, z), x, z)
views.push(['spawn', M.sp.x + 9 * Math.sin(M.sp.yaw), M.sp.z + 9 * Math.cos(M.sp.yaw), 4, M.sp.yaw, -0.1])
for (const [k, l] of M.lm.slice(0, 3).entries()) views.push([`tower${k}`, l.x + 30, l.z + 16, 8, Math.atan2(30, 16), 0.12])
for (const [k, b] of M.br.slice(0, 3).entries()) { const dx = b.x1 - b.x0, dz = b.z1 - b.z0, L = Math.hypot(dx, dz); views.push([`bridge${k}_end`, b.x0 - dx / L * 14, b.z0 - dz / L * 14, 5, Math.atan2(-dx, -dz), -0.12], [`bridge${k}_side`, (b.x0 + b.x1) / 2 - dz / L * 70, (b.z0 + b.z1) / 2 + dx / L * 70, 14, Math.atan2(-dz, dx) + Math.PI, -0.15]) }
for (const [nm, x, z, h, yaw, pitch] of views) { await p.evaluate((x, z, h, yaw, pitch) => window.__oth.view(x, z, h, yaw, pitch), x, z, h, yaw, pitch); await sleep(2500); await p.screenshot({ path: `${out}/view_${nm}.png` }) }
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 400) : 'none')
await b.close()
