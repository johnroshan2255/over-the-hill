// pipes.mjs <out.json> [tier] [extra] — EVERY RENDER PIPELINE and shader a build makes (2026-11-10: release vs debug
// PlayCanvas, the same passes at twice the GPU time): createShaderModule / createRenderPipeline(Async) hooked, each
// pipeline's state and its shaders' code written out — diff two builds' files.   PORT=5200 node scripts/harness/pipes.mjs a.json
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2], tier = process.argv[3] || 'ultra', extra = process.argv[4] ? `&${process.argv[4]}` : ''
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.evaluateOnNewDocument(() => {
  window.__pipes = []; window.__dev = []
  const code = new WeakMap(), M = GPUDevice.prototype.createShaderModule
  GPUDevice.prototype.createShaderModule = function (d) { const m = M.call(this, d); code.set(m, d.code); return m }
  const rec = (d) => window.__pipes.push({ label: d.label, primitive: d.primitive, depthStencil: d.depthStencil, multisample: d.multisample, targets: d.fragment?.targets, vs: code.get(d.vertex.module), fs: d.fragment && code.get(d.fragment.module), buffers: d.vertex.buffers?.map((x) => ({ stride: x.arrayStride, step: x.stepMode, n: x.attributes.length })) })
  for (const k of ['createRenderPipeline', 'createRenderPipelineAsync']) { const f = GPUDevice.prototype[k]; GPUDevice.prototype[k] = function (d) { rec(d); return f.call(this, d) } }
  const R = GPUAdapter.prototype.requestDevice; GPUAdapter.prototype.requestDevice = function (d) { window.__dev.push({ features: [...(d?.requiredFeatures || [])], limits: d?.requiredLimits }); return R.call(this, d) }
  const A = GPU.prototype.requestAdapter; GPU.prototype.requestAdapter = function (o) { window.__dev.push({ adapter: o }); return A.call(this, o) }
})
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true)); await new Promise((r) => setTimeout(r, 4000))
const r = await p.evaluate(() => ({ dev: window.__dev, pipes: window.__pipes }))
fs.writeFileSync(out, JSON.stringify(r, null, 1)); console.log(out, r.pipes.length, 'pipelines', JSON.stringify(r.dev).slice(0, 600))
await b.close()
