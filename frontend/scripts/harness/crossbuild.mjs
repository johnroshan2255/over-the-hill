// crossbuild.mjs — THE CROSSING'S BUILD, timed (2026-11-18): the car put within BUILD_AT of the Great Cliff's gate (the
// crossing held: no swap); every frame timed until the desert is built and waiting; then the long frames (ms@s after),
// the build's steps over 12 ms (World.build's timings) and when each ended, and the CPU profile inside one function
// (WITHIN, default the Rocks constructor) by its direct callee and by self time.
//   node scripts/harness/crossbuild.mjs        env: WITHIN ('Rocks oth/Rocks.ts' — a function name + its file as the profile names it)
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio', '--enable-precise-memory-info'], defaultViewport: { width: 1920, height: 1080 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { const { profile } = await cdp.send('Profiler.stop')
const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url.split('/src/')[1] ?? '').split('?')[0]}:${n.callFrame.lineNumber + 1}`
const W = process.env.WITHIN || 'Rocks oth/Rocks.ts', self = new Map(), kids = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i + 1] ?? 100) / 1000
  const chain = []; for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) chain.push(nodes.get(id))
  const at = chain.findIndex((c) => name(c).startsWith(W)); if (at < 0) continue
  const leaf = name(chain[0]); self.set(leaf, (self.get(leaf) ?? 0) + dt)
  const k = at > 0 ? name(chain[at - 1]) : '(self)'; kids.set(k, (kids.get(k) ?? 0) + dt)
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `  ${v.toFixed(1).padStart(6)} ms  ${k}`).join('\n')
console.log(`inside ${W} — by direct callee:\n${top(kids)}\nby self:\n${top(self)}`)
await b.close() } catch {} process.exit(130) })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
await new Promise((r) => setTimeout(r, 3000))
const cdp = await p.createCDPSession(); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start')
const r = await p.evaluate(async () => {
  const o = window.__oth
  o.crossing.hold = true
  // frames timed from the moment the car is put within BUILD_AT of the gate until the other world is ready
  const ts = []; let on = true
  const f = () => { ts.push(performance.now()); if (on) requestAnimationFrame(f) }; requestAnimationFrame(f)
  o.car.placeAt(800, -1100, 0)
  const t0 = performance.now()
  while (!o.crossing.state.startsWith('ready') && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, 1500)); on = false
  const long = []
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 40) long.push(`${Math.round(ts[i] - ts[i - 1])}@${((ts[i - 1] - t0) / 1000).toFixed(2)}`)
  const t = o.crossing.spare?.timings ?? {}
  return { long: long.join(' '), steps: Object.entries(t).filter(([k, v]) => !k.startsWith('@') && v > 12).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · '), at: Object.entries(t).filter(([k]) => k.startsWith('@')).map(([k, v]) => `${k.slice(1)}@${(v / 1000).toFixed(2)}`).join(' ') }
})
console.log('long frames (ms@s):', r.long); console.log('steps > 12 ms:', r.steps); console.log('ends:', r.at)
const { profile } = await cdp.send('Profiler.stop')
const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url.split('/src/')[1] ?? '').split('?')[0]}:${n.callFrame.lineNumber + 1}`
const W = process.env.WITHIN || 'Rocks oth/Rocks.ts', self = new Map(), kids = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i + 1] ?? 100) / 1000
  const chain = []; for (let id = profile.samples[i]; id !== undefined; id = parent.get(id)) chain.push(nodes.get(id))
  const at = chain.findIndex((c) => name(c).startsWith(W)); if (at < 0) continue
  const leaf = name(chain[0]); self.set(leaf, (self.get(leaf) ?? 0) + dt)
  const k = at > 0 ? name(chain[at - 1]) : '(self)'; kids.set(k, (kids.get(k) ?? 0) + dt)
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `  ${v.toFixed(1).padStart(6)} ms  ${k}`).join('\n')
console.log(`inside ${W} — by direct callee:\n${top(kids)}\nby self:\n${top(self)}`)
await b.close()
