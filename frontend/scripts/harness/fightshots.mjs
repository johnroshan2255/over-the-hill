// fightshots.mjs [outDir] — THE FIGHT, SEEN (oth/Companion.ts, the clips of scripts/oth/fight.py): you and the enemy on
// foot, watched from beside you while the game plays on (`__oth.spectate`) — his runs landing on you, yours on him (J
// pressed again as each lands; U the kicks), a frame every 110 ms: three sheets — his attack, your punches, your kicks.
//   node scripts/harness/fightshots.mjs screenshots/fight     env: PORT (5200), TIER (high)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const out = process.argv[2] || 'screenshots/fight'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 720, H = 405
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'high'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&companion=enemy`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
await p.evaluate(() => { window.__oth.footCam() })
await p.keyboard.down('KeyW'); await sleep(2400); await p.keyboard.up('KeyW')
// he comes; when he's on you, watch from your right
for (let i = 0; i < 80; i++) { await sleep(400); if (await p.evaluate(() => { const o = window.__oth, c = o.companion; return c.mode === 'foot' && c.hero.pos.distanceTo(o.hero.pos) < 1.6 })) break }
await p.evaluate(() => { const o = window.__oth; o.companion.hp = 100000; o.companion.yours = 100000; o.spectate(3.0, 1.35, -0.55, 1.05) })
const strip = async (name, n, during) => {
  const files = []
  let k = 0
  const t = during ? setInterval(() => { void during(k++) }, 260) : null
  for (let i = 0; i < n; i++) { const f = `${out}/_${name}_${String(i).padStart(2, '0')}.png`; await p.screenshot({ path: f, clip: { x: 120, y: 40, width: 480, height: 330 } }); files.push(f); await sleep(70) }
  if (t) clearInterval(t)
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
files = sys.argv[2:]; cols = 6
ims = [Image.open(f).convert('RGB').resize((360, 248), Image.LANCZOS) for f in files]
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * 360, rows * 248))
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * 360, (i // cols) * 248))
sheet.save(sys.argv[1])
`, `${out}/${name}.png`, ...files])
  for (const f of files) fs.unlinkSync(f)
  console.log('sheet', `${out}/${name}.png`, JSON.stringify(await p.evaluate(() => { const c = window.__oth.companion; return { landed: c.landed, his: c.hero.playing, yours: window.__oth.hero.playing } })))
}
await strip('his_attack', 18, null)
await strip('your_punches', 18, async () => { await p.keyboard.down('KeyJ'); await sleep(50); await p.keyboard.up('KeyJ') })
await sleep(900)
await strip('your_kicks', 18, async () => { await p.keyboard.down('KeyU'); await sleep(50); await p.keyboard.up('KeyU') })
await b.close()
