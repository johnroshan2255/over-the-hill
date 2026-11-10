import { continueRequested, requestContinue } from './save'
import { coopRequested, requestCoop } from './net/api'
import { loadSettings } from './settings'
import { Menu } from './ui/Menu'
import { fullscreenButton } from './ui/fullscreen'

/**
 * OVERHILL — the entry: the TITLE screen first (ui/Menu.ts), the game (oth/main.ts) loaded only when the player
 * starts — its code, three and Rapier are separate chunks the title screen fetches while it waits.
 *
 * While the title screen is up, in idle time: three and the physics (Rapier's WASM compiled ahead — the slowest part
 * of a cold start), the chosen car's model (loaded and baked into the same cache the game reads), and the valley's
 * data files (into the HTTP cache). By the time the player presses PLAY most of the loading is done.
 *
 * Straight into the game (no title): a dev / shot-harness URL (?tier= ?drive= ?x= …), or APPLY & RESTART / CONTINUE
 * after a reload (save.ts `requestContinue`).
 */
const url = new URLSearchParams(location.search)
const status = document.getElementById('status')!
const direct = ['tier', 'play', 'drive', 'x', 'z', 'hour', 'at', 'coop'].some((k) => url.has(k)) || continueRequested() || !!coopRequested() // (?at=cave: straight in, before the cave; ?coop=: into a co-op world)

const MAP = '/oth/valley'
const MAP_FILES = ['meta.json', 'height.bin', 'far.bin', 'mask.bin', 'trail.bin', 'mud.bin']

function preload(): void {
  const idle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 800))
  idle(() => {
    void import('three')
    void import('./physics/PhysicsWorld').then((m) => m.PhysicsWorld.load())
    // (the car, at the size this device will draw it: the tier as the game will pick it — phones their own file)
    void Promise.all([import('./assets/loadModels'), import('./oth/quality')]).then(([m, q]) => { m.carDetailFor(q.pickTier()); return m.loadVehicle(loadSettings().car) }).catch(() => {})
    for (const f of MAP_FILES) void fetch(`${MAP}/${f}`, { priority: 'low' } as RequestInit).catch(() => {})
  })
}

async function start(resume: boolean, menu: Menu | null): Promise<void> {
  requestContinue(resume)
  if (menu) {
    // the game's own status line (oth/main.ts) feeds the title screen's bar
    menu.loading('Loading the valley', 0.04)
    const feed = () => {
      const t = status.textContent ?? ''
      const m = /(\d+)%/.exec(t)
      menu.loading(t.replace(/[\s…]*\d+%$/, '').replace(/…$/, '') || 'Loading', m ? Number(m[1]) / 100 : 0.08)
    }
    const watch = new MutationObserver(feed)
    watch.observe(status, { childList: true, characterData: true, subtree: true })
    window.addEventListener('overhill:started', () => { watch.disconnect(); menu.close() }, { once: true })
  }
  await import('./oth/main')
}

fullscreenButton() // (top right, from the title into the game)

if (direct) {
  void start(continueRequested(), null)
} else {
  status.style.visibility = 'hidden' // (the title screen shows the loading)
  const menu: Menu = new Menu('title', { onPlay: (resume) => { requestCoop(null); void start(resume, menu) }, onCoop: (world) => { requestCoop(world); void start(false, menu) } })
  preload()
}
