// THE WEAPONS IN THE RUINS and THE WHEEL (oth/Weapons.ts Pickups, oth/Wheel.ts — docs/WEAPONS.md): the ruins nearest
// the start each hold a weapon; near one it's drawn and marked on the map; E takes it — yours, in your hands; the
// wheel's second mode (the small button under the ring, key 2) shows what you've found and a sector equips it.
// Screenshots: <outdir>/pickup_*.png
//   node scripts/harness/pickups.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'pickupshots'
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
await page.goto(`${BASE}/?tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
await sleep(2500)
const key = async (c, ms = 80) => { await page.keyboard.down(c); await sleep(ms); await page.keyboard.up(c) }
const sites = await page.evaluate(() => window.__oth.pickups.sites.map((s) => ({ weapon: s.weapon, katana: s.katana, place: s.place, x: Math.round(s.x), z: Math.round(s.z) })))
console.log('sites:', sites.map((s) => `${s.weapon}${s.katana ? ':' + s.katana : ''} @ ${s.place} (${s.x}, ${s.z})`).join(' · '))
check(sites.length >= 5 && sites[0].weapon === 'pistol', `the ruins hold the weapons (${sites.length}; the nearest: the ${sites[0]?.weapon})`)
check((await page.evaluate(() => window.__oth.companion)) === null, 'no companion unless the setting asks for one')
// the car put by the nearest; out; the walker put 6 m from it
await page.evaluate(() => { const o = window.__oth, s = o.pickups.sites[0]; o.car.sim.place(s.x + 9, o.height(s.x + 9, s.z + 4) + 0.9, s.z + 4, 0) })
await sleep(1500)
await key('KeyF')
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
await page.evaluate(() => { const o = window.__oth, s = o.pickups.sites[0]; o.hero.appear(s.x - 5, s.z + 1, -Math.PI / 2); o.footCam() })
await sleep(1800)
await page.screenshot({ path: `${out}/pickup_1_lying.png` })
let st = await page.evaluate(() => { const o = window.__oth, s = o.pickups.sites[0]; return { seen: s.seen, y: s.y, marks: o.pickups.marks().length, owned: [...o.arsenal.owned] } })
check(st.seen && st.marks === sites.length, `every site is marked for the map (${st.marks})`)
check(st.owned.length === 0, 'nothing is yours yet')
await page.evaluate(() => { const o = window.__oth, s = o.pickups.sites[0]; o.hero.appear(s.x - 1.6, s.z, -Math.PI / 2); o.footCam() })
await sleep(900)
await page.screenshot({ path: `${out}/pickup_2_prompt.png` })
await key('KeyE'); await sleep(1300)
st = await page.evaluate(() => { const o = window.__oth; return { owned: [...o.arsenal.owned], cur: o.arsenal.current, ammo: o.arsenal.ammo.pistol } })
check(st.owned.includes('pistol') && st.cur === 'pistol' && st.ammo?.[0] === 17, `E takes it: yours, loaded, in your hands (${JSON.stringify(st)})`)
await page.screenshot({ path: `${out}/pickup_3_taken.png` })
// the wheel: its second mode
await key('KeyQ'); await sleep(500)
await page.screenshot({ path: `${out}/pickup_4_wheel_actions.png` })
await key('Digit2'); await sleep(400)
await page.screenshot({ path: `${out}/pickup_5_wheel_weapons.png` })
const labels = await page.evaluate(() => [...document.querySelectorAll('.oth-wheel .sec text')].map((t) => t.textContent))
check(labels.includes('FISTS') && labels.includes('PISTOL'), `the wheel shows what you've found (${labels.join(', ')})`)
// (a sector picked: the fists)
const box = await page.evaluate(() => { const r = document.querySelector('.oth-wheel svg').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 } })
await page.mouse.move(box.cx, box.cy - box.R * 0.7); await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(400)
st = await page.evaluate(() => ({ cur: window.__oth.arsenal.current, open: document.body.classList.contains('oth-wheel-open') }))
check(st.cur === null && !st.open, `a sector puts that one in your hands (now: ${st.cur ?? 'fists'})`)
// the map
await key('Tab'); await sleep(1200)
await page.screenshot({ path: `${out}/pickup_6_map.png` })
check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
