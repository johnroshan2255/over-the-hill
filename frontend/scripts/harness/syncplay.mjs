// syncplay.mjs [outDir] — CO-OP IN SYNC, MEASURED (2026-11-24, the user: "play simultaneously with players and do
// things and check all syncs, and tick rate issues"): three players, each in their OWN browser (a tab behind another
// draws no frames — its pose would stop), in one world on the server, all moving at once — A drives, B runs on foot,
// C rides the motorbike — each page recording, every frame against the machine's one clock (Date.now), where it truly
// is and where it sees the other two. Then, for every pair:
//   delay   — the time shift that best lines what O sees of S up with where S really was (the smoothing's lag + the wire)
//   error   — what's left at that shift: RMS and worst (m)
//   jitter  — that leftover's quick part (less its own 250 ms average): a stutter shows here, a lag does not (m RMS)
// and each player's poses sent a second while moving (the wire's rate is 20). Then the things done together (CHECKS):
// A shoots C, B fells a tree and plants a flag, A's car takes a blow — all three agree; D joins late and must see the
// weapon in A's hands, C's health, A's dented car, B's land, the felled tree; B reloads and comes back.
//   node scripts/harness/syncplay.mjs <outdir>   env: PORT (5200), TIER (low), SECONDS (8), ONLY=motion (skip the checks),
//        SLOW=<player letter>:<rate> (that player's CPU throttled, e.g. SLOW=B:4 — a slow machine's frame rate),
//        LAGGY=B,C (those players through a bad line: LAGPORT, a second dev server whose server is lagproxy.mjs — 5201)
// Needs: `npm run dev` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'syncshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`, SECONDS = Number(process.env.SECONDS || 8)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}
const names = ['Asha', 'Ravi', 'Chen', 'Dara']
const accts = []
for (const n of names) accts.push(await api('POST', '/v1/players', { name: n }))
const world = await api('POST', '/v1/worlds', { name: 'Sync valley', map: 'valley', rules: { creative: true } }, accts[0].token).catch(() => api('POST', '/v1/worlds', { name: 'Sync valley', map: 'valley' }, accts[0].token))
for (const a of accts.slice(1)) await api('POST', '/v1/worlds/join', { code: world.code }, a.token)
console.log(`world ${world.name} · code ${world.code}`)

const errs = []
const browsers = []
const open = async (who) => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
  browsers.push(b)
  const page = await b.newPage()
  page.on('pageerror', (e) => { errs.push(`${who.name}: ${e.message}`); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(`${who.name}: ${m.text().slice(0, 200)}`); console.log(`[${who.name}]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  const laggy = (process.env.LAGGY || '').split(',').includes('ABCD'[names.indexOf(who.name)])
  const base = laggy ? `http://localhost:${process.env.LAGPORT || 5201}` : BASE
  await page.goto(`${base}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=12&time=0&save=0&dpr=fixed&weapons=all&weaponsites=0`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
  return page
}
const [pa, pb, pc] = [await open(accts[0]), await open(accts[1]), await open(accts[2])]
const P = { A: pa, B: pb, C: pc }
if (process.env.SLOW) {
  const [who, rate] = process.env.SLOW.split(':')
  const cdp = await P[who].createCDPSession()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(rate) })
  console.log(`${who}'s CPU throttled ×${rate}`)
}
await sleep(2500)

// (apart: everyone starts on the same track — the game sets each newcomer's car down clear of the others': main.ts
//  spreadOut. Setting them down from here as well put two onto each other, and one was thrown 850 m)
await sleep(3000)
// B on foot, C on the motorbike
await pb.evaluate(() => window.__oth.foot())
await pc.evaluate(() => window.__oth.ride())
await sleep(4000)
// (before anyone moves: each where they say they are, and where the others see them)
const where = (p) => p.evaluate(() => { const o = window.__oth, m = o.coop['me']; return { me: m ? [m.kind, +m.p.x.toFixed(1), +m.p.z.toFixed(1)] : null, sees: o.coop.remotes.list.map((r) => [r.name, +r.x.toFixed(1), +r.z.toFixed(1)]) } })
const still = { A: await where(pa), B: await where(pb), C: await where(pc) }
console.log('standing:', JSON.stringify(still))
for (const [o, w] of Object.entries(still)) for (const [n, x, z] of w.sees) {
  const s = still[{ Asha: 'A', Ravi: 'B', Chen: 'C' }[n]]
  check(s?.me && Math.hypot(s.me[1] - x, s.me[2] - z) < 1, `${o} sees ${n} where they stand (${s?.me ? Math.hypot(s.me[1] - x, s.me[2] - z).toFixed(2) : '?'} m off)`)
}

// THE RECORDERS: every frame, where I am (what I send — Coop's `me`) and where I see the others; my poses sent
const record = (p) => p.evaluate(() => {
  const o = window.__oth, c = o.coop, S = c.session
  window.__rec = { me: [], seen: {}, sends: [] }
  const send = S.sendPose.bind(S)
  if (!S.__sendRaw) S.__sendRaw = send
  S.sendPose = (e) => { window.__rec?.sends.push(Date.now()); S.__sendRaw(e) }
  const f = () => {
    if (!window.__rec) return
    const t = Date.now(), m = c['me']
    if (m) window.__rec.me.push([t, m.p.x, m.p.z])
    for (const r of c.remotes.list) (window.__rec.seen[r.name] ??= []).push([t, r.x, r.z])
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
const stop = (p) => p.evaluate(() => { const r = window.__rec; window.__rec = null; return r })
await Promise.all([pa, pb, pc].map(record))
// all moving at once: A drives (a little steering), B runs, C rides
const drive = async (p, keys, ms) => { for (const k of keys) await p.keyboard.down(k); await sleep(ms); for (const k of keys) await p.keyboard.up(k) }
await Promise.all([
  (async () => { await drive(pa, ['KeyW'], 2600); await drive(pa, ['KeyW', 'KeyA'], 1200); await drive(pa, ['KeyW'], 1500); await drive(pa, ['KeyS'], 1500) })(),
  (async () => { await pb.evaluate(() => window.__oth.footCam()); await drive(pb, ['KeyW', 'ShiftLeft'], SECONDS * 600); await drive(pb, ['KeyW', 'KeyD'], 1500) })(),
  (async () => { await drive(pc, ['KeyW'], 2500); await drive(pc, ['KeyW', 'KeyD'], 1200); await drive(pc, ['KeyW'], 1500) })(),
])
await sleep(Math.max(0, SECONDS * 1000 - 5100))
const recs = { A: await stop(pa), B: await stop(pb), C: await stop(pc) }
fs.writeFileSync(`${out}/motion.json`, JSON.stringify(recs))

// THE NUMBERS
const lerpAt = (ser, t) => {
  let lo = 0, hi = ser.length - 1
  if (t <= ser[0][0]) return [ser[0][1], ser[0][2]]
  if (t >= ser[hi][0]) return [ser[hi][1], ser[hi][2]]
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ser[m][0] <= t) lo = m; else hi = m }
  const a = ser[lo], b = ser[hi], f = (t - a[0]) / (b[0] - a[0] || 1)
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
const letter = { Asha: 'A', Ravi: 'B', Chen: 'C' }
const results = []
for (const [o, rec] of Object.entries(recs)) {
  for (const [name, seen] of Object.entries(rec.seen)) {
    const s = letter[name]
    if (!s) continue
    const truth = recs[s].me
    // (a JUMP of their own — a tumble, a reset: more than 0.8 m in a frame — is theirs, smoothed by the others over a
    //  few frames as it should be: from 100 ms before each to 900 ms after — it reaches the others a delay later, up to
    //  ~400 ms on a bad line — is left out, and counted)
    const jumps = []
    for (let i = 1; i < truth.length; i++) if (Math.hypot(truth[i][1] - truth[i - 1][1], truth[i][2] - truth[i - 1][2]) > 0.8) jumps.push(truth[i][0])
    const span = seen.filter((x) => x[0] > truth[0][0] + 500 && x[0] < truth.at(-1)[0] && !jumps.some((j) => x[0] > j - 100 && x[0] < j + 900))
    if (span.length < 30) continue
    let best = null
    for (let d = 0; d <= 500; d += 5) {
      let se = 0, mx = 0
      for (const [t, x, z] of span) { const [tx, tz] = lerpAt(truth, t - d); const e = Math.hypot(x - tx, z - tz); se += e * e; mx = Math.max(mx, e) }
      const rms = Math.sqrt(se / span.length)
      if (!best || rms < best.rms) best = { d, rms, mx }
    }
    // the leftover's quick part: each frame's error less the error's own 250 ms average round it
    const res = span.map(([t, x, z]) => { const [tx, tz] = lerpAt(truth, t - best.d); return [t, x - tx, z - tz] })
    let jj = 0
    for (let i = 0; i < res.length; i++) {
      let sx = 0, sz = 0, n = 0
      for (let j = i; j >= 0 && res[i][0] - res[j][0] < 125; j--) { sx += res[j][1]; sz += res[j][2]; n++ }
      for (let j = i + 1; j < res.length && res[j][0] - res[i][0] < 125; j++) { sx += res[j][1]; sz += res[j][2]; n++ }
      jj += (res[i][1] - sx / n) ** 2 + (res[i][2] - sz / n) ** 2
    }
    const moved = Math.hypot(truth.at(-1)[1] - truth[0][1], truth.at(-1)[2] - truth[0][2])
    results.push({ pair: `${o} sees ${s}`, jumps: jumps.length, delay: best.d, rms: +best.rms.toFixed(3), worst: +best.mx.toFixed(2), jitter: +Math.sqrt(jj / res.length).toFixed(3), moved: +moved.toFixed(0) })
  }
}
console.log('pair        delay ms   error RMS / worst (m)   jitter RMS (m)   (moved m)')
for (const r of results) console.log(`${r.pair.padEnd(12)} ${String(r.delay).padStart(6)}      ${r.rms.toFixed(3)} / ${r.worst.toFixed(2)}            ${r.jitter.toFixed(3)}        ${r.moved}${r.jumps ? `   (${r.jumps} jump${r.jumps > 1 ? 's' : ''} of their own left out)` : ''}`)
// (the poses sent a second while moving: the sends with less than 80 ms to the one before — a still player sends 1 a second)
const rate = (s) => { const gaps = []; for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] < 80) gaps.push(s[i] - s[i - 1]); return gaps.length < 10 ? 0 : 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) }
for (const [k, r] of Object.entries(recs)) {
  const fr = ((r.me.length - 1) * 1000) / (r.me.at(-1)[0] - r.me[0][0])
  console.log(`${k}: ${rate(r.sends).toFixed(1)} poses sent a second at ${fr.toFixed(0)} fps`)
}
const worstJ = Math.max(...results.map((r) => r.jitter))
check(results.length === 6, `every player sees the other two (${results.length} of 6 pairs)`)
for (const [k, r] of Object.entries(recs)) check(rate(r.sends) > 18.5, `${k} sends ~20 poses a second (${rate(r.sends).toFixed(1)})`)
check(worstJ < 0.05, `no stutter: the worst jitter ${worstJ.toFixed(3)} m RMS`)
// (the lag is measurable only on who moved: a player who crept a few metres fits any shift)
const movers = results.filter((r) => r.moved > 25), worstDm = movers.length ? Math.max(...movers.map((r) => r.delay)) : 0
const lagMax = 200 + Number(process.env.LAGMS || (process.env.LAGGY ? 280 : 0))
check(worstDm <= lagMax, `the lag within ${lagMax} ms for those who moved (worst ${worstDm} ms; ${movers.length} pairs)`)
fs.writeFileSync(`${out}/sync.json`, JSON.stringify(results, null, 1))

if (process.env.ONLY !== 'motion') {
  // THE THINGS DONE TOGETHER, then a late joiner and a reload: see `checks` below (added as each is fixed)
  const { checks } = await import('./syncchecks.mjs').catch(() => ({ checks: null }))
  if (checks) ok = (await checks({ pa, pb, pc, open, accts, world, check, sleep, out })) && ok
}
check(errs.length === 0, `no page errors (${errs.length}${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''})`)
for (const b of browsers) await b.close().catch(() => {})
console.log(ok ? 'sync: all good' : 'sync: FAILED')
process.exit(ok ? 0 : 1)
