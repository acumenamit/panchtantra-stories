// ─────────────────────────────────────────────────────────────
// StoryAgentComponents.jsx
// Shared UI components used across the Agent flow and Writer flow.
// All components match the main platform's visual style exactly:
//   - Dark backgrounds (rgba(8,6,10,...))
//   - var(--serif) for story text
//   - var(--mono) for labels and code
//   - PLATFORM_ACCENT (#fbbf24) for highlights
// ─────────────────────────────────────────────────────────────

import { useState } from 'react';
import { PLATFORM_ACCENT, SCENES, UI_STRINGS } from './constants';
import { validateStoryStructure, getNodeType, getStoryComposition } from './storyValidator';

// ── Spinner — matches StoryEngine loading spinner ─────────────
export function LoadingSpinner({ size = 20, accent = PLATFORM_ACCENT }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${accent}44`, borderTopColor: accent,
      animation: 'spin 0.8s linear infinite', flexShrink: 0,
    }} />
  );
}

// ── Monospace label — matches StoryEngine scene label style ───
export function MonospaceLabel({ children, color = PLATFORM_ACCENT, fontSize = '0.65rem', marginBottom = 0 }) {
  return (
    <div style={{
      fontFamily: 'var(--mono, monospace)',
      fontSize, color,
      letterSpacing: '0.14em',
      fontWeight: 700,
      marginBottom,
    }}>
      {children}
    </div>
  );
}

// ── Primary action button ─────────────────────────────────────
export function PrimaryButton({ children, onClick, disabled, isLoading, accent = PLATFORM_ACCENT, style = {} }) {
  const isInactive = disabled || isLoading;
  return (
    <button
      onClick={onClick}
      disabled={isInactive}
      style={{
        padding: '12px 22px', borderRadius: 10,
        cursor: isInactive ? 'default' : 'pointer',
        fontFamily: 'var(--mono, monospace)',
        fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
        border: `1px solid ${isInactive ? accent + '33' : accent}`,
        background: isInactive ? 'transparent' : `${accent}22`,
        color: isInactive ? accent + '55' : accent,
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 10,
        transition: 'all 0.2s', ...style,
      }}>
      {isLoading && <LoadingSpinner size={15} accent={accent} />}
      {children}
    </button>
  );
}

// ── Secondary (ghost) button ──────────────────────────────────
export function SecondaryButton({ children, onClick, disabled, style = {} }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 18px', borderRadius: 10,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--mono, monospace)',
        fontSize: '0.72rem', fontWeight: 700,
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'transparent',
        color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.45)',
        transition: 'all 0.2s', ...style,
      }}>
      {children}
    </button>
  );
}

// ── Text input with platform styling ─────────────────────────
export function StyledTextInput({ value, onChange, placeholder, onKeyDown, autoFocus }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      style={{
        width: '100%', padding: '12px 15px', borderRadius: 10,
        border: `1px solid ${value ? PLATFORM_ACCENT + '66' : 'rgba(255,255,255,0.12)'}`,
        background: 'rgba(255,255,255,0.04)',
        fontFamily: 'var(--serif, Georgia, serif)',
        fontSize: '1rem', color: '#f0e6d0',
        outline: 'none', boxSizing: 'border-box',
        transition: 'border-color 0.2s',
      }}
      onFocus={e => e.target.style.borderColor = PLATFORM_ACCENT}
      onBlur={e => e.target.style.borderColor = value ? PLATFORM_ACCENT + '66' : 'rgba(255,255,255,0.12)'}
    />
  );
}

// ── Textarea with platform styling ────────────────────────────
export function StyledTextarea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 9,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.04)',
        fontFamily: 'var(--serif, Georgia, serif)',
        fontSize: '0.9rem', color: '#f0e6d0', lineHeight: 1.6,
        resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        transition: 'border-color 0.2s',
      }}
      onFocus={e => e.target.style.borderColor = PLATFORM_ACCENT}
      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
    />
  );
}

// ── Structural validation error display ───────────────────────
export function StructuralValidationErrors({ errors, workingLanguage }) {
  if (!errors || errors.length === 0) return null;
  const strings = UI_STRINGS[workingLanguage];
  return (
    <div style={{
      padding: '12px 16px', borderRadius: 10, marginBottom: 12,
      background: 'rgba(248,113,113,0.1)',
      border: '1px solid rgba(248,113,113,0.3)',
    }}>
      <MonospaceLabel color="#f87171" fontSize="0.63rem" marginBottom={6}>
        {strings.structuralIssuesLabel}
      </MonospaceLabel>
      {errors.map((error, index) => (
        <div key={index} style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          fontSize: '0.85rem', color: '#ffb3b3', marginBottom: 2,
        }}>
          • {error}
        </div>
      ))}
    </div>
  );
}

// ── Story node card ───────────────────────────────────────────
// Renders one node in the review panel. Matches the visual
// language of the main platform's story cards.
export function StoryNodeCard({ nodeId, node, workingLanguage, reviewState, onApprove, onFlag, onEdit }) {
  const strings    = UI_STRINGS[workingLanguage];
  const sceneStyle = SCENES[node.scene] || SCENES.village;
  const nodeAccent = sceneStyle.accent || PLATFORM_ACCENT;
  const nodeType   = getNodeType(node);
  const isApproved = reviewState === 'approved';
  const isFlagged  = reviewState === 'flagged';

  const nodeTypeLabel = {
    ending:    strings.nodeTypeEnding,
    fork:      strings.nodeTypeFork,
    alternate: strings.nodeTypeAlternate,
    single:    strings.nodeTypeSingle,
  }[nodeType];

  const nodeTypeBgColor = {
    ending:    'rgba(251,191,36,0.15)',
    fork:      'rgba(129,140,248,0.15)',
    alternate: 'rgba(248,113,113,0.1)',
    single:    'rgba(74,222,128,0.1)',
  }[nodeType];

  const nodeTypeTextColor = {
    ending:    '#fbbf24',
    fork:      '#818cf8',
    alternate: '#f87171',
    single:    '#4ade80',
  }[nodeType];

  // Extract text in the working language
  const getLocalizedText = (field) =>
    typeof field === 'object' ? field[workingLanguage] || '' : field || '';

  return (
    <div style={{
      background: 'rgba(8,6,10,0.96)',
      border: `1px solid ${isApproved ? '#4ade8055' : isFlagged ? '#f8717155' : nodeAccent + '44'}`,
      borderRadius: 16, overflow: 'hidden', marginBottom: 14,
      boxShadow: isApproved
        ? '0 0 18px rgba(74,222,128,0.1)'
        : isFlagged ? '0 0 18px rgba(248,113,113,0.1)'
        : '0 0 16px rgba(0,0,0,0.4)',
      transition: 'all 0.3s ease',
    }}>
      {/* Accent line at top — matches main platform card style */}
      <div style={{ height: 2, background: `linear-gradient(90deg,transparent,${nodeAccent},transparent)` }} />

      {/* Node header */}
      <div style={{
        padding: '10px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <code style={{
            fontFamily: 'var(--mono, monospace)',
            fontSize: '0.7rem', color: nodeAccent,
          }}>
            {nodeId}
          </code>
          <span style={{
            padding: '2px 8px', borderRadius: 8,
            fontFamily: 'var(--mono, monospace)',
            fontSize: '0.6rem', fontWeight: 700,
            background: nodeTypeBgColor, color: nodeTypeTextColor,
            letterSpacing: '0.08em',
          }}>
            {nodeTypeLabel}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isApproved && (
            <span style={{ fontSize: '0.62rem', color: '#4ade80', fontFamily: 'var(--mono, monospace)' }}>
              {strings.nodeApprovedLabel}
            </span>
          )}
          {isFlagged && (
            <span style={{ fontSize: '0.62rem', color: '#f87171', fontFamily: 'var(--mono, monospace)' }}>
              {strings.nodeFlaggedLabel}
            </span>
          )}
        </div>
      </div>

      {/* Story text */}
      <div style={{ padding: '18px 18px 0' }}>
        <p style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          fontSize: '0.93rem', lineHeight: 1.8,
          color: '#f0e6d0', margin: 0, whiteSpace: 'pre-line',
        }}>
          {getLocalizedText(node.text)}
        </p>
      </div>

      {/* Question — styled like the YOUR CHOICE box in StoryEngine */}
      {node.question && (
        <div style={{
          margin: '14px 18px 0', padding: '10px 14px', borderRadius: 10,
          background: `${nodeAccent}18`,
          border: `1px solid ${nodeAccent}44`,
          borderLeft: `3px solid ${nodeAccent}`,
        }}>
          <MonospaceLabel color={nodeAccent} fontSize="0.6rem" marginBottom={4}>
            ✦ {strings.questionField.toUpperCase()}
          </MonospaceLabel>
          <div style={{
            fontFamily: 'var(--serif, Georgia, serif)',
            fontSize: '0.92rem', color: '#fff7d6', lineHeight: 1.6,
          }}>
            {getLocalizedText(node.question)}
          </div>
        </div>
      )}

      {/* Choices */}
      {node.choices && (
        <div style={{ padding: '10px 18px 0' }}>
          {node.choices.map((choice, index) => (
            <div key={index} style={{
              padding: '9px 12px', borderRadius: 9, marginBottom: 7,
              border: '1px solid rgba(255,255,255,0.13)',
              background: 'rgba(255,255,255,0.03)',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <code style={{
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.6rem', color: nodeAccent,
                whiteSpace: 'nowrap', marginTop: 2, fontWeight: 700,
              }}>
                → {choice.next}
              </code>
              <span style={{
                fontFamily: 'var(--serif, Georgia, serif)',
                fontSize: '0.88rem', color: '#ffffff', lineHeight: 1.4,
              }}>
                {getLocalizedText(choice.text)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Lesson — ending nodes only */}
      {node.lesson && (
        <div style={{
          margin: '14px 18px 0', padding: '10px 14px', borderRadius: 10,
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.25)',
        }}>
          <MonospaceLabel color="#fbbf24" fontSize="0.6rem" marginBottom={4}>
            {node.lessonIcon} {strings.lessonField.toUpperCase()}
          </MonospaceLabel>
          <div style={{
            fontFamily: 'var(--serif, Georgia, serif)',
            fontSize: '0.88rem', color: '#fff7d6', lineHeight: 1.6,
          }}>
            {getLocalizedText(node.lesson)}
          </div>
        </div>
      )}

      {/* Review actions */}
      <div style={{
        padding: '14px 18px',
        display: 'flex', gap: 8, flexWrap: 'wrap',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        marginTop: 14,
      }}>
        <button onClick={() => onApprove(nodeId)} style={{
          padding: '6px 14px', borderRadius: 7,
          fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
          cursor: 'pointer', transition: 'all 0.2s',
          border: `1px solid ${isApproved ? '#4ade80' : 'rgba(74,222,128,0.35)'}`,
          background: isApproved ? 'rgba(74,222,128,0.18)' : 'transparent',
          color: '#4ade80',
        }}>
          {isApproved ? strings.nodeApprovedLabel : strings.approveNodeButton}
        </button>
        <button onClick={() => onFlag(nodeId)} style={{
          padding: '6px 14px', borderRadius: 7,
          fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
          cursor: 'pointer', transition: 'all 0.2s',
          border: `1px solid ${isFlagged ? '#f87171' : 'rgba(248,113,113,0.35)'}`,
          background: isFlagged ? 'rgba(248,113,113,0.15)' : 'transparent',
          color: '#f87171',
        }}>
          {isFlagged ? strings.nodeFlaggedLabel : strings.flagNodeButton}
        </button>
        <button onClick={() => onEdit(nodeId)} style={{
          padding: '6px 14px', borderRadius: 7,
          fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
          cursor: 'pointer', transition: 'all 0.2s',
          border: '1px solid rgba(255,255,255,0.13)',
          background: 'transparent', color: 'rgba(255,255,255,0.45)',
        }}>
          {strings.editNodeButton}
        </button>
      </div>
    </div>
  );
}

// ── Node flag modal ───────────────────────────────────────────
export function NodeFlagModal({ nodeId, workingLanguage, onFlagSubmitted, onCancel }) {
  const strings       = UI_STRINGS[workingLanguage];
  const [note, setNote]   = useState('');
  const [scope, setScope] = useState('node');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 20,
    }}>
      <div style={{
        background: '#0f0c14',
        border: `1px solid ${PLATFORM_ACCENT}44`,
        borderRadius: 20, padding: 28,
        width: '100%', maxWidth: 480,
        boxShadow: '0 0 60px rgba(0,0,0,0.95)',
      }}>
        <MonospaceLabel color="#f87171" fontSize="0.68rem" marginBottom={6}>
          ⚑ {strings.flagModalTitle.toUpperCase()}
        </MonospaceLabel>
        <h3 style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          color: '#ffffff', fontSize: '1.05rem', margin: '0 0 20px',
        }}>
          <code style={{ color: PLATFORM_ACCENT }}>{nodeId}</code>
        </h3>

        {/* Scope selector */}
        <div style={{ marginBottom: 16 }}>
          <MonospaceLabel color="rgba(255,255,255,0.38)" fontSize="0.62rem" marginBottom={8}>
            {strings.flagScopeLabel.toUpperCase()}
          </MonospaceLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: 'node', label: strings.flagThisNodeOption },
              { value: 'full', label: strings.flagFullStoryOption },
            ].map(option => (
              <button key={option.value} onClick={() => setScope(option.value)} style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
                border: `1px solid ${scope === option.value ? PLATFORM_ACCENT : 'rgba(255,255,255,0.15)'}`,
                background: scope === option.value ? `${PLATFORM_ACCENT}22` : 'transparent',
                color: scope === option.value ? PLATFORM_ACCENT : 'rgba(255,255,255,0.4)',
                transition: 'all 0.2s',
              }}>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feedback note */}
        <div style={{ marginBottom: 20 }}>
          <MonospaceLabel color="rgba(255,255,255,0.38)" fontSize="0.62rem" marginBottom={8}>
            {strings.flagNoteLabel.toUpperCase()}
          </MonospaceLabel>
          <StyledTextarea
            value={note}
            onChange={setNote}
            placeholder={strings.flagNotePlaceholder}
            rows={4}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={onCancel}>{strings.cancelButton}</SecondaryButton>
          <button
            onClick={() => note.trim() && onFlagSubmitted(nodeId, note, scope)}
            disabled={!note.trim()}
            style={{
              padding: '8px 18px', borderRadius: 8, cursor: note.trim() ? 'pointer' : 'default',
              fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', fontWeight: 700,
              border: `1px solid ${note.trim() ? '#f87171' : 'rgba(248,113,113,0.2)'}`,
              background: note.trim() ? 'rgba(248,113,113,0.2)' : 'transparent',
              color: note.trim() ? '#f87171' : 'rgba(248,113,113,0.3)',
              transition: 'all 0.2s',
            }}>
            {strings.flagSubmitButton}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Node edit modal ───────────────────────────────────────────
export function NodeEditModal({ nodeId, node, workingLanguage, onEditSaved, onCancel }) {
  const strings = UI_STRINGS[workingLanguage];

  const getLocalizedText = (field) =>
    typeof field === 'object' ? field[workingLanguage] || '' : field || '';

  const [storyText, setStoryText]   = useState(getLocalizedText(node.text));
  const [questionText, setQuestion] = useState(getLocalizedText(node.question));
  const [lessonText, setLesson]     = useState(getLocalizedText(node.lesson));

  const handleSave = () => {
    onEditSaved(nodeId, {
      storyText,
      questionText,
      lessonText,
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 20, overflowY: 'auto',
    }}>
      <div style={{
        background: '#0f0c14',
        border: `1px solid ${PLATFORM_ACCENT}44`,
        borderRadius: 20, padding: 28,
        width: '100%', maxWidth: 580,
        boxShadow: '0 0 60px rgba(0,0,0,0.95)',
        margin: 'auto',
      }}>
        <MonospaceLabel color={PLATFORM_ACCENT} fontSize="0.68rem" marginBottom={6}>
          ✏️ {strings.editModalTitle.toUpperCase()}
        </MonospaceLabel>
        <h3 style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          color: '#ffffff', fontSize: '1.05rem', margin: '0 0 20px',
        }}>
          <code style={{ color: PLATFORM_ACCENT }}>{nodeId}</code>
        </h3>

        <div style={{ marginBottom: 14 }}>
          <MonospaceLabel color="rgba(255,255,255,0.38)" fontSize="0.62rem" marginBottom={6}>
            {strings.storyTextField.toUpperCase()}
          </MonospaceLabel>
          <StyledTextarea value={storyText} onChange={setStoryText} rows={5} />
        </div>

        {node.question !== undefined && (
          <div style={{ marginBottom: 14 }}>
            <MonospaceLabel color="rgba(255,255,255,0.38)" fontSize="0.62rem" marginBottom={6}>
              {strings.questionField.toUpperCase()}
            </MonospaceLabel>
            <StyledTextarea value={questionText} onChange={setQuestion} rows={2} />
          </div>
        )}

        {node.lesson !== undefined && (
          <div style={{ marginBottom: 14 }}>
            <MonospaceLabel color="rgba(255,255,255,0.38)" fontSize="0.62rem" marginBottom={6}>
              {strings.lessonField.toUpperCase()}
            </MonospaceLabel>
            <StyledTextarea value={lessonText} onChange={setLesson} rows={2} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <SecondaryButton onClick={onCancel}>{strings.cancelButton}</SecondaryButton>
          <button onClick={handleSave} style={{
            padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
            fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', fontWeight: 700,
            border: `1px solid ${PLATFORM_ACCENT}`,
            background: `${PLATFORM_ACCENT}22`, color: PLATFORM_ACCENT,
          }}>
            {strings.saveChangesButton}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Story review panel — shared by both flows ─────────────────
// Renders all nodes for review. The writer approves, flags,
// or edits each node before the story proceeds to the next step.
export function StoryReviewPanel({
  story,
  workingLanguage,
  currentRound,
  maxRounds,
  onFullStoryRegenerated,
  onSingleNodeRegenerated,
  onAllNodesApproved,
}) {
  const strings = UI_STRINGS[workingLanguage];

  const [nodeReviewStates, setNodeReviewStates] = useState({});
  const [activeFlag, setActiveFlag] = useState(null);
  const [activeEdit, setActiveEdit] = useState(null);
  const [currentNodes, setCurrentNodes] = useState(story.nodes);

  const validationErrors = validateStoryStructure(currentNodes);
  const storyComposition = getStoryComposition(currentNodes);
  const nodeIds          = Object.keys(currentNodes);
  const approvedCount    = nodeIds.filter(id => nodeReviewStates[id] === 'approved').length;
  const flaggedCount     = nodeIds.filter(id => nodeReviewStates[id] === 'flagged').length;
  const allNodesApproved = approvedCount === nodeIds.length && validationErrors.length === 0;

  const getLocalizedText = (field) =>
    typeof field === 'object' ? field[workingLanguage] || '' : field || '';

  const toggleNodeReviewState = (nodeId, newState) => {
    setNodeReviewStates(prev => ({
      ...prev,
      [nodeId]: prev[nodeId] === newState ? null : newState,
    }));
  };

  const handleFlagSubmitted = (nodeId, feedbackNote, regenerationScope) => {
    toggleNodeReviewState(nodeId, 'flagged');
    setActiveFlag(null);
    if (regenerationScope === 'full') {
      onFullStoryRegenerated(feedbackNote);
    } else {
      onSingleNodeRegenerated(nodeId, feedbackNote);
    }
  };

  const handleEditSaved = (nodeId, changes) => {
    setCurrentNodes(prev => {
      const existingNode = { ...prev[nodeId] };
      // Merge edits into the working language key of each field
      ['text', 'question', 'lesson'].forEach(fieldName => {
        const fieldKey = fieldName === 'text' ? 'storyText'
          : fieldName === 'question' ? 'questionText' : 'lessonText';
        if (changes[fieldKey] !== undefined) {
          existingNode[fieldName] = typeof existingNode[fieldName] === 'object'
            ? { ...existingNode[fieldName], [workingLanguage]: changes[fieldKey] }
            : changes[fieldKey];
        }
      });
      return { ...prev, [nodeId]: existingNode };
    });
    toggleNodeReviewState(nodeId, 'approved');
    setActiveEdit(null);
  };

  const storyTitle = getLocalizedText(story.title);
  const storyTheme = getLocalizedText(story.theme);

  return (
    <div>
      {/* Review header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <MonospaceLabel fontSize="0.62rem" marginBottom={4}>
              ✦ {strings.storyReviewTitle.toUpperCase()} — {strings.roundLabel} {currentRound} {strings.ofLabel} {maxRounds}
            </MonospaceLabel>
            <h2 style={{
              fontFamily: 'var(--serif, Georgia, serif)',
              color: '#ffffff', fontSize: '1.35rem', margin: 0,
            }}>
              {storyTitle}
            </h2>
          </div>
          <div style={{
            textAlign: 'right',
            fontFamily: 'var(--mono, monospace)', fontSize: '0.66rem',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.38)' }}>{storyComposition.totalNodes} nodes</div>
            <div style={{ color: '#4ade80' }}>{approvedCount} ✓</div>
            {flaggedCount > 0 && <div style={{ color: '#f87171' }}>{flaggedCount} ⚑</div>}
          </div>
        </div>

        {/* Story metadata tags */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            story.book?.en || story.book,
            story.age,
            `${story.emoji} ${storyTheme}`,
            `${storyComposition.forkNodes} fork${storyComposition.forkNodes !== 1 ? 's' : ''}`,
            `${storyComposition.endingNodes} ending${storyComposition.endingNodes !== 1 ? 's' : ''}`,
          ].filter(Boolean).map((tag, index) => (
            <span key={index} style={{
              padding: '3px 10px', borderRadius: 20,
              fontFamily: 'var(--mono, monospace)', fontSize: '0.63rem',
              border: '1px solid rgba(255,255,255,0.13)',
              color: 'rgba(255,255,255,0.45)',
            }}>
              {tag}
            </span>
          ))}
        </div>

        {/* Progress steps preview */}
        {story.progressSteps && (
          <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {story.progressSteps.map(stepId => (
                <div key={stepId} style={{
                  height: 4, flex: 1, borderRadius: 4,
                  background: `${PLATFORM_ACCENT}55`,
                  boxShadow: `0 0 6px ${PLATFORM_ACCENT}33`,
                }} />
              ))}
            </div>
            <div style={{
              fontFamily: 'var(--mono, monospace)', fontSize: '0.58rem',
              color: 'rgba(255,255,255,0.22)',
            }}>
              {story.progressSteps.join(' → ')}
            </div>
          </>
        )}

        <StructuralValidationErrors errors={validationErrors} workingLanguage={workingLanguage} />
      </div>

      {/* Node cards */}
      {nodeIds.map(nodeId => (
        <StoryNodeCard
          key={nodeId}
          nodeId={nodeId}
          node={currentNodes[nodeId]}
          workingLanguage={workingLanguage}
          reviewState={nodeReviewStates[nodeId]}
          onApprove={id => toggleNodeReviewState(id, 'approved')}
          onFlag={id => setActiveFlag(id)}
          onEdit={id => setActiveEdit(id)}
        />
      ))}

      {/* Sticky action footer */}
      <div style={{
        position: 'sticky', bottom: 0,
        background: 'linear-gradient(to top, rgba(8,6,10,1) 60%, transparent)',
        paddingTop: 20, paddingBottom: 8,
        display: 'flex', gap: 10,
      }}>
        {currentRound < maxRounds && (
          <button
            onClick={() => onFullStoryRegenerated('Story writer requested full regeneration.')}
            style={{
              flex: 1, padding: '11px 16px', borderRadius: 10,
              fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.06em',
              border: '1px solid rgba(255,255,255,0.13)',
              background: 'transparent', color: 'rgba(255,255,255,0.38)',
            }}>
            {strings.regenerateFullButton} ({maxRounds - currentRound} {strings.roundsRemainingLabel})
          </button>
        )}
        <button
          disabled={!allNodesApproved}
          onClick={() => allNodesApproved && onAllNodesApproved(currentNodes)}
          style={{
            flex: 1, padding: '11px 16px', borderRadius: 10,
            fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem', fontWeight: 700,
            cursor: allNodesApproved ? 'pointer' : 'default', letterSpacing: '0.06em',
            border: `1px solid ${allNodesApproved ? '#4ade80' : 'rgba(74,222,128,0.15)'}`,
            background: allNodesApproved ? 'rgba(74,222,128,0.16)' : 'transparent',
            color: allNodesApproved ? '#4ade80' : 'rgba(74,222,128,0.22)',
            transition: 'all 0.2s',
          }}>
          {allNodesApproved
            ? strings.approveAllButton
            : `${approvedCount}/${nodeIds.length} ${strings.approveAllPendingButton}`}
        </button>
      </div>

      {/* Modals */}
      {activeFlag && (
        <NodeFlagModal
          nodeId={activeFlag}
          workingLanguage={workingLanguage}
          onFlagSubmitted={handleFlagSubmitted}
          onCancel={() => setActiveFlag(null)}
        />
      )}
      {activeEdit && (
        <NodeEditModal
          nodeId={activeEdit}
          node={currentNodes[activeEdit]}
          workingLanguage={workingLanguage}
          onEditSaved={handleEditSaved}
          onCancel={() => setActiveEdit(null)}
        />
      )}
    </div>
  );
}
