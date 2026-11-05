// bikeshot.mjs <dir> [tier] — the mountain bike (Bike.ts) in still views: env WORLD=valley|desert, API=webgl2|webgpu,
// AT='[x, z, heading]' (the bike's place; default by the spawn), VIEWS='[[name, dx, dz, h, yaw, pitch]]' (the camera
// relative to the bike: dx / dz metres off it, h above its ground; yaw 0 looks north), Q='…' (more of the URL).
// Needs `npm run dev` (:5200). Prints errors and the frame's cost.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [dir = 'vg/bike', tier = 'high'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 400)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&drive=0&dpr=fixed&time=0&hour=14&world=${process.env.WORLD || 'valley'}&sound=0&save=0&api=${process.env.API || 'webgl2'}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const at = JSON.parse(process.env.AT || 'null')
const pos = await p.evaluate((at) => {
  const o = window.__oth, sp = o.world.map.meta.spawn
  const [x, z, h] = at ?? [sp.x + 6, sp.z - 4, 0.6]
  o.bike.showAt(x, z, h)
  return { x, z, h }
}, at)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const V = JSON.parse(process.env.VIEWS || 'null') ?? [['side', 3.2, 0, 0.9, Math.PI / 2, -0.05], ['front34', -2.2, -2.6, 1.3, -0.7, -0.15], ['rear34', 2.4, 2.6, 1.5, 2.4, -0.2]]
for (const [name, dx, dz, h, yaw, pitch] of V) {
  // (the offsets in the bike's own frame: dx right, dz back)
  const c = Math.cos(pos.h), s = Math.sin(pos.h)
  const x = pos.x + dx * c + dz * s, z = pos.z - dx * s + dz * c
  await p.evaluate(([x, z, h, yaw, pitch]) => window.__oth.view(x, z, h, yaw, pitch), [x, z, h, yaw + pos.h, pitch])
  await sleep(1500)
  await p.screenshot({ path: `${dir}/${name}.png` })
  console.log('shot', name)
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
