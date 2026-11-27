// rainshot.mjs [outDir] [tier] [ids…] — THE RAIN ON THE CAR (2026-11-27 — oth/Drops.ts: the drops on the glass and the
// paint, the wipers' swept fans, the mud washed off): a car in the rain, shot from outside (the nose three-quarter, the
// side's windows, the tail) and from the driver's eye (ahead through the windscreen, out of the side window) — the
// wipers off, then mid-sweep (P), then a few seconds on; the same eye dry (weather clear) for the A/B. Then the MUD:
// the flank as painted, after a spell of rain, after a ford. Prints the car's rain state at each and the page's errors.
// Needs `npm run dev`.
//   node scripts/harness/rainshot.mjs screenshots/rain ultra offroader sierra            env: PORT=5200, Q (extra URL switches: Q=drops=0 the A/B)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/rain', tier = 'ultra', ...only] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ids = only.length ? only : ['offroader']
let bad = 0
for (const id of ids) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=${process.env.HOUR || 14}&weather=rain&sound=0&save=0&car=${id}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 }) } catch { console.log(id, 'NEVER READY', errs.join(' | ')); bad++; await p.close(); continue }
  await sleep(1500)
  const look = (from, at) => p.evaluate(([from, at]) => {
    const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
    const a = V(from), t = V(at)
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
  }, [from, at])
  const state = () => p.evaluate(() => { const c = window.__oth.car, r = c.rain; return r ? r.state() : { rain: +window.__oth.atmos.uniforms.uRain.value.toFixed(2), coat: +c.coat.toFixed(3) } })
  const shot = async (name) => { await sleep(450); await p.screenshot({ path: `${out}/${id}_${name}.png` }); console.log(id, name, JSON.stringify(await state())) }
  const seat = await p.evaluate(() => { const m = window.__oth.car.model, d = m.doors.filter((q) => q.side === -1).sort((a, b) => a.hinge[2] - b.hinge[2])[0]; return d ? [d.hinge[0] + 0.42, d.hinge[1] + d.bottom + 1.05, d.hinge[2] + d.length * 0.62] : [-0.37, 1.6, 0.3] })
  const m = await p.evaluate(() => { const m = window.__oth.car.model; return { front: m.front, rear: m.rear, hx: m.half.x, top: m.bottom + m.half.y * 2 } })
  const VIEWS = {
    nose: [[-1.7, m.top - 0.1, m.front - 1.6], [0, m.top - 0.75, m.front + 1.0]],
    side: [[-m.hx - 1.9, m.top - 0.25, 0.2], [0, m.top - 0.6, 0.1]],
    tail: [[1.5, m.top, m.rear + 1.9], [0, m.top - 0.7, m.rear - 0.8]],
    eye: [[seat[0] + 0.12, seat[1], seat[2] + 0.1], [seat[0] + 0.5, seat[1] - 0.12, seat[2] - 3]],
    eyeSide: [seat, [seat[0] - 3, seat[1] - 0.15, seat[2] - 0.6]],
    flank: [[-m.hx - 2.1, 0.75, -0.3], [0, 0.6, -0.1]],
  }
  // (the rain settled on the car: a harness's short cut where the game has one)
  await p.evaluate(() => window.__oth.car.rain?.settle?.())
  await sleep(1200)
  for (const v of ['nose', 'side', 'tail', 'eye', 'eyeSide']) { await look(...VIEWS[v]); await shot(`${v}_rain`) }
  // the wipers: caught mid-sweep, then after a few seconds of them
  await p.evaluate(() => { window.__oth.car.wipers = true })
  await look(...VIEWS.eye); await sleep(380); await shot('eye_wipe0')
  await sleep(2600); await shot('eye_wipe1')
  await look(...VIEWS.nose); await shot('nose_wipe')
  await p.evaluate(() => { window.__oth.car.wipers = false })
  await look(...VIEWS.eye); await sleep(2500); await shot('eye_wiped_2s')
  await sleep(6000); await shot('eye_wiped_8s')
  // AT SPEED (the car told it does 90 km/h, standing): the side windows' runs lean back, the windscreen's are pushed up
  await p.evaluate(() => { const r = window.__oth.car.rain; if (!r) return; const u = r.update.bind(r); window.__upd = u; r.update = (dt, a, s, w, y, f, m) => u(dt, a, 25, w, y, f, m) })
  await sleep(4000)
  await look(...VIEWS.eyeSide); await shot('eyeSide_speed')
  await look(...VIEWS.side); await shot('side_speed')
  await p.evaluate(() => { const r = window.__oth.car.rain; if (r && window.__upd) r.update = window.__upd })
  // THE RAIN OVER: the car dries (the harness's clock: a minute of it at once) — fewer drops, then none
  if (await p.evaluate(() => !!window.__oth.car.rain)) {
    const dry = (n) => p.evaluate((n) => { const o = window.__oth, r = o.car.rain, a = { uniforms: { uRain: { value: 0 } } }; for (let i = 0; i < n; i++) r.update(0.1, a, 0, null, o.car.root.position.y) }, n)
    await p.evaluate(() => { const o = window.__oth; o.atmos.weather = 'clear'; o.atmos.uniforms.uRain.value = 0 })
    await look(...VIEWS.eye); await dry(250); await shot('eye_drying')
    await dry(400); await shot('eye_dry')
    await p.evaluate(() => { const o = window.__oth; o.atmos.weather = 'rain'; o.atmos.uniforms.uRain.value = 1; o.car.rain.settle() })
  }
  // THE MUD: as it is painted (a fresh car: the page loaded again would be), after a spell of rain (the harness's
  // clock: 20 s, then all of it), after a ford to the sills — then to the windows — with no rain at all
  const mud = (fn) => p.evaluate(fn)
  await mud(() => { const r = window.__oth.car.rain; if (r) { r.rained = 0; r.forded = -1; r.wash(0, 0, 0, 0, 0) } })
  await look(...VIEWS.flank); await shot('flank_0')
  if (await p.evaluate(() => !!window.__oth.car.rain?.wash)) {
    // (the game's own frame goes on washing — it is raining: each shot is taken at once after its state is set)
    await mud(() => { const r = window.__oth.car.rain; r.rained = 0; for (let i = 0; i < 250; i++) r.wash(0.1, 1, 0, 0, 0) }); await shot('flank_rain25s')
    await mud(() => { const r = window.__oth.car.rain; for (let i = 0; i < 400; i++) r.wash(0.1, 1, 0, 0, 0) }); await shot('flank_rained')
    await mud(() => { const o = window.__oth, r = o.car.rain; o.atmos.weather = 'clear'; o.atmos.uniforms.uRain.value = 0; r.rained = 0; r.forded = -1; for (let i = 0; i < 40; i++) r.wash(0.1, 0, 0.75, 0, 3) }); await shot('flank_ford')
    await mud(() => { const r = window.__oth.car.rain; for (let i = 0; i < 300; i++) r.wash(0.1, 0, 0, 1, 8) }); await shot('flank_mudAgain')
  }
  if (errs.length) bad++
  console.log(id, errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'ok')
  await p.close()
}
console.log(bad ? `${bad} with problems` : 'all ok')
await b.close()
