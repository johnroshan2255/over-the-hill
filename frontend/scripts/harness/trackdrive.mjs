// trackdrive.mjs — DRIVE EVERY TRACK: a steering bot (pure pursuit on each `meta.trails.lines` centre line, slowing
// for bends) drives every track of a world, both ways, on the game's own physics (TruckSim + Rapier: the ground tiles,
// rocks, trunks, props, bridges), FASTER than real time (the fixed steps run in batches between frames). Wherever the
// car STALLS (< 2 m in 5 s), FLIPS, leaves the line (> 6 m) or gets thrown (> 2.5 m above the ground) it logs the spot
// — what's there: the grade ahead, the rock / trunk / prop nearest — and goes on 14 m further.
//   node scripts/harness/trackdrive.mjs [out.json]    env: WORLD=valley  TRACKS=0,3,7 (default all; not LINES: zsh owns it)  DIRS=fwd,rev
//                                                      PORT=5200  CAR=<id>  Q=<extra URL params>  (needs `npm run dev`; ?save=0)
//   SET=outland : the outland's ROADS instead (meta.outland.trails.lines — scripts/oth/wilds.py), the same bot
//   SET=bridges : across each of the outland's gorge bridges (its approach, its deck, the far side)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'vg/trackdrive.json'
const WORLD = process.env.WORLD || 'valley'
const DIRS = (process.env.DIRS || 'fwd,rev').split(',')
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000, args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); else if (m.text().startsWith('TRACE')) console.log(m.text()) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=low&dpr=fixed&time=0&hour=12&weather=clear&world=${WORLD}&sound=0&save=0${process.env.CAR ? '&car=' + process.env.CAR : ''}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(1500)

if (process.env.TRACE) await p.evaluate((t) => { window.__trace = t.split('-').map(Number) }, process.env.TRACE)
const nLines = await p.evaluate((set) => {
  const o = window.__oth, car = o.car, sim = car.sim, step = sim.step.bind(sim)
  o.drive(true)
  const B = (window.__bot = { path: null, i: 0, on: false })
  sim.step = (dt) => {
    if (!B.on) { sim.controls.throttle = 0; sim.controls.brake = true; sim.controls.steer = 0; return step(dt) }
    const t = sim.body.translation(), path = B.path, v = Math.abs(sim.speed)
    let bi = B.i, bd = 1e18
    for (let i = Math.max(0, B.i - 4); i < Math.min(path.length, B.i + 8); i++) { const d = (path[i][0] - t.x) ** 2 + (path[i][1] - t.z) ** 2; if (d < bd) { bd = d; bi = i } }
    B.i = bi
    B.lateral = Math.sqrt(bd)
    if (bi >= path.length - 4) { B.done = true; sim.controls.throttle = 0; sim.controls.brake = true; sim.controls.steer = 0; return step(dt) }
    // the bend ahead (the heading change over the next 36 m) — and how much it turns over the next 16 m (a hairpin:
    // slow to a crawl, look only 3.5 m ahead, so it doesn't cut the corner into the bank)
    const P_ = (k) => path[Math.min(path.length - 1, bi + k)]
    const turn = (k0, k1, k2) => { const a = P_(k0), m = P_(k1), e = P_(k2), h1 = Math.atan2(m[0] - a[0], m[1] - a[1]), h2 = Math.atan2(e[0] - m[0], e[1] - m[1]); return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) }
    const bend = turn(0, 9, 18), tight = Math.max(turn(0, 4, 8), turn(2, 6, 10))
    const look = Math.min(path.length - 1, bi + Math.round((tight > 0.9 ? 3.5 : 5 + 0.45 * v) / 2))
    const [tx, tz] = path[look]
    let err = Math.atan2(-(tx - t.x), -(tz - t.z)) - sim.heading
    err = Math.atan2(Math.sin(err), Math.cos(err))
    // (as a careful driver: slow while the wheel's well over, and down a steep grade — the throttle never floored into
    //  a bend going downhill)
    const ahead = P_(10), down = (o.height(t.x, t.z) - o.height(ahead[0], ahead[1])) / 20
    const steer = Math.max(-1, Math.min(1, -err * 2.2))
    let target = (tight > 0.9 ? 8 : bend > 0.6 ? 12 : bend > 0.25 ? 20 : 32) / 3.6
    if (Math.abs(steer) > 0.6) target = Math.min(target, 10 / 3.6)
    if (down > 0.12) target = Math.min(target, (down > 0.2 ? 16 : 22) / 3.6)
    sim.controls.steer = steer
    const over = v - target
    sim.controls.throttle = over < 0 ? Math.min(1, -over * 0.5 + 0.25) : over > 0.8 ? -Math.min(1, over * 0.6) : 0
    sim.controls.brake = over > 0.8
    sim.controls.handbrake = false
    return step(dt)
  }
  window.__lines = set === 'outland' ? o.world.map.meta.outland.trails.lines : o.world.map.meta.trails.lines
  // (SET=bridges: each gorge bridge of the outland as a line of its own — the road up to it, its deck, the road beyond)
  if (set === 'bridges') {
    const roads = o.world.map.meta.outland.trails.lines
    // (the road that ends at a bridge's end: its last 60 m TOWARD that end — else 40 m straight along the bridge's line)
    const lead = (ex, ez, ux, uz) => {
      // every road with an end at (ex, ez), ordered TOWARD it; the longest — and where that is only the short link from
      // the junction 20 m off (the road arrived over the bridge and goes on from there), the road that goes on, first
      const to = (x, z, r) => roads.flatMap((L) => [[L, L[L.length - 1]], [[...L].reverse(), L[0]]].filter(([, e]) => Math.hypot(e[0] - x, e[1] - z) < r).map(([P]) => P)).sort((p, q) => q.length - p.length)
      const here = to(ex, ez, 4)[0]
      if (here && here.length >= 8) return here.slice(-8)
      if (here) { const on = to(here[0][0], here[0][1], 14).filter((P) => P !== here && P.length >= 6)[0]; return [...(on ? on.slice(-8, -1) : []), ...here] }
      const out = []; for (let d = 40; d >= 0; d -= 8) out.push([ex - ux * d, ez - uz * d]); return out
    }
    window.__lines = (o.world.map.meta.bridges || []).filter((b) => b.outland).map((b) => { const L = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), ux = (b.x1 - b.x0) / L, uz = (b.z1 - b.z0) / L; const A = lead(b.x0, b.z0, ux, uz), B = lead(b.x1, b.z1, -ux, -uz).reverse(), deck = []; for (let d = 8; d < L - 4; d += 8) deck.push([b.x0 + ux * d, b.z0 + uz * d]); return [...A, ...deck, ...B] })
  }
  return window.__lines.length
}, process.env.SET || '')

const want = process.env.TRACKS ? process.env.TRACKS.split(',').map(Number) : [...Array(nLines).keys()]
const report = { world: WORLD, lines: [] }
const t0 = Date.now()
for (const li of want) for (const dir of DIRS) {
  // the line, densified to 2 m; the gate's end (the crossing) left out
  const setup = await p.evaluate((li, dir) => {
    const o = window.__oth, B = window.__bot, M = o.world.map.meta
    const raw = window.__lines[li].slice()
    if (dir === 'rev') raw.reverse()
    const path = []
    for (let k = 0; k < raw.length - 1; k++) {
      const [x0, z0] = raw[k], [x1, z1] = raw[k + 1], n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 2))
      for (let j = 0; j < n; j++) path.push([x0 + ((x1 - x0) * j) / n, z0 + ((z1 - z0) * j) / n])
    }
    path.push(raw[raw.length - 1])
    const g = M.gate
    const keep = g ? path.filter(([x, z]) => Math.hypot(x - g.x, z - g.z) > 180) : path
    B.path = keep
    B.len = keep.length * 2
    return { pts: keep.length, rough: window.__lines === M.trails.lines && (M.trails.rough || []).includes(li) }
  }, li, dir)
  if (setup.pts < 6) continue
  const events = []
  let from = 0
  const place = (i) => p.evaluate((i) => {
    const o = window.__oth, B = window.__bot, sim = o.car.sim, path = B.path
    const [x0, z0] = path[i], [x1, z1] = path[Math.min(i + 3, path.length - 1)]
    sim.place(x0, Math.max(o.height(x0, z0), o.world.map.bridgeAt(x0, z0) ?? -1e9) + 0.8, z0, Math.atan2(-(x1 - x0), -(z1 - z0)))
    B.i = i; B.done = false; B.on = true; B.lateral = 0; B.brush = []
  }, i)
  await place(0)
  await sleep(250)
  let simT = 0
  const cap = setup.pts * 2 / 2.2 + 60 // (seconds of game time: ~8 km/h average at worst)
  let hist = []
  let done = false
  while (!done && simT < cap) {
    // a batch of fixed steps (5 s of game time), then frames (the rocks / trunks / ground tiles stream round the car)
    const s = await p.evaluate(() => {
      const o = window.__oth, pw = o.physics.pw, car = o.car, B = window.__bot, sim = car.sim
      const out = []
      for (let k = 0; k < 300; k++) {
        pw.advance(1 / 60, (fdt) => car.fixed(fdt))
        if (k % 6 === 0) {
          // what the car's brushing (a 3.2 m ball): kept for 4 s, each by its kind — the event names what it hit
          const t = sim.body.translation(), P = o.physics, now = (B.clock = (B.clock || 0) + 0.1)
          P.pw.world.intersectionsWithShape(t, { x: 0, y: 0, z: 0, w: 1 }, new P.R.Ball(3.2), (c) => {
            const bh = c.parent()?.handle
            if (bh === sim.body.handle) return true
            for (const b of P.tiles.values()) if (b.handle === bh) return true
            let kind = 'other'
            for (const [i, cs] of P.rocks) if (cs.some((q) => q.handle === c.handle)) kind = 'rock'
            for (const q of P.trunks.values()) if (q.handle === c.handle) kind = 'trunk'
            for (const q of P.propCols.values()) if (q.handle === c.handle) kind = 'prop'
            if (kind === 'other' && P.statics.some((b) => b.handle === bh)) kind = 'static'
            const p = c.parent()?.translation(), ct = c.translation()
            const at = kind === 'static' || kind === 'rock' ? ct : p ?? ct
            B.brush = (B.brush || []).filter((e) => now - e.t < 4 && e.key !== kind + c.handle)
            B.brush.push({ t: now, key: kind + c.handle, what: `${kind}@${Math.round(at.x)},${Math.round(at.z)}` })
            return true
          })
        }
        if (window.__trace && B.i >= window.__trace[0] && B.i <= window.__trace[1] && k % 6 === 5) {
          const t = sim.body.translation(), q = sim.body.rotation(), v = sim.body.linvel(), hits = []
          const P = o.physics
          P.pw.world.intersectionsWithShape(t, { x: 0, y: 0, z: 0, w: 1 }, new P.R.Ball(3.2), (c) => { if (c.parent()?.handle !== sim.body.handle && ![...P.tiles.values()].some((b) => b.handle === c.parent()?.handle)) { const p = c.translation(); hits.push(Math.round(p.x) + ',' + Math.round(p.y) + ',' + Math.round(p.z)) } return true })
          console.log('TRACE', B.i, t.x.toFixed(1), t.y.toFixed(2), t.z.toFixed(1), 'gnd', o.height(t.x, t.z).toFixed(2), 'off', B.lateral.toFixed(2), 'kmh', (Math.abs(sim.speed) * 3.6).toFixed(0), 'up', (1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2), 'vy', v.y.toFixed(2), 'steer', sim.controls.steer.toFixed(2), 'thr', sim.controls.throttle.toFixed(2), 'wheels', sim.wheels.map((w) => (w.contact ? 1 : 0)).join(''), hits.join(' '))
        }
        if (k % 30 === 29) {
          const t = sim.body.translation(), q = sim.body.rotation()
          out.push({ x: t.x, y: t.y, z: t.z, i: B.i, off: B.lateral, kmh: Math.abs(sim.speed) * 3.6, upY: 1 - 2 * (q.x * q.x + q.z * q.z), agl: t.y - Math.max(o.height(t.x, t.z), o.world.map.bridgeAt(t.x, t.z) ?? -1e9), done: !!B.done })
        }
        if (B.done) { const t = sim.body.translation(); out.push({ x: t.x, y: t.y, z: t.z, i: B.i, off: 0, kmh: 0, upY: 1, agl: 0, done: true }); break }
      }
      return out
    })
    simT += 5
    if (process.env.VERBOSE && s.length) { const r = s[s.length - 1]; console.log(`    t${simT} ${r.i}/${setup.pts} ${Math.round(r.x)},${Math.round(r.z)} ${Math.round(r.kmh)}km/h off ${r.off.toFixed(1)} up ${r.upY.toFixed(2)} agl ${r.agl.toFixed(1)}`) }
    for (const r of s) {
      hist.push(r)
      if (r.done) { done = true; break }
      let ev = null
      if (r.upY < 0.35) ev = 'FLIP'
      else if (r.off > 6) ev = 'OFF'
      else if (r.agl > 2.5) ev = 'AIR'
      else if (hist.length > 10) { const h = hist[hist.length - 11]; if (Math.hypot(r.x - h.x, r.z - h.z) < 2) ev = 'STALL' }
      if (ev) {
        const info = await p.evaluate((r) => {
          const o = window.__oth, B = window.__bot, path = B.path, H = (x, z) => o.height(x, z)
          // the grade over the next / last 10 m along the line, the worst 2 m step within ±16 m
          const at = (k) => path[Math.max(0, Math.min(path.length - 1, k))]
          const g = (k0, k1) => { const a = at(k0), c = at(k1); return (H(c[0], c[1]) - H(a[0], a[1])) / Math.max(0.1, Math.hypot(c[0] - a[0], c[1] - a[1])) }
          let worst = 0, wi = r.i
          for (let k = r.i - 8; k < r.i + 8; k++) { const s = Math.abs(g(k, k + 1)); if (s > worst) { worst = s; wi = k } }
          const side = (() => { const a = at(r.i), c = at(r.i + 1), dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L; return (H(a[0] + nx * 2.5, a[1] + nz * 2.5) - H(a[0] - nx * 2.5, a[1] - nz * 2.5)) / 5 })()
          const rock = o.rockNear(r.x, r.z, 8)
          let trunk = null
          const T = o.world.trees, d = T.data
          for (let k = 0; k < T.count; k++) { const q = k * 8, dd = Math.hypot(d[q] - r.x, d[q + 2] - r.z); if (dd < 6 && (!trunk || dd < trunk.d)) trunk = { d: +dd.toFixed(1), sp: d[q + 5] } }
          const water = o.world.map.waterAt(r.x, r.z)
          // what the car's touching (a 4 m ball round it): ground tiles, rocks, trunks, props, the statics (bridges, landmarks, walls)
          const P = o.physics, W = P.pw.world, sim = o.car.sim, hits = []
          const cat = (c) => {
            const b = c.parent()
            for (const t of P.tiles.values()) if (t.handle === b?.handle) return null
            for (const [i, cs] of P.rocks) if (cs.some((k) => k.handle === c.handle)) return 'rock' + i
            for (const [i, k] of P.trunks) if (k.handle === c.handle) return 'trunk' + i
            for (const [i, k] of P.propCols) if (k.handle === c.handle) return 'prop' + i + (P.props[i]?.kind ? ':' + P.props[i].kind : '')
            if (P.statics.some((t) => t.handle === b?.handle)) return 'static'
            return 'other'
          }
          W.intersectionsWithShape({ x: r.x, y: r.y, z: r.z }, { x: 0, y: 0, z: 0, w: 1 }, new P.R.Ball(4), (c) => {
            if (c.parent()?.handle === sim.body.handle) return true
            const k = cat(c); if (k) { const t = c.translation(); hits.push(k + '@' + Math.round(t.x) + ',' + Math.round(t.y) + ',' + Math.round(t.z)) }
            return hits.length < 6
          })
          return { gradeAhead: +g(r.i, r.i + 5).toFixed(2), gradeBack: +g(r.i - 5, r.i).toFixed(2), worstStep: +worst.toFixed(2), worstAt: at(wi).map((v) => Math.round(v)), cross: +side.toFixed(2), rock: rock ? JSON.stringify(rock).slice(0, 120) : null, trunk, water: water === null ? null : +(water - H(r.x, r.z)).toFixed(2), bridge: o.world.map.bridgeAt(r.x, r.z) !== null, touching: hits, brushed: [...new Set((B.brush || []).map((e) => e.what))] }
        }, r)
        const e = { ev, i: r.i, of: setup.pts, x: Math.round(r.x), z: Math.round(r.z), kmh: Math.round(r.kmh), off: +r.off.toFixed(1), upY: +r.upY.toFixed(2), ...info }
        events.push(e)
        if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.screenshot({ path: `${process.env.SHOTS}/l${li}${dir}_${events.length}_${ev}.jpg`, quality: 70 }) }
        console.log(`  line ${li} ${dir}: ${ev} at ${e.x},${e.z} (${r.i}/${setup.pts})`, JSON.stringify(info))
        from = Math.min(setup.pts - 3, Math.max(r.i, from) + 7)
        if (from >= setup.pts - 4) { done = true; break }
        await place(from)
        await sleep(100)
        hist = []
        break
      }
    }
    await sleep(60)
  }
  const last = hist[hist.length - 1]
  const row = { line: li, dir, rough: setup.rough, m: setup.pts * 2, done, simT, events, end: done || !last ? null : { i: last.i, x: Math.round(last.x), z: Math.round(last.z) } }
  report.lines.push(row)
  console.log(`line ${li} ${dir}${setup.rough ? ' (rough)' : ''}: ${setup.pts * 2} m, ${simT}s game, ${done ? 'end' : 'TIMED OUT'}, ${events.length} problem(s)   [${Math.round((Date.now() - t0) / 1000)}s]`)
  fs.writeFileSync(out, JSON.stringify(report, null, 1))
}
await p.evaluate(() => { window.__bot.on = false })
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
