// emptyframe.mjs [view] [extra] — WHAT IS LEFT WHEN "EVERYTHING" IS HIDDEN? The scene's top-level objects listed, the
// frame with all of them hidden (truly nothing), with only window.__oth.parts() hidden (floor.mjs's "empty"), and each
// thing outside parts() shown alone over nothing. GPU-drained (pace), 1080p uncapped, median of 5.
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'
const V = { forest: [260, 640, 2.2, 0.6, -0.05], lake: [-160, -1320, 3, -1.2, -0.04], omeadow: [211.2, 3306.9, 2.4, 2.9, -0.06], spawnfly: [-141.7, -223.6, 3, -0.795, 0.0] }
const view = process.argv[2] || 'forest', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load', timeout: 120000 })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate((v) => window.__oth.view(...v), V[view]); await new Promise((r) => setTimeout(r, 3000))
const ft = async () => { const r = []; for (let i = 0; i < 5; i++) r.push(await p.evaluate(PACE)); r.sort((a, b) => a - b); return r[2] }
// the scene's graph: the world's group and its siblings, named by what they are in parts() or by their place
const names = await p.evaluate(() => { const o = window.__oth, w = o.world, P = o.parts(), scene = w.group.parent
  const tag = new Map(); for (const [k, v] of Object.entries(P)) tag.set(v, k)
  const extra = { wonders: w.wonders?.group, mist: w.mist?.mesh, clutter: w.clutter?.group, wardens: w.wardens?.group, caveGrass: w.caveGrass?.group }
  for (const [k, v] of Object.entries(extra)) if (v) tag.set(v, k)
  window.__all = []; const list = []
  const tris = (m) => { let n = 0; m.traverse((c) => { const g = c.geometry; if (g && c.visible) n += (g.index ? g.index.count : g.getAttribute?.('position')?.count ?? 0) / 3 * (g.instanceCount > 0 && g.instanceCount < 1e9 ? g.instanceCount : 1) }); return Math.round(n) }
  const add = (c, where) => { window.__all.push(c); list.push({ i: window.__all.length - 1, name: tag.get(c) ?? `${where}:${c.type ?? '?'}${c.name ? ':' + c.name : ''}`, inParts: [...Object.values(P)].includes(c), vis: c.visible, tris: tris(c) }) }
  for (const c of scene.children) if (c !== w.group) add(c, 'scene')
  for (const c of w.group.children) add(c, 'world')
  return list })
const set = (ids, v) => p.evaluate((ids, v) => { for (const i of ids) window.__all[i].visible = v }, ids, v)
const shown = names.filter((n) => n.vis)
const full = await ft()
await set(shown.map((n) => n.i), false); const none = await ft()
console.log(`${view}: full ${full.toFixed(3)} ms; NOTHING drawn ${none.toFixed(3)} ms`)
const outside = shown.filter((n) => !n.inParts)
await set(outside.map((n) => n.i), true); const floor = await ft(); await set(outside.map((n) => n.i), false)
console.log(`  parts() hidden only (floor.mjs's "empty"): ${floor.toFixed(3)} ms — the things outside parts(): ${(floor - none).toFixed(3)} ms`)
for (const n of outside) { await set([n.i], true); const t = await ft(); await set([n.i], false); console.log(`  ${(t - none >= 0 ? '+' : '') + (t - none).toFixed(3)} ms  ${n.name}  (${n.tris} tris)`) }
console.log('  (hidden already: ' + names.filter((n) => !n.vis).map((n) => n.name).join(', ') + ')')
await b.close()
