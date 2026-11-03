// navphone.mjs [outDir] — THE GPS on a PHONE (touch layout, Pixel 5 landscape + portrait, 1×): the radar and its plate
// under the top row of buttons, the signpost beside / under it, the map with a route. The dev server on :5200.
import puppeteer, { KnownDevices } from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'navshots'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio'] })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [name, dev] of [['landscape', KnownDevices['Pixel 5 landscape']], ['portrait', KnownDevices['Pixel 5']]]) {
  await p.emulate({ ...dev, viewport: { ...dev.viewport, deviceScaleFactor: 1 } })
  await p.goto('http://localhost:5200/?tier=low&hour=11&time=0&sound=0&save=0&weather=clear', { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
  await sleep(2500)
  await p.evaluate(() => { const o = window.__oth, l = o.world.places.find((q) => q.name === 'Lookout Peak'); o.guide.set({ world: 'valley', x: l.x, z: l.z, name: l.name }, o.car.pos) })
  await sleep(1200)
  await p.screenshot({ path: `${out}/phone_${name}.png` })
  await p.evaluate(() => document.querySelector('.oth-mapbtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  await sleep(800)
  await p.screenshot({ path: `${out}/phone_${name}_map.png` })
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
