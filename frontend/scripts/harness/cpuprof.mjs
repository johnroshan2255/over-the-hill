// cpuprof.mjs [tier] [view] [extra] — where a frame's JavaScript goes: a 4 s CPU profile (Chrome's sampling profiler)
// at a fixed view, uncapped 1080p, self time summed by function and by source file (top 30 / top 15).
//   view: spawn (the car, driving) | forest | lake | oasis       (needs `npm run dev`, :5200)
//   env NONE=1: every part of the world hidden first (the frame's fixed cost)
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra'
const view = process.argv[3] || 'spawn'
const extra = process.argv[4] ? `&${process.argv[4]}` : ''
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02] }[view]
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
if (process.env.NONE) await p.evaluate(() => { for (const v of Object.values(window.__oth.parts())) v.visible = false })
await new Promise((r) => setTimeout(r, 3000))
const cdp = await p.createCDPSession()
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
const frames0 = await p.evaluate(() => { window.__f = 0; const t = () => { window.__f++; requestAnimationFrame(t) }; requestAnimationFrame(t); return 0 })
await cdp.send('Profiler.start')
await new Promise((r) => setTimeout(r, 4000))
const { profile } = await cdp.send('Profiler.stop')
const frames = await p.evaluate(() => window.__f) - frames0
// self time per node: samples × interval
const dt = new Map()
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0))
const byFn = new Map(), byFile = new Map()
let total = 0
for (const n of profile.nodes) {
  const us = dt.get(n.id) ?? 0
  if (!us) continue
  const cf = n.callFrame, file = (cf.url.split('/').pop() || cf.url || '(native)').replace(/\?.*$/, '')
  if (cf.functionName === '(idle)' || cf.functionName === '(program)' || cf.functionName === '(garbage collector)') { byFn.set(cf.functionName, (byFn.get(cf.functionName) ?? 0) + us); continue }
  total += us
  const key = `${cf.functionName || '(anon)'}  ${file}:${cf.lineNumber + 1}`
  byFn.set(key, (byFn.get(key) ?? 0) + us)
  byFile.set(file, (byFile.get(file) ?? 0) + us)
}
const per = (us) => `${(us / 1000 / frames).toFixed(3)} ms/frame`
console.log(`${tier} ${view}: ${frames} frames in 4 s (${(frames / 4).toFixed(0)} fps), JS ${per(total)}; idle ${per(byFn.get('(idle)') ?? 0)}, program ${per(byFn.get('(program)') ?? 0)}, GC ${per(byFn.get('(garbage collector)') ?? 0)}`)
console.log('--- by file')
for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${per(v).padStart(18)}  ${k}`)
console.log('--- by function')
for (const [k, v] of [...byFn].filter(([k]) => !k.startsWith('(')).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${per(v).padStart(18)}  ${k}`)
await b.close()
