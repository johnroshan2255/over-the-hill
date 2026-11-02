import puppeteer from '../../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const out = process.argv[2]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto('http://localhost:5200/?world=desert&tier=ultra&hour=11&drive=0&dpr=fixed&time=0&weather=clear', { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
console.log('palms:', await p.evaluate(() => window.__oth.world.trees.count))
const views = {
  // the oasis like their ss_7: up on the floor's edge, looking down the canyon over the river and its palms
  oasis_a: [-700, 330, 14, -Math.PI / 2 + 0.15, -0.08],
  oasis_b: [-150, 120, 5, Math.PI / 2 - 0.4, -0.02],
  palms_close: [-420, 200, 3, -Math.PI / 2 - 0.3, 0.05],
  lagoon: [-180, 430, 10, Math.PI / 2 + 0.6, -0.1],
}
for (const [n, v] of Object.entries(views)) { await p.evaluate((q) => window.__oth.view(...q), v); await sleep(1800); await p.screenshot({ path: `${out}/${n}.png` }) }
console.log('errors:', errs.length ? errs : 'none')
await b.close()
