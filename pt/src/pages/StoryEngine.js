import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, t } from '../LangContext';
import Typewriter from '../components/Typewriter';
import ChoiceButton from '../components/ChoiceButton';
import EndingCard from '../components/EndingCard';
import LangToggle from '../components/LangToggle';
import SCENES from '../scenes';
import AudioButton from '../components/AudioButton';
import usePreloader from '../components/usePreloader';
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

  const [nodeId,      setNodeId]     = useState('start');
  const [textDone,    setTextDone]   = useState(false);
  const [history,     setHistory]    = useState([]);
  const [fading,      setFading]     = useState(false);
  const [pickedNext,  setPicked]     = useState(null);
  const [imgLoaded,   setImgLoaded]  = useState(false);
  const [imageReady,  setImageReady] = useState(false);
  const [audioReady,  setAudioReady] = useState(false);
  // audioActive: user's intent â stays true across nodes so audio
  // auto-plays on each new node once the file is ready
  const [audioActive, setAudioActive] = useState(false);

  const node  = story.nodes[nodeId];
  const scene = SCENES[node.scene] || SCENES.forest_day;
  const { accent, bg } = scene;

  // ââ Preloader âââââââââââââââââââââââââââââââââââââââââââââââââ
  const { getAssetState, preloadNode } = usePreloader(story, nodeId, lang);

  // On every node transition, seed readiness from cache and poll until done
  useEffect(() => {
    const state = getAssetState(nodeId);
    setImageReady(state.imageReady);
    setAudioReady(state.audioReady);
    preloadNode(nodeId);

    const interval = setInterval(() => {
      const latest = getAssetState(nodeId);
      setImageReady(latest.imageReady);
      setAudioReady(latest.audioReady);
      if (latest.imageReady && latest.audioReady) clearInterval(interval);
    }, 300);

    return () => clearInterval(interval);
  }, [nodeId]); // eslint-disable-line

  // Re-check audio when language switches â restart polling until ready
  // Also reset textDone so choices stay hidden until typewriter replays
  // Also reset pickedNext so no choice button stays dimmed across lang switch
  useEffect(() => {
    setTextDone(false);
    setAudioReady(false);
    setPicked(null);
    const interval = setInterval(() => {
      const latest = getAssetState(nodeId);
      setAudioReady(latest.audioReady);
      if (latest.audioReady) clearInterval(interval);
    }, 300);
    return () => clearInterval(interval);
  }, [lang]); // eslint-disable-line

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
      setImgLoaded(false);
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
      setImgLoaded(false);
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
      setImgLoaded(false);
      setFading(false);
    }, 300);
  };

  const handleLangSwitch = (newLang) => {
    if (newLang !== lang) {
      trackLanguageSwitched(lang, newLang, `story:${story.id}`);
    }
  };

  // ââ Status line âââââââââââââââââââââââââââââââââââââââââââââââ
  // Shows at top of card only when an asset is still loading.
  // Image takes priority in the message; disappears when both ready.
  const hasImage = !!node.image;
  // Audio exists by path convention â no field on node, so check audioReady
  // from preloader which marks ready=true if file is missing (graceful degrade)
  const hasAudio = !node.isEnding; // all non-ending nodes may have audio
  const showImageLoading = hasImage && !imageReady;
  const showAudioLoading = hasAudio && !audioReady && !showImageLoading;
  const showStatusLine   = (showImageLoading || showAudioLoading) && !node.isEnding;

  const statusText = showImageLoading
    ? (lang === 'hi' ? 'à¤à¤¹à¤¾à¤¨à¥ à¤à¤¾ à¤à¤¿à¤¤à¥à¤° à¤²à¥à¤¡ à¤¹à¥ à¤°à¤¹à¤¾ à¤¹à¥...' : 'Loading story visual...')
    : (lang === 'hi' ? 'à¤à¤¡à¤¿à¤¯à¥ à¤²à¥à¤¡ à¤¹à¥ à¤°à¤¹à¤¾ à¤¹à¥...'          : 'Loading audio...');

  const steps   = story.progressSteps || [];
  const navBack = lang === 'hi' ? 'â à¤µà¤¾à¤ªà¤¸'         : 'â back';
  const navRst  = lang === 'hi' ? 'à¤«à¤¿à¤° à¤¸à¥ âº'       : 'restart âº';
  const navHome = lang === 'hi' ? 'â à¤¸à¤­à¥ à¤à¤¹à¤¾à¤¨à¤¿à¤¯à¤¾à¤' : 'â All Stories';
  const yourChoice = lang === 'hi' ? 'â¦ à¤à¤ªà¤à¤¾ à¤à¥à¤¨à¤¾à¤µ' : 'â¦ YOUR CHOICE';
  const altLabel   = lang === 'hi' ? 'âª à¤µà¥à¤à¤²à¥à¤ªà¤¿à¤ à¤ªà¤¥' : 'âª alt path';

  // When Hindi is active, override mono font to Noto Sans Devanagari
  // so UI chrome text renders correctly â Space Mono has no Devanagari glyphs
  const monoFont = lang === 'hi'
    ? "'Noto Sans Devanagari', sans-serif"
    : 'var(--mono)';

  // letterSpacing breaks Devanagari conjuncts â always 'normal' for Hindi
  const monoSpacing = lang === 'hi' ? 'normal' : undefined;

  // scene.label is now a bilingual object
  const sceneLabel = typeof scene.label === 'object' ? scene.label[lang] : scene.label;

  return (
    <div style={{ minHeight:'100vh', background:bg, display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 16px 48px', transition:'background 1.2s ease' }}>

      {/* ââ Header ââ */}
      <div style={{ width:'100%', maxWidth:660, marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>

          <div>
            <button onClick={() => navigate('/')}
              style={{ background:'none', border:'none', color:'#ffffff', fontFamily:monoFont, fontSize:'0.78rem', letterSpacing:monoSpacing, marginBottom:10, padding:'4px 0', transition:'color 0.2s', textShadow:'0 1px 8px rgba(0,0,0,0.9)', fontWeight:700 }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = '#ffffff'}>
              {navHome}
            </button>
            <div style={{ fontFamily:monoFont, fontSize:'0.68rem', color:accent, letterSpacing:monoSpacing || '0.18em', marginBottom:5 }}>
              {lang === 'hi' ? 'â¦ à¤ªà¤à¥à¤à¤¤à¤¨à¥à¤¤à¥à¤° â¦' : 'â¦ PANCHATANTRA â¦'}
            </div>
            <h1 style={{ color:'#ffffff', fontSize:'1.6rem', fontFamily:'var(--serif)', fontWeight:700, textShadow:`0 2px 24px ${accent}66` }}>
              {t(story.title, lang)}
            </h1>
            <div style={{ fontFamily:monoFont, fontSize:'0.7rem', color:'rgba(255,255,255,0.75)', marginTop:5, textShadow:'0 1px 6px rgba(0,0,0,0.8)' }}>
              {sceneLabel}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, marginTop:4 }}>
            <LangToggle accent={accent} onChange={handleLangSwitch} />
            {/* Audio button â fixed top right, always visible on all nodes */}
            <AudioButton
              storyId={story.id}
              nodeId={nodeId}
              lang={lang}
              accent={accent}
              audioReady={audioReady}
              audioActive={audioActive}
              setAudioActive={setAudioActive}
            />
            {node.isAlternate && (
              <div style={{ padding:'4px 10px', borderRadius:20, background:'rgba(239,68,68,0.2)', border:'1px solid rgba(239,68,68,0.5)', color:'#ffb3b3', fontFamily:monoFont, fontSize:'0.62rem', whiteSpace:'nowrap' }}>
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

      {/* ââ Card ââ */}
      <div style={{ width:'100%', maxWidth:660, background:'rgba(8,6,10,0.96)', border:`1px solid ${accent}55`, borderRadius:24, overflow:'hidden', boxShadow:`0 0 80px rgba(0,0,0,0.9), 0 0 40px ${accent}18`, opacity:fading?0:1, transform:fading?'translateY(10px)':'translateY(0)', transition:'opacity 0.35s ease, transform 0.35s ease' }}>
        <div style={{ height:3, background:`linear-gradient(90deg,transparent,${accent},transparent)` }} />

        {/* ââ Story image ââ */}
        {node.image && (
          <div style={{ position:'relative', overflow:'hidden', background:'rgba(0,0,0,0.4)', minHeight: imgLoaded ? 0 : 0 }}>
            {/* Placeholder shown while image loads */}
            {!imgLoaded && (
              <div style={{ width:'100%', height:220, background:`linear-gradient(135deg,${accent}11,rgba(0,0,0,0.3))`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', border:`2px solid ${accent}44`, borderTopColor:accent, animation:'spin 0.8s linear infinite' }} />
              </div>
            )}
            <img
              key={node.image}
              src={node.image}
              alt=""
              style={{
                width: '100%',
                maxHeight: 320,
                objectFit: 'cover',
                display: 'block',
                opacity: imgLoaded && !fading ? 1 : 0,
                transition: 'opacity 0.5s ease',
                position: imgLoaded ? 'relative' : 'absolute',
                top: 0, left: 0,
              }}
              onLoad={() => setImgLoaded(true)}
              onError={e => { e.currentTarget.style.display = 'none'; setImgLoaded(true); }}
            />
            {/* Gradient fade into card */}
            {imgLoaded && (
              <div style={{ position:'absolute', bottom:0, left:0, right:0, height:80, background:'linear-gradient(to bottom, transparent, rgba(8,6,10,0.96))' }} />
            )}
          </div>
        )}

        <div style={{ padding:'32px 34px' }}>

          {/* ââ Status line ââ */}
          {/* Single combined line at top of card. Appears only while  */}
          {/* image or audio is still loading. Disappears once ready.  */}
          {showStatusLine && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20,
              padding: '8px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <span style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: '50%',
                border: `2px solid ${accent}44`,
                borderTopColor: accent,
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: monoFont,
                fontSize: '0.68rem',
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: monoSpacing || '0.06em',
              }}>
                {statusText}
              </span>
            </div>
          )}

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
                    <div style={{ fontFamily:monoFont, fontSize:'0.68rem', color:accent, letterSpacing:monoSpacing || '0.14em', marginBottom:8, fontWeight:700 }}>
                      {yourChoice}
                    </div>
                    {/* Render question with Direction D fork styling.
                        Lines starting with '...' are rendered dimmed as pause markers.
                        Lines starting with '... Or' get accent colour as the pivot.  */}
                    <div style={{ fontFamily:'var(--serif)', fontSize:'1.05rem', color:'#fff7d6', lineHeight:1.9, fontWeight:600 }}>
                      {t(node.question, lang).split('\n').filter(l => l.trim()).map((line, i) => {
                        const isOr  = line.trim().startsWith('... Or') || line.trim().startsWith('... à¤¯à¤¾');
                        const isPause = line.trim().startsWith('...') && !isOr;
                        return (
                          <div key={i} style={{
                            color:    isOr    ? accent
                                    : isPause ? 'rgba(255,255,255,0.3)'
                                    :           '#fff7d6',
                            fontSize: isPause ? '0.85rem' : '1.05rem',
                            marginTop: isPause ? 6 : isOr ? 4 : 0,
                            // Never italicise Devanagari â breaks ligatures
                            fontStyle: isPause && lang !== 'hi' ? 'italic' : 'normal',
                            // letterSpacing breaks Devanagari conjuncts â only apply for EN
                            letterSpacing: isPause && lang !== 'hi' ? '0.12em' : 'normal',
                          }}>
                            {line}
                          </div>
                        );
                      })}
                    </div>
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

        {/* ââ Footer ââ */}
        <div style={{ padding:'14px 34px', borderTop:'1px solid rgba(255,255,255,0.15)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,0.3)' }}>
          <button onClick={back} disabled={!history.length}
            style={{ background:'none', border:'none', padding:0, fontSize:'0.78rem', fontFamily:monoFont, transition:'color 0.2s', color:history.length?'#ffffff':'rgba(255,255,255,0.25)', cursor:history.length?'pointer':'default', fontWeight:history.length?600:400 }}
            onMouseEnter={e => history.length && (e.currentTarget.style.color = accent)}
            onMouseLeave={e => (e.currentTarget.style.color = history.length?'#ffffff':'rgba(255,255,255,0.25)')}>
            {navBack}
          </button>
          <span style={{ fontFamily:monoFont, fontSize:'0.65rem', color:'rgba(255,255,255,0.55)', letterSpacing:monoSpacing || '0.08em', textAlign:'center' }}>
            {t(story.theme, lang)}
          </span>
          <button onClick={restart}
            style={{ background:'none', border:'none', padding:0, fontSize:'0.78rem', fontFamily:monoFont, color:'#ffffff', transition:'color 0.2s', fontWeight:600 }}
            onMouseEnter={e => e.currentTarget.style.color = accent}
            onMouseLeave={e => e.currentTarget.style.color = '#ffffff'}>
            {navRst}
          </button>
        </div>
      </div>

      <div style={{ marginTop:28, fontFamily:monoFont, fontSize:'0.65rem', color:'rgba(255,255,255,0.5)', letterSpacing:monoSpacing || '0.18em', textShadow:'0 1px 6px rgba(0,0,0,0.8)', textAlign:'center' }}>
        {lang === 'hi' ? 'â¦ à¤ªà¤à¥à¤à¤¤à¤¨à¥à¤¤à¥à¤° â¦ à¤¨à¥à¤¤à¤¿à¤¶à¤¾à¤¸à¥à¤¤à¥à¤° â¦' : 'â¦ PANCHATANTRA â¦ NITISHASTRA â¦'}
      </div>
    </div>
  );
}
