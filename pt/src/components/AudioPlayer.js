// ─────────────────────────────────────────────────────────────
//  AudioPlayer.js
//  Fixed-position mini audio player — sits above the footer bar.
//  Never moves with story content so kids can always reach it.
//
//  Controls:
//  - Play / Pause
//  - Rewind 10 seconds
//  - Seek bar (scrub to any position)
//  - Current time / total duration
//  - Replay from start
//
//  Only renders when a real audio file exists (Content-Type check).
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react';

export default function AudioPlayer({
  storyId, nodeId, lang, accent,
  audioReady, audioActive, setAudioActive,
}) {
  const [hasFile,     setHasFile]     = useState(false);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [isDragging,  setIsDragging]  = useState(false);

  const audioRef      = useRef(null);
  const rafRef        = useRef(null);
  const fetchTokenRef = useRef(null);

  const audioPath = `/audio/${storyId}/${nodeId}.${lang}.mp3`;

  // ── Format mm:ss ─────────────────────────────────────────
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // ── Progress RAF loop ─────────────────────────────────────
  const startRAF = useCallback(() => {
    const tick = () => {
      if (audioRef.current && !isDragging) {
        setCurrentTime(audioRef.current.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isDragging]);

  const stopRAF = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Check file existence ──────────────────────────────────
  useEffect(() => {
    if (!audioReady) {
      audioRef.current?.pause();
      audioRef.current = null;
      setHasFile(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      stopRAF();
      return;
    }

    const token = Symbol();
    fetchTokenRef.current = token;
    audioRef.current?.pause();
    audioRef.current = null;
    setHasFile(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    stopRAF();

    fetch(audioPath, { method: 'HEAD' })
      .then(res => {
        if (fetchTokenRef.current !== token) return;
        const ct = res.headers.get('content-type') || '';
        setHasFile(res.ok && ct.startsWith('audio/'));
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return;
        setHasFile(false);
      });

    return () => {
      fetchTokenRef.current = Symbol();
      audioRef.current?.pause();
      stopRAF();
    };
  }, [audioReady, audioPath, stopRAF]);

  // ── Auto-play when active ─────────────────────────────────
  useEffect(() => {
    if (audioActive && hasFile) play();
  }, [hasFile, audioActive]); // eslint-disable-line

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      stopRAF();
    };
  }, [stopRAF]);

  // ── Create audio object ───────────────────────────────────
  const getAudio = () => {
    if (audioRef.current) return audioRef.current;
    const a = new window.Audio(audioPath);
    a.onloadedmetadata = () => setDuration(a.duration);
    a.onended = () => {
      setIsPlaying(false);
      setAudioActive(false);
      setCurrentTime(0);
      stopRAF();
    };
    audioRef.current = a;
    return a;
  };

  // ── Play ──────────────────────────────────────────────────
  const play = () => {
    const a = getAudio();
    a.play()
      .then(() => {
        setIsPlaying(true);
        setAudioActive(true);
        startRAF();
      })
      .catch(() => setIsPlaying(false));
  };

  // ── Pause ─────────────────────────────────────────────────
  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setAudioActive(false);
    stopRAF();
  };

  // ── Rewind 10s ────────────────────────────────────────────
  const rewind = () => {
    const a = getAudio();
    a.currentTime = Math.max(0, a.currentTime - 10);
    setCurrentTime(a.currentTime);
  };

  // ── Replay from start ─────────────────────────────────────
  const replay = () => {
    const a = getAudio();
    a.currentTime = 0;
    setCurrentTime(0);
    play();
  };

  // ── Seek bar interaction ──────────────────────────────────
  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const bar   = e.currentTarget;
    const rect  = bar.getBoundingClientRect();
    const x     = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const t     = ratio * duration;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  if (!hasFile) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const color    = accent || '#d97706';

  const btnStyle = (active = false) => ({
    background: 'none',
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.15)'}`,
    borderRadius: 20,
    color: active ? color : 'rgba(255,255,255,0.6)',
    fontFamily: 'var(--mono)',
    fontSize: '0.7rem',
    padding: '5px 12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  });

  return (
    <div style={{
      position: 'fixed',
      bottom: 56,          // sits directly above the footer bar
      left: 0,
      right: 0,
      zIndex: 99,
      background: 'rgba(8,6,10,0.97)',
      borderTop: `1px solid ${color}33`,
      backdropFilter: 'blur(12px)',
      padding: '8px 16px 6px',
    }}>

      {/* ── Seek bar ── */}
      <div
        onClick={seek}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={e => { setIsDragging(false); seek(e); }}
        onMouseMove={e => { if (isDragging) seek(e); }}
        onMouseLeave={() => setIsDragging(false)}
        onTouchStart={() => setIsDragging(true)}
        onTouchEnd={e => { setIsDragging(false); seek(e); }}
        onTouchMove={e => { if (isDragging) seek(e); }}
        style={{
          width: '100%',
          height: 28,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: 4,
        }}
      >
        {/* Track */}
        <div style={{
          width: '100%',
          height: 4,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.12)',
          position: 'relative',
        }}>
          {/* Fill */}
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: `${progress}%`,
            borderRadius: 4,
            background: color,
            transition: isDragging ? 'none' : 'width 0.1s linear',
          }} />
          {/* Thumb */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: `${progress}%`,
            transform: 'translate(-50%, -50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 6px ${color}88`,
          }} />
        </div>
      </div>

      {/* ── Controls row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {/* Rewind 10s */}
        <button
          onClick={rewind}
          style={btnStyle()}
          title={lang === 'hi' ? '१० सेकंड पीछे' : '10s back'}
          onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
        >
          ⏮ 10s
        </button>

        {/* Play / Pause */}
        <button
          onClick={isPlaying ? pause : play}
          style={{ ...btnStyle(isPlaying), padding: '5px 16px', fontWeight: 700 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
          onMouseLeave={e => { if (!isPlaying) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; } }}
        >
          {isPlaying ? '⏸' : '▶'} {isPlaying
            ? (lang === 'hi' ? 'रोकें' : 'Pause')
            : (lang === 'hi' ? 'सुनें' : 'Play')}
        </button>

        {/* Time */}
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: '0.65rem',
          color: 'rgba(255,255,255,0.35)',
          whiteSpace: 'nowrap',
          flex: 1,
          textAlign: 'center',
        }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>

        {/* Replay from start */}
        <button
          onClick={replay}
          style={btnStyle()}
          title={lang === 'hi' ? 'फिर से सुनें' : 'Replay'}
          onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
        >
          ↺ {lang === 'hi' ? 'फिर से' : 'Replay'}
        </button>
      </div>
    </div>
  );
}
