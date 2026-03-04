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
      <p style={{
        whiteSpace: 'pre-line',
        lineHeight: 2,
        fontFamily: 'var(--serif)',
        fontSize: '1.08rem',
        color: '#f5ede0',       /* bright warm white — was dim grey */
        margin: 0,
        letterSpacing: '0.01em',
      }}>
        {displayed}
        {!done && (
          <span style={{ color: '#fbbf24', animation: 'blink 1s step-end infinite' }}>▌</span>
        )}
      </p>
      {!done && (
        <button onClick={skip} style={{
          marginTop: 10,
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.45)',  /* brighter skip button */
          fontFamily: 'var(--mono)',
          fontSize: '0.75rem',
          textDecoration: 'underline',
          padding: 0,
          transition: 'color 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = '#fbbf24'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.45)'}
        >
          skip →
        </button>
      )}
    </div>
  );
}
