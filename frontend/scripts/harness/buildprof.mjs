// buildprof.mjs — CPU profile of one world build (swapTo): self time by function
import puppeteer from '../../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
await p.goto('http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0', { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
await new Promise((r) => setTimeout(r, 2000))
const s = await p.createCDPSession()
await s.send('Profiler.enable'); await s.send('Profiler.setSamplingInterval', { interval: 200 }); await s.send('Profiler.start')
await p.evaluate(() => window.__oth.swapTo('valley'))
const { profile } = await s.send('Profiler.stop')
const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]))
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]), cf = n.callFrame
  const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
}
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(v.toFixed(1).padStart(7), 'ms ', k)
await b.close()
