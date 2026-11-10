// gputime.mjs [tier] [extra] — THE GPU'S OWN CLOCK (2026-11-10): the main pass's duration by WebGPU timestamp queries
// (PlayCanvas's GPU profiler), next to the two wall-clock yardsticks — 200 frames GPU-drained (ablate.mjs's), and frames
// counted over 5 s then drained. When they disagree the wall clock is measuring the queue, not the GPU.
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis', '--disable-dawn-features=timestamp_quantization', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true)); await new Promise((r) => setTimeout(r, 3000))
const r = await p.evaluate(async () => {
  const o = window.__oth
  await o.gpuDone(); let t0 = performance.now()
  await new Promise((r) => { let n = 0; const f = () => { if (++n < 200) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  const raf200 = (performance.now() - t0) / 200; await o.gpuDone(); const drained200 = (performance.now() - t0) / 200
  await o.gpuDone(); t0 = performance.now(); let n = 0
  await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  const t1 = performance.now(); await o.gpuDone(); const t2 = performance.now()
  o.gpuTime(); const ts = []
  for (let i = 0; i < 300; i++) { await new Promise((r) => requestAnimationFrame(r)); const g = o.gpuTime(); if (g.frame) ts.push(g.frame) }
  ts.sort((a, b) => a - b)
  return { raf200, drained200, frames5s: n, raf5s: (t1 - t0) / n, drainWait: t2 - t1, drained5s: (t2 - t0) / n, gpuMedian: ts[ts.length >> 1], gpuN: ts.length, passes: o.gpuTime().passes }
})
console.log(`${tier}${extra}: 200 frames — rAF ${r.raf200.toFixed(3)} ms, drained ${r.drained200.toFixed(3)} ms | 5 s — ${r.frames5s} frames, rAF ${r.raf5s.toFixed(3)} ms, then ${r.drainWait.toFixed(0)} ms to drain → ${r.drained5s.toFixed(3)} ms | GPU's own clock ${r.gpuMedian?.toFixed(3)} ms (${r.gpuN} samples)`, JSON.stringify(r.passes).slice(0, 200))
await b.close()
