import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
for (const q of ['aa=1&dc=1&draws=40', 'aa=1&dc=1&draws=40&u=0', 'aa=1&dc=1&draws=200&u=0', 'aa=1&dc=1&draws=200']) {
  await p.goto(`http://localhost:5200/spike/floor2.html?${q}`, { waitUntil: 'load' }); await p.waitForFunction(() => window.__ms, { timeout: 20000 })
  const ms = await p.evaluate(() => window.__ms); console.log(q.padEnd(22), `${ms.toFixed(3)} ms (${(1000 / ms).toFixed(0)} fps)`)
}
await b.close()
