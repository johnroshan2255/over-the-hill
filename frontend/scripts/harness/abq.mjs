// abq.mjs "<variant A>|<variant B>|…" [views] [reps] — THE A/B TOOL (docs/PERF.md): each variant (extra URL params,
// e.g. "" | "tcut=flat" | "aa=0") loaded ONCE in its own tab; then, rep after rep, each tab in turn brought to the front
// (only the front tab renders — a hidden tab's rAF stops, so the GPU is never shared) and its frame timed GPU-drained.
// Interleaved, so the machine's drift (heat, clocks) falls on every variant alike. ULTRA, 1920 × 1080, uncapped.
//   node scripts/harness/abq.mjs "|tcut=flat" spawn,lake 4          node scripts/harness/abq.mjs "|hide=water|hide=trees" lake
// env TIER (ultra), PORT (5200), API (webgpu | webgl2: the default backend when unset)
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'
const variants = (process.argv[2] ?? '').split('|')
const views = (process.argv[3] || 'spawn,lake').split(',')
const reps = Number(process.argv[4] || 3)
const tier = process.env.TIER || 'ultra'
const V = { spawn: ['valley', true], forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05], lake: ['valley', false, -160, -1320, 3, -1.2, -0.04], cliff: ['valley', false, 1102, -1700, 2.2, 0, -0.02], rockhill: ['valley', false, -864.6, -449.9, 2.4, 2.454, -0.05], caveFront: ['valley', false, -1190, 1900, 3.5, 0.0, 0.02], pavedHut: ['valley', false, -721, 640, 4, 0, -0.25], pavedRuin: ['valley', false, 1925, -382, 4, 0, -0.25], caveHall: ['valley', false, -1191.4, 1799.6, 4.5, 0.33, 0.0], caveAbove: ['valley', false, -1133, 1949.6, 120, 0.32, -0.57], oasis: ['desert', false, -330, 420, 3, -1.2, -0.02], plain: ['desert', false, -300, 1100, 2, 0.3, 0.02] }
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
// (pace.mjs: the slope between two drained windows — the constant ~0.6 s `gpuDone` takes on the release build cancels)
const drained = (p) => p.evaluate(PACE)
const api = process.env.API ? `&api=${process.env.API}` : ''
for (const view of views) {
  const v = V[view]
  const pages = []
  for (const q of variants) {
    // (one browser context: a second context is a second window, drawing too — never measure with two)
    const p = await b.newPage()
    p.on('pageerror', (e) => console.log(`  [${q}] page error: ${e.message.slice(0, 200)}`))
    // (a shader that fails to compile only logs: say so — a variant measured without its draw is no measurement)
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log(`  [${q}] console error: ${m.text().slice(0, 200)}`) })
    // (a variant's port=N: that server — e.g. a second `npm run dev` with another build, PCDEBUG=1)
    const port = new URLSearchParams(q).get('port') || process.env.PORT || 5200
    await p.goto(`http://localhost:${port}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=${v[0]}&sound=0&save=0${api}${q ? `&${q}` : ''}`, { waitUntil: 'load' })
    await p.bringToFront() // (a page in a background tab draws no frames: the game never gets ready)
    await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
    await p.evaluate((v) => { const o = window.__oth; if (v[1]) o.drive(true); else o.view(v[2], v[3], v[4], v[5], v[6]) }, v)
    // (a variant's hide=a+b: those parts of the world not drawn — what they cost; trees.2: only the part's 3rd child)
    const hide = new URLSearchParams(q).get('hide')
    if (hide) await p.evaluate((h) => { const parts = window.__oth.parts(); for (const k of h.split('+')) { const [n, i] = k.split('.'); const o = parts[n]; if (!o) continue; if (i === undefined) o.visible = false; else if (o.children[+i]) o.children[+i].visible = false } }, hide)
    pages.push(p)
  }
  const res = variants.map(() => [])
  for (let r = 0; r < reps; r++) for (let i = 0; i < pages.length; i++) {
    await pages[i].bringToFront()
    await new Promise((res) => setTimeout(res, r === 0 ? 2500 : 600))
    res[i].push(await drained(pages[i]))
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  const base = med(res[0])
  variants.forEach((q, i) => {
    const m = med(res[i])
    console.log(`${view.padEnd(6)} ${(q || '(base)').padEnd(34)} ${m.toFixed(3)} ms ${String(Math.round(1000 / m)).padStart(5)} fps  ${i ? `${m - base >= 0 ? '+' : ''}${(m - base).toFixed(3)}` : '      '}   [${res[i].map((x) => x.toFixed(2)).join(' ')}]`)
  })
  for (const p of pages) await p.close()
}
await b.close()
