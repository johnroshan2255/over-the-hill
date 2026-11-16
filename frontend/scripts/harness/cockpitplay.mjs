// cockpitplay.mjs <outDir> <car,car,…> [extra] — PLAY THE COCKPIT (docs/NEXT_garage.md §3.2): first person, driven with
// the keys — W from rest through the shifts (frames while the hand goes to the knob and back), Space (the handbrake),
// S to a stop and into reverse, Z / X on a manual; then the same car at night, the lamps on. Logs the lever's state and
// the hand's reach every ~60 ms; a PNG at each moment worth looking at.
//   node scripts/harness/cockpitplay.mjs vg/ck forty,bronc,sierra          env PORT (5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out, cars = 'forty', extra = ''] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const W = 1280, H = 720
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = (p) => p.evaluate(() => { const c = window.__oth.car, D = c.sim.drivetrain, a = c.anim
  return { t: +(performance.now() / 1000).toFixed(2), v: +(c.sim.speed * 3.6).toFixed(0), g: D?.gear, sel: D?.selector, sh: D?.shifting, at: a?.at?.map((x) => +x.toFixed(2)), k: +(c.shiftGrip?.k ?? 0).toFixed(2), low: D?.lowRange } })
async function open(id, q) {
  const p = await b.newPage(), errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&dpr=fixed&time=0&weather=clear&sound=0&save=0&car=${id}&${q}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
  await p.evaluate(() => window.__oth.drive(true)); await sleep(2500)
  await p.keyboard.press('KeyV'); await sleep(1200)
  return { p, errs }
}
for (const id of cars.split(',')) {
  const { p, errs } = await open(id, 'hour=13')
  await p.screenshot({ path: `${out}/${id}_0rest.png` })
  // DRIVE OFF: W held ~6 s; the log on every change; a frame each 60 ms while the hand is on its way or on the knob
  const log = []; let last = '', shots = 0, t0 = Date.now()
  await p.keyboard.down('KeyW')
  while (Date.now() - t0 < 6500) {
    const s = await state(p)
    const key = `${s.g}/${s.sel}/${s.at}/${s.k > 0.05}`
    if (key !== last) { log.push(JSON.stringify(s)); last = key }
    if (s.k > 0.05 && shots < 10) await p.screenshot({ path: `${out}/${id}_1shift${String(shots++).padStart(2, '0')}_k${s.k}.png` })
    else await sleep(60)
  }
  await p.keyboard.up('KeyW')
  await p.screenshot({ path: `${out}/${id}_2speed.png` })
  // THE HANDBRAKE: Space held to a stop
  await p.keyboard.down('Space'); await sleep(2500); log.push('handbrake ' + JSON.stringify(await state(p)))
  await p.screenshot({ path: `${out}/${id}_3handbrake.png` })
  await p.keyboard.up('Space'); await sleep(400)
  // REVERSE: S held (an automatic goes R past a stop; a manual: the box into R)
  await p.keyboard.down('KeyS'); last = ''
  for (let i = 0; i < 40; i++) { const s = await state(p); const key = `${s.g}/${s.sel}/${s.at}`; if (key !== last) { log.push('S ' + JSON.stringify(s)); last = key } await sleep(70) }
  await p.screenshot({ path: `${out}/${id}_4reverse.png` })
  await p.keyboard.up('KeyS'); await sleep(300)
  // LOW RANGE: the drivetrain's own toggle (the game has no key for it — logged)
  await p.keyboard.down('Space'); await sleep(1500)
  const low = await p.evaluate(() => { const c = window.__oth.car, D = c.sim.drivetrain; return D?.toggleLow ? D.toggleLow(c.sim.speed) : 'none' })
  await sleep(1200); log.push(`low ${low} ` + JSON.stringify(await state(p)))
  await p.screenshot({ path: `${out}/${id}_5low.png` })
  await p.keyboard.up('Space')
  console.log(`== ${id}\n` + log.join('\n'))
  console.log('errors:', errs.length ? [...new Set(errs)].join(' | ') : 'none')
  await p.close()
  // NIGHT: the lamps on (L cycles auto → off → on; auto at night is on)
  const n = await open(id, 'hour=22')
  await n.p.screenshot({ path: `${out}/${id}_6night.png` })
  await n.p.keyboard.down('KeyW'); await sleep(2500); await n.p.keyboard.up('KeyW')
  await n.p.screenshot({ path: `${out}/${id}_7nightdrive.png` })
  console.log('night errors:', n.errs.length ? [...new Set(n.errs)].join(' | ') : 'none')
  await n.p.close()
}
await b.close()
