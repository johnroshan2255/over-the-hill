// MAKE A PLACE YOUR OWN (docs/MULTIPLAYER.md §2): two players in a co-op world. A presses B (build mode), points the
// brush at the ground ahead (the mouse), sizes it with the wheel, clicks: the flag goes up — for A and for B (the
// pole, the cloth, the stakes), on both maps and minimaps. Then the rules as a player meets them: B can't plant
// overlapping A's land (the brush says why, red); B plants its own away from it; A gives its land up (Del twice).
// Screenshots: the brush, the flag from B's side, the map with both claims, the minimap.
//   node scripts/harness/claimtest.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'claimshots'
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
const world = await api('POST', '/v1/worlds', { name: 'Flag valley', map: 'valley' }, A.token)
await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const open = async (who) => {
  const page = await (await browser.createBrowserContext()).newPage()
  page.on('pageerror', (e) => console.log(`[${who.name} pageerror]`, e.message))
  await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=10&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120_000, polling: 250 })
  return page
}
const pa = await open(A), pb = await open(B)
// (every toast each page shows, in order — a later one replaces an earlier on screen)
for (const p of [pa, pb]) await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { for (const t of document.querySelectorAll('.oth-toast')) if (window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent) }).observe(document.body, { subtree: true, childList: true, characterData: true }) })
await sleep(2000)
const toasts = (p) => p.evaluate(() => window.__toasts)
const build = (p) => p.evaluate(() => ({ on: window.__oth.coop.build.on, line: document.querySelector('.oth-build-head span')?.textContent, why: document.querySelector('.oth-build-head em')?.textContent }))

// A: build mode, the brush at the ground ahead (the cursor low in the view), bigger by the wheel
await pa.bringToFront()
await pa.keyboard.press('KeyB')
await sleep(300)
await sleep(1200) // (the builder's view: the camera up and back)
// (as a player would: the mouse moved over the ground until the brush says it's ready — clear of cars, trees, boulders)
let AIM = null
for (const [fx, fy] of [[0.3, 0.5], [0.7, 0.5], [0.3, 0.38], [0.7, 0.38], [0.5, 0.32], [0.2, 0.62], [0.8, 0.62], [0.42, 0.45], [0.58, 0.45]]) {
  await pa.mouse.move(W * fx, H * fy); await sleep(250)
  if (!(await build(pa)).why || /ready/i.test((await build(pa)).why)) { AIM = [W * fx, H * fy]; break }
}
check(!!AIM, 'the brush finds clear ground to plant on')
AIM ??= [W * 0.3, H * 0.5]
for (let k = 0; k < 4; k++) { await pa.mouse.wheel({ deltaY: -100 }); await sleep(60) }
await sleep(600)
let st = await build(pa)
console.log('A build:', JSON.stringify(st))
check(st.on, 'B: build mode on')
check(/claim land · \d+ m across/i.test(st.line ?? ''), 'the brush says what it does and its size')
await pa.screenshot({ path: `${out}/1_brush.png` })
// plant it
await pa.mouse.click(AIM[0], AIM[1])
await pa.waitForFunction(() => window.__oth.coop.session.claims.size === 1, { timeout: 8000 }).catch(() => {})
const claimA = await pa.evaluate(() => [...window.__oth.coop.session.claims.values()][0] ?? null)
check(!!claimA && claimA.owner_name === 'Asha', 'A clicked: the land is A\'s (the server took it)')
check(!(await build(pa)).on, 'build mode closes once the flag is up')
await pb.waitForFunction(() => window.__oth.coop.session.claims.size === 1, { timeout: 8000 }).catch(() => {})
check(await pb.evaluate(() => window.__oth.coop.session.claims.size === 1), 'B has A\'s land too')
check((await toasts(pb)).some((t) => /asha planted a flag/i.test(t)), 'B told: "Asha planted a flag"')
console.log('claim:', JSON.stringify({ x: claimA?.x.toFixed(1), z: claimA?.z.toFixed(1), r: claimA?.r }))

// B's view of the flag: its free camera 14 m off the pole, looking at it
await pb.bringToFront()
// (from the side the wind blows the cloth to, at an angle no tree stands in)
await pb.evaluate((c) => { const o = window.__oth; let best = 0; for (let k = 0; k < 16; k++) { const ang = (k / 16) * 6.283, x = c.x + Math.sin(ang) * 13, z = c.z + Math.cos(ang) * 13; if (o.clearLineTrees(x, z, c.x, c.z, 5)) { best = ang; break } } const x = c.x + Math.sin(best) * 13, z = c.z + Math.cos(best) * 13; o.view(x, z, 3.2, Math.atan2(-(c.x - x), -(c.z - z)), 0.1) }, claimA)
await sleep(1500)
await pb.screenshot({ path: `${out}/2_flag_from_b.png` })
await pb.evaluate((c) => { const o = window.__oth, x = c.x - c.r - 18, z = c.z + 6; o.view(x, z, 9, Math.atan2(-(c.x - x), -(c.z - z)), -0.22) }, claimA)
await sleep(1200)
await pb.screenshot({ path: `${out}/3_land_from_b.png` })
// B's map
await pb.evaluate(() => window.__oth.drive(true))
await pb.keyboard.press('Tab')
await sleep(900)
await pb.screenshot({ path: `${out}/4_map_b.png` })
for (let k = 0; k < 4; k++) { await pb.keyboard.press('Equal'); await sleep(120) }
await sleep(700)
await pb.screenshot({ path: `${out}/4b_map_b_zoomed.png` })
await pb.keyboard.press('Tab')

// B tries to plant on top of A's land: the brush says no, the click does nothing
await pb.evaluate((c) => window.__oth.coop.build.toggle(true), claimA)
await pb.evaluate((c) => { const o = window.__oth, b = o.coop.build; b.hitOk = true; b.hit.set(c.x + 5, o.height(c.x + 5, c.z), c.z); }, claimA)
const why = await pb.evaluate((c) => window.__oth.coop.build.check(c.x + 5, c.z), claimA)
check(/too close to asha's land/i.test(why) || /too far/i.test(why), `B over A's land: "${why}"`)
// (and the server says no too, whatever the brush says)
const srv = await pb.evaluate((c) => window.__oth.coop.session.ask({ t: 'claim', x: c.x + 5, z: c.z, r: 15 }).then(() => 'taken', (e) => e.message), claimA)
check(srv !== 'taken', `the server refuses it too: "${srv}"`)
await pb.evaluate(() => window.__oth.coop.build.toggle(false))
// B drives off (put 120 m on along the track) and plants its own land where it stands, well clear of A's
const bAt = await pb.evaluate(() => { const o = window.__oth, L = o.map.meta.trails.lines[0]; let d = 0, i = 0; for (; i < L.length - 1 && d < 120; i++) d += Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); o.car.placeAt(L[i][0], L[i][1], 0); return { x: L[i][0], z: L[i][1] } })
await sleep(1500)
const far = Math.hypot(bAt.x - claimA.x, bAt.z - claimA.z)
const mineB = await pb.evaluate((p) => window.__oth.coop.session.ask({ t: 'claim', x: p.x, z: p.z, r: 14 }).then(() => 'taken', (e) => e.message), bAt)
check(mineB === 'taken', `B's own land where it stands (${far.toFixed(0)} m from A's): ${mineB}`)
await sleep(800)
check(await pa.evaluate(() => window.__oth.coop.claims.list.length) === (mineB === 'taken' ? 2 : 1), 'A sees every claim')
await pa.bringToFront()
await pa.evaluate(() => window.__oth.drive(true))
await pa.keyboard.press('KeyN') // (the minimap)
await sleep(1200)
await pa.screenshot({ path: `${out}/5_minimap_a.png` })
// A gives its land up: build mode, Del twice
await pa.keyboard.press('KeyB'); await sleep(200)
await pa.keyboard.press('Delete'); await sleep(200); await pa.keyboard.press('Delete')
await pa.waitForFunction((id) => !window.__oth.coop.session.claims.has(id), { timeout: 8000 }, claimA.id).catch(() => {})
check(!(await pa.evaluate((id) => window.__oth.coop.session.claims.has(id), claimA.id)), 'A gave its land up (Del twice)')
await sleep(600)
check(!(await pb.evaluate((id) => window.__oth.coop.session.claims.has(id), claimA.id)), "and it's gone for B")
await browser.close()
console.log(ok ? 'claims: all good' : 'claims: FAILED')
process.exit(ok ? 0 : 1)
