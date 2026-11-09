import keyArt from '../assets/ui/key-art.jpg'
import keyArtSmall from '../assets/ui/key-art-sm.jpg'
import { PAINTS, VEHICLES, type VehicleDef } from '../gameplay/vehicle/catalogue'
import { loadJournal, paintOwned, paintPrice, saveJournal, type Journal } from '../journal'
import { loadProgress, type Progress } from '../save'
import { DEFAULTS, loadSettings, saveSettings, type CarId, type RideId, type Settings } from '../settings'
import { type Account, ApiError, createWorld, joinWorld, listWorlds, loadAccount, signIn, type WorldRow } from '../net/api'
import './menu.css'

/**
 * THE FRONT END (GTA-style, square-edged): the TITLE screen (continue / new start / garage / settings) over the key
 * art, and the same screens as the PAUSE menu over the game. Plain DOM, built once per opening and dropped when it
 * closes; nothing of it runs while playing. Keyboard (↑ ↓ choose, ← → change, Enter, Esc back, Q / E tabs), mouse and
 * touch.
 *
 * Settings are saved as they change (settings.ts); the game reads them when it starts — in the pause menu a change is
 * taken AT ONCE (onSettings → main.ts applySettings, 2026-11-08: the user changed them in play and nothing happened);
 * the few that need the world rebuilt (Quality, Anti-aliasing) restart it right here when you resume.
 */
export interface MenuHandlers {
  /** Title: start the game (resume = from the saved progress). */
  onPlay?: (resume: boolean) => void
  /** Pause: back to the game. */
  onResume?: () => void
  /** Pause: save and restart with the new settings, at the same spot. */
  onRestart?: () => void
  /** Pause: save and go back to the title screen. */
  onQuit?: () => void
  /** Pause: the GARAGE's pick taken at once (the car, or a two-wheeler) — the game swaps you onto it. */
  onVehicle?: (ride: RideId, car: CarId) => void
  /** Pause: a setting changed — the game takes what it can at once (main.ts applySettings); key: which one. */
  onSettings?: (s: Settings, key: keyof Settings) => void
  /** Title: into co-op world `world` (the CO-OP screen). */
  onCoop?: (world: string) => void
  /** Camp: its name and what you can do there. */
  heading?: string
  items?: MenuItem[]
}

export interface MenuItem { label: string; note?: string; disabled?: boolean; go: () => void }

type Screen = 'main' | 'garage' | 'settings' | 'journal' | 'coop'
interface Opt<T> { v: T; label: string }
interface Choice<K extends keyof Settings = keyof Settings> { key: K; label: string; help: string; options: Opt<Settings[K]>[] }

/** The paint swatches: this map's own colour per car (null), then the catalogue's paints ('Stock' = the model's own). */
const SWATCHES: { name: string; hex: string | null }[] = [{ name: 'Valley colour', hex: null }, ...PAINTS]

const DRIVING: Choice[] = [
  { key: 'gearbox', label: 'Gearbox', help: 'Automatic shifts for you. Manual: the ▲ ▼ gear box by the speed (tap or click), or X up / Z down on a keyboard.', options: [{ v: 'auto', label: 'Automatic' }, { v: 'manual', label: 'Manual' }] },
  { key: 'aids', label: 'Driving aids', help: 'Full: cornering and traction help, smooth like GTA. Standard: ABS and traction only. Off: the raw machine.', options: [{ v: 'full', label: 'Full' }, { v: 'standard', label: 'Standard' }, { v: 'off', label: 'Off' }] },
  { key: 'offroadAssist', label: 'Off-road assist', help: 'On: more torque on steep ground, climbs up to 70°. Off: only what the real car can do.', options: [{ v: true, label: 'On' }, { v: false, label: 'Off' }] },
] as Choice[]

const GRAPHICS: Choice[] = [
  { key: 'quality', label: 'Quality', help: 'How much the world draws: grass, trees, draw distance. Auto picks the best for this device.', options: [{ v: 'auto', label: 'Auto' }, { v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }] },
  { key: 'antialias', label: 'Anti-aliasing', help: 'Smooth edges (MSAA). Off is faster on weak GPUs, with sharper stair-steps.', options: [{ v: 'auto', label: 'Auto' }, { v: 'off', label: 'Off' }] },
  { key: 'resolution', label: 'Resolution', help: 'Auto: full resolution (a phone lowers it only when it slows down). A fixed scale renders fewer pixels: faster, softer.', options: [{ v: 'auto', label: 'Auto' }, { v: '100', label: '100%' }, { v: '75', label: '75%' }, { v: '50', label: '50%' }] },
  { key: 'upscale', label: 'Upscaling (FSR)', help: 'AMD FSR 1: the world drawn at fewer pixels, then upscaled and sharpened. Helps when the GPU is the limit (phones, Chromebooks, 4K screens). Quality 77%, Balanced 67%, Performance 50%.', options: [{ v: 'off', label: 'Off' }, { v: 'quality', label: 'Quality' }, { v: 'balanced', label: 'Balanced' }, { v: 'performance', label: 'Perf' }] },
  { key: 'fpsOverlay', label: 'FPS overlay', help: 'Frame rate, frame time and draw counts in the corner (also F3 in game).', options: [{ v: false, label: 'Off' }, { v: true, label: 'On' }] },
] as Choice[]

const AUDIO: Choice[] = [
  { key: 'sound', label: 'Sound', help: 'The engine, the tyres, the valley and the music (also M in game).', options: [{ v: true, label: 'On' }, { v: false, label: 'Off' }] },
] as Choice[]

const COOP: Choice[] = [
  { key: 'bot', label: 'Helper bot', help: 'In a co-op world in the valley, a bot named after you joins as another player: he walks the valley, chops trees and mines stone, claims land, builds a cottage, a cabin, a garden or a camp, then takes it down and moves on. You see him on the map and in the chat. Off: he takes his things down and leaves.', options: [{ v: false, label: 'Off' }, { v: true, label: 'On' }] },
] as Choice[]

const KEYS: [string, string][] = [
  ['W A S D', 'Drive and steer · on foot: move'], ['F', 'Get out / get in'], ['Space', 'Handbrake · on foot: jump'], ['Shift', 'Boost · on foot: sprint'], ['X / Z', 'Gear up / down (manual)'], ['E', 'Winch'], ['R', 'Reset the car'],
  ['C', 'Camp: pitch / rest'], ['B', 'Build (co-op): mark your land'], ['1 / 2', 'G500 4×4² / BMW E30'], ['L', 'Lights'], ['N', 'Minimap'], ['Tab', 'Map'], ['V', 'Free camera'], ['+ −', 'Zoom'], ['G', 'Time of day'], ['Shift + G', 'Weather'], ['M', 'Sound'], ['F3', 'Stats'], ['Q', 'Action wheel'], ['Esc', 'Pause'],
]

/** THE GARAGE's vehicles (2026-11-05, the user: "car to bike must be chosen where we choose the jeep and the BMW"):
 *  the cars, and the two-wheelers they carry. */
interface Ride { ride: RideId; car?: VehicleDef; name: string; line: string; blurb: string }
const RIDES: Ride[] = [
  ...VEHICLES.map((v): Ride => ({ ride: 'car', car: v, name: v.name, line: carLine(v), blurb: v.blurb })),
  { ride: 'moto', name: 'Motorbike', line: '450 cm³ · ~80 hp · 5 gears', blurb: 'A motocross bike: 310 mm of travel, ~180 km/h, climbs faces to 70°. Wheelies (↓ + throttle), stoppies, jumps and flips. Your car waits where you take it out.' },
]

const TABS: Record<Exclude<Screen, 'main'>, string[]> = { garage: ['Vehicle', 'Paint', 'Driving'], settings: ['Graphics', 'Audio', 'Co-op', 'Controls'], journal: ['Journal'], coop: ['Worlds'] }

export class Menu {
  readonly root = document.createElement('div')
  private s: Settings = loadSettings()
  private j: Journal = loadJournal()
  /** A line for the side panel after a try (e.g. "Need 40 more coins"). */
  private note = ''
  private readonly progress: Progress | null = loadProgress()
  private screen: Screen = 'main'
  private tab = 0
  private sel = 0
  private readonly onKey = (e: KeyboardEvent) => this.key(e)

  constructor(private readonly mode: 'title' | 'pause' | 'camp', private readonly h: MenuHandlers) {
    this.root.className = 'oh-front' + (mode !== 'title' ? ' oh-pause' : '')
    if (mode === 'title') {
      const art = document.createElement('div')
      art.className = 'oh-art'
      art.style.backgroundImage = `url(${matchMedia('(max-width: 900px)').matches ? keyArtSmall : keyArt})`
      const shade = document.createElement('div')
      shade.className = 'oh-shade'
      this.root.append(art, shade)
    }
    this.root.append(this.view)
    document.body.append(this.root)
    window.addEventListener('keydown', this.onKey, true)
    this.render()
  }

  close(): void {
    window.removeEventListener('keydown', this.onKey, true)
    document.body.classList.remove('oh-panel-open')
    this.root.remove()
  }

  /** The title screen while the game loads: the list gives way to a bar (main.ts feeds it). */
  loading(text: string, f: number): void {
    this.view.replaceChildren(this.brand(), el('div', 'oh-loading', [text, (() => { const i = document.createElement('i'); i.style.setProperty('--p', `${Math.round(f * 100)}%`); return i })()]))
  }

  // ---------------------------------------------------------------------------------------------------- the screens
  private readonly view = document.createElement('div')

  private render(): void {
    // (a panel fills the top right: the full-screen button steps aside — index.html)
    document.body.classList.toggle('oh-panel-open', this.screen !== 'main')
    if (this.screen === 'main') this.view.replaceChildren(...(this.mode === 'title' ? [this.brand()] : this.mode === 'camp' ? [this.brand(this.h.heading ?? 'Camp', 'Camp')] : []), this.mainList(), this.hints(['Enter', 'Select'], ...(this.mode !== 'title' ? [['Esc', this.mode === 'camp' ? 'Leave' : 'Resume'] as [string, string]] : [])))
    else if (this.screen === 'coop') this.view.replaceChildren(this.panel(), this.hints(['↑ ↓', 'Choose'], ['Enter', 'Select'], ['Esc', 'Back']))
    else this.view.replaceChildren(this.panel(), this.hints(['↑ ↓', 'Choose'], ['← →', 'Change'], ['Q E', 'Tabs'], ['Esc', 'Back']))
  }

  private brand(title = 'Overhill', sub = 'The Valley'): HTMLElement {
    return el('header', 'oh-brand' + (this.mode === 'camp' ? ' oh-brand-camp' : ''), [el('h1', '', [title]), el('p', '', [sub])])
  }

  private mainItems(): MenuItem[] {
    if (this.mode === 'camp') return this.h.items ?? []
    if (this.mode === 'pause') {
      return [
        { label: 'Resume', go: () => this.h.onResume?.() },
        { label: 'Garage', go: () => this.open('garage') },
        { label: 'Settings', go: () => this.open('settings') },
        { label: 'Journal', note: `${this.j.coins} ◆`, go: () => this.open('journal') },
        { label: 'Apply & restart', note: 'here', go: () => this.h.onRestart?.() },
        { label: 'Quit to title', go: () => this.h.onQuit?.() },
      ]
    }
    const p = this.progress
    return [
      ...(p ? [{ label: 'Continue', note: `${(p.travelled / 1000).toFixed(1)} km · ${ago(p.savedAt)}`, go: () => this.h.onPlay?.(true) }] : []),
      { label: p ? 'New start' : 'Play', note: 'The Valley', go: () => this.h.onPlay?.(false) },
      { label: 'Garage', go: () => this.open('garage') },
      { label: 'Settings', go: () => this.open('settings') },
      { label: 'Journal', note: `${this.j.coins} ◆`, go: () => this.open('journal') },
      { label: 'Co-op', note: 'with friends', go: () => this.openCoop() },
    ]
  }

  private mainList(): HTMLElement {
    const items = this.mainItems()
    this.sel = Math.min(this.sel, items.length - 1)
    return el('nav', 'oh-main', items.map((it, i) => {
      const b = el('button', 'oh-item' + (i === this.sel ? ' sel' : ''), [it.label, ...(it.note ? [el('small', '', [it.note])] : [])])
      if (it.disabled) b.setAttribute('disabled', '')
      b.addEventListener('pointerenter', () => { if (!it.disabled && this.sel !== i) { this.sel = i; this.render() } })
      b.addEventListener('click', () => { if (!it.disabled) it.go() })
      return b
    }))
  }

  private open(s: Screen): void {
    this.screen = s
    this.tab = 0
    this.sel = 0
    this.render()
  }

  private panel(): HTMLElement {
    const scr = this.screen as Exclude<Screen, 'main'>
    const tabs = TABS[scr]
    const head = el('div', 'oh-head', [
      el('h2', '', [scr === 'garage' ? 'Garage' : scr === 'journal' ? 'Journal' : scr === 'coop' ? 'Co-op' : 'Settings']),
      el('div', 'oh-tabs', tabs.map((t, i) => {
        const b = el('button', 'oh-tab' + (i === this.tab ? ' sel' : ''), [t])
        b.addEventListener('click', () => { this.tab = i; this.sel = 0; this.render() })
        return b
      })),
      el('div', 'oh-coins', [`${this.j.coins} ◆`]),
    ])
    const [list, side] = this.body()
    const p = el('section', 'oh-panel on', [head, el('div', 'oh-body', [list, side])])
    return p
  }

  /** The tab's list and its side panel (what the selection means). */
  private body(): [HTMLElement, HTMLElement] {
    const t = TABS[this.screen as Exclude<Screen, 'main'>][this.tab]
    if (t === 'Vehicle') return this.cars()
    if (t === 'Paint') return this.paints()
    if (t === 'Journal') return this.journal()
    if (t === 'Worlds') return this.coop()
    if (t === 'Controls') return [el('div', 'oh-list', [el('div', 'oh-side', [el('div', 'oh-keys', KEYS.flatMap(([k, d]) => [el('kbd', '', [k]), el('span', '', [d])]))])]), el('div', 'oh-side', [el('h4', '', ['Controls']), el('p', '', ['Keyboard, or the on-screen pads on a touch screen. The round button top right (Q) opens the action wheel: pause, map, minimap, bike, winch, reset, lights, time, weather, sound. A gamepad comes later.'])])]
    const rows = t === 'Driving' ? DRIVING : t === 'Graphics' ? GRAPHICS : t === 'Co-op' ? COOP : AUDIO
    this.sel = Math.min(this.sel, rows.length - 1)
    const list = el('div', 'oh-list', rows.map((c, i) => this.row(c, i)))
    const c = rows[this.sel]
    const side = el('div', 'oh-side', [el('h4', '', [c.label]), el('p', '', [c.help]), ...(this.mode === 'pause' ? [el('p', '', [c.key === 'quality' || c.key === 'antialias' ? 'Applies when you resume: the game restarts right here.' : 'Applies at once.'])] : [])])
    return [list, side]
  }

  private row(c: Choice, i: number): HTMLElement {
    const cur = c.options.findIndex((o) => o.v === this.s[c.key])
    const label = c.options[Math.max(0, cur)].label
    const left = el('button', 'oh-arrow', ['‹']), right = el('button', 'oh-arrow', ['›'])
    left.addEventListener('click', (e) => { e.stopPropagation(); this.sel = i; this.change(c, -1) })
    right.addEventListener('click', (e) => { e.stopPropagation(); this.sel = i; this.change(c, 1) })
    const r = el('div', 'oh-row' + (i === this.sel ? ' sel' : ''), [el('span', '', [c.label]), el('span', 'oh-val', [left, el('b', '', [label]), right])])
    r.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.render() } })
    r.addEventListener('click', () => { this.sel = i; this.change(c, 1) })
    return r
  }

  private change(c: Choice, d: number): void {
    const cur = Math.max(0, c.options.findIndex((o) => o.v === this.s[c.key]))
    const next = c.options[(cur + d + c.options.length) % c.options.length]
    ;(this.s as unknown as Record<string, unknown>)[c.key] = next.v
    saveSettings(this.s)
    this.h.onSettings?.(this.s, c.key)
    this.render()
  }

  private chosen(r: Ride): boolean { return r.ride === (this.s.ride ?? 'car') && (r.ride !== 'car' || r.car!.id === this.s.car) }

  private cars(): [HTMLElement, HTMLElement] {
    this.sel = Math.min(this.sel, RIDES.length - 1)
    const tiles = RIDES.map((r, i) => {
      const on = this.chosen(r)
      const b = el('button', 'oh-car' + (i === this.sel ? ' sel' : '') + (on ? ' chosen' : ''), [
        el('h3', '', [r.name]), el('p', '', [r.line]), ...(on ? [el('span', 'oh-tag', ['Selected'])] : []),
      ])
      b.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.render() } })
      b.addEventListener('click', () => { this.sel = i; this.pickCar(i) })
      return b
    })
    const r = RIDES[this.sel]
    return [el('div', 'oh-list', [el('div', 'oh-cars', tiles)]), el('div', 'oh-side', [el('h4', '', [r.name]), el('p', '', [r.blurb]), ...(r.car ? [stats(r.car)] : [])])]
  }

  private pickCar(i: number): void {
    const r = RIDES[i]
    this.s.ride = r.ride
    if (r.car) this.s.car = r.car.id as CarId
    saveSettings(this.s)
    // (in the pause menu it's taken at once)
    this.h.onVehicle?.(this.s.ride, this.s.car)
    this.render()
  }

  private paints(): [HTMLElement, HTMLElement] {
    this.sel = Math.min(this.sel, SWATCHES.length - 1)
    const sw = SWATCHES.map((p, i) => {
      const owned = paintOwned(this.j, p.hex, i)
      const b = el('button', 'oh-swatch' + (p.hex === null ? ' own' : '') + (i === this.sel ? ' sel' : '') + (p.hex === this.s.paint ? ' chosen' : '') + (owned ? '' : ' locked'), p.hex === null ? ['MAP'] : owned ? [] : [el('span', 'oh-price', [`${paintPrice(p.hex, i)}◆`])])
      if (p.hex) b.style.background = p.hex
      b.title = p.name
      b.addEventListener('pointerenter', () => { if (this.sel !== i) { this.sel = i; this.render() } })
      b.addEventListener('click', () => { this.sel = i; this.pickPaint(i) })
      return b
    })
    const p = SWATCHES[this.sel], price = paintPrice(p.hex, this.sel), owned = paintOwned(this.j, p.hex, this.sel)
    const help = p.hex === null ? "This valley's colour for the car: the G500 in rust red, the E30 in cream." : p.name === 'Stock' ? "The model's own colours." : owned ? 'Enter or click to paint the car.' : `${price} ◆ — Enter or click to buy (you have ${this.j.coins} ◆). Coins: supply crates and the places you find.`
    return [el('div', 'oh-list', [el('div', 'oh-swatches', sw)]), el('div', 'oh-side', [el('h4', '', [p.name]), el('p', '', [help]), ...(this.note ? [el('p', 'oh-note', [this.note])] : [])])]
  }

  private pickPaint(i: number): void {
    const p = SWATCHES[i], price = paintPrice(p.hex, i)
    this.note = ''
    if (!paintOwned(this.j, p.hex, i)) {
      if (this.j.coins < price) { this.note = `Need ${price - this.j.coins} more coins.`; this.render(); return }
      this.j.coins -= price
      this.j.paints.push(p.hex!)
      saveJournal(this.j)
      this.note = `Bought — ${this.j.coins} ◆ left.`
    }
    this.s.paint = p.hex
    saveSettings(this.s)
    this.h.onSettings?.(this.s, 'paint')
    this.render()
  }

  /** The JOURNAL: what's been found and earned (journal.ts, save.ts, Landmarks' discoveries). */
  private journal(): [HTMLElement, HTMLElement] {
    const pr = this.progress, t = this.j.totals ?? {}
    const found = (w: string) => { try { return (JSON.parse(localStorage.getItem(`oth.found.${w}`) ?? '[]') as number[]).length } catch { return 0 } }
    const hrs = (pr?.playSeconds ?? 0) / 3600
    // (each world's crates by their ids: the desert's from 100000 — Places.ts)
    const crates = (w: string) => this.j.crates.filter((id) => (id >= 100000) === (w === 'desert')).length
    const of = (n: number, total?: number) => (total ? `${n} / ${total}` : `${n}`)
    const rows: [string, string][] = [
      ['Coins', `${this.j.coins} ◆`],
      ['Supply crates · valley', of(crates('valley'), t.valley?.crates)],
      ['Places found · valley', of(found('valley'), t.valley?.places)],
      ...(t.desert || crates('desert') || found('desert') ? [['Supply crates · desert', of(crates('desert'), t.desert?.crates)], ['Places found · desert', of(found('desert'), t.desert?.places)]] as [string, string][] : []),
      ['Distance driven', `${((pr?.travelled ?? 0) / 1000).toFixed(1)} km`],
      ['Time on the road', hrs >= 1 ? `${Math.floor(hrs)} h ${Math.round((hrs % 1) * 60)} min` : `${Math.round(hrs * 60)} min`],
    ]
    return [el('div', 'oh-list', rows.map(([l, v]) => el('div', 'oh-row', [el('span', '', [l]), el('span', 'oh-val', [el('b', '', [v])])]))),
      el('div', 'oh-side', [el('h4', '', ['The Valley']), el('p', '', ['Supply crates hide behind the landmarks, at the ends of the trails, by the river and out in the meadows. Signposts at the junctions name where the trails go. Camps let you rest, wait out the rain and save.'])])]
  }

  // ---------------------------------------------------------------------------------------------------- co-op
  /** THE CO-OP SCREEN (docs/MULTIPLAYER.md): your name, HOST a new world, JOIN with a friend's code, your worlds (who's
   *  in, their codes to share). The server's API (net/api.ts); the account is kept in this browser. */
  private co = { account: null as Account | null, worlds: [] as WorldRow[], name: '', code: '', busy: '', msg: '', err: false, fresh: null as WorldRow | null }

  private openCoop(): void {
    const a = loadAccount()
    this.co.account = a
    this.co.name ||= a?.name ?? `Driver ${Math.floor(10 + Math.random() * 90)}`
    this.co.msg = ''
    this.open('coop')
    void this.coopRun('Connecting', async () => {
      if (!this.co.account) return
      this.co.worlds = await listWorlds(this.co.account)
    })
  }

  /** Runs a server step with a busy line; its error shown in the side panel. */
  private async coopRun(busy: string, f: () => Promise<void>): Promise<void> {
    this.co.busy = busy; this.co.msg = ''; this.co.err = false
    this.render()
    try { await f() } catch (e) {
      this.co.err = true
      this.co.msg = e instanceof Error ? e.message : 'Something went wrong'
      if (e instanceof ApiError && e.status === 401) this.co.account = null
    }
    this.co.busy = ''
    if (this.screen === 'coop') this.render()
  }

  private async coopAccount(): Promise<Account> {
    const name = this.co.name.trim()
    if (!name) throw new Error('Type your name first')
    this.co.account = await signIn(name)
    return this.co.account
  }

  private coopHost(): void {
    void this.coopRun('Making your world', async () => {
      const a = await this.coopAccount()
      const w = await createWorld(a, `${a.name}'s valley`.slice(0, 32))
      this.co.worlds = await listWorlds(a)
      this.sel = 3 + Math.max(0, this.co.worlds.findIndex((x) => x.id === w.id))
      this.co.fresh = this.co.worlds.find((x) => x.id === w.id) ?? w
      this.co.msg = `Made. Your friends join with the code ${w.code}.`
    })
  }

  private coopJoin(): void {
    const code = this.co.code.trim().toUpperCase()
    if (code.length !== 6) { this.co.msg = 'A code is 6 letters and numbers.'; this.co.err = true; this.render(); return }
    void this.coopRun('Joining', async () => {
      const a = await this.coopAccount()
      const w = await joinWorld(a, code)
      this.co.code = ''
      this.co.worlds = await listWorlds(a)
      this.sel = 3 + Math.max(0, this.co.worlds.findIndex((x) => x.id === w.id))
      this.co.fresh = this.co.worlds.find((x) => x.id === w.id) ?? w
      this.co.msg = `You're in ${w.name}. Enter to drive in.`
    })
  }

  private coopPlay(w: WorldRow): void {
    void this.coopRun('Starting', async () => {
      await this.coopAccount()
      this.h.onCoop?.(w.id)
    })
  }

  private coopRows(): number { return 3 + this.co.worlds.length }

  private coopGo(i: number): void {
    if (this.co.busy) return
    if (i === 0) (this.view.querySelector('.oh-in-name') as HTMLInputElement | null)?.focus()
    else if (i === 1) this.coopHost()
    else if (i === 2) { if (this.co.code.trim().length === 6) this.coopJoin(); else (this.view.querySelector('.oh-in-code') as HTMLInputElement | null)?.focus() }
    else { const w = this.co.worlds[i - 3]; if (w) this.coopPlay(w) }
  }

  private coop(): [HTMLElement, HTMLElement] {
    const co = this.co
    this.sel = Math.min(this.sel, this.coopRows() - 1)
    const pick = (i: number, e: HTMLElement) => {
      e.addEventListener('pointerenter', () => { if (this.sel !== i && document.activeElement?.tagName !== 'INPUT') { this.sel = i; this.render() } })
      return e
    }
    const input = (cls: string, value: string, ph: string, max: number, set: (v: string) => void) => {
      const i = document.createElement('input')
      i.className = 'oh-in ' + cls
      i.value = value; i.placeholder = ph; i.maxLength = max; i.spellcheck = false; i.autocomplete = 'off'
      i.addEventListener('input', () => set(i.value))
      i.addEventListener('click', (e) => e.stopPropagation())
      return i
    }
    const nameIn = input('oh-in-name', co.name, 'Your name', 20, (v) => (co.name = v))
    const codeIn = input('oh-in-code', co.code, 'ABC123', 6, (v) => (co.code = v.toUpperCase()))
    const joinB = el('button', 'oh-btn', ['Join'])
    joinB.addEventListener('click', (e) => { e.stopPropagation(); this.coopJoin() })
    const rows: HTMLElement[] = [
      pick(0, el('div', 'oh-row' + (this.sel === 0 ? ' sel' : ''), [el('span', '', ['Your name']), el('span', 'oh-val', [nameIn])])),
      pick(1, el('button', 'oh-row' + (this.sel === 1 ? ' sel' : ''), [el('span', '', ['Host a new world']), el('span', 'oh-val', [el('b', '', ['The Valley'])])])),
      pick(2, el('div', 'oh-row' + (this.sel === 2 ? ' sel' : ''), [el('span', '', ['Join with a code']), el('span', 'oh-val', [codeIn, joinB])])),
      el('div', 'oh-sub', [co.account ? (co.worlds.length ? 'Your worlds' : 'No worlds yet — host one, or join a friend') : 'Host a world or join a friend to begin']),
      ...co.worlds.map((w, k) => pick(3 + k, el('button', 'oh-row oh-world' + (this.sel === 3 + k ? ' sel' : ''), [
        el('span', '', [w.name, el('small', '', [` · ${w.map}`])]),
        el('span', 'oh-val', [el('em', 'oh-online' + (w.online ? ' on' : ''), [w.online ? `${w.online} in` : 'empty']), el('b', 'oh-code', [w.code])]),
      ]))),
    ]
    rows[1].addEventListener('click', () => { this.sel = 1; this.coopGo(1) })
    co.worlds.forEach((_, k) => rows[4 + k].addEventListener('click', () => { this.sel = 3 + k; this.coopGo(3 + k) }))
    // (the world picked — or the one just hosted / joined: its code is what you need now)
    const w = this.sel >= 3 ? co.worlds[this.sel - 3] : co.fresh
    const side = el('div', 'oh-side', [
      ...(w ? [el('h4', '', [w.name]), el('div', 'oh-bigcode', [w.code]), el('p', '', [`Share this code: your friends type it under JOIN WITH A CODE. ${w.online ? `${w.online} playing now.` : 'Nobody in right now.'} Enter to drive in.`])]
        : this.sel === 2 ? [el('h4', '', ['Join a friend']), el('p', '', ["Type the 6-letter code from a friend's CO-OP screen. Their world stays on your list."])]
        : this.sel === 1 ? [el('h4', '', ['Host a world']), el('p', '', ['A valley of your own on the server. Mark your land, build, and bring friends in with its code. It keeps going when you leave.'])]
        : [el('h4', '', ['Co-op']), el('p', '', ["Drive the valley with friends: everyone sees everyone. Mark your land with your flag and build on it — while you're on it, nobody can take your things."])]),
      ...(co.busy ? [el('p', 'oh-note', [`${co.busy}…`])] : co.msg ? [el('p', co.err ? 'oh-note oh-err' : 'oh-note', [co.msg])] : []),
    ])
    return [el('div', 'oh-list', rows), side]
  }

  private coopKey(e: KeyboardEvent): void {
    const c = e.code, typing = (e.target as HTMLElement | null)?.tagName === 'INPUT'
    // (in a box: letters go to it — the window's capture listener stops the event, not its typing; Enter acts here, as
    //  the box's own listener never hears it)
    if (typing && (c === 'Enter' || c === 'NumpadEnter')) {
      const box = e.target as HTMLInputElement
      box.blur()
      if (box.classList.contains('oh-in-code')) this.coopJoin()
      else this.render()
      e.preventDefault()
      return
    }
    if (typing && c !== 'ArrowDown' && c !== 'ArrowUp' && c !== 'Escape') return
    if (c === 'Escape' || (c === 'Backspace' && !typing)) {
      if (typing) { (e.target as HTMLElement).blur(); e.preventDefault(); return }
      this.screen = 'main'; this.sel = Math.max(0, this.mainItems().findIndex((it) => it.label === 'Co-op')); this.render(); e.preventDefault(); return
    }
    if (c === 'ArrowDown' || c === 'KeyS') { this.sel = (this.sel + 1) % this.coopRows() }
    else if (c === 'ArrowUp' || c === 'KeyW') { this.sel = (this.sel + this.coopRows() - 1) % this.coopRows() }
    else if (c === 'Enter' || c === 'Space') { this.coopGo(this.sel); e.preventDefault(); return }
    else return
    if (typing) (e.target as HTMLElement).blur()
    e.preventDefault()
    this.render()
  }


  private hints(...h: [string, string][]): HTMLElement {
    return el('footer', 'oh-hints', h.map(([k, t]) => {
      const b = el('button', '', [el('kbd', '', [k]), t])
      b.addEventListener('click', () => this.key(new KeyboardEvent('keydown', { code: k === 'Esc' ? 'Escape' : k === 'Enter' ? 'Enter' : '' })))
      return b
    }))
  }

  // ---------------------------------------------------------------------------------------------------- the keys
  private key(e: KeyboardEvent): void {
    const c = e.code
    if (this.view.querySelector('.oh-loading')) return
    e.stopPropagation() // (the game doesn't see keys while a menu is open)
    if (this.screen === 'coop') { this.coopKey(e); return }
    if (this.screen === 'main') {
      const items = this.mainItems()
      if (c === 'ArrowDown' || c === 'KeyS') this.sel = nextEnabled(items, this.sel, 1)
      else if (c === 'ArrowUp' || c === 'KeyW') this.sel = nextEnabled(items, this.sel, -1)
      else if (c === 'Enter' || c === 'Space') { items[this.sel]?.go(); e.preventDefault(); return }
      else if (c === 'Escape' && this.mode !== 'title') { this.h.onResume?.(); return }
      else return
      e.preventDefault()
      this.render()
      return
    }
    const t = TABS[this.screen as Exclude<Screen, 'main'>]
    const tabName = t[this.tab]
    if (c === 'Escape' || c === 'Backspace') { const back = this.screen === 'garage' ? 'Garage' : this.screen === 'journal' ? 'Journal' : 'Settings'; this.screen = 'main'; this.sel = Math.max(0, this.mainItems().findIndex((it) => it.label === back)); this.render(); e.preventDefault(); return }
    if (c === 'KeyQ' || c === 'KeyE') { this.tab = (this.tab + (c === 'KeyE' ? 1 : t.length - 1)) % t.length; this.sel = 0; this.render(); return }
    const grid = tabName === 'Vehicle' ? RIDES.length : tabName === 'Paint' ? SWATCHES.length : 0
    if (grid) {
      const cols = tabName === 'Vehicle' ? 2 : Math.max(1, Math.round((this.view.querySelector('.oh-swatches')?.clientWidth ?? 400) / 56))
      if (c === 'ArrowRight' || c === 'KeyD') this.sel = Math.min(grid - 1, this.sel + 1)
      else if (c === 'ArrowLeft' || c === 'KeyA') this.sel = Math.max(0, this.sel - 1)
      else if (c === 'ArrowDown' || c === 'KeyS') this.sel = Math.min(grid - 1, this.sel + cols)
      else if (c === 'ArrowUp' || c === 'KeyW') this.sel = Math.max(0, this.sel - cols)
      else if (c === 'Enter' || c === 'Space') { if (tabName === 'Vehicle') this.pickCar(this.sel); else this.pickPaint(this.sel); e.preventDefault(); return }
      else return
      e.preventDefault()
      this.render()
      return
    }
    const rows = tabName === 'Driving' ? DRIVING : tabName === 'Graphics' ? GRAPHICS : tabName === 'Audio' ? AUDIO : tabName === 'Co-op' ? COOP : []
    this.note = ''
    if (!rows.length) return
    if (c === 'ArrowDown' || c === 'KeyS') this.sel = (this.sel + 1) % rows.length
    else if (c === 'ArrowUp' || c === 'KeyW') this.sel = (this.sel + rows.length - 1) % rows.length
    else if (c === 'ArrowRight' || c === 'KeyD' || c === 'Enter') { this.change(rows[this.sel], 1); e.preventDefault(); return }
    else if (c === 'ArrowLeft' || c === 'KeyA') { this.change(rows[this.sel], -1); e.preventDefault(); return }
    else return
    e.preventDefault()
    this.render()
  }
}

/** Every setting back to its default (not used by the UI yet: kept for a RESET row). */
export function resetSettings(): void { saveSettings({ ...DEFAULTS }) }

function el(tag: string, cls: string, kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.append(...kids)
  return e
}

function nextEnabled(items: { disabled?: boolean }[], i: number, d: number): number {
  for (let k = 1; k <= items.length; k++) {
    const j = (i + d * k + items.length * 4) % items.length
    if (!items[j].disabled) return j
  }
  return i
}

function ago(t: number): string {
  const m = Math.max(0, (Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

function carLine(v: VehicleDef): string {
  const s = v.spec
  return `${s.drive.layout.replace('-permanent', '').replace('AWD', '4×4')} · ${Math.round(s.power.peakPower * 1.341)} hp · ${s.transmission.kind === 'auto' ? 'automatic' : 'manual'}`
}

/** The car's numbers as bars, each against the stronger of the two cars. */
function stats(v: VehicleDef): HTMLElement {
  const max = (f: (d: VehicleDef) => number) => Math.max(...VEHICLES.map(f))
  const rows: [string, number, number, string][] = [
    ['Power', v.spec.power.peakPower, max((d) => d.spec.power.peakPower), `${Math.round(v.spec.power.peakPower * 1.341)} hp`],
    ['Torque', v.spec.power.peakTorque, max((d) => d.spec.power.peakTorque), `${v.spec.power.peakTorque} N·m`],
    ['Weight', v.spec.mass.kerb, max((d) => d.spec.mass.kerb), `${v.spec.mass.kerb} kg`],
    ['Top speed', v.spec.published?.topSpeed ?? 0, max((d) => d.spec.published?.topSpeed ?? 0), `${v.spec.published?.topSpeed ?? '–'} km/h`],
  ]
  return el('div', 'oh-stats', rows.map(([l, x, m, txt]) => {
    const bar = document.createElement('i')
    bar.style.setProperty('--w', `${Math.round((x / Math.max(m, 1e-6)) * 100)}%`)
    return el('div', 'oh-stat', [el('span', '', [l]), bar, el('span', '', [txt])])
  }))
}
