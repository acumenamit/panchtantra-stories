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
        display:'block', width:'100%', textAlign:'left',
        padding:'14px 18px', borderRadius:14, marginBottom:10,
        border:`1px solid ${hovered && !dimmed ? accent : 'rgba(255,255,255,0.12)'}`,
        background: hovered && !dimmed ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        cursor: dimmed ? 'default' : 'pointer',
        opacity: dimmed ? 0.3 : 1,
        transform: hovered && !dimmed ? 'translateX(6px)' : 'translateX(0)',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:accent, letterSpacing:'0.1em', marginBottom:4 }}>
        Choice {index + 1}
      </div>
      <div style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#f0e6d0' }}>
        {choice.text}
      </div>
    </button>
  );
}
