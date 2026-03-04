import { useState, useEffect, useRef } from 'react';

export default function Typewriter({ text, onDone, speed = 16 }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const idx   = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    setDone(false);
    timer.current = setInterval(() => {
      idx.current++;
      if (idx.current >= text.length) {
        clearInterval(timer.current);
        setDisplayed(text);
        setDone(true);
        onDone?.();
      } else {
        setDisplayed(text.slice(0, idx.current));
      }
    }, speed);
    return () => clearInterval(timer.current);
  }, [text]); // eslint-disable-line

  const skip = () => {
    clearInterval(timer.current);
    setDisplayed(text);
    setDone(true);
    onDone?.();
  };

  return (
    <div>
      <p style={{ whiteSpace:'pre-line', lineHeight:1.9, fontFamily:'var(--serif)', fontSize:'1.05rem', color:'#f0e6d0', margin:0 }}>
        {displayed}
        {!done && <span style={{ color:'#fbbf24', animation:'blink 1s step-end infinite' }}>▌</span>}
      </p>
      {!done && (
        <button onClick={skip} style={{ marginTop:8, background:'none', border:'none', color:'#a8895a', fontFamily:'var(--mono)', fontSize:'0.72rem', textDecoration:'underline', padding:0 }}>
          skip →
        </button>
      )}
    </div>
  );
}
