// tour.mjs <mode> [outFile] — THE VALLEY TOUR (2026-11-07, the user: "travel around all places in the valley and check
// places with fps drop"): every valley track and every place, at a chase camera's height, uncapped 1080p.
//   sweep  — the GPU's cost SPOT BY SPOT: a point every STEP m along every track (both ways) + each place from 26 m (+
//            inside the caves); at each, the frame GPU-drained over 80 frames once the moved-to ground has baked. The
//            worst spots, and how far each sits above the run's median.
//   drive  — the HITCHES: the camera flown along every track at SPEED m/s in real time; every frame's interval, the
//            page's JavaScript in it, and each system's update (wrapped from here, no game code changed). Frames over
//            2.5× the median are listed with where they happened and what took the time.
//   node scripts/harness/tour.mjs sweep tour.json       env: STEP (90) TIER (ultra) PORT (5200) QS (extra URL params) ONLY=places
//   node scripts/harness/tour.mjs drive drive.json      env: SPEED (25) TRACKS (all, or e.g. 0,3,7)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const mode = process.argv[2] || 'sweep', out = process.argv[3]
const TIER = process.env.TIER || 'ultra', STEP = Number(process.env.STEP || 90), SPEED = Number(process.env.SPEED || 25)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 1800000,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log(`page error: ${e.message.slice(0, 200)}`))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`console error: ${m.text().slice(0, 200)}`) })
// (every rAF callback timed: the page's JavaScript per frame)
await p.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__js = 0
  window.requestAnimationFrame = (cb) => raf((t) => { const s = performance.now(); cb(t); window.__js += performance.now() - s })
})
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${TIER}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${process.env.QS ? `&${process.env.QS}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2000)

// the tracks, resampled every `step` m (x, z, yaw along)
const tracks = await p.evaluate(() => window.__oth.world.map.meta.trails.lines)
const resample = (L, step) => {
  const pts = []
  let acc = 0
  for (let i = 1; i < L.length; i++) {
    const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az)
    while (acc <= d) { const t = acc / d; pts.push([ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(-(bx - ax), -(bz - az))]); acc += step }
    acc -= d
  }
  return pts
}
const lenOf = (L) => L.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - L[i - 1][0], q[1] - L[i - 1][1]) : 0), 0)
console.log(`${tracks.length} tracks, ${(tracks.reduce((s, L) => s + lenOf(L), 0) / 1000).toFixed(1)} km`)

if (mode === 'sweep') {
  const spots = []
  tracks.forEach((L, ti) => resample(L, STEP).forEach(([x, z, yaw], k) => {
    spots.push({ n: `t${ti}.${k}`, x, z, h: 3, yaw, pitch: -0.07 })
    spots.push({ n: `t${ti}.${k}r`, x, z, h: 3, yaw: yaw + Math.PI, pitch: -0.07 })
  }))
  const places = await p.evaluate(() => window.__oth.world.places.map((l) => ({ id: l.id, kind: l.kind, name: l.name, x: l.x, z: l.z, rot: l.rot })))
  for (const l of places) {
    const d = 26, a = l.rot + 0.4, x = l.x + Math.sin(a) * d, z = l.z + Math.cos(a) * d
    spots.push({ n: `${l.kind}:${l.name}`, x, z, h: 4, yaw: Math.atan2(-(l.x - x), -(l.z - z)), pitch: -0.12 })
    if (l.kind === 'tunnel' || l.kind === 'cavern') spots.push({ n: `${l.kind}:${l.name}:in`, x: l.x - Math.sin(l.rot) * 6, z: l.z - Math.cos(l.rot) * 6, h: 2.4, yaw: l.rot + Math.PI, pitch: -0.03 })
  }
  if (process.env.ONLY === 'places') spots.splice(0, spots.length, ...spots.filter((q) => q.n.includes(':')))       // ONLY=places: the places alone
  console.log(`${spots.length} spots`)
  const res = []
  const t0 = Date.now()
  for (const s of spots) {
    const r = await p.evaluate(async (s) => {
      const o = window.__oth
      o.view(s.x, s.z, s.h, s.yaw, s.pitch)
      // (the moved-to ground bakes over the next frames: let it settle)
      await new Promise((r) => { let n = 0; const f = () => { if (++n < 40) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
      // (pace.mjs's way: two drained windows, the slope — `gpuDone` answers a constant ~0.6 s late on the release build,
      //  which "80 frames drained" charged to the frame: ~+7 ms on every spot)
      const run = async (n) => { await o.gpuDone(); const t0 = performance.now(); await new Promise((r) => { let k = 0; const f = () => { if (++k < n) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) }); await o.gpuDone(); return performance.now() - t0 }
      const j0 = window.__js
      const ta = await run(60), tb = await run(300)
      const ms = (tb - ta) / 240, st = o.stats()
      return { ms, js: (window.__js - j0) / 360, draws: st.draws, tris: st.tris, trees: st.trees, cpu: st.cpuMs }
    }, s)
    res.push({ ...s, ...r })
    if (res.length % 25 === 0) console.log(`  ${res.length}/${spots.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
  const ms = res.map((r) => r.ms).sort((a, b) => a - b)
  const med = ms[Math.floor(ms.length / 2)], p90 = ms[Math.floor(ms.length * 0.9)]
  console.log(`median ${med.toFixed(3)} ms (${(1000 / med).toFixed(0)} fps)  p90 ${p90.toFixed(3)}  max ${ms[ms.length - 1].toFixed(3)}  mean ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3)}`)
  console.log('worst 30:')
  for (const r of [...res].sort((a, b) => b.ms - a.ms).slice(0, 30)) console.log(`  ${r.n.padEnd(34)} ${r.ms.toFixed(3)} ms ${String(Math.round(1000 / r.ms)).padStart(5)} fps  ×${(r.ms / med).toFixed(2)}  js ${r.js.toFixed(2)}  ${r.draws}d ${(r.tris / 1000).toFixed(0)}k  at ${r.x.toFixed(0)},${r.z.toFixed(0)} yaw ${r.yaw.toFixed(2)}`)
  if (out) fs.writeFileSync(out, JSON.stringify({ med, res }, null, 0))
} else {
  const want = process.env.TRACKS ? process.env.TRACKS.split(',').map(Number) : tracks.map((_, i) => i)
  // wrap each system's update / cull from here: its time per frame (no game code changed)
  await p.evaluate(() => {
    const o = window.__oth, w = o.world
    window.__sys = {}
    const wrap = (name, obj, fn) => {
      if (!obj || typeof obj[fn] !== 'function') return
      const f = obj[fn].bind(obj)
      obj[fn] = (...a) => { const s = performance.now(); const r = f(...a); window.__sys[name] = (window.__sys[name] || 0) + performance.now() - s; return r }
    }
    for (const k of ['horizon', 'terrain', 'grass', 'rocks', 'trees', 'bushes', 'props', 'formations', 'glow', 'birds']) wrap(k, w[k], 'update')
    wrap('landmarks', w.landmarks, 'update'); wrap('lmCull', w.landmarks, 'cull'); wrap('bridges', w.bridges, 'cull'); wrap('falls', w.falls, 'cull')
    wrap('prepare', o.renderer, 'prepare')
    wrap('atmos', o.atmos, 'update')
  })
  const all = []
  for (const ti of want) {
    const L = tracks[ti], pts = resample(L, 1)
    if (pts.length < 30) continue
    // (in the page: every frame's interval kept; the JS, the place and each system's time only for frames over 3 ms —
    //  a frame-by-frame record of 75 k frames was most of the tour's time)
    const r = await p.evaluate(async (pts, speed) => {
      const o = window.__oth, dts = [], slow = []
      const at = (d) => { const i = Math.min(pts.length - 1, Math.max(0, Math.floor(d))); return pts[i] }
      // (yaw toward the point 12 m ahead: a chase camera's look)
      const look = (d) => { const a = at(d), q = at(d + 12); return Math.atan2(-(q[0] - a[0]), -(q[1] - a[1])) }
      o.view(pts[0][0], pts[0][1], 3, look(0), -0.07)
      await new Promise((r) => setTimeout(r, 1200))
      await o.gpuDone()
      window.__sys = {} // (not the settle's: the first record would hold all of it)
      const t0 = performance.now()
      let last = t0, js0 = window.__js
      const T = (pts.length - 13) / speed * 1000
      await new Promise((r) => {
        const f = () => {
          const n = performance.now(), d = (n - t0) / 1000 * speed, dt = n - last
          const sys = window.__sys; window.__sys = {}
          dts.push(dt)
          if (dt > 3) { const q = at(d); slow.push([dts.length - 1, dt, window.__js - js0, q[0], q[1], sys]) }
          last = n; js0 = window.__js
          const q = at(d)
          o.view(q[0], q[1], 3, look(d), -0.07)
          if (n - t0 < T) requestAnimationFrame(f); else r()
        }
        requestAnimationFrame(f)
      })
      await o.gpuDone()
      return { dts, slow, total: performance.now() - t0 }
    }, pts, SPEED)
    const dts = r.dts.slice(1).sort((a, b) => a - b), N = r.dts.length
    const med = dts[Math.floor(dts.length / 2)], p99 = dts[Math.floor(dts.length * 0.99)], max = dts[dts.length - 1]
    const hitches = r.slow.filter((q) => q[0] >= 2 && q[1] >= Math.max(2.5 * med, med + 4)).map(([i, dt, js, x, z, sys]) => ({ i, dt, js, x, z, sys: Object.entries(sys).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ') }))
    console.log(`track ${ti}: ${(lenOf(L) / 1000).toFixed(2)} km  ${N} frames  mean ${(r.total / N).toFixed(2)}  median ${med.toFixed(2)}  p99 ${p99.toFixed(2)}  max ${max.toFixed(1)} ms   ${hitches.length} hitches`)
    for (const h of hitches.slice(0, 12)) console.log(`    #${h.i} ${h.dt.toFixed(1)} ms  js ${h.js.toFixed(1)}  at ${h.x.toFixed(0)},${h.z.toFixed(0)}   [${h.sys}]`)
    // (a build that logs its slow mesh preparations — window.__slow: [ms, name, material, vertices, instances, attributes])
    const slow = await p.evaluate(() => { const s = window.__slow ?? []; window.__slow = []; return s })
    if (slow.length) {
      const by = new Map()
      for (const [ms, n, m, v, inst, at] of slow) { const k = `${n} [${m}] v${v} i${inst}`; const e = by.get(k) ?? { n: 0, ms: 0, max: 0, at }; e.n++; e.ms += ms; e.max = Math.max(e.max, ms); by.set(k, e) }
      for (const [k, e] of [...by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)) console.log(`      slow prepare: ${k}  ×${e.n}  total ${e.ms.toFixed(1)} max ${e.max.toFixed(1)} ms   ${e.at}`)
    }
    all.push({ ti, km: lenOf(L) / 1000, frames: N, med, p99, max, mean: r.total / N, hitches })
  }
  // the whole valley: frames, the worst tracks, every hitch over 8 ms with where it was
  const F = all.reduce((s, t) => s + t.frames, 0), H = all.flatMap((t) => t.hitches.map((h) => ({ ...h, ti: t.ti })))
  console.log(`ALL: ${all.length} tracks, ${all.reduce((s, t) => s + t.km, 0).toFixed(1)} km, ${F} frames, mean ${(all.reduce((s, t) => s + t.mean * t.frames, 0) / F).toFixed(3)} ms; ${H.length} hitches (${(100 * H.length / F).toFixed(3)} % of frames); worst p99 ${Math.max(...all.map((t) => t.p99)).toFixed(2)} ms`)
  for (const h of H.filter((q) => q.dt > 8).sort((a, b) => b.dt - a.dt).slice(0, 20)) console.log(`  ${h.dt.toFixed(1)} ms  js ${h.js.toFixed(1)}  track ${h.ti} at ${h.x.toFixed(0)},${h.z.toFixed(0)}  [${h.sys}]`)
  if (out) fs.writeFileSync(out, JSON.stringify(all))
}
await b.close()
