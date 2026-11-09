// placecost.mjs — THE VALLEY'S MODELLED BUILDINGS' COST (docs/MULTIPLAYER.md 4b — Buildings.ts, places.py; CLAUDE.md:
// every feature's cost per tier, uncapped 1080p, interleaved): from 18 m before each of a few places (the trapper's
// cabin, the pond cabin, the ghost house, a stone ruin, the garage), the frame time with the buildings' meshes drawn vs
// hidden — ABBA × ROUNDS. (Hidden, their glass and their yards still draw: this is the models.)
//   node scripts/harness/placecost.mjs     env: PORT (5200), TIERS (low,ultra), ROUNDS (3), WIN (2000), DIST (18 m — 100: the far LOD's)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DIST = Number(process.env.DIST || 18), TIERS = (process.env.TIERS || 'low,ultra').split(','), ROUNDS = Number(process.env.ROUNDS || 3), WIN = Number(process.env.WIN || 2000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'd3d11'}`, '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080 },
})
const p = await browser.newPage()
for (const tier of TIERS) {
  await p.goto(`http://localhost:${PORT}/?world=valley&tier=${tier}&drive=0&dpr=fixed&time=0&hour=12&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.world.landmarks?.buildings, { timeout: 180000, polling: 250 })
  const marks = await p.evaluate(() => {
    const L = window.__oth.world.landmarks.list, want = ['Trapper', 'Pond', 'Hollow House', 'Stonewall', 'Garage']
    return want.map((w) => L.find((l) => l.name.includes(w))).filter(Boolean).map((l) => ({ name: l.name, x: l.x, z: l.z, rot: l.rot ?? 0 }))
  })
  const on = [], off = []
  let st = null
  for (const m of marks) {
    const fx = Math.sin(m.rot + 0.5), fz = Math.cos(m.rot + 0.5), cx = m.x + DIST * fx, cz = m.z + DIST * fz
    await p.evaluate((q) => window.__oth.view(...q), [cx, cz, 5 + DIST * 0.08, Math.atan2(-(m.x - cx), -(m.z - cz)), -0.2])
    await sleep(2500)
    const frame = (hide) => p.evaluate((hide, WIN) => new Promise((res) => {
      for (const g of window.__oth.world.landmarks.buildings.values()) for (const lod of g.children) for (const c of lod.children) c.visible = !hide
      setTimeout(() => { const ts = []; const f = (t) => { ts.push(t); if (t - ts[0] < WIN) requestAnimationFrame(f); else res((ts.at(-1) - ts[0]) / (ts.length - 1)) }; requestAnimationFrame(f) }, 600)
    }), hide, WIN)
    for (let r = 0; r < ROUNDS; r++) { on.push(await frame(false)); off.push(await frame(true)); off.push(await frame(true)); on.push(await frame(false)) }
    if (!st) {
      const info = async (hide) => { await p.evaluate((hide) => { for (const g of window.__oth.world.landmarks.buildings.values()) for (const lod of g.children) for (const c of lod.children) c.visible = !hide }, hide); await sleep(400); return p.evaluate(() => [window.__oth.renderer.info.render?.calls, window.__oth.renderer.info.render?.triangles]) }
      st = [await info(false), await info(true), m.name]
    }
  }
  await p.evaluate(() => { for (const g of window.__oth.world.landmarks.buildings.values()) for (const lod of g.children) for (const c of lod.children) c.visible = true })
  console.log(`${tier.padEnd(6)} ${marks.length} places from ${DIST} m: ${mean(on).toFixed(3)} ms · without the models: ${mean(off).toFixed(3)} ms · cost ${(mean(on) - mean(off)).toFixed(3)} ms   (at ${st[2]}: draws ${st[0][0]} vs ${st[1][0]}, tris ${st[0][1]} vs ${st[1][1]})`)
}
await browser.close()
