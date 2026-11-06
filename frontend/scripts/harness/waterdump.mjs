// waterdump.mjs <out.bin> — THE RUNTIME'S WATER near the tracks, for scripts/oth/trackgrade.py (which leaves fords,
// streams and bridges as they are): the box's 2 m grid (2049², R8), within 30 m of a track: 1 where MapData.waterAt
// has water over the ground, 2 on a bridge's deck, else 0. Run it on the UN-graded map (once: the grading keeps it).
//   node scripts/harness/waterdump.mjs scripts/oth/.cache/valley-pregrade/water.bin     (needs `npm run dev`, PORT=5200)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2]
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000, args: [`--use-angle=${ANGLE}`, '--mute-audio'], defaultViewport: { width: 480, height: 270 } })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=low&time=0&hour=12&weather=clear&world=valley&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
const b64 = await p.evaluate(() => {
  const m = window.__oth.world.map, N = 2049, A = new Uint8Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -2048 + i * 2, z = -2048 + j * 2
    if (m.trackDist(x, z) > 30) continue
    if (m.bridgeAt(x, z) !== null) A[j * N + i] = 2
    else { const w = m.waterAt(x, z); if (w !== null && w > m.height(x, z) - 0.05) A[j * N + i] = 1 }
  }
  let s = ''
  for (let k = 0; k < A.length; k += 32768) s += String.fromCharCode.apply(null, A.subarray(k, k + 32768))
  return btoa(s)
})
fs.writeFileSync(out, Buffer.from(b64, 'base64'))
console.log('wrote', out)
await b.close()
