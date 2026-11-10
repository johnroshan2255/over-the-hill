import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { ENGINE_WORKLET, VOICES } from './engineSynth'
import { vehicleDef } from '../gameplay/vehicle/catalogue'
import type { MapData } from './MapData'
import type { Vehicle } from './Vehicle'
import type { Bike } from './Bike'

/**
 * SOUND for Over the Hill (public/oth/audio — CC0 recordings, credits in ASSET_LIST.md). Starts on the first key /
 * tap (the browsers' rule); light by design (the user: "downloading audio while playing mustn't cause issues"):
 *   BEDS (music, forest, wind in the grass, the night's crickets, streams, waterfalls): <audio> elements STREAMED —
 *     never decoded whole (a 4-minute track would be ~90 MB of samples) — each started only when it's wanted
 *     (`preload: none`), paused again after a while silent;
 *   the ENGINE: SYNTHESIZED (engineSynth.ts — an AudioWorklet, each car's own engine modelled from its cylinders,
 *     firing and exhaust) from the sim's rpm, load and throttle; it starts, stops and dips at a gear change;
 *   the TYRES (a squeal on hard ground, a gravel scrub on dirt): small buffers fetched in the background;
 *   the PLACES (2026-11-02, the user: "add the sounds"): a CAMPFIRE's crackle by every fire and the frogs and birds
 *     of a POND by day (streamed beds, like the others); CALLS from round the camera — blackbirds in the trees by
 *     day, an owl from the woods at night (now and then another answers), frogs along the nearest pond's shore from
 *     dusk — small decoded clips fetched the first time they're wanted, each at a spot in the world (quieter and
 *     duller the further, panned and re-panned as the camera turns), never more than MAX_VOICES at once; the WIND
 *     over the RIDGES (synthesized: noise through a wandering band-pass, in slow gusts) where the land is high and
 *     open.
 * Streams, falls, fires and ponds fade in as the camera nears them, panned to their side. M mutes everything.
 * The DESERT (2026-11-02): wind over the open sand (day and night), the leaves, birds and most crickets only at the
 * oasis, no owls; frogs only by the lagoon (as by any water). A SANDSTORM howls everywhere, a hiss of sand with it.
 */
const BASE = '/oth/audio/'
const MUSIC = ['music_etirwer.ogg', 'music_middle_of_nowhere.mp3']
/** The calls' clips (CC0, docs/ASSETS.md): a few of each, one picked at random, its pitch varied a little. */
const CALLS = {
  bird: ['bird_1.mp3', 'bird_2.mp3', 'bird_3.mp3', 'bird_4.mp3'],
  owl: ['owl_1.mp3', 'owl_2.mp3'],
  frog: ['frog.mp3'],
} as const
type CallKind = keyof typeof CALLS
/** At most this many calls at once (on top of the beds). */
const MAX_VOICES = 5
/** A call playing: where it is (it's re-panned as the camera turns). */
interface Voice { kind: CallKind; x: number; z: number; pan: StereoPannerNode }

/** A streamed, looping bed: an <audio> element through a gain (and a pan), played only while it's heard. */
class Bed {
  readonly el: HTMLAudioElement
  readonly gain: GainNode
  readonly pan: StereoPannerNode
  target = 0
  private level = 0
  private playing = false
  private quiet = 0
  constructor(ctx: AudioContext, url: string, out: AudioNode) {
    this.el = new Audio()
    this.el.src = url
    this.el.loop = true
    this.el.preload = 'none'
    this.gain = ctx.createGain()
    this.gain.gain.value = 0
    this.pan = ctx.createStereoPanner()
    ctx.createMediaElementSource(this.el).connect(this.gain).connect(this.pan).connect(out)
  }
  update(dt: number): void {
    this.level += (this.target - this.level) * Math.min(1, dt * 1.2)
    this.gain.gain.value = this.level
    if (this.target > 0.004 && !this.playing) { this.playing = true; this.el.play().catch(() => { this.playing = false }) }
    // (silent a while: paused — no decoding for a sound nobody hears)
    this.quiet = this.level < 0.002 && this.target < 0.002 ? this.quiet + dt : 0
    if (this.playing && this.quiet > 6) { this.playing = false; this.el.pause() }
  }
}

export class OthAudio {
  private ctx: AudioContext | null = null
  private master!: GainNode
  /** A short CHIME for a find (a crate: two notes; a place / a camp: three, rising) — oscillators through the master
   *  gain, ~0.5 s, nothing loaded. */
  chime(kind: 'crate' | 'place'): void {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const t = ctx.currentTime
    ;(kind === 'crate' ? [880, 1318.5] : [659.3, 987.8, 1318.5]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = t + i * 0.09
      o.type = 'triangle'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45)
      o.connect(g).connect(this.master)
      o.start(t0)
      o.stop(t0 + 0.5)
    })
  }

  /** Off (the Sound setting, M): set before the first key / tap starts the sound, or any time after. */
  muted = false
  private beds: Record<'forest' | 'wind' | 'night' | 'stream' | 'fall' | 'fire' | 'pond', Bed> | null = null
  /** Every campfire (Props.fires — the player's camp's among them, at y −1e5 while it isn't pitched). */
  fires: readonly GFX.Vector3[] = []
  private amb!: GainNode
  private readonly clips = new Map<string, AudioBuffer | null>()
  private readonly voices: Voice[] = []
  private readonly nextCall: Record<CallKind, number> = { bird: 2, owl: 9, frog: 3 }
  private owlAnswered = false
  /** The lake and the ponds (their shores: the frogs). */
  private ponds: { cx: number; cz: number; rx: number; rz: number; rot: number; level: number }[] = []
  /** The ridge wind: its gain and its howl's band-pass. */
  private windGain: GainNode | null = null
  private windHowl!: BiquadFilterNode
  private music: HTMLAudioElement | null = null
  private musicIndex = 0
  // the engine: the synth's worklet, through the distance's low-pass and gain
  private engine: AudioWorkletNode | null = null
  private engineBus!: GainNode
  private engineTone!: BiquadFilterNode
  /** the car the engine's voice is (a new car: its own voice, started) and the gear last heard (a change: a dip) */
  private voiceOf = ''
  private lastGear = ''
  private squeal: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  private gravel: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  /** The bike's FREEWHEEL: a ratchet's clicks (made here, 36 a second at rate 1 — played at the rear wheel's turns a
   *  second), heard while it coasts. */
  private freewheel: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  /** The bike (main.ts): while it's ridden its tyres and freewheel are heard, the parked car's engine is off. */
  bike: Bike | null = null
  /** The MOTORBIKE (main.ts): its own engine — a second voice of the synth (the single's thump) — and its tyres. */
  moto: Bike | null = null
  private motoEngine: AudioWorkletNode | null = null
  private motoTone!: BiquadFilterNode
  private motoBus!: GainNode
  private motoOn = false
  private motoGear = 0
  private parkedWas = false
  private sense = 0
  private near = { stream: 1e9, streamPan: 0, fall: 1e9, fallPan: 0, forest: 0, fire: 1e9, firePan: 0, pond: 1e9, pondPan: 0, pondIdx: -1, ridge: 0 }
  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]
  private flowPts: number[] = []
  private readonly right = new GFX.Vector3()
  /** RAIN (no recording: synthesized): looped noise through a soft band-pass, its level the weather's rain. */
  private rainGain: GainNode | null = null

  constructor(private readonly map: MapData, private readonly car: Vehicle, private readonly atmos: Atmosphere) {
    this.setWorld()
    const start = () => {
      for (const t of ['keydown', 'pointerdown', 'touchstart']) window.removeEventListener(t, start)
      this.init()
    }
    for (const t of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(t, start)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || !this.ctx) return
      this.muted = !this.muted
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.08)
    })
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) { void this.ctx.suspend(); this.music?.pause() } else { void this.ctx.resume(); void this.music?.play().catch(() => {}) }
    })
  }

  /** The world's water (the map's — main.ts gives a live one: called again at a crossing): every point of the flowing
   *  water (the river, the streams; the camera's nearest, a few times a second), the lake and the ponds. */
  setWorld(): void {
    const W = this.map.meta.water
    this.flowPts = []
    for (const L of [W.river, ...(W.streams ?? [])]) for (let i = 0; i < L.x.length; i += 2) this.flowPts.push(L.x[i], L.z[i])
    this.ponds = [W.lake, ...(W.ponds ?? [])]
    this.near.pondIdx = -1
  }

  private init(): void {
    const ctx = (this.ctx = new AudioContext())
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    this.master.connect(ctx.destination)
    const amb = (this.amb = ctx.createGain())
    amb.gain.value = 1
    amb.connect(this.master)
    this.beds = {
      forest: new Bed(ctx, BASE + 'amb_forest.ogg', amb),
      wind: new Bed(ctx, BASE + 'amb_wind_grass.ogg', amb),
      night: new Bed(ctx, BASE + 'amb_night.mp3', amb),
      stream: new Bed(ctx, BASE + 'amb_stream.ogg', amb),
      fall: new Bed(ctx, BASE + 'amb_waterfall.ogg', amb),
      fire: new Bed(ctx, BASE + 'amb_fire.mp3', amb),
      pond: new Bed(ctx, BASE + 'amb_pond.mp3', amb),
    }
    // the RAIN: 2 s of noise (each sample a little toward the last: a soft hiss, not a white one) looped through a
    // band-pass — the hiss of rain on grass and the car's roof; silent (0 gain) until it rains
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0)
    let last = 0
    for (let i = 0; i < nd.length; i++) { last = last * 0.55 + (Math.random() * 2 - 1) * 0.45; nd[i] = last }
    const ns = ctx.createBufferSource()
    ns.buffer = nb
    ns.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    bp.Q.value = 0.45
    this.rainGain = ctx.createGain()
    this.rainGain.gain.value = 0
    ns.connect(bp).connect(this.rainGain).connect(amb)
    ns.start()
    // the WIND over the ridges: 6 s of brown noise (a deep rush) through a band-pass that wanders with the gusts (the
    // howl) and a low-pass (the roar); silent down in the valley
    const wb = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate), wd = wb.getChannelData(0)
    let br = 0
    for (let i = 0; i < wd.length; i++) { br = (br + (Math.random() * 2 - 1) * 0.02) / 1.02; wd[i] = br * 3.5 }
    const ws = ctx.createBufferSource()
    ws.buffer = wb
    ws.loop = true
    this.windHowl = ctx.createBiquadFilter()
    this.windHowl.type = 'bandpass'
    this.windHowl.frequency.value = 450
    this.windHowl.Q.value = 1.8
    const roar = ctx.createBiquadFilter()
    roar.type = 'lowpass'
    roar.frequency.value = 240
    const howlGain = ctx.createGain()
    howlGain.gain.value = 1.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    ws.connect(this.windHowl).connect(howlGain).connect(this.windGain)
    ws.connect(roar).connect(this.windGain)
    this.windGain.connect(amb)
    ws.start()
    // the MUSIC: the two tracks one after the other, quietly under the world
    const music = (this.music = new Audio())
    music.preload = 'auto'
    const mg = ctx.createGain()
    mg.gain.value = 0.26
    ctx.createMediaElementSource(music).connect(mg).connect(this.master)
    const next = () => { music.src = BASE + MUSIC[this.musicIndex++ % MUSIC.length]; void music.play().catch(() => {}) }
    music.addEventListener('ended', next)
    next()
    // the ENGINE: the synth on the audio thread (its code from a Blob: no file to fetch); the TYRES: fetched now, in
    // the background (a few hundred kB each)
    this.engineTone = ctx.createBiquadFilter()
    this.engineTone.type = 'lowpass'
    this.engineTone.frequency.value = 9000
    this.engineBus = ctx.createGain()
    this.engineBus.gain.value = 0
    this.engineTone.connect(this.engineBus).connect(this.master)
    void ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }))).then(() => {
      this.engine = new AudioWorkletNode(ctx, 'oth-engine', { numberOfInputs: 0, outputChannelCount: [1] })
      this.engine.connect(this.engineTone)
      this.motoEngine = new AudioWorkletNode(ctx, 'oth-engine', { numberOfInputs: 0, outputChannelCount: [1] })
      this.motoEngine.connect(this.motoTone)
      this.motoEngine.port.postMessage({ voice: VOICES.moto })
    })
    this.motoTone = ctx.createBiquadFilter()
    this.motoTone.type = 'lowpass'
    this.motoTone.frequency.value = 9000
    this.motoBus = ctx.createGain()
    this.motoBus.gain.value = 0
    this.motoTone.connect(this.motoBus).connect(this.master)
    // another car: this engine runs down (the new one gets its voice and starts once it's loaded — update)
    this.car.onCarChange = () => this.engine?.port.postMessage({ event: 'stop' })
    const load = (f: string) => fetch(BASE + f).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
    const loopOf = (buf: AudioBuffer, to: AudioNode) => {
      const src = ctx.createBufferSource(), gain = ctx.createGain()
      src.buffer = buf; src.loop = true; gain.gain.value = 0
      src.connect(gain).connect(to)
      src.start()
      return { src, gain }
    }
    void load('tyre_squeal.wav').then((b) => (this.squeal = loopOf(b, this.master)))
    void load('tyre_gravel.wav').then((b) => (this.gravel = loopOf(b, this.master)))
    {
      // the ratchet: 36 short bright clicks a second, each a few ms of decaying noise, a little uneven
      const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr, sr), d = buf.getChannelData(0)
      let seed = 7
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let k = 0; k < 36; k++) {
        const at = Math.floor((k / 36) * sr), amp = 0.55 + 0.45 * rnd(), n = Math.floor(sr * 0.004)
        for (let i = 0; i < n; i++) d[at + i] += (rnd() * 2 - 1) * amp * Math.exp(-i / (sr * 0.0007))
      }
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 2200
      hp.connect(this.master)
      this.freewheel = loopOf(buf, hp)
    }
  }

  /** Each frame (dt in s): the engine, the tyres and the beds follow the car, the light, the camera. */
  update(dt: number, camera: GFX.Camera): void {
    const ctx = this.ctx
    if (!ctx || !this.beds) return
    const t = ctx.currentTime, sim = this.car.sim, D = sim?.real ?? null
    // (the two-wheeler ridden: its tyres are heard — the motorbike's engine below, the bicycle's freewheel)
    const bk = this.moto?.sim ?? this.bike?.sim ?? null
    const tw = this.moto?.sim ? this.moto : this.bike
    const ms = this.moto?.sim ?? null, M = this.motoEngine
    if (M) {
      if (!!ms !== this.motoOn) { this.motoOn = !!ms; M.port.postMessage({ event: ms ? 'start' : 'stop' }) }
      if (ms) {
        const thr = ms.pedalling ? Math.max(0, ms.controls.pedal) : 0
        M.port.postMessage({ set: [ms.rpm, thr, thr, 1700, 11800] })
        if (ms.gear !== this.motoGear) { if (this.motoGear) M.port.postMessage({ event: 'shift' }); this.motoGear = ms.gear }
        const dM = camera.position.distanceTo(this.moto!.pos), nearM = Math.min(1, Math.max(0.15, 9 / Math.max(dM, 1)))
        this.motoTone.frequency.setTargetAtTime(2000 + 8000 * nearM, ctx.currentTime, 0.2)
        this.motoBus.gain.setTargetAtTime(0.75 * nearM, ctx.currentTime, 0.2)
      } else this.motoBus.gain.setTargetAtTime(0, ctx.currentTime, 0.6)
    }
    // (the car parked — the rider on the bike: its engine runs down; back in, it starts again)
    if (this.engine && this.car.parked !== this.parkedWas) { this.parkedWas = this.car.parked; this.engine.port.postMessage({ event: this.car.parked ? 'stop' : 'start' }) }
    const speed = bk ? Math.abs(bk.speed) : sim ? Math.abs(sim.speed) : 0
    // the car from the camera: the further, the quieter
    const dCar = camera.position.distanceTo(bk && tw ? tw.pos : this.car.pos), near = Math.min(1, Math.max(0.15, 9 / Math.max(dCar, 1)))
    // ENGINE: the sim's rpm, load and throttle to the synth (each car's own revs: idle … redline)
    const E = this.engine
    if (E && sim && !this.car.parked) {
      // a new car (or the first): its voice, and the key turns once it's loaded
      if (this.voiceOf !== this.car.id && this.car.id) {
        this.voiceOf = this.car.id
        E.port.postMessage({ voice: VOICES[this.car.id] ?? VOICES[vehicleDef(this.car.id).voice ?? ''] ?? VOICES.offroader })
        E.port.postMessage({ event: 'start' })
      }
      const thr = Math.max(0, sim.controls.throttle)
      let rpm: number, load: number, idle = 0, red = 0
      if (D) {
        rpm = D.rpm; load = D.load
        idle = (D.R.power.wIdle * 30) / Math.PI; red = (D.R.power.wRedline * 30) / Math.PI
      } else {
        rpm = 800 + Math.min(1, speed / 25) * 3500 + thr * 800; load = thr
      }
      E.port.postMessage({ set: [rpm, load, thr, idle, red] })
      // a gear change (a numbered gear to another): the drive dips
      const gear = this.car.gear
      if (gear !== this.lastGear && /\d$/.test(gear) && /\d$/.test(this.lastGear)) E.port.postMessage({ event: 'shift' })
      this.lastGear = gear
      // the car from the camera: the further, the quieter and the duller
      this.engineTone.frequency.setTargetAtTime(1500 + 7500 * near, t, 0.2)
      this.engineBus.gain.setTargetAtTime(0.8 * near, t, 0.2)
    }
    // TYRES: a squeal sliding on hard ground; on dirt and gravel a scrub when sliding, a soft roll when not
    const n = bk ? null : sim?.tyreNoise() ?? null
    // (the bike's: its tyres' slip, what the rear rolls on — the hard part of the ground (asphalt / rock / planks, w[0]) or loose; quieter, two thin tyres)
    const bs = bk?.rear.surface ?? null, bHard = bs ? bs.w[0] : 0.2
    const slide = bk ? Math.max(bk.front.slip, bk.rear.slip) : n ? n.slide : sim?.drifting ? 0.8 : 0, spin = n ? n.spin : 0
    const hard = bk ? bHard : n ? n.hard : 0.3, loose = bk ? (1 - bHard) * 0.6 : n ? n.gravel + n.soft : 0.7
    const fast = Math.min(1, speed / 20)
    // (a number that isn't one — a sim caught mid-reload, a pose not yet read — must not reach the audio graph: an
    //  AudioParam throws on it, every frame after; 2026-11-10: 2 000 of them from a phone while the cars were rebuilt)
    const squealK = Math.min(1, slide * 1.2 + spin * 0.5) * hard * 0.5 * Math.min(1, speed / 6) * near
    if (this.squeal && Number.isFinite(squealK) && Number.isFinite(fast)) {
      this.squeal.gain.gain.setTargetAtTime(squealK, t, 0.06)
      this.squeal.src.playbackRate.setTargetAtTime(0.9 + 0.2 * fast, t, 0.1)
    }
    if (this.gravel) {
      const scrub = Math.min(1, slide * 1.2 + spin * 0.8) * loose * 0.75, roll = fast * loose * 0.16
      this.gravel.gain.gain.setTargetAtTime(Math.max(scrub, roll) * Math.min(1, speed / 3) * near, t, 0.08)
      this.gravel.src.playbackRate.setTargetAtTime(0.55 + 0.3 * fast, t, 0.1)
    }
    // the FREEWHEEL: clicking while the bike rolls without being pedalled
    if (this.freewheel) {
      const coast = bk && !ms && !bk.crashed && !bk.pedalling && bk.rear.contact ? Math.min(1, Math.max(0, Math.abs(bk.speed) - 0.4)) : 0
      this.freewheel.gain.gain.setTargetAtTime(coast * 0.22 * near, t, 0.05)
      if (bk) this.freewheel.src.playbackRate.setTargetAtTime(Math.max(0.05, Math.abs(bk.rear.spinRate) / (2 * Math.PI)), t, 0.05)
    }
    // BEDS: what's round the camera (a few times a second)
    this.sense -= dt
    if (this.sense <= 0) { this.sense = 0.25; this.listen(camera) }
    const night = this.atmos.uniforms.uNight.value, day = 1 - night, B = this.beds
    // (the DESERT, 2026-11-02: the leaves and birds only at the oasis, the wind over the open sand stronger and on at
    //  night too, the crickets mostly by the palms — NEXT.md 6)
    const desert = this.map.desert, open = 1 - this.near.forest
    B.forest.target = day * ((desert ? 0 : 0.16) + 0.42 * this.near.forest)
    B.wind.target = desert ? (0.2 + 0.3 * open) * (0.55 + 0.45 * day) : day * (0.1 + 0.22 * open)
    B.night.target = night * (desert ? 0.2 + 0.4 * this.near.forest : 0.5) * (1 - 0.7 * this.atmos.uniforms.uRain.value)
    // (the rain's hiss — and the sandstorm's: sand on the car, in the scrub)
    const dust = this.atmos.uniforms.uDust.value
    if (this.rainGain) this.rainGain.gain.value += (Math.max(0.5 * this.atmos.uniforms.uRain.value, 0.42 * dust) - this.rainGain.gain.value) * Math.min(1, dt * 1.5)
    B.stream.target = 0.65 * smooth(70, 8, this.near.stream)
    B.stream.pan.pan.value = this.near.streamPan * 0.7
    B.fall.target = 0.85 * smooth(110, 10, this.near.fall)
    B.fall.pan.pan.value = this.near.fallPan * 0.7
    // a campfire: loud close by, gone past ~34 m; a pond's frogs and birds by day (at night: the frogs' own calls)
    B.fire.target = 2.4 * (2.5 / Math.max(this.near.fire, 2.5)) * smooth(34, 20, this.near.fire)
    B.fire.pan.pan.value = this.near.firePan * 0.6
    B.pond.target = day * 0.6 * smooth(90, 12, this.near.pond) * (1 - 0.6 * this.atmos.uniforms.uRain.value)
    B.pond.pan.pan.value = this.near.pondPan * 0.6
    for (const k of Object.keys(B) as (keyof typeof B)[]) B[k].update(dt)
    // the RIDGE WIND: high and open ground, in slow gusts, more under a heavy sky
    if (this.windGain) {
      const gust = 0.55 + 0.25 * Math.sin(t * 0.37) + 0.15 * Math.sin(t * 0.83 + 1) + 0.1 * Math.sin(t * 1.9 + 2)
      const sky = 0.6 + 0.4 * this.atmos.uniforms.uCloud.value
      // (a sandstorm howls everywhere, not only on the ridges)
      this.windGain.gain.setTargetAtTime(Math.max(0.5 * this.near.ridge * sky, 0.85 * dust) * gust, t, 0.4)
      this.windHowl.frequency.setTargetAtTime(330 + 300 * gust + 160 * dust, t, 0.5)
    }
    this.calls(dt, camera.position)
  }

  /** CALLS round the camera, each kind on its own uneven clock: blackbirds in the trees by day, an owl from the woods
   *  at night (a third of the time another answers from elsewhere a few seconds later), frogs along the nearest
   *  pond's shore from dusk (frogs don't mind the rain; the birds and owls keep quiet in it). */
  private calls(dt: number, cam: GFX.Vector3): void {
    const u = this.atmos.uniforms, night = u.uNight.value, lamps = u.uLamps.value, rain = u.uRain.value, N = this.nextCall
    const f = this.near.forest
    if ((N.bird -= dt) <= 0) {
      N.bird = 2 + Math.random() * 7 * (1.3 - f) // (more often deep in the trees)
      if (lamps < 0.5 && rain < 0.3 && f > 0.15) {
        const [x, z] = this.spot(cam, 12, 55)
        if (!this.call('bird', x, this.map.height(x, z) + 4 + Math.random() * 9, z, 0.8, 14, 0.9 + Math.random() * 0.22, cam)) N.bird = 1
      }
    }
    if ((N.owl -= dt) <= 0) {
      const answer = !this.owlAnswered && Math.random() < 0.35
      N.owl = answer ? 2.5 + Math.random() * 2.5 : 14 + Math.random() * 30
      this.owlAnswered = answer
      if (night > 0.6 && rain < 0.3 && f > 0.1 && !this.map.desert) { // (no owls in the desert)
        const [x, z] = this.spot(cam, 35, 110)
        if (!this.call('owl', x, this.map.height(x, z) + 10, z, 0.55, 30, 0.95 + Math.random() * 0.09, cam)) N.owl = 1
      }
    }
    if ((N.frog -= dt) <= 0) {
      N.frog = 4 + Math.random() * 7
      const P = this.ponds[this.near.pondIdx]
      if (P && lamps > 0.4 && this.near.pond < 90 && this.voices.filter((v) => v.kind === 'frog').length < 3) {
        // a spot on its shore, round the side nearest the camera
        const c = Math.cos(P.rot), s = Math.sin(P.rot), dx = cam.x - P.cx, dz = cam.z - P.cz
        const a = Math.atan2((-dx * s + dz * c) / P.rz, (dx * c + dz * s) / P.rx) + (Math.random() - 0.5) * 1.8
        const lx = P.rx * Math.cos(a), lz = P.rz * Math.sin(a)
        if (!this.call('frog', P.cx + lx * c - lz * s, P.level, P.cz + lx * s + lz * c, 0.9, 14, 0.86 + Math.random() * 0.28, cam)) N.frog = 1
      }
    }
  }

  /** A spot r0–r1 m from the camera, the most wooded of four tries. */
  private spot(cam: GFX.Vector3, r0: number, r1: number): [number, number] {
    let bx = cam.x, bz = cam.z, bf = -1
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0)
      const x = cam.x + Math.sin(a) * r, z = cam.z + Math.cos(a) * r, w = this.map.maskAt(x, z, this.mk)[3]
      if (w > bf) { bf = w; bx = x; bz = z }
    }
    return [bx, bz]
  }

  /** Play one of `kind`'s clips at (x, y, z): `base` loud at `ref` m, quieter (ref / (ref + d)) and duller the further.
   *  False when it couldn't yet (its clip still on its way, or too many playing): try again soon. */
  private call(kind: CallKind, x: number, y: number, z: number, base: number, ref: number, rate: number, cam: GFX.Vector3): boolean {
    const ctx = this.ctx!, files = CALLS[kind]
    for (const f of files) this.clip(f) // (all of its kind on their way)
    const buf = this.clip(files[Math.floor(Math.random() * files.length)])
    if (!buf || this.voices.length >= MAX_VOICES) return false
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
    const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner()
    src.buffer = buf
    src.playbackRate.value = rate
    lp.type = 'lowpass'
    lp.frequency.value = 2500 + 15000 / (1 + d / 25)
    g.gain.value = (base * ref) / (ref + d)
    pan.pan.value = this.side(x, z, cam) * 0.8
    src.connect(lp).connect(g).connect(pan).connect(this.amb)
    const v: Voice = { kind, x, z, pan }
    this.voices.push(v)
    src.onended = () => {
      this.voices.splice(this.voices.indexOf(v), 1)
      pan.disconnect()
    }
    src.start()
    return true
  }

  /** A clip, decoded — or null while it's being fetched (asked for the first time: fetched now). */
  private clip(file: string): AudioBuffer | null {
    const c = this.clips.get(file)
    if (c !== undefined) return c
    this.clips.set(file, null)
    void fetch(BASE + file).then((r) => r.arrayBuffer()).then((b) => this.ctx!.decodeAudioData(b)).then((buf) => this.clips.set(file, buf)).catch(() => {})
    return null
  }

  /** −1 (left) … 1 (right): where (x, z) is from the camera (its right: listen). */
  private side(x: number, z: number, p: GFX.Vector3): number {
    const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz) || 1
    return (dx * this.right.x + dz * this.right.z) / l
  }

  /** For the harness / a debug view: the context, what's loaded, every layer's level. */
  debug(): object {
    const r = (v: number) => +v.toFixed(3)
    return {
      state: this.ctx?.state ?? 'not started', muted: this.muted,
      engine: this.engine ? { voice: this.voiceOf, gear: this.lastGear, dB: this.engineLevel() } : null,
      engineBus: this.engineBus ? r(this.engineBus.gain.value) : 0, tone: this.engineTone ? Math.round(this.engineTone.frequency.value) : 0,
      squeal: this.squeal ? r(this.squeal.gain.gain.value) : null, gravel: this.gravel ? r(this.gravel.gain.gain.value) : null,
      beds: this.beds ? Object.fromEntries(Object.entries(this.beds).map(([k, b]) => [k, { target: r(b.target), level: r(b.gain.gain.value), playing: !b.el.paused }])) : null,
      music: this.music ? { src: this.music.src.split('/').pop(), playing: !this.music.paused, t: r(this.music.currentTime) } : null,
      near: { stream: Math.round(this.near.stream), fall: Math.round(this.near.fall), forest: r(this.near.forest), fire: Math.round(this.near.fire), pond: Math.round(this.near.pond), ridge: r(this.near.ridge) },
      voices: this.voices.map((v) => v.kind), clips: [...this.clips].filter(([, b]) => b).map(([f]) => f),
      wind: this.windGain ? r(this.windGain.gain.value) : null,
    }
  }

  /** The engine's output level now (dBFS; a meter tapped on the first call — the harness only). */
  private probe: AnalyserNode | null = null
  private engineLevel(): number {
    if (!this.ctx || !this.engineTone) return -999
    if (!this.probe) { this.probe = this.ctx.createAnalyser(); this.probe.fftSize = 2048; this.engineTone.connect(this.probe) }
    const x = new Float32Array(this.probe.fftSize)
    this.probe.getFloatTimeDomainData(x)
    let e = 0
    for (const v of x) e += v * v
    return +(10 * Math.log10(e / x.length + 1e-12)).toFixed(1)
  }

  /** The nearest flowing water and waterfall (distance, side), the forest round the camera. */
  private listen(camera: GFX.Camera): void {
    const p = camera.position, P = this.flowPts
    this.right.setFromMatrixColumn(camera.matrixWorld, 0)
    let best = 1e9, bx = 0, bz = 0
    for (let i = 0; i < P.length; i += 2) {
      const d = (P[i] - p.x) ** 2 + (P[i + 1] - p.z) ** 2
      if (d < best) { best = d; bx = P[i]; bz = P[i + 1] }
    }
    const side = (x: number, z: number) => this.side(x, z, p)
    this.near.stream = Math.sqrt(best)
    this.near.streamPan = side(bx, bz)
    best = 1e9
    for (const f of this.map.meta.water.falls ?? []) {
      const d = Math.hypot(f.x - p.x, f.z - p.z) - 0.3 * (f.y - f.by) // (a tall fall is heard further)
      if (d < best) { best = d; bx = f.x; bz = f.z }
    }
    this.near.fall = best
    this.near.fallPan = best < 1e8 ? side(bx, bz) : 0
    let f = 0
    for (const [dx, dz] of [[0, 0], [35, 0], [-35, 0], [0, 35], [0, -35]]) f += this.map.maskAt(p.x + dx, p.z + dz, this.mk)[3]
    this.near.forest = Math.min(1, f / 5 / 0.6)
    // the nearest campfire (a struck camp's is far below)
    best = 1e9
    for (const F of this.fires) {
      if (F.y < -1e4) continue
      const d = Math.hypot(F.x - p.x, F.y - p.y, F.z - p.z)
      if (d < best) { best = d; bx = F.x; bz = F.z }
    }
    this.near.fire = best
    this.near.firePan = best < 1e8 ? side(bx, bz) : 0
    // the nearest shore of the lake or a pond (along the line to its centre: near enough)
    best = 1e9
    this.ponds.forEach((P, i) => {
      const c = Math.cos(P.rot), s = Math.sin(P.rot), dx = p.x - P.cx, dz = p.z - P.cz
      const r = Math.hypot(dx, dz), q = Math.hypot((dx * c + dz * s) / P.rx, (-dx * s + dz * c) / P.rz)
      const d = q > 1e-4 ? Math.abs(r - r / q) : Math.min(P.rx, P.rz)
      if (d < best) { best = d; this.near.pondIdx = i; bx = P.cx; bz = P.cz }
    })
    this.near.pond = best
    this.near.pondPan = side(bx, bz) * Math.min(1, best / 30)
    // the RIDGES: how far the ground here stands over the ground round it (140 m), how high, how high the camera is
    const g0 = this.map.height(p.x, p.z)
    let ring = 0
    for (let i = 0; i < 8; i++) ring += this.map.height(p.x + Math.sin(i * 0.785) * 140, p.z + Math.cos(i * 0.785) * 140)
    const crest = smooth(4, 45, g0 - ring / 8), high = smooth(120, 420, g0), up = smooth(4, 60, p.y - g0)
    this.near.ridge = Math.min(1, 0.75 * crest + 0.35 * high + 0.3 * up)
    // the calls playing: re-panned as the camera turns
    for (const v of this.voices) v.pan.pan.value = this.side(v.x, v.z, p) * 0.8
  }
}

/** 1 at b (and nearer) … 0 at a (and further), smooth. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
