// wilds.mjs [outDir] [tier] — THE WILDS (2026-11-11, scripts/oth/wilds.py): the outland's roads, its places and the
// early snow, looked at in the game — a view along a road in a valley and on a hillside, each place from the ground and
// from the air, the snow line; then the car set down on three roads (does the ground hold it, is it on the road).
// Needs `npm run dev` (PORT 5200).   ONLY=<name part> : just the views whose name holds it.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/wilds', tier = 'ultra'] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage(); const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warn' && /exceeds|Invalid|invalid/.test(m.text()))) errs.push(m.text().split('\n')[0]) })   // (WebGPU's validation speaks in warnings: a draw it refuses is a black frame)
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=${process.env.HOUR || 13}&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const O = await p.evaluate(() => window.__oth.map.meta.outland)
const place = (k) => O.places.find((q) => q.kind === k)
const lines = O.trails.lines, long = [...lines].sort((a, c) => c.length - a.length)
const views = []
// along a road: from a point on it, 3 m up, looking down it
const along = (nm, L, f, up = 3, pitch = -0.08) => { const k = Math.floor(L.length * f), a = L[k], c = L[Math.min(L.length - 1, k + 4)]; views.push([nm, a[0], a[1], up, Math.atan2(-(c[0] - a[0]), -(c[1] - a[1])), pitch]) }
along('road_a', long[0], 0.35); along('road_b', long[1], 0.6); along('road_c', long[2], 0.5); along('road_air', long[0], 0.5, 120, -0.6)
const from = (nm, q, dist, up, ang = 0.6, pitch = -0.12) => views.push([nm, q.x + dist * Math.sin(ang), q.z + dist * Math.cos(ang), up, ang, pitch])   // (the camera dist m from q, looking at it)
const wt = place('worldtree'), cr = place('crater'), me = place('mesa'), ar = place('arch'), pk = place('peak')
if (wt) { from('tree_far', wt, 900, 40, 0.6, 0.02); from('tree_near', wt, 190, 8, 2.2, 0.25); from('tree_under', wt, 60, 3, 4.0, 0.6); from('tree_air', wt, 420, 260, 1.2, -0.5) }
if (cr) { from('crater_rim', cr, 330, 70, 0.9, -0.22); from('crater_floor', cr, 120, 3, 3.0, 0.0); from('crater_air', cr, 600, 420, 0.3, -0.6) }
if (me) { from('mesa_far', me, 520, 30, 0.8, 0.05); from('mesa_air', me, 430, 300, 2.4, -0.6); from('mesa_top', me, 60, 4, 1.5, -0.05) }
if (ar) { from('arch_road', ar, 70, 3, (ar.rot ?? 0) + Math.PI / 2, 0.1); from('arch_side', ar, 110, 25, (ar.rot ?? 0) + 0.5, -0.1) }
if (pk) { from('snow_far', pk, 2600, 120, 2.6, 0.08); from('snow_mid', pk, 1100, 60, 3.4, 0.2) }
for (const v of O.places.filter((q) => q.kind === 'view')) from(`view_${v.name.split(' ')[0]}`, v, 40, 6, 1.0, -0.1)
// the lakes, the pass and its road, a stage's start gate, a bend with its boards
for (const L of (O.lakes ?? [])) from(`lake_${L.name.split(' ')[0]}`, L, L.r * 1.25, 14, 0.9, -0.16)
const pass = place('pass'); if (pass) from('pass', pass, 70, 12, 2.0, -0.05)
const stg = (O.stages ?? []).find((q) => q.name === 'Whitecrown Pass') ?? (O.stages ?? [])[0]
if (stg) { const L = lines[stg.line]; along('stage_start', L, 6 / L.length, 2.2, 0.02); along('stage_road', L, 0.55, 3, -0.05); along('stage_high', L, 0.9, 4, -0.1); along('stage_air', L, 0.75, 160, -0.55) }
const run = (O.stages ?? []).find((q) => /Run|Sprint/.test(q.name))
if (run) { const L = lines[run.line]; along('gate_start', L, 0, 2.4, 0.03); views.push(['gate_finish', L[L.length - 9][0], L[L.length - 9][1], 2.4, Math.atan2(-(L[L.length - 5][0] - L[L.length - 9][0]), -(L[L.length - 5][1] - L[L.length - 9][1])), 0.03]) }
const clm = (O.stages ?? []).find((q) => /Climb/.test(q.name)); if (clm) { const L = lines[clm.line]; along('climb_a', L, 0.5, 2.5, 0.0); along('climb_b', L, 0.8, 2.5, 0.0) }
// a hillside of boulders beside a road: the first road point with 25–45° ground 30 m to one side, below the snow
{
  const spot = await p.evaluate((lines) => { const m = window.__oth.map; for (const L of lines) for (let k = 20; k < L.length - 20; k += 7) { const [x, z] = L[k], dx = L[k + 1][0] - x, dz = L[k + 1][1] - z, l = Math.hypot(dx, dz) || 1; if (Math.max(Math.abs(x), Math.abs(z)) < 2300 || m.height(x, z) > 420) continue; for (const sd of [-1, 1]) { const qx = x - dz / l * 34 * sd, qz = z + dx / l * 34 * sd, s = Math.hypot(m.height(qx + 4, qz) - m.height(qx - 4, qz), m.height(qx, qz + 4) - m.height(qx, qz - 4)) / 8; if (s > 0.45 && s < 0.8 && m.height(qx, qz) > m.height(x, z) + 6) return [x, z, Math.atan2(-(qx - x), -(qz - z))] } } return null }, lines)
  if (spot) views.push(['boulders', spot[0], spot[1], 2.6, spot[2], 0.12])
}
// SKYFALL CANYON: from its overlook (facing the fall), along it from each end, the High Bridge's mouth and side, from the air
{
  const cy = place('canyon'), ov = O.places.find((q) => q.deck)
  if (cy && ov) {
    const f = [Math.cos(ov.rot), Math.sin(ov.rot)]
    console.log('overlook:', JSON.stringify(await p.evaluate((ov, f) => { const m = window.__oth.map, w = window.__oth.world.wonders; return { ground: [0, 6, 12, 18, 24, 40].map((d) => +m.height(ov.x + f[0] * d, ov.z + f[1] * d).toFixed(1)), parts: w.parts.filter((q) => q.box.distanceToPoint({ x: ov.x, y: ov.y, z: ov.z }) < 40).length } }, ov, f)))
    const fl = (await p.evaluate(() => window.__oth.map.meta.water.falls.filter((q) => q.outland)))[0]
    if (fl) views.push(['fall_across', ov.x + f[0] * 4, ov.z + f[1] * 4, 6, Math.atan2(-(fl.x - ov.x), -(fl.z - ov.z)), -0.25])
    views.push(['canyon_overlook', ov.x - f[0] * 14, ov.z - f[1] * 14, 4.5, Math.atan2(-f[0], -f[1]), -0.12], ['canyon_deck', ov.x + f[0] * 9, ov.z + f[1] * 9, 2.2, Math.atan2(-f[0], -f[1]), -0.45], ['canyon_air', cy.x + 500, cy.z + 500, 420, Math.atan2(500, 500), -0.62], ['canyon_low', cy.x, cy.z, 40, 0.3, 0.25])
    const hb = (await p.evaluate(() => window.__oth.map.meta.bridges.filter((q) => q.grand)))[0]
    if (hb) { const L = Math.hypot(hb.x1 - hb.x0, hb.z1 - hb.z0), ux = (hb.x1 - hb.x0) / L, uz = (hb.z1 - hb.z0) / L
      views.push(['highbridge_mouth', hb.x0 - ux * 16, hb.z0 - uz * 16, 3.2, Math.atan2(-ux, -uz), -0.05], ['highbridge_side', (hb.x0 + hb.x1) / 2 - uz * 230, (hb.z0 + hb.z1) / 2 + ux * 230, 30, Math.atan2(-uz, ux), -0.25], ['highbridge_on', (hb.x0 + hb.x1) / 2, (hb.z0 + hb.z1) / 2, 6, Math.atan2(-uz, ux), -0.5]) }
  }
}
// a gorge bridge from its road, and from the side; a hairpin from above
{
  const br = await p.evaluate(() => window.__oth.map.meta.bridges.filter((q) => q.outland))
  for (const k of [0, 6]) { const q = br[k], L = Math.hypot(q.x1 - q.x0, q.z1 - q.z0), ux = (q.x1 - q.x0) / L, uz = (q.z1 - q.z0) / L
    views.push([`bridge${k}_mouth`, q.x0 - ux * 14, q.z0 - uz * 14, 3, Math.atan2(-ux, -uz), -0.06], [`bridge${k}_side`, (q.x0 + q.x1) / 2 - uz * 70, (q.z0 + q.z1) / 2 + ux * 70, 22, Math.atan2(-uz, ux), -0.18]) }
  const hp = await p.evaluate((lines) => { for (const L of lines) for (let k = 6; k < L.length - 6; k++) { const a = Math.atan2(L[k][1] - L[k - 5][1], L[k][0] - L[k - 5][0]), c = Math.atan2(L[k + 5][1] - L[k][1], L[k + 5][0] - L[k][0]); if (Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a))) > 2.3) return L[k] } return null }, lines)
  if (hp) views.push(['hairpin_air', hp[0] + 40, hp[1] + 40, 90, Math.atan2(40, 40), -1.0], ['hairpin_ground', hp[0] + 26, hp[1] - 10, 5, Math.atan2(26, -10), -0.1])
}
// the OFF-ROAD places (the boulder field, the bog, the ford), the flower meadows, a crest with its board
for (const Z of (O.zones ?? [])) { from(`zone_${Z.kind}`, Z, Z.r * 1.15, 5, 0.9, -0.1); from(`zone_${Z.kind}_in`, Z, Z.r * 0.45, 2.4, 2.6, -0.05); from(`zone_${Z.kind}_air`, Z, Z.r * 1.7, 110, 2.0, -0.7) }
for (const [k, M] of (O.meadows ?? []).entries()) { from(`meadow_${k}`, { x: M.x + M.r * 0.3, z: M.z + M.r * 0.2 }, 30, 2.4, 0.9 + k, -0.06); from(`meadow_${k}_air`, M, M.r * 0.9, 120, 0.4, -0.6) }
{
  const st = (O.stages ?? []).find((q) => q.crests?.length)
  if (st) { const L = lines[st.line], [cx, cz] = st.crests[0]; let kb = 0, db = 1e9; L.forEach((q, k) => { const d = Math.hypot(q[0] - cx, q[1] - cz); if (d < db) { db = d; kb = k } })
    for (const [nm, back] of [['crest_board', 11], ['crest_near', 4]]) { const a = L[Math.max(0, kb - back)], c = L[Math.max(0, kb - back) + 2]; views.push([nm, a[0], a[1], 1.7, Math.atan2(-(c[0] - a[0]), -(c[1] - a[1])), 0.0]) } }
}
for (const [nm, x, z, h, yaw, pitch] of views) {
  if (process.env.ONLY && !nm.includes(process.env.ONLY)) continue
  await p.evaluate((x, z, h, yaw, pitch) => window.__oth.view(x, z, h, yaw, pitch), x, z, h, yaw, pitch); await sleep(2600); await p.screenshot({ path: `${out}/${nm}.png` }); console.log('shot', nm)
}
if (!process.env.ONLY) for (const [k, L] of long.slice(0, 3).entries()) {
  const a = L[Math.floor(L.length * 0.45)], c = L[Math.floor(L.length * 0.45) + 3]
  await p.evaluate((x, z, yaw) => { window.__oth.unview?.(); window.__oth.car.teleport?.(x, z, yaw) ?? window.__oth.car.sim.place(x, window.__oth.map.height(x, z) + 0.8, z, yaw) }, a[0], a[1], Math.atan2(c[0] - a[0], c[1] - a[1]))
  await sleep(3000)
  const r = await p.evaluate(() => { const c = window.__oth.car, P = c.root.position, m = window.__oth.map; return { x: +P.x.toFixed(0), z: +P.z.toFixed(0), y: +P.y.toFixed(2), ground: +m.height(P.x, P.z).toFixed(2), roadEdge: +m.roadEdge(P.x, P.z).toFixed(1) } })
  console.log(`car on road ${k}:`, JSON.stringify(r), Math.abs(r.y - r.ground) < 2.5 ? 'HELD' : 'FELL / FLEW', r.roadEdge < 0 ? 'ON THE ROAD' : 'off it')
  await p.screenshot({ path: `${out}/car_${k}.png` })
}
// the MAP, zoomed all the way out: the outland's relief, its roads and places round the valley's chart
if (!process.env.ONLY || 'map'.includes(process.env.ONLY)) {
  await p.keyboard.press('Tab'); await sleep(1500)
  for (let k = 0; k < 8; k++) { await p.evaluate(() => [...document.querySelectorAll('button')].find((q) => q.textContent.trim() === '−' || q.textContent.trim() === '-')?.click()); await sleep(80) }   // (its − button: out to the whole playable land)
  await sleep(800); await p.screenshot({ path: `${out}/map.png` }); console.log('shot map')
  await p.keyboard.press('Tab')
}
if (!process.env.ONLY) {
  // the route finder: from the spawn to the World Tree, and to the pass — by road?
  const nav = await p.evaluate(() => { const o = window.__oth, g = o.guide ?? o.nav; return g ? Object.keys(g).slice(0, 12) : null })
  console.log('counts:', JSON.stringify(await p.evaluate(() => ({ trees: window.__oth.world.trees.count, bushes: window.__oth.world.bushes.count ?? null, places: window.__oth.map.meta.outland.places.length, stages: window.__oth.map.meta.outland.stages.length, lakes: window.__oth.map.meta.outland.lakes.length, wonderMeshes: window.__oth.world.wonders.group.children.length, colliders: window.__oth.world.wonders.colliders.length }))), 'guide keys:', nav)
}
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 600) : 'none')
await b.close()
