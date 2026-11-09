// charshot.mjs [outDir] [tier] — THE CHARACTER in the game (2026-11-09: the Rocketbox avatar, scripts/oth/rocketbox.py):
// at the wheel, on the motorbike, then out of the car (F): shot standing from the front / three-quarter / side / back, close on the face, walking and
// running behind on the chase camera — at noon and at dusk. Needs `npm run dev`.
//   node scripts/harness/charshot.mjs screenshots/character ultra        env: PORT=5200
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/character', tier = 'ultra'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const W = 1280, H = 720
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || /not set|uniform/i.test(m.text())) errs.push(m.text().slice(0, 300)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=12&weather=clear&sound=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
await sleep(1500)
const shot = async (name) => { await sleep(600); await p.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }
// in the car (the game starts with him at the wheel: seen through the driver's window), then on the motorbike
const side = (dist, hh, ang) => p.evaluate(([dist, hh, ang]) => {
  const o = window.__oth, t = o.riding ? o.moto : o.car, hp = t.root.position, hd = o.riding ? o.moto.heading : o.car.sim.heading
  const fx = -Math.sin(hd), fz = -Math.cos(hd)
  const cx = hp.x + (fx * Math.cos(ang) - fz * Math.sin(ang)) * dist, cz = hp.z + (fz * Math.cos(ang) + fx * Math.sin(ang)) * dist
  o.view(cx, cz, hp.y + hh - o.world.map.height(cx, cz), Math.atan2(-(hp.x - cx), -(hp.z - cz)), -0.08)
}, [dist, hh, ang])
// close on a hand (a bone of his: the camera dist m off it, round from his facing by ang, dy over it)
const hand = (bone, dist, ang, dy) => p.evaluate(([bone, dist, ang, dy]) => {
  const o = window.__oth, m = o.camera.matrixWorld.clone()
  if (!o.hero.boneWorld(bone, m)) return
  const x = m.elements[12], y = m.elements[13], z = m.elements[14], hd = o.riding ? o.moto.heading : o.onFoot ? o.hero.heading : o.car.sim.heading
  const fx = -Math.sin(hd), fz = -Math.cos(hd)
  const cx = x + (fx * Math.cos(ang) - fz * Math.sin(ang)) * dist, cz = z + (fz * Math.cos(ang) + fx * Math.sin(ang)) * dist, cy = y + dy
  o.view(cx, cz, cy - o.world.map.height(cx, cz), Math.atan2(-(x - cx), -(z - cz)), Math.atan2(y - cy, Math.hypot(x - cx, z - cz)))
}, [bone, dist, ang, dy])
await side(3.6, 1.7, -1.25); await shot('noon_driver')
await hand('LeftHand', 0.55, -0.9, 0.25); await shot('noon_driver_hand')
await p.evaluate(() => window.__oth.foot())
await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 }).catch(() => {})
await sleep(1500)
await p.evaluate(() => window.__oth.ride())
await p.waitForFunction(() => window.__oth.riding, { timeout: 30000, polling: 200 }).catch(() => {})
await sleep(2500)
await side(3.4, 1.2, -1.4); await shot('noon_bike')
await hand('RightHand', 0.5, 1.2, 0.2); await shot('noon_bike_hand')
// (off the bike puts it back on the car and him at the wheel: out again)
await p.evaluate(() => window.__oth.ride())
await p.waitForFunction(() => !window.__oth.riding, { timeout: 30000, polling: 200 }).catch(() => {})
await sleep(1500)
if (!(await p.evaluate(() => window.__oth.onFoot))) await p.evaluate(() => window.__oth.foot())
await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.control, { timeout: 30000, polling: 200 }).catch(() => {})
await sleep(2500)

for (const hour of [12, 18.4]) {
  const tag = hour === 12 ? 'noon' : 'dusk'
  await p.evaluate((h) => window.__oth.setHour(h), hour)
  // standing, round him (the fly camera, placed at his height looking at his chest)
  for (const [nm, ang, dist, hh, pitch] of [['front', 0, 3.2, 1.2, -0.06], ['three_quarter', 0.7, 3.2, 1.2, -0.06], ['side', -1.57, 3.2, 1.2, -0.06], ['back', 3.14, 3.2, 1.2, -0.06], ['face', 0.35, 0.9, 1.62, -0.02]]) {
    await p.evaluate(([ang, dist, hh, pitch]) => {
      const o = window.__oth, hp = o.hero.pos, hd = o.hero.heading
      // (his forward: −z turned by the heading; the camera out in front of him, turned round by ang)
      const fx = -Math.sin(hd), fz = -Math.cos(hd)
      const cx = hp.x + (fx * Math.cos(ang) - fz * Math.sin(ang)) * dist, cz = hp.z + (fz * Math.cos(ang) + fx * Math.sin(ang)) * dist
      const yaw = Math.atan2(-(hp.x - cx), -(hp.z - cz))
      const gy = o.world.map.height(cx, cz)
      o.view(cx, cz, hp.y + hh - gy, yaw, pitch)
    }, [ang, dist, hh, pitch])
    await shot(`${tag}_${nm}`)
  }
  await hand('RightHand', 0.45, 0.9, 0.05); await shot(`${tag}_hand`)
  // walking, then running, on the chase camera
  await p.evaluate(() => window.__oth.drive(true))
  await p.keyboard.down('KeyW'); await p.keyboard.down('ControlLeft'); await sleep(2200); await shot(`${tag}_walk`)
  await p.keyboard.up('ControlLeft'); await sleep(1800); await shot(`${tag}_run`)
  await p.keyboard.up('KeyW'); await sleep(1500)
}
console.log('errors:', errs.length ? errs.slice(0, 10) : 'none')
await b.close()
