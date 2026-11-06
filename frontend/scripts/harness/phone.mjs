// phone.mjs [tier] [--soak seconds] — THE PHONE'S YARDSTICK (docs/PERF.md): fps.mjs's views on a REAL Android phone over
// USB — its own Chrome, its own GPU, its own heat. A phone's display caps the frame (60 / 90 / 120 Hz), so this measures
// what a player feels: the frame-time percentiles and the share of frames that MISS 16.7 ms (60 fps), per view; with
// --soak, one view driven for N seconds, minute by minute — a cheap phone holds 60 fresh and drops when it's hot.
//
// Setup, once: on the phone Settings → About → tap Build number ×7 → Developer options → USB debugging on; plug it in,
// allow the Mac. The dev server on :5200 (npm run dev). Then:
//   node scripts/harness/phone.mjs ultra              node scripts/harness/phone.mjs ultra --soak 600
// It runs: adb reverse (the phone's localhost:5200 → this Mac's dev server), adb forward (Chrome's DevTools socket →
// :9222), then drives the phone's Chrome with puppeteer.connect.
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const tier = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ultra'
const soakAt = process.argv.indexOf('--soak')
const soak = soakAt > 0 ? Number(process.argv[soakAt + 1] || 600) : 0
const ADB = process.env.ADB || `${os.homedir()}/Library/Android/sdk/platform-tools/adb`
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim()

const devices = adb('devices').split('\n').slice(1).filter((l) => /\tdevice$/.test(l))
if (!devices.length) { console.error('no phone: plug one in with USB debugging on (adb devices shows none)'); process.exit(1) }
const model = `${adb('shell', 'getprop', 'ro.product.manufacturer')} ${adb('shell', 'getprop', 'ro.product.model')} (${adb('shell', 'getprop', 'ro.soc.model') || adb('shell', 'getprop', 'ro.board.platform')}, Android ${adb('shell', 'getprop', 'ro.build.version.release')})`
adb('reverse', 'tcp:5200', 'tcp:5200')
adb('forward', 'tcp:9222', 'localabstract:chrome_devtools_remote')
// (Chrome must be running on the phone for its DevTools socket to exist)
try { adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main', '-d', 'about:blank') } catch {}
await new Promise((r) => setTimeout(r, 2500))
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })

const VIEWS = [
  ['valley', 'spawn (car)', true],
  ['valley', 'forest', false, 260, 640, 2.2, 0.6, -0.05],
  ['valley', 'lake', false, -160, -1320, 3, -1.2, -0.04],
  ['valley', 'cliff', false, 1102, -1700, 2.2, 0, -0.02],
  ['desert', 'oasis', false, -330, 420, 3, -1.2, -0.02],
  ['desert', 'plain', false, -300, 1100, 2, 0.3, 0.02],
]
// the frames over `ms`: each rAF interval; the GPU drained at the end (WebGL2's rAF waits on it anyway)
const frames = (ms) => p.evaluate(async (ms) => {
  const o = window.__oth, d = []
  await o.gpuDone()
  const t0 = performance.now()
  let last = t0
  await new Promise((r) => { const f = () => { const n = performance.now(); d.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  await o.gpuDone()
  return d
}, ms)
const stats = (d) => {
  const s = [...d].sort((a, b) => a - b), q = (k) => s[Math.min(s.length - 1, Math.floor(s.length * k))]
  const miss = d.filter((x) => x > 17.5).length / d.length // (16.7 ms + vsync jitter)
  return `fps ${(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1).padStart(5)}   p50 ${q(0.5).toFixed(1)}  p95 ${q(0.95).toFixed(1)}  p99 ${q(0.99).toFixed(1)}  max ${s[s.length - 1].toFixed(1)} ms   missed ${(100 * miss).toFixed(1)} %`
}
const url = (world) => `http://localhost:5200/?tier=${tier}&hour=12&time=0&weather=clear&world=${world}&sound=0&save=0&adaptive=0`
const ready = () => p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 300000, polling: 500 })

console.log(`${model} — ${tier}`)
let loaded = ''
if (!soak) {
  for (const [world, name, drive, x, z, h, yaw, pitch] of VIEWS) {
    if (loaded !== world) { await p.goto(url(world), { waitUntil: 'load' }); await ready(); loaded = world }
    await p.evaluate((a) => { const o = window.__oth; if (a.drive) o.drive(true); else o.view(a.x, a.z, a.h, a.yaw, a.pitch) }, { drive, x, z, h, yaw, pitch })
    await new Promise((r) => setTimeout(r, 3000))
    console.log(`${name.padEnd(12)} ${stats(await frames(8000))}`)
  }
} else {
  await p.goto(url('valley'), { waitUntil: 'load' }); await ready()
  await p.evaluate(() => window.__oth.drive(true))
  // (a minute at a time: the spawn view with the car idling — the heat builds as it would in play)
  for (let m = 0; m * 60 < soak; m++) console.log(`minute ${String(m + 1).padStart(2)}  ${stats(await frames(Math.min(60, soak - m * 60) * 1000))}`)
}
const info = await p.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2'), e = gl?.getExtension('WEBGL_debug_renderer_info')
  return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', backend: window.__oth?.backend, dpr: devicePixelRatio, size: `${innerWidth}×${innerHeight}` }
})
console.log(`GPU ${info.gpu} · ${info.backend} · ${info.size} CSS px × ${info.dpr}`)
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none')
await p.close()
b.disconnect()
