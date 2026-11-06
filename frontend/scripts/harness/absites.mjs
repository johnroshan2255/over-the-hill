// absites.mjs <tier> (PHONE=1: the phone viewport; PORT, default 5200) — the valley's places round (2026-11-06: the
// composed landmarks, the new places — Sites.ts / Locations.ts): ?sites=0 vs on, frame time (trimmed mean of 2 s,
// uncapped), interleaved ×3; 6 fixed views + each new place from 26 m (and inside the tunnel), at noon
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
const OFF = 'sites=0', ON = 'sites=1'
const res = {}
for (const rep of [0, 1, 2]) for (const q of rep % 2 ? [ON, OFF] : [OFF, ON]) {
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0&world=valley&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
  if (V.length === 6) V.push(...await p.evaluate(() => window.__oth.world.places.filter((l) => l.id >= 1000).flatMap((l) => {
    const d = 26, a = l.rot + 0.4, x = l.x + Math.sin(a) * d, z = l.z + Math.cos(a) * d
    const v = [[l.kind + '_' + l.id, x, z, 4, Math.atan2(-(l.x - x), -(l.z - z)), -0.12]]
    if (l.kind === 'tunnel') v.push(['tunnel_in', l.x - Math.sin(l.rot) * 6, l.z - Math.cos(l.rot) * 6, 2.4, l.rot + Math.PI, -0.03])
    return v
  })))
  for (const [n, x, z, h, yaw, pitch] of V) {
    await p.evaluate((a) => { const o = window.__oth; o.setHour(12); o.view(...a) }, [x, z, h, yaw, pitch])
    await sleep(1200)
    const ms = await ft(), st = await p.evaluate(() => window.__oth.stats())
    const r = (res[n] ??= {}); (r[q] ??= { ms: [], draws: st.draws, tris: st.tris }).ms.push(ms)
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
let sa = 0, sb = 0, worst = 0
for (const [n, r] of Object.entries(res)) {
  const a = r[OFF], c = r[ON]; if (!a || !c) continue
  const ma = mean(a.ms), mb = mean(c.ms); sa += ma; sb += mb; worst = Math.max(worst, mb)
  console.log(n.padEnd(16), `off ${ma.toFixed(2)} ms ${(a.tris / 1000).toFixed(0)}k ${a.draws}d`.padEnd(30), `on ${mb.toFixed(2)} ms ${(c.tris / 1000).toFixed(0)}k ${c.draws}d   ${(1000 / mb).toFixed(0)} fps`)
}
const N = Object.keys(res).length
console.log(`MEAN off ${(sa / N).toFixed(3)} ms  on ${(sb / N).toFixed(3)} ms (${(1000 / (sb / N)).toFixed(0)} fps)  worst on ${worst.toFixed(2)} ms (${(1000 / worst).toFixed(0)} fps)  (${tier}${phone ? ' phone' : ''})`)
await b.close().catch(() => {}); process.exit(0)
