// hitchprof.mjs — WHAT STALLS a frame while driving (2026-11-17): the car carried along a way (perfmarks.mjs' drive)
// with Chrome's sampling profiler on; every frame's time kept in the page; the samples inside the long frames (≥ LONG
// ms) summed — by function (self), and by the game's own function on the stack nearest the top (who called it).
//   node scripts/harness/hitchprof.mjs [way] [seconds]   env: SET (tracks | roads | paths) SPEED (28) TIER (ultra) LONG (40) QS
//     FROM (the way's point to start at: a spot part-way along it)
import puppeteer from 'puppeteer-core'
const way = Number(process.argv[2] || 0), secs = Number(process.argv[3] || 40)
const SET = process.env.SET || 'tracks', SPEED = Number(process.env.SPEED || 28), TIER = process.env.TIER || 'ultra', LONG = Number(process.env.LONG || 40)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio', '--enable-precise-memory-info'], defaultViewport: { width: 1920, height: 1080 } })
const p = await b.newPage()
// (stopped — Ctrl-C, a kill: the browser closed too; left running it renders on, uncapped, under every later measure)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
p.on('pageerror', (e) => console.log('page error', e.message.slice(0, 200)))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${TIER}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${process.env.QS ? '&' + process.env.QS : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let k = 0; k < 30; k++) await p.keyboard.press('Minus')
await p.evaluate(() => { window.__oth.crossing.hold = true }) // (no swap into the other world: perfmarks.mjs)
const L = (await p.evaluate((SET, way) => { const m = window.__oth.world.map.meta; return ({ tracks: m.trails.lines, roads: m.outland.trails.lines, paths: m.paths.lines })[SET][way] }, SET, way)).slice(Number(process.env.FROM || 0))
// place at the start, settle
await p.evaluate((L) => { const o = window.__oth, [a, q] = [L[0], L[Math.min(3, L.length - 1)]]; o.car.placeAt(a[0], a[1], Math.atan2(-(q[0] - a[0]), -(q[1] - a[1]))) }, L)
await new Promise((r) => setTimeout(r, 5000))
const cdp = await p.createCDPSession()
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
const t0page = await p.evaluate(() => performance.now())
const run = await p.evaluate(async (L, speed, secs) => {
  const o = window.__oth, pts = []
  for (let i = 1; i < L.length; i++) { const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az); for (let s = 0; s < d; s += 1) pts.push([ax + (bx - ax) * (s / d), az + (bz - az) * (s / d)]) }
  const at = (d) => pts[Math.min(pts.length - 1, Math.floor(d))], head = (d) => { const a = at(d), q = at(d + 8); return Math.atan2(-(q[0] - a[0]), -(q[1] - a[1])) }
  const T = Math.min(secs * 1000, (pts.length - 10) / speed * 1000), t0 = performance.now(), ts = [], info = []
  const gc = o.world.terrain.cache
  await new Promise((r) => { const f = () => { const now = performance.now(); ts.push(now); info.push([gc?.baked ?? 0, Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e5) / 10, o.crossing.state]); const d = ((now - t0) / 1000) * speed, q = at(d); o.car.placeAt(q[0], q[1], head(d)); if (now - t0 < T) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  return { ts, info }
}, L, SPEED, secs)
const { profile } = await cdp.send('Profiler.stop')
const frames = run.ts, info = run.info
{ let was = ''; info.forEach((x, i) => { if (x[2] !== was) { console.log(`crossing ${x[2]} at ${((frames[i] - frames[0]) / 1000).toFixed(2)} s`); was = x[2] } }) }
// long frames (page time) → windows
const wins = []
for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] >= LONG) wins.push([frames[i - 1], frames[i]])
const med = [...frames.slice(1).map((t, i) => t - frames[i])].sort((a, b) => a - b)[Math.floor(frames.length / 2)]
// (each long frame: the texels the ground cache baked in the frame before it, and the heap then → after: a drop is a GC)
const bakedAll = info.map((x) => x[0]).sort((a, c) => a - c)
console.log(`cache texels a frame: median ${bakedAll[Math.floor(bakedAll.length / 2)]}, p95 ${bakedAll[Math.floor(bakedAll.length * 0.95)]}, max ${bakedAll.at(-1)}`)
for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] >= LONG) console.log(`  long ${Math.round(frames[i] - frames[i - 1])} ms: baked ${info[i - 1][0]} / ${info[i][0]} texels, heap ${info[i - 1][1]} → ${info[i][1]} MB, crossing ${info[i - 1][2]} → ${info[i][2]}`)
console.log(`${frames.length} frames over ${((frames.at(-1) - frames[0]) / 1000).toFixed(1)} s, median ${med.toFixed(2)} ms; ${wins.length} frames ≥ ${LONG} ms: ${wins.map(([a, c]) => Math.round(c - a)).join(' ')}`)
// samples → page time (the profile's clock offset taken at its start)
const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const self = new Map(), owner = new Map(), perWin = []
let t = profile.startTime, inWin = 0
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url.split('/src/')[1] ?? n.callFrame.url.split('/').pop() ?? '').split('?')[0]}:${n.callFrame.lineNumber + 1}`
for (let i = 0; i < profile.samples.length; i++) {
  t += profile.timeDeltas[i]
  const pt = t0page + (t - profile.startTime) / 1000
  const wi = wins.findIndex(([a, c]) => pt > a && pt <= c)
  if (wi < 0) continue
  inWin++
  const n = nodes.get(profile.samples[i]), dt = 0.2
  self.set(name(n), (self.get(name(n)) ?? 0) + dt)
  // the game's own frames on this stack (src/oth, src/…): the chain, top 4 nearest the root
  const chain = []
  for (let id = n.id; id !== undefined; id = parent.get(id)) { const c = nodes.get(id); if (c.callFrame.url.includes('/src/')) chain.push(name(c)) }
  const key = chain.slice(-4).reverse().join(' → ') || '(no game frame: ' + name(n) + ')'
  owner.set(key, (owner.get(key) ?? 0) + dt)
  // (and per long frame: each one's own top chains — 2026-11-18)
  const pw = perWin[wi] ??= new Map(), k1 = chain.slice(-3).reverse().join(' → ') + ' ⇒ ' + name(n)
  pw.set(k1, (pw.get(k1) ?? 0) + dt)
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k)
console.log(`\nin the long frames (${(inWin * 0.2).toFixed(0)} ms sampled) — self time:`)
for (const [k, v] of top(self, 18)) console.log(`  ${v.toFixed(1).padStart(7)} ms  ${k}`)
console.log(`\n… by the game's call chain (root → …):`)
for (const [k, v] of top(owner, 18)) console.log(`  ${v.toFixed(1).padStart(7)} ms  ${k}`)
console.log('slow makes', JSON.stringify(await p.evaluate(() => window.__prepSlow ?? [])))
console.log(`\neach long frame:`)
wins.forEach(([a, c], i) => {
  const sum = [...(perWin[i] ?? new Map()).values()].reduce((x, y) => x + y, 0)
  console.log(`  ${Math.round(c - a)} ms (at ${((a - frames[0]) / 1000).toFixed(1)} s), ${sum.toFixed(0)} ms of it sampled:`)
  for (const [k, v] of top(perWin[i] ?? new Map(), Number(process.env.ROWS || 6))) console.log(`    ${v.toFixed(1).padStart(6)} ms  ${k}`)
})
await b.close()
