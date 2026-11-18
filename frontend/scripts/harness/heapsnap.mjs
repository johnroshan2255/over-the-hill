// heapsnap.mjs [out.heapsnapshot] — the game loaded, a full GC, a HEAP SNAPSHOT written to a file (Chrome's own format:
// load it in DevTools' Memory tab, or `node scripts/harness/heapsum.mjs <file>`). env QS (more params), TIER (ultra)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'game.heapsnapshot'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 1800000,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--enable-precise-memory-info'], defaultViewport: { width: 1920, height: 1080 } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'ultra'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0${process.env.QS ? '&' + process.env.QS : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await new Promise((r) => setTimeout(r, 6000))
const cdp = await p.createCDPSession()
await cdp.send('HeapProfiler.enable')
await cdp.send('HeapProfiler.collectGarbage')
console.log('heap after GC', ((await p.evaluate(() => performance.memory.usedJSHeapSize)) / 1048576).toFixed(1), 'MB')
const fd = fs.openSync(out, 'w')
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => fs.writeSync(fd, e.chunk))
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false })
fs.closeSync(fd)
console.log('snapshot →', out, (fs.statSync(out).size / 1e6).toFixed(0), 'MB')
await b.close()
