// spawnprobe.mjs — TWO PLAYERS JOIN ONE WORLD: how each one's car stands for its first 8 s (its up, where it is, how
// fast), and each one's trailer at the end (there, hitched, on its wheels). 2026-11-24: the second player's car — placed
// 12 m on along the start's track, its trailer set down behind it while it still fell — rocked, was thrown a metre up
// and rolled over in 2 joins of 5 (the tow ball found 0.6 m low: main.ts `trailerDue`); after: 9 of 9 stood.
//   node scripts/harness/spawnprobe.mjs   env: PORT (5200), RUNS (1), TRACE=1 (B's car and trailer every frame for
//   6 s, printed round the moment the car goes over), NOTRAILER=1 (B's trailer taken away at once — the A/B)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json()
}
let bad = 0
for (let run = 0; run < Number(process.env.RUNS || 1); run++) {
  const A = await api('POST', '/v1/players', { name: 'Asha' }), B = await api('POST', '/v1/players', { name: 'Ravi' })
  const world = await api('POST', '/v1/worlds', { name: 'Probe', map: 'valley' }, A.token)
  await api('POST', '/v1/worlds/join', { code: world.code }, B.token)
  const browsers = []
  const open = async (who) => {
    const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
    browsers.push(b)
    const p = await b.newPage()
    p.on('pageerror', (e) => console.log(`[${who.name}]`, e.message))
    await p.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: who.id, name: who.name, token: who.token })
    await p.goto(`${BASE}/?coop=${world.id}&tier=low&hour=12&time=0&save=0&dpr=fixed&companion=off`, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__oth?.ready && window.__oth.coop && window.__oth.car?.sim, { timeout: 120000, polling: 250 })
    return p
  }
  const pa = await open(A)
  await sleep(1500)
  const pb = await open(B)
  // (TRACE=1: B's car and trailer every frame for 4 s — the trailer's height over the ground, its up, hitched, the car's)
  if (process.env.TRACE) {
    const tr = await pb.evaluate(() => new Promise((res) => {
      const o = window.__oth, out = [], t0 = performance.now()
      const up = (q) => +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3)
      const f = () => {
        const c = o.car, t = o.trailer, cb = c.sim?.body, tb = t?.body
        const ct = cb?.translation(), tt = tb?.translation()
        out.push([Math.round(performance.now() - t0), ct ? +(ct.y - o.map.height(ct.x, ct.z)).toFixed(2) : null, cb ? up(cb.rotation()) : null, cb ? +cb.linvel().y.toFixed(2) : null,
          tt ? +(tt.y - o.map.height(tt.x, tt.z)).toFixed(2) : null, tb ? up(tb.rotation()) : null, t?.hitched ?? null, tt && ct ? +Math.hypot(tt.x - ct.x, tt.z - ct.z).toFixed(2) : null])
        if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res(out)
      }
      f()
    }))
    console.log('ms, car over ground, car up, car vy, trailer over ground, trailer up, hitched, apart')
    { const lo = tr.findIndex((r) => r[2] !== null && r[2] < 0.9); console.log("first over at", lo < 0 ? "never" : tr[lo][0]); for (const r of tr.filter((_, i) => lo < 0 ? i % 30 === 0 : (i > lo - 90 && i < lo + 20 && i % 3 === 0))) console.log(JSON.stringify(r)) }
  }
  // (NOTRAILER=1: B's trailer unhitched and sent 30 m off at once — is it the trailer that shakes the car?)
  if (process.env.NOTRAILER) await pb.evaluate(() => { const t = window.__oth.trailer; if (t?.body) { t.unhitch(true); const p = t.body.translation(); t.body.setTranslation({ x: p.x + 30, y: p.y + 2, z: p.z }, true) } })
  const look = (p) => p.evaluate(() => { const c = window.__oth.car, q = c.root.quaternion, P = c.pos; return { up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2), x: +P.x.toFixed(1), y: +P.y.toFixed(1), z: +P.z.toFixed(1), kmh: +c.speedKmh.toFixed(1) } })
  // (what stands near B's car on B's side: A's car, A's trailer — their solids — and B's own trailer)
  console.log('near B:', JSON.stringify(await pb.evaluate(() => {
    const o = window.__oth, P = o.car.pos, out = { me: [+P.x.toFixed(1), +P.z.toFixed(1)], trailer: o.trailer?.body ? (({ x, z }) => [+x.toFixed(1), +z.toFixed(1)])(o.trailer.body.translation()) : null, solids: [] }
    for (const a of o.coop.remotes.avatars.values()) for (const k of ['solidCar', 'solidMe', 'solidTr']) { const s = a[k]; if (s) { const t = s.body.translation(); out.solids.push([k, +t.x.toFixed(1), +t.z.toFixed(1), +Math.hypot(t.x - P.x, t.z - P.z).toFixed(1)]) } }
    return out
  })))
  let worst = 1
  for (let i = 0; i < 16; i++) {
    await sleep(500)
    const a = await look(pa), b = await look(pb)
    worst = Math.min(worst, a.up, b.up)
    console.log(`run ${run} t=${((i + 1) * 0.5).toFixed(1)}s  A ${JSON.stringify(a)}  B ${JSON.stringify(b)}`)
  }
  // (and each one's trailer is there, hitched, standing)
  for (const [n, p] of [['A', pa], ['B', pb]]) {
    const t = await p.evaluate(() => { const t = window.__oth.trailer, q = t?.body?.rotation(); return t ? { hitched: t.hitched, up: +(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(2) } : null })
    console.log(`run ${run}: ${n}'s trailer ${JSON.stringify(t)}`)
    if (!t?.hitched || t.up < 0.9) bad++
  }
  if (worst < 0.9) bad++
  console.log(`run ${run}: the least up ${worst}${worst < 0.9 ? ' — A CAR OVER' : ''}`)
  for (const b of browsers) await b.close()
}
console.log(bad ? `${bad} FAILED (a car over, or a trailer missing / unhitched / over)` : 'every car stood, every trailer hitched')
