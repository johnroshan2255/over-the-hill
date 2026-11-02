/**
 * THE JOURNAL — what the player has found and earned, kept in this browser (localStorage) like the journey (save.ts):
 * COINS (supply crates, places discovered), the crates picked up, the paints bought. Where the landmarks / camps were
 * found stays where Landmarks.ts keeps it (`oth.found.<map>`). The backend's save API takes the same shape later.
 */
export interface Journal {
  v: 1
  coins: number
  /** Crate ids picked up (Places.ts — stable for a map: its placement is seeded). */
  crates: number[]
  /** Paints bought (#rrggbb). */
  paints: string[]
  /** How many there are to find in the valley (the game writes them; the title screen's journal shows x / n). */
  totals?: { crates: number; places: number }
}

/** What finding things pays. */
export const REWARD = { crate: 25, place: 60, camp: 30 } as const

const KEY = 'overhill.journal.v1'

export function loadJournal(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Journal | null
    if (j && j.v === 1) return { v: 1, coins: j.coins | 0, crates: j.crates ?? [], paints: j.paints ?? [], totals: j.totals }
  } catch {
    /* (fresh) */
  }
  return { v: 1, coins: 0, crates: [], paints: [] }
}

export function saveJournal(j: Journal): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(j))
  } catch {
    /* (not kept) */
  }
}

/** Paints you start with: the valley's own (null), the model's own ('#ffffff') and a few classics. */
const FREE = new Set<string | null>([null, '#ffffff', '#e83a2a', '#e8a23a', '#3aa64a', '#1b1d22', '#c8b28a'])

/** A paint's price in coins (0 = free); the rest cost more the further down the garage's list they are. */
export function paintPrice(hex: string | null, index: number): number {
  return FREE.has(hex) ? 0 : 100 + 25 * index
}

export function paintOwned(j: Journal, hex: string | null, index: number): boolean {
  return paintPrice(hex, index) === 0 || (hex !== null && j.paints.includes(hex))
}
