import { useState } from 'react';

export default function ChoiceButton({ choice, index, accent, onClick, dimmed }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={() => !dimmed && onClick(choice)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={dimmed}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '16px 20px',
        borderRadius: 14,
        marginBottom: 12,
        /* bright visible border always, glowing on hover */
        border: `1px solid ${hovered && !dimmed ? accent : 'rgba(255,255,255,0.25)'}`,
        background: hovered && !dimmed
          ? `${accent}22`
          : 'rgba(255,255,255,0.06)',   /* slightly lighter base so text pops */
        cursor: dimmed ? 'default' : 'pointer',
        opacity: dimmed ? 0.3 : 1,
        transform: hovered && !dimmed ? 'translateX(6px)' : 'translateX(0)',
        transition: 'all 0.2s ease',
        boxShadow: hovered && !dimmed ? `0 0 20px ${accent}22` : 'none',
      }}
    >
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: '0.68rem',
        color: accent,
        letterSpacing: '0.12em',
        marginBottom: 6,
        fontWeight: 700,
      }}>
        Choice {index + 1}
      </div>
      <div style={{
        fontFamily: 'var(--serif)',
        fontSize: '1rem',
        color: '#ffffff',        /* pure white for maximum readability */
        lineHeight: 1.5,
      }}>
        {choice.text}
      </div>
    </button>
  );
}
