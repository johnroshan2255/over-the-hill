/**
 * SETTINGS — what the player picks in the menus (GARAGE, SETTINGS), kept in this browser (localStorage) and handed to
 * the game as its URL switches (`gameParams`). The page's own URL still wins over them, so dev links and the shot
 * harness (scripts/shot.mjs) keep working.
 */
export type CarId = 'gwagen' | 'bmw'
/** What you ride (the GARAGE): the car, or the motorbike (it carries it — the car is parked by you). The bicycle is out
 *  of the game (2026-11-05, the user). */
export type RideId = 'car' | 'moto'
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra'

export interface Settings {
  car: CarId
  ride: RideId
  /** '#rrggbb', or null: the car's own colour on this map. */
  paint: string | null
  gearbox: 'auto' | 'manual'
  aids: 'off' | 'standard' | 'full'
  offroadAssist: boolean
  quality: Quality
  antialias: 'auto' | 'off'
  /** The rendering resolution: 'auto' = full (phones lower it when slow), or a fixed % of full. */
  resolution: 'auto' | '100' | '75' | '50'
  fpsOverlay: boolean
  sound: boolean
}

export const DEFAULTS: Settings = {
  car: 'gwagen',
  ride: 'car',
  paint: null,
  gearbox: 'auto',
  aids: 'full',
  offroadAssist: true,
  quality: 'auto',
  antialias: 'auto',
  resolution: 'auto',
  fpsOverlay: false,
  sound: true,
}

const KEY = 'overhill.settings.v1'

export function loadSettings(): Settings {
  try {
    // (every game starts IN THE CAR — 2026-11-05, the user: "the default is the car, not the cycle": the garage's
    //  two-wheeler is for this session, never carried to the next load; ?ride= still starts on one — the harnesses)
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>), ride: 'car' }
  } catch {
    return { ...DEFAULTS } // (private window / blocked storage: the defaults)
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* (not kept) */
  }
}

/** The game's switches: the settings as URL parameters, under whatever the page's URL itself says. */
export function gameParams(): URLSearchParams {
  const s = loadSettings(), p = new URLSearchParams()
  p.set('car', s.car)
  if (s.ride !== 'car') p.set('ride', s.ride)
  if (s.paint) p.set('paint', s.paint.replace('#', ''))
  if (s.quality !== 'auto') p.set('tier', s.quality)
  if (s.antialias === 'off') p.set('aa', '0')
  if (s.resolution !== 'auto') { p.set('dpr', 'fixed'); p.set('scale', s.resolution) }
  if (s.fpsOverlay) p.set('stats', '1')
  p.set('gearbox', s.gearbox)
  p.set('aids', s.aids)
  p.set('offroad', s.offroadAssist ? '1' : '0')
  if (!s.sound) p.set('sound', '0')
  for (const [k, v] of new URLSearchParams(location.search)) p.set(k, v)
  return p
}
