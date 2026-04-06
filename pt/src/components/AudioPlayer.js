// ─────────────────────────────────────────────────────────────
//  AudioPlayer.js — Fixed-position mini audio player
//
//  Key design decision: component stays MOUNTED at all times
//  and is hidden via CSS when no audio file exists.
//  This preserves the audio context across node transitions
//  and prevents iOS Safari auto-play blocking on remount.
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

  const audioRef       = useRef(null);
  const rafRef         = useRef(null);
  const fetchTokenRef  = useRef(null);
  const audioActiveRef = useRef(audioActive);
  const barRef         = useRef(null);

  // Keep ref in sync — fetch callbacks read this to avoid stale closure
  useEffect(() => { audioActiveRef.current = audioActive; }, [audioActive]);

  const audioPath = `/audio/${storyId}/${nodeId}.${lang}.mp3`;

  // ── Format mm:ss ─────────────────────────────────────────
  const fmt = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  // ── RAF progress loop ─────────────────────────────────────
  const stopRAF = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const startRAF = useCallback(() => {
    stopRAF();
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRAF]);

  // ── Core: check file + auto-play on node/lang change ─────
  useEffect(() => {
    // Cancel any in-flight fetch
    const token = Symbol();
    fetchTokenRef.current = token;

    // Stop current audio immediately
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    stopRAF();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasFile(false);

    console.log('[AudioPlayer] effect fired | audioReady:', audioReady, '| path:', audioPath, '| audioActive:', audioActiveRef.current);
    if (!audioReady) return;

    fetch(audioPath, { method: 'HEAD' })
      .then(res => {
        if (fetchTokenRef.current !== token) return;
        const ct = res.headers.get('content-type') || '';
        const isAudio = res.ok && ct.startsWith('audio/');
        console.log('[AudioPlayer] HEAD check:', audioPath, '| isAudio:', isAudio, '| ct:', ct);
        setHasFile(isAudio);

        if (!isAudio) return;

        // Create audio object now — reuse across play/pause
        const a = new window.Audio(audioPath);
        a.onloadedmetadata = () => {
          if (fetchTokenRef.current !== token) return;
          setDuration(a.duration);
        };
        a.onended = () => {
          setIsPlaying(false);
          setAudioActive(false);
          setCurrentTime(0);
          stopRAF();
        };
        audioRef.current = a;

        console.log('[AudioPlayer] audioActiveRef.current:', audioActiveRef.current);
        // Auto-play if user had audio running on previous node
        if (audioActiveRef.current) {
          console.log('[AudioPlayer] attempting auto-play...');
          a.play()
            .then(() => { console.log('[AudioPlayer] auto-play SUCCESS'); setIsPlaying(true); startRAF(); })
            .catch((err) => {
              console.log('[AudioPlayer] auto-play BLOCKED:', err.message);
              setIsPlaying(false);
            });
        } else {
          console.log('[AudioPlayer] audioActive is false — not auto-playing');
        }
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return;
        setHasFile(false);
      });

    return () => {
      fetchTokenRef.current = Symbol();
    };
  }, [audioReady, audioPath]); // eslint-disable-line

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      stopRAF();
    };
  }, [stopRAF]);

  // ── Global drag listeners ─────────────────────────────────
  useEffect(() => {
    if (!isDragging) return;
    const getX  = (e) => e.clientX ?? e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX;
    const seek  = (clientX) => {
      if (!barRef.current || !duration || clientX == null) return;
      const rect  = barRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const t     = ratio * duration;
      if (audioRef.current) audioRef.current.currentTime = t;
      setCurrentTime(t);
    };
    const onMove = (e) => seek(getX(e));
    const onUp   = (e) => { setIsDragging(false); seek(getX(e)); };
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
  }, [isDragging, duration]); // eslint-disable-line

  // ── Play / Pause / Rewind / Replay ───────────────────────
  const play = () => {
    if (!audioRef.current) return;
    audioRef.current.play()
      .then(() => { setIsPlaying(true); setAudioActive(true); startRAF(); })
      .catch(() => setIsPlaying(false));
  };

  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setAudioActive(false);
    stopRAF();
  };

  const rewind = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
    setCurrentTime(audioRef.current.currentTime);
  };

  const replay = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
    play();
  };

  // ── Seek bar handlers ─────────────────────────────────────
  const applySeek = (clientX) => {
    if (!barRef.current || !duration || clientX == null) return;
    const rect  = barRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t     = ratio * duration;
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const color    = accent || '#d97706';
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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

  // ── Render — always mounted, hidden when no file ──────────
  // Staying mounted preserves audio context across node changes
  return (
    <div style={{
      position: 'fixed',
      bottom: 60,
      left: 0,
      right: 0,
      zIndex: 99,
      background: 'rgba(8,6,10,0.98)',
      borderTop: `1px solid ${color}33`,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      backdropFilter: 'blur(12px)',
      padding: '8px 16px 10px',
      // Hide instead of unmount — preserves audio context
      opacity: hasFile ? 1 : 0,
      pointerEvents: hasFile ? 'auto' : 'none',
      transition: 'opacity 0.3s ease',
    }}>

      {/* Seek bar */}
      <div
        ref={barRef}
        onMouseDown={e => { setIsDragging(true); applySeek(e.clientX); }}
        onMouseMove={e => { if (isDragging) applySeek(e.clientX); }}
        onMouseUp={e => { setIsDragging(false); applySeek(e.clientX); }}
        onMouseLeave={() => setIsDragging(false)}
        onTouchStart={e => { setIsDragging(true); applySeek(e.touches[0].clientX); }}
        onTouchMove={e => { e.preventDefault(); applySeek(e.touches[0].clientX); }}
        onTouchEnd={e => { setIsDragging(false); applySeek(e.changedTouches[0].clientX); }}
        style={{ width:'100%', height:28, display:'flex', alignItems:'center', cursor:'pointer', marginBottom:4, userSelect:'none', WebkitUserSelect:'none', touchAction:'none' }}
      >
        <div style={{ width:'100%', height:4, borderRadius:4, background:'rgba(255,255,255,0.12)', position:'relative' }}>
          <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${progress}%`, borderRadius:4, background:color, transition: isDragging ? 'none' : 'width 0.1s linear' }} />
          <div style={{ position:'absolute', top:'50%', left:`${progress}%`, transform:'translate(-50%,-50%)', width:14, height:14, borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}88` }} />
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <button onClick={rewind} style={btnStyle()}
          onMouseEnter={e => { e.currentTarget.style.borderColor=color; e.currentTarget.style.color=color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.15)'; e.currentTarget.style.color='rgba(255,255,255,0.6)'; }}
        >⏮ 10s</button>

        <button onClick={isPlaying ? pause : play} style={{ ...btnStyle(isPlaying), padding:'5px 16px', fontWeight:700 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor=color; e.currentTarget.style.color=color; }}
          onMouseLeave={e => { if(!isPlaying){ e.currentTarget.style.borderColor='rgba(255,255,255,0.15)'; e.currentTarget.style.color='rgba(255,255,255,0.6)'; }}}
        >
          {isPlaying ? '⏸' : '▶'} {isPlaying ? (lang==='hi'?'रोकें':'Pause') : (lang==='hi'?'सुनें':'Play')}
        </button>

        <span style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.35)', whiteSpace:'nowrap', flex:1, textAlign:'center' }}>
          {fmt(currentTime)} / {fmt(duration)}
        </span>

        <button onClick={replay} style={btnStyle()}
          onMouseEnter={e => { e.currentTarget.style.borderColor=color; e.currentTarget.style.color=color; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.15)'; e.currentTarget.style.color='rgba(255,255,255,0.6)'; }}
        >↺ {lang==='hi'?'फिर से':'Replay'}</button>
      </div>
    </div>
  );
}
