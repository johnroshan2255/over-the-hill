// bikeride.mjs <dir> [tier] — the MOUNTAIN BIKE ridden by a script (B off the car, then a sequence of keys), the
// state logged as it goes (speed, gear, cadence, fork / swingarm, air, crash) and shots taken from the chase camera.
// env: WORLD=valley|desert, API=webgpu|webgl2, AT='[x, z, heading]' (where the car is put first; default its start),
// STEPS='[[seconds, "keys held, space-separated", "shot name or empty"]]', Q='…' (more of the URL).
// Needs `npm run dev` (:5200).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [dir = 'vg/bikeride', tier = 'high'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=14&world=${process.env.WORLD || 'valley'}&sound=0&save=0&api=${process.env.API || 'webgpu'}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const at = JSON.parse(process.env.AT || 'null')
if (at) await p.evaluate(([x, z, h]) => window.__oth.car.placeAt(x, z, h), at)
await sleep(800)
await p.evaluate(() => window.__oth.ride())
await sleep(600)
const state = () => p.evaluate(() => {
  const s = window.__oth.bike.sim
  if (!s) return null
  const t = s.body.translation()
  return { x: +t.x.toFixed(1), z: +t.z.toFixed(1), kmh: +(s.speed * 3.6).toFixed(1), gear: s.gear, rpm: Math.round(s.cadence), ped: s.pedalling, fork: +s.forkTravel.toFixed(3), swing: +s.swingarm.toFixed(3), shock: +s.shockLength.toFixed(3), air: s.airborne, crash: s.crashed, crouch: +s.riderCrouch.toFixed(2), stand: +s.riderStand.toFixed(2) }
})
console.log('on the bike:', await p.evaluate(() => window.__oth.riding), JSON.stringify(await state()))
const STEPS = JSON.parse(process.env.STEPS || 'null') ?? [
  [1, '', 'start'], [4, 'KeyW', 'pedal'], [2, 'KeyW KeyD', 'turn'], [1.5, 'KeyW', ''], [0.5, 'KeyW Space', ''], [0.6, 'KeyW', 'hop'],
  [2, '', 'coast'], [1.5, 'KeyW ArrowDown', 'wheelie'], [2, 'KeyS', 'brake'], [1, '', 'stopped'],
]
const held = new Set()
for (const [sec, keys, shot] of STEPS) {
  const want = new Set(keys.split(' ').filter(Boolean))
  for (const k of held) if (!want.has(k)) { await p.keyboard.up(k); held.delete(k) }
  for (const k of want) if (!held.has(k)) { await p.keyboard.down(k); held.add(k) }
  const t0 = Date.now()
  let peakAir = false
  while (Date.now() - t0 < sec * 1000) {
    await sleep(250)
    const s = await state()
    if (s?.air) peakAir = true
  }
  const s = await state()
  if (shot) await p.screenshot({ path: `${dir}/${shot}.png` })
  console.log(`${String(sec).padStart(4)} s [${keys || '—'}]`.padEnd(34), JSON.stringify(s), peakAir ? '(was in the air)' : '')
}
for (const k of held) await p.keyboard.up(k)
console.log('errors:', errs.length ? errs : 'none')
await b.close()
