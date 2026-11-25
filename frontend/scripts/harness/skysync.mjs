// skysync.mjs [outDir] — THE WORLD'S SKY AND THE CARS' DAMAGE IN SYNC, MINUTE BY MINUTE (2026-11-25, the user: "check
// whether weather change and daylight are properly synced with all multiplayers, and car damage also synced properly
// … check every minute this is synced in all multiplayer users with no lags or jittering"). Three players, each in
// their own browser, for MINUTES minutes; each minute one thing changes, then everything is checked on every page:
//   minute 1  B moves the clock on (G)                       — every page's hour follows within 2 s
//   minute 2  C pins the weather to rain (Shift + G ×3)      — every page's sky clouds over and rains alike
//   minute 3  A's car takes blows: crashes, a round, a hard landing that bursts a tyre — B's and C's copy of A's car
//             matches A's own: the crush, every pane, lamp, wheel, the engine
//   minute 4  D joins late                                   — told the hour, the weather and A's broken car
//   minute 5  A's car catches fire and goes up, then it is mended — all four see the shell, then the car whole
// and EVERY minute: the hour, the weather, the cloud / rain / wet on every page (sampled at once), A's car on every
// page, nobody's camp prompt up though they stand still (commented out, 2026-11-25), and 12 s of all three moving —
// the lag and the jitter of each pair as syncplay.mjs measures them.
//   node scripts/harness/skysync.mjs <outdir>   env: PORT (5200), TIER (low), MINUTES (5)
// Needs: `npm run dev` and the server (`cd backend && cargo run --release`).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'skysync'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`, MINUTES = Math.max(5, Number(process.env.MINUTES || 5))
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const fails = []
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) { ok = false; fails.push(what) } }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}
const names = ['Asha', 'Ravi', 'Chen', 'Dara']
const accts = []
for (const n of names) accts.push(await api('POST', '/v1/players', { name: n }))
const world = await api('POST', '/v1/worlds', { name: 'Sky valley', map: 'valley' }, accts[0].token)
for (const a of accts.slice(1)) await api('POST', '/v1/worlds/join', { code: world.code }, a.token)
console.log(`world ${world.name} · code ${world.code} · ${MINUTES} minutes`)

const errs = []
const browsers = []
const open = async (who) => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
  browsers.push(b)
  const page = await b.newPage()
  page.on('pageerror', (e) => { errs.push(`${who.name}: ${e.message}`); console.log(`[${who.name} pageerror]`, e.message) })
  page.on('console', (m) => { if (m.type() === 'error') { errs.push(`${who.name}: ${m.text().slice(0, 200)}`); console.log(`[${who.name}]`, m.text().slice(0, 300)) } })
  await page.evaluateOnNewDocument((acct) => localStorage.setItem('overhill.player.v1', JSON.stringify(acct)), { id: who.id, name: who.name, token: who.token })
  // (each page asks for its own hour: the world's must win)
  const hour = [9, 15, 20, 3][names.indexOf(who.name)]
  await page.goto(`${BASE}/?coop=${world.id}&tier=${process.env.TIER || 'low'}&hour=${hour}&save=0&dpr=fixed&weaponsites=0`, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop && window.__oth.coop.session.sky, { timeout: 180_000, polling: 250 })
  return page
}
const P = {}
for (const k of ['A', 'B', 'C']) P[k] = await open(accts['ABC'.indexOf(k)])
await sleep(5000)
await P.B.evaluate(() => window.__oth.foot())
await P.C.evaluate(() => window.__oth.ride())
await sleep(3000)
const t0 = Date.now()

// ---- what each page says
const skyOf = (p) => p.evaluate(() => { const a = window.__oth.atmos, u = a.uniforms; return { t: Date.now(), hour: a.hour, weather: a.weather, cloud: u.uCloud.value, rain: u.uRain.value, wet: u.uWet.value, night: u.uNight?.value ?? null } })
// (a car's damage, all of it that shows: the crush, each pane / lamp / wheel, the engine, burning, a shell)
const dmgOf = (p, sid) => p.evaluate((sid) => {
  const o = window.__oth
  const dm = sid == null ? o.car.damage : o.coop.remotes['avatars'].get(sid)?.car.damage
  if (!dm) return null
  return { crush: +dm.crush.toFixed(4), engine: Math.round(dm.engine), burning: dm.burning, wrecked: dm.wrecked, whole: dm.whole,
    // (the panes by where they are — your own car's driver's door is its own piece, so its pane comes last in the list;
    //  the copy the others draw has every door in the body: the same panes, in another order)
    panes: dm.panes.map((q) => [q.x.toFixed(2), q.y.toFixed(2), q.z.toFixed(2), q.state]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((q) => q[3]).join(''), lamps: dm.lamps.map(Number).join(''),
    wheels: dm.wheels.map((w) => `${w.bend.toFixed(3)}${w.flat ? 'F' : ''}${w.jam ? 'J' : ''}${w.off ? 'O' : ''}`).join(' ') }
}, sid)
const promptOf = (p) => p.evaluate(() => ({ text: document.querySelector('.oth-prompt')?.textContent ?? '', camp: !!document.querySelector('.oth-campbtn.on') }))
const sidA = await P.A.evaluate(() => window.__oth.coop.session.me.sid)
const wrap = (d) => Math.abs(((d + 36) % 24) - 12)

const skyAgree = async (label) => {
  const keys = Object.keys(P)
  const s = await Promise.all(keys.map((k) => skyOf(P[k])))
  // (sampled within a few ms of one another; the clock runs 0.5 game-minutes a real second by day — allowed 0.02 h)
  let dh = 0, dc = 0, dr = 0, dw = 0, same = true
  for (let i = 1; i < s.length; i++) {
    dh = Math.max(dh, wrap(s[i].hour - s[0].hour)); dc = Math.max(dc, Math.abs(s[i].cloud - s[0].cloud))
    dr = Math.max(dr, Math.abs(s[i].rain - s[0].rain)); dw = Math.max(dw, Math.abs(s[i].wet - s[0].wet))
    if (s[i].weather !== s[0].weather) same = false
  }
  console.log(`  ${label}: ` + keys.map((k, i) => `${k} ${s[i].hour.toFixed(3)}h ${s[i].weather} c${s[i].cloud.toFixed(3)} r${s[i].rain.toFixed(3)} w${s[i].wet.toFixed(3)}`).join(' | '))
  check(dh < 0.02 && same && dc < 0.02 && dr < 0.03 && dw < 0.02, `${label}: one sky on ${keys.length} pages (hour ±${(dh * 60).toFixed(2)} game-min, cloud ±${dc.toFixed(3)}, rain ±${dr.toFixed(3)}, wet ±${dw.toFixed(3)}${same ? '' : ', the weather differs'})`)
  return s
}
const dmgAgree = async (label) => {
  const own = await dmgOf(P.A, null)
  const others = {}
  for (const k of Object.keys(P)) if (k !== 'A') others[k] = await dmgOf(P[k], sidA)
  const want = JSON.stringify({ ...own, burning: undefined })
  let all = true
  for (const [k, d] of Object.entries(others)) {
    const same = d && JSON.stringify({ ...d, burning: undefined }) === want && d.burning === own.burning
    if (!same) { all = false; console.log(`  ${k} sees A's car: ${JSON.stringify(d)}`) }
  }
  console.log(`  A's car: ${JSON.stringify(own)}`)
  check(all, `${label}: A's car the same on ${Object.keys(others).length + 1} pages (crush ${own?.crush}, engine ${own?.engine}, panes ${own?.panes}, lamps ${own?.lamps}, wheels ${own?.wheels})`)
  return own
}

// ---- the motion window: 12 s of all three moving, recorded every frame (syncplay.mjs's measure)
const record = (p) => p.evaluate(() => {
  const o = window.__oth, c = o.coop
  window.__rec = { me: [], seen: {} }
  const f = () => {
    if (!window.__rec) return
    const t = Date.now(), m = c['me']
    if (m) window.__rec.me.push([t, m.p.x, m.p.z])
    for (const r of c.remotes.list) (window.__rec.seen[r.name] ??= []).push([t, r.x, r.z])
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})
const stopRec = (p) => p.evaluate(() => { const r = window.__rec; window.__rec = null; return r })
const keys = async (p, ks, ms) => { for (const k of ks) await p.keyboard.down(k); await sleep(ms); for (const k of ks) await p.keyboard.up(k) }
const lerpAt = (ser, t) => {
  let lo = 0, hi = ser.length - 1
  if (t <= ser[0][0]) return [ser[0][1], ser[0][2]]
  if (t >= ser[hi][0]) return [ser[hi][1], ser[hi][2]]
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ser[m][0] <= t) lo = m; else hi = m }
  const a = ser[lo], b = ser[hi], f = (t - a[0]) / (b[0] - a[0] || 1)
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
const letter = { Asha: 'A', Ravi: 'B', Chen: 'C', Dara: 'D' }
const motion = async (label, wrecked) => {
  const movers = ['A', 'B', 'C']
  await Promise.all(movers.map((k) => record(P[k])))
  await Promise.all([
    wrecked ? sleep(11000) : (async () => { await keys(P.A, ['KeyW'], 3000); await keys(P.A, ['KeyW', 'KeyA'], 2000); await keys(P.A, ['KeyW'], 2000); await keys(P.A, ['KeyW', 'KeyD'], 2000); await keys(P.A, ['KeyS'], 2000) })(),
    (async () => { await P.B.evaluate(() => window.__oth.footCam()); await keys(P.B, ['KeyW', 'ShiftLeft'], 8000); await keys(P.B, ['KeyW', 'KeyD'], 3000) })(),
    (async () => { await keys(P.C, ['KeyW'], 3000); await keys(P.C, ['KeyW', 'KeyD'], 2000); await keys(P.C, ['KeyW'], 3000); await keys(P.C, ['KeyS'], 2000) })(),
  ])
  await sleep(1000)
  const recs = {}
  for (const k of movers) recs[k] = await stopRec(P[k])
  const res = []
  for (const [o, rec] of Object.entries(recs)) for (const [name, seen] of Object.entries(rec.seen)) {
    const s = letter[name]
    if (!recs[s]) continue
    const truth = recs[s].me
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
    const r = span.map(([t, x, z]) => { const [tx, tz] = lerpAt(truth, t - best.d); return [t, x - tx, z - tz] })
    let jj = 0
    for (let i = 0; i < r.length; i++) {
      let sx = 0, sz = 0, n = 0
      for (let j = i; j >= 0 && r[i][0] - r[j][0] < 125; j--) { sx += r[j][1]; sz += r[j][2]; n++ }
      for (let j = i + 1; j < r.length && r[j][0] - r[i][0] < 125; j++) { sx += r[j][1]; sz += r[j][2]; n++ }
      jj += (r[i][1] - sx / n) ** 2 + (r[i][2] - sz / n) ** 2
    }
    const moved = Math.hypot(truth.at(-1)[1] - truth[0][1], truth.at(-1)[2] - truth[0][2])
    res.push({ pair: `${o} sees ${s}`, delay: best.d, rms: best.rms, worst: best.mx, jitter: Math.sqrt(jj / r.length), moved })
  }
  for (const r of res) console.log(`  ${r.pair}  lag ${String(r.delay).padStart(3)} ms  error ${r.rms.toFixed(3)} / ${r.worst.toFixed(2)} m  jitter ${r.jitter.toFixed(3)} m  (moved ${r.moved.toFixed(0)} m)`)
  const mv = res.filter((r) => r.moved > 25), lag = mv.length ? Math.max(...mv.map((r) => r.delay)) : 0, jit = res.length ? Math.max(...res.map((r) => r.jitter)) : 1
  check(res.length === 6, `${label}: every mover sees the other two (${res.length} of 6 pairs)`)
  check(jit < 0.05, `${label}: no jitter (worst ${jit.toFixed(3)} m RMS)`)
  check(lag <= 200, `${label}: the lag within 200 ms (worst ${lag} ms over ${mv.length} pairs that moved)`)
  return { lag, jit, pairs: res.length }
}
const atMinute = async (m) => { const due = t0 + m * 60_000; const w = due - Date.now(); if (w > 0) await sleep(w) }

// ---- minute 0: on joining, everyone took the world's hour, not their own (9, 15, 20 asked)
const log = []
console.log(`\nminute 0 — joined (each page asked for its own hour)`)
const s0 = await skyAgree('joined')
await dmgAgree('joined')

for (let m = 1; m <= MINUTES; m++) {
  await atMinute(m - 1 + 0.02)
  console.log(`\nminute ${m}`)
  const row = { minute: m }
  if (m === 1) {
    // B moves the clock on (G): to the next of morning / noon / evening / night
    const before = (await skyOf(P.B)).hour
    await P.B.keyboard.press('KeyG')
    await sleep(2000)
    const s = await skyAgree('B pressed G')
    check(wrap(s[0].hour - before) > 0.5, `the hour moved for everyone (${before.toFixed(2)} → ${s[0].hour.toFixed(2)})`)
  } else if (m === 2) {
    // C pins rain (Shift + G: auto → clear → cloudy → rain)
    for (let i = 0; i < 3; i++) { await P.C.keyboard.down('ShiftLeft'); await P.C.keyboard.press('KeyG'); await P.C.keyboard.up('ShiftLeft'); await sleep(300) }
    await sleep(1500)
    const s = await skyAgree('C pinned rain')
    check(s.every((x) => x.weather === 'rain'), `rain pinned on every page (${s.map((x) => x.weather).join(', ')})`)
  } else if (m === 3) {
    // A's car takes blows (in its own space): the nose, the side, the windscreen; a round; a hard landing
    await P.A.evaluate(() => {
      const dm = window.__oth.car.damage, M = dm.model
      dm.hit(0.3, M.half.y * 0.5, M.front + 0.1, 0, 0, 1, 14)
      dm.hit(M.half.x, M.half.y * 0.6, 0.4, -1, 0, 0, 11)
      dm.hit(0, M.half.y * 1.1, M.front * 0.35, 0, -0.4, 0.9, 9)
      dm.hit(-M.half.x, M.half.y * 0.5, -0.8, 1, 0, 0, 0, 'shot')
      dm.landing(2, 30)
    })
    await sleep(1500)
    const d = await dmgAgree('after the blows')
    check(d && !d.whole && d.wheels.includes('F'), `A's car is broken: a burst tyre from the landing (${d?.wheels})`)
  } else if (m === 4) {
    // D joins late
    P.D = await open(accts[3])
    await sleep(6000)
    await skyAgree('D joined late')
    await dmgAgree('D joined late')
  } else if (m === 5) {
    // A's car alight (a blow in the engine's bay, hard enough), then it goes up (the fire's own clock — hurried)
    await P.A.evaluate(() => { const dm = window.__oth.car.damage; dm.engine = 1; dm.hit(0, dm.model.half.y * 0.6, dm.model.front + 0.1, 0, 0, 1, 40) })
    await sleep(1500)
    const lit = await Promise.all(Object.keys(P).map((k) => dmgOf(P[k], k === 'A' ? null : sidA)))
    check(lit.every((d) => d?.burning || d?.wrecked), `A's car on fire on every page (${lit.map((d) => (d?.wrecked ? 'shell' : d?.burning ? 'fire' : 'no')).join(', ')})`)
    await P.A.evaluate(() => window.__oth.car.damage.explode())
    await sleep(1500)
    const shell = await Promise.all(Object.keys(P).map((k) => dmgOf(P[k], k === 'A' ? null : sidA)))
    check(shell.every((d) => d?.wrecked), `A's car a burnt shell on every page (${shell.map((d) => (d?.wrecked ? 'shell' : 'not')).join(', ')})`)
    await dmgAgree('gone up')
  }
  // every minute: all moving, then the sky, A's car, the prompts (everyone stopped)
  const mo = await motion(`minute ${m} moving`, m === 5)
  if (m === 5) {
    await P.A.evaluate(() => window.__oth.car.damage.repair())
    await sleep(1500)
    const d = await dmgAgree('mended')
    check(d?.whole, 'A\'s car whole again on every page')
  }
  await sleep(1500)
  const s = await skyAgree(`minute ${m}`)
  await dmgAgree(`minute ${m}`)
  const pr = await Promise.all(Object.keys(P).map(async (k) => [k, await promptOf(P[k])]))
  check(pr.every(([, x]) => !/camp/i.test(x.text) && !x.camp), `minute ${m}: no camp prompt though stopped (${pr.map(([k, x]) => `${k} "${x.text}"${x.camp ? ' +CAMP' : ''}`).join(', ')})`)
  Object.assign(row, { hour: +s[0].hour.toFixed(3), weather: s[0].weather, cloud: +s[0].cloud.toFixed(3), rain: +s[0].rain.toFixed(3), lagMs: mo.lag, jitterM: +mo.jit.toFixed(3) })
  log.push(row)
}
// (the day ran on — at the world's pace: 30 game-minutes a real one by day)
console.log('\nminute  hour    weather  cloud  rain   lag ms  jitter m')
for (const r of log) console.log(`${String(r.minute).padStart(6)}  ${r.hour.toFixed(2).padStart(5)}   ${r.weather.padEnd(7)}  ${r.cloud.toFixed(2)}   ${r.rain.toFixed(2)}   ${String(r.lagMs).padStart(5)}   ${r.jitterM.toFixed(3)}`)
fs.writeFileSync(`${out}/skysync.json`, JSON.stringify({ s0, log, fails }, null, 1))
check(errs.length === 0, `no page errors (${errs.length}${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''})`)
for (const b of browsers) await b.close().catch(() => {})
console.log(ok ? 'skysync: all good' : `skysync: FAILED (${fails.length})`)
process.exit(ok ? 0 : 1)
