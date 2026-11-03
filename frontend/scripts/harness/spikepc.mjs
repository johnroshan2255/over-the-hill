import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !/favicon/.test(m.text()) && errs.push(m.text().slice(0, 240)))
for (const q of (process.argv[2] || 'api=webgl2&msaa=4,api=webgpu&msaa=4,api=webgl2&msaa=0,api=webgpu&msaa=0,api=webgl2&load=none&msaa=4,api=webgpu&load=none&msaa=4').split(',')) {
  await p.goto(`http://localhost:5200/spike/pc.html?${q}`, { waitUntil: 'load' })
  try { await p.waitForFunction(() => window.__ms, { timeout: 60000, polling: 200 }) } catch { console.log(q, 'timeout'); continue }
  const r = await p.evaluate(() => ({ ms: window.__ms, raf: window.__rafMs, js: window.__js, info: window.__info }))
  console.log(q.padEnd(34), `GPU-drained ${r.ms.toFixed(3)} ms (${(1000 / r.ms).toFixed(0)} fps)  rAF ${r.raf.toFixed(3)} ms  js ${r.js.toFixed(3)} ms  ${JSON.stringify(r.info)}`)
  if (process.argv[3]) await p.screenshot({ path: `${process.argv[3]}/${q.replace(/[=&]/g, '_')}.png` })
}
console.log('errors:', errs.length ? [...new Set(errs)].slice(0, 8) : 'none'); await b.close()
