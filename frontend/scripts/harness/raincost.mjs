// raincost.mjs [tier] ["<A>|<B>"] [reps] [car] — WHAT THE RAIN ON THE CAR COSTS (2026-11-27 — oth/Drops.ts): two tabs,
// the same car in the rain, wet through, one with the variant A's URL switches and one with B's (the default: the drops
// as the tier has them against `drops=0`; the mud's wash: "|mud=0"); rep after rep each tab in turn brought to the
// front (only the front tab renders) and its frame timed GPU-drained (pace.mjs) at three views — the CHASE camera as
// played, the NOSE close (the car filling the frame: the most the drops ever cost from outside) and the driver's EYE
// (the windscreen across the whole frame). Interleaved: the machine's drift falls on both alike. 1920 × 1080, uncapped.
//   node scripts/harness/raincost.mjs ultra "|drops=0" 4 offroader          node scripts/harness/raincost.mjs low "mobile=1|mobile=1&mud=0"
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'
const tier = process.argv[2] || 'ultra', variants = (process.argv[3] ?? '|drops=0').split('|'), reps = Number(process.argv[4] || 4), car = process.argv[5] || 'offroader'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const tabs = []
for (const v of variants) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=14&weather=rain&sound=0&save=0&car=${car}${v ? '&' + v : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 250 })
  await sleep(1500)
  await p.evaluate(() => window.__oth.car.rain?.settle?.())
  tabs.push({ v: v || '(as the tier has it)', p, errs })
}
const look = (p, from, at) => p.evaluate(([from, at]) => {
  const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
  const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
  const a = V(from), t = V(at)
  o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
}, [from, at])
const m = await tabs[0].p.evaluate(() => { const m = window.__oth.car.model, d = m.doors.filter((q) => q.side === -1).sort((a, b) => a.hinge[2] - b.hinge[2])[0]; return { front: m.front, top: m.bottom + m.half.y * 2, seat: d ? [d.hinge[0] + 0.54, d.hinge[1] + d.bottom + 1.05, d.hinge[2] + d.length * 0.62 + 0.1] : [-0.3, 1.6, 0.4] } })
const VIEWS = { chase: [[0, 3.0, 7.5], [0, 1.2, 0]], nose: [[-1.7, m.top - 0.1, m.front - 1.6], [0, m.top - 0.75, m.front + 1.0]], eye: [m.seat, [m.seat[0] + 0.4, m.seat[1] - 0.12, m.seat[2] - 3]] }
for (const [name, v] of Object.entries(VIEWS)) {
  const ms = tabs.map(() => [])
  for (const t of tabs) await look(t.p, ...v)
  for (let r = 0; r < reps; r++) for (let k = 0; k < tabs.length; k++) {
    await tabs[k].p.bringToFront()
    await sleep(500)
    ms[k].push(await tabs[k].p.evaluate(PACE))
  }
  const a = mean(ms[0])
  console.log(`${tier.padEnd(6)} ${name.padEnd(6)} ` + tabs.map((t, k) => `${t.v}: ${mean(ms[k]).toFixed(3)} ms (${(1000 / mean(ms[k])).toFixed(0)} fps) [${ms[k].map((x) => x.toFixed(2)).join(' ')}]`).join('   ') + (tabs.length > 1 ? `   A − B: ${(a - mean(ms[1]) >= 0 ? '+' : '') + (a - mean(ms[1])).toFixed(3)} ms` : ''))
}
for (const t of tabs) if (t.errs.length) console.log('ERRORS', t.v, [...new Set(t.errs)].join(' | '))
await b.close()
