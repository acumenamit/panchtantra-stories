export default function EndingCard({ node, accent, onRestart, onHome }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:'3.5rem', marginBottom:16 }}>{node.lessonIcon}</div>

      {node.isAlternate && (
        <div style={{ display:'inline-block', padding:'4px 14px', borderRadius:20, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.4)', color:'#fca5a5', fontFamily:'var(--mono)', fontSize:'0.65rem', letterSpacing:'0.1em', marginBottom:20 }}>
          ⚠ ALTERNATE PATH — Nitishastra Wisdom
        </div>
      )}

      <div style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${accent}44`, borderLeft:`3px solid ${accent}`, borderRadius:12, padding:'16px 20px', marginBottom:24, textAlign:'left' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:accent, letterSpacing:'0.12em', marginBottom:8 }}>✦ THE LESSON</div>
        <div style={{ fontFamily:'var(--serif)', fontSize:'1.05rem', color:'#fde68a', lineHeight:1.7, fontStyle:'italic' }}>
          "{node.lesson}"
        </div>
      </div>

      <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#d4c5a0', lineHeight:1.85, whiteSpace:'pre-line', textAlign:'left', marginBottom:32 }}>
        {node.text}
      </p>

      <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
        <button onClick={onRestart}
          onMouseEnter={e => e.currentTarget.style.opacity='0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity='1'}
          style={{ padding:'12px 24px', borderRadius:30, background:`linear-gradient(135deg,${accent}cc,${accent}88)`, border:`1px solid ${accent}`, color:'#fff', fontFamily:'var(--mono)', fontSize:'0.78rem', letterSpacing:'0.1em', transition:'opacity 0.2s' }}>
          🔄 Try Another Path
        </button>
        <button onClick={onHome}
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.03)'}
          style={{ padding:'12px 24px', borderRadius:30, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.15)', color:'#d4c5a0', fontFamily:'var(--mono)', fontSize:'0.78rem', letterSpacing:'0.1em', transition:'background 0.2s' }}>
          🏠 All Stories
        </button>
      </div>
    </div>
  );
}
