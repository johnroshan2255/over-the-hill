// pixdiff.mjs <portA> <portB> [views] [outDir] — THE SAME PICTURE? (2026-11-07: CPU-side optimizations must not change a
// pixel.) Each view rendered by two servers (e.g. the old code's copy on 5211 and the working tree on 5200) and by A a
// second time (the noise floor: wind, grass sway, birds); the share of pixels that differ by more than 8 / 32 of 255 in
// any channel, A vs B beside A vs A. B's difference should sit at the floor. ULTRA, 1920 × 1080, noon, clear.
//   node scripts/harness/pixdiff.mjs 5211 5200 spawn,forest,lake,cliff vg/pix
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [pa, pb] = [process.argv[2] || '5211', process.argv[3] || '5200']
const views = (process.argv[4] || 'spawn,forest,lake,cliff,rockhill').split(',')
const out = process.argv[5]
if (out) fs.mkdirSync(out, { recursive: true })
const V = { spawn: null, forest: [260, 640, 2.2, 0.6, -0.05], lake: [-160, -1320, 3, -1.2, -0.04], cliff: [1102, -1700, 2.2, 0, -0.02], rockhill: [-864.6, -449.9, 2.4, 2.454, -0.05], tunnel: null }
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const shoot = async (port, view) => {
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log(`  [${port}] page error: ${e.message.slice(0, 200)}`))
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`  [${port}] console error: ${m.text().slice(0, 200)}`) })
  await p.goto(`http://localhost:${port}/?tier=${process.env.TIER || 'ultra'}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0&radar=0${process.env.QS ? `&${process.env.QS}` : ""}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate((v) => { const o = window.__oth; o.setHour(12); if (!v) o.drive(true); else o.view(...v) }, V[view])
  await new Promise((r) => setTimeout(r, 3500))
  const png = await p.screenshot({ type: 'png' })
  await p.close()
  return png
}
const cmp = await b.newPage()
const diff = (x, y) => cmp.evaluate(async (x, y) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s })
  const [i1, i2] = [await load(x), await load(y)]
  const c = document.createElement('canvas'); c.width = i1.width; c.height = i1.height
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data
  g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data
  let n8 = 0, n32 = 0
  for (let i = 0; i < d1.length; i += 4) {
    const m = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]))
    if (m > 8) n8++
    if (m > 32) n32++
  }
  const n = d1.length / 4
  return { p8: (100 * n8) / n, p32: (100 * n32) / n }
}, x.toString('base64'), y.toString('base64'))
for (const v of views) {
  const a1 = await shoot(pa, v), bb = await shoot(pb, v), a2 = await shoot(pa, v)
  const ab = await diff(a1, bb), aa = await diff(a1, a2)
  console.log(`${v.padEnd(9)} A vs B: ${ab.p8.toFixed(2)} % > 8, ${ab.p32.toFixed(2)} % > 32     A vs A (floor): ${aa.p8.toFixed(2)} % > 8, ${aa.p32.toFixed(2)} % > 32`)
  if (out) { fs.writeFileSync(`${out}/${v}_A.png`, a1); fs.writeFileSync(`${out}/${v}_B.png`, bb) }
}
await b.close()
