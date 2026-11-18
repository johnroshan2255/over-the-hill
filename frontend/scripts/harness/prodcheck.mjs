// prodcheck.mjs — THE PRODUCTION BUILD's models, every kind LOADED (2026-11-18: the build gzips its .glb / .wasm —
// vite.config.ts `packAssets`, `rapierWasm` — and the game unpacks them): the game started with each vehicle in turn
// (?car=), on the bike (?ride=moto) and on foot (?ride=foot); the page's errors, failed requests and warnings about a
// model listed; a shot of each into [outDir]. Against `npx vite build && npx vite preview --port 4173`.
//   node scripts/harness/prodcheck.mjs [outDir]        env: PORT (4173) CARS (a,b,c — default: every one in the catalogue)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2], PORT = process.env.PORT || 4173
if (out) fs.mkdirSync(out, { recursive: true })
const cat = fs.readFileSync(new URL('../../src/gameplay/vehicle/catalogue.ts', import.meta.url), 'utf8')
// (the catalogue's own entries — `id: '…'` — and the kit's rows — `['id', 'Name', …`)
const cars = process.env.CARS ? process.env.CARS.split(',') : [...new Set([...cat.matchAll(/^ {4}id: '([^']+)'/gm), ...cat.matchAll(/^ {2}\['([a-z0-9_]+)', '/gm)].map((m) => m[1]))]
const runs = [...cars.map((c) => [`car=${c}`, c]), ['ride=moto', 'moto'], ['ride=foot', 'foot']]
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
let bad = 0
for (const [qs, name] of runs) {
  const p = await b.newPage(), msgs = []
  p.on('pageerror', (e) => msgs.push('error: ' + e.message.slice(0, 160)))
  p.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' && !/favicon/.test(t)) || (m.type() === 'warning' && /model|glb|gltf|load|naga|rapier|kit|places/i.test(t))) msgs.push(`${m.type()}: ${t.slice(0, 160)}`) })
  p.on('requestfailed', (r) => msgs.push('request failed: ' + r.url().slice(-50)))
  await p.goto(`http://localhost:${PORT}/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&${qs}`, { waitUntil: 'load' })
  let ok = true
  try { await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 90000, polling: 250 }) } catch { ok = false }
  await new Promise((r) => setTimeout(r, 6000))
  if (out) await p.screenshot({ path: `${out}/${name}.png` })
  if (!ok || msgs.length) bad++
  console.log(`${name.padEnd(16)} ${ok ? 'started' : 'DID NOT START'}${msgs.length ? '  ' + msgs.join(' | ') : ''}`)
  await p.close()
}
console.log(bad ? `${bad} of ${runs.length} with trouble` : `all ${runs.length} loaded clean`)
await b.close()
