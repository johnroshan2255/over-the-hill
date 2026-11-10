// flicker.mjs [tier] [ids…] — BLINKING PIXELS on a car (2026-11-10, the user: "some pixels or the car's body parts
// blink"): two surfaces in the same plane fight for the depth buffer, and which wins changes as the camera moves a hair.
// Each car is looked at from four sides at 9 m and again from 2 cm to the side: the pixels that jump (a channel by more
// than 70) are counted — counted only where the picture round them is flat (a moved edge is no blink). A still, solid car has next to none.
//   node scripts/harness/flicker.mjs ultra offroader sierra          env: PORT=5200, OUT (a folder: the difference images), Q (extra URL switches: Q=grain=0)
// Counted ON THE CAR only (a frame with it hidden tells where it is; 3 px inside its outline).
// Each view prints `flat (all N of AREA)`: the jumps on flat paint, and ALL the car's pixels that jumped — a SPARKLE (the paint grain's
// pixel-sized dots, 2026-11-10: the blink the user saw) is not flat, so it shows in the second; compare it with and without.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [tier = 'ultra', ...ids] = process.argv.slice(2)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (process.env.OUT) fs.mkdirSync(process.env.OUT, { recursive: true })
for (const id of ids.length ? ids : ['offroader']) {
  const p = await b.newPage()
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&aa=0&car=${id}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
  await sleep(2500)
  const look = (from, at) => p.evaluate(([from, at]) => {
    const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
    const a = V(from), t = V(at)
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
  }, [from, at])
  const out = []
  for (const [nm, v] of [['front-left', [-4.5, 2.0, -5.5]], ['back-right', [4.5, 2.2, 5.5]], ['side', [-7, 1.6, 0.3]], ['back', [0.4, 1.8, 7]], ['far side', [-16, 2.5, 3]]]) {
    const frames = []
    // (a third frame with the car HIDDEN: where it differs from the first is the car — only its pixels are counted)
    for (const d of [0, 0.02, 'hide']) { if (d === 'hide') { await p.evaluate(() => { const c = window.__oth.car; window.__vis = []; c.root.traverse((o) => { window.__vis.push([o, o.visible]); o.visible = false }) }); await look([v[0], v[1], v[2]], [0, 1.1, 0]); await sleep(350); frames.push(await p.screenshot({ encoding: 'base64', clip: { x: 440, y: 230, width: 400, height: 300 } })); await p.evaluate(() => { for (const [o, v] of window.__vis) o.visible = v }); continue }
      await look([v[0] + d, v[1], v[2] + d], [0, 1.1, 0]); await sleep(350); frames.push(await p.screenshot({ encoding: 'base64', clip: { x: 440, y: 230, width: 400, height: 300 } })) }
    const n = await p.evaluate(async (a, bb, hh, save) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s })
      const [A, B, Hd] = await Promise.all([load(a), load(bb), load(hh)])
      const c = document.createElement('canvas'); c.width = A.width; c.height = A.height; const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(Hd, 0, 0); const dh = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, c.width, c.height)
      let n = 0, raw = 0, area = 0
      const isCar = (i) => i >= 0 && i < da.length && Math.max(Math.abs(da[i] - dh[i]), Math.abs(da[i + 1] - dh[i + 1]), Math.abs(da[i + 2] - dh[i + 2])) > 10
      const W0 = c.width, inCar = (i) => { for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (!isCar(i + (y * W0 + x) * 4)) return false; return true }   // (3 px inside its outline)
      // (a pixel that JUMPS where both frames are flat around it: a moved edge is not a blink — its neighbours differ)
      const W = c.width, B_ = db.data, src = new Uint8ClampedArray(B_)
      const flat = (d, i) => { let m = 0; for (const o of [-4, 4, -W * 4, W * 4, -8, 8, -W * 8, W * 8]) { const j = i + o; if (j < 0 || j >= d.length) continue; m = Math.max(m, Math.abs(d[i] - d[j]), Math.abs(d[i + 1] - d[j + 1]), Math.abs(d[i + 2] - d[j + 2])) } return m < 28 }
      for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - src[i]), Math.abs(da[i + 1] - src[i + 1]), Math.abs(da[i + 2] - src[i + 2])); const hit = d > 45 && (flat(da, i) || flat(src, i)); const car = inCar(i); if (car) area++; if (hit && car) n++; if (d > 45 && car) raw++; B_[i] = B_[i + 1] = B_[i + 2] = d > 45 && car ? 255 : da[i] >> (car ? 1 : 3) }
      g.putImageData(db, 0, 0)
      return [n + ' (all ' + raw + ' of ' + area + ')', save ? c.toDataURL('image/png').split(',')[1] : '']
    }, frames[0], frames[1], frames[2], !!process.env.OUT)
    out.push(`${nm} ${n[0]}`)
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/${id}_${nm}.png`, Buffer.from(n[1], 'base64'))
  }
  console.log(id.padEnd(12), out.join('   '))
  await p.close()
}
await b.close()
