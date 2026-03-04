import { useState } from 'react';
import { t } from '../LangContext';

export default function ChoiceButton({ choice, index, accent, onClick, dimmed, lang }) {
  const [hovered, setHovered] = useState(false);
  const label = lang === 'hi' ? `चुनाव ${index + 1}` : `Choice ${index + 1}`;

  return (
    <button
      onClick={() => !dimmed && onClick(choice)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={dimmed}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '16px 20px', borderRadius: 14, marginBottom: 12,
        border: `1px solid ${hovered && !dimmed ? accent : 'rgba(255,255,255,0.25)'}`,
        background: hovered && !dimmed ? `${accent}22` : 'rgba(255,255,255,0.06)',
        cursor: dimmed ? 'default' : 'pointer',
        opacity: dimmed ? 0.3 : 1,
        transform: hovered && !dimmed ? 'translateX(6px)' : 'translateX(0)',
        transition: 'all 0.2s ease',
        boxShadow: hovered && !dimmed ? `0 0 20px ${accent}22` : 'none',
      }}
    >
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.68rem', color:accent, letterSpacing:'0.12em', marginBottom:6, fontWeight:700 }}>
        {label}
      </div>
      <div style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#ffffff', lineHeight:1.5 }}>
        {t(choice.text, lang)}
      </div>
    </button>
  );
}
