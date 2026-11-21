// stateprof.mjs <state> [tier] — WHERE A FRAME'S JAVASCRIPT GOES IN ONE STATE OF PLAY ON FOOT (cpuprof.mjs's profile,
// weaponcost.mjs's states): a 4 s CPU profile, CAPPED to the screen's 60 a second (a frame's own work, as on a phone),
// self time by source file and by function — µs a frame.
//   state: fists | pistol | ak47 | sniper | scope1 | scope2 | firing | friend | enemy | walk (fists, walking)
//   env PORT (5200), Q (extra URL params), WALK=1 (walking while it's measured), FILES=a,b (only those files' functions)
import puppeteer from 'puppeteer-core'
const state = process.argv[2] || 'fists', tier = process.argv[3] || 'low'
const PORT = process.env.PORT || 5200
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1280,720', '--mute-audio'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
await p.goto(`http://localhost:${PORT}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&weapons=all${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
await p.evaluate((what) => {
  const o = window.__oth, a = o.arsenal
  a.host.kick = () => {}
  const comp = what === 'friend' || what === 'enemy' ? what : null
  o.setCompanion?.(comp)
  if (what === 'fists' || what === 'walk' || comp) a.equip(null)
  else if (what === 'scope1' || what === 'scope2') { a.equip('sniper'); a.scope = what === 'scope1' ? 1 : 2 }
  else if (what === 'firing') { a.equip('ak47'); a.ammo.ak47 = [9999, 0]; setTimeout(() => a.press('fire', true), 900) }
  else a.equip(what)
}, state)
await sleep(state === 'friend' || state === 'enemy' ? 5000 : 2500)
if (state === 'walk' || process.env.WALK) await p.keyboard.down('KeyW')
await sleep(800)
const cdp = await p.createCDPSession()
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
await p.evaluate(() => { window.__f = 0; const t = () => { window.__f++; requestAnimationFrame(t) }; requestAnimationFrame(t) })
await cdp.send('Profiler.start')
await sleep(4000)
const { profile } = await cdp.send('Profiler.stop')
const frames = await p.evaluate(() => window.__f)
const dt = new Map()
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0))
const byFn = new Map(), byFile = new Map()
let total = 0, gc = 0
for (const n of profile.nodes) {
  const us = dt.get(n.id) ?? 0
  if (!us) continue
  const cf = n.callFrame, file = (cf.url.split('/').pop() || cf.url || '(native)').replace(/\?.*$/, '')
  if (cf.functionName === '(garbage collector)') { gc += us; continue }
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue
  total += us
  const key = `${cf.functionName || '(anon)'}  ${file}:${cf.lineNumber + 1}`
  byFn.set(key, (byFn.get(key) ?? 0) + us)
  byFile.set(file, (byFile.get(file) ?? 0) + us)
}
const per = (us) => `${(us / frames).toFixed(0).padStart(6)} µs`
const only = process.env.FILES ? process.env.FILES.split(',') : null
console.log(`${state} ${tier}: ${frames} frames in 4 s, JS ${per(total)} a frame, GC ${per(gc)}`)
console.log('--- by file')
for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${per(v)}  ${k}`)
console.log('--- by function')
for (const [k, v] of [...byFn].filter(([k]) => !only || only.some((f) => k.includes(f))).sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP || 22))) console.log(`${per(v)}  ${k}`)
await b.close()
