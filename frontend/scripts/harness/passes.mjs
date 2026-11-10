// passes.mjs [tier] [extra] — THE FRAME'S RENDER PASSES (2026-11-10: why the release PlayCanvas drew at half the pace of
// the debug one on the M4): GPUCommandEncoder.beginRenderPass hooked — one frame's passes listed: each attachment's
// size, samples, load / store ops, whether it resolves; and the draws in it.   PORT=5200 node scripts/harness/passes.mjs
import puppeteer from 'puppeteer-core'
const tier = process.argv[2] || 'ultra', extra = process.argv[3] ? `&${process.argv[3]}` : ''
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
await p.evaluateOnNewDocument(() => {
  window.__passes = []; window.__rec = false
  const tex = new WeakMap(), T = GPUTexture.prototype.createView
  GPUTexture.prototype.createView = function (...a) { const v = T.apply(this, a); tex.set(v, this); return v }
  const usage = (u) => [[1, 'copySrc'], [2, 'copyDst'], [4, 'sampled'], [8, 'storage'], [16, 'attach'], [32, 'TRANSIENT']].filter(([b]) => u & b).map(([, n]) => n).join('+')
  const d = (v) => { const t = v && tex.get(v); return t ? `${t.width}×${t.height} ×${t.sampleCount} ${t.format} [${usage(t.usage)}]` : v ? '(canvas?)' : '-' }
  // … the canvas's configuration, and per frame: submits, command buffers, copies, canvas textures taken, buffer writes
  window.__cfg = []; window.__n = { submit: 0, buffers: 0, copyTT: 0, copyTB: 0, copyBB: 0, getTex: 0, writeBuf: 0, writeBytes: 0, writeTex: 0, compute: 0, done: 0 }
  const C = GPUCanvasContext.prototype.configure; GPUCanvasContext.prototype.configure = function (c) { window.__cfg.push(JSON.stringify({ format: c.format, usage: c.usage, alphaMode: c.alphaMode, colorSpace: c.colorSpace, toneMapping: c.toneMapping, viewFormats: c.viewFormats })); return C.call(this, c) }
  const G = GPUCanvasContext.prototype.getCurrentTexture; GPUCanvasContext.prototype.getCurrentTexture = function () { window.__n.getTex++; return G.call(this) }
  const S = GPUQueue.prototype.submit; GPUQueue.prototype.submit = function (l) { window.__n.submit++; window.__n.buffers += l.length; return S.call(this, l) }
  const WB = GPUQueue.prototype.writeBuffer; GPUQueue.prototype.writeBuffer = function (...a) { window.__n.writeBuf++; window.__n.writeBytes += a[4] ?? (a[2].byteLength ?? 0); return WB.apply(this, a) }
  const WT = GPUQueue.prototype.writeTexture; GPUQueue.prototype.writeTexture = function (...a) { window.__n.writeTex++; return WT.apply(this, a) }
  const D = GPUQueue.prototype.onSubmittedWorkDone; GPUQueue.prototype.onSubmittedWorkDone = function () { window.__n.done++; return D.call(this) }
  for (const [k, n] of [['copyTextureToTexture', 'copyTT'], ['copyTextureToBuffer', 'copyTB'], ['copyBufferToBuffer', 'copyBB'], ['beginComputePass', 'compute']]) { const f = GPUCommandEncoder.prototype[k]; GPUCommandEncoder.prototype[k] = function (...a) { window.__n[n]++; return f.apply(this, a) } }
  const B = GPUCommandEncoder.prototype.beginRenderPass
  GPUCommandEncoder.prototype.beginRenderPass = function (desc) {
    const pass = B.call(this, desc)
    if (window.__rec) {
      const rec = { color: (desc.colorAttachments || []).map((c) => c && `${d(c.view)} ${c.loadOp}/${c.storeOp}${c.resolveTarget ? ' → resolve ' + d(c.resolveTarget) : ''}`), depth: desc.depthStencilAttachment ? `${d(desc.depthStencilAttachment.view)} ${desc.depthStencilAttachment.depthLoadOp}/${desc.depthStencilAttachment.depthStoreOp}` : '-', draws: 0 }
      window.__passes.push(rec)
      rec.extra = (desc.timestampWrites ? 'TIMESTAMPS ' : '') + (desc.occlusionQuerySet ? 'OCCLUSION ' : ''); rec.verts = 0; rec.vp = ''
      for (const k of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) { const f = pass[k]; pass[k] = function (...a) { rec.draws++; rec.verts += (a[0] || 0) * (a[1] ?? 1); (rec.seq ||= []).push((a[0] || 0) + 'x' + (a[1] ?? 1)); return f.apply(this, a) } }
      for (const k of ['setViewport', 'setScissorRect']) { const f = pass[k]; pass[k] = function (...a) { rec.vp += k[3] + a.slice(0, 4).join(',') + ' '; return f.apply(this, a) } }
    }
    return pass
  }
})
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&world=valley&sound=0&save=0${extra}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true)); await new Promise((r) => setTimeout(r, 3000))
const passes = await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => { window.__passes = []; window.__rec = true; requestAnimationFrame(() => requestAnimationFrame(() => { window.__rec = false; r(window.__passes) })) })))
console.log(`${passes.length} passes in 2 frames`)
// … and over 200 animation frames: how many passes, how long (a build that draws on every other frame shows here)
const n200 = await p.evaluate(() => new Promise((r) => { window.__passes = []; window.__rec = true; for (const k in window.__n) window.__n[k] = 0; let n = 0; const t0 = performance.now(); const f = () => { if (++n < 200) requestAnimationFrame(f); else { window.__rec = false; r([window.__passes.length, window.__passes.reduce((s, q) => s + q.draws, 0), performance.now() - t0]) } }; requestAnimationFrame(f) }))
console.log(`200 animation frames: ${n200[0]} passes, ${n200[1]} draws, ${n200[2].toFixed(0)} ms`)
console.log('per 200 frames:', JSON.stringify(await p.evaluate(() => window.__n)), '\ncanvas configured:', (await p.evaluate(() => [...new Set(window.__cfg)])).join(' '), 'x', await p.evaluate(() => window.__cfg.length))
for (const q of passes) console.log(`  draws ${String(q.draws).padStart(3)} verts ${q.verts} ${q.extra} ${q.vp.slice(0, 120)}  color ${q.color.join(' | ')}   depth ${q.depth}`)
if (process.env.SEQ) console.log('order: ' + passes[0].seq.join(' '))
await b.close()
