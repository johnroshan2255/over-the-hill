// viewshot.mjs out.png [query] [view] — a 1920×1080 screenshot of one of fps.mjs's views (+ gold), console errors shown; `port=5201` in the query shoots main (the parity check)
import puppeteer from 'puppeteer-core'
const [out, q = '', view = 'spawn'] = process.argv.slice(2)
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], cliff: ['valley', false, 1102, -1700, 2.2, 0, -0.02], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02], plain: ['desert', false, -300, 1100, 2, 0.3, 0.02], gold: ['valley', false, 520, 210, 1.8, 2.2, -0.12] }[view]
const port = q.includes('port=5201') ? 5201 : 5200
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio'], defaultViewport: { width: 1920, height: 1080 } })
const p = await b.newPage()
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warn' && /naga|WGSL|shader/i.test(m.text()))) console.log(m.type(), m.text().slice(0, 400)) })
p.on('pageerror', (e) => console.log('pageerror', e.message))
await p.goto(`http://localhost:${port}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0&${q}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
await new Promise((r) => setTimeout(r, 3000))
await p.screenshot({ path: out })
await b.close()
