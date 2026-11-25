// towtest.mjs [outDir] — THE TOW ROPE BETWEEN PLAYERS (2026-11-25, the user: "connect the grappling hook to other
// users' vehicles so that when any user is stuck we can pull them … click the button, the rope comes, the human takes
// it in his hand and goes and connects it to the other player's car … how many hooks to a car like the real world").
// Three players, each in their own browser. B's car is the stuck one (B out of it, parked). Then:
//   A presses WINCH in the car: out, to the bumper, the hook taken (hook_take) — in A's hand on every screen
//   A carries it to B's car, E at its front left: the hook clipped on (hook_attach) — on every screen, on B's car
//   C carries C's hook to the same point: refused (taken) — then onto B's rear hitch: two lines on B's car
//   A winches in: B's car is pulled toward A's — in B's own game (its physics), the others see it come
//   A unhooks (hook_detach) and hangs it back (hook_stow): gone from every screen
// Pictures of each move (A's page and B's, looking at it).
//   node scripts/harness/towtest.mjs <outdir>   env: PORT (5200), TIER (low)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'towshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}
const names = ['Asha', 'Ravi', 'Chen']
const accts = []
for (const n of names) accts.push(await api('POST', '/v1/players', { name: n }))
const world = await api('POST', '/v1/worlds', { name: 'Tow valley', map: 'valley' }, accts[0].token)
for (const a of accts.slice(1)) await api('POST', '/v1/worlds/join', { code: world.code }, a.token)
const errs = []
const browsers = []
const open = async (who) => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
  browsers.push(b)
  const page = await b.newPage()
  page.on('pageerror', (e) => { errs.push(`${who.name}: ${e.message}`); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(`${who.name}: ${m.text().slice(0, 200)}`); console.log(`[${who.name}]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=12&time=0&save=0&dpr=fixed&weaponsites=0&weather=clear`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
  return page
}
const A = await open(accts[0]), B = await open(accts[1]), C = await open(accts[2])
await sleep(6000)
const sid = async (p) => p.evaluate(() => window.__oth.coop.session.me.sid)
const sA = await sid(A), sB = await sid(B), sC = await sid(C)
const front = (p) => p.bringToFront()

// B's car is the stuck one: B gets out, it's parked
await B.evaluate(() => window.__oth.foot())
await sleep(5000)
const ropeOf = (p, who) => p.evaluate((who) => { const o = window.__oth, S = o.coop.session; if (who === S.me.sid) { const w = o.winch; return { state: w.state === 'stowed' ? 'none' : w.state, len: +w.len.toFixed(2), reel: w.reel } } const r = S.remotes.get(who)?.rope; return r ? { state: r.state, to: r.to, point: r.point, len: +r.len.toFixed(2), reel: r.reel } : { state: 'none' } }, who)
const drawn = (p) => p.evaluate(() => { const w = window.__oth.winch; return { lines: w.lines.filter((l) => l.mesh.visible).length, hooks: w.hooks.filter((m) => m.visible).length } })
const wait = async (p, f, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(f, arg)) return true; await sleep(150) } return false }
const shoot = async (p, name) => { await front(p); await sleep(250); await p.screenshot({ path: `${out}/${name}.png` }) }
// (where a car's recovery point k is, and a spot `back` m out from it — on page p, of player `who`'s car)
const spotNear = (p, who, k, back) => p.evaluate((who, k, back) => {
  const o = window.__oth, c = o.coop.remotes.towCar(who), d = c.dims, M = c.root.matrixWorld.elements
  const loc = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]
  const y = d.wheelRadius + 0.1, z = k === 2 ? d.rear - 0.06 : d.front + 0.06, x = k === 2 ? 0 : (k === 0 ? -1 : 1) * d.half.x * 0.55
  const at = loc(x, y, z), far = loc(x, y, k === 2 ? z + back : z - back)
  return { at, far, heading: Math.atan2(far[0] - at[0], far[2] - at[2]) }
}, who, k, back)

// 1. A presses WINCH in the car: out, to the bumper, takes the hook
await front(A)
await A.evaluate(() => window.__oth.winch.press())
const took = await wait(A, () => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy, null, 20000)
check(took, `A took the hook from the bumper (A: ${JSON.stringify(await ropeOf(A, sA))})`)
await sleep(800)
await shoot(A, '1-A-carrying')
// (close, from his front right: the hook in his hand)
const closeShot = async (p, name, x, y, z, h) => { await front(p); await p.evaluate((x, y, z, h) => window.__oth.spectate(x, y, z, h), x, y, z, h); await sleep(300); await p.screenshot({ path: `${out}/${name}.png` }); await p.evaluate(() => window.__oth.spectate()) }
await closeShot(A, '1b-A-carrying-close', 1.2, 1.25, -1.9, 0.95)
for (const [n, p] of [['B', B], ['C', C]]) check((await ropeOf(p, sA)).state === 'hand', `${n} sees the hook in A's hand`)
check((await drawn(B)).hooks >= 1 && (await drawn(B)).lines >= 1, `B draws A's line and hook (${JSON.stringify(await drawn(B))})`)

// 2. A carries it to B's car, E at its front left
const s0 = await spotNear(A, sB, 0, 2.0)
await A.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[2], s.heading + Math.PI), s0)
await sleep(800)
const pr = await A.evaluate(() => window.__oth.winch.prompt())
check(pr && /Ravi's car — front left/.test(pr[1]), `A by B's car: the prompt says hook on ("${pr?.join(' ')}")`)
// (a phone: the prompt is tappable — tapped, it hooks on)
await sleep(400)
const tapOk = await A.evaluate(() => { const el = document.querySelector('.oth-prompt'); return !!el && el.classList.contains('on') && el.classList.contains('tap') && getComputedStyle(el).pointerEvents === 'auto' })
check(tapOk, 'the prompt can be tapped (a phone has no E)')
const lenOut = (await ropeOf(A, sA)).len
check(lenOut > 5, `the line paid out behind A (${lenOut} m)`)
await A.evaluate(() => { const el = document.querySelector('.oth-prompt'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
await shoot(A, '2-A-walking-there')
// (the clip-on, frame by frame, from his right — and B, watching, sees A's walker play it)
await wait(A, () => window.__oth.hero.playing === 'hook_attach', null, 8000)
const seenMove = await wait(B, (sA) => window.__oth.coop.remotes.walker(sA)?.playing === 'hook_attach', sA, 6000)
check(seenMove, 'B sees A go down on a knee and clip it on (A\'s walker plays hook_attach on B\'s screen)')
await front(A)
for (let i = 0; i < 7; i++) { await A.evaluate(() => window.__oth.spectate(2.1, 1.0, -0.6, 0.6)); await sleep(30); await A.screenshot({ path: `${out}/2-attach-${i}.png` }); await sleep(270) }
await A.evaluate(() => window.__oth.spectate())
// (B looks at it: B's camera from beside A)
await B.evaluate((s) => { const o = window.__oth; o.hero.appear(s.far[0] + 3, s.far[2] + 2.5, Math.atan2(-3, -2.5)) }, s0)
const hooked = await wait(A, () => window.__oth.winch.state === 'hooked' && !window.__oth.winch.busy, null, 10000)
check(hooked, 'A hooked it on')
await sleep(2500)
for (const [n, p] of [['B', B], ['C', C]]) { const r = await ropeOf(p, sA); check(r.state === 'hooked' && r.to === sB && r.point === 0, `${n} sees A's hook on B's car, front left (${JSON.stringify(r)})`) }
await shoot(B, '3-B-sees-the-hook')

// 3. C tries the same point — refused; then B's rear hitch
const sC0 = await spotNear(C, sB, 0, 1.5)
await C.evaluate(() => window.__oth.foot())
await wait(C, () => window.__oth.onFoot && window.__oth.hero.state === 'move' && !window.__oth.hero.playing?.startsWith('car_'), null, 15000)
await sleep(800)
const dbg = (p) => p.evaluate(() => { const o = window.__oth, w = o.winch, b = w.bumperSpot(); return { state: w.state, busy: w.busy, walk: w.walk && { x: +w.walk.x.toFixed(1), z: +w.walk.z.toFixed(1), t: +w.walk.t.toFixed(1) }, playing: o.hero.playing, prog: +o.hero.progress.toFixed(2), heroState: o.hero.state, hero: [o.hero.pos.x, o.hero.pos.z].map((v) => +v.toFixed(1)), bumper: b && [b.x, b.z, b.d].map((v) => +v.toFixed(1)), steer: o.hero.steer } })
console.log('  C before:', JSON.stringify(await dbg(C)))
await C.evaluate(() => window.__oth.winch.press())
await wait(C, () => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy, null, 20000)
console.log('  C after:', JSON.stringify(await dbg(C)))
await C.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[2], s.heading + Math.PI), sC0)
await sleep(800)
const prC = await C.evaluate(() => window.__oth.winch.prompt())
check(!prC || !/front left/.test(prC[1]), `the front left is taken: C isn't offered it ("${prC?.join(' ')}")`)
// (the server says no as well — asked straight)
const refused = await C.evaluate(async (sB) => { const S = window.__oth.coop.session; try { await S.ask({ t: 'rope', state: 'hooked', to: sB, point: 0, len: 5, reel: false, x: 0, y: 0, z: 0 }); return 'accepted' } catch (e) { return String(e.message ?? e) } }, sB).catch((e) => String(e))
check(/taken/i.test(refused), `the server refuses a second hook on one point ("${refused}")`)
const sR = await spotNear(C, sB, 2, 1.5)
await C.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[2], s.heading + Math.PI), sR)
await sleep(800)
console.log('  C at the rear:', JSON.stringify(await C.evaluate(() => { const o = window.__oth, w = o.winch; return { state: w.state, busy: w.busy, prompt: w.prompt(), hero: [o.hero.pos.x, o.hero.pos.z].map((v) => +v.toFixed(1)), heroState: o.hero.state, onFoot: o.onFoot } })), JSON.stringify(sR))
await C.evaluate(() => window.__oth.winch.press())
check(await wait(C, () => window.__oth.winch.state === 'hooked' && !window.__oth.winch.busy, null, 10000), 'C hooked onto B\'s rear hitch')
await sleep(2000)
const onB = await B.evaluate((me) => [...window.__oth.coop.session.remotes.values()].filter((r) => r.rope?.state === 'hooked' && r.rope.to === me).map((r) => r.rope.point).sort(), sB)
check(onB.join(',') === '0,2', `two lines on B's car, front left and rear (${onB})`)
// C lets go of it (back to the hand, hung back is A's to show): C unhooks
await C.evaluate(() => window.__oth.winch.press())
await wait(C, () => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy, null, 10000)
// (walked off from the hitch — standing at it, E would hook it on again — and let go: wound back in)
await C.evaluate(() => { const o = window.__oth; o.hero.appear(o.hero.pos.x + 7, o.hero.pos.z + 7, o.hero.heading) })
await sleep(600)
await C.evaluate(() => window.__oth.winch.press())
check(await wait(C, () => window.__oth.winch.state === 'stowed', null, 5000), 'C let its hook go: wound back in')
await sleep(1500)

// 4. A winches in: B's car comes toward A's — in B's game
const carB = () => B.evaluate(() => { const t = window.__oth.car.sim.body.translation(); return [t.x, t.z] })
const carA = () => A.evaluate(() => { const t = window.__oth.car.sim.body.translation(); return [t.x, t.z] })
const b0 = await carB(), a0 = await carA()
const gap0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1])
// (A walks clear of the line first — back by A's car's side)
await A.evaluate(() => { const o = window.__oth, c = o.car, h = c.sim.heading, p = c.sim.body.translation(); o.hero.appear(p.x + Math.cos(h) * 3.5, p.z - Math.sin(h) * 3.5, h) })
await sleep(600)
await A.evaluate(() => window.__oth.winch.press())
check((await ropeOf(A, sA)).reel, 'A winches in')
await sleep(9000)
const b1 = await carB(), a1 = await carA()
const gap1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]), moved = Math.hypot(b1[0] - b0[0], b1[1] - b0[1])
console.log(`  gap ${gap0.toFixed(2)} → ${gap1.toFixed(2)} m; B's car moved ${moved.toFixed(2)} m; A's car ${Math.hypot(a1[0] - a0[0], a1[1] - a0[1]).toFixed(2)} m`)
check(moved > 1 && gap1 < gap0 - 1, `B's car pulled toward A's in B's own game (${moved.toFixed(2)} m, the gap ${gap0.toFixed(1)} → ${gap1.toFixed(1)} m)`)
// (what C sees of B's car agrees)
const seenC = await C.evaluate((sB) => { const c = window.__oth.coop.remotes.towCar(sB); return c ? [c.root.position.x, c.root.position.z] : null }, sB)
check(seenC && Math.hypot(seenC[0] - b1[0], seenC[1] - b1[1]) < 1.5, `C sees B's car where B's game has it (${seenC ? Math.hypot(seenC[0] - b1[0], seenC[1] - b1[1]).toFixed(2) : '?'} m off)`)
await shoot(B, '4-B-pulled')
await A.evaluate(() => { if (window.__oth.winch.reel) window.__oth.winch.press() })

// 5. A unhooks, hangs it back
const s1 = await spotNear(A, sB, 0, 1.8)
await A.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[2], s.heading + Math.PI), s1)
await sleep(700)
const prU = await A.evaluate(() => window.__oth.winch.prompt())
check((await A.evaluate(() => window.__oth.winch.label())) === 'Unhook', 'by the hook the wheel\'s button says Unhook (the phone\'s way)')
check(prU && /Unhook/.test(prU[1]), `by the hook: "${prU?.join(' ')}"`)
await A.evaluate(() => window.__oth.winch.press())
await sleep(1200)
await shoot(A, '5-A-unhooking')
check(await wait(A, () => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy, null, 10000), 'A took the hook off B\'s car')
await A.evaluate(() => { const o = window.__oth, c = o.car, M = c.root.matrixWorld.elements, z = c.model.front - 1.4; o.hero.appear(M[8] * z + M[12], M[10] * z + M[14], c.sim.heading + Math.PI) })
await sleep(700)
console.log('  A before stow:', JSON.stringify(await dbg(A)), JSON.stringify(await A.evaluate(() => window.__oth.winch.prompt())))
await A.evaluate(() => window.__oth.winch.press())
check(await wait(A, () => window.__oth.winch.state === 'stowed' && !window.__oth.winch.busy, null, 10000), 'A hung the hook back on the bumper')
await sleep(2000)
for (const [n, p] of [['B', B], ['C', C]]) check((await ropeOf(p, sA)).state === 'none', `${n}: A's line is back on its drum`)
// (every car's hook back on its own winch — drawn there, one a car — and no line out)
const left = await drawn(B)
console.log('  B at the end:', JSON.stringify(await B.evaluate(() => { const o = window.__oth, w = o.winch, S = o.coop.session; return { mine: w.state, busy: w.busy, moving: w.moving, inHand: w.inHand, lines: w.lines.filter((l) => l.mesh.visible).map((l) => [l.centre[0], l.centre[2], l.centre[l.centre.length - 3], l.centre[l.centre.length - 1]].map((v) => +v.toFixed(1))), remotes: [...S.remotes.values()].map((r) => ({ n: r.name, rope: r.rope?.state ?? 'none', playing: o.coop.remotes.walker(r.sid)?.playing ?? null })) } })))
check(left.lines === 0 && left.hooks === 3, `B draws no line now, each car's hook on its winch (${JSON.stringify(left)})`)
check(errs.length === 0, `no page errors (${errs.length}${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''})`)
for (const b of browsers) await b.close().catch(() => {})
console.log(ok ? 'tow: all good' : 'tow: FAILED')
process.exit(ok ? 0 : 1)
