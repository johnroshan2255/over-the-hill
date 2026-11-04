// wgslcheck.mjs [tier] [extra] — every shader that fails the WebGPU transpile (glslang, docs/MIGRATION.md): glslang's
// errors and the processed GLSL lines round each one. PlayCanvas reports only "GLSL compilation failed" (with the
// processed source attached to its console error); glslang writes its own log as warnings just before.
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
let errs = []
const reports = []
p.on('console', async (m) => {
  const t = m.text()
  if (m.type() === 'warn' || m.type() === 'warning') { if (/^ERROR: 0:\d+/.test(t)) errs.push(t.trim()) ; return }
  if (m.type() === 'error' && /Failed to transpile/.test(t)) {
    const mine = errs; errs = []
    let processed = ''
    try { processed = (await m.args()[1]?.evaluate((o) => o.processed)) ?? "" } catch { /* (detached) */ }
    const label = /\[Shader Id \d+ \(GLSL\) ([^\]]+)\]/.exec(t)?.[1] ?? '?', stage = /webgl (\w+) shader/.exec(t)?.[1] ?? '?'
    const lines = processed.split('\n')
    const ctx = mine.filter((e) => !/compilation (terminated|errors)/.test(e)).map((e) => {
      const n = Number(/0:(\d+)/.exec(e)?.[1] ?? 0)
      return `${e}\n${lines.slice(Math.max(0, n - 3), n + 1).map((l, i) => `   ${n - 2 + i}| ${l}`).join('\n')}`
    })
    reports.push(`== ${label} (${stage})\n${ctx.join('\n')}`)
  }
})
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.argv[2] || 'ultra'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&api=webgpu-only${process.argv[3] ? '&' + process.argv[3] : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 250 }).catch(() => console.log('NOT READY'))
await new Promise((r) => setTimeout(r, 3000))
const seen = new Set()
for (const r of reports) { const k = r.split('\n').slice(1).join('\n'); if (seen.has(k)) continue; seen.add(k); console.log(r) }
console.log(`${reports.length} failed transpiles (${seen.size} distinct)`)
await b.close()
