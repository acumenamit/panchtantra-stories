// ─────────────────────────────────────────────────────────────
// WriterFlow.jsx
// The self-authored story creation flow.
//
// Current state: Architectural stub.
// The routing, state shape, and shared component connections
// are all wired correctly. When this flow is built, the work is:
//   1. Build StoryMetadataForm (title, book, age, theme, emoji, colour)
//   2. Build NodeEditor (add/edit/reorder nodes with live validation)
//   3. Wire completed story into StoryReviewPanel (already shared)
//   4. The rest of the pipeline (Hindi generation, JS build) is identical
//
// Integration point with the Agent flow:
//   Both flows produce the same story object shape before
//   entering StoryReviewPanel. The downstream pipeline
//   (second language generation, JS file building, GitHub push)
//   does not know or care which flow produced the story.
// ─────────────────────────────────────────────────────────────

import { PLATFORM_ACCENT, UI_STRINGS } from '../shared/constants';
import { MonospaceLabel } from '../shared/StoryAgentComponents';

export default function WriterFlow({ workingLanguage, onReturnToTrackSelection }) {
  const strings = UI_STRINGS[workingLanguage];

  return (
    <div>
      {/* Back navigation */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={onReturnToTrackSelection} style={{
          background: 'none', border: 'none', padding: 0,
          fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem',
          color: 'rgba(255,255,255,0.38)', cursor: 'pointer', letterSpacing: '0.08em',
        }}>
          {strings.backButton}
        </button>
      </div>

      <MonospaceLabel fontSize="0.68rem" marginBottom={6}>
        ✦ {strings.writerFlowTitle.toUpperCase()}
      </MonospaceLabel>
      <h2 style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: '#ffffff', fontSize: '1.4rem', margin: '0 0 6px',
      }}>
        {strings.writerFlowTitle2}
      </h2>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.38)', fontSize: '0.88rem',
        margin: '0 0 28px', lineHeight: 1.6,
      }}>
        {strings.writerFlowDescription}
      </p>

      {/* Coming soon card */}
      <div style={{
        padding: '36px 26px', borderRadius: 16, textAlign: 'center',
        border: `1px dashed ${PLATFORM_ACCENT}33`,
        background: `${PLATFORM_ACCENT}06`,
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✍️</div>

        <MonospaceLabel fontSize="0.68rem" marginBottom={12}>
          {strings.comingSoonLabel}
        </MonospaceLabel>

        <p style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem',
          lineHeight: 1.75, margin: '0 0 24px',
          maxWidth: 360, marginLeft: 'auto', marginRight: 'auto',
        }}>
          {strings.writerFlowComingMessage}
        </p>

        {/* What will be built here */}
        <div style={{
          padding: '16px 20px', borderRadius: 12, textAlign: 'left',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          maxWidth: 400, margin: '0 auto 22px',
        }}>
          <MonospaceLabel
            color="rgba(255,255,255,0.28)"
            fontSize="0.6rem"
            marginBottom={10}>
            {strings.writerFlowWillInclude}
          </MonospaceLabel>
          {[
            strings.writerFlowFeature1,
            strings.writerFlowFeature2,
            strings.writerFlowFeature3,
            strings.writerFlowFeature4,
          ].map((feature, index) => (
            <div key={index} style={{
              fontFamily: 'var(--serif, Georgia, serif)',
              fontSize: '0.82rem', color: 'rgba(255,255,255,0.32)',
              marginBottom: 6, paddingLeft: 12,
              borderLeft: `2px solid ${PLATFORM_ACCENT}22`,
            }}>
              {feature}
            </div>
          ))}
        </div>

        {/* Redirect to agent flow */}
        <p style={{
          fontFamily: 'var(--mono, monospace)', fontSize: '0.63rem',
          color: 'rgba(255,255,255,0.22)', letterSpacing: '0.08em',
          marginBottom: 12,
        }}>
          {strings.writerFlowUseAgentPrompt}
        </p>
        <button onClick={onReturnToTrackSelection} style={{
          padding: '8px 18px', borderRadius: 9,
          fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
          cursor: 'pointer',
          border: `1px solid ${PLATFORM_ACCENT}44`,
          background: `${PLATFORM_ACCENT}0d`,
          color: `${PLATFORM_ACCENT}88`,
          transition: 'all 0.2s',
        }}>
          {strings.chooseTrackButton}
        </button>
      </div>
    </div>
  );
}
