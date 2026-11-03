// desertshot.mjs <out> [tier] — the desert in the game: the scored views (docs/DESERT_MATCH.md §5; ?world=desert)
// env: PORT (5200), HOUR (11), VIEWS='[[name, x, z, h, yaw, pitch], …]' (replaces the list below)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2], tier = process.argv[3] || 'ultra'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
const hour = Number(process.env.HOUR || 11)
await p.goto(`http://localhost:${process.env.PORT || 5200}/?world=desert&tier=${tier}&hour=${hour}&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 180000, polling: 200 }).catch((e) => errs.push('not ready: ' + e.message))
// (no HUD in a scored render: only the canvas and the vignette — a CSS gradient over it, part of the picture)
await p.addStyleTag({ content: 'body > :not(canvas):not([style*="radial-gradient"]) { display: none !important; }' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// (2026-11-03: the scored set — the doc's escarpment view sat in the crossing's mist, its arch view missed the arch and
//  its dunes view stood against a slip face: replaced; track, mesa_face and grove added for their pairs)
const shots = JSON.parse(process.env.VIEWS || 'null')?.map(([n, ...v]) => [n, v]) ?? [
  ['oasis_up_canyon', [-200, 330, 6, Math.PI / 2 + 0.25, 0.02]],     // from the lagoon looking west up the canyon
  ['oasis_down', [-900, 120, 30, -Math.PI / 2 + 0.1, -0.1]],          // from the head looking east over the oasis
  ['escarpment_face', [600, 1250, 2, Math.PI, 0.12]],                 // the escarpment's face from the plain (no mist)
  ['spires', [-600, -1000, 4, Math.PI / 2 + 0.6, 0.05]],              // the needle forest
  ['arch_slot', [1166, -540, 1.7, -0.09, 0.22]],                      // up the slot to the arch
  ['dunes', [-1150, 1150, 25, 1.2, -0.12]],                           // over the erg
  ['gorge', [1420, 120, 40, Math.PI, -0.35]],                          // over the gorge
  ['aerial', [0, 900, 420, Math.PI, -0.45]],                           // the whole desert from the south
  ['track', [759.6, 1086.4, 1.7, 2.40, -0.1]],                         // on the plain's track
  ['mesa_face', [420, 1040, 1.7, 0, 0.12]],                            // a mesa's stacked beds, close
  ['grove', [-700, 140, 1.7, Math.PI / 2, 0.02]],                      // in the palm grove by the river
]
for (const [n, [x, z, h, yaw, pitch]] of shots) {
  await p.evaluate((q) => window.__oth.view(...q), [x, z, h, yaw, pitch])
  await sleep(1800)
  await p.screenshot({ path: `${out}/${n}.png` })
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
