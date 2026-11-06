// mixamo.mjs [outDir] — THE CHARACTER's animation clips from Mixamo (2026-11-05, the user: "use mixamo.com"): opens a
// Chrome window at mixamo.com on its own profile (scripts/oth/.cache/mixamo-profile — the sign-in stays there), waits
// for the user to sign in, then exports each clip below on Mixamo's own character (Y Bot: the `mixamorig` skeleton,
// FBX, no skin, 30 fps) through the site's API with that session, and saves them to outDir (scripts/oth/.cache/mixamo).
// scripts/oth/character.py retargets them onto our character's rig. Mixamo's terms: free for use in games.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
const HERE = path.dirname(new URL(import.meta.url).pathname)
const out = process.argv[2] || path.join(HERE, '..', 'oth', '.cache', 'mixamo')
fs.mkdirSync(out, { recursive: true })
const PROFILE = path.join(HERE, '..', 'oth', '.cache', 'mixamo-profile')
// [file, search, preferred name (first result whose name matches), in place?]
const CLIPS = process.env.EXTRA ? process.env.EXTRA.split(';').map((e) => { const [f, q, n, ip] = e.split('='); return [f, q, new RegExp(`^${n}$`, 'i'), ip === '1'] }) : [
  ['idle', 'breathing idle', /^breathing idle$/i, false],
  ['walk', 'walking', /^walking$/i, true],
  ['run', 'running', /^running$/i, true],
  ['sprint', 'fast run', /^fast run$/i, true],
  ['jump', 'jumping', /^jumping$/i, false],
  ['jump_run', 'running jump', /running jump/i, true],
  ['fall', 'falling idle', /^falling idle$/i, false],
  ['land', 'falling to landing', /falling to landing/i, false],
  ['pickup', 'picking up', /^picking up$/i, false],
  ['grab_ledge', 'hanging idle', /hanging idle/i, false],
  ['climb_ledge', 'climbing', /^climbing$/i, false],
  ['open_door', 'opening door', /open.*door/i, false],
  ['car_enter', 'entering car', /entering car/i, false],
  ['car_exit', 'exiting car', /exiting car/i, false],
  ['sit_drive', 'driving', /^driving$/i, false],
  ['turn_left', 'left turn', /^left turn$/i, false],
  ['turn_right', 'right turn', /^right turn$/i, false],
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// (the window already open — signed in there — is used as it is; else one is opened)
let b = null
try {
  const port = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
} catch { b = null }
const attached = !!b
if (!b) b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, userDataDir: PROFILE, defaultViewport: null, args: ['--window-size=1280,860'] })
let p = (await b.pages()).find((q) => q.url().includes('mixamo.com')) ?? (await b.pages())[0]
if (!p.url().includes('mixamo.com')) await p.goto('https://www.mixamo.com/#/', { waitUntil: 'domcontentloaded' })
console.log('Waiting for the sign-in in the Chrome window (up to 20 min)…')
let token = null
for (let i = 0; i < 600 && !token; i++) {
  // (the sign-in goes round Adobe's pages and back: look at whichever tab is on mixamo.com now)
  p = (await b.pages()).find((q) => q.url().includes('mixamo.com')) ?? p
  token = await p.evaluate(() => localStorage.getItem('access_token')).catch(() => null)
  if (!token) await sleep(2000)
}
if (!token) { console.log('No sign-in — stopped.'); await b.close(); process.exit(1) }
console.log('Signed in.')
const api = (url, init = {}) => p.evaluate(async ([url, init, token]) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'X-Api-Key': 'mixamo2', 'Content-Type': 'application/json', Accept: 'application/json' } })
  const t = await r.text()
  try { return { status: r.status, json: JSON.parse(t) } } catch { return { status: r.status, text: t.slice(0, 300) } }
}, [url, init, token])
// LIST="q1,q2": print what each search finds (names, ids) and stop — choosing a clip
if (process.env.LIST) {
  for (const q of process.env.LIST.split(',')) {
    const r = await api(`https://www.mixamo.com/api/v1/products?page=1&limit=48&order=&type=Motion%2CMotionPack&query=${encodeURIComponent(q)}`)
    console.log(`"${q}":`, (r.json?.results ?? []).filter((x) => x.type === 'Motion').map((x) => x.name + (x.description ? ` [${x.description.slice(0, 40)}]` : '')).join(' | '))
  }
  if (attached) b.disconnect(); else await b.close()
  process.exit(0)
}
const prim = await api('https://www.mixamo.com/api/v1/characters/primary')
const charId = prim.json?.primary_character_id
console.log('character:', prim.json?.primary_character_name, charId)
const report = []
for (const [file, query, want, inplace] of CLIPS) {
  if (fs.existsSync(path.join(out, `${file}.fbx`))) { console.log(`${file}: have it`); continue }
  const s = await api(`https://www.mixamo.com/api/v1/products?page=1&limit=48&order=&type=Motion%2CMotionPack&query=${encodeURIComponent(query)}`)
  const list = (s.json?.results ?? []).filter((r) => r.type === 'Motion')
  // (by its name, or its description — several share a name)
  const pick = list.find((r) => want.test(r.name ?? '') || want.test(r.description ?? '') || want.test(`${r.name} [${r.description}]`)) ?? list[0]
  if (!pick) { console.log(`${file}: nothing for "${query}"`); report.push({ file, query, found: null }); continue }
  const d = await api(`https://www.mixamo.com/api/v1/products/${pick.id}?similar=0&character_id=${charId}`)
  const g = d.json?.details?.gms_hash
  if (!g) { console.log(`${file}: no details`, d.status); continue }
  const params = (g.params ?? []).map((q) => q[1]).join(',')
  const body = {
    character_id: charId, product_name: pick.name, type: 'Motion',
    gms_hash: [{ 'model-id': g['model-id'], mirror: false, trim: g.trim ?? [0, 100], overdrive: 0, params, 'arm-space': g['arm-space'] ?? 0, inplace: inplace && !!g.inplace }],
    preferences: { format: 'fbx7_2019', skin: 'false', fps: '30', reducekf: '0' },
  }
  const ex = await api('https://www.mixamo.com/api/v1/animations/export', { method: 'POST', body: JSON.stringify(body) })
  let url = null
  for (let i = 0; i < 90 && !url; i++) {
    await sleep(1500)
    const m = await api(`https://www.mixamo.com/api/v1/characters/${charId}/monitor`)
    if (m.json?.status === 'completed') url = m.json.job_result
    if (m.json?.status === 'failed') { console.log(`${file}: export failed`, m.json); break }
  }
  if (!url) { console.log(`${file}: no file (export ${ex.status})`); continue }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  fs.writeFileSync(path.join(out, `${file}.fbx`), buf)
  console.log(`${file}: "${pick.name}" — ${(buf.length / 1024).toFixed(0)} kB`)
  report.push({ file, query, name: pick.name, id: pick.id, inplace: body.gms_hash[0].inplace, others: list.slice(0, 6).map((r) => r.name) })
}
fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify(report, null, 1))
console.log('done:', fs.readdirSync(out).filter((f) => f.endsWith('.fbx')).length, 'clips')
if (attached) b.disconnect(); else await b.close()
