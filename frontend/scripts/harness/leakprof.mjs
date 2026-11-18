// leakprof.mjs — WHAT GROWS as you travel (2026-11-17: a drive down every outland road took the page's heap from
// ~0.6 GB to 1.8 GB, then the page died): the car carried along ways (perfmarks.mjs' drive), a full GC after each,
// the heap then (what's really kept); Chrome's sampling heap profiler on the while — at the end, what's still alive
// summed by the game's function that allocated it.
//   node scripts/harness/leakprof.mjs <ways, e.g. 13,14,15>   env: SET (roads | tracks | paths) SPEED (28) TIER (ultra) QS
import puppeteer from 'puppeteer-core'
const ways = (process.argv[2] || '13,14,15,16').split(',').map(Number)
const SET = process.env.SET || 'roads', SPEED = Number(process.env.SPEED || 28), TIER = process.env.TIER || 'ultra'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 3600000,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio', '--enable-precise-memory-info'], defaultViewport: { width: 1920, height: 1080 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('page error', e.message.slice(0, 200)))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${TIER}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${process.env.QS ? '&' + process.env.QS : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let k = 0; k < 30; k++) await p.keyboard.press('Minus')
const cdp = await p.createCDPSession()
await cdp.send('HeapProfiler.enable')
const floor = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); return Math.round(await p.evaluate(() => performance.memory.usedJSHeapSize / 1e6)) }
console.log(`start: heap ${await floor()} MB after GC`)
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 })
for (const w of ways) {
  const km = await p.evaluate(async (SET, w, speed) => {
    const o = window.__oth, m = o.world.map.meta, L = ({ tracks: m.trails.lines, roads: m.outland.trails.lines, paths: m.paths.lines })[SET][w], pts = []
    for (let i = 1; i < L.length; i++) { const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az); for (let s = 0; s < d; s += 1) pts.push([ax + (bx - ax) * (s / d), az + (bz - az) * (s / d)]) }
    if (pts.length < 40) return 0
    const at = (d) => pts[Math.min(pts.length - 1, Math.floor(d))], head = (d) => { const a = at(d), q = at(d + 8); return Math.atan2(-(q[0] - a[0]), -(q[1] - a[1])) }
    o.car.placeAt(pts[0][0], pts[0][1], head(0)); await new Promise((r) => setTimeout(r, 3000))
    const T = (pts.length - 10) / speed * 1000, t0 = performance.now()
    await new Promise((r) => { const f = () => { const d = ((performance.now() - t0) / 1000) * speed, q = at(d); o.car.placeAt(q[0], q[1], head(d)); if (performance.now() - t0 < T) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
    return pts.length / 1000
  }, SET, w, SPEED)
  console.log(`${SET} ${w}: ${km.toFixed(2)} km — heap ${await floor()} MB after GC`)
}
await floor()
const { profile } = await cdp.send('HeapProfiler.stopSampling')
// live bytes by allocating function, and by the nearest game function on the stack
const self = new Map(), game = new Map()
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url.split('/src/')[1] ?? n.callFrame.url.split('/').pop() ?? '').split('?')[0]}:${n.callFrame.lineNumber + 1}`
const walk = (n, chain) => {
  const c = [...chain, n]
  if (n.selfSize) {
    self.set(name(n), (self.get(name(n)) ?? 0) + n.selfSize)
    const g = [...c].reverse().find((x) => x.callFrame.url.includes('/src/'))
    const k = g ? name(g) : '(no game frame) ' + name(n)
    game.set(k, (game.get(k) ?? 0) + n.selfSize)
  }
  for (const ch of n.children ?? []) walk(ch, c)
}
walk(profile.head, [])
const top = (m) => [...m].sort((a, c) => c[1] - a[1]).slice(0, 16)
console.log('\nstill alive, allocated in (game function nearest the allocation):')
for (const [k, v] of top(game)) console.log(`  ${(v / 1e6).toFixed(1).padStart(7)} MB  ${k}`)
console.log('\n… by the allocating function itself:')
for (const [k, v] of top(self)) console.log(`  ${(v / 1e6).toFixed(1).padStart(7)} MB  ${k}`)
await b.close()
