// chartbake.mjs [valley,desert] — bake each world's CHART (Chart.ts: hillshade, contours, colour fields — no tracks or
// places, those are drawn over it) to public/oth/<world>/chart.webp: the map's tab for a world that isn't built yet.
// Re-run after a map is rebuilt (terrain.py / valley_cliff.py / desert.py). The dev server on :5200 (npm run dev).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const worlds = (process.argv[2] || 'valley,desert').split(',')
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=800,600', '--mute-audio'], defaultViewport: { width: 800, height: 600, deviceScaleFactor: 1 } })
const p = await b.newPage()
for (const w of worlds) {
  await p.goto(`http://localhost:5200/?world=${w}&tier=low&drive=0&sound=0&save=0&time=0`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
  const url = await p.evaluate(() => window.__oth.chartWebp())
  const file = `public/oth/${w}/chart.webp`
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'))
  console.log(file, `${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
await b.close()
