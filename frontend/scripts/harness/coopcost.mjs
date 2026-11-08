// CO-OP's COST (MODE=claims: a claim in view — the flag, its stakes and rope, its edge — on vs off instead) (CLAUDE.md: every feature's cost per tier, uncapped 1080p, interleaved): two players; A stands on foot
// by its parked car (the walker + the car: what a friend costs at their busiest), B's camera on them ~12 m off. B's frame
// time with A drawn vs not (Remotes.off) — ABBA × ROUNDS, each window WIN ms after a settle.
//   node scripts/harness/coopcost.mjs     env: PORT (5200), TIERS (low,ultra), ROUNDS (3), WIN (2500)
import puppeteer from 'puppeteer-core'

const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const TIERS = (process.env.TIERS || 'low,ultra').split(','), ROUNDS = Number(process.env.ROUNDS || 3), WIN = Number(process.env.WIN || 2500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  return r.json()
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080 },
})
for (const tier of TIERS) {
  const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
  const world = await api('POST', '/v1/worlds', { name: 'Cost valley', map: 'valley' }, A.token)
  await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
  const open = async (who) => {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log(`[${who.name}]`, e.message))
    await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
    await page.goto(`${BASE}/?coop=${world.id}&tier=${tier}&hour=12&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120_000, polling: 250 })
    return page
  }
  const pa = await open(A), pb = await open(B)
  const claims = process.env.MODE === 'claims'
  if (claims) {
    // (A claims land round where it stands; B looks at the flag from 20 m)
    await pa.evaluate(() => { const p = window.__oth.car.pos; return window.__oth.coop.session.ask({ t: 'claim', x: p.x + 14, z: p.z - 10, r: 30 }) })
    await sleep(1500)
  } else {
    await pa.evaluate(() => window.__oth.foot())
    await sleep(4500)
  }
  // B's camera on A, 12 m off, a little above
  await pb.evaluate((claims) => {
    const o = window.__oth
    if (claims) { const c = o.coop.claims.list[0]; const x = c.x + 16, z = c.z + 12; o.view(x, z, 4, Math.atan2(-(c.x - x), -(c.z - z)), -0.05); return }
    const r = o.coop.remotes.list.find((x) => x.name === 'Asha')
    const a = r.heading + 2.2, x = r.x - Math.sin(a) * 12, z = r.z - Math.cos(a) * 12
    o.view(x, z, 2.5, Math.atan2(-(r.x - x), -(r.z - z)), -0.1)
  }, claims)
  await pb.bringToFront()
  await pb.evaluate((m) => { window.__MODE = m }, process.env.MODE || '')
  await sleep(2500)
  const win = (off) => pb.evaluate((off, WIN) => new Promise((res) => {
    if (window.__MODE === 'claims') window.__oth.coop.claims.group.visible = !off; else window.__oth.coop.remotes.off = off
    setTimeout(() => {
      const ts = []
      const f = (t) => { ts.push(t); if (t - ts[0] < WIN) requestAnimationFrame(f); else res((ts.at(-1) - ts[0]) / (ts.length - 1)) }
      requestAnimationFrame(f)
    }, 500)
  }), off, WIN)
  const on = [], off = []
  for (let k = 0; k < ROUNDS; k++) {
    // ABBA
    on.push(await win(false)); off.push(await win(true)); off.push(await win(true)); on.push(await win(false))
  }
  await pb.evaluate(() => { window.__oth.coop.remotes.off = false })
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
  await sleep(1500)
  const cpu = await pb.evaluate(() => ({ u: window.__oth.coop.updateMs, c: window.__oth.coop.cullMs }))
  const st = await pb.evaluate(() => window.__oth.stats())
  console.log(`        the others' CPU: posing ${cpu.u.toFixed(3)} ms, culling + tags ${cpu.c.toFixed(3)} ms`)
  console.log(`${tier.padEnd(6)} ${claims ? 'a claim in view (flag + bounds)' : 'a friend in view (walker + car)'}: ${mean(on).toFixed(3)} ms · without: ${mean(off).toFixed(3)} ms · cost ${(mean(on) - mean(off)).toFixed(3)} ms   (${(1000 / mean(on)).toFixed(0)} vs ${(1000 / mean(off)).toFixed(0)} fps; draws ${st.draws})`)
  console.log(`        on ${on.map((x) => x.toFixed(2)).join(' ')} | off ${off.map((x) => x.toFixed(2)).join(' ')}`)
  await pa.browserContext().close(); await pb.browserContext().close()
}
await browser.close()
