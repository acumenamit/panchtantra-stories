import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Typewriter from '../components/Typewriter';
import ChoiceButton from '../components/ChoiceButton';
import EndingCard from '../components/EndingCard';
import SCENES from '../scenes';

export default function StoryEngine({ story }) {
  const navigate = useNavigate();
  const [nodeId,    setNodeId]    = useState('start');
  const [textDone,  setTextDone]  = useState(false);
  const [history,   setHistory]   = useState([]);
  const [fading,    setFading]    = useState(false);
  const [pickedNext, setPicked]   = useState(null);

  const node  = story.nodes[nodeId];
  const scene = SCENES[node.scene] || SCENES.forest_day;
  const { accent, bg } = scene;

  const go = (nextId) => {
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
    setFading(true);
    setTimeout(() => {
      setNodeId('start');
      setHistory([]);
      setTextDone(false);
      setFading(false);
    }, 300);
  };

  const steps = story.progressSteps || [];

  return (
    <div style={{
      minHeight: '100vh',
      background: bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 16px 48px',
      transition: 'background 1.2s ease',
    }}>

      {/* Header */}
      <div style={{ width: '100%', maxWidth: 660, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <button onClick={() => navigate('/')}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--mono)', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: 10, padding: 0, transition: 'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color = accent}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}>
              ← All Stories
            </button>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: accent, letterSpacing: '0.18em', marginBottom: 5 }}>
              ✦ PANCHATANTRA ✦
            </div>
            <h1 style={{ color: '#ffffff', fontSize: '1.6rem', fontFamily: 'var(--serif)', fontWeight: 700, textShadow: `0 2px 24px ${accent}66` }}>
              {story.title}
            </h1>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'rgba(255,255,255,0.5)', marginTop: 5 }}>
              {scene.label}
            </div>
          </div>
          {node.isAlternate && (
            <div style={{ padding: '5px 12px', borderRadius: 20, background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.5)', color: '#ffb3b3', fontFamily: 'var(--mono)', fontSize: '0.65rem', whiteSpace: 'nowrap', marginTop: 32 }}>
              alt path
            </div>
          )}
        </div>

        {/* Progress — thicker + glowing */}
        <div style={{ display: 'flex', gap: 5 }}>
          {steps.map(s => (
            <div key={s} style={{
              height: 5,
              flex: 1,
              borderRadius: 4,
              background: history.includes(s) || nodeId === s ? accent : 'rgba(255,255,255,0.18)',
              transition: 'background 0.5s',
              boxShadow: history.includes(s) || nodeId === s ? `0 0 8px ${accent}88` : 'none',
            }} />
          ))}
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 660,
        background: 'rgba(8,6,10,0.96)',
        border: `1px solid ${accent}55`,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: `0 0 80px rgba(0,0,0,0.9), 0 0 40px ${accent}18`,
        opacity: fading ? 0 : 1,
        transform: fading ? 'translateY(10px)' : 'translateY(0)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}>
        <div style={{ height: 3, background: `linear-gradient(90deg,transparent,${accent},transparent)` }} />

        <div style={{ padding: '32px 34px' }}>
          {node.isEnding ? (
            <EndingCard node={node} accent={accent} onRestart={restart} onHome={() => navigate('/')} />
          ) : (
            <>
              <Typewriter key={nodeId} text={node.text} onDone={() => setTextDone(true)} />

              {textDone && (
                <div className="fade-up">
                  {/* Question box */}
                  <div style={{
                    marginTop: 28,
                    marginBottom: 20,
                    padding: '16px 20px',
                    borderRadius: 14,
                    background: `${accent}1e`,
                    border: `1px solid ${accent}55`,
                    borderLeft: `4px solid ${accent}`,
                  }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: accent, letterSpacing: '0.14em', marginBottom: 8, fontWeight: 700 }}>
                      ✦ YOUR CHOICE
                    </div>
                    <p style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.05rem', color: '#fff7d6', lineHeight: 1.7, fontWeight: 600 }}>
                      {node.question}
                    </p>
                  </div>

                  {node.choices.map((c, i) => (
                    <ChoiceButton
                      key={i}
                      choice={c}
                      index={i}
                      accent={accent}
                      onClick={ch => go(ch.next)}
                      dimmed={!!pickedNext && pickedNext !== c.next}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 34px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={back} disabled={!history.length}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.75rem', transition: 'color 0.2s', color: history.length ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)', cursor: history.length ? 'pointer' : 'default' }}
            onMouseEnter={e => history.length && (e.currentTarget.style.color = accent)}
            onMouseLeave={e => (e.currentTarget.style.color = history.length ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)')}>
            ← back
          </button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
            {story.theme}
          </span>
          <button onClick={restart}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', transition: 'color 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.color = accent}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}>
            restart ↺
          </button>
        </div>
      </div>

      <div style={{ marginTop: 28, fontFamily: 'var(--mono)', fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em' }}>
        ✦ &nbsp; PANCHATANTRA &nbsp; ✦ &nbsp; NITISHASTRA &nbsp; ✦
      </div>
    </div>
  );
}
