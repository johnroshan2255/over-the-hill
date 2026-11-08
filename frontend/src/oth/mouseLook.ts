/**
 * MOUSE LOOK on a desktop (2026-11-08, the user: "I need to click and drag the camera — I want it to work just while
 * moving the mouse, and when the pointer reaches the edge of the screen don't stop: the whole 360"). The first click on
 * the game (or the first key pressed in play) takes POINTER LOCK: the cursor hides and the mouse turns the camera
 * without end. Until then — and whenever the browser refuses the lock — plain movement over the game turns it too (the
 * screen's edge stops that). Esc gives the cursor back and pauses (main.ts); a menu, the map or the action wheel
 * releases the lock and the next click takes it again. Touch keeps its drag (ChaseCam / main.ts).
 *
 * The cameras subscribe: `onMouseLook((dx, dy) => …)` gets the movement in CSS pixels; each checks its own state.
 */
type Look = (dx: number, dy: number) => void
const subs: Look[] = []
let canvas: HTMLElement | null = null
/** A release we asked for (a menu opening) — not the player's Esc. */
let releasing = false

export function onMouseLook(f: Look): void { subs.push(f) }

/** Turn the cameras by (dx, dy) css px as the mouse would — BUILD mode's right-drag (Build.ts: the cursor is free there). */
export function lookBy(dx: number, dy: number): void { for (const f of subs) f(dx, dy) }

export function mouseLocked(): boolean { return !!canvas && document.pointerLockElement === canvas }

/** Something over the game wants the cursor: a menu, the map, the action wheel, BUILD mode (its brush follows it). */
export function lookBlocked(): boolean {
  return !!document.querySelector('.oh-front, .oth-map.on') || document.body.classList.contains('oth-wheel-open') || document.body.classList.contains('oth-build')
}

/** Ask for the lock (from a click or a key — the browser wants a user gesture; a refusal leaves the hover look). */
export function lockMouse(): void {
  if (!canvas || mouseLocked() || lookBlocked() || document.body.classList.contains('touch')) return
  const el = canvas as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void }
  try {
    // (raw movement, no OS acceleration, where the browser has it — else the plain lock)
    const p = el.requestPointerLock({ unadjustedMovement: true })
    if (p && typeof p.catch === 'function') p.catch(() => { try { (el.requestPointerLock() as Promise<void> | void)?.catch?.(() => {}) } catch { /* refused */ } })
  } catch { /* refused: the hover look stays */ }
}

/** Give the cursor back (a menu opening) without it counting as the player's Esc. */
export function releaseMouse(): void {
  if (!mouseLocked()) return
  releasing = true
  document.exitPointerLock()
}

/**
 * Set up on the game's canvas. `onEscape`: the lock lost to the player's Esc (the browser keeps that key for itself —
 * the page never sees it) — main.ts pauses.
 */
export function initMouseLook(el: HTMLElement, onEscape: () => void): void {
  canvas = el
  let lx = NaN, ly = NaN
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') lockMouse() })
  window.addEventListener('mousemove', (e) => {
    if (mouseLocked()) {
      lx = NaN
      // (a stray huge jump — some browsers' first event after the lock — dropped)
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return
      for (const f of subs) f(e.movementX, e.movementY)
      return
    }
    // not locked: movement over the game itself (not a button, the HUD, a menu) still turns the camera
    if (e.target !== el || lookBlocked() || document.body.classList.contains('touch')) { lx = NaN; return }
    if (!Number.isNaN(lx)) for (const f of subs) f(e.clientX - lx, e.clientY - ly)
    lx = e.clientX; ly = e.clientY
  })
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return
    lx = NaN
    const asked = releasing
    releasing = false
    if (!asked && !lookBlocked()) onEscape()
  })
  // (a key pressed in play takes the lock too — driving off with W never needs a click first)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyQ' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return
    lockMouse()
  })
}
