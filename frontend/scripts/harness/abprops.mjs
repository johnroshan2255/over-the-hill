// abprops.mjs <tier> — frame time with the valley's new things (Props: props, fires, halos, fireflies, the fire's
// painted light) hidden vs shown, interleaved ×5, per view (uncapped 1080p); then the CPU cost of their per-frame work
import puppeteer from '../../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const tier = process.argv[2] || 'ultra'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// the frame time over 1.5 s, its slowest and fastest tenth dropped (a stray stall of the machine doesn't count)
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 1500) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
// hide = the group off and no fire light (the frame loop sets uFire each frame: zero its strength after, via a flag)
await p.evaluate(() => {
  const o = window.__oth, fl = o.props.fireLight.bind(o.props)
  o.props.fireLight = (...a) => { fl(...a); if (window.__hideProps) a[3].w = 0 }
})
const set = (hide) => p.evaluate((h) => { window.__hideProps = h; window.__oth.props.group.visible = !h }, hide)
const at = (name, d, a, h, hour) => (o) => {
  const c = o.map.meta.landmarks.find((l) => l.name === name)
  const x = c.x + Math.sin(a) * d, z = c.z + Math.cos(a) * d
  o.setHour(hour)
  o.view(x, z, h, Math.atan2(-(c.x - x), -(c.z - z)), -0.08)
}
const ALL = {
  spawn_noon: (o) => { const sp = o.map.meta.spawn; o.setHour(12); o.view(sp.x, sp.z, 1.8, 0, -0.04) },
  camp_night: [at, 'Lakeshore Camp', 9, 2.2, 1.8, 21.5],
  camp_noon: [at, 'Lakeshore Camp', 9, 2.2, 1.8, 12],
  cabin_dusk: (o) => { const c = o.map.meta.landmarks.find((l) => l.kind === 'cabin'); o.setHour(19.2); o.view(c.x + 14, c.z + 14, 2, Math.atan2(14, 14), -0.06) },
  aerial_night: (o) => { const sp = o.map.meta.spawn; o.setHour(21.5); o.view(sp.x, sp.z + 300, 70, 0.6, -0.3) },
}
const views = process.env.VIEWS ? Object.fromEntries(process.env.VIEWS.split(',').map((k) => [k, ALL[k]])) : ALL
for (const [vn, v] of Object.entries(views)) {
  if (Array.isArray(v)) { const [f, ...args] = v; await p.evaluate(`(${f.toString()})(...${JSON.stringify(args)})(window.__oth)`) } else await p.evaluate(`(${v.toString()})(window.__oth)`)
  await sleep(5000)
  let on = 0, off = 0
  const so = [], sf = []
  for (let i = 0; i < 5; i++) {
    await set(false); await sleep(300); const a = await ft(); on += a; so.push(a.toFixed(2))
    await set(true); await sleep(300); const c = await ft(); off += c; sf.push(c.toFixed(2))
  }
  if (process.env.SAMPLES) console.log('   on', so.join(' '), ' off', sf.join(' '))
  await set(false)
  const info = await p.evaluate(() => `${window.__oth.stats().draws} draws`)
  console.log(`${tier.padEnd(6)} ${vn.padEnd(13)} shown ${(on / 5).toFixed(3)} ms (${(5000 / on).toFixed(0)} fps)  hidden ${(off / 5).toFixed(3)} ms (${(5000 / off).toFixed(0)} fps)  cost ${((on - off) / 5).toFixed(3)} ms ${info}`)
}
// CPU: a forced rebuild of the visible list (as when driving: every 6 m or turn), the fire light, the crate check
const cpu = await p.evaluate(() => {
  const o = window.__oth, pr = o.props, cam = o.camera
  const sp = o.map.meta.spawn
  o.view(sp.x, sp.z, 1.8, 0, -0.04)
  let t = performance.now()
  for (let i = 0; i < 500; i++) { pr.dirty = true; cam.rotation.y += 0.01; cam.updateMatrixWorld(); pr.update(cam) }
  const upd = (performance.now() - t) / 500
  const v = new cam.position.constructor(), u = { value: 0 }
  const out = { w: 0, set() { return this } }
  t = performance.now()
  for (let i = 0; i < 5000; i++) pr.fireLight(cam.position, i * 0.016, 1, out)
  const fire = (performance.now() - t) / 5000
  t = performance.now()
  for (let i = 0; i < 5000; i++) { pr.pickT = 0; pr.pickUp(0.016, sp.x + i * 0.01, 0, sp.z) }
  const pick = (performance.now() - t) / 5000
  return { upd, fire, pick }
})
console.log(`${tier.padEnd(6)} CPU  rebuild ${(cpu.upd * 1000).toFixed(1)} µs  fireLight ${(cpu.fire * 1000).toFixed(2)} µs  pickUp ${(cpu.pick * 1000).toFixed(2)} µs`)
console.log('errors:', errs.length ? errs : 'none')
await b.close()
