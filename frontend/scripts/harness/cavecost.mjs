// cavecost.mjs <tier> — the caves' cost: ?sites=0 vs on, uncapped 1080p, interleaved ×3; two general views + each
// cave's front / inside / above (trimmed mean of 2 s). Needs `npm run dev` on 5200.
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080 } })
const p = await b.newPage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 2000) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
const V = [['spawn', -115.9, 1066.3, 1.7, 0, -0.04], ['hill80', -400, 600, 80, 2.4, -0.18]]
const look = (f, t) => Math.atan2(-(t[0] - f[0]), -(t[1] - f[1]))
const res = {}
for (const rep of [0, 1, 2]) for (const q of rep % 2 ? ['sites=0', 'sites=1'] : ['sites=1', 'sites=0']) {
  await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0&world=valley&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 180000, polling: 200 })
  if (V.length === 2 && q === 'sites=1') for (const l of await p.evaluate(() => window.__oth.world.places.filter((q) => q.dark).map((l) => ({ x: l.x, z: l.z, rot: l.rot, name: l.name, zc: l.dark.z1 })))) {
    const sx = Math.sin(l.rot), cz = Math.cos(l.rot), P = (lx, lz) => [l.x + lx * cz + lz * sx, l.z - lx * sx + lz * cz]
    for (const [n, f, h, t, pt] of [['front', P(3, 40), 2.6, P(0, 0), -0.05], ['inside', P(0.5, l.zc * 0.6), 2.2, P(0, 40), 0.1], ['above', P(60, l.zc), 25, P(0, l.zc), -0.25]]) V.push([l.name.slice(0, 8) + '_' + n, f[0], f[1], h, look(f, t), pt])
  }
  for (const [n, x, z, h, yaw, pitch] of V) {
    await p.evaluate((a) => { const o = window.__oth; o.setHour(12); o.view(...a) }, [x, z, h, yaw, pitch])
    await sleep(1000)
    const ms = await ft(), st = await p.evaluate(() => window.__oth.stats())
    ;((res[n] ??= {})[q] ??= { ms: [], tris: st.tris, draws: st.draws }).ms.push(ms)
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
for (const [n, r] of Object.entries(res)) { const a = r['sites=0'], c = r['sites=1']; if (!a || !c) continue; console.log(n.padEnd(10), `off ${mean(a.ms).toFixed(3)} ms ${(a.tris / 1000).toFixed(0)}k ${a.draws}d`.padEnd(28), `on ${mean(c.ms).toFixed(3)} ms ${(c.tris / 1000).toFixed(0)}k ${c.draws}d  ${(1000 / mean(c.ms)).toFixed(0)} fps`) }
await b.close().catch(() => {}); process.exit(0)
