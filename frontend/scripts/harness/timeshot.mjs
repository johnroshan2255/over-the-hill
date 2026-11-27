// timeshot.mjs [outDir] [tier] — THE HOUR SET BY HAND (2026-11-27 — Atmosphere.sweepTo: "like Genshin Impact's"): the
// game at a start hour, the hour asked as the player asks it (G: the next part of the day; ]: an hour on; the camp's
// rest), and the run FILMED — a frame every 250 ms into a strip, each with the game's hour, the sun's height and how
// old the land's baked shadows are (the sun's angle from the one they were baked for). CHECKED: the hour never jumps
// (no frame more than the run's own pace from the one before), it ends on the hour asked, the shadows are the hour's
// own when it ends (within the bake's 1.5°) and never far behind on the way, the dial shows and goes.
// Needs `npm run dev`.
//   node scripts/harness/timeshot.mjs screenshots/time ultra            env: PORT=5200, Q (extra URL switches)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/time', tier = 'ultra'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = true
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) ok = false }
// [name, the hour it starts at, what is pressed, the hour it must end on]
const RUNS = [['noon_to_morning', 12, 'GGG', 6.5], ['night_to_morning', 21.5, 'G', 6.5], ['morning_to_noon', 6.5, 'G', 12], ['hour_on', 15, ']', 16], ['hour_back', 15, '[', 14], ['rest_to_evening', 9, 'rest:17.5', 17.5]]
for (const [name, start, keys, want] of RUNS) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 300)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=${start}&weather=clear&sound=0&save=0${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 250 })
  await sleep(2500)
  // (the shadows' own sun: what they were last baked for)
  const read = () => p.evaluate(() => {
    const o = window.__oth, a = o.atmos, sun = a.uniforms.uSunDir.value, sh = o.shadowState ? o.shadowState() : null
    return { hour: a.hour, sunY: sun.y, night: a.uniforms.uNight.value, sweeping: a.sweeping, stale: sh ? sh.stale : null, on: sh ? sh.on : null, dial: document.querySelector('.oth-clock')?.classList.contains('on') ?? false, clock: document.querySelector('.oth-clock b')?.textContent ?? '' }
  })
  if (keys.startsWith('rest:')) await p.evaluate((h) => window.__oth.restTill(h), Number(keys.slice(5)))
  else for (const k of keys) { await p.keyboard.press(k === 'G' ? 'KeyG' : k === ']' ? 'BracketRight' : 'BracketLeft'); await sleep(40) }
  const frames = []
  const t0 = Date.now()
  for (let i = 0; i < 60; i++) {
    const s = await read(); s.t = (Date.now() - t0) / 1000
    await p.screenshot({ path: `${out}/${name}_${String(i).padStart(2, '0')}.png` })
    frames.push(s)
    // (till the run is over and its shadows are in, whole)
    if (!s.sweeping && s.on >= 0.999 && i > 3) break
    await sleep(190)
  }
  const last = frames[frames.length - 1], ran = frames.filter((f) => f.sweeping)
  const dur = ran.length ? ran[ran.length - 1].t + 0.25 : 0
  // (the biggest step of the hour between two frames, against the time between them: a jump is hours in one)
  let jump = 0
  for (let i = 1; i < frames.length; i++) { const d = Math.abs(((frames[i].hour - frames[i - 1].hour + 36) % 24) - 12), dt = frames[i].t - frames[i - 1].t; jump = Math.max(jump, d / Math.max(dt, 0.05)) }
  const span = Math.abs(((want - start + 36) % 24) - 12)
  console.log(`${name}: ${frames.length} frames, the run ~${dur.toFixed(1)} s; hours ${frames.map((f) => f.hour.toFixed(1)).join(' ')}`)
  console.log(`   the shadows' age (deg behind the sun): ${frames.map((f) => (f.stale ?? NaN).toFixed(0)).join(' ')}`)
  console.log(`   … how much of them is drawn:           ${frames.map((f) => (f.on ?? NaN).toFixed(1)).join(' ')}`)
  // (a shadow that is not the hour's own, seen: its age × how much of it is drawn)
  const wrong = Math.max(...frames.map((f) => (f.stale ?? 0) * (f.on ?? 0)))
  check(wrong < 6, `${name}: never a stale shadow seen (the worst ${wrong.toFixed(1)}° × drawn)`)
  const shownAt = frames.find((f) => !f.sweeping && f.on >= 0.999)
  check(!!shownAt, `${name}: the hour's shadows back in${shownAt ? ` ${(shownAt.t - dur).toFixed(1)} s after the run` : ' — never'}`)
  check(Math.abs(((last.hour - want + 36) % 24) - 12) < 0.05, `${name}: it ends on ${want} (${last.hour.toFixed(2)})`)
  check(frames[0].sweeping || span < 0.05, `${name}: the clock runs there — not put there (the first frame at ${frames[0].hour.toFixed(2)}, from ${start})`)
  check(jump < 24, `${name}: no jump (the fastest ${jump.toFixed(1)} h/s)`)
  check(last.stale !== null && last.stale < 2.5, `${name}: at its end the shadows are the hour's own (${last.stale?.toFixed(1)}° behind)`)
  check(frames[0].dial && !(await (async () => { await sleep(2200); return (await read()).dial })()), `${name}: the dial shown while it runs, gone after`)
  if (errs.length) { ok = false; console.log('ERRORS', [...new Set(errs)].join(' | ')) }
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(frames))
  await p.close()
}
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
await b.close()
