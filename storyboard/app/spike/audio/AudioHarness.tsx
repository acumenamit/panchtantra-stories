// P0-13 THROWAWAY: removed at cleanup
'use client'
// The /spike/audio device harness (plan file 14). The model lives in harness-session.ts; this file
// only renders it. The session (and its one narration controller) sits above the node view, which
// is keyed by runEpoch, so Restart remounts the view but never the controller, as it will in P1.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { currentNodeId } from '@/core/engine'
import { isActiveStatus } from '@/reader/audio/narration-state'
import {
  CLIPS,
  createHarnessSession,
  describeImage,
  describeJump,
  fmt,
  formatRanges,
  GRAPH,
  type HarnessSession,
  type HarnessSnapshot,
} from './harness-session'

const BUTTON: CSSProperties = {
  minHeight: 56,
  minWidth: 56,
  margin: 4,
  padding: '8px 16px',
  fontSize: 18,
}
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center' }
const PANEL: CSSProperties = { marginTop: 16, padding: 8, border: '1px solid #888' }
const MONO: CSSProperties = { fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }

const STATUS_TEXT: Readonly<Record<string, string>> = {
  idle: 'Idle',
  loading: 'Loading',
  playing: 'Playing',
  buffering: 'Buffering',
  paused: 'Paused',
  ended: 'Ended',
  blocked: 'Waiting for a tap',
  unavailable: "Narration isn't available",
}

function Button({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" style={BUTTON} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}

/** Remounted on every Restart (key = runEpoch); its mount is logged to prove it. */
function NodeView({ session, snapshot }: { session: HarnessSession; snapshot: HarnessSnapshot }) {
  const { engine } = snapshot
  const nodeId = currentNodeId(engine)
  const node = GRAPH.nodes.get(nodeId)
  const runEpoch = engine.runEpoch
  useEffect(() => {
    session.noteViewMount(runEpoch)
  }, [session, runEpoch])
  const reading = engine.status === 'reading'
  return (
    <section style={PANEL} aria-label="Synthetic node">
      <h2 style={{ margin: 0 }}>
        Node {nodeId} ({node?.type ?? '?'}) - run {runEpoch}, seq {engine.seq}
      </h2>
      <div style={ROW}>
        <Button
          label="Choice 1"
          disabled={!reading}
          onClick={() => session.choose('c1', engine.seq)}
        />
        <Button
          label="Choice 2"
          disabled={!reading}
          onClick={() => session.choose('c2', engine.seq)}
        />
        <Button
          label="Back"
          disabled={engine.path.length <= 1}
          onClick={() => session.back(engine.seq)}
        />
        <Button label="Restart" onClick={() => session.restart(engine.seq)} />
      </div>
    </section>
  )
}

/** Seeks when the thumb is released (the native change event), not on every move. */
function SeekSlider({
  snapshot,
  onCommit,
}: {
  snapshot: HarnessSnapshot
  onCommit: (seconds: number) => void
}) {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const element = input.current
    if (element === null) return
    const commit = () => {
      onCommit(Number(element.value))
      setDragValue(null)
    }
    element.addEventListener('change', commit)
    return () => element.removeEventListener('change', commit)
  }, [onCommit])
  const duration = snapshot.playback?.duration ?? NaN
  const max = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0
  const current = Math.min(max, Math.round(dragValue ?? snapshot.playback?.currentTime ?? 0))
  return (
    <label style={{ ...ROW, width: '100%' }}>
      <span style={{ minWidth: 120 }}>
        {fmt(snapshot.playback?.currentTime ?? 0)} / {fmt(duration)} s
      </span>
      <input
        ref={input}
        type="range"
        aria-label="Seek"
        min={0}
        max={max}
        step={1}
        value={current}
        disabled={max === 0}
        onChange={(event) => setDragValue(Number(event.target.value))}
        style={{ flex: 1, minHeight: 56 }}
      />
    </label>
  )
}

function CopyButtons({ session }: { session: HarnessSession }) {
  const [message, setMessage] = useState('')
  const [fallback, setFallback] = useState<string | null>(null)
  const copy = (what: string, text: string) => {
    if (!navigator.clipboard) {
      setFallback(text)
      setMessage('Clipboard not available: select the text below and copy it.')
      return
    }
    navigator.clipboard.writeText(text).then(
      () => {
        setFallback(null)
        setMessage(`${what} copied.`)
      },
      () => {
        setFallback(text)
        setMessage('Copy was refused: select the text below and copy it.')
      },
    )
  }
  return (
    <div>
      <div style={ROW}>
        <Button label="Copy results" onClick={() => copy('Results', session.resultsText())} />
        <Button label="Copy log" onClick={() => copy('Log', session.logText())} />
        <span role="status">{message}</span>
      </div>
      {fallback !== null && (
        <textarea
          readOnly
          value={fallback}
          rows={12}
          style={{ ...MONO, width: '100%' }}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  )
}

function Diagnostics({ snapshot }: { snapshot: HarnessSnapshot }) {
  const { playback, device } = snapshot
  const rows: readonly (readonly [string, string])[] = [
    [
      'ready',
      snapshot.mounted ? `yes, hydrated at +${Math.round(snapshot.hydratedAt ?? 0)} ms` : 'no',
    ],
    ['user agent', device?.userAgent ?? '-'],
    ['maxTouchPoints', String(device?.maxTouchPoints ?? '-')],
    ['canPlayType(audio/mpeg)', device?.canPlayMpeg ?? '-'],
    ['getAutoplayPolicy', device?.autoplayPolicy ?? '-'],
    ['autoplay probe', snapshot.autoplay],
    ['mode / read to me', `${snapshot.narration.mode} / ${snapshot.readToMe ? 'on' : 'off'}`],
    ['token', snapshot.narration.token ?? '-'],
    [
      'element',
      playback === null
        ? 'not created yet'
        : `t=${fmt(playback.currentTime, 2)} dur=${fmt(playback.duration)} paused=${playback.paused} rs=${playback.readyState} ns=${playback.networkState} err=${playback.errorCode ?? '-'}`,
    ],
    ['buffered', playback === null ? '-' : formatRanges(playback.buffered)],
    ['seekable', playback === null ? '-' : formatRanges(playback.seekable)],
    [
      'tap to playing (ms)',
      snapshot.tapTimings.map((t) => `${t.label} ${t.clip} ${t.ms}`).join(' | ') || '-',
    ],
    ['jumps', snapshot.jumps.map(describeJump).join(' | ') || '-'],
    [
      'durations (s)',
      Object.entries(snapshot.durations)
        .map(([c, d]) => `${c} ${fmt(d)}`)
        .join(' | ') || '-',
    ],
    ['stalls', `${snapshot.stallCount}, longest ${snapshot.longestStallMs} ms`],
    [
      'play() rejections',
      Object.entries(snapshot.playRejections)
        .map(([n, c]) => `${n} ${c}`)
        .join(', ') || '-',
    ],
    ['media errors', snapshot.mediaErrors.join(', ') || '-'],
    [
      'CSP violations',
      `${snapshot.csp.length}${snapshot.csp.map((v) => ` [${v.directive} ${v.blockedURI}]`).join('')}`,
    ],
    ['webp probe', describeImage(snapshot.image)],
    [
      'lifecycle',
      Object.entries(snapshot.lifecycle)
        .map(([n, c]) => `${n} ${c}`)
        .join(', ') || '-',
    ],
    ['node view mounts', String(snapshot.viewMounts)],
  ]
  return (
    <section style={PANEL} aria-label="Diagnostics">
      <h2 style={{ margin: 0 }}>Diagnostics</h2>
      <dl style={MONO}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt style={{ display: 'inline', fontWeight: 'bold' }}>{label}: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>
        Event log ({snapshot.logCount} lines
        {snapshot.logDropped > 0 ? `, ${snapshot.logDropped} dropped` : ''}; last{' '}
        {snapshot.recentLog.length} shown)
      </h3>
      <pre style={{ ...MONO, maxHeight: 320, overflow: 'auto' }}>
        {snapshot.recentLog.join('\n')}
      </pre>
    </section>
  )
}

export function AudioHarness() {
  const [session] = useState(createHarnessSession)
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  )
  const imageHost = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = imageHost.current
    return host === null ? undefined : session.mount(host)
  }, [session])

  const { status } = snapshot.narration
  const active = isActiveStatus(status)
  return (
    <div>
      <p data-ready={snapshot.mounted ? 'true' : 'false'}>
        {snapshot.mounted ? 'Ready' : 'Loading...'}
      </p>
      <p role="status" style={{ fontSize: 24, margin: '8px 0' }}>
        Status: {STATUS_TEXT[status] ?? status}
      </p>
      {status === 'blocked' && (
        <button
          type="button"
          className="spike-pulse"
          style={{ ...BUTTON, fontSize: 22, fontWeight: 'bold' }}
          onClick={session.tapToListen}
        >
          Tap to listen
        </button>
      )}
      <div style={ROW}>
        <Button
          label={snapshot.readToMe ? 'Read to me (on)' : 'Read to me'}
          onClick={session.readToMe}
        />
        <Button label={active ? 'Pause' : 'Resume'} onClick={session.pauseOrResume} />
        <Button label="Stop" onClick={session.stop} />
      </div>
      <NodeView key={snapshot.engine.runEpoch} session={session} snapshot={snapshot} />
      <section style={PANEL} aria-label="Seek tests">
        <SeekSlider snapshot={snapshot} onCommit={session.sliderSeek} />
        <div style={ROW}>
          <Button label="-10 s" onClick={() => session.seekBy('-10s', -10)} />
          <Button label="Jump 1:00" onClick={() => session.seekTo('jump-1:00', 60)} />
          <Button label="Jump 2:30" onClick={() => session.seekTo('jump-2:30', 150)} />
        </div>
        <div style={ROW}>
          <Button
            label={`Play C + jump to 90% now (${CLIPS.C.note})`}
            onClick={() => session.playAndJump('C')}
          />
          <Button
            label={`Play D + jump to 90% now (${CLIPS.D.note})`}
            onClick={() => session.playAndJump('D')}
          />
          <Button label="Missing-clip test" onClick={session.missingClip} />
        </div>
      </section>
      <CopyButtons session={session} />
      <Diagnostics snapshot={snapshot} />
      <div ref={imageHost} aria-hidden="true" />
    </div>
  )
}
