// swaptest.mjs — build + enter the valley again N times while playing: the GPU memory must come back each time,
// the frames must keep flowing while a world builds (the longest frame), and nothing may throw
import puppeteer from '../../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const tier = process.argv[2] || 'ultra'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
await p.goto(`http://localhost:5200/?tier=${tier}&hour=12&dpr=fixed&time=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2000)
console.log('start   ', JSON.stringify(await p.evaluate(() => window.__oth.gpuMemory())), 'heap', await p.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6)) + ' MB')
for (let i = 0; i < 3; i++) {
  const r = await p.evaluate(async () => {
    // the longest frame while the world builds
    let worst = 0, last = performance.now(), on = true
    const tick = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const t = await window.__oth.swapTo('valley')
    const built = worst
    worst = 0
    await new Promise((r) => setTimeout(r, 2000))
    on = false
    return { worst: Math.round(built) + ' building, ' + Math.round(worst) + ' after entering', timings: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)])) }
  })
  await sleep(2500)
  await p.evaluate(() => window.gc?.())
  console.log(`swap ${i + 1}  `, JSON.stringify(await p.evaluate(() => window.__oth.gpuMemory())), 'heap', await p.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6)) + ' MB', ' longest frame', r.worst, 'ms')
  if (i === 0) console.log('   steps (ms):', JSON.stringify(r.timings))
}
await p.screenshot({ path: 'vg/after_swaps.png' })
console.log('errors:', errs.length ? errs : 'none')
await b.close()
