// weaponshots.mjs [outDir] [what] — THE WEAPONS IN HIS HANDS, SEEN (docs/WEAPONS.md): each one held — standing, running
// forward, to the side, backward — from the play's own camera, from his side and his front (main.ts `spectate`: the
// game plays on with its camera), and in first person; one sheet a weapon.
//   node scripts/harness/weaponshots.mjs screenshots/weapons [pistol,ak47,sniper,fists]    env: PORT (5200), TIER (high),
//   MOVES (stand,run,sprint,aim,aimrun,aimleft,aimback — carried / AIMED, third person's two ways; walk, left, back, right),
//   VIEWS (play,side,front,fpp), Q (URL params)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const out = process.argv[2] || 'screenshots/weapons'
const WHAT = (process.argv[3] || 'pistol,ak47,sniper').split(',')
const MOVES = (process.env.MOVES || 'stand,run,aim,aimrun,aimleft,aimback').split(','), VIEWS = (process.env.VIEWS || 'play,side,front,fpp').split(',')
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 960, H = 540
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 300)) })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'high'}&hour=${process.env.HOUR || 12}&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&weapons=all${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
// (out on open ground, away from the car)
await p.evaluate(() => { const o = window.__oth; o.arsenal.host.kick = () => {}; o.footCam() })
await p.keyboard.down('KeyW'); await sleep(2600); await p.keyboard.up('KeyW'); await sleep(600)
const KEY = { stand: null, run: 'KeyW', sprint: 'KeyW', left: 'KeyA', back: 'KeyS', right: 'KeyD', walk: 'KeyW', aim: null, aimrun: 'KeyW', aimleft: 'KeyA', aimback: 'KeyS' }
const EYE = { side: [2.5, 1.25, -0.25, 1.1], front: [0.9, 1.45, -2.3, 1.15], back: [-0.7, 1.5, 2.4, 1.15], top: [0.01, 3.6, 0.2, 1.2] }
for (const w of WHAT) {
  await p.evaluate((w) => { const o = window.__oth; o.spectate(); o.thirdPerson(); o.arsenal.equip(w === 'fists' ? null : w) }, w)
  await sleep(1600)
  if (process.env.PITCH) await p.evaluate((k) => { window.__oth.chasePitch?.(Number(k)) }, process.env.PITCH)
  const files = []
  for (const mv of MOVES) {
    // (aimed: the other button held — third person's gun comes up, the camera in over his shoulder)
    await p.evaluate((aim, w) => { const a = window.__oth.arsenal; if (w !== 'sniper' && w !== 'fists') a.press('alt', aim); else a.aimHeld = aim }, mv.startsWith('aim'), w)
    if (mv.startsWith('aim')) await sleep(500)
    if (KEY[mv]) { if (mv === 'walk') await p.keyboard.down('ControlLeft'); if (mv === 'sprint') await p.keyboard.down('ShiftLeft'); await p.keyboard.down(KEY[mv]); await sleep(1300) }
    for (const v of VIEWS) {
      await p.evaluate((v, EYE) => {
        const o = window.__oth
        if (v === 'fpp') { o.spectate(); o.aim(o.hero.heading, 0) }
        else { if (o.fpp) o.thirdPerson(); if (v === 'play') o.spectate(); else o.spectate(...EYE[v]) }
      }, v, EYE)
      await sleep(v === 'fpp' ? 500 : 260)
      const f = `${out}/_${w}_${mv}_${v}.png`
      await p.screenshot({ path: f })
      files.push(f)
      if (v === 'fpp') { await p.evaluate(() => { window.__oth.thirdPerson() }); await sleep(250) }
    }
    if (KEY[mv]) { await p.keyboard.up(KEY[mv]); if (mv === 'walk') await p.keyboard.up('ControlLeft'); if (mv === 'sprint') await p.keyboard.up('ShiftLeft'); await sleep(700) }
  }
  // one sheet: a row a move, a column a view
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
files = sys.argv[3:]; cols = int(sys.argv[2]); W, H = ${W} // 2, ${H} // 2
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * H))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS)
    ImageDraw.Draw(im).text((6, 4), f.split('/')[-1][1:-4], fill=(255, 220, 120))
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(sys.argv[1])
`, `${out}/${w}.png`, String(VIEWS.length), ...files])
  if (!process.env.KEEP) for (const f of files) fs.unlinkSync(f)
  console.log('sheet', `${out}/${w}.png`)
}
await b.close()
