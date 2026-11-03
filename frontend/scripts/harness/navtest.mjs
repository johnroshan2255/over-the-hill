// navtest.mjs [outDir] — THE GPS (Nav.ts, MapView, Radar): routes from the spawn to every place in the valley (time to
// plan, length, ETA, turns), a waypoint in the desert (the valley's leg ends at the pass; after a swap the desert's leg
// starts at the car), and pictures: the radar while driving with a route, the map with it, the desert's tab.
// The dev server on :5200 (npm run dev). ?save=0: never writes the player's journey.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'navshots'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1600,900', '--mute-audio'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await p.goto('http://localhost:5200/?tier=medium&hour=11&time=0&sound=0&save=0&weather=clear&radar=1', { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
await sleep(2500)

// every place in the valley, from the car at the spawn
const rows = await p.evaluate(() => {
  const o = window.__oth, g = o.guide, c = o.car.pos, out = []
  for (const l of o.world.places) {
    const t = performance.now()
    g.set({ world: 'valley', x: l.x, z: l.z, name: l.name }, c)
    const ms = performance.now() - t, r = g.route
    const offM = r ? Array.from(r.off).reduce((a, f, i) => a + (f ? r.cum[i + 1] - r.cum[i] : 0), 0) : 0
    out.push({ name: l.name, ms: +ms.toFixed(2), km: r ? +(r.length / 1000).toFixed(2) : null, crow: +(Math.hypot(l.x - c.x, l.z - c.z) / 1000).toFixed(2), min: r ? +(r.time / 60).toFixed(1) : null, offroad: Math.round(offM), turns: r?.maneuvers.length ?? 0, pts: r ? r.pts.length / 2 : 0 })
  }
  return out
})
console.table(rows)

// a waypoint far across the valley; drive a little so the radar shows the route ahead; pictures
await p.evaluate(() => {
  const o = window.__oth, l = o.world.places.find((q) => q.name === 'Lookout Peak') ?? o.world.places[0]
  o.guide.set({ world: 'valley', x: l.x, z: l.z, name: l.name }, o.car.pos)
})
await sleep(1500)
// drive along it a few seconds: the progress, the radar sliding and turning with the car
const before = await p.evaluate(() => window.__oth.guide.remaining)
await p.keyboard.down('KeyW'); await sleep(6000); await p.keyboard.up('KeyW')
await sleep(800)
const drove = await p.evaluate(() => ({ remaining: window.__oth.guide.remaining, lateral: window.__oth.guide.route?.lateral, speed: window.__oth.car.speedKmh }))
console.log('driving:', { before: Math.round(before), after: Math.round(drove.remaining), lateral: drove.lateral?.toFixed(1), kmh: drove.speed.toFixed(0) })
await p.screenshot({ path: `${out}/radar_full.png` })
await p.screenshot({ path: `${out}/radar.png`, clip: { x: 0, y: 900 - 300, width: 420, height: 300 } })
const plate = await p.evaluate(() => document.querySelector('.oth-radar-plate')?.textContent)
console.log('radar plate:', plate)
await p.keyboard.press('Tab')
await sleep(600)
await p.screenshot({ path: `${out}/map_valley.png` })
await p.keyboard.press('KeyZ')
await sleep(400)
await p.screenshot({ path: `${out}/map_valley_zoom.png` })
await p.keyboard.press('KeyZ')

// the desert's tab: click on Red Erg there → the route to the pass
await p.evaluate(() => [...document.querySelectorAll('.oth-map-tabs button')].find((b) => /desert/i.test(b.textContent)).click())
await sleep(1200)
await p.screenshot({ path: `${out}/map_desert_tab.png` })
const cross = await p.evaluate(async () => {
  const o = window.__oth, g = o.guide
  const meta = await (await fetch('/oth/desert/meta.json')).json()
  const l = meta.landmarks.find((q) => q.name === 'Red Erg') ?? meta.landmarks[0]
  g.set({ world: 'desert', x: l.x, z: l.z, name: l.name }, o.car.pos)
  await new Promise((r) => setTimeout(r, 400))
  const [ex, ez] = g.route.end, G = o.world.map.meta.gate
  return { dest: l.name, viaGate: g.viaGate, endToGate: +Math.hypot(ex - G.x, ez - G.z).toFixed(1), valleyKm: +(g.route.length / 1000).toFixed(2), desertLegKm: g.otherLeg ? +(g.otherLeg.length / 1000).toFixed(2) : null, totalKm: +(g.remaining / 1000).toFixed(2), min: +(g.remainingTime / 60).toFixed(1) }
})
console.log('cross-world:', cross)
await sleep(400)
await p.screenshot({ path: `${out}/map_desert_route.png` })
await p.evaluate(() => [...document.querySelectorAll('.oth-map-tabs button')].find((b) => /valley/i.test(b.textContent)).click())
await sleep(400)
await p.screenshot({ path: `${out}/map_valley_to_pass.png` })
await p.keyboard.press('Tab')

// the swap (the harness's: the car at the desert's spawn by its gate) → the desert's leg from the car
await p.evaluate(() => window.__oth.swapTo('desert'))
await sleep(3000)
const after = await p.evaluate(() => {
  const o = window.__oth, g = o.guide, r = g.route, w = g.waypoint
  return { world: o.world.id, waypoint: w?.name, viaGate: g.viaGate, km: r ? +(r.length / 1000).toFixed(2) : null, endToWaypoint: r ? +Math.hypot(r.end[0] - w.x, r.end[1] - w.z).toFixed(1) : null }
})
console.log('after the swap:', after)
await p.screenshot({ path: `${out}/desert_radar_full.png` })
await p.keyboard.press('Tab')
await sleep(800)
await p.screenshot({ path: `${out}/desert_map.png` })
console.log('errors:', errs.length ? errs : 'none')
await b.close()
