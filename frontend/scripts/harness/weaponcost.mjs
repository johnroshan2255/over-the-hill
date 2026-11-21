// WHAT EACH STATE COSTS A FRAME, THE WHOLE FRAME (docs/WEAPONS.md, docs/COMPANION.md): one page, on foot, taken through
// each state in turn, rep after rep (interleaved: the machine's drift falls on every state alike) — the frame GPU-drained
// (pace.mjs), the page's own JavaScript a frame, the draws and the triangles. The first state is the base the others
// are set against.
//   node scripts/harness/weaponcost.mjs [reps]     env: PORT (5200), TIER (ultra), PHONE=1 (412×915 @2.6, mobile=1),
//   Q (extra URL params), STATES (a,b,…: of fists, pistol, ak47, sniper, scope1, scope2, friend, enemy, firing)
import puppeteer from 'puppeteer-core'
import { PACE_FN } from './pace.mjs'
const reps = Number(process.argv[2] || 3)
const PORT = process.env.PORT || 5200, tier = process.env.TIER || 'ultra', phone = process.env.PHONE === '1'
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const W = phone ? 412 : 1920, H = phone ? 915 : 1080
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', `--window-size=${W},${H}`, '--mute-audio'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: phone ? 2.6 : 1, isMobile: phone, hasTouch: phone } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 300)) })
await p.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__js = 0; window.__frames = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__js += performance.now() - s; window.__frames++ })
})
await p.goto(`http://localhost:${PORT}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&weapons=all${phone ? '&mobile=1' : ''}${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
if (!(await p.evaluate(() => window.__oth.onFoot))) { console.log('never got out of the car'); await b.close(); process.exit(1) }
// (the same view in every state: a shot's kick would leave it on the sky)
await p.evaluate(() => { window.__oth.arsenal.host.kick = () => {} })
const set = (what) => p.evaluate((what) => {
  const o = window.__oth, a = o.arsenal
  const comp = what === 'friend' || what === 'enemy' ? what : null
  o.setCompanion?.(comp)
  a.press('fire', false)
  if (what === 'fists' || comp) a.equip(null)
  else if (what === 'scope1' || what === 'scope2') { a.equip('sniper'); a.scope = what === 'scope1' ? 1 : 2 }
  else if (what === 'firing') { a.equip('ak47'); a.ammo.ak47 = [9999, 0]; setTimeout(() => a.press('fire', true), 900) }
  else { a.equip(what); a.scope = 0 }
}, what)
const STATES = (process.env.STATES || 'fists,pistol,ak47,sniper,scope1,scope2,firing,friend,enemy').split(',')
const res = Object.fromEntries(STATES.map((s) => [s, { ms: [], js: [], draws: 0, tris: 0 }]))
for (let r = 0; r < reps; r++) for (const s of STATES) {
  await set(s)
  await sleep(s === 'friend' || s === 'enemy' ? 4000 : 1800)
  const j0 = await p.evaluate(() => [window.__js, window.__frames])
  const ms = await p.evaluate(PACE_FN(120, 480))
  const j1 = await p.evaluate(() => [window.__js, window.__frames])
  const st = await p.evaluate(() => { const t = window.__oth.stats(); return { draws: t.draws, tris: t.tris } })
  res[s].ms.push(ms); res[s].js.push((j1[0] - j0[0]) / Math.max(1, j1[1] - j0[1])); res[s].draws = st.draws; res[s].tris = st.tris
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const base = med(res[STATES[0]].ms), baseJs = med(res[STATES[0]].js)
console.log(`${tier}${phone ? ' phone' : ''} ${W}×${H}   state        frame ms    fps     vs ${STATES[0]}   js ms   vs      draws  tris`)
for (const s of STATES) {
  const m = med(res[s].ms), j = med(res[s].js)
  console.log(`  ${s.padEnd(10)} ${m.toFixed(3).padStart(8)} ${String(Math.round(1000 / m)).padStart(6)}   ${(m - base >= 0 ? '+' : '') + (m - base).toFixed(3)}    ${j.toFixed(3)}  ${(j - baseJs >= 0 ? '+' : '') + (j - baseJs).toFixed(3)}   ${String(res[s].draws).padStart(5)} ${(res[s].tris / 1000).toFixed(0).padStart(5)}k   [${res[s].ms.map((x) => x.toFixed(2)).join(' ')}]`)
}
await b.close()
