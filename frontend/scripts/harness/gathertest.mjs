// GATHERING ON FOOT (docs/MULTIPLAYER.md step 2 — oth/Gather.ts): two players in a co-op world. A gets out, walks up to
// a tree and chops it — three swings, E each — and it FALLS (for A and for B), a stump left, its logs where it lands;
// A picks them up (in his arms, the HUD says so), plants a flag and stocks them — B sees the stockpile; A mines a
// boulder (a stone in his hands) and puts it down (H) — B sees the pile.
// Screenshots: the swing, the fall, the logs, carrying, the stockpile, mining.
//   node scripts/harness/gathertest.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'gathershots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  return r.json()
}
const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
const world = await api('POST', '/v1/worlds', { name: 'Wood valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const errs = []
const open = async (who) => {
  const page = await (await browser.createBrowserContext()).newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=10&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop && window.__oth.gather, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
for (const p of [pa, pb]) await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { for (const t of document.querySelectorAll('.oth-toast')) if (window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent) }).observe(document.body, { subtree: true, childList: true, characterData: true }) })
await sleep(1500)
await pa.bringToFront()
// A out of the car
await pa.evaluate(() => window.__oth.foot())
await pa.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 })
await sleep(1000)
// A to the nearest tall tree, 1.5 m off it, facing it (as if walked there)
const tree = await pa.evaluate(() => {
  const o = window.__oth, p = o.hero.pos, t = o.world.trees
  // (a lone broadleaf — a birch or an aspen, its crown high, no other tree within 7 m: the shots see him, not branches)
  let i = -1, bd = 1e18
  const d = t.data, S = 8
  for (let k = 0; k < t.count; k++) {
    const o = k * S, dd = (d[o] - p.x) ** 2 + (d[o + 2] - p.z) ** 2
    if (dd > 400 * 400 || dd >= bd || d[o + 5] < 3 || d[o + 3] < 6) continue
    let lone = true
    for (let q = 0; q < t.count && lone; q++) if (q !== k && (d[q * S] - d[o]) ** 2 + (d[q * S + 2] - d[o + 2]) ** 2 < 49) lone = false
    if (lone) { bd = dd; i = k }
  }
  if (i < 0) i = t.nearestIndex(p.x, p.z, 120, 6)
  const T = t.treeAt(i), dx = p.x - T.x, dz = p.z - T.z, L = Math.hypot(dx, dz) || 1
  const x = T.x + (dx / L) * 1.5, z = T.z + (dz / L) * 1.5
  o.hero.appear(x, z, Math.atan2(-(T.x - x), -(T.z - z)))
  return { i, ...T }
})
console.log('tree:', JSON.stringify(tree))
await sleep(1500)
const prompt = (p) => p.evaluate(() => window.__oth.gather.prompt?.join(' ') ?? '')
check(/^E Chop/.test(await prompt(pa)), `A beside a tree: the prompt says chop ("${await prompt(pa)}")`)
// three swings — the first seen close (the free camera for the shot, then back to play: E acts only in play)
const shotView = (p, f) => p.evaluate(f)
for (let k = 0; k < 3; k++) {
  await pa.keyboard.press('KeyE')
  if (k === 0) {
    await sleep(560)
    // (from behind him and to the side — away from the tree, out of its branches)
    await shotView(pa, () => { const o = window.__oth, h = o.hero, fx = -Math.sin(h.heading), fz = -Math.cos(h.heading), x = h.pos.x - fx * 2.6 + fz * 1.8, z = h.pos.z - fz * 2.6 - fx * 1.8; o.view(x, z, 1.4, Math.atan2(-(h.pos.x + fx * 0.6 - x), -(h.pos.z + fz * 0.6 - z)), -0.02) })
    await sleep(250)
    await pa.screenshot({ path: `${out}/1_swing.png` })
    await pa.evaluate(() => window.__oth.drive(true))
  }
  if (k === 2) break
  await pa.waitForFunction(() => window.__oth.hero.state === 'move' && !window.__oth.gather.busy, { timeout: 8000, polling: 100 }).catch(() => {})
  await sleep(150)
}
// the fall, from the side of its path
await pa.waitForFunction((i) => window.__oth.coop.session.stumps.has(i), { timeout: 8000, polling: 50 }, tree.i).catch(() => {})
await pa.evaluate((t) => {
  const o = window.__oth, h = o.hero, fx = t.x - h.pos.x, fz = t.z - h.pos.z, L = Math.hypot(fx, fz) || 1, ux = fx / L, uz = fz / L
  const cx = t.x - uz * 26 + ux * 8, cz = t.z + ux * 26 + uz * 8, tx = t.x + ux * 9, tz = t.z + uz * 9
  o.view(cx, cz, 4, Math.atan2(-(tx - cx), -(tz - cz)), 0.06)
}, tree)
for (const [ms, nm] of [[700, '2_falling_a'], [800, '2_falling_b'], [1100, '2_falling_c']]) { await sleep(ms); await pa.screenshot({ path: `${out}/${nm}.png` }) }
const felled = (p) => p.evaluate((i) => window.__oth.coop.session.stumps.has(i) && window.__oth.world.trees.gone.has(i), tree.i)
check(await felled(pa), 'three swings: the tree is down for A')
await pb.waitForFunction((i) => window.__oth.coop.session.stumps.has(i), { timeout: 5000 }, tree.i).catch(() => {})
check(await felled(pb), 'and for B (hidden there too)')
await sleep(1600)
await pa.evaluate((t) => { const o = window.__oth, h = o.hero, a = Math.atan2(h.pos.x - t.x, h.pos.z - t.z) + 0.9, x = t.x + Math.sin(a) * 4.5, z = t.z + Math.cos(a) * 4.5; o.view(x, z, 2.2, Math.atan2(-(t.x - x), -(t.z - z)), -0.35) }, tree)
await sleep(700)
await pa.screenshot({ path: `${out}/3_logs.png` })
await pa.evaluate(() => window.__oth.drive(true))
await sleep(500)
const drops = (p) => p.evaluate(() => [...window.__oth.coop.session.drops.values()])
const d0 = await drops(pa)
check(d0.some((d) => d.mat === 'wood' && Math.hypot(d.x - tree.x, d.z - tree.z) < 1), `its logs lie where it stood (${d0.map((d) => `${d.qty} ${d.mat}`).join(', ')})`)
// pick them up
check(/^E Pick up \d+ wood/.test(await prompt(pa)), `beside the logs: "${await prompt(pa)}"`)
await pa.keyboard.press('KeyE')
await pa.waitForFunction(() => window.__oth.coop.session.inv.carry.wood > 0, { timeout: 8000, polling: 100 }).catch(() => {})
const inv = await pa.evaluate(() => window.__oth.coop.session.inv.carry)
check(inv.wood > 0, `A carries ${inv.wood} wood`)
check(await pa.evaluate(() => window.__oth.hero.holding && document.querySelector('.oth-hands.on')?.textContent.includes('wood')), 'he holds them (the carry pose) and the HUD says so')
await sleep(1200)
// walk a few steps carrying
await pa.keyboard.down('KeyW'); await pa.keyboard.down('ControlLeft'); await sleep(1200)
await pa.screenshot({ path: `${out}/4_carrying.png` })
await pa.keyboard.up('KeyW'); await pa.keyboard.up('ControlLeft'); await sleep(600)
// a flag here (the server's claim), then to its stockpile and stock them
const claim = await pa.evaluate(async () => {
  const o = window.__oth, p = o.hero.pos, S = o.coop.session
  for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [10, 10], [-10, -10]]) {
    try { await S.ask({ t: 'claim', x: p.x + dx, z: p.z + dz, r: 14 }); break } catch (e) { /* (a tree, the track…) try another */ }
  }
  return [...S.claims.values()].find((c) => c.owner === S.me.id) ?? null
})
check(!!claim, 'A has land')
if (claim) {
  await pa.evaluate((c) => { const o = window.__oth; o.hero.appear(c.x + 3.2 - 1.4, c.z + 1.6 + 1.4, Math.atan2(1.4, -1.4)) }, claim)
  await sleep(1200)
  check(/^E Stock \d+ wood/.test(await prompt(pa)), `at the stockpile: "${await prompt(pa)}"`)
  await pa.keyboard.press('KeyE')
  await pb.waitForFunction(() => [...window.__oth.coop.session.claims.values()].some((c) => c.stock.wood > 0), { timeout: 8000, polling: 100 }).catch(() => {})
  const st = await pb.evaluate(() => [...window.__oth.coop.session.claims.values()].map((c) => c.stock.wood))
  check(st.some((w) => w > 0), `B sees A's stockpile: ${st.join(', ')} wood`)
  await pa.waitForFunction(() => window.__oth.coop.session.inv.carry.wood === 0, { timeout: 5000, polling: 100 }).catch(() => {})
  check(await pa.evaluate(() => window.__oth.coop.session.inv.carry.wood === 0), `A's hands empty again (${JSON.stringify(await pa.evaluate(() => window.__oth.coop.session.inv.carry))})`)
  await sleep(1000)
  await pa.evaluate((c) => { window.__oth.view(c.x + 3.2 + 5, c.z + 1.6 + 4, 2.6, Math.atan2(5, 4), -0.22) }, claim)
  await sleep(1200)
  await pa.screenshot({ path: `${out}/5_stockpile.png` })
  await pa.evaluate(() => window.__oth.drive(true))
}
// a boulder: mine it, put the stone down
const rock = await pa.evaluate(() => {
  const o = window.__oth, p = o.hero.pos
  for (const R of [30, 60, 120, 240, 480]) {
    const r = o.world.rocks.nearestBoulder(p.x, p.z, R)
    if (r) {
      const k = r.rock, dx = p.x - k.x, dz = p.z - k.z, L = Math.hypot(dx, dz) || 1, d = k.s * 0.85 + 0.8
      o.hero.appear(k.x + (dx / L) * d, k.z + (dz / L) * d, Math.atan2(dx / L, dz / L))
      return { i: r.i, x: k.x, z: k.z, s: k.s }
    }
  }
  return null
})
console.log('rock:', JSON.stringify(rock))
check(!!rock, 'a boulder found')
if (rock) {
  await sleep(1500)
  check(/^E Mine/.test(await prompt(pa)), `beside it: "${await prompt(pa)}"`)
  await pa.keyboard.press('KeyE')
  await sleep(800)
  await pa.screenshot({ path: `${out}/6_mining.png` })
  await pa.waitForFunction(() => window.__oth.coop.session.inv.carry.stone > 0, { timeout: 8000, polling: 100 }).catch(() => {})
  check(await pa.evaluate(() => window.__oth.coop.session.inv.carry.stone === 1), 'a stone in his hands')
  await pa.waitForFunction(() => window.__oth.hero.state === 'move', { timeout: 8000, polling: 100 }).catch(() => {})
  const before = (await drops(pb)).length
  await sleep(300)
  await pa.keyboard.press('KeyH')
  await pb.waitForFunction((n) => window.__oth.coop.session.drops.size > n, { timeout: 8000, polling: 100 }, before).catch(() => {})
  check((await drops(pb)).some((d) => d.mat === 'stone'), 'H: put down — B sees the stone on the ground')
}
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none')
check(!errs.length, 'no page errors')
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
