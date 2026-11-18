// download.mjs — THE FIRST DOWNLOAD (2026-11-18, the user: "check the initial download, make sure it's low"): a fresh
// browser (no cache), the title screen, PLAY, until the game is on screen (+ SETTLE s more: what's fetched after) — every
// request with the bytes that came over the wire (CDP encodedDataLength), when it came (the title / the load / after
// the game is up), and what a host that gzips would send (each body gzipped here: `gz`). Run against the PRODUCTION
// build: `npx vite build && npx vite preview --port 4173` (vite's preview sends everything uncompressed).
//   node scripts/harness/download.mjs        env: PORT (4173) SETTLE (8) TOP (25)
import puppeteer from 'puppeteer-core'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
const DIST = process.env.DIST || 'dist'
const PORT = process.env.PORT || 4173, SETTLE = Number(process.env.SETTLE || 8), TOP = Number(process.env.TOP || 25)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
const p = await b.newPage(), cdp = await p.createCDPSession()
await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
const reqs = new Map()
let phase = 'title'
cdp.on('Network.requestWillBeSent', (e) => { if (!e.request.url.startsWith('data:') && !e.request.url.startsWith('blob:')) reqs.set(e.requestId, { url: e.request.url, phase, bytes: 0, gz: null, br: null, enc: '' }) })
cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.enc = e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? '' })
cdp.on('Network.loadingFinished', (e) => {
  const r = reqs.get(e.requestId); if (!r) return
  r.bytes = e.encodedDataLength
  // (what a host that compresses would send — the built file itself gzipped and brotli'd: text, scripts, wasm, json,
  //  glb; the .pk grids, the images and the sounds are packed already)
  if (!r.enc && /\.(js|mjs|css|html|json|wasm|glb|gltf|bin|svg|txt)(\?|$)|\/$/.test(r.url)) {
    const f = path.join(DIST, decodeURIComponent(new URL(r.url).pathname).replace(/\/$/, '/index.html'))
    try { const body = fs.readFileSync(f); r.gz = zlib.gzipSync(body, { level: 9 }).length; r.br = zlib.brotliCompressSync(body).length } catch { /* (not a built file) */ }
  }
})
const t0 = Date.now()
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 3500))   // (the title's idle preloads)
const tTitle = Date.now()
phase = 'load'
await p.evaluate(() => { const b = [...document.querySelectorAll('button.oh-item')].find((x) => /^(Play|New start)/.test(x.textContent)); b.click() })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 100 })
const tReady = Date.now()
phase = 'after'
await new Promise((r) => setTimeout(r, SETTLE * 1000))
const all = [...reqs.values()].filter((r) => r.bytes > 0)
const mb = (n) => (n / 1e6).toFixed(2).padStart(6)
const host = (r) => r.gz !== null ? Math.min(r.gz, r.bytes) : r.bytes, hostBr = (r) => r.br !== null ? Math.min(r.br, r.bytes) : r.bytes
for (const ph of ['title', 'load', 'after']) { const l = all.filter((r) => r.phase === ph); console.log(`${ph.padEnd(6)} ${String(l.length).padStart(3)} requests  ${mb(l.reduce((s, r) => s + r.bytes, 0))} MB as served  ${mb(l.reduce((s, r) => s + host(r), 0))} MB if the host gzips`) }
const first = all.filter((r) => r.phase !== 'after')
console.log(`TO PLAY: ${first.length} requests, ${mb(first.reduce((s, r) => s + r.bytes, 0))} MB as served, ${mb(first.reduce((s, r) => s + host(r), 0))} MB if the host gzips, ${mb(first.reduce((s, r) => s + hostBr(r), 0))} MB with brotli; PLAY → the game on screen ${((tReady - tTitle) / 1000).toFixed(1)} s (this machine, localhost)`)
console.log(`ALL:     ${all.length} requests, ${mb(all.reduce((s, r) => s + r.bytes, 0))} MB as served, ${mb(all.reduce((s, r) => s + host(r), 0))} MB if the host gzips\n\nthe biggest:`)
for (const r of all.sort((a, c) => c.bytes - a.bytes).slice(0, TOP)) console.log(`${mb(r.bytes)} MB${r.gz !== null && r.gz < r.bytes * 0.97 ? ` (gz ${mb(r.gz).trim()}, br ${mb(r.br).trim()})` : ''}  ${r.phase.padEnd(5)} ${r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70)}`)
await b.close()
