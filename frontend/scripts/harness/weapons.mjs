// THE WEAPONS (oth/Weapons.ts — docs/WEAPONS.md), solo, against the enemy (`?companion=enemy&weapons=all`): each held
// (a still of it), the pistol's shots hit him, the AK-47 fires at its tick rate (600 a minute: 2 ticks a round), the
// reload fills it, the sniper's scope steps 40° → 10° → off and its bolt holds the next shot 30 ticks, the katana's
// cuts land and its ability wakes (the fire: he burns). Screenshots: <outdir>/weapon_*.png
//   node scripts/harness/weapons.mjs <outdir>    env: PORT (5200), TIER (high), KATANA (fire | thunder)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'weaponshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`, KATANA = process.env.KATANA || 'fire'
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
await page.goto(`${BASE}/?tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed&companion=enemy&weapons=all&katana=${KATANA}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
await sleep(2500)
const key = async (c, ms = 70) => { await page.keyboard.down(c); await sleep(ms); await page.keyboard.up(c) }
const st = () => page.evaluate(() => { const o = window.__oth, a = o.arsenal, c = o.companion; return { cur: a.current, stats: { ...a.stats }, ammo: a.current ? a.ammo[a.current] : null, fov: a.scopeFov, scope: a.scope, awake: a.awake, d: +c.hero.pos.distanceTo(o.hero.pos).toFixed(2), hp: Math.round(c.hp), shotBy: { ...c.shotBy }, hisDown: c.hero.isDown, clip: o.hero.playing } })
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
await page.keyboard.down('KeyA'); await sleep(3500); await page.keyboard.up('KeyA')
// (he is held off for the stills and the counts: stunned where he stands, 4 m away)
const hold = () => page.evaluate(() => { const o = window.__oth, c = o.companion, h = o.hero; c.standAt(h.pos.x - Math.sin(h.heading) * 5, h.pos.z - Math.cos(h.heading) * 5); c.hero.stunUntil = performance.now() / 1000 + 60; c.grace = 60; c.hp = 100000 })
await hold()

// THE PISTOL
await equip('pistol'); await sleep(900)
await still('1_pistol')
await page.screenshot({ path: `${out}/weapon_1_pistol_view.png` })
await aimAtHim(); await sleep(300)
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
check(f0 === null && f1 === 40 && f2 === 10, `the scope steps off → 40° → 10° (${f0}, ${f1}, ${f2})`)
a = await st()
await key('KeyJ'); await sleep(350); await key('KeyJ'); await sleep(350)
b = await st()
check(b.stats.shots - a.stats.shots === 1, `the bolt holds the next shot (${b.stats.shots - a.stats.shots} of 2 presses in 0.7 s)`)
check((b.shotBy.sniper ?? 0) >= 1, `the sniper's bullet hits him (${b.shotBy.sniper ?? 0})`)
await sleep(1300); await key('KeyJ'); await sleep(300)
check((await st()).stats.shots - a.stats.shots === 2, 'and after 30 ticks it fires again')
await key('KeyU'); await sleep(300)
check((await st()).fov === null, 'the scope off again')
await page.evaluate(() => window.__oth.thirdPerson())

// THE KATANA: its cuts, its ability
await equip('katana'); await sleep(1400)
await page.evaluate(() => { const o = window.__oth, c = o.companion, h = o.hero; c.standAt(h.pos.x - Math.sin(h.heading) * 1.5, h.pos.z - Math.cos(h.heading) * 1.5); c.hero.stunUntil = performance.now() / 1000 + 60; c.grace = 60; c.hp = 100000 })
await sleep(400)
await still('4_katana')
a = await st()
await key('KeyJ'); await sleep(230); await still('4_katana_cut1'); await sleep(200); await key('KeyJ'); await sleep(430); await key('KeyJ'); await sleep(300); await still('4_katana_cut3'); await sleep(500)
b = await st()
console.log('katana', JSON.stringify(b))
check(b.stats.cuts - a.stats.cuts === 3, `three cuts in a run (${b.stats.cuts - a.stats.cuts})`)
check(b.stats.cutHits - a.stats.cutHits >= 2, `they cut him (${b.stats.cutHits - a.stats.cutHits})`)
await key('KeyI'); await sleep(900)
b = await st()
check(b.awake, 'the blade wakes')
await still('5_katana_awake')
await key('KeyU'); await sleep(550); await still('5_katana_heavy'); await sleep(1800)
b = await st()
console.log('awake', JSON.stringify(b))
if (KATANA === 'fire') check((b.shotBy.fire ?? 0) >= 2, `the fire blade's heavy cut: the wave and the burning (${b.shotBy.fire ?? 0} hits of fire)`)
else check((b.shotBy.thunder ?? 0) >= 1, `the thunder blade's heavy cut: the bolt (${b.shotBy.thunder ?? 0})`)
check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
