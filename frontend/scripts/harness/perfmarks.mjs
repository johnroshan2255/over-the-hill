// perfmarks.mjs <mode> [file] — the in-game PERF MARKS (src/oth/PerfMarks.ts, F9) from the harness.
//   drive  — the car carried along every valley track at SPEED m/s on the CHASE camera zoomed out to ZOOM m (the
//            user's view, 2026-11-08: 40 m over a meadow, 134 fps), the tool on: every spot it marks (a half second
//            ≥ 1.5× the usual frame, or a stall) written to [file] (default perfmarks.json)
//   why    — each mark in [file] flown back to (its camera's place and look) and each part of the world hidden in
//            turn: the GPU's frame with and without it — what made the drop. [file] may also be marks copied from a
//            player's own browser (`copy(JSON.stringify(__oth.perfMarks()))` in its console).
//   node scripts/harness/perfmarks.mjs drive marks.json   env: SPEED (22) ZOOM (40) TRACKS (all | 0,3) TIER (ultra) QS
//            SET (tracks — the valley's | roads — the outland's | paths — the narrow ways | all: every way there is)
//            HITCHMS (70: headless Chrome uncapped has its own ~46 ms frames twice a second, standing still)
//   node scripts/harness/perfmarks.mjs why marks.json     env: TOP (12: the worst marks)
import puppeteer from 'puppeteer-core'
import { PACE_FN } from './pace.mjs'
import fs from 'node:fs'
const mode = process.argv[2] || 'drive', file = process.argv[3] || 'perfmarks.json'
const TIER = process.env.TIER || 'ultra', SPEED = Number(process.env.SPEED || 22), ZOOM = Number(process.env.ZOOM || 40)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// (a browser and the game in it — again after a crash: a long drive outlived the page once, every mark with it)
async function open() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 3600000,
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio', '--enable-precise-memory-info'],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log(`page error: ${e.message.slice(0, 200)}`))
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${TIER}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0&perfmark=${mode === 'drive' ? 1 : 0}&hitchms=${process.env.HITCHMS || 70}${process.env.QS ? `&${process.env.QS}` : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await sleep(2000)
  console.log(await p.evaluate(() => window.__oth.backend))
  return { b, p }
}
let { b, p } = await open()
// (stopped — Ctrl-C, a kill: the browser closed too; left running it renders on, uncapped, under every later measure)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
if (mode === 'drive') {
  await p.evaluate(() => { window.__oth.perfMarks().length = 0 })
  // (SET — 2026-11-17, the user: "walk around all the paths": the outland's roads and the narrow ways too)
  const SET = process.env.SET || 'tracks'
  const tracks = await p.evaluate((SET) => {
    const m = window.__oth.world.map.meta
    const sets = { tracks: m.trails.lines, roads: m.outland?.trails?.lines ?? [], paths: m.paths?.lines ?? [] }
    return SET === 'all' ? [...sets.tracks, ...sets.roads, ...sets.paths] : sets[SET]
  }, SET)
  console.log(`${SET}: ${tracks.length} lines`)
  const want = process.env.TRACKS ? process.env.TRACKS.split(',').map(Number) : tracks.map((_, i) => i)
  const START = Number(process.env.START || 0)
  // (the car out, the chase camera zoomed out to ZOOM m — 3.5–40)
  const ready = async () => {
    await p.evaluate(() => { window.__oth.perfMarks().length = 0 })
    await p.evaluate(() => window.__oth.drive(true))
    for (let k = 0; k < 30; k++) await p.keyboard.press('Minus')
    for (let k = 0; k < Math.round(Math.log(40 / ZOOM) / Math.log(1 / 0.85)); k++) await p.keyboard.press('Equal')
  }
  await ready()
  // (the marks written after every way — those of the browsers before a crash kept: `before`)
  let before = []
  const save = async () => { const now = await p.evaluate(() => window.__oth.perfMarks()); fs.writeFileSync(file, JSON.stringify([...before, ...now], null, 1)); return before.length + now.length }
  const t0 = Date.now()
  for (const ti of want) {
    if (ti < START) continue
    let r
    try {
      const L = tracks[ti]
      r = await p.evaluate(async (L, speed) => {
        const o = window.__oth
        const pts = []
        for (let i = 1; i < L.length; i++) {
          const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az)
          for (let s = 0; s < d; s += 1) pts.push([ax + (bx - ax) * (s / d), az + (bz - az) * (s / d)])
        }
        if (pts.length < 40) return { n: 0 }
        const at = (d) => pts[Math.min(pts.length - 1, Math.max(0, Math.floor(d)))]
        const head = (d) => { const a = at(d), q = at(d + 8); return Math.atan2(-(q[0] - a[0]), -(q[1] - a[1])) }
        o.car.placeAt(pts[0][0], pts[0][1], head(0))
        await new Promise((r) => setTimeout(r, 5000)) // (the tool's settle after the jump, the ground baked)
        const n0 = o.perfMarks().length
        const T = (pts.length - 10) / speed * 1000, t0 = performance.now()
        await new Promise((r) => {
          const f = () => {
            const d = ((performance.now() - t0) / 1000) * speed, q = at(d)
            o.car.placeAt(q[0], q[1], head(d))
            if (performance.now() - t0 < T) requestAnimationFrame(f); else r()
          }
          requestAnimationFrame(f)
        })
        return { n: o.perfMarks().length - n0, km: pts.length / 1000 }
      }, L, SPEED)
      r.heap = await p.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6))
      await save()
    } catch (e) {
      console.log(`way ${ti}: the page died (${String(e.message).slice(0, 80)}) — a new browser, on from way ${ti + 1}`)
      try { before = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { before = [] }
      try { await b.close() } catch {}
      ;({ b, p } = await open())
      await ready()
      continue
    }
    console.log(`way ${ti}: ${r.km?.toFixed(2) ?? 0} km, ${r.n} new marks, heap ${r.heap} MB  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
  await save()
  const marks = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`${marks.length} marks → ${file}`)
  for (const m of [...marks].sort((a, b) => b.ms - a.ms).slice(0, 25)) console.log(`  ${m.kind.padEnd(5)} ${String(m.fps).padStart(4)} fps (usual ${m.baseFps}) ×${m.count}  cam ${m.cx},${m.cy},${m.cz} yaw ${m.yaw} pitch ${m.pitch}  cpu ${m.cpuMs}  ${m.drawn.draws}d ${Math.round(m.drawn.tris / 1000)}k blades ${m.drawn.blades}`)
} else {
  const marks = JSON.parse(fs.readFileSync(file, 'utf8')).filter((m) => m.world === 'valley').sort((a, b) => b.ms - a.ms).slice(0, Number(process.env.TOP || 12))
  // (pace.mjs, 2026-11-18: the slope between two drained windows — was 3 × 100 frames each drained, `gpuDone`'s constant
  //  ~0.6 s late answer charged to 100 frames: +6 ms on every "here now"; the parts' with / without differences were right)
  const ft = () => p.evaluate(PACE_FN(100, 400))
  for (const m of marks) {
    process.stdout.write(`${m.kind} at ${m.cx},${m.cz}: flying there… `)
    await p.evaluate((m) => window.__oth.view(m.cx, m.cz, m.agl, m.yaw, m.pitch), m)
    await sleep(2500)
    const all = await ft()
    process.stdout.write(`${all.toFixed(2)} ms; each part… `)
    const names = await p.evaluate(() => Object.keys(window.__oth.parts()))
    const rows = []
    for (const n of names) {
      let on = 0, off = 0
      for (let k = 0; k < 2; k++) {
        await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n); on += await ft()
        await p.evaluate((n) => (window.__oth.parts()[n].visible = false), n); off += await ft()
      }
      await p.evaluate((n) => (window.__oth.parts()[n].visible = true), n)
      rows.push([n, (on - off) / 2])
    }
    rows.sort((a, b) => b[1] - a[1])
    console.log(`${m.kind} ${m.fps} fps (usual ${m.baseFps}) at ${m.cx},${m.cz} — here now ${all.toFixed(2)} ms: ${rows.slice(0, 6).map(([n, v]) => `${n} ${v.toFixed(2)}`).join(' · ')}`)
  }
}
await b.close()
