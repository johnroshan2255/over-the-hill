// gpuclass.mjs [extra URL params] — what the game makes of this machine's GPU (docs/PERF.md "Chromebooks"): the GPU's
// name, whether it's drawn the weak GPU's way (quality.ts), the backend, the tier, MSAA, the pixel ratio and the
// adaptive resolution's share. A Chromebook's own answer: run the game there with ?stats=1, or chrome://inspect.
//   node scripts/harness/gpuclass.mjs            node scripts/harness/gpuclass.mjs gpu=weak
import puppeteer from 'puppeteer-core'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log(`page error: ${e.message.slice(0, 200)}`))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?play=1&hour=12&sound=0&save=0&time=0${process.argv[2] ? `&${process.argv[2]}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready, { timeout: 120000 })
console.log(await p.evaluate(async () => {
  const { gpuName } = await import('/src/rendering/quality/DeviceProfile.ts')
  const o = window.__oth, c = document.querySelector('canvas')
  return { gpu: gpuName(), weakGpu: o.weakGpu, backend: o.backend, tier: o.tier, canvas: `${c.width}×${c.height}`, dprScale: o.dprScale, samples: o.samples }
}))
await b.close()
