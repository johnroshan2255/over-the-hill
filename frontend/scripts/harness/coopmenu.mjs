// THE CO-OP SCREEN, as a player uses it: the title → CO-OP → type a name → HOST A NEW WORLD → the world on the list
// with its code → a second player JOINS WITH THE CODE → both pick it → both in the game, each seeing the other.
// Screenshots of the screen at each step.   node scripts/harness/coopmenu.mjs <outdir>   env: PORT (5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const out = process.argv[2] ?? 'coopmenu'
fs.mkdirSync(out, { recursive: true })
const PORT = process.env.PORT || 5200, BASE = `http://localhost:${PORT}`
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const ANGLE = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'gl'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, what) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}`); if (!c) ok = false }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
const page = async () => {
  const p = await (await browser.createBrowserContext()).newPage()
  p.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await p.goto(`${BASE}/`, { waitUntil: 'load' })
  await p.waitForSelector('.oh-item')
  return p
}
const clickText = (p, sel, text) => p.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find((e) => e.textContent.toLowerCase().includes(text)); b?.click(); return !!b }, sel, text)
const typeInto = async (p, sel, text) => { await p.click(sel, { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.type(sel, text) }

// the host
const a = await page()
check(await clickText(a, '.oh-item', 'co-op'), 'the title has CO-OP')
await sleep(300)
await typeInto(a, '.oh-in-name', 'Asha')
await a.screenshot({ path: `${out}/1_coop_screen.png` })
check(await clickText(a, '.oh-row', 'host a new world'), 'HOST A NEW WORLD')
await a.waitForFunction(() => document.querySelector('.oh-bigcode'), { timeout: 10000 }).catch(async () => { await a.screenshot({ path: `${out}/fail_host.png` }); console.log('side:', await a.$eval('.oh-side', (e) => e.textContent)); process.exit(1) })
const code = await a.$eval('.oh-bigcode', (e) => e.textContent)
check(/^[A-Z0-9]{6}$/.test(code), `the new world's code: ${code}`)
await a.screenshot({ path: `${out}/2_hosted.png` })

// the friend joins with the code
const b = await page()
await clickText(b, '.oh-item', 'co-op'); await sleep(300)
await typeInto(b, '.oh-in-name', 'Ravi')
await typeInto(b, '.oh-in-code', code.toLowerCase())
await b.keyboard.press('Enter')
await b.waitForFunction(() => [...document.querySelectorAll('.oh-world')].length > 0, { timeout: 10000 }).catch(async () => {
  await b.screenshot({ path: `${out}/fail_join.png` })
  console.log('side:', await b.$eval('.oh-side', (e) => e.textContent), '| code box:', await b.$eval('.oh-in-code', (e) => e.value))
  process.exit(1)
})
check((await b.$$eval('.oh-world .oh-code', (es) => es.map((e) => e.textContent))).includes(code), 'the friend has the world on their list')
await b.screenshot({ path: `${out}/3_joined.png` })

// both drive in (Enter on the world)
for (const p of [a, b]) {
  await p.evaluate(() => [...document.querySelectorAll('.oh-world')][0].click())
}
for (const p of [a, b]) await p.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 120000, polling: 250 })
await sleep(3000)
const names = async (p) => p.evaluate(() => window.__oth.coop.remotes.list.map((r) => r.name))
check((await names(a)).includes('Ravi'), 'in the game, Asha sees Ravi')
check((await names(b)).includes('Asha'), 'in the game, Ravi sees Asha')
await b.screenshot({ path: `${out}/4_in_game.png` })
// the list now says who's in
const c = await page()
await c.evaluate((acct) => localStorage.setItem('overhill.player.v1', acct), await a.evaluate(() => localStorage.getItem('overhill.player.v1')))
await c.reload({ waitUntil: 'load' }); await c.waitForSelector('.oh-item')
await clickText(c, '.oh-item', 'co-op')
await c.waitForFunction(() => document.querySelector('.oh-online.on'), { timeout: 10000 }).catch(() => {})
check(/2 in/.test(await c.$eval('.oh-world', (e) => e.textContent).catch(() => '')), "the list shows who's in")
await c.screenshot({ path: `${out}/5_list_online.png` })
await browser.close()
console.log(ok ? 'co-op screen: all good' : 'co-op screen: FAILED')
process.exit(ok ? 0 : 1)
