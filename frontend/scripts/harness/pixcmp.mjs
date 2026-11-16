// pixcmp.mjs "<A>|<B>" <views;…> [outDir] — THE SAME PICTURE, STRICTLY: two variants ("port=5201" / "cavefar=1" / "" — URL
// params, port= picks the server), each loaded ONCE in its own tab with the shaders' clock frozen (?freeze=1), every view
// shot in both and compared pixel by pixel: how many differ at all, by > 2, by > 8 (of 255, any channel), and the most.
// views (';'-separated): a name | x,z,h,yaw,pitch | cave:lx,lz,agl,pitch (in the cave's frame, looking at its mouth)
// env TIER (ultra), FLOOR=1 (A shot twice: the noise floor), SETTLE ms (3500), QS (extra params for both)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const variants = (process.argv[2] ?? '|').split('|'), views = (process.argv[3] || 'spawn;forest;lake;cliff').split(';'), out = process.argv[4]
if (out) fs.mkdirSync(out, { recursive: true })
const V = { spawn: null, forest: [260, 640, 2.2, 0.6, -0.05], lake: [-160, -1320, 3, -1.2, -0.04], cliff: [1102, -1700, 2.2, 0, -0.02], rockhill: [-864.6, -449.9, 2.4, 2.454, -0.05],
  oroad: [-4203.7, -4388.3, 3, 2.356, -0.08], omeadow: [211.2, 3306.9, 2.4, 2.9, -0.06], town: [3025.3, -3161.7, 3, 0.785, -0.02], canyon: [-3523.0, -2881.0, 6, 2.1396, -0.25], wtree: [3801.6, 4848.2, 8, 2.2, 0.25],
  caveFront: [-1190, 1900, 3.5, 0.0, 0.02], caveHall: [-1191.4, 1799.6, 4.5, 0.33, 0.0], caveAbove: [-1133, 1949.6, 120, 0.32, -0.57], boxedge: [672, -2015, 2.5, 0, -0.08], tarn: [5430, -4020, 30, 2.356, -0.35],
  giant: [2200, 250, 3, 2.3, 0.0], ring: [-330, -4190, 3, 0.4, -0.02], mire: [3353.9, -2905.0, 9, 0.7, -0.2], court: [-617, -4756, 14, 0.69, -0.3], hand: [4118, 838, 8, 2.5, 0.0], fortGate: [4160.0, -1155.3, 3, 0.0915, -0.12], osnow: [2881.7, -4202.4, 6, 1.0, -0.1], orocks: [3374.5, -52.7, 2.4, 2.6, -0.05], obog: [-3509.3, 3156.4, 2.4, 2.6, -0.05], gorge: [-4520, -1600, 35, 2.35, -0.45], pavedHut: [-721, 640, 4, 0, -0.25], pavedRuin: [1925, -382, 4, 0, -0.25], townair: [3103, -3084, 80, 0.785, -0.5] }
const tier = process.env.TIER || 'ultra', settle = Number(process.env.SETTLE || 3500), world = process.env.WORLD || 'valley'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', `--window-size=${process.env.W || 1920},${process.env.H || 1080}`, '--mute-audio'], defaultViewport: { width: Number(process.env.W || 1920), height: Number(process.env.H || 1080), deviceScaleFactor: 1 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pages = []
for (const q of variants) {
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log(`  [${q}] page error: ${e.message.slice(0, 200)}`))
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`  [${q}] console error: ${m.text().slice(0, 200)}`) })
  const port = new URLSearchParams(q).get('port') || 5200
  await p.goto(`http://localhost:${port}/?tier=${tier}&hour=${process.env.HOUR || 12}&dpr=fixed&time=0&weather=clear&world=${world}&sound=0&save=0&radar=0&freeze=1${process.env.QS ? `&${process.env.QS}` : ''}${q ? `&${q}` : ''}`, { waitUntil: 'load', timeout: 120000 })
  await p.bringToFront()
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  pages.push(p)
}
const place = (p, v) => p.evaluate((v, HOUR) => { const o = window.__oth; o.setHour(Number(HOUR))
  if (typeof v === 'string' && v.startsWith('cave:')) { const [lx, lz, h] = v.slice(5).split(',').map(Number), w = o.world, f = w.cave.frame, x = f.wx(lx, lz), z = f.wz(lx, lz), mx = f.wx(0, -6), mz = f.wz(0, -6), l = Math.hypot(mx - x, mz - z), my = w.map.height(f.wx(0, 2), f.wz(0, 2)) + 4, cy = w.map.height(x, z) + h; o.view(x, z, h, Math.atan2(-(mx - x) / l, -(mz - z) / l), Math.atan2(my - cy, l)) }
  else if (typeof v === 'string' && v.startsWith('caves:')) { const [D, az, el] = v.slice(6).split(',').map(Number), w = o.world, f = w.cave.frame, a = az * Math.PI / 180, e = el * Math.PI / 180
    const my = w.map.height(f.wx(0, 2), f.wz(0, 2)) + 4, lx = D * Math.cos(e) * Math.sin(a), lz = D * Math.cos(e) * Math.cos(a), cy = my + D * Math.sin(e), x = f.wx(lx, lz), z = f.wz(lx, lz), g = w.map.height(x, z)
    const mx = f.wx(0, -4), mz = f.wz(0, -4), l = Math.hypot(mx - x, mz - z); o.view(x, z, Math.max(1.7, cy - g), Math.atan2(-(mx - x) / l, -(mz - z) / l), Math.atan2(my - Math.max(cy, g + 1.7), l)) }
  else if (!v) o.drive(true); else o.view(...v) }, v, process.env.HOUR || 12)
const shoot = async (p, v) => { await p.bringToFront(); await place(p, v); await sleep(settle); return p.screenshot({ type: 'png' }) }
const cmp = await b.newPage()
const diff = (x, y, want) => cmp.evaluate(async (x, y, want) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s })
  const [i1, i2] = [await load(x), await load(y)]
  const c = document.createElement('canvas'); c.width = i1.width; c.height = i1.height
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data
  g.drawImage(i2, 0, 0); const im = g.getImageData(0, 0, c.width, c.height), d2 = im.data
  let n0 = 0, n2 = 0, n8 = 0, mx = 0, at = null, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  for (let i = 0; i < d1.length; i += 4) {
    const m = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]))
    if (m > 0) { n0++; const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width); if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py }
    if (m > 2) n2++
    if (m > 8) n8++
    if (m > mx) { mx = m; at = [(i / 4) % c.width, Math.floor(i / 4 / c.width), d1[i], d1[i + 1], d1[i + 2], d2[i], d2[i + 1], d2[i + 2]] }
    if (want) { const k = Math.min(255, m * 16); d2[i] = k; d2[i + 1] = m > 8 ? 255 : 0; d2[i + 2] = m > 0 ? 80 : 0; d2[i + 3] = 255 }
  }
  let png = null
  if (want && n0) { g.putImageData(im, 0, 0); png = c.toDataURL('image/png').split(',')[1] }
  return { n0, n2, n8, mx, at, box: n0 ? [x0, y0, x1, y1] : null, png }
}, x.toString('base64'), y.toString('base64'), want)
for (const vs of views) {
  const v = vs.startsWith('cave') ? vs : vs.includes(',') ? vs.split(',').map(Number) : V[vs]
  const a = await shoot(pages[0], v)
  const row = [`${vs.padEnd(26)}`]
  for (let k = 1; k < pages.length; k++) {
    const bb = await shoot(pages[k], v), d = await diff(a, bb, !!out)
    row.push(`A vs ${variants[k] || 'base'}: ${d.n0} differ, ${d.n2} > 2, ${d.n8} > 8, max ${d.mx}${d.mx > 2 ? ` at ${d.at.slice(0, 2).join(',')} (${d.at.slice(2, 5).join(' ')} vs ${d.at.slice(5).join(' ')})` : ''}`)
    if (out) { const n = vs.replace(/[^a-z0-9.-]+/gi, '_'); fs.writeFileSync(`${out}/${n}_A.png`, a); fs.writeFileSync(`${out}/${n}_B${k}.png`, bb); if (d.png) fs.writeFileSync(`${out}/${n}_diff${k}.png`, Buffer.from(d.png, 'base64')) }
  }
  if (process.env.FLOOR) { const a2 = await shoot(pages[0], v), d = await diff(a, a2, false); row.push(`floor (A vs A): ${d.n0} differ, ${d.n8} > 8, max ${d.mx}`) }
  console.log(row.join('   '))
}
await b.close()
