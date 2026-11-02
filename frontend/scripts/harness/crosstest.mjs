// crosstest.mjs [tier] [dir] — THE CROSSING, driven: the car on the valley's pass heading north (W held) → the desert
// built behind the mist, the swap at the gate, the car on the desert's pass; then back (reversing over the line: the
// valley, kept built, comes back at once); the longest frames, the GPU memory, any errors.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [tier = 'high', dir = 'vg/cross'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:5200/?tier=${tier}&dpr=fixed&time=0&hour=16.5&weather=clear`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () => p.evaluate(() => {
  const o = window.__oth, c = o.car.pos
  return { world: o.world.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1), ground: +o.height(c.x, c.z).toFixed(1), kmh: +o.car.speedKmh.toFixed(0), mist: +o.crossing.mist.toFixed(2), cross: o.crossing.state }
})
// the longest frame over a stretch (rAF gaps)
await p.evaluate(() => {
  window.__worst = 0; window.__long = []
  let last = performance.now()
  const tick = () => { const n = performance.now(), d = n - last; window.__worst = Math.max(window.__worst, d); if (d > 50) window.__long.push([Math.round(n), Math.round(d), window.__oth.world.id]); last = n; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
await p.evaluate(() => { window.__swaps = []; const c = window.__oth.crossing, f = c.onSwap; c.onSwap = (a, b) => { window.__swaps.push(Math.round(performance.now())); f?.(a, b) } })
const worst = () => p.evaluate(() => { const w = window.__worst; window.__worst = 0; return Math.round(w) })
const [sx, sz] = (process.env.FROM || '1102,-1900').split(',').map(Number)
await p.evaluate(([x, z]) => { const o = window.__oth; o.drive(true); o.car.sim.place(x, o.height(x, z) + 0.7, z, 0); o.car.shift(0, 0, 0) }, [sx, sz])
await sleep(1500)
console.log('placed      ', JSON.stringify(await state()), 'gpu', JSON.stringify(await p.evaluate(() => window.__oth.gpuMemory())))
await worst()
// wait for the desert to be built behind the mist
const t0 = Date.now()
while (!(await state()).cross.startsWith('ready') && Date.now() - t0 < 90000) await sleep(500)
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)} s, longest frame ${await worst()} ms`, JSON.stringify(await state()), 'gpu', JSON.stringify(await p.evaluate(() => window.__oth.gpuMemory())))
await p.screenshot({ path: `${dir}/1_valley_pass.png` })
// drive north through the gate
await p.keyboard.down('KeyW')
let s, swapped = false
for (let i = 0; i < 80; i++) {
  await sleep(250)
  s = await state()
  if (s.world === 'desert' && !swapped) { swapped = true; console.log('SWAP        ', JSON.stringify(s), 'longest frame', await worst(), 'ms'); await p.screenshot({ path: `${dir}/2_swap.png` }) }
  if (swapped && i % 4 === 0) console.log('  desert    ', JSON.stringify(s))
  if (swapped && s.z < 1880) break
}
await p.keyboard.up('KeyW')
await sleep(1500)
console.log('in desert   ', JSON.stringify(await state()), 'longest frame', await worst(), 'ms')
await p.screenshot({ path: `${dir}/3_desert_pass.png` })
// back: reverse over the line
if (process.env.BACK !== '0') {
  await p.keyboard.down('KeyS')
  for (let i = 0; i < 120; i++) { await sleep(250); s = await state(); if (s.world === 'valley') { console.log('BACK        ', JSON.stringify(s), 'longest frame', await worst(), 'ms'); break } }
  await p.keyboard.up('KeyS')
  await sleep(1500)
  console.log('back home   ', JSON.stringify(await state()))
  await p.screenshot({ path: `${dir}/4_back.png` })
}
console.log('gpu', JSON.stringify(await p.evaluate(() => window.__oth.gpuMemory())))
console.log('frames > 50 ms [t, ms, world]:', JSON.stringify(await p.evaluate(() => window.__long)), 'swaps at', JSON.stringify(await p.evaluate(() => window.__swaps)))
console.log('errors:', errs.length ? errs : 'none')
await b.close()
