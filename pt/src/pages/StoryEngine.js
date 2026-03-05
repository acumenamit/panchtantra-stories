import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, t } from '../LangContext';
import Typewriter from '../components/Typewriter';
import ChoiceButton from '../components/ChoiceButton';
import EndingCard from '../components/EndingCard';
import LangToggle from '../components/LangToggle';
import SCENES from '../scenes';
import {
  trackPageView,
  trackStoryStarted,
  trackChoiceMade,
  trackStoryCompleted,
  trackStoryRestarted,
  trackLanguageSwitched,
} from '../analytics';

export default function StoryEngine({ story }) {
  const navigate = useNavigate();
  const { lang }  = useLang();

  const [nodeId,    setNodeId]   = useState('start');
  const [textDone,  setTextDone] = useState(false);
  const [history,   setHistory]  = useState([]);
  const [fading,    setFading]   = useState(false);
  const [pickedNext, setPicked]  = useState(null);

  const node  = story.nodes[nodeId];
  const scene = SCENES[node.scene] || SCENES.forest_day;
  const { accent, bg } = scene;

  // Track story start + page view on mount
  useEffect(() => {
    trackPageView('story', { story_id: story.id, lang });
    trackStoryStarted(story.id, lang);
  }, []); // eslint-disable-line

  // Track when an ending node is reached
  useEffect(() => {
    if (node.isEnding) {
      trackStoryCompleted(story.id, nodeId, !!node.isAlternate, lang);
    }
  }, [nodeId]); // eslint-disable-line

  const go = (nextId, choiceText) => {
    // Track the choice made
    trackChoiceMade(story.id, nodeId, choiceText || nextId, lang);

    setPicked(nextId);
    setFading(true);
    setTimeout(() => {
      setHistory(h => [...h, nodeId]);
      setNodeId(nextId);
      setTextDone(false);
      setPicked(null);
      setFading(false);
    }, 370);
  };

  const back = () => {
    if (!history.length) return;
    setFading(true);
    setTimeout(() => {
      const prev = history[history.length - 1];
      setHistory(h => h.slice(0, -1));
      setNodeId(prev);
      setTextDone(false);
      setFading(false);
    }, 300);
  };

  const restart = () => {
    trackStoryRestarted(story.id, lang);
    setFading(true);
    setTimeout(() => {
      setNodeId('start');
      setHistory([]);
      setTextDone(false);
      setFading(false);
    }, 300);
  };

  const handleLangSwitch = (newLang) => {
    if (newLang !== lang) {
      trackLanguageSwitched(lang, newLang, `story:${story.id}`);
    }
  };

  const steps   = story.progressSteps || [];
  const navBack = lang === 'hi' ? '← वापस'         : '← back';
  const navRst  = lang === 'hi' ? 'फिर से ↺'       : 'restart ↺';
  const navHome = lang === 'hi' ? '← सभी कहानियाँ' : '← All Stories';
  const yourChoice = lang === 'hi' ? '✦ आपका चुनाव' : '✦ YOUR CHOICE';
  const altLabel   = lang === 'hi' ? '⚠ वैकल्पिक मार्ग' : 'alt path';

  return (
    <div style={{ minHeight:'100vh', background:bg, display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 16px 48px', transition:'background 1.2s ease' }}>

      {/* ── Header ── */}
      <div style={{ width:'100%', maxWidth:660, marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>

          <div>
            <button onClick={() => navigate('/')}
              style={{ background:'none', border:'none', color:'#ffffff', fontFamily:'var(--mono)', fontSize:'0.78rem', letterSpacing:'0.05em', marginBottom:10, padding:'4px 0', transition:'color 0.2s', textShadow:'0 1px 8px rgba(0,0,0,0.9)', fontWeight:700 }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = '#ffffff'}>
              {navHome}
            </button>
            <div style={{ fontFamily:'var(--mono)', fontSize:'0.68rem', color:accent, letterSpacing:'0.18em', marginBottom:5 }}>
              {lang === 'hi' ? '✦ पञ्चतन्त्र ✦' : '✦ PANCHATANTRA ✦'}
            </div>
            <h1 style={{ color:'#ffffff', fontSize:'1.6rem', fontFamily:'var(--serif)', fontWeight:700, textShadow:`0 2px 24px ${accent}66` }}>
              {t(story.title, lang)}
            </h1>
            <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'rgba(255,255,255,0.75)', marginTop:5, textShadow:'0 1px 6px rgba(0,0,0,0.8)' }}>
              {scene.label}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, marginTop:4 }}>
            <LangToggle accent={accent} onChange={handleLangSwitch} />
            {node.isAlternate && (
              <div style={{ padding:'4px 10px', borderRadius:20, background:'rgba(239,68,68,0.2)', border:'1px solid rgba(239,68,68,0.5)', color:'#ffb3b3', fontFamily:'var(--mono)', fontSize:'0.62rem', whiteSpace:'nowrap' }}>
                {altLabel}
              </div>
            )}
          </div>
        </div>

        {/* Progress */}
        <div style={{ display:'flex', gap:5 }}>
          {steps.map(s => (
            <div key={s} style={{ height:5, flex:1, borderRadius:4, background: history.includes(s)||nodeId===s ? accent : 'rgba(255,255,255,0.18)', transition:'background 0.5s', boxShadow: history.includes(s)||nodeId===s ? `0 0 8px ${accent}88` : 'none' }} />
          ))}
        </div>
      </div>

      {/* ── Card ── */}
      <div style={{ width:'100%', maxWidth:660, background:'rgba(8,6,10,0.96)', border:`1px solid ${accent}55`, borderRadius:24, overflow:'hidden', boxShadow:`0 0 80px rgba(0,0,0,0.9), 0 0 40px ${accent}18`, opacity:fading?0:1, transform:fading?'translateY(10px)':'translateY(0)', transition:'opacity 0.35s ease, transform 0.35s ease' }}>
        <div style={{ height:3, background:`linear-gradient(90deg,transparent,${accent},transparent)` }} />

        {/* ── Story image — shown when node has an image field ── */}
        {node.image && (
          <div style={{ position:'relative', overflow:'hidden' }}>
            <img
              src={node.image}
              alt=""
              style={{
                width: '100%',
                maxHeight: 320,
                objectFit: 'cover',
                display: 'block',
                opacity: fading ? 0 : 1,
                transition: 'opacity 0.6s ease',
              }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            {/* Gradient fade into card background */}
            <div style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 80,
              background: 'linear-gradient(to bottom, transparent, rgba(8,6,10,0.96))',
            }} />
          </div>
        )}

        <div style={{ padding:'32px 34px' }}>
          {node.isEnding ? (
            <EndingCard
              node={node}
              lang={lang}
              accent={accent}
              story={story}
              onRestart={restart}
              onHome={() => navigate('/')}
            />
          ) : (
            <>
              <Typewriter key={`${nodeId}-${lang}`} text={t(node.text, lang)} onDone={() => setTextDone(true)} />

              {textDone && (
                <div className="fade-up">
                  <div style={{ marginTop:28, marginBottom:20, padding:'16px 20px', borderRadius:14, background:`${accent}1e`, border:`1px solid ${accent}55`, borderLeft:`4px solid ${accent}` }}>
                    <div style={{ fontFamily:'var(--mono)', fontSize:'0.68rem', color:accent, letterSpacing:'0.14em', marginBottom:8, fontWeight:700 }}>
                      {yourChoice}
                    </div>
                    <p style={{ margin:0, fontFamily:'var(--serif)', fontSize:'1.05rem', color:'#fff7d6', lineHeight:1.7, fontWeight:600 }}>
                      {t(node.question, lang)}
                    </p>
                  </div>

                  {node.choices.map((c, i) => (
                    <ChoiceButton
                      key={i}
                      choice={c}
                      index={i}
                      lang={lang}
                      accent={accent}
                      onClick={ch => go(ch.next, t(ch.text, lang))}
                      dimmed={!!pickedNext && pickedNext !== c.next}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding:'14px 34px', borderTop:'1px solid rgba(255,255,255,0.15)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,0.3)' }}>
          <button onClick={back} disabled={!history.length}
            style={{ background:'none', border:'none', padding:0, fontSize:'0.78rem', fontFamily:'var(--mono)', transition:'color 0.2s', color:history.length?'#ffffff':'rgba(255,255,255,0.25)', cursor:history.length?'pointer':'default', fontWeight:history.length?600:400 }}
            onMouseEnter={e => history.length && (e.currentTarget.style.color = accent)}
            onMouseLeave={e => (e.currentTarget.style.color = history.length?'#ffffff':'rgba(255,255,255,0.25)')}>
            {navBack}
          </button>
          <span style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.55)', letterSpacing:'0.08em', textAlign:'center' }}>
            {t(story.theme, lang)}
          </span>
          <button onClick={restart}
            style={{ background:'none', border:'none', padding:0, fontSize:'0.78rem', fontFamily:'var(--mono)', color:'#ffffff', transition:'color 0.2s', fontWeight:600 }}
            onMouseEnter={e => e.currentTarget.style.color = accent}
            onMouseLeave={e => e.currentTarget.style.color = '#ffffff'}>
            {navRst}
          </button>
        </div>
      </div>

      <div style={{ marginTop:28, fontFamily:'var(--mono)', fontSize:'0.65rem', color:'rgba(255,255,255,0.5)', letterSpacing:'0.18em', textShadow:'0 1px 6px rgba(0,0,0,0.8)', textAlign:'center' }}>
        {lang === 'hi' ? '✦ पञ्चतन्त्र ✦ नीतिशास्त्र ✦' : '✦ PANCHATANTRA ✦ NITISHASTRA ✦'}
      </div>
    </div>
  );
}
