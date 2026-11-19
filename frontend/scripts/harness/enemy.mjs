// THE ENEMY (oth/Companion.ts, `?companion=enemy` — SETTINGS › PLAY › Companion: Enemy): solo play started in the car —
// he takes his own car and RAMS yours as you drive; you stop and get out — he drives at you or gets out, closes in and
// FIGHTS (fight.glb's clips: his blows land, you stagger and go down); you hit back (J punch, U kick) till he goes
// down. Screenshots: <outdir>/enemy_*.png
//   node scripts/harness/enemy.mjs <outdir>    env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'enemyshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message) })
page.on('console', (m) => { if (m.type() === 'error') { errs.push(m.text().slice(0, 200)); console.log('[console]', m.text().slice(0, 300)) } })
await page.goto(`${BASE}/?tier=${process.env.TIER || 'high'}&hour=11&time=0&save=0&dpr=fixed&companion=enemy`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
await sleep(3000)

const look = () => page.evaluate(() => {
  const o = window.__oth, c = o.companion, l = c.list[0], y = o.youPos()
  return { mode: c.mode, kind: c.kind, onFoot: o.onFoot, d: l ? +Math.hypot(l.x - y.x, l.z - y.z).toFixed(1) : -1, rams: c.rams, hp: Math.round(c.hp), yours: Math.round(c.yours), landed: { ...c.landed }, hisClip: c.hero.playing, yourClip: o.hero.playing, hisDown: c.hero.isDown, youDown: o.hero.isDown, kmh: Math.round(o.speedKmh?.() ?? 0) }
})
const until = async (f, s = 20) => { for (let i = 0; i < s * 4; i++) { const l = await look(); if (f(l)) return l; await sleep(250) } return look() }
const key = async (code, ms = 100) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code) }
const hold = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await sleep(ms); for (const c of codes) await page.keyboard.up(c) }
const shot = (n) => page.screenshot({ path: `${out}/enemy_${n}.png` })
const aside = async (n, side, back, up) => {
  await page.evaluate((side, back, up) => {
    const o = window.__oth, y = o.youPos(), h = o.youHeading()
    const x = y.x + Math.sin(h) * back + Math.cos(h) * side, z = y.z + Math.cos(h) * back - Math.sin(h) * side
    o.view(x, z, up, Math.atan2(-(y.x - x), -(y.z - z)), -0.12)
  }, side, back, up)
  await sleep(700)
  await shot(n)
  await page.evaluate(() => window.__oth.drive(true))
  await sleep(200)
}

let s = await look()
console.log('start', JSON.stringify(s))
check(s.kind === 'enemy' && s.mode !== 'passenger', 'the enemy never rides with you')
s = await until((l) => l.mode === 'car', 25)
check(s.mode === 'car', `he takes his own car (${s.mode})`)

// drive on: he catches you and rams
await page.keyboard.down('KeyW')
let rammedAt = null
for (let i = 0; i < 80; i++) { await sleep(250); s = await look(); if (s.rams > 0 && !rammedAt) { rammedAt = s; await shot('1_rammed'); break } }
await page.keyboard.up('KeyW')
console.log('driving', JSON.stringify(s))
check(s.rams > 0, `he rams your car (${s.rams})`)
await aside('2_ram_above', 6, 16, 7)

// stop and get out: he drives at you or gets out — then it's on foot
await hold(['KeyS'], 2500); await sleep(1500)
// (F again till you're out: a ram sets the car rolling, and it must stand to open the door)
for (let i = 0; i < 25 && !(await look()).onFoot; i++) { await key('KeyF'); await sleep(1000) }
s = await until((l) => l.onFoot && l.mode === 'foot', 40)
console.log('on foot', JSON.stringify(s))
check(s.onFoot && s.mode === 'foot', 'both on foot')
s = await until((l) => l.d >= 0 && l.d < 1.6 && !l.youDown, 40)
check(s.d < 1.6, `he closes in (${s.d} m)`)
await sleep(600)
await aside('3_fight', 3.2, -1.2, 1.5)
s = await until((l) => l.landed.him > 0, 25)
console.log('his blows', JSON.stringify(s))
check(s.landed.him > 0 && s.yours < 100, `his blows land (${s.landed.him}; you ${s.yours})`)
await aside('4_hit', 3.2, -1.2, 1.5)

// hit back: J J U … till he goes down
let sawDown = false, sawYouDown = false, n = 0
for (let i = 0; i < 140 && !sawDown; i++) {
  await key(i % 4 === 3 ? 'KeyU' : 'KeyJ', 60)
  await sleep(330)
  s = await look()
  sawDown ||= s.hisDown; sawYouDown ||= s.youDown
  if (s.landed.you > n) { n = s.landed.you; if (n === 2) await aside('5_your_blow', 3.2, -1.2, 1.5) }
}
console.log('after hitting back', JSON.stringify(s), 'you went down:', sawYouDown)
check(s.landed.you > 0, `your blows land (${s.landed.you})`)
check(sawDown, 'he goes down')
await sleep(500)
await aside('6_he_is_down', 3.4, -1.5, 1.6)
s = await until((l) => !l.hisDown, 15)
check(!s.hisDown, 'he gets up again')
check(errs.length === 0, `no page errors (${errs.length})`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
