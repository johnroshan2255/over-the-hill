/**
 * SETTINGS — what the player picks in the menus (GARAGE, SETTINGS), kept in this browser (localStorage) and handed to
 * the game as its URL switches (`gameParams`). The page's own URL still wins over them, so dev links and the shot
 * harness (scripts/shot.mjs) keep working.
 */
/** A garage car's id (gameplay/vehicle/catalogue VEHICLES). */
export type CarId = string
/** What you ride (the GARAGE): the car, or the motorbike (it carries it — the car is parked by you). The bicycle is out
 *  of the game (2026-11-05, the user). */
export type RideId = 'car' | 'moto'
export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'ultra'

export interface Settings {
  car: CarId
  ride: RideId
  /** THE PAINT, car by car ('#rrggbb'). A car not in it wears its FACTORY colour — the real machine's own (the
   *  catalogue's `stock.paint`). (2026-11-16, the user: "now all look the same colour … the default must be the car's
   *  original in real life; I can change it later" — it was ONE `paint` for the whole garage: a paint picked once
   *  coloured every car.) */
  paints: Record<CarId, string>
  gearbox: 'auto' | 'manual'
  aids: 'off' | 'standard' | 'full'
  offroadAssist: boolean
  quality: Quality
  antialias: 'auto' | 'off'
  /** The rendering resolution: 'auto' = full (phones lower it when slow), or a fixed % of full. */
  resolution: 'auto' | '100' | '75' | '50'
  /** FSR 1 upscaling (oth/Fsr.ts): the world drawn at 77 / 67 / 50 % each way, upscaled and sharpened — 'off': none. */
  upscale: 'off' | 'quality' | 'balanced' | 'performance'
  fpsOverlay: boolean
  sound: boolean
  /** THE HELPER BOT (oth/Bot.ts): in a co-op world in the valley, a second player run from this tab who gathers,
   *  builds and moves on. */
  bot: boolean
  /** THE COMPANION (oth/Companion.ts), solo play: an NPC who walks and rides with you ('friend'), or comes after you —
   *  punches and kicks on foot, rams your car with his ('enemy'). */
  companion: 'off' | 'friend' | 'enemy'
  /** CAR DAMAGE (oth/Damage.ts — docs/DAMAGE.md): crashes crumple the shell, bend the axles, wear the engine out; off:
   *  the cars take nothing, as before. */
  damage: boolean
}

export const DEFAULTS: Settings = {
  car: 'offroader',
  ride: 'car',
  paints: {},
  gearbox: 'auto',
  aids: 'full',
  offroadAssist: true,
  quality: 'auto',
  antialias: 'auto',
  resolution: 'auto',
  upscale: 'off',
  fpsOverlay: false,
  sound: true,
  bot: false,
  companion: 'off',
  damage: true,
}

const KEY = 'overhill.settings.v1'

export function loadSettings(): Settings {
  try {
    // (every game starts IN THE CAR — 2026-11-05, the user: "the default is the car, not the cycle": the garage's
    //  two-wheeler is for this session, never carried to the next load; ?ride= still starts on one — the harnesses)
    const s: Settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>), ride: 'car' }
    // (a car no longer in the garage — the G500 `gwagen`, the E30 `bmw`, shelved 2026-11-10: the main car, the off-roader)
    if (s.car === 'gwagen' || s.car === 'bmw' || s.car === 'g500' || s.car === 'e30') s.car = DEFAULTS.car
    // (the one paint for every car — before 2026-11-16 — is dropped: each car back in its factory colour)
    delete (s as unknown as { paint?: unknown }).paint
    if (!s.paints || typeof s.paints !== 'object') s.paints = {}
    if (s.companion !== 'friend' && s.companion !== 'enemy') s.companion = 'off'
    return s
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
  if (s.paints[s.car]) p.set('paint', s.paints[s.car].replace('#', ''))
  if (s.quality !== 'auto') p.set('tier', s.quality)
  if (s.antialias === 'off') p.set('aa', '0')
  if (s.resolution !== 'auto') { p.set('dpr', 'fixed'); p.set('scale', s.resolution) }
  if (s.upscale !== 'off') p.set('fsr', { quality: '0.77', balanced: '0.67', performance: '0.5' }[s.upscale])
  if (s.fpsOverlay) p.set('stats', '1')
  p.set('gearbox', s.gearbox)
  p.set('aids', s.aids)
  p.set('offroad', s.offroadAssist ? '1' : '0')
  if (!s.sound) p.set('sound', '0')
  if (s.bot) p.set('bot', '1')
  if (s.companion !== 'off') p.set('companion', s.companion)
  if (s.damage === false) p.set('damage', '0')
  for (const [k, v] of new URLSearchParams(location.search)) p.set(k, v)
  return p
}
