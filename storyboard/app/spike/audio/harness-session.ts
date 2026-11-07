// P0-13 THROWAWAY: removed at cleanup
// The model behind /spike/audio (plan file 14): a synthetic 3-node graph (a is a fork to the endings
// b and c) driven by the real engine step(), one narration controller above the runEpoch-keyed node
// view, and the S-2/S-3 diagnostics. No storage, cookies, telemetry or story text.
// Creating a session touches no browser API; everything browser-side starts in mount().
import {
  currentNodeId,
  start,
  step,
  type EngineEvent,
  type EngineState,
  type Graph,
} from '@/core/engine'
import {
  createNarrationController,
  type NarrationController,
  type NarrationDiagnostic,
  type NarrationMode,
  type NarrationSnapshot,
  type PlaybackReadout,
  type TimeRange,
} from '@/reader/audio/narration-controller'
import { isActiveStatus } from '@/reader/audio/narration-state'

const STORAGE_BASE =
  'https://wlunxatrekiqygwphkgy.supabase.co/storage/v1/object/public/content/spikes/audio/'

export type ClipKey = 'A' | 'B' | 'C' | 'D'

/** The 4 heard clips (D3-A), by sha256. Durations are the expected values from the plan. */
export const CLIPS: Readonly<Record<ClipKey, { readonly sha256: string; readonly note: string }>> =
  {
    A: {
      sha256: '45866b429e1ba367945166689c72260519bc4b755adc0b6bcd5bf10cc74d1e8c',
      note: '1:05',
    },
    B: {
      sha256: 'ec233a7f8c7dda1d0e311b771139621c979f46515252888da3ebb1fa1ba6734d',
      note: '1:25',
    },
    C: {
      sha256: 'df94e16a29bbe932724c1755945891a0cf2d75504dccedbecc8e87a8e1bb5074',
      note: '3:03, warm',
    },
    D: {
      sha256: '72009c7e6816b1de4c25144994c33929acf54b43e959969f3c9c046b9b066d54',
      note: '2:13, cold',
    },
  }

export const MISSING_CLIP_URL = `${STORAGE_BASE}missing-on-purpose.mp3`
export const PROBE_WEBP_URL = `${STORAGE_BASE}probe.webp`
export const JUMP_FRACTION = 0.9

const MAX_LOG_LINES = 5000
const RECENT_LOG_LINES = 40

export const GRAPH: Graph = {
  storyId: 'spike-audio',
  version: 1,
  startNodeId: 'a',
  locales: ['en'],
  defaultLocale: 'en',
  nodes: new Map([
    [
      'a',
      {
        id: 'a',
        type: 'fork',
        choices: [
          { id: 'c1', next: 'b' },
          { id: 'c2', next: 'c' },
        ],
      },
    ],
    ['b', { id: 'b', type: 'ending', choices: [] }],
    ['c', { id: 'c', type: 'ending', choices: [] }],
  ]),
}

const NODE_CLIPS: Readonly<Record<string, ClipKey>> = { a: 'A', b: 'B', c: 'C' }

// ---- types ----

export interface QuerySwitches {
  readonly readToMe: boolean
  readonly probe: 'autoplay' | 'blocked' | null
  readonly mode: NarrationMode
  /** ?cold (any value): every clip URL gets a cache key that is new on each page load. */
  readonly cold: boolean
  readonly ignored: readonly string[]
}

export interface DeviceInfo {
  readonly userAgent: string
  readonly maxTouchPoints: number
  readonly canPlayMpeg: string
  readonly autoplayPolicy: string
}

export interface TapTiming {
  readonly label: string
  readonly clip: string
  readonly ms: number
}

export interface JumpRecord {
  readonly label: string
  readonly clip: string
  readonly at: number
  readonly target: number
  readonly duration: number
  readonly bufferedEnd: number | null
  readonly targetBuffered: boolean
  readonly seekableEnd: number | null
  readonly seekedMs: number | null
  readonly landedAt: number | null
}

export interface CspViolation {
  readonly at: number
  readonly directive: string
  readonly blockedURI: string
  readonly sourceFile: string
  readonly lineNumber: number
  readonly disposition: string
  readonly sample: string
}

export type ImageProbe =
  | { readonly state: 'not-started' }
  | { readonly state: 'loading' }
  | {
      readonly state: 'loaded'
      readonly width: number
      readonly height: number
      readonly ms: number
    }
  | { readonly state: 'error'; readonly ms: number }

export type AutoplayResult = 'not tested' | 'pending' | 'allowed' | 'blocked'

export interface HarnessSnapshot {
  readonly mounted: boolean
  readonly hydratedAt: number | null
  readonly query: QuerySwitches | null
  readonly device: DeviceInfo | null
  readonly engine: EngineState
  readonly narration: NarrationSnapshot
  readonly playback: PlaybackReadout | null
  readonly readToMe: boolean
  readonly autoplay: AutoplayResult
  readonly tapTimings: readonly TapTiming[]
  readonly jumps: readonly JumpRecord[]
  readonly durations: Readonly<Record<string, number>>
  readonly stallCount: number
  readonly longestStallMs: number
  readonly playRejections: Readonly<Record<string, number>>
  readonly mediaErrors: readonly string[]
  readonly csp: readonly CspViolation[]
  readonly image: ImageProbe
  readonly lifecycle: Readonly<Record<string, number>>
  readonly viewMounts: number
  readonly recentLog: readonly string[]
  readonly logCount: number
  readonly logDropped: number
}

export interface HarnessSession {
  subscribe(listener: () => void): () => void
  getSnapshot(): HarnessSnapshot
  getServerSnapshot(): HarnessSnapshot
  /** Starts the browser side; returns the cleanup. */
  mount(imageHost: HTMLElement): () => void
  readToMe(): void
  pauseOrResume(): void
  stop(): void
  tapToListen(): void
  choose(choiceId: string, viewSeq: number): void
  back(viewSeq: number): void
  restart(viewSeq: number): void
  seekTo(label: string, seconds: number): void
  seekBy(label: string, deltaSeconds: number): void
  sliderSeek(seconds: number): void
  playAndJump(clip: 'C' | 'D'): void
  missingClip(): void
  noteViewMount(runEpoch: number): void
  resultsText(): string
  logText(): string
}

interface CspStore {
  readonly list: CspViolation[]
  notify: (() => void) | null
}

declare global {
  interface Window {
    /** Filled by the inline head script of /spike/audio from the first parse. */
    __spikeCsp?: CspStore
  }
}

// ---- pure helpers ----

export function readQuery(search: string): QuerySwitches {
  const params = new URLSearchParams(search)
  const known = new Set(['readToMe', 'probe', 'mode', 'cold'])
  const probe = params.get('probe')
  return {
    readToMe: params.get('readToMe') === '1',
    probe: probe === 'autoplay' || probe === 'blocked' ? probe : null,
    mode: params.get('mode') === 'tap-to-listen' ? 'tap-to-listen' : 'play-on-choice',
    cold: params.has('cold'),
    ignored: [...new Set(params.keys())].filter((key) => !known.has(key)),
  }
}

/**
 * Read to me starts on with ?readToMe=1, and also with ?mode=tap-to-listen: T6b expects a choice to
 * cue the next clip ("Tap to listen"), and only a choice made with Read to me on reaches the controller.
 */
export function readToMeAtStart(query: QuerySwitches): boolean {
  return query.readToMe || query.mode === 'tap-to-listen'
}

export function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : String(value)
}

export function formatRanges(ranges: readonly TimeRange[]): string {
  return ranges.length === 0 ? '[]' : ranges.map(([s, e]) => `[${fmt(s)}-${fmt(e)}]`).join(' ')
}

function lastEnd(ranges: readonly TimeRange[]): number | null {
  return ranges.length === 0 ? null : Math.max(...ranges.map(([, end]) => end))
}

function insideRanges(ranges: readonly TimeRange[], time: number): boolean {
  return ranges.some(([s, e]) => time >= s && time <= e)
}

function describeQuery(query: QuerySwitches): string {
  const parts = [
    `readToMe=${query.readToMe ? '1' : '-'}`,
    `probe=${query.probe ?? '-'}`,
    `mode=${query.mode}`,
    `cold=${query.cold ? 'yes' : '-'}`,
  ]
  if (query.ignored.length > 0) parts.push(`ignored=${query.ignored.join(',')}`)
  return parts.join(' ')
}

function readDevice(): DeviceInfo {
  const probeElement = document.createElement('audio') // never attached and never given a src
  const policy =
    'getAutoplayPolicy' in navigator && typeof navigator.getAutoplayPolicy === 'function'
      ? String((navigator.getAutoplayPolicy as (type: string) => unknown)('mediaelement'))
      : 'n/a'
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    canPlayMpeg: probeElement.canPlayType('audio/mpeg') || '(empty)',
    autoplayPolicy: policy,
  }
}

// ---- session ----

interface PendingTap {
  readonly label: string
  readonly clip: string
  readonly at: number
  generation: number | null
}

export function createHarnessSession(): HarnessSession {
  let engine = start(GRAPH)
  let readToMeOn = false
  let mountedOnce = false
  let deferredStepDone = false
  let hydratedAt: number | null = null
  let query: QuerySwitches | null = null
  let device: DeviceInfo | null = null
  let coldKey: string | null = null
  let tokenCounter = 0
  let autoplay: AutoplayResult = 'not tested'
  let autoplayGeneration: number | null = null
  let pendingTap: PendingTap | null = null
  let pendingJump: { readonly token: string; readonly clip: string } | null = null
  let seekLabel: string | null = null
  let bufferingSince: number | null = null
  let stallCount = 0
  let longestStallMs = 0
  let tapTimings: TapTiming[] = []
  let jumps: JumpRecord[] = []
  let durations: Record<string, number> = {}
  let playRejections: Record<string, number> = {}
  let mediaErrors: string[] = []
  let csp: CspViolation[] = []
  let image: ImageProbe = { state: 'not-started' }
  let lifecycle: Record<string, number> = {}
  let viewMounts = 0
  const log: string[] = []
  let logDropped = 0
  const listeners = new Set<() => void>()

  const controller: NarrationController = createNarrationController({
    onDiagnostic: (entry) => onDiagnostic(entry),
  })

  function buildSnapshot(): HarnessSnapshot {
    return {
      mounted: mountedOnce,
      hydratedAt,
      query,
      device,
      engine,
      narration: controller.getSnapshot(),
      playback: controller.getPlayback(),
      readToMe: readToMeOn,
      autoplay,
      tapTimings,
      jumps,
      durations,
      stallCount,
      longestStallMs,
      playRejections,
      mediaErrors,
      csp,
      image,
      lifecycle,
      viewMounts,
      recentLog: log.slice(-RECENT_LOG_LINES),
      logCount: log.length + logDropped,
      logDropped,
    }
  }

  const serverSnapshot = buildSnapshot()
  let snapshot = serverSnapshot

  function emit(): void {
    snapshot = buildSnapshot()
    for (const listener of [...listeners]) listener()
  }

  function write(at: number, text: string): void {
    if (log.length >= MAX_LOG_LINES) {
      log.shift()
      logDropped++
    }
    log.push(`+${Math.round(at)} ${text}`)
  }

  function note(text: string): void {
    write(performance.now(), text)
  }

  // ---- clips and tokens ----

  function clipUrl(key: ClipKey): string {
    const url = `${STORAGE_BASE}${CLIPS[key].sha256}.mp3`
    return coldKey === null ? url : `${url}?cold=${coldKey}`
  }

  function clipOf(url: string | null): string {
    if (url === null) return '-'
    if (url === MISSING_CLIP_URL) return 'missing'
    const key = (Object.keys(CLIPS) as ClipKey[]).find((k) => url.includes(CLIPS[k].sha256))
    return key ?? '?'
  }

  function nodeClip(nodeId: string): ClipKey {
    return NODE_CLIPS[nodeId] ?? 'A'
  }

  function engineToken(): string {
    return `${engine.runEpoch}:${engine.seq}`
  }

  function nextToken(kind: string): string {
    tokenCounter++
    return `${kind}:${tokenCounter}`
  }

  // ---- taps ----

  /** Logs a tap. With a clip, the next "playing" of the command it triggers is timed from now. */
  function tap(label: string, clip?: string): void {
    const at = performance.now()
    write(at, `tap ${label}`)
    if (clip !== undefined) pendingTap = { label, clip, at, generation: null }
  }

  // ---- diagnostics ----

  function describeDiagnostic(entry: NarrationDiagnostic): string {
    const move = `${entry.from}->${entry.status}`
    switch (entry.kind) {
      case 'command':
        return `cmd ${entry.command}${entry.applied ? '' : ' (no-op)'} clip=${clipOf(entry.url)} token=${entry.token ?? '-'} gen=${entry.generation} ${move}`
      case 'play-result':
        return `play() ${entry.outcome}${entry.errorName ? ` ${entry.errorName}` : ''} gen=${entry.forGeneration} ${entry.accepted ? 'accepted' : 'ignored'} ${move}`
      case 'media': {
        const r = entry.reading
        const error = r.errorCode === null ? '' : ` err=${r.errorCode}`
        return `media ${entry.event} ${entry.accepted ? 'accepted' : 'ignored'} t=${fmt(r.currentTime, 2)} rs=${r.readyState} ns=${r.networkState}${error} ${move}`
      }
      case 'lifecycle':
        return `ctrl ${entry.event} vis=${entry.visibilityState}${entry.persisted === null ? '' : ` persisted=${entry.persisted}`} ${entry.accepted ? 'accepted' : 'ignored'} ${move}`
      case 'seek':
        return `seek requested=${fmt(entry.requested)} target=${fmt(entry.target)} dur=${fmt(entry.duration)} buffered=${formatRanges(entry.buffered)} seekable=${formatRanges(entry.seekable)}`
      case 'buffering-timeout':
        return `buffering timeout ${entry.accepted ? 'accepted' : 'ignored'} ${move}`
    }
  }

  function trackCommand(entry: NarrationDiagnostic): void {
    if (entry.kind !== 'command' || !entry.applied) return
    const starts = entry.command === 'play' || entry.command === 'resume'
    if (starts && pendingTap !== null && pendingTap.generation === null) {
      pendingTap.generation = entry.generation
    }
    if (entry.command === 'play' && entry.token === 'probe:autoplay') {
      autoplayGeneration = entry.generation
    }
  }

  function trackStatus(entry: NarrationDiagnostic): void {
    if (entry.status === 'playing' && entry.from !== 'playing') {
      if (pendingTap !== null && pendingTap.generation === entry.generation) {
        const ms = Math.round(entry.at - pendingTap.at)
        tapTimings = [...tapTimings, { label: pendingTap.label, clip: pendingTap.clip, ms }]
        pendingTap = null
      }
      if (autoplay === 'pending' && autoplayGeneration === entry.generation) autoplay = 'allowed'
    }
    if (entry.status === 'buffering' && entry.from !== 'buffering') {
      bufferingSince = entry.at
      stallCount++
    }
    if (entry.from === 'buffering' && entry.status !== 'buffering' && bufferingSince !== null) {
      longestStallMs = Math.max(longestStallMs, Math.round(entry.at - bufferingSince))
      bufferingSince = null
    }
  }

  function trackPlayResult(entry: NarrationDiagnostic): void {
    if (entry.kind !== 'play-result') return
    if (entry.outcome === 'rejected' && entry.errorName !== null) {
      playRejections = {
        ...playRejections,
        [entry.errorName]: (playRejections[entry.errorName] ?? 0) + 1,
      }
    }
    if (autoplay === 'pending' && entry.forGeneration === autoplayGeneration) {
      if (entry.outcome === 'resolved') autoplay = 'allowed'
      else if (entry.errorName === 'NotAllowedError') autoplay = 'blocked'
    }
  }

  function trackMedia(entry: NarrationDiagnostic): void {
    if (entry.kind !== 'media') return
    const clip = clipOf(entry.reading.src)
    if (entry.event === 'error' && entry.reading.errorCode !== null) {
      mediaErrors = [...mediaErrors, `${clip} code ${entry.reading.errorCode}`]
    }
    if (entry.event === 'loadedmetadata' || entry.event === 'durationchange') {
      const duration = controller.getPlayback()?.duration ?? NaN
      if (Number.isFinite(duration) && duration > 0) {
        durations = { ...durations, [clip]: duration }
        scheduleFractionJump(duration)
      }
    }
    if (entry.event === 'seeked') {
      const open = jumps.findLastIndex((jump) => jump.seekedMs === null)
      if (open >= 0) {
        const jump = jumps[open]!
        const closed = {
          ...jump,
          seekedMs: Math.round(entry.at - jump.at),
          landedAt: entry.reading.currentTime,
        }
        jumps = jumps.map((j, index) => (index === open ? closed : j))
      }
    }
  }

  function trackSeek(entry: NarrationDiagnostic): void {
    if (entry.kind !== 'seek') return
    const record: JumpRecord = {
      label: seekLabel ?? 'seek',
      clip: clipOf(controller.getSnapshot().url),
      at: entry.at,
      target: entry.target,
      duration: entry.duration,
      bufferedEnd: lastEnd(entry.buffered),
      targetBuffered: insideRanges(entry.buffered, entry.target),
      seekableEnd: lastEnd(entry.seekable),
      seekedMs: null,
      landedAt: null,
    }
    jumps = [...jumps, record]
  }

  function onDiagnostic(entry: NarrationDiagnostic): void {
    write(entry.at, describeDiagnostic(entry))
    trackCommand(entry)
    trackStatus(entry)
    trackPlayResult(entry)
    trackMedia(entry)
    trackSeek(entry)
    emit()
  }

  // ---- "Play + jump to 90% now" ----

  /** Jumps as soon as the duration is known, while little is buffered (plan S-3 D2). */
  function scheduleFractionJump(duration: number): void {
    const pending = pendingJump
    if (pending === null || controller.getSnapshot().token !== pending.token) return
    pendingJump = null
    queueMicrotask(() => {
      seekLabel = `jump-90% ${pending.clip}`
      controller.seekTo(duration * JUMP_FRACTION)
      seekLabel = null
    })
  }

  // ---- browser side ----

  function attachCsp(): () => void {
    const store = window.__spikeCsp
    if (!store) {
      note('csp recorder missing (inline script did not run)')
      return () => undefined
    }
    const pull = () => {
      csp = [...store.list]
      note(`csp violation ${csp.at(-1)?.directive ?? '?'} ${csp.at(-1)?.blockedURI ?? ''}`)
      emit()
    }
    csp = [...store.list]
    store.notify = pull
    return () => {
      store.notify = null
    }
  }

  function attachLifecycle(): () => void {
    const count = (name: string) => {
      lifecycle = { ...lifecycle, [name]: (lifecycle[name] ?? 0) + 1 }
    }
    const onDocument = (event: Event) => {
      count(event.type)
      note(`page ${event.type} vis=${document.visibilityState}`)
      emit()
    }
    const onWindow = (event: Event) => {
      count(event.type)
      const persisted = event instanceof PageTransitionEvent ? ` persisted=${event.persisted}` : ''
      note(`page ${event.type}${persisted} vis=${document.visibilityState}`)
      emit()
    }
    const documentEvents = ['visibilitychange', 'freeze', 'resume']
    const windowEvents = ['pagehide', 'pageshow']
    for (const name of documentEvents) document.addEventListener(name, onDocument)
    for (const name of windowEvents) window.addEventListener(name, onWindow)
    return () => {
      for (const name of documentEvents) document.removeEventListener(name, onDocument)
      for (const name of windowEvents) window.removeEventListener(name, onWindow)
    }
  }

  /** A WebP <img> made on the client, after the CSP listener exists; no crossorigin attribute. */
  function startImageProbe(host: HTMLElement): void {
    const started = performance.now()
    const img = document.createElement('img')
    img.alt = ''
    img.width = 1
    img.height = 1
    img.addEventListener('load', () => {
      const ms = Math.round(performance.now() - started)
      image = { state: 'loaded', width: img.naturalWidth, height: img.naturalHeight, ms }
      note(`webp loaded ${img.naturalWidth}x${img.naturalHeight} in ${ms} ms`)
      emit()
    })
    img.addEventListener('error', () => {
      const ms = Math.round(performance.now() - started)
      image = { state: 'error', ms }
      note(`webp error after ${ms} ms`)
      emit()
    })
    image = { state: 'loading' }
    img.src = PROBE_WEBP_URL
    host.appendChild(img)
  }

  function runQueryProbe(probe: QuerySwitches['probe']): void {
    if (probe === 'autoplay') {
      autoplay = 'pending'
      note('probe autoplay: play() with no tap')
      controller.playInGesture(clipUrl('A'), 'probe:autoplay')
    } else if (probe === 'blocked') {
      note('probe blocked: clip A waits for a tap')
      const mode = controller.getSnapshot().mode
      controller.setMode('tap-to-listen')
      controller.advanceInGesture(clipUrl('A'), 'probe:blocked')
      controller.setMode(mode)
    }
  }

  /** Runs once, a task after the first mount (so a development double mount does not repeat it). */
  function deferredStep(host: HTMLElement): void {
    if (deferredStepDone) return
    deferredStepDone = true
    startImageProbe(host)
    runQueryProbe(query?.probe ?? null)
    emit()
  }

  function mount(imageHost: HTMLElement): () => void {
    if (!mountedOnce) {
      mountedOnce = true
      hydratedAt = performance.now()
      query = readQuery(window.location.search)
      device = readDevice()
      readToMeOn = readToMeAtStart(query)
      coldKey = query.cold ? Date.now().toString(36) : null
      write(hydratedAt, `hydrated; ${describeQuery(query)}${coldKey ? ` coldKey=${coldKey}` : ''}`)
      if (readToMeOn && !query.readToMe) write(hydratedAt, 'read to me on (mode=tap-to-listen)')
    }
    controller.setMode(query?.mode ?? 'play-on-choice')
    const detachCsp = attachCsp()
    const detachLifecycle = attachLifecycle()
    const timer = setTimeout(() => deferredStep(imageHost), 0)
    emit()
    return () => {
      clearTimeout(timer)
      detachCsp()
      detachLifecycle()
      controller.stop()
    }
  }

  // ---- actions ----

  function readToMe(): void {
    const clip = nodeClip(currentNodeId(engine))
    tap('read-to-me', clip)
    readToMeOn = true
    controller.playInGesture(clipUrl(clip), engineToken())
    emit()
  }

  function pauseOrResume(): void {
    if (isActiveStatus(controller.getSnapshot().status)) {
      tap('pause')
      controller.pause()
    } else {
      tap('resume', clipOf(controller.getSnapshot().url))
      if (!controller.resumeInGesture()) note('resume: nothing to resume')
    }
    emit()
  }

  function stop(): void {
    tap('stop')
    readToMeOn = false
    controller.stop()
    emit()
  }

  function tapToListen(): void {
    tap('tap-to-listen', clipOf(controller.getSnapshot().url))
    if (!controller.resumeInGesture()) note('tap to listen: nothing cued')
    emit()
  }

  /** The audio effect runs right here, inside the tap, as in P1. */
  function playNodeAudio(nodeId: string, label: string): void {
    const clip = nodeClip(nodeId)
    if (readToMeOn) {
      pendingTap = { label, clip, at: performance.now(), generation: null }
      controller.advanceInGesture(clipUrl(clip), engineToken())
    } else if (controller.getSnapshot().status !== 'idle') {
      controller.stop()
    }
  }

  function dispatch(label: string, event: EngineEvent): void {
    tap(label)
    const result = step(GRAPH, engine, event)
    if (!result.accepted) {
      note(`engine ${event.type} ignored (engine seq ${engine.seq})`)
      emit()
      return
    }
    engine = result.state
    note(
      `engine ${event.type} accepted node=${currentNodeId(engine)} seq=${engine.seq} runEpoch=${engine.runEpoch} effects=${result.effects.map((e) => e.type).join(',')}`,
    )
    for (const effect of result.effects) {
      if (effect.type === 'audio') playNodeAudio(effect.nodeId, label)
    }
    emit()
  }

  function seekTo(label: string, seconds: number): void {
    tap(label)
    seekLabel = label
    if (!controller.seekTo(seconds)) note('seek ignored: no clip loaded')
    seekLabel = null
    emit()
  }

  function seekBy(label: string, deltaSeconds: number): void {
    tap(label)
    seekLabel = label
    if (!controller.seekBy(deltaSeconds)) note('seek ignored: no clip loaded')
    seekLabel = null
    emit()
  }

  function playAndJump(clip: 'C' | 'D'): void {
    tap(`play+jump-90% ${clip}`, clip)
    const token = nextToken(`jump-${clip}`)
    pendingJump = { token, clip }
    controller.playInGesture(clipUrl(clip), token)
    emit()
  }

  function missingClip(): void {
    tap('missing-clip', 'missing')
    controller.playInGesture(MISSING_CLIP_URL, nextToken('missing'))
    emit()
  }

  function noteViewMount(runEpoch: number): void {
    viewMounts++
    note(`node view mounted runEpoch=${runEpoch}`)
    emit()
  }

  // ---- copy-out ----

  function resultsText(): string {
    const s = snapshot
    const lines = [
      'P0-13 /spike/audio results',
      `page: ${window.location.pathname}${window.location.search}`,
      `time origin: ${new Date(performance.timeOrigin).toISOString()}; hydrated: +${s.hydratedAt === null ? '-' : Math.round(s.hydratedAt)} ms; ready: ${s.mounted ? 'yes' : 'no'}`,
      `ua: ${s.device?.userAgent ?? '-'}`,
      `touch points: ${s.device?.maxTouchPoints ?? '-'}; canPlayType(audio/mpeg): ${s.device?.canPlayMpeg ?? '-'}; autoplay policy: ${s.device?.autoplayPolicy ?? '-'}`,
      `query: ${s.query ? describeQuery(s.query) : '-'}${coldKey ? ` coldKey=${coldKey}` : ''}`,
      `mode: ${s.narration.mode}; read to me: ${s.readToMe ? 'on' : 'off'}; autoplay probe: ${s.autoplay}`,
      `status: ${s.narration.status}; clip: ${clipOf(s.narration.url)}; token: ${s.narration.token ?? '-'}; node: ${currentNodeId(s.engine)}`,
      `tap-to-playing ms: ${s.tapTimings.map((t) => `${t.label} ${t.clip} ${t.ms}`).join(' | ') || '-'}`,
      `jumps: ${s.jumps.map(describeJump).join(' | ') || '-'}`,
      `durations s: ${
        Object.entries(s.durations)
          .map(([clip, d]) => `${clip} ${fmt(d)}`)
          .join(' | ') || '-'
      }`,
      `stalls: ${s.stallCount}, longest ${s.longestStallMs} ms`,
      `play() rejections: ${
        Object.entries(s.playRejections)
          .map(([name, n]) => `${name} ${n}`)
          .join(', ') || '-'
      }`,
      `media errors: ${s.mediaErrors.join(', ') || '-'}`,
      `CSP violations: ${s.csp.length}${s.csp.map((v) => ` [${v.directive} ${v.blockedURI}]`).join('')}`,
      `webp: ${describeImage(s.image)}`,
      `lifecycle: ${['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume'].map((name) => `${name} ${s.lifecycle[name] ?? 0}`).join(', ')}`,
      `node view mounts: ${s.viewMounts}`,
      `log lines: ${s.logCount} (dropped ${s.logDropped})`,
    ]
    return lines.join('\n')
  }

  function logText(): string {
    return [`P0-13 /spike/audio log (ms since page start)`, ...log].join('\n')
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    mount,
    readToMe,
    pauseOrResume,
    stop,
    tapToListen,
    choose: (choiceId, viewSeq) =>
      dispatch(`choice-${choiceId.slice(1)}`, { type: 'CHOOSE', seq: viewSeq, choiceId }),
    back: (viewSeq) => dispatch('back', { type: 'BACK', seq: viewSeq }),
    restart: (viewSeq) => dispatch('restart', { type: 'RESTART', seq: viewSeq }),
    seekTo,
    seekBy,
    sliderSeek: (seconds) => seekTo('slider', seconds),
    playAndJump,
    missingClip,
    noteViewMount,
    resultsText,
    logText,
  }
}

export function describeJump(jump: JumpRecord): string {
  const buffered = jump.bufferedEnd === null ? 'none' : fmt(jump.bufferedEnd)
  const seeked =
    jump.seekedMs === null
      ? 'not seeked yet'
      : `seeked +${jump.seekedMs} ms at ${fmt(jump.landedAt ?? NaN)}`
  return `${jump.label} ${jump.clip} target ${fmt(jump.target)} of ${fmt(jump.duration)}, buffered end ${buffered} (target buffered: ${jump.targetBuffered ? 'yes' : 'no'}), ${seeked}`
}

export function describeImage(image: ImageProbe): string {
  switch (image.state) {
    case 'loaded':
      return `loaded ${image.width}x${image.height} in ${image.ms} ms`
    case 'error':
      return `error after ${image.ms} ms`
    default:
      return image.state
  }
}
