// abverge.mjs <tier> (PHONE=1: the 412×915 phone viewport; PORT: the dev server, 5200) — the valley's fuller round
// (2026-11-06: the verges, the field's clumps, the light): ?verge=0&fieldpaint=0&light=0 vs on — frame time (trimmed
// mean of 2 s, uncapped) + CPU ms, triangles, draws; interleaved ×4, 6 fixed views + 6 spots on tracks at the chase
// camera's height, looking along them
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra', phone = process.env.PHONE === '1'
const W = phone ? 412 : 1920, H = phone ? 915 : 1080
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: phone ? 2.6 : 1, isMobile: phone, hasTouch: phone } })
const p = await b.newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 2000) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
const V = [
  ['spawn', -115.9, 1066.3, 1.7, 0, -0.04], ['spawn_w', -115.9, 1066.3, 1.7, 1.57, -0.04], ['over40', -115.9, 1066.3, 40, 0, -0.25],
  ['far300', 300, -300, 1.7, 0.8, -0.04], ['hill80', -400, 600, 80, 2.4, -0.18], ['ridge', -900, -500, 30, 0.5, -0.12],
]
const OFF = 'verge=0&fieldpaint=0&light=0', ON = 'verge=1'
const res = {}
for (const rep of [0, 1, 2, 3]) for (const q of rep % 2 ? [ON, OFF] : [OFF, ON]) {
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
  if (V.length === 6) V.push(...await p.evaluate(() => {
    const m = window.__oth.map, out = []
    let s = 4242; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
    for (let k = 0; k < 40000 && out.length < 6; k++) {
      const x = (r() - 0.5) * 3400, z = (r() - 0.5) * 3400
      if (m.trackDist(x, z) > 1.5 || out.some((q) => Math.hypot(q[1] - x, q[2] - z) < 400)) continue
      const e = 4, gx = m.trackDist(x + e, z) - m.trackDist(x - e, z), gz = m.trackDist(x, z + e) - m.trackDist(x, z - e)
      out.push(['track' + out.length, x, z, 3.2, Math.atan2(-gz, gx), -0.1]) // (the chase camera's height and tilt)
    }
    return out
  }))
  for (const [n, x, z, h, yaw, pitch] of V) {
    await p.evaluate((a) => { const o = window.__oth; o.setHour(12); o.view(...a) }, [x, z, h, yaw, pitch])
    await sleep(1500)
    const ms = await ft(), st = await p.evaluate(() => window.__oth.stats())
    const r = (res[n] ??= {}); (r[q] ??= { ms: [], cpu: [], draws: st.draws, tris: st.tris }).ms.push(ms); r[q].cpu.push(st.cpuMs)
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
let sa = 0, sb = 0, ca = 0, cb = 0
for (const [n, r] of Object.entries(res)) {
  const a = r[OFF], c = r[ON], ma = mean(a.ms), mb = mean(c.ms)
  sa += ma; sb += mb; ca += mean(a.cpu); cb += mean(c.cpu)
  console.log(n.padEnd(8), `off ${ma.toFixed(2)} ms [${a.ms.map((v) => v.toFixed(2))}] ${(a.tris / 1000).toFixed(0)}k tris ${a.draws} draws`.padEnd(64), `on ${mb.toFixed(2)} ms [${c.ms.map((v) => v.toFixed(2))}] ${(c.tris / 1000).toFixed(0)}k tris ${c.draws} draws`)
}
const N = Object.keys(res).length
console.log(`MEAN off ${(sa / N).toFixed(3)} ms  on ${(sb / N).toFixed(3)} ms  (${((sb - sa) / N).toFixed(3)});  CPU off ${(ca / N).toFixed(3)} on ${(cb / N).toFixed(3)} ms  (${tier}${phone ? ' phone' : ''})`)
await b.close()
