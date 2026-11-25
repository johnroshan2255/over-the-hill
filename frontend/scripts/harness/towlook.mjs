// towlook.mjs <outDir> — THE TOW ROPE LOOKED AT, IN CO-OP (2026-11-25, the user: "the animation and the hook carried in
// the hand look really bad — it must be perfect, like real life; why does the rope go under the terrain"). Two players:
// A takes the hook, carries it, clips it onto B's car; each moment filmed close from around A (A's own page) and as B
// sees it (B's page: A's walker) — strips of frames, <out>/<phase>.png; and the rope against the ground every 10 cm
// along it (how much of it is under, the worst), on both pages.
//   node scripts/harness/towlook.mjs <outdir>   env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const out = process.argv[2] ?? 'towlook'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}
const accts = [await api('POST', '/v1/players', { name: 'Asha' }), await api('POST', '/v1/players', { name: 'Ravi' })]
const world = await api('POST', '/v1/worlds', { name: 'Look valley', map: 'valley' }, accts[0].token)
await api('POST', '/v1/worlds/join', { code: world.code }, accts[1].token)
const browsers = [], errs = []
const open = async (who) => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1000,640', '--mute-audio'], defaultViewport: { width: 1000, height: 640 } })
  browsers.push(b)
  const page = await b.newPage()
  page.on('pageerror', (e) => { errs.push(e.message); console.log(`[${who.name} pageerror]`, e.message) })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed&weaponsites=0&weather=clear`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
  return page
}
const A = await open(accts[0]), B = await open(accts[1])
await sleep(6000)
const sA = await A.evaluate(() => window.__oth.coop.session.me.sid), sB = await B.evaluate(() => window.__oth.coop.session.me.sid)
await B.evaluate(() => window.__oth.foot())
await sleep(5000)
const wait = async (p, f, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(f, arg)) return true; await sleep(120) } return false }

// THE CAMERA round a walker: (right, up, ahead) m from his feet in his own frame, looking at his body (`at` m up) —
// on A's page (A himself) or B's (A's walker there)
const camOn = (p, who, right, up, ahead, at = 0.95) => p.evaluate((who, right, up, ahead, at) => {
  const o = window.__oth, h = who === 'me' ? o.hero : o.coop.remotes.walker(who)
  if (!h) return false
  const c = Math.cos(h.heading), s = Math.sin(h.heading), P = h.pos
  const fx = -s, fz = -c, rx = c, rz = -s
  o.camAt([P.x + rx * right + fx * ahead, P.y + up, P.z + rz * right + fz * ahead, P.x, P.y + at, P.z])
  return true
}, who, right, up, ahead, at)
const W = 1000, H = 640, CROP = { x: 250, y: 40, width: 500, height: 560 }
/** A strip: n frames, every `ms`, the camera set before each (`cam()`), saved as <name>.png (a row of tiles). */
const strip = async (p, name, n, ms, cam) => {
  await p.bringToFront()
  const tiles = []
  for (let i = 0; i < n; i++) {
    await cam()
    await sleep(40)
    const f = `${out}/_${name}_${i}.png`
    await p.screenshot({ path: f, clip: CROP })
    tiles.push(f)
    await sleep(Math.max(0, ms - 90))
  }
  await p.evaluate(() => window.__oth.camAt())
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; ims=[Image.open(f).resize((250,280)) for f in fs]
out=Image.new('RGB',(250*len(ims),280))
for k,im in enumerate(ims): out.paste(im,(k*250,0))
out.save(sys.argv[1])
`, `${out}/${name}.png`, ...tiles])
  for (const f of tiles) fs.unlinkSync(f)
}
/** THE ROPE AGAINST THE GROUND: each drawn line's middle, every 10 cm along it — how much is under (cm), the worst. */
const ropeGround = (p) => p.evaluate(() => {
  const o = window.__oth, w = o.winch, map = o.world.map
  const res = []
  for (const L of w.lines) {
    if (!L.mesh.visible) continue
    const P = L.centre, n = P.length / 3
    let under = 0, samples = 0, worst = 0
    for (let i = 0; i < n - 1; i++) {
      const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], j = i + 1, bx = P[j * 3], by = P[j * 3 + 1], bz = P[j * 3 + 2]
      const len = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(len / 0.1))
      for (let t = 0; t < k; t++) {
        const f = t / k, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f
        const d = y - w.drawnGround(x, z) - 0.006
        samples++
        if (d < 0) { under++; worst = Math.min(worst, d) }
      }
    }
    res.push({ samples, under, worstCm: +(worst * 100).toFixed(1) })
  }
  return res
})

// 1. A, in the car: WINCH — out, to the bumper, the hook taken (filmed from beside the bumper, his left front)
await A.evaluate(() => window.__oth.winch.press())
await wait(A, () => window.__oth.hero.playing === 'hook_take', null, 20000)
await strip(A, '1-take', 9, 190, () => camOn(A, 'me', 1.9, 1.05, -0.5, 0.85))
await wait(A, () => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy)
await sleep(600)
// 2. standing with it: front, his right, behind, his left
console.log('eyes on A:', JSON.stringify(await A.evaluate(() => { const o = window.__oth, w = o.winch, e = w.eyes, out = []; for (let i = 0; i < e.count; i++) { const m = e.instanceMatrix.array; out.push([m[i * 16 + 12], m[i * 16 + 13] - o.world.map.height(m[i * 16 + 12], m[i * 16 + 14]), m[i * 16 + 14], m[i * 16 + 5]].map((v) => +v.toFixed(2))) } return { n: e.count, out, hero: [o.hero.pos.x, o.hero.pos.z].map((v) => +v.toFixed(1)) } })))
await A.bringToFront()
for (const [n, r, u, a] of [['front', 0.4, 1.1, 1.9], ['right', 1.9, 1.0, 0.3], ['back', 0.5, 1.2, -2.0], ['left', -1.9, 1.0, 0.3]]) await strip(A, `2-carry-stand-${n}`, 1, 100, () => camOn(A, 'me', r, u, a))
// 3. walking with it (away from his car — the line paying out): his right, then in front of him
// (along the track, away from the car's nose; Ctrl: a walk)
await A.evaluate(() => { const o = window.__oth, c = o.car, h = o.hero; h.heading = c.sim.heading })
await A.evaluate(() => window.__oth.footCam())
await A.keyboard.down('ControlLeft')
await A.keyboard.down('KeyW')
await sleep(900)
await strip(A, '3-carry-walk-right', 8, 140, () => camOn(A, 'me', 2.2, 1.0, 0.4))
await strip(A, '3-carry-walk-front', 6, 140, () => camOn(A, 'me', 0.6, 1.1, 2.6))
await strip(B, '3-carry-walk-B-sees', 8, 140, () => camOn(B, sA, 2.2, 1.0, 0.4))
await strip(A, '3-carry-hand-close', 4, 200, () => camOn(A, 'me', 1.0, 0.85, 0.25, 0.75))
await A.keyboard.up('ControlLeft')
await sleep(600)
await sleep(500)
await strip(A, '3-carry-run-right', 8, 120, () => camOn(A, 'me', 2.4, 1.0, 0.6))
await A.keyboard.up('ShiftLeft')
await sleep(1500)
await A.keyboard.up('KeyW')
await sleep(800)
// 4. the rope: from above the line, and low along it; against the ground
await A.bringToFront()
const rg = await ropeGround(A), rgB = await ropeGround(B)
console.log('rope vs ground — A:', JSON.stringify(rg), ' B:', JSON.stringify(rgB), ' len', await A.evaluate(() => window.__oth.winch.len.toFixed(1)))
const mid = await A.evaluate(() => { const o = window.__oth, M = o.car.root.matrixWorld.elements, z = o.car.model.front, h = o.hero.pos; const lx = M[8] * z + M[12], lz = M[10] * z + M[14]; return [lx, M[13], lz, h.x, h.y, h.z] })
const cx = (mid[0] + mid[3]) / 2, cz = (mid[2] + mid[5]) / 2, cy = (mid[1] + mid[4]) / 2
await strip(A, '4-rope-above', 1, 100, () => A.evaluate((c) => window.__oth.camAt(c), [cx + 6, cy + 9, cz + 6, cx, cy, cz]))
const dx = mid[3] - mid[0], dz = mid[5] - mid[2], dl = Math.hypot(dx, dz)
await strip(A, '4-rope-low', 1, 100, () => A.evaluate((c) => window.__oth.camAt(c), [mid[3] + (dx / dl) * 3 + (dz / dl) * 1.2, mid[4] + 0.5, mid[5] + (dz / dl) * 3 - (dx / dl) * 1.2, mid[0], mid[1], mid[2]]))
await strip(B, '4-rope-B-sees', 1, 100, () => B.evaluate((c) => window.__oth.camAt(c), [cx + 6, cy + 9, cz + 6, cx, cy, cz]))
// 5. onto B's car: the clip-on, from his right and as B sees it
const s0 = await A.evaluate((sB) => {
  const o = window.__oth, c = o.coop.remotes.towCar(sB), d = c.dims, M = c.root.matrixWorld.elements
  const loc = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[2] * x + M[6] * y + M[10] * z + M[14]]
  const at = loc(-d.half.x * 0.55, 0, d.front + 0.06), far = loc(-d.half.x * 0.55, 0, d.front - 2.2)
  return { far, heading: Math.atan2(far[0] - at[0], far[1] - at[1]) + Math.PI }
}, sB)
await A.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[1], s.heading), s0)
await sleep(900)
await A.evaluate(() => window.__oth.winch.press())
await wait(A, () => window.__oth.hero.playing === 'hook_attach', null, 10000)
const attach = A.evaluate(() => 0)
await Promise.all([strip(A, '5-attach-right', 9, 250, () => camOn(A, 'me', 1.8, 0.9, 0.2, 0.6)), attach])
await wait(A, () => window.__oth.winch.state === 'hooked' && !window.__oth.winch.busy)
await sleep(800)
await strip(A, '5-hooked-close', 1, 100, () => camOn(A, 'me', 0.9, 0.8, 0.9, 0.5))
await strip(B, '5-hooked-B-sees', 1, 100, () => camOn(B, sA, 1.6, 1.0, 1.2, 0.5))
// (the hook on B's car close: from out before the point and to one side)
const pt = await A.evaluate((sB) => { const o = window.__oth, c = o.coop.remotes.towCar(sB), d = c.dims, M = c.root.matrixWorld.elements
  const loc = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]
  const y = d.wheelRadius + 0.1, x = -d.half.x * 0.55
  return { at: loc(x, y, d.front), cam: loc(x - 0.7, y + 0.35, d.front - 1.0) } }, sB)
await A.evaluate(() => { const o = window.__oth; o.hero.appear(o.hero.pos.x + 4, o.hero.pos.z + 4, o.hero.heading) })
await sleep(500)
await strip(A, '5-hook-on-point', 1, 100, () => A.evaluate((c) => window.__oth.camAt(c), [...pt.cam, ...pt.at]))
await A.evaluate((s) => window.__oth.hero.appear(s.far[0], s.far[1], s.heading), s0)
await sleep(700)
console.log('rope vs ground hooked — A:', JSON.stringify(await ropeGround(A)), ' B:', JSON.stringify(await ropeGround(B)))
// 6. off again and hung back (B watches the detach)
await A.evaluate(() => window.__oth.winch.press())
await wait(B, (sA) => window.__oth.coop.remotes.walker(sA)?.playing === 'hook_detach', sA, 8000)
await strip(B, '6-detach-B-sees', 8, 250, () => camOn(B, sA, 1.8, 0.9, 0.2, 0.6))
console.log(errs.length ? `page errors: ${errs.slice(0, 3).join(' | ')}` : 'no page errors')
for (const b of browsers) await b.close().catch(() => {})
