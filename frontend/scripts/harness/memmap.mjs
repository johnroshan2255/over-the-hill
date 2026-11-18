// memmap.mjs — WHAT HOLDS THE MEMORY (2026-11-18, the user: "reduce memory use"): the game loaded, a full GC, the heap;
// then every object reachable from window.__oth walked (once each) and every ArrayBuffer's bytes charged to the path it
// was first met by — summed by path (to DEPTH parts) and listed biggest first. What the walk can't reach (closures'
// own variables, PlayCanvas's insides) is the rest: the heap less the sum.
//   node scripts/harness/memmap.mjs        env: DEPTH (3) TOP (40) TIER (ultra) UNDER (only the paths starting so) QS (more params)
import puppeteer from 'puppeteer-core'
const DEPTH = Number(process.env.DEPTH || 3), TOP = Number(process.env.TOP || 40), UNDER = process.env.UNDER || ''
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--enable-precise-memory-info', '--js-flags=--expose-gc'], defaultViewport: { width: 1920, height: 1080 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
const p = await b.newPage()
await p.goto(`http://localhost:5200/?tier=${process.env.TIER || 'ultra'}&hour=12&dpr=fixed&time=0&weather=clear&world=${process.env.WORLD || 'valley'}&sound=0&save=0${process.env.QS ? '&' + process.env.QS : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await new Promise((r) => setTimeout(r, 6000))
const cdp = await p.createCDPSession()
await cdp.send('HeapProfiler.collectGarbage')
const heap = await p.evaluate(() => performance.memory.usedJSHeapSize)
const r = await p.evaluate((DEPTH) => {
  const seen = new WeakSet(), bufs = new WeakSet(), by = new Map(), q = [[window.__oth, '__oth', 0]]
  let total = 0, objs = 0
  const charge = (path, n) => { const k = path.split('.').slice(0, DEPTH + 1).join('.'); by.set(k, (by.get(k) ?? 0) + n); total += n }
  while (q.length) {
    const [o, path, d] = q.shift()
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) continue
    seen.add(o); objs++
    if (o === window || o instanceof Node || o instanceof CSSStyleDeclaration) continue
    if (ArrayBuffer.isView(o)) { if (!bufs.has(o.buffer)) { bufs.add(o.buffer); charge(path, o.buffer.byteLength) } continue }
    if (o instanceof ArrayBuffer) { if (!bufs.has(o)) { bufs.add(o); charge(path, o.byteLength) } continue }
    if (o instanceof Map || o instanceof Set) { let i = 0; for (const v of o.values()) q.push([v, `${path}.<${o instanceof Map ? 'map' : 'set'}>`, d + 1]); if (o instanceof Map) for (const k of o.keys()) if (typeof k === 'object') q.push([k, `${path}.<key>`, d + 1]); continue }
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const v = o[i]; if (v && typeof v === 'object') q.push([v, `${path}.[]`, d + 1]) } continue }
    let keys; try { keys = Object.getOwnPropertyNames(o) } catch { continue }
    for (const k of keys) { let v; try { v = o[k] } catch { continue } if (v && (typeof v === 'object' || (typeof v === 'function' && d < 2))) q.push([v, `${path}.${k}`, d + 1]) }
    // (getters on the prototype: world, parts…) — the class's own accessors
    const pr = Object.getPrototypeOf(o)
    if (pr && pr !== Object.prototype && d < 6) for (const k of Object.getOwnPropertyNames(pr)) { const ds = Object.getOwnPropertyDescriptor(pr, k); if (ds?.get) { let v; try { v = o[k] } catch { continue } if (v && typeof v === 'object') q.push([v, `${path}.${k}`, d + 1]) } }
  }
  return { total, objs, rows: [...by].sort((a, b) => b[1] - a[1]) }
}, DEPTH)
const mb = (n) => (n / 1048576).toFixed(1).padStart(7)
console.log(`heap after GC ${mb(heap)} MB; reachable ArrayBuffers ${mb(r.total)} MB over ${r.objs} objects; the rest ${mb(heap - r.total)} MB`)
for (const [k, v] of r.rows.filter(([k]) => k.startsWith(UNDER)).slice(0, TOP)) console.log(`${mb(v)} MB  ${k}`)
await b.close()
