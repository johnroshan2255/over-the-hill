// floor.mjs [tier] [extra] — THE FRAME'S FLOOR (2026-11-10): what an EMPTY frame costs. The world's parts hidden all at
// once (ablate.mjs hides them one by one; what's left when all are gone is the frame itself — the passes, the resolve,
// the present, the page), at 1920×1080 and at 960×540 (a floor that halves with the pixels is fill; one that stays is
// per-frame work). GPU-drained, as ablate.mjs.     node scripts/harness/floor.mjs ultra "aa=0"
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'
const tier = process.argv[2] || 'ultra', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for (const [W, H] of [[1920, 1080], [960, 540]]) {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', `--window-size=${W},${H}`, '--mute-audio'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } })
  const p = await b.newPage()
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate(() => window.__oth.drive(true))
  await new Promise((r) => setTimeout(r, 3000))
  const ft = () => p.evaluate(PACE)
  const set = (v) => p.evaluate((v) => { const P = window.__oth.parts(); for (const k in P) P[k].visible = v }, v)
  const full = await ft(); await set(false); const empty = await ft(); await set(true)
  const info = await p.evaluate(() => ({ api: window.__oth.backend, cw: document.querySelector('canvas').width, ch: document.querySelector('canvas').height }))
  console.log(`${tier}${extra} ${info.api} canvas ${info.cw}×${info.ch}: full ${full.toFixed(3)} ms, EMPTY ${empty.toFixed(3)} ms (the world ${(full - empty).toFixed(3)})`)
  await b.close()
}
