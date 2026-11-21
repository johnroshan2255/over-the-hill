// THE WEAPONS (oth/Weapons.ts — docs/WEAPONS.md), solo, against the enemy (`?companion=enemy&weapons=all`): each held
// (a still of it); third person's two ways — carried till the other button is held, then aimed; a shot lands where the
// middle of the screen is, and the view's kick comes back; the pistol's shots hit him, the AK-47 fires at its tick rate
// (600 a minute: 2 ticks a round), the reload fills it, the sniper's scope steps 21.5° → 5.2° → off (CS:GO's 2.75× and
// 11.4×) with the world's detail drawn for it (LodEye.ts) and its bolt holds the next shot 30 ticks.
// Screenshots: <outdir>/weapon_*.png
//   node scripts/harness/weapons.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'weaponshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text().slice(0, 200)); console.log('[console]', m.text().slice(0, 300)) } })
await page.goto(`${BASE}/?tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed&companion=enemy&weapons=all`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
await sleep(2500)
const key = async (c, ms = 70) => { await page.keyboard.down(c); await sleep(ms); await page.keyboard.up(c) }
const st = () => page.evaluate(() => { const o = window.__oth, a = o.arsenal, c = o.companion; return { cur: a.current, stats: { ...a.stats }, ammo: a.current ? a.ammo[a.current] : null, fov: a.scopeFov, scope: a.scope, d: +c.hero.pos.distanceTo(o.hero.pos).toFixed(2), hp: Math.round(c.hp), shotBy: { ...c.shotBy }, hisDown: c.hero.isDown, clip: o.hero.playing } })
const equip = (id) => page.evaluate((id) => window.__oth.arsenal.equip(id), id)
/** First person, the cross on his chest. */
const aimAtHim = () => page.evaluate(() => {
  const o = window.__oth, h = o.hero.pos, e = o.companion.hero.pos
  const dx = e.x - h.x, dz = e.z - h.z, dy = e.y + 1.25 - (h.y + 1.66)
  o.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
})
/** A still from his right side, square on (the game held for it). */
const still = async (n, side = 2.6, up = 1.4) => {
  await page.evaluate((side, up) => {
    const o = window.__oth, p = o.hero.pos, h = o.hero.heading
    const x = p.x + Math.cos(h) * side - Math.sin(h) * 0.9, z = p.z - Math.sin(h) * side - Math.cos(h) * 0.9
    o.view(x, z, up, Math.atan2(-(p.x - x), -(p.z - z)), -0.08)
  }, side, up)
  await sleep(150)
  await page.screenshot({ path: `${out}/weapon_${n}.png` })
  await page.evaluate(() => window.__oth.drive(true))
}
// out of the car, clear of it; he comes
await key('KeyF')
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
// (he is held off for the stills and the counts: stunned where he stands, 4 m away)
const hold = () => page.evaluate(() => { const o = window.__oth, c = o.companion, h = o.hero; c.standAt(h.pos.x - Math.sin(h.heading) * 5, h.pos.z - Math.cos(h.heading) * 5); c.hero.stunUntil = performance.now() / 1000 + 60; c.grace = 60; c.hp = 100000 })
// (… from the start: since 2026-11-21 he is on your bumper as you stop and out of his car as you are out of yours — on
//  you before you have walked clear of it)
await hold()
await page.keyboard.down('KeyA'); await sleep(3500); await page.keyboard.up('KeyA')
await hold()

// THE PISTOL
await equip('pistol'); await sleep(900)
await still('1_pistol')
await page.screenshot({ path: `${out}/weapon_1_pistol_view.png` })
// THIRD PERSON, GTA's: carried at his side till the other button is held — then up, he faces the view, the keys strafe
const aimSt = () => page.evaluate(() => { const o = window.__oth, a = o.arsenal; return { aiming: a.aiming, k: +a.aimK.toFixed(2), faces: o.hero.aimYaw !== null } })
await page.evaluate(() => { const o = window.__oth; o.thirdPerson(); o.footCam() }); await sleep(1600)
let v = await aimSt()
check(!v.aiming && v.k < 0.05 && !v.faces, `third person: the pistol is carried (aiming ${v.aiming}, up ${v.k})`)
await page.keyboard.down('KeyU'); await sleep(500)
v = await aimSt()
check(v.aiming && v.k > 0.95 && v.faces, `… and aimed while the other button is held (aiming ${v.aiming}, up ${v.k})`)
await page.screenshot({ path: `${out}/weapon_1_pistol_aim.png` })
// a shot lands where the middle of the screen is (the kick held off for the measure: it moves the view under it)
const land = () => page.evaluate(() => new Promise((res) => {
  const o = window.__oth, a = o.arsenal, c = o.camera, kick = a.host.kick
  a.host.kick = () => {}
  a.lastImpact.x = NaN
  const d0 = c.getWorldDirection(c.position.clone()), p0 = c.position.clone()
  a.press('fire', true)
  let n = 0
  const f = () => { if (n === 3) a.press('fire', false); if (!Number.isNaN(a.lastImpact.x) || ++n > 120) { a.press('fire', false); a.host.kick = kick; const v = a.lastImpact.clone().sub(p0), dist = v.length(); res({ ang: Number.isNaN(dist) ? 99 : +(Math.acos(Math.min(1, v.normalize().dot(d0))) * 180 / Math.PI).toFixed(2), dist: +dist.toFixed(1) }) } else requestAnimationFrame(f) }
  requestAnimationFrame(f)
}))
let hitAt = await land()
check(hitAt.ang < 0.35, `third person: the shot lands where the middle of the screen is (${hitAt.ang}° off it, ${hitAt.dist} m out)`)
await sleep(500)
// the view's kick comes back
const pitch = () => page.evaluate(() => Math.asin(window.__oth.camDir[1]) * 180 / Math.PI)
const p0 = await pitch()
await page.keyboard.down('KeyJ'); await sleep(95)
const p1 = await pitch()
await page.keyboard.up('KeyJ')
await sleep(900)
const p2 = await pitch()
check(p1 > p0 + 0.4 && Math.abs(p2 - p0) < 0.2, `the view kicks up with a shot and comes back (${p0.toFixed(2)}° → ${p1.toFixed(2)}° → ${p2.toFixed(2)}°)`)
await page.keyboard.up('KeyU'); await sleep(2200)
v = await aimSt()
check(!v.aiming && v.k < 0.1, `let go, it's carried again (up ${v.k})`)
await page.evaluate((r) => { window.__oth.arsenal.ammo.pistol = [17, 68]; void r }, 0)
await aimAtHim(); await sleep(300)
hitAt = await land()
check(hitAt.ang < 0.35, `first person: the shot lands on the cross (${hitAt.ang}° off it, ${hitAt.dist} m out)`)
await page.evaluate(() => { const o = window.__oth; o.arsenal.ammo.pistol = [17, 68]; o.companion.hp = 100000 })
await sleep(500)
let a = await st()
for (let i = 0; i < 5; i++) { await key('KeyJ'); await sleep(220); await aimAtHim() }
await sleep(400)
let b = await st()
console.log('pistol', JSON.stringify(b))
check(b.stats.shots - a.stats.shots === 5 && b.ammo[0] === 12, `the pistol fires a round a press (${b.stats.shots - a.stats.shots}; ${b.ammo[0]} left of 17)`)
check((b.shotBy.pistol ?? 0) >= 3, `its bullets hit him (${b.shotBy.pistol ?? 0} of 5)`)
await key('KeyR'); await sleep(1900)
b = await st()
check(b.ammo[0] === 17 && b.ammo[1] === 63, `reloaded: ${b.ammo[0]} + ${b.ammo[1]}`)
await page.evaluate(() => window.__oth.thirdPerson())

// THE AK-47: 600 a minute — a round every 2 ticks
await hold(); await equip('ak47'); await sleep(1000)
await still('2_ak47')
await page.screenshot({ path: `${out}/weapon_2_ak47_view.png` })
await aimAtHim(); await sleep(300)
a = await st()
await page.keyboard.down('KeyJ'); await sleep(1500); await page.keyboard.up('KeyJ'); await sleep(200)
b = await st()
const n = b.stats.shots - a.stats.shots
console.log('ak47', JSON.stringify(b))
check(n >= 13 && n <= 16, `the AK-47 holds its rate: ${n} rounds in 1.5 s (15 at 600 a minute)`)
check((b.shotBy.ak47 ?? 0) >= 1, `its bullets hit him (${b.shotBy.ak47 ?? 0})`)
await page.evaluate(() => window.__oth.thirdPerson())

// THE SNIPER: the scope's two steps, the bolt
await hold(); await equip('sniper'); await sleep(1200)
await still('3_sniper')
const f0 = (await st()).fov
await key('KeyU'); await sleep(400); const f1 = (await st()).fov
await aimAtHim(); await sleep(400)
await page.screenshot({ path: `${out}/weapon_3_scope1.png` })
await key('KeyU'); await sleep(400); const f2 = (await st()).fov
await sleep(300)
await page.screenshot({ path: `${out}/weapon_3_scope2.png` })
check(f0 === null && f1 === 21.5 && f2 === 5.2, `the scope steps off → 21.5° → 5.2° (${f0}, ${f1}, ${f2})`)
const eye = await page.evaluate(() => { const E = window.__oth.lodEye; return { on: E.on, k: +E.k.toFixed(1) } })
check(eye.on && Math.abs(eye.k - 11.4) < 0.3, `… and the world's detail is drawn for the lens (the detail's eye on, ${eye.k}×)`)
a = await st()
await key('KeyJ'); await sleep(350); await key('KeyJ'); await sleep(350)
b = await st()
check(b.stats.shots - a.stats.shots === 1, `the bolt holds the next shot (${b.stats.shots - a.stats.shots} of 2 presses in 0.7 s)`)
check((b.shotBy.sniper ?? 0) >= 1, `the sniper's bullet hits him (${b.shotBy.sniper ?? 0})`)
await sleep(1300); await key('KeyJ'); await sleep(300)
check((await st()).stats.shots - a.stats.shots === 2, 'and after 30 ticks it fires again')
await key('KeyU'); await sleep(300)
check((await st()).fov === null && !(await page.evaluate(() => window.__oth.lodEye.on)), 'the scope off again, the detail back on the camera')
await page.evaluate(() => window.__oth.thirdPerson())

check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
