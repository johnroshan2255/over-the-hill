// THE HELPER BOT (oth/Bot.ts — SETTINGS › CO-OP): a player in a co-op world in the valley (an ordinary one: building
// costs what it costs) with the bot on, everything 6× (?botspeed=6). Followed through ONE WHOLE CYCLE as the player sees
// it: he joins (one more player in our session, his walker drawn), claims land (his flag in our session), gathers (his
// stockpile grows: wood, stone — trees fall, boulders worked), builds (pieces appear for US), finishes, takes it all down
// and gives the land up, and claims a NEW place somewhere else. Then the setting off: his land and pieces gone, he left.
// Screenshots of him at work, from our camera: <outdir>/bot_*.png
//   node scripts/harness/bottest.mjs <outdir>    env: PORT (5200), TIER (low), SPEED (6), MINUTES (14)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'botshots'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const W = 1280, H = 720, SPEED = Number(process.env.SPEED || 6), MINUTES = Number(process.env.MINUTES || 14)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }
const api = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`)
  return r.json()
}
const A = await api('POST', '/v1/players', { name: 'Asha' })
const world = await api('POST', '/v1/worlds', { name: 'Bot valley', map: 'valley' }, A.token)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--mute-audio'], defaultViewport: { width: W, height: H } })
const errs = []
const page = await (await browser.createBrowserContext()).newPage()
page.on('pageerror', (e) => { errs.push(e.message); console.log('[pageerror]', e.message) })
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); else if (m.type() === 'info' && m.text().startsWith('bot:')) console.log('   ', m.text()) })
await page.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: A.id, name: A.name, token: A.token })
await page.goto(`${BASE}/?coop=${world.id}&bot=1&botspeed=${SPEED}&botlog=1${process.env.FIRST ? `&botfirst=${process.env.FIRST}` : ''}&tier=${process.env.TIER || 'low'}&hour=11&time=0&save=0&dpr=fixed`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__oth?.ready && window.__oth.coop?.pieces?.ready, { timeout: 120_000, polling: 250 })
await page.waitForFunction(() => window.__oth.bot?.session, { timeout: 30_000, polling: 250 }).catch(() => {})

// what WE see of him (our session), and what he is up to (his own)
const look = () => page.evaluate(() => {
  const o = window.__oth, S = o.coop.session, b = o.bot, BS = b?.session
  const botId = BS?.me.id
  const claim = [...S.claims.values()].find((c) => c.owner === botId) ?? null
  const remote = [...S.remotes.values()].find((r) => r.id === botId)
  const drawn = o.coop.remotes.list.find((r) => r.name === BS?.me.name)
  return {
    status: b?.status ?? null, name: BS?.me.name ?? null, seen: !!remote, drawn: drawn ? { x: drawn.x, z: drawn.z } : null,
    claim: claim ? { id: claim.id, x: claim.x, z: claim.z, stock: claim.stock } : null,
    pieces: claim ? [...S.pieces.values()].filter((p) => p.claim === claim.id).length : 0,
    stumps: S.stumps.size, at: b?.at ?? null,
  }
})
const shoot = async (name) => {
  await page.evaluate(() => {
    const o = window.__oth, at = o.bot?.at
    if (!at) return
    const m = o.world.map, a = 0.9, d = 16, cx = at.x + Math.cos(a) * d, cz = at.z + Math.sin(a) * d
    o.view(cx, cz, 6, Math.atan2(-(at.x - cx), -(at.z - cz)), -0.25)
    void m
  })
  await sleep(1200)
  await page.screenshot({ path: `${out}/${name}.png` })
}

let s = await look()
check(!!s.name && s.name.endsWith('· bot'), `the bot joined as "${s.name}"`)
await sleep(1500)
s = await look()
check(s.seen && !!s.drawn, 'we see him: one more player in our session, his walker drawn')
await shoot('bot_0_joined')

const t0 = Date.now(), CYCLES = Number(process.env.CYCLES || 1)
let firstClaim = null, maxStock = { wood: 0, stone: 0 }, maxPieces = 0, gone = false, second = null, shots = 1, lastStatus = '', stumps0 = s.stumps
// (every project followed: its land, the most pieces it stood with, its ponds and paving as we see them)
const projects = []
let cur = null
while (Date.now() - t0 < MINUTES * 60_000) {
  await sleep(2000)
  s = await look()
  if (s.status !== lastStatus) { lastStatus = s.status; console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} s] ${s.status}  (pieces ${s.pieces}${s.claim ? `, stock ${s.claim.stock.wood}w ${s.claim.stock.stone}s` : ''})`) }
  if (s.claim && (!cur || cur.id !== s.claim.id)) {
    const name = await page.evaluate(() => window.__oth.bot?.project_ ?? '')
    cur = { id: s.claim.id, name, pieces: 0, extras: null, shot: false }
    projects.push(cur)
  }
  if (s.claim && cur && s.claim.id === cur.id) {
    cur.pieces = Math.max(cur.pieces, s.pieces)
    if (s.status?.startsWith('Finished') && !cur.shot) {
      cur.shot = true
      cur.extras = await page.evaluate((id) => { const S = window.__oth.coop.session; return { ponds: [...S.ponds.values()].filter((p) => p.claim === id).length, strokes: (S.paint.get(id) ?? []).length, kinds: [...new Set([...S.pieces.values()].filter((p) => p.claim === id).map((p) => p.kind))] } }, cur.id)
      console.log(`   FINISHED ${cur.name}: ${cur.pieces} pieces (${cur.extras.kinds.join(', ')}), ponds ${cur.extras.ponds}, paving strokes ${cur.extras.strokes}`)
      await shoot(`bot_4_done_${projects.length}_${cur.name.replace(/^an? /, '').replace(/\s+/g, '_')}`)
    }
  }
  if (s.claim && !firstClaim) { firstClaim = s.claim; await shoot('bot_1_flag') }
  if (s.claim && firstClaim && s.claim.id === firstClaim.id) {
    maxStock.wood = Math.max(maxStock.wood, s.claim.stock.wood); maxStock.stone = Math.max(maxStock.stone, s.claim.stock.stone)
    if (s.pieces > maxPieces) { maxPieces = s.pieces; if (s.pieces === 1 || s.pieces % 3 === 0) await shoot(`bot_2_building_${String(shots++).padStart(2, '0')}`) }
  }
  if (firstClaim && !gone && (!s.claim || s.claim.id !== firstClaim.id)) { gone = true; console.log('   (his first place is given up)') }
  if (gone && s.claim && s.claim.id !== firstClaim.id && !second) { second = s.claim; await shoot('bot_3_next_place') }
  if (projects.filter((p) => p.shot).length >= CYCLES && second) break
}
if (CYCLES > 1) for (const p of projects.filter((q) => q.shot)) check(p.pieces >= 4, `${p.name}: built ${p.pieces} pieces${p.extras?.ponds ? `, ${p.extras.ponds} pond` : ''}${p.extras?.strokes ? `, ${p.extras.strokes} paving strokes` : ''}`)
if (CYCLES > 1) check(projects.filter((p) => p.shot).length >= CYCLES, `${projects.filter((p) => p.shot).length} of ${CYCLES} projects finished in ${MINUTES} min`)
check(!!firstClaim, 'he claimed land (his flag in our session)')
check(s.stumps > stumps0 || maxStock.stone > 0, `he gathered: ${s.stumps - stumps0} trees felled, stockpile up to ${maxStock.wood} wood / ${maxStock.stone} stone`)
check(maxPieces >= 3, `he built: ${maxPieces} pieces on his land, seen by us`)
check(gone, 'finished, he took it down and gave the land up')
check(!!second && Math.hypot(second.x - firstClaim.x, second.z - firstClaim.z) > 60, `he moved on and claimed a new place ${second ? Math.round(Math.hypot(second.x - firstClaim.x, second.z - firstClaim.z)) : '—'} m away`)

// the setting off: his things down, his land given up, he leaves
await page.evaluate(() => window.__oth.stopBot())
await sleep(4000)
const after = await page.evaluate(() => {
  const S = window.__oth.coop.session
  return { players: [...S.remotes.values()].filter((r) => r.name.endsWith('· bot')).length, claims: [...S.claims.values()].filter((c) => c.owner_name.endsWith('· bot')).length, pieces: [...S.pieces.values()].filter((p) => !S.claims.get(p.claim) || S.claims.get(p.claim).owner_name.endsWith('· bot')).length }
})
check(after.players === 0 && after.claims === 0 && after.pieces === 0, `off: he took his things down and left (bot players ${after.players}, his land ${after.claims}, his pieces ${after.pieces})`)
check(errs.length === 0, `no page errors (${errs.length})${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`)
await browser.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
