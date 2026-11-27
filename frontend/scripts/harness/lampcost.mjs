// lampcost.mjs [tiers] [reps] [car] — WHAT THE CAR'S LAMPS COST (2026-11-27 — oth/Lamps.ts: the lenses' own faces lit,
// their halos, the beams): at night, the car close in the frame from ahead (the head lamps' light filling the most
// pixels it ever does) and from behind (the tail lamps'), the lamps OFF then ON in the same tab, rep after rep
// (interleaved: the machine's drift falls on both alike), each frame time GPU-drained (pace.mjs); the draws of each.
// 1920 × 1080, uncapped. The same script on the code before (git stash) gives the old lamps' cost: the A/B.
//   node scripts/harness/lampcost.mjs ultra,medium,low 5 offroader            env: PORT=5200
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'
const tiers = (process.argv[2] || 'ultra,medium,low').split(','), reps = Number(process.argv[3] || 5), car = process.argv[4] || 'offroader'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
for (const tier of tiers) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=23&weather=clear&sound=0&save=0&car=${car}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 250 })
  await sleep(2000)
  for (const [name, from, at] of [['ahead', [-1.2, 1.5, -5.5], [0, 1.1, 0]], ['behind', [1.2, 1.5, 5.8], [0, 1.1, 0]]]) {
    await p.evaluate(([from, at]) => {
      const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
      const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
      const a = V(from), t = V(at)
      o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
    }, [from, at])
    const ms = { off: [], on: [] }, draws = {}
    for (let r = 0; r < reps; r++) for (const mode of ['off', 'on']) {
      await p.evaluate((m) => { window.__oth.car.lightMode = m }, mode)
      await sleep(400)
      ms[mode].push(await p.evaluate(PACE))
      draws[mode] = await p.evaluate(() => window.__oth.stats().draws)
    }
    const off = mean(ms.off), on = mean(ms.on)
    console.log(`${tier.padEnd(6)} ${name.padEnd(6)} lamps off ${off.toFixed(3)} ms (${draws.off} draws)   on ${on.toFixed(3)} ms (${draws.on} draws)   the lamps: ${(on - off >= 0 ? '+' : '') + (on - off).toFixed(3)} ms, ${draws.on - draws.off} draws   [off ${ms.off.map((v) => v.toFixed(2)).join(' ')} | on ${ms.on.map((v) => v.toFixed(2)).join(' ')}]`)
  }
  if (errs.length) console.log('ERRORS:', [...new Set(errs)].join(' | '))
  await p.close()
}
await b.close()
