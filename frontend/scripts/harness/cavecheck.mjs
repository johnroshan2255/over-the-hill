// cavecheck.mjs [outDir] [extra URL params] — THE CAVE WORLD in the game (CaveWorld.ts, Sky Hollow): where Sites put it,
// what it cost to load, and screenshots — outside (front, wide, side, from above, its foot) and inside (the way in, the
// great hall, the garden under the skylight, looking up the shaft, the far chamber, the loop). ULTRA 1600 × 900.
//   node scripts/harness/cavecheck.mjs screenshots/cave-game          env: PORT (5200), HOUR (14), ONLY (a view name part)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'screenshots/cave-game'
const extra = process.argv[3] ? `&${process.argv[3]}` : ''
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warn' && /cave/i.test(m.text()))) errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?world=valley&tier=ultra&hour=${process.env.HOUR || 14}&drive=0&dpr=fixed&time=0&weather=${process.env.WEATHER || "clear"}&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 240000, polling: 250 })
await p.addStyleTag({ content: 'body > :not(canvas) { display: none !important; }' })
const info = await p.evaluate(() => {
  const w = window.__oth.world, l = w.places.find((q) => q.kind === 'cave')
  return { site: l && { x: l.x, z: l.z, y: l.y, rot: l.rot, name: l.name }, loaded: !!w.cave, collider: w.cave?.collider ? w.cave.collider.idx.length / 3 : 0, ms: w.timings?.cave, tris: (() => { let n = 0; w.cave?.group.traverse((o) => { if (o.isMesh) n += (o.geometry.index?.count ?? 0) / 3 }); return n })() }
})
console.log(JSON.stringify(info))
if (!info.site || !info.loaded) { console.log('errors:', errs); await b.close(); process.exit(1) }
const { x: X, z: Z, rot } = info.site, sn = Math.sin(rot), cs = Math.cos(rot)
const W = (lx, lz) => [X + lx * cs + lz * sn, Z - lx * sn + lz * cs]
// a view: from local (lx, lz) h m over the land, toward local (tx, tz) [ty m up]; yaw 0 looks −z
const views = [
  ['a_front', [3, 40, 3.5], [0, -10, 4]], ['b_front_wide', [-30, 110, 18], [0, -60, 10]], ['c_side', [170, -60, 25], [0, -80, 10]],
  ['d_above', [60, 90, 120], [0, -90, 0]], ['e_foot', [-90, 10, 2.2], [-60, -40, 2]], ['f_mouth', [1, 10, 2.5], [2, -20, 3]],
  ['g_way_in', [1, -12, 3.2], [7, -40, 4]], ['h_great_hall', [2, -60, 4.5], [-10, -95, 4]], ['i_garden', [6, -78, 3.5], [-10, -90, 6]],
  ['j_shaft', [-6, -86, 3], [-10, -88.5, 40]], ['k_far_chamber', [48, -104, 4], [56, -122, 3]], ['l_loop', [-20, -110, 4.5], [10, -136, 4]],
  ['m_haven', [-30, -128, 5], [-55, -132, 3]], ['n_lake', [6, -96, 4], [-6, -102, 1.5]],
  // (on the hill's top: heights 'T' over the top there — its grass, its rock, the skylights' rims)
  ['o_top', [30, -50, 'T2'], [-10, -100, 'T0']], ['p_top_rim', [14, -70, 'T9'], [-10, -90, 'T-8']], ['q_top_flank', [70, -60, 'T2'], [40, -120, 'T-2']],
]
for (const [name, from, to] of views) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue
  const [fx, fz] = W(from[0], from[1]), [tx, tz] = W(to[0], to[1])
  await p.evaluate((fx, fz, h, tx, tz, ty, fl, tl) => {
    const o = window.__oth, top = (l, v) => {
      if (typeof v === 'number') return v
      const t = o.world.cave.meta.top, i = Math.round((l[0] - t.x0) / t.step), j = Math.round((l[1] - t.z0) / t.step)
      return (t.h[j * t.nx + i] ?? 0) + +v.slice(1)
    }
    const H = o.world.map.height(fx, fz) + top(fl, h), Ht = o.world.map.height(tx, tz) + top(tl, ty)
    h = H - o.world.map.height(fx, fz)
    const dx = tx - fx, dz = tz - fz, yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(Ht - H, Math.hypot(dx, dz))
    o.view(fx, fz, h, yaw, pitch)
  }, fx, fz, from[2], tx, tz, to[2], from.slice(0, 2), to.slice(0, 2))
  await new Promise((r) => setTimeout(r, 1800))
  await p.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
