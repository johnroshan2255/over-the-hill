import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio'], defaultViewport: { width: 960, height: 540 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', (e.stack || '').split('\n').slice(0, 8).join('\n')))
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type().toUpperCase(), m.text().slice(0, 600)) })
await p.goto(`http://localhost:5200/?tier=${process.argv[2] || 'ultra'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0${process.argv[3] ? '&' + process.argv[3] : ''}`, { waitUntil: 'load' })
try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 60000, polling: 250 }); console.log('READY', await p.evaluate(() => window.__oth.backend)) } catch { console.log('NOT READY'); console.log(await p.evaluate(() => document.getElementById('status')?.textContent)) }
await new Promise((r) => setTimeout(r, 3000))
await p.screenshot({ path: process.argv[4] || '/tmp/x.png' })
await b.close()
