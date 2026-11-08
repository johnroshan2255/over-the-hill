// perfmarks.mjs <mode> [file] — the in-game PERF MARKS (src/oth/PerfMarks.ts, F9) from the harness.
//   drive  — the car carried along every valley track at SPEED m/s on the CHASE camera zoomed out to ZOOM m (the
//            user's view, 2026-11-08: 40 m over a meadow, 134 fps), the tool on: every spot it marks (a half second
//            ≥ 1.5× the usual frame, or a stall) written to [file] (default perfmarks.json)
//   why    — each mark in [file] flown back to (its camera's place and look) and each part of the world hidden in
//            turn: the GPU's frame with and without it — what made the drop. [file] may also be marks copied from a
//            player's own browser (`copy(JSON.stringify(__oth.perfMarks()))` in its console).
//   node scripts/harness/perfmarks.mjs drive marks.json   env: SPEED (22) ZOOM (40) TRACKS (all | 0,3) TIER (ultra) QS
//   node scripts/harness/perfmarks.mjs why marks.json     env: TOP (12: the worst marks)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const mode = process.argv[2] || 'drive', file = process.argv[3] || 'perfmarks.json'
const TIER = process.env.TIER || 'ultra', SPEED = Number(process.env.SPEED || 22), ZOOM = Number(process.env.ZOOM || 40)
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 3600000,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log(`page error: ${e.message.slice(0, 200)}`))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${TIER}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0&perfmark=${mode === 'drive' ? 1 : 0}${process.env.QS ? `&${process.env.QS}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2000)
console.log(await p.evaluate(() => window.__oth.backend))

if (mode === 'drive') {
  await p.evaluate(() => { window.__oth.perfMarks().length = 0 })
  const tracks = await p.evaluate(() => window.__oth.world.map.meta.trails.lines)
  const want = process.env.TRACKS ? process.env.TRACKS.split(',').map(Number) : tracks.map((_, i) => i)
  await p.evaluate(() => window.__oth.drive(true))
  // (zoomed out: − until the chase camera is ZOOM m back — 3.5–40)
  for (let k = 0; k < 30; k++) await p.keyboard.press('Minus')
  for (let k = 0; k < Math.round(Math.log(40 / ZOOM) / Math.log(1 / 0.85)); k++) await p.keyboard.press('Equal')
  const t0 = Date.now()
  for (const ti of want) {
    const L = tracks[ti]
    const r = await p.evaluate(async (L, speed) => {
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
    console.log(`track ${ti}: ${r.km?.toFixed(2) ?? 0} km, ${r.n} new marks  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
  const marks = await p.evaluate(() => window.__oth.perfMarks())
  fs.writeFileSync(file, JSON.stringify(marks, null, 1))
  console.log(`${marks.length} marks → ${file}`)
  for (const m of [...marks].sort((a, b) => b.ms - a.ms).slice(0, 25)) console.log(`  ${m.kind.padEnd(5)} ${String(m.fps).padStart(4)} fps (usual ${m.baseFps}) ×${m.count}  cam ${m.cx},${m.cy},${m.cz} yaw ${m.yaw} pitch ${m.pitch}  cpu ${m.cpuMs}  ${m.drawn.draws}d ${Math.round(m.drawn.tris / 1000)}k blades ${m.drawn.blades}`)
} else {
  const marks = JSON.parse(fs.readFileSync(file, 'utf8')).filter((m) => m.world === 'valley').sort((a, b) => b.ms - a.ms).slice(0, Number(process.env.TOP || 12))
  const ft = () => p.evaluate(async () => {
    const o = window.__oth, runs = []
    for (let k = 0; k < 3; k++) { await o.gpuDone(); const t0 = performance.now(); await new Promise((r) => { let n = 0; const f = () => { if (++n < 100) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) }); await o.gpuDone(); runs.push((performance.now() - t0) / 100) }
    runs.sort((a, b) => a - b); return runs[1]
  })
  for (const m of marks) {
    await p.evaluate((m) => window.__oth.view(m.cx, m.cz, m.agl, m.yaw, m.pitch), m)
    await sleep(2500)
    const all = await ft()
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
