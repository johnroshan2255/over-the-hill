// dentshot.mjs <outDir> — THE DENTS LOOKED AT CLOSE (2026-11-25, the user: "some time some part get stretched out
// like elastic — it must be a real world like car damage"): the car parked, a crash's run of blows put on it — a hard
// corner, a side swipe, a run of small knocks in one place (what scraping along a wall gives), one more on the same
// corner, a round — then pictures from four sides, and the numbers that say whether the shell stretched: each edge's
// length against the works', the worst and how many past +25 %.
//   node scripts/harness/dentshot.mjs <outdir>   env: PORT (5200), CAR (offroader | e30 | v8 | g500 …), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] ?? 'dentshots'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CAR = process.env.CAR || 'offroader'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'high'}&hour=11&dpr=fixed&time=0&weather=clear&sound=0&save=0&car=${CAR}&companion=off`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim && window.__oth.car.damage, { timeout: 180000, polling: 250 })
await sleep(4000)
const views = [['front-left', -3.6, 1.5, -4.2], ['front-right', 3.6, 1.5, -4.2], ['rear-left', -3.6, 1.5, 4.4], ['right', 4.6, 1.2, 0], ['right-close', 2.3, 0.9, 0.1]]
const shots = async (tag) => {
  for (const [n, x, y, z] of views) {
    await p.evaluate((x, y, z) => window.__oth.spectate(x, y, z, 0.8), x, y, z)
    await sleep(350)
    await p.screenshot({ path: `${out}/${CAR}-${tag}-${n}.png` })
  }
  await p.evaluate(() => window.__oth.spectate())
}
// (how stretched the shell is: every triangle edge now against the works' — by the mesh's own vertices)
const strain = () => p.evaluate((which) => {
  const dm = window.__oth.car.damage
  let worst = 0, over = 0, edges = 0, moved = 0, seen = 0, seenWorst = 0
  const top = [], seenList = []
  for (const [mi, m] of dm.meshes.entries()) {
    if (!m.rest) continue
    const P = m.pos, R = m.rest, I = m.idx, n = I ? I.length : P.length / 3, g = m.gone
    const edge = (a, c) => {
      if (g && (g[a] || g[c])) return
      const l0 = Math.hypot(R[a * 3] - R[c * 3], R[a * 3 + 1] - R[c * 3 + 1], R[a * 3 + 2] - R[c * 3 + 2])
      if (l0 < 0.004) return
      const l = Math.hypot(P[a * 3] - P[c * 3], P[a * 3 + 1] - P[c * 3 + 1], P[a * 3 + 2] - P[c * 3 + 2])
      edges++
      const s = l / l0 - 1
      if (s > worst) worst = s
      // (what an eye would see: more than 2 cm longer and more than 30 %)
      if (l - l0 > 0.02 && s > 0.3) { seen++; seenWorst = Math.max(seenWorst, l - l0); if (seenList.length < 2000) seenList.push([+((l - l0) * 100).toFixed(1), m.glass ? 'glass' : m.door ? 'door' : 'body', +l0.toFixed(3), [R[a * 3] + m.ox, R[a * 3 + 1] + m.oy, R[a * 3 + 2] + m.oz].map((v) => +v.toFixed(2)), [P[a * 3] - R[a * 3], P[a * 3 + 1] - R[a * 3 + 1], P[a * 3 + 2] - R[a * 3 + 2]].map((v) => +v.toFixed(2)), [R[c * 3] + m.ox, R[c * 3 + 1] + m.oy, R[c * 3 + 2] + m.oz].map((v) => +v.toFixed(2)), [P[c * 3] - R[c * 3], P[c * 3 + 1] - R[c * 3 + 1], P[c * 3 + 2] - R[c * 3 + 2]].map((v) => +v.toFixed(2))]) }
      if (s > 0.25) { over++; if (top.length < 20000) top.push([+s.toFixed(2), mi, m.glass ? 'glass' : m.door ? 'door' : 'body', +l0.toFixed(3), [R[a * 3] + m.ox, R[a * 3 + 1] + m.oy, R[a * 3 + 2] + m.oz].map((v) => +v.toFixed(2)), [P[a * 3] - R[a * 3], P[a * 3 + 1] - R[a * 3 + 1], P[a * 3 + 2] - R[a * 3 + 2]].map((v) => +v.toFixed(2)), [P[c * 3] - R[c * 3], P[c * 3 + 1] - R[c * 3 + 1], P[c * 3 + 2] - R[c * 3 + 2]].map((v) => +v.toFixed(2)), g ? g[a] + g[c] : 0]) }
    }
    for (let t = 0; t + 2 < n; t += 3) { const a = I ? I[t] : t, c = I ? I[t + 1] : t + 1, d = I ? I[t + 2] : t + 2; edge(a, c); edge(c, d); edge(d, a) }
    for (let i = 0; i < P.length; i++) if (Math.abs(P[i] - R[i]) > 1e-4) { moved++; i += 2 - (i % 3) }
  }
  top.sort((a, b) => b[0] - a[0])
  return { worst: +worst.toFixed(2), over25: over, seen, seenWorstCm: +(seenWorst * 100).toFixed(1), edges, moved, crush: +dm.crush.toFixed(3), top: which === 'seen' ? seenList.sort((a, b) => b[0] - a[0]).slice(0, 14) : top.slice(0, 12) }
}, process.env.TOP || '')
await shots('whole')
const ms = await p.evaluate(() => {
  const dm = window.__oth.car.damage, M = dm.model, hx = M.half.x, hy = M.half.y
  const T = [], t0 = performance.now(), _hit = dm.hit.bind(dm)
  dm.hit = (...a) => { const t = performance.now(); _hit(...a); T.push(+(performance.now() - t).toFixed(1)) }
  dm.hit(-hx * 0.8, hy * 0.5, M.front + 0.15, 0.35, 0, 0.93, 19) // the front-left corner, hard
  dm.hit(hx, hy * 0.6, 0.2, -1, 0, 0, 12) // the right side
  for (let k = 0; k < 6; k++) dm.hit(hx, hy * 0.4, -0.6 + k * 0.35, -0.97, 0, 0.2, 6) // a scrape along the right
  dm.hit(-hx * 0.7, hy * 0.7, M.front + 0.2, 0.3, -0.2, 0.93, 16) // the corner again
  dm.hit(0, hy * 0.5, M.rear - 0.1, 0, 0, -1, 9) // the tail
  dm.hit(-hx, hy * 0.5, -0.4, 1, 0, 0, 0, 'shot')
  dm.hit = _hit
  return T
})
console.log(`${CAR}: each blow (ms): ${ms.join(' ')}`)
await sleep(600)
const s = await strain()
const { top, ...sum } = s
console.log(`${CAR}: ${JSON.stringify(sum)}`)
if (process.env.TOP) for (const t of top) console.log('  ', JSON.stringify(t))
await shots('dented')
fs.writeFileSync(`${out}/${CAR}-strain.json`, JSON.stringify(s))
await b.close()
