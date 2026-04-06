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

  const audioRef        = useRef(null);
  const rafRef          = useRef(null);
  const fetchTokenRef   = useRef(null);
  const audioActiveRef  = useRef(audioActive);

  // Keep ref in sync with prop so fetch callbacks always see latest value
  useEffect(() => { audioActiveRef.current = audioActive; }, [audioActive]);

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
        const isAudio = res.ok && ct.startsWith('audio/');
        setHasFile(isAudio);
        // Auto-play directly here if user had audio active on previous node
        // More reliable than relying on the useEffect dependency chain
        if (isAudio && audioActiveRef.current) {
          const a = new window.Audio(audioPath);
          a.onloadedmetadata = () => setDuration(a.duration);
          a.onended = () => {
            setIsPlaying(false);
            setAudioActive(false);
            setCurrentTime(0);
            stopRAF();
          };
          audioRef.current = a;
          a.play()
            .then(() => { setIsPlaying(true); startRAF(); })
            .catch(() => setIsPlaying(false));
        }
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
  }, [audioReady, audioPath, stopRAF]); // eslint-disable-line

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

  // ── Global drag listeners — keep seek working outside the bar ──
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => applySeek(e.clientX ?? e.touches?.[0]?.clientX);
    const onUp   = (e) => {
      setIsDragging(false);
      applySeek(e.clientX ?? e.changedTouches?.[0]?.clientX);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [isDragging]); // eslint-disable-line

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
  // Uses a ref to the bar element so getBoundingClientRect()
  // works correctly during drag — e.currentTarget is unreliable
  // on touch events when the finger moves outside the element.
  const barRef = useRef(null);

  const getSeekTime = (clientX) => {
    if (!barRef.current || !duration) return null;
    const rect  = barRef.current.getBoundingClientRect();
    const x     = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    return ratio * duration;
  };

  const applySeek = (clientX) => {
    const t = getSeekTime(clientX);
    if (t === null) return;
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  // Mouse events
  const onBarMouseDown = (e) => {
    setIsDragging(true);
    applySeek(e.clientX);
  };
  const onBarMouseMove = (e) => {
    if (!isDragging) return;
    applySeek(e.clientX);
  };
  const onBarMouseUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    applySeek(e.clientX);
  };

  // Touch events — use changedTouches for end, touches for move
  const onBarTouchStart = (e) => {
    setIsDragging(true);
    applySeek(e.touches[0].clientX);
  };
  const onBarTouchMove = (e) => {
    e.preventDefault(); // prevent page scroll while seeking
    applySeek(e.touches[0].clientX);
  };
  const onBarTouchEnd = (e) => {
    setIsDragging(false);
    applySeek(e.changedTouches[0].clientX);
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
      bottom: 60,          // footer bar height
      left: 0,
      right: 0,
      zIndex: 99,
      background: 'rgba(8,6,10,0.98)',
      borderTop: `1px solid ${color}33`,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(12px)',
      padding: '8px 16px 10px',
    }}>

      {/* ── Seek bar ── */}
      <div
        ref={barRef}
        onMouseDown={onBarMouseDown}
        onMouseMove={onBarMouseMove}
        onMouseUp={onBarMouseUp}
        onMouseLeave={() => setIsDragging(false)}
        onTouchStart={onBarTouchStart}
        onTouchMove={onBarTouchMove}
        onTouchEnd={onBarTouchEnd}
        style={{
          width: '100%',
          height: 28,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: 4,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
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
