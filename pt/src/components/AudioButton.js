// ─────────────────────────────────────────────────────────────
//  AudioButton.js
//  Plays pre-generated audio from /audio/{storyId}/{nodeId}.{lang}.mp3
//
//  Props:
//    storyId    — story.id  e.g. 'brahmins-goat'
//    nodeId     — node key  e.g. 'start'
//    lang       — 'en' | 'hi'
//    accent     — hex colour for active state
//    audioReady — bool from usePreloader
//
//  Graceful degradation:
//    • audioReady=false  → shows "Loading audio..." text
//    • file missing/404  → renders nothing (no button at all)
//    • file present      → shows play/stop button
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';

export default function AudioButton({ storyId, nodeId, lang, accent, audioReady }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasFile,   setHasFile]   = useState(null); // null=checking, true, false
  const audioRef = useRef(null);

  const audioPath = `/audio/${storyId}/${nodeId}.${lang}.mp3`;

  // When audioReady flips true, verify file exists and cache the Audio object
  useEffect(() => {
    if (!audioReady) return;

    // Stop and discard any previous audio instance
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setHasFile(null);

    const audio = new window.Audio();

    audio.addEventListener('canplaythrough', () => {
      audioRef.current = audio;
      setHasFile(true);
    }, { once: true });

    audio.addEventListener('error', () => {
      setHasFile(false); // file not generated yet → render nothing
    }, { once: true });

    audio.src = audioPath;
    audio.load();

    return () => { audio.pause(); };
  }, [audioReady, audioPath]);

  // Clean up on unmount
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      setIsPlaying(false);
    } else {
      audio.onended = () => setIsPlaying(false);
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  // ── Still loading ────────────────────────────────────────────
  // Note: "Loading audio..." is handled by the status line in
  // StoryEngine, not here. This component only shows post-textDone.
  // If audioReady is false, StoryEngine won't render us yet.
  if (!audioReady || hasFile === null) return null;

  // ── File doesn't exist — degrade silently ────────────────────
  if (hasFile === false) return null;

  // ── Ready ────────────────────────────────────────────────────
  const label = isPlaying
    ? (lang === 'hi' ? 'रोकें' : 'Stop')
    : (lang === 'hi' ? 'सुनें' : 'Listen');

  return (
    <button
      onClick={toggle}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        borderRadius: 20,
        border: `1px solid ${isPlaying ? accent : 'rgba(255,255,255,0.2)'}`,
        background: isPlaying ? `${accent}22` : 'rgba(255,255,255,0.04)',
        color: isPlaying ? accent : 'rgba(255,255,255,0.55)',
        fontFamily: 'var(--mono)',
        fontSize: '0.72rem',
        letterSpacing: '0.06em',
        cursor: 'pointer',
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
              display: 'inline-block',
              width: 3,
              borderRadius: 2,
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
