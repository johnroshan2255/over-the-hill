// cliffshot.mjs <dir> [tier] — the valley's Great Cliff and the crossing's mist: still views (free camera) at given
// spots, each with its cost. Needs `npm run dev` (:5200). Views: [name, x, z, h (m above ground), yaw, pitch, hour].
// env: WORLD=valley|desert, VIEWS='[[…]]', Q='weather=sandstorm&…' (more of the URL)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [dir = 'vg/cliff', tier = 'high'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)) })
const V = JSON.parse(process.env.VIEWS || 'null') ?? [
  ['cliff_sw', 640, -1180, 120, -0.75, -0.08, 16.5],
  ['cliff_w', 700, -1720, 40, -1.5708, 0.12, 16.5],
  ['foot', 930, -1440, 2, -0.15, 0.25, 16.5],
  ['hairpin_n', 959, -1975, 30, 3.0, -0.35, 16.5],
  ['leg3', 1024, -1700, 2.2, 0, 0.0, 16.5],
  ['leg5_view', 1076, -1600, 2.2, 1.5708, -0.12, 16.5],
  ['top', 1102, -1900, 2.2, 0, 0.0, 16.5],
  ['gate', 1102, -1985, 2.2, 0, 0.0, 16.5],
]
await p.goto(`http://localhost:5200/?tier=${tier}&drive=0&dpr=fixed&time=0&hour=16.5&world=${process.env.WORLD || 'valley'}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [name, x, z, h, yaw, pitch, hour] of V) {
  await p.evaluate(([x, z, h, yaw, pitch, hour]) => { window.__oth.setHour(hour); window.__oth.view(x, z, h, yaw, pitch) }, [x, z, h, yaw, pitch, hour])
  await sleep(2500)
  const s = await p.evaluate(() => ({ ...window.__oth.stats(), mist: window.__oth.crossing.mist, state: window.__oth.crossing.state }))
  await p.screenshot({ path: `${dir}/${name}.png` })
  console.log(name.padEnd(12), `fps ${s.fps.toFixed(0)} gpu ${s.gpuMs.toFixed(2)} draws ${s.draws} tris ${(s.tris / 1e3).toFixed(0)}k  mist ${s.mist.toFixed(2)} ${s.state}  pos ${s.pos} ground ${s.ground}`)
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
