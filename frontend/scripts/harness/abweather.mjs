// abweather.mjs <tier> — the cost of the crossing's MIST and the desert's SANDSTORM: frame time with each on vs off,
// interleaved ×5 per view, uncapped 1920×1080, the slowest and fastest tenth of the frames dropped (abprops.mjs's way).
// Off = the uniform held at 0 after the frame's own write (the shaders skip the branch; the sand streaks hidden).
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 1500) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
const VIEWS = [
  // [world, weather, what, name, x, z, h, yaw, pitch]
  ['valley', 'clear', 'mist', 'gate', 1102, -1960, 2.2, 0, -0.02],
  ['valley', 'clear', 'mist', 'top_leg', 1102, -1700, 2.2, 0, -0.02],
  ['valley', 'clear', 'mist', 'leg5_out', 1076, -1640, 2.2, 1.5708, -0.15],
  ['desert', 'sandstorm', 'dust', 'plain', -300, 1100, 2, 0.3, 0.02],
  ['desert', 'sandstorm', 'dust', 'oasis', -330, 420, 3, -1.2, -0.02],
]
let loaded = ''
for (const [world, weather, what, name, x, z, h, yaw, pitch] of VIEWS) {
  const url = `http://localhost:5200/?tier=${tier}&hour=12&drive=0&dpr=fixed&time=0&world=${world}&weather=${weather}&sound=0`
  if (url !== loaded) {
    await p.goto(url, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
    await p.evaluate(() => {
      const o = window.__oth, c = o.crossing, f = c.update.bind(c), t = o.atmos.tick.bind(o.atmos)
      c.update = (...a) => { f(...a); if (window.__off === 'mist') o.atmos.uniforms.uMist.value = 0 }
      o.atmos.tick = (...a) => { t(...a); if (window.__off === 'dust') o.atmos.uniforms.uDust.value = 0 }
    })
    loaded = url
  }
  await p.evaluate(([x, z, h, yaw, pitch]) => window.__oth.view(x, z, h, yaw, pitch), [x, z, h, yaw, pitch])
  await sleep(5000)
  const lvl = await p.evaluate((w) => (w === 'mist' ? window.__oth.atmos.uniforms.uMist.value : window.__oth.atmos.uniforms.uDust.value), what)
  let on = 0, off = 0
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => (window.__off = '')); await sleep(300); on += await ft()
    await p.evaluate((w) => (window.__off = w), what); await sleep(300); off += await ft()
  }
  await p.evaluate(() => (window.__off = ''))
  const draws = await p.evaluate(() => window.__oth.stats().draws)
  console.log(`${tier.padEnd(6)} ${what} ${lvl.toFixed(2)}  ${name.padEnd(9)} on ${(on / 5).toFixed(3)} ms (${(5000 / on).toFixed(0)} fps)  off ${(off / 5).toFixed(3)} ms (${(5000 / off).toFixed(0)} fps)  cost ${((on - off) / 5).toFixed(3)} ms  ${draws} draws`)
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
