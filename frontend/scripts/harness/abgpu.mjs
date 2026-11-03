// abgpu.mjs view "queryA" "queryB" [rounds] — a GPU A/B that holds up on a busy machine (docs/MIGRATION.md): one page,
// A and B loaded alternately `rounds` times (default 4), each load's GPU-drained frame (median of 3 × 200 frames,
// after the view settles); the MEDIANS per side and their difference. Add `scale=200` to both for 4K (small shader
// changes show above the noise). Views as fps.mjs. ULTRA unless the query names a tier.
//   node scripts/harness/abgpu.mjs spawn "api=webgpu&scale=200" "api=webgpu&scale=200&tcut=noise"
import puppeteer from 'puppeteer-core'
const [view = 'spawn', qa = 'api=webgpu', qb = 'api=webgl2', roundsArg = '4'] = process.argv.slice(2)
const rounds = Number(roundsArg)
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], cliff: ['valley', false, 1102, -1700, 2.2, 0, -0.02], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02], plain: ['desert', false, -300, 1100, 2, 0.3, 0.02] }[view]
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const one = async (q) => {
  const tier = /(^|&)tier=/.test(q) ? '' : 'tier=ultra&'
  await p.goto(`http://localhost:5200/?${tier}hour=12&dpr=fixed&time=0&weather=clear&world=${V[0]}&sound=0&save=0&${q}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, V)
  await new Promise((r) => setTimeout(r, 3000))
  return p.evaluate(async () => {
    const o = window.__oth, runs = []
    for (let k = 0; k < 3; k++) {
      await o.gpuDone()
      const t0 = performance.now()
      await new Promise((r) => { let n = 0; const f = () => { if (++n < 200) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
      await o.gpuDone()
      runs.push((performance.now() - t0) / 200)
    }
    runs.sort((a, b) => a - b)
    return runs[1]
  })
}
const A = [], B = []
for (let i = 0; i < rounds; i++) { A.push(await one(qa)); B.push(await one(qb)) }
const med = (x) => { const s = [...x].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const ma = med(A), mb = med(B)
console.log(`${view}  A ${qa}\n        ${A.map((v) => v.toFixed(3)).join(' ')}  → median ${ma.toFixed(3)} ms (${(1000 / ma).toFixed(0)} fps)`)
console.log(`${view}  B ${qb}\n        ${B.map((v) => v.toFixed(3)).join(' ')}  → median ${mb.toFixed(3)} ms (${(1000 / mb).toFixed(0)} fps)`)
console.log(`B − A = ${(mb - ma).toFixed(3)} ms (${(100 * (mb - ma) / ma).toFixed(1)} %)${errs.length ? '   errors: ' + errs.slice(0, 3).join(' | ') : ''}`)
await b.close()
