// towprobe.mjs — ONE PLAYER IN A CO-OP WORLD, THE TRAILER HITCHED: where the tow ball is (its height over the ground,
// standing), the coupler's, and how fast the car pulls it on full throttle for 3 s — a ball set too low drags the
// drawbar along the ground (2026-11-24: found as the car fell from where it was placed, Trailer.ensureBall).
//   node scripts/harness/towprobe.mjs     env: PORT (5200)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (method, path, body, token) => (await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json()
const A = await api('POST', '/v1/players', { name: 'Asha' })
const world = await api('POST', '/v1/worlds', { name: 'Tow', map: 'valley' }, A.token)
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.evaluateOnNewDocument((a) => localStorage.setItem('overhill.player.v1', JSON.stringify(a)), { id: A.id, name: A.name, token: A.token })
await p.goto(`${BASE}/?coop=${world.id}&tier=low&hour=12&time=0&save=0&dpr=fixed&companion=off`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.trailer?.hitched, { timeout: 120000, polling: 250 })
await sleep(2000)
const at = () => p.evaluate(() => {
  const o = window.__oth, t = o.trailer, V = o.car.pos.constructor
  const ball = t.ballWorld(new V()), cp = t.couplerWorld(new V())
  return { ballOverGround: +(ball.y - o.map.height(ball.x, ball.z)).toFixed(2), couplerOverGround: +(cp.y - o.map.height(cp.x, cp.z)).toFixed(2), x: o.car.pos.x, z: o.car.pos.z }
})
const s0 = await at()
await p.keyboard.down('KeyW'); await sleep(3000)
const kmh = await p.evaluate(() => window.__oth.car.speedKmh)
await p.keyboard.up('KeyW')
const s1 = await at()
console.log(JSON.stringify({ standing: s0, kmhAfter3s: +kmh.toFixed(1), metres: +Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1) }))
await b.close()
