// AudioButton — pure display component.
// useAudio lives in StoryEngine; this just renders the button.
export default function AudioButton({ isPlaying, isSupported, onToggle, lang, accent }) {
  if (!isSupported) return null;

  const label = isPlaying
    ? (lang === 'hi' ? 'रोकें' : 'Stop')
    : (lang === 'hi' ? 'सुनें' : 'Listen');

  return (
    <button
      onClick={onToggle}
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
      <span style={{ fontSize: '1rem' }}>
        {isPlaying ? '⏹' : '🔊'}
      </span>
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
