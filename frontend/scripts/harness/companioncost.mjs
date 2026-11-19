// WHAT THE COMPANION AND THE WEAPONS COST A FRAME (oth/Companion.ts, oth/Weapons.ts): their own code timed in the page
// — the companion's update / physics step / skeleton / cull, the weapons' update, the pick-ups' — over 240 frames in
// each state: the friend beside you on foot, the enemy fighting you, a rifle firing, the katana cutting. JS only (the
// draws are counted by `npm run shot`): ms a frame on this machine; a Snapdragon 6-series runs JS about 6–8× slower.
//   node scripts/harness/companioncost.mjs    env: PORT (5200), TIER (low)
import puppeteer from 'puppeteer-core'
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const run = async (kind) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${BASE}/?tier=${process.env.TIER || 'low'}&hour=11&time=0&save=0&dpr=fixed&companion=${kind}&weapons=all`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__oth?.ready, { timeout: 120_000, polling: 250 })
  await sleep(2500)
  const key = async (c, ms = 70) => { await page.keyboard.down(c); await sleep(ms); await page.keyboard.up(c) }
  // every method timed, summed a frame
  await page.evaluate(() => {
    const o = window.__oth, T = (window.__cost = { ms: 0, frames: 0, parts: {} })
    const wrap = (obj, name, tag, frame) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; T.ms += d; T.parts[tag] = (T.parts[tag] ?? 0) + d; if (frame) T.frames++; return r } }
    const c = o.companion
    wrap(c, 'update', 'companion.update', true); wrap(c, 'fixed', 'companion.fixed'); wrap(c, 'animate', 'companion.skeleton'); wrap(c, 'cull', 'companion.cull')
    wrap(o.arsenal, 'update', 'weapons.update'); wrap(o.pickups, 'update', 'pickups.update')
  })
  const measure = async (what, ms = 4000) => {
    await page.evaluate(() => { const T = window.__cost; T.ms = 0; T.frames = 0; T.parts = {} })
    await sleep(ms)
    const r = await page.evaluate(() => { const T = window.__cost; return { per: T.ms / Math.max(1, T.frames), frames: T.frames, parts: Object.fromEntries(Object.entries(T.parts).map(([k, v]) => [k, +(v / Math.max(1, T.frames)).toFixed(4)])) } })
    console.log(`${kind.padEnd(7)} ${what.padEnd(34)} ${r.per.toFixed(3)} ms a frame   ${JSON.stringify(r.parts)}`)
  }
  await measure('in the car (he rides / follows)')
  await key('KeyF')
  for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
  await page.keyboard.down('KeyA'); await sleep(3000)
  await measure('on foot, walking (he keeps up)', 3000)
  await page.keyboard.up('KeyA')
  await page.evaluate(() => window.__oth.arsenal.equip('ak47')); await sleep(900)
  await page.keyboard.down('KeyJ'); await measure('the AK-47 firing', 2500); await page.keyboard.up('KeyJ')
  await page.evaluate(() => window.__oth.arsenal.equip('katana')); await sleep(1200)
  const cut = setInterval(() => { void key('KeyJ') }, 450)
  await measure('the katana cutting', 3000)
  clearInterval(cut)
  await page.close()
}
await run('friend')
await run('enemy')
await browser.close()
