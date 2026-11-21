// damagetest.mjs — CAR DAMAGE (oth/Damage.ts — docs/DAMAGE.md): the car driven as usual takes nothing; thrown at a wall
// at set speeds it takes what the spec says (the ΔV measured, the dent's depth, the engine, the lamps, the glass); hit
// from the side its axles bend; dropped, its wheels come down on their stops; shot — a tyre, a pane, the engine till it
// burns, and it goes up; repaired, it is as it left the works. With SHOTS=<dir>: a picture after each.
//   node scripts/harness/damagetest.mjs     env: PORT (5200), TIER (low), SHOTS (a folder for the pictures), ONLY=a,b
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = process.env.SHOTS, ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message.slice(0, 400)) })
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'low'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
await sleep(3500)
await p.evaluate(() => {
  const o = window.__oth
  window.__home = (() => { const t = o.car.sim.body.translation(); return { x: t.x, z: t.z, h: o.car.sim.heading } })()
  /** A wall `gap` m off the body: ahead of it, or (side) on its right. */
  window.__wall = (gap, side) => {
    const c = o.car, pw = o.physics.pw, R = pw.R, t = c.sim.body.translation(), h = c.sim.heading, bb = c.bodyBox
    const yaw = h + (side ? -Math.PI / 2 : 0), dx = -Math.sin(yaw), dz = -Math.cos(yaw), d = (side ? bb.hx : bb.hz - bb.cz) + gap + 0.5
    const body = pw.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(t.x + dx * d, t.y + 1, t.z + dz * d).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }))
    pw.world.createCollider(R.ColliderDesc.cuboid(7, 4, 0.5).setCollisionGroups((0x0002 << 16) | 0xffff), body)
    window.__wallBody = body
  }
  window.__unwall = () => { if (window.__wallBody) { o.physics.pw.world.removeRigidBody(window.__wallBody); window.__wallBody = null } }
  /** Sent off at v m/s — ahead, or to its right —, its wheels turning with it. */
  window.__throw = (v, side) => {
    const c = o.car, h = c.sim.heading, yaw = h + (side ? -Math.PI / 2 : 0), D = c.sim.drivetrain
    c.sim.body.setLinvel({ x: -Math.sin(yaw) * v, y: 0, z: -Math.cos(yaw) * v }, true)
    if (D && !side) for (let i = 0; i < 4; i++) D.omega[i] = v / D.R.axles[i >> 1].radius
    c.w0.on = false // (the harness's own shove is no crash)
  }
  // (every blow, as it lands: how hard, where on the car, which way, against what)
  window.__log = []
  const prev = o.car.onCrash
  o.car.onCrash = (k) => {
    const c = o.car, q = c.root.quaternion.clone().invert(), l = c.root.position.clone().set(k.x, k.y, k.z).sub(c.root.position).applyQuaternion(q), d = c.root.position.clone().set(k.dx, k.dy, k.dz).applyQuaternion(q)
    if (window.__log.length < 12) window.__log.push({ dv: +k.dv.toFixed(2), at: [+l.x.toFixed(2), +l.y.toFixed(2), +l.z.toFixed(2)], dir: [+d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)], other: k.other ? k.other.bodyType() : null, kmh: Math.round(c.speedKmh), wheels: c.sim.wheels.map((w) => +w.contact).join('') })
    prev?.(k)
  }
  window.__home2 = () => { const H = window.__home; window.__unwall(); o.car.placeAt(H.x, H.z, H.h) }
  window.__read = () => {
    const c = o.car, d = c.damage
    if (!d) return null
    let maxd = 0, moved = 0, n = 0
    for (const m of d.meshes) {
      n += m.pos.length / 3
      if (!m.rest || m.glass) continue
      for (let i = 0; i < m.pos.length; i += 3) { const e = Math.hypot(m.pos[i] - m.rest[i], m.pos[i + 1] - m.rest[i + 1], m.pos[i + 2] - m.rest[i + 2]); if (e > 1e-5) moved++; if (e > maxd) maxd = e }
    }
    return { engine: Math.round(d.engine), power: +d.sim.power.toFixed(2), bend: d.wheels.map((w) => +(w.bend * 57.3).toFixed(1)), flat: d.wheels.map((w) => +w.flat), off: d.wheels.map((w) => +w.off), jam: d.wheels.map((w) => +w.jam),
      toe: d.sim.toe.map((t) => +(t * 57.3).toFixed(1)), lamps: d.lamps.map(Number), panes: d.panes.map((q) => q.state), maxd: +maxd.toFixed(3), moved, verts: n, peak: +c.peakDv.toFixed(2), dv: +c.crash.dv.toFixed(2),
      whole: d.whole, cost: d.cost, burn: +d.burn.toFixed(1), wrecked: d.wrecked, smoke: d.smoke, kmh: Math.round(c.speedKmh), onFoot: o.onFoot, fx: o.damageFx?.counts }
  }
})
const read = () => p.evaluate(() => window.__read())
const shot = async (name, x = 3.2, y = 1.7, z = -5.2) => {
  if (!SHOTS) return
  await p.evaluate((x, y, z) => window.__oth.spectate(x, y, z, 0.8), x, y, z)
  await sleep(400)
  await p.screenshot({ path: `${SHOTS}/${name}.png` })
  await p.evaluate(() => window.__oth.spectate())
}
const want = (k) => !ONLY || ONLY.includes(k)
const first = await read()
if (!first) { console.log('damage is off (?damage=0)'); await b.close(); process.exit(1) }
console.log(`the car: ${first.verts} vertices in its shell and glass, ${first.panes.length} panes`)
await shot('0_whole')

if (want('drive')) {
  // 1. DRIVEN AS USUAL: off the line flat out, a hard stop; then the autopilot along the road for a minute — no blow
  await p.keyboard.down('KeyW'); await sleep(2500); await p.keyboard.up('KeyW')
  const top = (await read()).kmh
  await p.keyboard.down('Space'); await sleep(2500); await p.keyboard.up('Space')
  let s = await read()
  console.log('pulled away and stopped:', JSON.stringify({ top, peak: s.peak, whole: s.whole }))
  check(s.whole && s.peak < 1.2, `away flat out to ${top} km/h and a hard stop: no blow (the biggest change of velocity not its own ${s.peak} m/s — a blow is from 1.5)`)
  const to = await p.evaluate(() => {
    const o = window.__oth, P = o.car.root.position
    const l = o.world.places.map((q) => ({ q, d: Math.hypot(q.x - P.x, q.z - P.z) })).filter((e) => e.d > 500 && e.d < 1600).sort((a, b) => a.d - b.d)[0]
    if (!l) return null
    o.car.peakDv = 0
    o.guide.set({ world: o.world.id, x: l.q.x, z: l.q.z, name: l.q.name }, { x: P.x, z: P.z })
    if (!o.autopilot.on) o.autopilot.toggle()
    return { name: l.q.name, d: Math.round(l.d) }
  })
  if (to) {
    let far = 0, fast = 0
    const at0 = await p.evaluate(() => { const P = window.__oth.car.root.position; return [P.x, P.z] })
    for (let i = 0; i < 60; i++) { await sleep(1000); const k = await p.evaluate(() => { const o = window.__oth, P = o.car.root.position; return [P.x, P.z, o.car.speedKmh] }); far = Math.hypot(k[0] - at0[0], k[1] - at0[1]); fast = Math.max(fast, k[2]) }
    await p.evaluate(() => { const o = window.__oth; if (o.autopilot.on) o.autopilot.toggle() })
    s = await read()
    console.log(`the autopilot toward ${to.name} (${to.d} m), a minute:`, JSON.stringify({ far: Math.round(far), fast: Math.round(fast), peak: s.peak, whole: s.whole, log: await p.evaluate(() => window.__log) }))
    check(far > 150, `it drove (${Math.round(far)} m, up to ${Math.round(fast)} km/h)`)
    check(s.whole && s.peak < 1.2, `a minute along the road: no blow (the biggest ${s.peak} m/s)`)
    await p.keyboard.down('Space'); await sleep(2500); await p.keyboard.up('Space')
  }
}

// 2. THE WALL, head on, at 5 / 10 / 14 / 20 m/s
if (want('wall')) for (const v of [5, 10, 14, 20]) {
  await p.evaluate(() => { window.__home2(); window.__oth.car.damage.repair(); window.__oth.car.peakDv = 0 })
  await sleep(1500)
  await p.evaluate((v) => { window.__wall(2, false); window.__throw(v, false) }, v)
  await sleep(2600)
  const s = await read()
  console.log(`wall at ${v} m/s:`, JSON.stringify({ dv: s.peak, dent: s.maxd, moved: s.moved, engine: s.engine, power: s.power, lamps: s.lamps, panes: s.panes, bend: s.bend, flat: s.flat, smoke: s.smoke, cost: s.cost, fx: s.fx }))
  check(s.peak > v * 0.55 && s.peak < v * 1.3, `${v} m/s into the wall: a blow of ${s.peak} m/s`)
  check(s.maxd > 0.01 && s.maxd <= 0.6001, `the shell gave ${Math.round(s.maxd * 100)} cm at the most (never more than 60), ${s.moved} vertices moved`)
  check(s.engine < 1000 && !s.whole, `the engine took it: ${s.engine} of 1000`)
  if (v >= 14) check(s.lamps[0] + s.lamps[1] >= 1, `a headlamp broken (${s.lamps})`)
  if (v >= 14) check(s.panes.some((q) => q > 0), `glass cracked or out (${s.panes})`)
  await shot(`1_wall_${v}`)
  await p.evaluate(() => window.__unwall())
}

// 3. REPAIRED: as it left the works
if (want('repair')) {
  await p.evaluate(() => { window.__home2(); window.__oth.repairCar() })
  await sleep(800)
  const s = await read()
  check(s.whole && s.maxd === 0 && s.engine === 1000 && s.panes.every((q) => q === 0), `repaired: whole again (dent ${s.maxd}, engine ${s.engine})`)
}

// 4. FROM THE SIDE at 6 m/s: the axles of that side
if (want('side')) {
  await p.evaluate(() => { window.__home2(); window.__oth.car.damage.repair(); window.__oth.car.peakDv = 0 })
  await sleep(1500)
  await p.evaluate(() => { window.__log.length = 0; window.__wall(0.6, true); window.__throw(6, true) })
  await sleep(2600)
  const s = await read()
  console.log('side at 6 m/s:', JSON.stringify({ dv: s.peak, dent: s.maxd, bend: s.bend, toe: s.toe, jam: s.jam, flat: s.flat, panes: s.panes, engine: s.engine, log: await p.evaluate(() => window.__log) }))
  // (a tall car thrown sideways at a wall rocks back onto its other side: that is a second blow, on the left)
  const l0 = (await p.evaluate(() => window.__log))[0]
  check(l0 && l0.at[0] > 0.5 && l0.dir[0] < -0.7 && l0.other !== null, `the blow is found on its right side, against the wall (${JSON.stringify(l0?.at)})`)
  check(s.bend[1] > 1 && s.bend[3] > 1 && s.bend[1] + s.bend[3] > s.bend[0] + s.bend[2], `the right side's axles bent (${s.bend[1]}°, ${s.bend[3]}°), the left's less (${s.bend[0]}°, ${s.bend[2]}°)`)
  check(Math.abs(s.toe[1]) + Math.abs(s.toe[3]) > 0.5, `its wheels out of line (toe ${s.toe[1]}°, ${s.toe[3]}°)`)
  await shot('2_side', 4.2, 1.5, -1.5)
  await p.evaluate(() => window.__unwall())
  // (and — set back on its wheels if that tipped it — it still drives, pulling to that side)
  await p.keyboard.press('KeyR'); await sleep(1500)
  await p.keyboard.down('KeyW'); await sleep(3500); await p.keyboard.up('KeyW')
  const d = await read()
  check(d.kmh > 8, `it still drives (${d.kmh} km/h)`)
  await p.keyboard.down('Space'); await sleep(2000); await p.keyboard.up('Space')
}

// 5. DROPPED from 4 m: down on its stops
if (want('drop')) {
  await p.evaluate(() => { window.__home2(); window.__oth.car.damage.repair(); const c = window.__oth.car, t = c.sim.body.translation(); c.sim.place(t.x, t.y + 4, t.z, c.sim.heading); c.w0.on = false; c.peakDv = 0 })
  await sleep(3500)
  const s = await read()
  console.log('dropped 4 m:', JSON.stringify({ bend: s.bend, flat: s.flat, dent: s.maxd, engine: s.engine, peak: s.peak }))
  check(s.bend.every((x) => x > 1 && x < 8) && s.jam.every((x) => !x), `a 4 m drop bends its axles, none jammed (${s.bend}°)`)
  // (… and a jump's landing — 1.5 m — does nothing)
  await p.evaluate(() => { window.__home2(); window.__oth.car.damage.repair(); const c = window.__oth.car, t = c.sim.body.translation(); c.sim.place(t.x, t.y + 1.5, t.z, c.sim.heading); c.w0.on = false; c.peakDv = 0 })
  await sleep(3000)
  const j = await read()
  check(j.whole, `a 1.5 m drop: nothing (whole: ${j.whole}, axles ${j.bend})`)
}

// 6. SHOT: a tyre, a pane (three rounds), the engine till it burns — and it goes up
if (want('shots')) {
  await p.evaluate(() => { window.__home2(); window.__oth.car.damage.repair() })
  await sleep(1500)
  const r = await p.evaluate(() => {
    const o = window.__oth, c = o.car, d = c.damage, q = c.root.quaternion, P = c.root.position
    const world = (x, y, z) => { const v = c.root.position.clone().set(x, y, z).applyQuaternion(q).add(P); return [v.x, v.y, v.z] }
    const fwd = c.root.position.clone().set(0, 0, 1).applyQuaternion(q)
    const fire = (x, y, z) => { const w = world(x, y, z); c.shot(w[0], w[1], w[2], fwd.x, fwd.y, fwd.z) }
    // a tyre: the front left's hub
    const h = d.hub[0]; fire(h[0], h[1] - 0.1, h[2])
    const tyre = d.wheels[0].flat
    // a pane: three rounds at its middle
    const pane = d.panes.reduce((a, b) => (b.r > a.r ? b : a))
    fire(pane.x, pane.y, pane.z); const cracked = pane.state
    fire(pane.x, pane.y, pane.z); fire(pane.x, pane.y, pane.z)
    const gone = pane.state
    // the engine: rounds into its bay till it burns
    let n = 0
    while (!d.burning && n < 200) { fire(d.vent.x, d.vent.y - 0.2, d.vent.z); n++ }
    return { tyre, cracked, gone, n, engine: Math.round(d.engine), burning: d.burning, burn: d.burn }
  })
  console.log('shot:', JSON.stringify(r))
  check(r.tyre, 'a round through the tyre: flat')
  check(r.cracked === 1 && r.gone === 2, `a pane: cracked by the first round, out by the third (${r.cracked}, ${r.gone})`)
  check(r.burning && r.n > 20, `the engine: on fire after ${r.n} rounds (its health ${r.engine})`)
  await sleep(1500)
  await shot('3_burning', 3.4, 1.8, -5.0)
  const m = await read()
  check(m.fx && m.fx.flames > 3, `flames (${m.fx?.flames})`)
  await sleep(r.burn * 1000 + 600)
  await shot('4_blast', 4.5, 2.4, -7.5)
  const s = await read()
  console.log('after the fire:', JSON.stringify({ wrecked: s.wrecked, engine: s.engine, onFoot: s.onFoot, panes: s.panes, lamps: s.lamps, flat: s.flat, fx: s.fx }))
  check(s.wrecked && s.engine === 0, 'it went up: a wreck, the engine gone')
  check(s.onFoot, 'you are thrown out of it')
  check(s.panes.every((q) => q === 2) && s.lamps.every((q) => q === 1), 'every pane and lamp out')
  await sleep(2500)
  await shot('5_wreck', 3.4, 1.8, -5.0)
  // mended, and back in
  await p.evaluate(() => window.__oth.car.damage.repair())
  for (let i = 0; i < 40; i++) { const q = await read(); if (!q.onFoot) break; if (i % 8 === 0) await p.evaluate(() => window.__oth.foot()); await sleep(500) }
  await sleep(2500)
  await p.keyboard.down('KeyW'); await sleep(3500); await p.keyboard.up('KeyW')
  const d = await read()
  check(d.whole && d.kmh > 8, `mended, it drives again (${d.kmh} km/h)`)
}

// 5b. THE SPARE WHEEL on the tail (the user: "hitting it won't crack it, like in reality"): a 9 m/s blow from behind ON
// it, and the same blow beside it on the tail's skin
if (want('spare')) {
  const r = await p.evaluate(() => {
    const o = window.__oth, d = o.car.damage, sp = d.spare
    if (!sp) return null
    const m = d.meshes[0]
    const state = () => {
      let soft = 0, hard = 0
      if (m.rest) for (let i = 0; i < m.pos.length; i += 3) { const e = Math.hypot(m.pos[i] - m.rest[i], m.pos[i + 1] - m.rest[i + 1], m.pos[i + 2] - m.rest[i + 2]); if (m.soft && m.soft[i / 3]) soft = Math.max(soft, e); else hard = Math.max(hard, e) }
      return { panes: d.panes.filter((q) => q.state > 0).length, lamps: d.lamps.filter(Boolean).length, soft: +soft.toFixed(3), hard: +hard.toFixed(3) }
    }
    d.repair(); d.hit(sp.x, sp.y, sp.z1, 0, 0, -1, 9); const on = state()
    // (beside it: on the tail's skin, clear of the wheel, the same height)
    const side = sp.x > 0 ? sp.x - sp.r - 0.2 : sp.x + sp.r + 0.2
    d.repair(); d.hit(side, sp.y, sp.z0, 0, 0, -1, 9); const off = state()
    // (a round into the rubber)
    d.repair(); const q = o.car.root.quaternion, P = o.car.root.position
    const w = P.clone().set(sp.x, sp.y, sp.z1).applyQuaternion(q).add(P), f = P.clone().set(0, 0, -1).applyQuaternion(q)
    for (let i = 0; i < 3; i++) o.car.shot(w.x, w.y, w.z, f.x, f.y, f.z)
    const shot = { whole: d.whole }
    d.repair(); d.events.length = 0
    return { sp: { x: +sp.x.toFixed(2), y: +sp.y.toFixed(2), r: +sp.r.toFixed(2), z0: +sp.z0.toFixed(2), z1: +sp.z1.toFixed(2) }, wheelR: +o.car.model.wheelRadius.toFixed(2), softVerts: m.soft ? m.soft.reduce((a, b) => a + b, 0) : 0, on, off, shot }
  })
  console.log('the spare wheel:', JSON.stringify(r))
  check(!!r, 'this car\'s spare wheel is found on its tail')
  if (r) {
    check(Math.abs(r.sp.r - r.wheelR) < 0.3 * r.wheelR && r.softVerts > 50, `it is a wheel's size (radius ${r.sp.r} m — the road wheels' ${r.wheelR}; ${r.softVerts} vertices of it)`)
    check(r.on.panes === 0 && r.off.panes > 0, `a 9 m/s blow ON it cracks no window (${r.on.panes}); the same blow beside it does (${r.off.panes})`)
    check(r.on.soft < 0.03 && r.on.hard < r.off.hard, `the tyre itself hardly dents (${Math.round(r.on.soft * 1000)} mm), the tail behind it less than hit bare (${Math.round(r.on.hard * 100)} cm against ${Math.round(r.off.hard * 100)} cm)`)
    check(r.shot.whole, 'three rounds into its rubber: nothing')
  }
}

// 6b. A REAL GUN: out of the car, the pistol, five rounds at it from beside its door
if (want('gun')) {
  await p.evaluate(() => { const o = window.__oth; window.__home2(); o.car.damage.repair() })
  await sleep(1200)
  for (let i = 0; i < 30; i++) { const q = await read(); if (q.onFoot) break; if (i % 8 === 0) await p.evaluate(() => window.__oth.foot()); await sleep(500) }
  await sleep(2500)
  const g = await p.evaluate(async () => {
    const o = window.__oth, a = o.arsenal, c = o.car, hp = o.hero.pos
    a.give('pistol'); a.equip('pistol'); a.host.kick = () => {}
    // (at the middle of its body, from where he stands)
    const m = c.damage.mid.clone().applyQuaternion(c.root.quaternion).add(c.root.position)
    const dx = m.x - hp.x, dy = m.y - (hp.y + 1.5), dz = m.z - hp.z
    o.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
    await new Promise((r) => setTimeout(r, 900))
    for (let i = 0; i < 5; i++) { a.press('fire', true); await new Promise((r) => setTimeout(r, 120)); a.press('fire', false); await new Promise((r) => setTimeout(r, 380)) }
    await new Promise((r) => setTimeout(r, 600))
    a.equip(null)
    return { fired: a.stats.shots, crush: +c.damage.crush.toFixed(3), whole: c.damage.whole, d: +Math.hypot(dx, dz).toFixed(1) }
  })
  console.log('the pistol at the car:', JSON.stringify(g))
  check(g.fired >= 3 && !g.whole && g.crush > 0, `rounds fired at it from ${g.d} m mark it (${g.fired} fired; holes ${Math.round(g.crush * 1000)} mm in all)`)
  await shot('8_shot_at', -3.2, 1.6, -1.0)
  await p.evaluate(() => window.__oth.car.damage.repair())
  for (let i = 0; i < 40; i++) { const q = await read(); if (!q.onFoot) break; if (i % 8 === 0) await p.evaluate(() => window.__oth.foot()); await sleep(500) }
  await sleep(2500)
}

// 7. THE ENEMY: his ram — your car and his both take it
if (want('enemy')) {
  await p.evaluate(() => { const o = window.__oth; if (o.onFoot) o.foot() })
  await sleep(1500)
  await p.evaluate(() => { const o = window.__oth; window.__home2(); o.car.damage.repair(); o.setCompanion('enemy') })
  // (standing: he comes up your way and rams — twice)
  await p.keyboard.down('KeyW'); await sleep(2200); await p.keyboard.up('KeyW')
  await p.keyboard.down('Space'); await sleep(1500); await p.keyboard.up('Space')
  await p.evaluate(() => { const o = window.__oth; o.car.damage.repair(); o.companion.car.damage?.repair(); window.__log.length = 0 })
  let rams = 0
  for (let i = 0; i < 70 && rams < 2; i++) { await sleep(1000); rams = await p.evaluate(() => window.__oth.companion?.rams ?? 0) }
  await sleep(1200)
  const e = await p.evaluate(() => { const o = window.__oth, d = o.car.damage, h = o.companion.car.damage; return { rams: o.companion.rams, yours: { whole: d.whole, engine: Math.round(d.engine), cost: d.cost, lamps: d.lamps.map(Number) }, his: h ? { whole: h.whole, engine: Math.round(h.engine), lamps: h.lamps.map(Number), drive: +h.drive.toFixed(2) } : null, log: window.__log.slice(-4) } })
  console.log('the enemy:', JSON.stringify(e))
  check(e.rams >= 1, `he rammed you (${e.rams})`)
  check(!e.yours.whole, `your car took it (cost ${e.yours.cost} ◆)`)
  check(e.his && !e.his.whole && e.his.engine < 1000, `his car took it too (engine ${e.his?.engine})`)
  check(e.yours.engine > 700 && e.his.engine > 500, `two rams are two blows — neither car is wrecked by them (your engine ${e.yours.engine}, his ${e.his?.engine})`)
  await shot('6_rammed', -3.6, 1.8, 6.5)
  // (… and YOUR car driven into HIS: set down 9 m off his nose, facing him, sent at him at 10 m/s — the same blow to both)
  await p.evaluate(() => {
    const o = window.__oth, c = o.companion
    o.car.damage.repair(); c.car.damage.repair(); window.__log.length = 0
    const P = c.carP, yaw = c.carYaw
    o.car.placeAt(P.x - Math.sin(yaw) * 9, P.z - Math.cos(yaw) * 9, yaw + Math.PI)
    window.__throw(10, false)
  })
  await sleep(2200)
  const h = await p.evaluate(() => { const o = window.__oth, d = o.car.damage, k = o.companion.car.damage; return { log: window.__log.slice(0, 3), yours: Math.round(d.engine), his: Math.round(k.engine), hisDent: +k.crush.toFixed(3), hisLamps: k.lamps.map(Number) } })
  console.log('into his car:', JSON.stringify(h))
  check(h.log.some((l) => l.other !== null), 'the blow was against his car\'s body')
  check(h.yours < 1000 && h.his < 1000 && h.hisDent > 0, `both took it (your engine ${h.yours}, his ${h.his}, his shell ${Math.round(h.hisDent * 100)} cm)`)
  await shot('7_into_him', 3.6, 1.8, -6.5)
  await p.evaluate(() => { window.__oth.setCompanion(null); window.__oth.car.damage.repair() })
}

// 8. WHAT A BLOW COSTS the frame it lands in
if (want('cost')) {
  const ms = await p.evaluate(() => {
    const d = window.__oth.car.damage
    d.repair()
    const t = []
    for (let i = 0; i < 12; i++) { const t0 = performance.now(); d.hit(0, 0.9, d.bay.z0, 0, 0, 1, 14); t.push(performance.now() - t0); if (i === 0) d.repair() }
    d.repair(); d.events.length = 0
    return t.map((x) => +x.toFixed(2))
  })
  console.log(`a 14 m/s blow's pass over the shell (ms): first ${ms[0]}, then ${ms.slice(1).join(' ')}`)
}
check(errs.length === 0, `no page errors (${errs.length})`)
await b.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
