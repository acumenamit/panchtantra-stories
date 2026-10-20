// ─────────────────────────────────────────────────────────────
// StoryAgent.jsx
// Root component for the internal Story Agent tool.
//
// Responsibilities:
//   1. Language selection — sets the working language for the session
//   2. Track selection — routes to Agent flow or Writer flow
//   3. Session-level navigation — back buttons, new story resets
//
// Route in App.js:
//   import StoryAgent from './pages/StoryAgent/StoryAgent';
//   <Route path="/agent" element={<StoryAgent />} />
//
// The component has no knowledge of story content.
// It only manages which screen is visible and what language is active.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react';
import { PLATFORM_ACCENT, SUPPORTED_LANGUAGES, UI_STRINGS } from './shared/constants';
import { MonospaceLabel } from './shared/StoryAgentComponents';
import AgentFlow from './agent-flow/AgentFlow';
import WriterFlow from './writer-flow/WriterFlow';

// ── Screen 1 — Language selection ────────────────────────────
function LanguageSelectionScreen({ onLanguageSelected }) {
  const [hoveredLanguage, setHoveredLanguage] = useState(null);

  return (
    <div>
      <MonospaceLabel fontSize="0.68rem" marginBottom={6}>
        ✦ LANGUAGE / भाषा
      </MonospaceLabel>
      <h2 style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: '#ffffff', fontSize: '1.4rem', margin: '0 0 6px',
      }}>
        Choose your working language
        <br />
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '1.05rem' }}>
          अपनी कार्य भाषा चुनें
        </span>
      </h2>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem',
        margin: '0 0 28px', lineHeight: 1.6,
      }}>
        All agent output and your review will be in this language.
        <br />
        <span style={{ opacity: 0.7 }}>
          एजेंट का आउटपुट और समीक्षा इसी भाषा में होगी।
        </span>
      </p>

      <div style={{ display: 'flex', gap: 14 }}>
        {SUPPORTED_LANGUAGES.map(language => (
          <button
            key={language.code}
            onClick={() => onLanguageSelected(language.code)}
            onMouseEnter={() => setHoveredLanguage(language.code)}
            onMouseLeave={() => setHoveredLanguage(null)}
            style={{
              flex: 1, padding: '22px 18px', borderRadius: 14, cursor: 'pointer',
              border: `1px solid ${hoveredLanguage === language.code ? PLATFORM_ACCENT : 'rgba(255,255,255,0.15)'}`,
              background: hoveredLanguage === language.code ? `${PLATFORM_ACCENT}14` : 'rgba(255,255,255,0.03)',
              textAlign: 'center', transition: 'all 0.22s',
              transform: hoveredLanguage === language.code ? 'translateY(-2px)' : 'none',
            }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>{language.flag}</div>
            <div style={{
              fontFamily: 'var(--mono, monospace)', fontSize: '0.8rem', fontWeight: 700,
              color: hoveredLanguage === language.code ? PLATFORM_ACCENT : '#ffffff',
              letterSpacing: '0.1em', marginBottom: 3,
            }}>
              {language.label}
            </div>
            <div style={{
              fontFamily: 'var(--serif, Georgia, serif)',
              fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)',
            }}>
              {language.nativeLabel}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Screen 2 — Track selection ────────────────────────────────
function TrackSelectionScreen({ workingLanguage, onTrackSelected }) {
  const strings = UI_STRINGS[workingLanguage];
  const [hoveredTrack, setHoveredTrack] = useState(null);

  const availableTracks = [
    {
      id:          'agent_flow',
      icon:        '🤖',
      title:       strings.agentFlowTitle,
      subtitle:    strings.agentFlowSubtitle,
      isAvailable: true,
    },
    {
      id:          'writer_flow',
      icon:        '✍️',
      title:       strings.writerFlowTitle,
      subtitle:    strings.writerFlowSubtitle,
      badge:       strings.writerFlowComingSoon,
      isAvailable: true, // Stub is accessible, shows coming soon message inside
    },
  ];

  return (
    <div>
      <MonospaceLabel fontSize="0.68rem" marginBottom={6}>
        ✦ {workingLanguage === 'hi' ? 'ट्रैक चुनें' : 'CHOOSE YOUR TRACK'}
      </MonospaceLabel>
      <h2 style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: '#ffffff', fontSize: '1.4rem', margin: '0 0 6px',
      }}>
        {strings.trackSelectionTitle}
      </h2>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem',
        margin: '0 0 26px', lineHeight: 1.6,
      }}>
        {strings.trackSelectionSubtitle}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {availableTracks.map(track => (
          <button
            key={track.id}
            onClick={() => onTrackSelected(track.id)}
            onMouseEnter={() => setHoveredTrack(track.id)}
            onMouseLeave={() => setHoveredTrack(null)}
            style={{
              width: '100%', padding: '20px 22px', borderRadius: 14,
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 18,
              border: `1px solid ${hoveredTrack === track.id ? PLATFORM_ACCENT : 'rgba(255,255,255,0.15)'}`,
              background: hoveredTrack === track.id ? `${PLATFORM_ACCENT}14` : 'rgba(255,255,255,0.04)',
              transition: 'all 0.22s',
              transform: hoveredTrack === track.id ? 'translateX(4px)' : 'none',
            }}>
            <span style={{ fontSize: '2rem', flexShrink: 0 }}>{track.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                <span style={{
                  fontFamily: 'var(--mono, monospace)', fontSize: '0.82rem', fontWeight: 700,
                  color: hoveredTrack === track.id ? PLATFORM_ACCENT : '#ffffff',
                  letterSpacing: '0.06em',
                }}>
                  {track.title}
                </span>
                {track.badge && (
                  <span style={{
                    padding: '2px 8px', borderRadius: 20,
                    fontFamily: 'var(--mono, monospace)', fontSize: '0.58rem',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: 'rgba(255,255,255,0.35)',
                  }}>
                    {track.badge}
                  </span>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--serif, Georgia, serif)',
                fontSize: '0.85rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.4,
              }}>
                {track.subtitle}
              </div>
            </div>
            <span style={{
              color: hoveredTrack === track.id ? PLATFORM_ACCENT : 'rgba(255,255,255,0.2)',
              fontSize: '1.2rem', flexShrink: 0, transition: 'color 0.2s',
            }}>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Active screen identifiers ─────────────────────────────────
const SCREENS = {
  LANGUAGE_SELECTION: 'language_selection',
  TRACK_SELECTION:    'track_selection',
  AGENT_FLOW:         'agent_flow',
  WRITER_FLOW:        'writer_flow',
};

// ── StoryAgent root ───────────────────────────────────────────
export default function StoryAgent() {
  const [activeScreen,    setActiveScreen]    = useState(SCREENS.LANGUAGE_SELECTION);
  const [workingLanguage, setWorkingLanguage] = useState('en');

  const handleLanguageSelected = (languageCode) => {
    setWorkingLanguage(languageCode);
    setActiveScreen(SCREENS.TRACK_SELECTION);
  };

  const handleTrackSelected = (trackId) => {
    setActiveScreen(trackId === 'agent_flow' ? SCREENS.AGENT_FLOW : SCREENS.WRITER_FLOW);
  };

  const handleReturnToTrackSelection = () => {
    setActiveScreen(SCREENS.TRACK_SELECTION);
  };

  const handleReturnToLanguageSelection = () => {
    setActiveScreen(SCREENS.LANGUAGE_SELECTION);
  };

  const strings = UI_STRINGS[workingLanguage];
  const isInsideAFlow = activeScreen === SCREENS.AGENT_FLOW || activeScreen === SCREENS.WRITER_FLOW;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg,#0d0d1f,#06060f)',
      padding: '32px 16px 80px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        * { box-sizing: border-box; }
        :root {
          --serif: 'Georgia', 'Times New Roman', serif;
          --mono:  'Courier New', 'Courier', monospace;
        }
        select option  { background: #0f0c14; color: #f0e6d0; }
        textarea::placeholder, input::placeholder { color: rgba(240,230,208,0.22); }
        :lang(hi) { font-family: 'Noto Sans Devanagari', sans-serif; }
      `}</style>

      {/* Platform header */}
      <div style={{ width: '100%', maxWidth: 660, marginBottom: 26 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', marginBottom: 10,
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: '0.6rem',
              color: PLATFORM_ACCENT, letterSpacing: '0.2em', marginBottom: 4,
            }}>
              ✦ PANCHATANTRA ✦ NITISHASTRA ✦
            </div>
            <h1 style={{
              fontFamily: 'var(--serif)', color: '#ffffff',
              fontSize: '1.7rem', margin: 0, fontWeight: 700,
              textShadow: `0 2px 20px ${PLATFORM_ACCENT}44`,
            }}>
              Story Agent
            </h1>
          </div>

          {/* Session controls — language badge and new story button */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            {activeScreen !== SCREENS.LANGUAGE_SELECTION && (
              <button
                onClick={handleReturnToLanguageSelection}
                title="Change working language"
                style={{
                  padding: '5px 12px', borderRadius: 20,
                  fontFamily: 'var(--mono)', fontSize: '0.63rem', fontWeight: 700,
                  cursor: 'pointer', letterSpacing: '0.08em',
                  border: `1px solid ${PLATFORM_ACCENT}44`,
                  background: `${PLATFORM_ACCENT}0f`, color: `${PLATFORM_ACCENT}99`,
                  transition: 'all 0.2s',
                }}>
                {workingLanguage === 'hi' ? '🇮🇳 हिन्दी' : '🇬🇧 English'}
              </button>
            )}
            {isInsideAFlow && (
              <button
                onClick={handleReturnToTrackSelection}
                style={{
                  padding: '5px 12px', borderRadius: 20,
                  fontFamily: 'var(--mono)', fontSize: '0.63rem',
                  cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'transparent', color: 'rgba(255,255,255,0.38)',
                  transition: 'all 0.2s',
                }}>
                {strings.newStoryButton}
              </button>
            )}
          </div>
        </div>

        {/* Header accent line — matches main platform style */}
        <div style={{ height: 1, background: `linear-gradient(90deg,${PLATFORM_ACCENT}66,transparent)` }} />
      </div>

      {/* Main content card */}
      <div style={{
        width: '100%', maxWidth: 660,
        background: 'rgba(8,6,10,0.97)',
        border: `1px solid ${PLATFORM_ACCENT}28`,
        borderRadius: 24, overflow: 'hidden',
        boxShadow: `0 0 80px rgba(0,0,0,0.9), 0 0 40px ${PLATFORM_ACCENT}0c`,
        animation: 'fadeUp 0.35s ease',
      }}>
        {/* Top accent bar — matches main platform card style */}
        <div style={{ height: 3, background: `linear-gradient(90deg,transparent,${PLATFORM_ACCENT},transparent)` }} />

        <div style={{ padding: '32px 32px' }}>
          {activeScreen === SCREENS.LANGUAGE_SELECTION && (
            <LanguageSelectionScreen onLanguageSelected={handleLanguageSelected} />
          )}

          {activeScreen === SCREENS.TRACK_SELECTION && (
            <TrackSelectionScreen
              workingLanguage={workingLanguage}
              onTrackSelected={handleTrackSelected}
            />
          )}

          {activeScreen === SCREENS.AGENT_FLOW && (
            <AgentFlow
              workingLanguage={workingLanguage}
              onReturnToTrackSelection={handleReturnToTrackSelection}
            />
          )}

          {activeScreen === SCREENS.WRITER_FLOW && (
            <WriterFlow
              workingLanguage={workingLanguage}
              onReturnToTrackSelection={handleReturnToTrackSelection}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 22,
        fontFamily: 'var(--mono)', fontSize: '0.6rem',
        color: 'rgba(255,255,255,0.2)', letterSpacing: '0.14em',
        textAlign: 'center',
      }}>
        {strings.internalToolLabel}
      </div>
    </div>
  );
}
