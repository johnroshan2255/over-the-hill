// movecost.mjs [variants] [speed m/s] — what MOVING costs (docs/PERF.md: the ground cache re-bakes what each step
// uncovers): the camera flown along a line at `speed` (real time, uncapped 1080p ULTRA), the frame times' mean / p99 /
// max over 4 s, each variant in its own tab, interleaved — against the same flight standing still.
//   node scripts/harness/movecost.mjs "gcache=0|" 30
import puppeteer from 'puppeteer-core'
const variants = (process.argv[2] ?? 'gcache=0|').split('|')
const speed = Number(process.argv[3] || 30)
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const pages = []
for (const q of variants) {
  const p = await b.newPage()
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`  [${q}] console error: ${m.text().slice(0, 200)}`) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${q ? `&${q}` : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  pages.push(p)
}
// a 2.2 m-high camera flying over the valley (x from −600, z 200, heading +x)
const fly = (p, v) => p.evaluate(async (v) => {
  const o = window.__oth, d = []
  o.view(-600, 200, 2.2, Math.PI / 2, -0.05)
  await new Promise((r) => setTimeout(r, 1500))
  await o.gpuDone()
  const t0 = performance.now()
  let last = t0
  await new Promise((r) => { const f = () => { const n = performance.now(); d.push(n - last); last = n; o.view(-600 + v * (n - t0) / 1000, 200, 2.2, Math.PI / 2, -0.05); if (n - t0 < 4000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  await o.gpuDone()
  const total = performance.now() - t0
  d.sort((a, b) => a - b)
  return { mean: total / d.length, p99: d[Math.floor(d.length * 0.99)], max: d[d.length - 1], n: d.length }
}, v)
const res = variants.map(() => ({ still: [], move: [] }))
for (let r = 0; r < 2; r++) for (let i = 0; i < pages.length; i++) {
  await pages[i].bringToFront()
  res[i].still.push(await fly(pages[i], 0))
  res[i].move.push(await fly(pages[i], speed))
}
const f = (a) => `mean ${(a.reduce((s, x) => s + x.mean, 0) / a.length).toFixed(3)}  p99 ${Math.max(...a.map((x) => x.p99)).toFixed(2)}  max ${Math.max(...a.map((x) => x.max)).toFixed(2)} ms`
variants.forEach((q, i) => console.log(`${(q || '(base)').padEnd(22)} still: ${f(res[i].still)}   moving ${speed} m/s: ${f(res[i].move)}`))
await b.close()
