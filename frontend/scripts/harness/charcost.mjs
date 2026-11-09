// charcost.mjs — THE CHARACTER's COST (CLAUDE.md: every feature's cost per tier, uncapped 1080p, interleaved): out of the
// car on foot, the chase camera behind him as in play; the frame time with his mesh drawn vs not — ABBA × ROUNDS, each
// window WIN ms after a settle. (His posing runs either way: this is the draw.)
//   node scripts/harness/charcost.mjs     env: PORT (5200), TIERS (low,ultra), ROUNDS (3), WIN (2500)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const TIERS = (process.env.TIERS || 'low,ultra').split(','), ROUNDS = Number(process.env.ROUNDS || 3), WIN = Number(process.env.WIN || 2500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080 },
})
const p = await browser.newPage()
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
for (const tier of TIERS) {
  await p.goto(`http://localhost:${PORT}/?tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&sound=0`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
  await sleep(1500)
  await p.evaluate(() => window.__oth.foot())
  await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 }).catch(() => {})
  await sleep(3000)
  const frame = (off) => p.evaluate((off, WIN) => new Promise((res) => {
    window.__oth.hero.mesh.visible = !off
    setTimeout(() => {
      const ts = []
      const f = (t) => { ts.push(t); if (t - ts[0] < WIN) requestAnimationFrame(f); else res((ts.at(-1) - ts[0]) / (ts.length - 1)) }
      requestAnimationFrame(f)
    }, 800)
  }), off, WIN)
  const on = [], off = []
  for (let r = 0; r < ROUNDS; r++) { on.push(await frame(false)); off.push(await frame(true)); off.push(await frame(true)); on.push(await frame(false)) }
  await p.evaluate(() => { window.__oth.hero.mesh.visible = true })
  const st = await p.evaluate(() => { const i = window.__oth.renderer.info; return { draws: i.render?.calls, tris: i.render?.triangles } })
  console.log(`${tier.padEnd(6)} the character on foot: ${mean(on).toFixed(3)} ms · without: ${mean(off).toFixed(3)} ms · cost ${(mean(on) - mean(off)).toFixed(3)} ms   (${(1000 / mean(on)).toFixed(0)} vs ${(1000 / mean(off)).toFixed(0)} fps; draws ${st.draws}, tris ${st.tris})`)
}
await browser.close()
