// buildcost.mjs — THE BUILDING KIT's COST (CLAUDE.md: every feature's cost per tier, uncapped 1080p, interleaved): a
// creative co-op world, a log-cabin homestead built on a flat spot (as buildtest.mjs builds it: 19 pieces — two stone
// foundations, six log walls, two roofs, a chimney, the porch and its roof, a fence and gate, a fire ring, a lamp),
// viewed from the yard as in play; the frame time with the claim's pieces drawn vs not — ABBA × ROUNDS.
//   node scripts/harness/buildcost.mjs     env: PORT (5200), TIERS (low,ultra), ROUNDS (3), WIN (2500), GARDEN (1: the plants too), FAR (1: from ~90 m)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const TIERS = (process.env.TIERS || 'low,ultra').split(','), ROUNDS = Number(process.env.ROUNDS || 3), WIN = Number(process.env.WIN || 2500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  return r.json()
}
const A = await api('POST', '/v1/players', { name: 'Asha' })
const world = await api('POST', '/v1/worlds', { name: 'Cost valley', map: 'valley', rules: { creative: true } }, A.token)
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080 },
})
let claim = null
for (const tier of TIERS) {
  const p = await (await browser.createBrowserContext()).newPage()
  await p.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: A.id, name: A.name, token: A.token })
  await p.goto(`${BASE}/?coop=${world.id}&tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.coop?.pieces?.ready, { timeout: 180000, polling: 250 })
  await p.evaluate(() => window.__oth.foot())
  await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 })
  if (!claim) {
    // (the first tier builds it: a flat spot, a flag, the cabin by the builder's snapping)
    claim = await p.evaluate(async () => {
      const o = window.__oth, p = o.hero.pos, m = o.world.map, S = o.coop.session
      let best = null
      for (let k = 0; k < 160; k++) {
        const a = k * 2.399, r = 25 + (k % 10) * 6, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r
        let lo = 1e9, hi = -1e9
        for (let i = -3; i <= 3; i++) for (let j = -2; j <= 3; j++) { const y = m.height(x + i * 2, z + j * 2); lo = Math.min(lo, y); hi = Math.max(hi, y) }
        if (m.waterAt(x, z) !== null || m.trackDist(x, z) < 14 || o.world.trees.nearest(x, z, 9)) continue
        if (!best || hi - lo < best.s) best = { x, z, s: hi - lo }
      }
      await S.ask({ t: 'claim', x: best.x, z: best.z, r: 20 })
      return [...S.claims.values()].find((c) => c.owner === S.me.id)
    })
    await p.keyboard.press('KeyB'); await sleep(1200)
    const C = 3
    const lists = [[['foundation_stone', 0, 0], ['foundation_stone', C, 0]],
      [['wall_log_door', 0, 1.2], ['wall_log_window', C, 1.2], ['wall_log_window', 0, -1.2], ['wall_log', C, -1.2], ['wall_log', -1.2, 0], ['wall_log_window', C + 1.2, 0]],
      [['roof_shingle', 0, 0], ['roof_shingle', C, 0]],
      [['chimney_stone', C + 1.95, -0.6], ['porch_deck', 0.4, 3.1], ['porch_roof', -0.3, 2.6]],
      [['fence_rail', -C, 2 * C + 1.2], ['fence_rail', 0, 2 * C + 1.2], ['fence_gate', C, 2 * C + 1.2], ['fence_rail', 2 * C, 2 * C + 1.2], ['campfire', 4.5, 5], ['lamp_post', -2.6, 4.2]],
      // (GARDEN=1: step 5's plants too — a hedge, a flower bed, a vegetable patch, saplings)
      ...(process.env.GARDEN ? [[['plant_hedge', -C, 2 * C + 3.2], ['plant_hedge', 0, 2 * C + 3.2], ['plant_hedge', C, 2 * C + 3.2], ['plant_flowers', -4.5, 5.5], ['plant_veg', 8, 4], ['plant_pine', 9.5, -3], ['plant_birch', -6, -4], ['plant_pine', 7.5, 9], ['plant_birch', -7, 10]]] : [])]
    for (const list of lists) await p.evaluate(async (list) => {
      const o = window.__oth, b = o.coop.build.builder, S = o.coop.session, m = o.world.map
      const c = [...S.claims.values()].find((x) => x.owner === S.me.id), V = o.camera.position.constructor
      for (const [kind, dx, dz] of list) {
        b.idx = b.list.findIndex((p) => p.kind === kind); b.turn = 0
        const x = c.x + dx, z = c.z + dz
        b.update(0, new V(x, m.height(x, z), z))
        const pl = b.plan
        if (pl && !pl.why) await S.ask({ t: 'place', kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, variant: 0 }).catch(() => {})
      }
    }, list)
    await p.keyboard.press('KeyB'); await sleep(1000)
  }
  await p.waitForFunction((n) => window.__oth.coop.session.pieces.size >= n, { timeout: 15000 }, process.env.GARDEN ? 28 : 19).catch(() => {})
  const n = await p.evaluate(() => window.__oth.coop.session.pieces.size)
  // the hero in his yard, the camera on the homestead (as 1_homestead.png)
  // (FAR=1: from ~90 m — the far LOD's distance)
  const K = process.env.FAR ? 4.3 : 1
  await p.evaluate(([c, K]) => window.__oth.view(c.x + 13 * K, c.z + 17 * K, 6.5 * K * 0.7, Math.atan2(13, 17), -0.2 / Math.sqrt(K)), [claim, K])
  await sleep(4000)
  const frame = (off) => p.evaluate((off, WIN) => new Promise((res) => {
    window.__oth.coop.pieces.group.visible = !off
    setTimeout(() => {
      const ts = []
      const f = (t) => { ts.push(t); if (t - ts[0] < WIN) requestAnimationFrame(f); else res((ts.at(-1) - ts[0]) / (ts.length - 1)) }
      requestAnimationFrame(f)
    }, 800)
  }), off, WIN)
  const st = async () => { await sleep(500); return p.evaluate(() => { const i = window.__oth.renderer.info; return [i.render?.calls, i.render?.triangles] }) }
  const on = [], off = []
  for (let r = 0; r < ROUNDS; r++) { on.push(await frame(false)); off.push(await frame(true)); off.push(await frame(true)); on.push(await frame(false)) }
  const sOn = await st()
  await p.evaluate(() => { window.__oth.coop.pieces.group.visible = false }); const sOff = await st()
  await p.evaluate(() => { window.__oth.coop.pieces.group.visible = true })
  console.log(`${tier.padEnd(6)} ${n} pieces: ${mean(on).toFixed(3)} ms · without: ${mean(off).toFixed(3)} ms · cost ${(mean(on) - mean(off)).toFixed(3)} ms   (${(1000 / mean(on)).toFixed(0)} vs ${(1000 / mean(off)).toFixed(0)} fps; draws ${sOn[0]} vs ${sOff[0]}, tris ${sOn[1]} vs ${sOff[1]})`)
  await p.close()
}
await browser.close()
