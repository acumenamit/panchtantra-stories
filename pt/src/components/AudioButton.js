// ─────────────────────────────────────────────────────────────
//  AudioButton.js
//  Plays pre-generated audio from /audio/{storyId}/{nodeId}.{lang}.mp3
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';

export default function AudioButton({ storyId, nodeId, lang, accent, audioReady, audioActive, setAudioActive }) {
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [hasFile,     setHasFile]     = useState(null);
  const [everHadFile, setEverHadFile] = useState(false);
  const [isChecking,  setIsChecking]  = useState(false);
  const audioRef    = useRef(null);
  const activeToken = useRef(null); // token of the currently-valid load

  const audioPath = `/audio/${storyId}/${nodeId}.${lang}.mp3`;

  // ── Load audio whenever the path or audioReady flag changes ──
  useEffect(() => {
    if (!audioReady) {
      // Not ready yet — stop current playback and reset display state
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setHasFile(null);
      setIsChecking(false);
      return;
    }

    // Mint a token for this load. Only this token's callbacks will commit state.
    const token = Symbol();
    activeToken.current = token;

    // Stop the previous audio immediately so it doesn't compete
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setHasFile(null);
    setIsChecking(true);

    const audio = new window.Audio();

    audio.addEventListener('canplaythrough', () => {
      // Discard if a newer load has already started
      if (activeToken.current !== token) return;
      audioRef.current = audio;
      setHasFile(true);
      setEverHadFile(true);
      setIsChecking(false);
    }, { once: true });

    audio.addEventListener('error', () => {
      if (activeToken.current !== token) return;
      setHasFile(false);
      setIsChecking(false);
    }, { once: true });

    audio.src = audioPath;
    audio.load();

    // Cleanup: mark this token stale AND pause this audio object.
    // The token is invalidated so its callbacks become no-ops.
    // The audio is paused so it doesn't compete with the next load.
    // These two operations are now correctly scoped to THIS effect run only.
    return () => {
      activeToken.current = Symbol(); // any token that isn't `token`
      audio.pause();
    };
  }, [audioReady, audioPath]); // eslint-disable-line

  // ── Auto-play when file loads if user had audio active ───────
  useEffect(() => {
    if (!audioActive || !audioRef.current || hasFile !== true) return;
    const audio = audioRef.current;
    audio.onended = () => setIsPlaying(false);
    audio.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, [hasFile, audioActive]); // eslint-disable-line

  // ── Clean up on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      activeToken.current = Symbol();
      audioRef.current?.pause();
    };
  }, []);

  // ── Toggle play / stop ────────────────────────────────────────
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      setIsPlaying(false);
      setAudioActive(false);
    } else {
      audio.onended = () => setIsPlaying(false);
      audio.play()
        .then(() => { setIsPlaying(true); setAudioActive(true); })
        .catch(() => setIsPlaying(false));
    }
  };

  // ── Loading state ─────────────────────────────────────────────
  if (!audioReady || isChecking || hasFile === null) {
    if (!everHadFile) return null;
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
        {lang === 'hi' ? 'लोड हो रहा है...' : 'Loading...'}
      </button>
    );
  }

  // ── File missing ──────────────────────────────────────────────
  if (hasFile === false) {
    if (!everHadFile) return null;
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
        {lang === 'hi' ? 'उपलब्ध नहीं' : 'Not available'}
      </button>
    );
  }

  // ── Ready ─────────────────────────────────────────────────────
  const label = isPlaying
    ? (lang === 'hi' ? 'रोकें' : 'Stop')
    : (lang === 'hi' ? 'सुनें' : 'Listen');

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
