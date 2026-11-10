// devinfo.mjs — what the graphics device IS in this build (2026-11-10: the release vs the debug PlayCanvas A/B): the
// canvas, the samples, the back buffer's formats and attachments.   PORT=5200 node scripts/harness/devinfo.mjs [tier] [extra]
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
console.log(JSON.stringify(await p.evaluate(() => {
  const o = window.__oth, keys = Object.keys(o), r = o.renderer, d = r && (r.device || r.pc || r.gd || r.graphicsDevice)
  const out = { keys: keys.join(','), rkeys: r ? Object.keys(r).join(',') : null }
  if (d) { const bb = d.backBuffer; Object.assign(out, { type: d.deviceType, samples: d.samples, w: d.width, h: d.height, bbSamples: bb?.samples, bbFormat: d.backBufferFormat, antialias: d.backBufferAntialias, transientColor: bb?.transientColor, transientDepth: bb?.transientDepth, init: d.initOptions, mpr: d.maxPixelRatio, depthFmt: bb?.impl?.depthAttachment?.format, colorFmt: bb?.impl?.colorAttachments?.[0]?.format, depthTransient: bb?.impl?.depthAttachment?.transient, colorTransient: bb?.impl?.colorAttachments?.[0]?.transient }) }
  return out
}), null, 1))
await b.close()
