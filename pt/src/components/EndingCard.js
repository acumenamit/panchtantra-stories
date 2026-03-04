import { t } from '../LangContext';
import ShareButton from './ShareButton';

export default function EndingCard({ node, accent, onRestart, onHome, lang, story }) {
  const isHi      = lang === 'hi';
  const altLabel  = isHi ? '⚠ वैकल्पिक मार्ग — नीतिशास्त्र ज्ञान' : '⚠ ALTERNATE PATH — Nitishastra Wisdom';
  const lessonLabel = isHi ? '✦ शिक्षा'              : '✦ THE LESSON';
  const btnRetry  = isHi ? '🔄 दूसरा रास्ता आज़माएँ' : '🔄 Try Another Path';
  const btnHome   = isHi ? '🏠 सभी कहानियाँ'         : '🏠 All Stories';

  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:'3.5rem', marginBottom:16 }}>{node.lessonIcon}</div>

      {node.isAlternate && (
        <div style={{ display:'inline-block', padding:'5px 14px', borderRadius:20, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.4)', color:'#ffb3b3', fontFamily:'var(--mono)', fontSize:'0.65rem', letterSpacing:'0.08em', marginBottom:20 }}>
          {altLabel}
        </div>
      )}

      {/* Lesson box */}
      <div style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${accent}44`, borderLeft:`3px solid ${accent}`, borderRadius:12, padding:'16px 20px', marginBottom:24, textAlign:'left' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:accent, letterSpacing:'0.12em', marginBottom:8 }}>
          {lessonLabel}
        </div>
        <div style={{ fontFamily:'var(--serif)', fontSize:'1.05rem', color:'#fde68a', lineHeight:1.7, fontStyle:'italic' }}>
          "{t(node.lesson, lang)}"
        </div>
      </div>

      {/* Story text */}
      <p style={{ fontFamily:'var(--serif)', fontSize:'1rem', color:'#d4c5a0', lineHeight:1.85, whiteSpace:'pre-line', textAlign:'left', marginBottom:32 }}>
        {t(node.text, lang)}
      </p>

      {/* Action buttons */}
      <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:16 }}>
        <button onClick={onRestart}
          onMouseEnter={e => e.currentTarget.style.opacity='0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity='1'}
          style={{ padding:'12px 24px', borderRadius:30, background:`linear-gradient(135deg,${accent}cc,${accent}88)`, border:`1px solid ${accent}`, color:'#fff', fontFamily:'var(--mono)', fontSize:'0.78rem', letterSpacing:'0.08em', transition:'opacity 0.2s' }}>
          {btnRetry}
        </button>
        <button onClick={onHome}
          onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.03)'}
          style={{ padding:'12px 24px', borderRadius:30, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.15)', color:'#d4c5a0', fontFamily:'var(--mono)', fontSize:'0.78rem', letterSpacing:'0.08em', transition:'background 0.2s' }}>
          {btnHome}
        </button>
      </div>

      {/* Share button — prominent after finishing a story */}
      <div style={{ marginTop:8 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:'0.62rem', color:'rgba(255,255,255,0.3)', marginBottom:10, letterSpacing:'0.1em' }}>
          {isHi ? 'अपने बच्चे के साथ यह कहानी शेयर करें' : 'Share this story with a child you love'}
        </div>
        <ShareButton story={story} lang={lang} accent={accent} variant="pill" />
      </div>
    </div>
  );
}
