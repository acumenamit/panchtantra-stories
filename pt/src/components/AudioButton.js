// ─────────────────────────────────────────────────────────────
//  AudioButton.js
//  Plays pre-generated audio from /audio/{storyId}/{nodeId}.{lang}.mp3
//
//  Safari iOS fix: uses HEAD fetch to check file existence
//  (doesn't require user gesture), then creates Audio object
//  only on user tap. Avoids relying on canplaythrough which
//  Safari iOS never fires without prior user interaction.
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';

export default function AudioButton({ storyId, nodeId, lang, accent, audioReady, audioActive, setAudioActive }) {
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [hasFile,     setHasFile]     = useState(null); // null=checking, true=exists, false=missing
  const audioRef     = useRef(null);
  const fetchTokenRef = useRef(null);

  const audioPath = `/audio/${storyId}/${nodeId}.${lang}.mp3`;

  // ── Check file existence via HEAD fetch ───────────────────
  // Works on all browsers without user gesture.
  // No Audio object created here — Safari iOS safe.
  useEffect(() => {
    // Reset playing state and pause any active audio on node/lang change
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setHasFile(null);

    // Check file existence independently of audioReady —
    // audioReady is driven by the preloader which only resolves
    // when files exist. For stories with no audio, it never
    // becomes true, leaving hasFile stuck at null (Loading...).
    const token = Symbol();
    fetchTokenRef.current = token;

    fetch(audioPath, { method: 'HEAD' })
      .then(res => {
        if (fetchTokenRef.current !== token) return;
        const ct = res.headers.get("content-type") || "";
        setHasFile(res.ok && ct.includes("audio") ? true : false);
      })
      .catch(() => {
        if (fetchTokenRef.current !== token) return;
        setHasFile(false);
      });

    return () => {
      fetchTokenRef.current = Symbol();
      audioRef.current?.pause();
    };
  }, [audioPath]); // eslint-disable-line

  // ── Auto-play: only if audioActive and we know file exists ─
  // Creates Audio object here — but this effect only runs after
  // hasFile=true, which means the HEAD check passed.
  // On Safari iOS, auto-play will be blocked silently (no gesture),
  // but the button will at least be VISIBLE for the user to tap.
  useEffect(() => {
    if (!audioActive || hasFile !== true) return;
    playAudio();
  }, [hasFile, audioActive]); // eslint-disable-line

  // ── Clean up on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      fetchTokenRef.current = Symbol();
      audioRef.current?.pause();
    };
  }, []);

  // ── Create and play audio (called on user tap or auto-play) ─
  const playAudio = () => {
    // Reuse existing audio object if available and not ended
    if (audioRef.current && !audioRef.current.ended) {
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.play()
        .then(() => { setIsPlaying(true); setAudioActive(true); })
        .catch(() => setIsPlaying(false));
      return;
    }

    // Create fresh Audio object — on Safari iOS this must happen
    // inside a user gesture handler to actually play
    const audio = new window.Audio(audioPath);
    audio.onended = () => setIsPlaying(false);
    audioRef.current = audio;

    audio.play()
      .then(() => { setIsPlaying(true); setAudioActive(true); })
      .catch(() => setIsPlaying(false));
  };

  // ── Toggle ─────────────────────────────────────────────────
  const toggle = () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setAudioActive(false);
    } else {
      playAudio();
    }
  };

  // ── Loading state ──────────────────────────────────────────
  if (hasFile === null) {
    return (
      <button disabled style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.02)',
        color: 'rgba(255,255,255,0.25)',
        fontFamily: 'var(--mono)', fontSize: '0.72rem',
        letterSpacing: '0.06em', cursor: 'not-allowed',
      }}>
        <span style={{ fontSize: '1rem' }}>🔊</span>
        {lang === 'ar' ? 'جارٍ التحميل...' : 'Loading...'}
      </button>
    );
  }

  // ── File missing ───────────────────────────────────────────
  if (hasFile === false) {
    return (
      <button disabled style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.02)',
        color: 'rgba(255,255,255,0.2)',
        fontFamily: 'var(--mono)', fontSize: '0.72rem',
        letterSpacing: '0.06em', cursor: 'not-allowed',
      }}>
        <span style={{ fontSize: '1rem' }}>🔊</span>
        {lang === 'ar' ? 'غير متاح' : 'Not available'}
      </button>
    );
  }

  // ── Ready ──────────────────────────────────────────────────
  const label = isPlaying
    ? (lang === 'ar' ? 'إيقاف' : 'Stop')
    : (lang === 'ar' ? 'استمع' : 'Listen');

  return (
    <button
      onClick={toggle}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 20,
        border: `1px solid ${isPlaying ? accent : 'rgba(255,255,255,0.2)'}`,
        background: isPlaying ? `${accent}22` : 'rgba(255,255,255,0.04)',
        color: isPlaying ? accent : 'rgba(255,255,255,0.55)',
        fontFamily: 'var(--mono)', fontSize: '0.72rem',
        letterSpacing: '0.06em', cursor: 'pointer',
        transition: 'all 0.2s ease',
        fontWeight: isPlaying ? 700 : 400,
      }}
      onMouseEnter={e => {
        if (!isPlaying) {
          e.currentTarget.style.border = `1px solid ${accent}`;
          e.currentTarget.style.color = accent;
        }
      }}
      onMouseLeave={e => {
        if (!isPlaying) {
          e.currentTarget.style.border = '1px solid rgba(255,255,255,0.2)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
        }
      }}
    >
      <span style={{ fontSize: '1rem' }}>{isPlaying ? '⏹' : '🔊'}</span>
      {label}
      {isPlaying && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 2 }}>
          {[1, 2, 3].map(i => (
            <span key={i} style={{
              display: 'inline-block', width: 3, borderRadius: 2,
              background: accent,
              animation: `soundbar 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
              height: i === 2 ? 12 : 7,
            }} />
          ))}
        </span>
      )}
    </button>
  );
}
