// tris.mjs [tier] [extra] — triangles and draws per part of the world, at a few views (hide each part, read the stats)
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const V = { spawn: [true], forest: [false, 260, 640, 2.2, 0.6, -0.05], lake: [false, -160, -1320, 3, -1.2, -0.04], cliff: [false, 1102, -1700, 2.2, 0, -0.02], omeadow: [false, 211.2, 3306.9, 2.4, 2.9, -0.06] }
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load', timeout: 120000 })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [name, v] of Object.entries(V)) {
  await p.evaluate((v) => { const o = window.__oth; if (v[0]) o.drive(true); else o.view(v[1], v[2], v[3], v[4], v[5]) }, v)
  await sleep(3000)
  const all = await p.evaluate(() => window.__oth.stats())
  const names = await p.evaluate(() => Object.keys(window.__oth.parts()))
  const rows = []
  for (const n of names) {
    await p.evaluate((n) => (window.__oth.parts()[n].visible = false), n); await sleep(250)
    const s = await p.evaluate(() => window.__oth.stats())
    await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n); await sleep(100)
    rows.push([n, all.tris - s.tris, all.draws - s.draws])
  }
  rows.sort((a, b) => b[1] - a[1])
  console.log(`${tier} ${name}: ${all.draws} draws, ${(all.tris / 1000).toFixed(0)}k tris, blades ${all.blades}, patches ${all.patches}, trees ${JSON.stringify(all.trees)}`)
  console.log('   ' + rows.filter((r) => r[1] > 0 || r[2] > 0).map((r) => `${r[0]} ${(r[1] / 1000).toFixed(0)}k/${r[2]}d`).join('  '))
}
await b.close()
