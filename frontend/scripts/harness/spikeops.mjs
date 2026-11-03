// spikeops.mjs — spike/ops.html for each operation on WebGL2 and WebGPU: which ops Chrome's WebGPU runs slower here
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message))
for (const op of (process.argv[2] || 'mad,pow,sin,exp,smooth,norm,fract,tex').split(',')) {
  const r = {}
  for (const api of ['webgl2', 'webgpu']) {
    await p.goto(`http://localhost:5200/spike/ops.html?api=${api}&op=${op}&n=${process.env.N || 48}&unroll=${process.env.UNROLL || 0}`, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__ms, { timeout: 60000 })
    r[api] = await p.evaluate(() => window.__ms)
  }
  console.log(`${op.padEnd(7)} webgl2 ${r.webgl2.toFixed(3)} ms   webgpu ${r.webgpu.toFixed(3)} ms   ×${(r.webgpu / r.webgl2).toFixed(2)}`)
}
await b.close()
