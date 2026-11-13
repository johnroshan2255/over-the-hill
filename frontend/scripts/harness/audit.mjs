// audit.mjs <dir> — THE ROADS' AUDIT (2026-11-13, the user: "travel through all the roads and paths, mark every issue,
// fix them, play again — in a loop"). Two parts, on the valley at ULTRA, golden hour:
//   DATA   every placed thing against the ground under its whole footprint — the landmarks (and those Landmarks had to
//          set down: `settled`), the Wardens' pieces that stand on the ground, the props — FLOATING (a corner over the
//          ground) or SUNK; and every box track and outland road sampled every 8 m: TILTED across (the car would roll),
//          a STEP along it, a COLLIDER standing in it. → <dir>/issues.json, a count per kind on stdout.
//   TOUR   a chase-camera shot every STEP m along every road and track (and one at each of the first SHOTS issues),
//          numbered, laid out 4 × 3 on contact sheets with captions → <dir>/sheet_NN.png (the shots in <dir>/shots/).
// env: STEP (m, 450), SHOTS (issues shot, 36), TOUR=0 (data only), Q (extra URL params), PORT (5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
const dir = process.argv[2] || 'vg/audit'
fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
const STEP = Number(process.env.STEP || 450), NSHOT = Number(process.env.SHOTS || 36)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=640,360'], defaultViewport: { width: 640, height: 360 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&hour=16.8&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 300000, polling: 300 })
await p.addStyleTag({ content: 'body > :not(canvas):not([style*="radial-gradient"]) { display: none !important; }' })

// ------------------------------------------------------------------------------------------------------------ DATA
const data = await p.evaluate(() => {
  const o = window.__oth, w = o.world, m = o.map, H = (x, z) => m.height(x, z), out = []
  const add = (kind, x, z, detail) => out.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1), detail })
  // the ground under a turned rectangle (centre, half sizes, yaw): its lowest and highest of 9 points
  const under = (x, z, hx, hz, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot); let lo = 1e9, hi = -1e9
    for (const a of [-1, 0, 1]) for (const d of [-1, 0, 1]) { const g = H(x + (a * hx * c + d * hz * s), z + (-a * hx * s + d * hz * c)); lo = Math.min(lo, g); hi = Math.max(hi, g) }
    return [lo, hi]
  }
  for (const s of w.landmarks.settled ?? []) add('landmark-settled', 0, 0, s)
  for (const l of m.meta.landmarks ?? []) {
    if (['shack', 'dock', 'wreck', 'cave'].includes(l.kind)) continue
    const g = H(l.x, l.z)
    if (Math.abs(l.y - g) > 0.8) add('landmark-off-ground', l.x, l.z, `${l.name} y ${l.y.toFixed(1)} ground ${g.toFixed(1)}`)
  }
  // the Wardens' pieces that stand on the ground (their foot within 2.5 m of it, not tilted far)
  const STAND = new Set(['block', 'wallwin', 'walldoor', 'wallbrk', 'tower', 'arch', 'column', 'stump', 'drywall', 'drywall2', 'rubble', 'bricks', 'timber', 'crate', 'barrel', 'camp', 'watch', 'lantern', 'obelisk', 'stone', 'paving', 'stair'])
  for (const q of w.wardens?.pieces ?? []) {
    if (!STAND.has(q.k) || Math.abs(q.tx ?? 0) > 0.3 || Math.abs(q.tz ?? 0) > 0.3) continue
    const g = H(q.x, q.z)
    if (q.y - g > 2.5 || q.y - g < -6) continue        // (a lintel, a stacked piece; a pier in a lake)
    const hx = (q.k === 'tower' || q.k === 'column' || q.k === 'stump') ? q.sx * 0.45 : q.k === 'camp' ? 3 : q.k === 'watch' ? 1.45 : q.sx / 2
    const hz = (q.k === 'tower' || q.k === 'column' || q.k === 'stump') ? q.sz * 0.45 : q.k === 'camp' ? 2.5 : q.k === 'watch' ? 1.45 : q.sz / 2
    const [lo] = under(q.x, q.z, hx, hz, q.rot)
    if (q.y - lo > 0.25) add('piece-floating', q.x, q.z, `${q.k} ${q.sx.toFixed(1)}×${q.sz.toFixed(1)} foot ${q.y.toFixed(1)}, ground under it from ${lo.toFixed(1)} (${(q.y - lo).toFixed(2)} m in the air)`)
  }
  for (const q of o.props.props ?? []) {
    const g = H(q.x, q.z)
    if (Math.abs(q.y - g) > 0.6) add('prop-off-ground', q.x, q.z, `${q.kind} y ${q.y.toFixed(1)} ground ${g.toFixed(1)}`)
  }
  // the ways: box tracks and outland roads, every 8 m
  const ways = [...m.meta.trails.lines.map((L, i) => ({ L, hw: m.meta.trails.hw, name: `track ${i}` })), ...(m.meta.outland?.trails?.lines ?? []).map((L, i) => ({ L, hw: m.roadHW, name: `road ${i}` }))]
  const cols = [...(o.props.colliders ?? [])]
  const ch = new Map(); for (const c of cols) { const k = Math.floor(c.x / 32) * 4096 + Math.floor(c.z / 32); const l = ch.get(k); if (l) l.push(c); else ch.set(k, [c]) }
  let len = 0
  for (const { L, hw, name } of ways) {
    let carry = 0, prevY = null, prevD = null
    for (let k = 0; k + 1 < L.length; k++) {
      const ax = L[k][0], az = L[k][1], dx = L[k + 1][0] - ax, dz = L[k + 1][1] - az, sl = Math.hypot(dx, dz)
      if (sl < 1e-3) continue
      const ux = dx / sl, uz = dz / sl
      let t = carry
      for (; t < sl; t += 8) {
        const x = ax + ux * t, z = az + uz * t, y = H(x, z), b0 = m.bridgeAt(x, z)
        len += 8
        if (b0 !== null) { prevY = null; prevD = null; continue }
        const w = hw * 0.7, yl = H(x - uz * w, z + ux * w), yr = H(x + uz * w, z - ux * w), tilt = Math.abs(yl - yr) / (2 * w)   // (the wheels' width: the edge itself meets a bank or a cliff's foot)
        if (tilt > 0.3) add('road-tilted', x, z, `${name}: ${(tilt * 100).toFixed(0)} % across`)
        // (a STEP: the grade changing at once — a steady climb, however steep, is a climb)
        const dY = prevY === null ? null : y - prevY
        if (dY !== null && prevD !== null && Math.abs(dY - prevD) > 2.2) add('road-step', x, z, `${name}: the grade jumps ${prevD.toFixed(1)} → ${dY.toFixed(1)} m per 8 m`)
        prevY = y; prevD = dY
        for (const c of ch.get(Math.floor(x / 32) * 4096 + Math.floor(z / 32)) ?? []) {
          if (c.ground) continue
          const r = Math.hypot(c.hx, c.hz)
          if (Math.hypot(c.x - x, c.z - z) < hw * 0.7 + r * 0.6 && c.y - c.hy < y + 1.2 && c.y + c.hy > y + 0.2) add('road-blocked', x, z, `${name}: a collider ${(2 * c.hx).toFixed(1)}×${(2 * c.hz).toFixed(1)} m in the way`)
        }
      }
      carry = t - sl
    }
  }
  return { issues: out, km: len / 1000, ways: ways.map((q) => ({ L: q.L, name: q.name })) }
})
// (the same spot reported once: issues within 6 m of one of the same kind merged)
const issues = []
for (const q of data.issues) if (!issues.some((r) => r.kind === q.kind && Math.hypot(r.x - q.x, r.z - q.z) < 6)) issues.push(q)
fs.writeFileSync(path.join(dir, 'issues.json'), JSON.stringify(issues, null, 1))
const count = {}
for (const q of issues) count[q.kind] = (count[q.kind] ?? 0) + 1
console.log(`ways ${data.km.toFixed(1)} km; issues:`, JSON.stringify(count))

// ------------------------------------------------------------------------------------------------------------ TOUR
if (process.env.TOUR !== '0') {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const stops = []
  for (const q of issues.filter((q) => q.kind !== 'landmark-settled').slice(0, NSHOT)) stops.push({ x: q.x + 9, z: q.z + 9, tx: q.x, tz: q.z, h: 4, cap: `${q.kind}: ${q.detail}` })
  for (const { L, name } of data.ways) {
    let acc = STEP * 0.5
    for (let k = 1; k < L.length; k++) {
      acc += Math.hypot(L[k][0] - L[k - 1][0], L[k][1] - L[k - 1][1])
      if (acc < STEP) continue
      acc = 0
      const j = Math.max(0, k - 3), ax = L[j][0], az = L[j][1], dx = L[k][0] - ax, dz = L[k][1] - az, d = Math.hypot(dx, dz) || 1
      stops.push({ x: L[k][0] - (dx / d) * 9, z: L[k][1] - (dz / d) * 9, tx: L[k][0] + (dx / d) * 22, tz: L[k][1] + (dz / d) * 22, h: 4.5, cap: `${name} @ ${k}` })
    }
  }
  console.log(`${stops.length} stops`)
  for (const [i, s] of stops.entries()) {
    await p.evaluate((s) => { const o = window.__oth, cy = o.height(s.x, s.z) + s.h, ty = o.height(s.tx, s.tz) + 1; o.view(s.x, s.z, s.h, Math.atan2(-(s.tx - s.x), -(s.tz - s.z)), Math.atan2(ty - cy, Math.hypot(s.tx - s.x, s.tz - s.z))) }, s)
    await sleep(1300)
    await p.screenshot({ path: path.join(dir, 'shots', `${String(i).padStart(4, '0')}.png`) })
  }
  // the contact sheets: 4 × 3, captioned
  const sheet = await b.newPage()
  await sheet.setViewport({ width: 1920, height: 1160 })
  for (let k = 0; k * 12 < stops.length; k++) {
    const cells = stops.slice(k * 12, k * 12 + 12).map((s, j) => {
      const i = k * 12 + j, img = fs.readFileSync(path.join(dir, 'shots', `${String(i).padStart(4, '0')}.png`)).toString('base64')
      return `<div><img src="data:image/png;base64,${img}"><span>${i} · ${s.cap.replace(/</g, '&lt;')}</span></div>`
    }).join('')
    await sheet.setContent(`<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(4,480px);gap:0}div{position:relative;width:480px;height:290px}img{width:480px;height:270px;display:block}span{font:12px sans-serif;color:#fc6;display:block;height:20px;overflow:hidden;white-space:nowrap;padding:0 4px}</style>${cells}`)
    await sheet.screenshot({ path: path.join(dir, `sheet_${String(k).padStart(2, '0')}.png`) })
  }
}
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await b.close()
