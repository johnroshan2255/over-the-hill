/**
 * FULL SCREEN (2026-11-05, the user: "a button in the top-right corner to make it full screen" — on the title screen
 * too, where the browser's bars ate the page): ONE round button, top right, made once at start (src/main.ts) so it
 * stays from the title into the game. The Fullscreen API on the page; the orientation is left to the phone (portrait
 * and landscape both lay out — index.html). iPhone Safari has no Fullscreen API for pages: there it explains "Share →
 * Add to Home Screen" (the page is web-app capable). Gone when already running as an installed app.
 *
 * body.oth-fs-none marks its absence (the game's menu button then takes the corner).
 */
const ENTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>'
const EXIT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>'

export function fullscreenButton(): void {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  if (standalone) { document.body.classList.add('oth-fs-none'); return }
  const can = !!(el.requestFullscreen || el.webkitRequestFullscreen)
  const b = document.createElement('button')
  b.className = 'oth-fs'
  b.title = 'Full screen'
  b.setAttribute('aria-label', 'Full screen')
  const isFull = () => !!(document.fullscreenElement || doc.webkitFullscreenElement)
  const paint = () => { b.innerHTML = isFull() ? EXIT : ENTER; b.classList.toggle('on', isFull()) }
  paint()
  document.addEventListener('fullscreenchange', paint)
  document.addEventListener('webkitfullscreenchange', paint)
  // (pointerdown would be eaten by the game's canvas handlers; a click is a user gesture the API accepts)
  b.addEventListener('pointerdown', (e) => e.stopPropagation())
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!can) {
      alert('On iPhone: tap Share → "Add to Home Screen", then open it from the home screen — it runs full screen.')
      return
    }
    try {
      if (isFull()) { if (document.exitFullscreen) await document.exitFullscreen(); else doc.webkitExitFullscreen?.(); return }
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else el.webkitRequestFullscreen?.()
    } catch { /* (the browser refused: nothing to do) */ }
  })
  document.body.appendChild(b)
}
