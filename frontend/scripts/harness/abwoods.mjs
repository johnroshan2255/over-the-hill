// abwoods.mjs <tier> (PHONE=1: the 412×915 phone viewport) — the woods: frame time + trees drawn per LOD (near conifer / mid conifer / near broadleaf / mid broadleaf / impostors), ?woods=0 (the old scatter + ranges) vs now, interleaved ×4, uncapped 1080p; 6 fixed views + 6 spots on tracks through the forest mask
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
const res = {}
for (const rep of [0, 1, 2, 3]) for (const q of rep % 2 ? ['woods=1', 'woods=0'] : ['woods=0', 'woods=1']) {
  await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
  // + 6 spots ON THE TRACKS THROUGH FOREST (the mask's, not the trees': the same spots for both), looking along the track
  if (V.length === 6) V.push(...await p.evaluate(() => {
    const o = window.__oth, m = o.map, mk = [0, 0, 0, 0], out = []
    let s = 12345; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
    for (let k = 0; k < 40000 && out.length < 6; k++) {
      const x = (r() - 0.5) * 3000, z = (r() - 0.5) * 3000
      if (m.trackDist(x, z) > 2) continue
      m.maskAt(x, z, mk); if (mk[3] < 0.55) continue
      if (out.some((q) => Math.hypot(q[1] - x, q[2] - z) < 400)) continue
      const e = 4, gx = m.trackDist(x + e, z) - m.trackDist(x - e, z), gz = m.trackDist(x, z + e) - m.trackDist(x, z - e)
      out.push(['track' + out.length, x, z, 1.7, Math.atan2(-gz, gx), -0.03]) // (along the track: across its distance gradient)
    }
    return out
  }))
  for (const [n, x, z, h, yaw, pitch] of V) {
    await p.evaluate((a) => { const o = window.__oth; o.setHour(12); o.view(...a) }, [x, z, h, yaw, pitch])
    await sleep(1500)
    const ms = await ft(), st = await p.evaluate(() => window.__oth.stats())
    const r = (res[n] ??= {}); (r[q] ??= { ms: [], trees: st.trees }).ms.push(ms)
  }
}
let sa = 0, sb = 0
for (const [n, r] of Object.entries(res)) {
  const a = r['woods=0'], c = r['woods=1'], ma = a.ms.reduce((x, y) => x + y) / a.ms.length, mb = c.ms.reduce((x, y) => x + y) / c.ms.length
  sa += ma; sb += mb
  console.log(n.padEnd(9), `old ${ma.toFixed(2)} ms [${a.ms.map((v) => v.toFixed(2))}] trees ${a.trees.join('/')}`.padEnd(58), `new ${mb.toFixed(2)} ms [${c.ms.map((v) => v.toFixed(2))}] trees ${c.trees.join('/')}`)
}
console.log(`MEAN old ${(sa / Object.keys(res).length).toFixed(2)} ms  new ${(sb / Object.keys(res).length).toFixed(2)} ms  (${tier}${phone ? ' phone' : ''})`)
await b.close()
