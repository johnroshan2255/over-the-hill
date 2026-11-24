// funtour.mjs [outDir] — THE WORLD'S FUN THINGS, VISITED (2026-11-24, the user: "travel around the world and check all
// fun things"): every hidden vale, every place of the outland (the world tree, craters, mesas, arches, canyons, passes,
// views, the off-road rocks / bogs / fords), the outland's lakes and the waterfalls, one landmark of each kind (and one
// of each Warden style), the sunken courts, the sealed vaults' keystones, a narrow way of each kind (path, shortcut,
// secret passage, alley). At each: the car set down on gentle ground near it — does the ground hold it (its height
// against the map's after 2.5 s) —, the frame rate there (the chase camera, 1 s), then a still from 26 m off.
// A list of what was seen, the ones that FELL / FLEW, the slowest, and the page's errors.
//   node scripts/harness/funtour.mjs screenshots/funtour      env: PORT (5200), TIER (high), ONLY (a name part), MAX (per group, 99)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] || 'screenshots/funtour'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, TIER = process.env.TIER || 'high', ONLY = process.env.ONLY || '', MAX = Number(process.env.MAX || 99)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
await p.goto(`http://localhost:${PORT}/?tier=${TIER}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&companion=off`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car.sim, { timeout: 180000, polling: 250 })
await sleep(2000)

// THE SPOTS — by group, from the map and the world as the game made them
const spots = await p.evaluate((MAX) => {
  const o = window.__oth, M = o.map.meta, out = []
  const add = (group, name, x, z, r = 20) => { if (Number.isFinite(x) && Number.isFinite(z)) out.push({ group, name, x, z, r }) }
  for (const h of (M.hidden ?? []).slice(0, MAX)) add('hidden', `${h.kind}: ${h.name}`, h.x, h.z, h.r * 0.5)
  for (const pl of (M.outland?.places ?? []).slice(0, MAX * 3)) add('outland', `${pl.kind}: ${pl.name}`, pl.x, pl.z, pl.r ?? 30)
  for (const z of (M.outland?.zones ?? []).slice(0, MAX)) add('zone', `${z.kind}: ${z.name}`, z.x, z.z, z.r)
  for (const l of (M.outland?.lakes ?? []).slice(0, MAX)) add('lake', `lake: ${l.name}`, l.x + l.r + 12, l.z, 12)
  for (const [k, f] of (M.water?.falls ?? []).slice(0, Math.min(MAX, 6)).entries()) add('falls', `waterfall ${k}`, f.bx, f.bz, 10)
  // one landmark of each kind (a Warden: one of each style)
  const seen = new Set()
  for (const l of o.world.landmarks.list) {
    const key = l.kind === 'warden' ? `warden/${l.style ?? l.name.split(' ').slice(-1)[0]}` : l.kind
    if (seen.has(key)) continue
    seen.add(key)
    add('landmark', `${key}: ${l.name}`, l.x, l.z, 18)
  }
  for (const [k, c] of (o.map.courts ?? []).slice(0, Math.min(MAX, 4)).entries()) add('court', `sunken court ${k}`, c.x, c.z, 10)
  for (const v of (o.world.wardens?.keystones() ?? []).slice(0, Math.min(MAX, 4))) add('vault', `vault: ${v.name}`, v.x, v.z, 8)
  const P = M.paths
  if (P) {
    const done = new Set()
    P.lines.forEach((line, i) => {
      const kind = P.kind[i]
      if (done.has(kind) || line.length < 4) return
      done.add(kind)
      const m = line[Math.floor(line.length / 2)]
      add('way', `${kind} to ${P.to[i] ?? '?'}`, m[0], m[1], 4)
    })
  }
  return out
}, MAX)
const todo = spots.filter((s) => !ONLY || s.name.toLowerCase().includes(ONLY.toLowerCase()) || s.group === ONLY)
console.log(`${todo.length} spots (${[...new Set(todo.map((s) => s.group))].map((g) => `${g} ${todo.filter((s) => s.group === g).length}`).join(', ')})`)

const rows = []
for (const [i, s] of todo.entries()) {
  // the car on the gentlest dry ground within reach of the spot (never in the water)
  const at = await p.evaluate((s) => {
    const o = window.__oth, m = o.map
    let best = null
    const R = Math.max(12, Math.min(60, s.r + 10))
    for (let a = 0; a < 16; a++) for (const d of [R * 0.5, R, R * 1.5]) {
      const qx = s.x + Math.cos(a * 0.3927) * d, qz = s.z + Math.sin(a * 0.3927) * d
      if (Math.abs(qx) > m.play - 40 || Math.abs(qz) > m.play - 40) continue
      if (m.waterAt?.(qx, qz)) continue
      const h = m.height(qx, qz), sl = Math.hypot(m.height(qx + 4, qz) - m.height(qx - 4, qz), m.height(qx, qz + 4) - m.height(qx, qz - 4)) / 8
      if (!best || sl < best.sl) best = { x: qx, z: qz, h, sl }
    }
    if (!best) return null
    o.drive(true)
    o.car.placeAt(best.x, best.z, Math.atan2(-(s.x - best.x), -(s.z - best.z)))
    return best
  }, s)
  if (!at) { rows.push({ ...s, held: 'no ground' }); console.log(`${i + 1}/${todo.length} ${s.group} · ${s.name}: no ground to stand on`); continue }
  await sleep(2500)
  const r = await p.evaluate(() => new Promise((res) => {
    const o = window.__oth, P = o.car.root.position, t0 = performance.now()
    let n = 0, worst = 0, last = t0
    const f = () => {
      const t = performance.now(); worst = Math.max(worst, t - last); last = t; n++
      if (t - t0 < 1000) requestAnimationFrame(f)
      else res({ y: P.y, ground: o.map.height(P.x, P.z), fps: (n * 1000) / (t - t0), worst })
    }
    requestAnimationFrame(f)
  }))
  const held = Math.abs(r.y - r.ground) < 2.5 ? 'held' : r.y < r.ground ? 'FELL' : 'FLEW'
  // a still from 26 m off, 8 m up, looking at it
  const file = `${String(i + 1).padStart(3, '0')}_${s.group}_${s.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.jpg`
  await p.evaluate((s) => {
    const o = window.__oth, a = Math.atan2(s.x - o.car.pos.x, s.z - o.car.pos.z) + Math.PI, d = 26 + Math.min(40, s.r * 0.6)
    const x = s.x + Math.sin(a) * d, z = s.z + Math.cos(a) * d
    o.view(x, z, 8 + Math.min(30, s.r * 0.25), Math.atan2(-(s.x - x), -(s.z - z)), -0.18)
  }, s)
  await sleep(1800)
  await p.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 80 })
  const row = { ...s, held, fps: Math.round(r.fps), worst: Math.round(r.worst), dy: +(r.y - r.ground).toFixed(2), slope: +(at.sl * 100).toFixed(0), file }
  rows.push(row)
  console.log(`${i + 1}/${todo.length} ${s.group} · ${s.name}: ${held} (car ${row.dy} m over the ground, ${row.slope} % slope) · ${row.fps} fps, worst frame ${row.worst} ms`)
}
fs.writeFileSync(`${out}/tour.json`, JSON.stringify(rows, null, 1))
const bad = rows.filter((r) => r.held !== 'held')
console.log(`\n${rows.length} spots · ${bad.length} not held: ${bad.map((r) => `${r.name} (${r.held})`).join('; ') || 'none'}`)
const slow = rows.filter((r) => r.fps).sort((a, c) => a.fps - c.fps).slice(0, 8)
console.log('slowest:', slow.map((r) => `${r.name} ${r.fps} fps`).join(' · '))
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 800) : 'none')
await b.close()
process.exit(bad.length || errs.length ? 1 : 0)
