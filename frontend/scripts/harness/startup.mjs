// startup.mjs [query] — HOW LONG THE GAME TAKES TO START (the user, 2026-11-03: "it stuck there for a long time, before
// it was lightning speed"): page load → the world ready → the first 3 frames drawn (a shader compiled on first use
// blocks there), and the world build's own timeline (World.timings). PORT=5201 measures main.
import puppeteer from 'puppeteer-core'
const q = process.argv[2] || ''
const PORT = process.env.PORT || 5200
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio'], defaultViewport: { width: 1920, height: 1080 } })
const p = await b.newPage()
const t0 = Date.now()
await p.goto(`http://localhost:${PORT}/?tier=ultra&hour=12&time=0&weather=clear&sound=0&save=0&${q}`, { waitUntil: 'load' })
const tLoad = Date.now() - t0
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 300000, polling: 50 })
const tReady = Date.now() - t0
// the first frames (rAF to rAF): a first draw that compiles shaders shows here
const frames = await p.evaluate(() => new Promise((r) => { const d = []; let l = performance.now(); const f = () => { const n = performance.now(); d.push(n - l); l = n; if (d.length < 4) requestAnimationFrame(f); else r(d) }; requestAnimationFrame(f) }))
const tFrames = Date.now() - t0
const tm = await p.evaluate(() => { const t = window.__oth.world?.timings ?? {}; return Object.entries(t).filter(([k, v]) => !k.includes('(frames)') && v > 30).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') })
console.log(`${PORT === 5201 ? 'main' : 'branch'} ${q || '(default)'}: page ${tLoad} ms, world ready ${tReady} ms, + first frames ${frames.map((x) => Math.round(x)).join(' / ')} ms → playing at ${tFrames} ms`)
console.log(`   world build (ms): ${tm}`)
await b.close()
