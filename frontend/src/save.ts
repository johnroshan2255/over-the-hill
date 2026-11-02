/**
 * PROGRESS — where the player's journey stands, kept in this browser (localStorage) for now; the backend's save API
 * (backend/, `PUT /v1/saves/:player`) takes the same shape when the game moves to it. Saved every 20 s while playing
 * and when the page is hidden or closed (main.ts); the title screen's CONTINUE starts from it.
 */
export interface Progress {
  v: 1
  map: string
  car: string
  /** The car's last safe spot (on the ground, out of the water) and heading (rad). */
  x: number
  z: number
  heading: number
  /** The time of day (h). */
  hour: number
  /** Metres driven, seconds played — over every session. */
  travelled: number
  playSeconds: number
  /** When it was saved (ms since 1970). */
  savedAt: number
  /** The player's own camp, if pitched (Props.pitch). */
  camp?: { x: number; y: number; z: number; rot: number } | null
}

const KEY = 'overhill.progress.v1'

export function loadProgress(): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Progress | null
    return p && p.v === 1 && Number.isFinite(p.x) && Number.isFinite(p.z) ? p : null
  } catch {
    return null
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* (not kept) */
  }
}

/** Ask the next game start to resume from the saved progress (the title screen's CONTINUE). */
export function requestContinue(on: boolean): void {
  try {
    if (on) sessionStorage.setItem('overhill.continue', '1')
    else sessionStorage.removeItem('overhill.continue')
  } catch {
    /* (not kept) */
  }
}

export function continueRequested(): boolean {
  try {
    return sessionStorage.getItem('overhill.continue') === '1'
  } catch {
    return false
  }
}
