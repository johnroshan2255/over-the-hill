/**
 * THE JOURNAL — what the player has found and earned, kept in this browser (localStorage) like the journey (save.ts):
 * COINS (places discovered, camps, the Wardens' secrets). (The SUPPLY CRATES — ~70 to drive into, 25 ◆ each — were
 * taken out of the game 2026-11-27 at the user's word; an old save's `crates` is dropped, its coins kept.) (The paints are FREE since 2026-11-16 — the user:
 * "the car's colour change is based on collecting money — remove that, it must be free"; `paints`, what was bought,
 * stays in the save's shape and is no longer read.) Where the landmarks / camps were
 * found stays where Landmarks.ts keeps it (`oth.found.<map>`). The backend's save API takes the same shape later.
 */
export interface Journal {
  v: 1
  coins: number
  /** (paints bought, #rrggbb — before they were free: kept in the shape, not read) */
  paints: string[]
  /** How many there are to find in each world (the game writes them; the title screen's journal shows x / n). */
  totals?: Record<string, { places: number }>
}

/** What finding things pays. */
export const REWARD = { place: 60, camp: 30 } as const

const KEY = 'overhill.journal.v1'

export function loadJournal(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Journal | null
    // (totals were the valley's alone before the desert: { places } — then with `crates` beside it)
    const t = j?.totals as Journal['totals'] | { places: number } | undefined
    const totals = t && typeof (t as { places?: unknown }).places === 'number' ? { valley: { places: (t as { places: number }).places } } : (t as Journal['totals'])
    if (j && j.v === 1) return { v: 1, coins: j.coins | 0, paints: j.paints ?? [], totals }
  } catch {
    /* (fresh) */
  }
  return { v: 1, coins: 0, paints: [] }
}

export function saveJournal(j: Journal): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(j))
  } catch {
    /* (not kept) */
  }
}

