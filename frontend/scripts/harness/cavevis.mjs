// cavevis.mjs — FROM WHERE CAN THE CAVE'S INSIDE (past the way in) BE SEEN? The camera on a sphere of directions round
// the mouth (distance D, azimuth off its axis, elevation), the inside toggled in the same tab; pixels that differ (> 4).
import puppeteer from 'puppeteer-core'
const Ds = (process.env.D || '150,400,1000,2500').split(',').map(Number), AZ = (process.env.AZ || '0,10,20,30,45,60,-20,-45').split(',').map(Number), EL = (process.env.EL || '-30,-20,-12,-6,0,8,20').split(',').map(Number)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=ultra&hour=${process.env.HOUR || 12}&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0&radar=0&freeze=1`, { waitUntil: 'load', timeout: 120000 })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await p.evaluate(() => { const c = window.__oth.world.cave, orig = c.update.bind(c); window.__in = true
  c.update = (cam) => { orig(cam); for (const m of c.inside) m.visible = window.__in; for (const m of c.pools) m.visible = window.__in; for (const m of c.way) m.visible = true } })
const cmp = await b.newPage()
const diff = (x, y) => cmp.evaluate(async (x, y) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s })
  const [i1, i2] = [await load(x), await load(y)], c = document.createElement('canvas'); c.width = i1.width; c.height = i1.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data
  let n = 0, mx = 0; for (let i = 0; i < d1.length; i += 4) { const m = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2])); if (m > 4) n++; if (m > mx) mx = m }
  return [n, mx] }, x.toString('base64'), y.toString('base64'))
const clip = { x: 660, y: 240, width: 600, height: 600 }
await p.bringToFront()
for (const D of Ds) {
  console.log(`D = ${D} m   (rows: elevation °, columns: azimuth ° ${AZ.join(' ')})   pixels differing by > 4 (the most)`)
  for (const el of EL) {
    const row = []
    for (const az of AZ) {
      const ok = await p.evaluate((D, az, el) => { const o = window.__oth, w = o.world, f = w.cave.frame, a = az * Math.PI / 180, e = el * Math.PI / 180
        const my = w.map.height(f.wx(0, 2), f.wz(0, 2)) + 4, lx = D * Math.cos(e) * Math.sin(a), lz = D * Math.cos(e) * Math.cos(a), cy = my + D * Math.sin(e)
        const x = f.wx(lx, lz), z = f.wz(lx, lz), g = w.map.height(x, z); if (cy < g + 1.7) return false
        const mx = f.wx(0, -4), mz = f.wz(0, -4), l = Math.hypot(mx - x, mz - z); o.view(x, z, cy - g, Math.atan2(-(mx - x) / l, -(mz - z) / l), Math.atan2(my - cy, l)); return true }, D, az, el)
      if (!ok) { row.push('  under'); continue }
      await sleep(900)
      await p.evaluate(() => { window.__in = true }); await sleep(120); const A = await p.screenshot({ type: 'png', clip })
      await p.evaluate(() => { window.__in = false }); await sleep(120); const B = await p.screenshot({ type: 'png', clip })
      const [n, mx] = await diff(A, B)
      row.push(`${String(n).padStart(5)}(${String(mx).padStart(3)})`)
    }
    console.log(`  ${String(el).padStart(4)}  ${row.join(' ')}`)
  }
}
await b.close()
