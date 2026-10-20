// ─────────────────────────────────────────────────────────────
// AgentFlow.jsx
// The agent-assisted story creation flow.
//
// Steps in this flow:
//   1. StoryBriefForm      — writer enters story name + book number
//   2. GeneratingPlan      — agent reads the Panchatantra story
//   3. StoryPlanReview     — writer reviews and approves the plan
//   4. GeneratingStory     — agent writes the nodes
//   5. StoryReviewPanel    — writer reviews each node, approves all
//   6. EnglishApproved     — working language approved, next is second language
//
// The agent flow feeds into the shared StoryReviewPanel which is
// also used by the Writer flow — ensuring both flows produce
// the same output and enter the same review pipeline.
// ─────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  PLATFORM_ACCENT, PANCHATANTRA_BOOKS, UI_STRINGS, MAX_FEEDBACK_ROUNDS,
} from '../shared/constants';
import {
  LoadingSpinner, MonospaceLabel, PrimaryButton, SecondaryButton,
  StyledTextInput, StoryReviewPanel,
} from '../shared/StoryAgentComponents';
import {
  generateStoryPlan, generateStoryNodes,
  regenerateAllNodes, regenerateSingleNode,
} from '../shared/claudeService';

// ── Step 1 — Story brief form ─────────────────────────────────
// Collects just two inputs: story name and book number.
// The agent derives everything else from its knowledge of the story.
function StoryBriefForm({ workingLanguage, onBriefSubmitted, isLoading }) {
  const strings = UI_STRINGS[workingLanguage];
  const [storyName, setStoryName] = useState('');
  const [bookNumber, setBookNumber] = useState('I');
  const isReadyToSubmit = storyName.trim() && !isLoading;

  return (
    <div>
      <MonospaceLabel fontSize="0.68rem" marginBottom={6}>
        ✦ {workingLanguage === 'hi' ? 'कहानी का विवरण' : 'STORY BRIEF'}
      </MonospaceLabel>
      <h2 style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: '#ffffff', fontSize: '1.4rem', margin: '0 0 6px',
      }}>
        {strings.briefFormTitle}
      </h2>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.38)', fontSize: '0.88rem',
        margin: '0 0 26px', lineHeight: 1.6,
      }}>
        {strings.briefFormSubtitle}
      </p>

      {/* Story name */}
      <div style={{ marginBottom: 22 }}>
        <MonospaceLabel fontSize="0.62rem" marginBottom={8}>
          {strings.storyNameLabel.toUpperCase()}
        </MonospaceLabel>
        <StyledTextInput
          value={storyName}
          onChange={setStoryName}
          placeholder={strings.storyNamePlaceholder}
          onKeyDown={e => e.key === 'Enter' && isReadyToSubmit && onBriefSubmitted(storyName, bookNumber)}
          autoFocus
        />
      </div>

      {/* Book number selector */}
      <div style={{ marginBottom: 28 }}>
        <MonospaceLabel fontSize="0.62rem" marginBottom={10}>
          {strings.bookNumberLabel.toUpperCase()}
        </MonospaceLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PANCHATANTRA_BOOKS.map(book => (
            <button
              key={book.value}
              onClick={() => setBookNumber(book.value)}
              style={{
                padding: '9px 16px', borderRadius: 9, cursor: 'pointer',
                fontFamily: 'var(--mono, monospace)',
                fontSize: '0.7rem', fontWeight: 700,
                border: `1px solid ${bookNumber === book.value ? PLATFORM_ACCENT : 'rgba(255,255,255,0.15)'}`,
                background: bookNumber === book.value ? `${PLATFORM_ACCENT}22` : 'rgba(255,255,255,0.03)',
                color: bookNumber === book.value ? PLATFORM_ACCENT : 'rgba(255,255,255,0.45)',
                transition: 'all 0.2s',
              }}>
              {workingLanguage === 'hi' ? `भाग ${book.value}` : `Book ${book.value}`}
            </button>
          ))}
        </div>
      </div>

      <PrimaryButton
        onClick={() => isReadyToSubmit && onBriefSubmitted(storyName, bookNumber)}
        disabled={!isReadyToSubmit}
        isLoading={isLoading}
        style={{ width: '100%' }}>
        {isLoading ? strings.readingStoryMessage : strings.generatePlanButton}
      </PrimaryButton>
    </div>
  );
}

// ── Step 2 / 4 — Agent loading screen ────────────────────────
function AgentLoadingScreen({ workingLanguage, currentRound, isGeneratingPlan }) {
  const strings = UI_STRINGS[workingLanguage];
  const headlineText = isGeneratingPlan
    ? strings.generatingPlanMessage
    : currentRound > 1
    ? `${strings.roundLabel} ${currentRound} — ${strings.regeneratingMessage}`
    : strings.generatingStoryMessage;
  const subtitleText = isGeneratingPlan
    ? strings.generatingPlanSubtitle
    : strings.generatingStorySubtitle;

  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
        <LoadingSpinner size={28} />
      </div>
      <MonospaceLabel fontSize="0.72rem" marginBottom={10}>
        {headlineText.toUpperCase()}
      </MonospaceLabel>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.32)', fontSize: '0.88rem', margin: 0,
      }}>
        {subtitleText}
      </p>
    </div>
  );
}

// ── Step 3 — Story plan review ────────────────────────────────
// Writer reviews the agent's understanding of the story
// before any nodes are written. This is the plan-first approach
// discussed in the design sessions.
function StoryPlanReview({ plan, workingLanguage, onPlanApproved, onPlanRejected, isLoading }) {
  const strings = UI_STRINGS[workingLanguage];

  const planSections = [
    { label: strings.planSectionTeaching,  content: plan.teaching     },
    { label: strings.planSectionCharacter, content: plan.character    },
    { label: strings.planSectionTension,   content: plan.tension      },
    { label: strings.planSectionStructure, content: plan.structure    },
    { label: strings.planSectionPaths,     content: plan.paths        },
    { label: strings.planSectionAge,       content: plan.ageReasoning },
    { label: strings.planSectionTheme,     content: plan.theme        },
  ];

  const planTitle = plan.title
    ? (typeof plan.title === 'object' ? plan.title[workingLanguage] || plan.title.en : plan.title)
    : '';

  return (
    <div>
      <MonospaceLabel fontSize="0.68rem" marginBottom={6}>
        ✦ {strings.planReviewTitle.toUpperCase()}
      </MonospaceLabel>
      {planTitle && (
        <h2 style={{
          fontFamily: 'var(--serif, Georgia, serif)',
          color: '#ffffff', fontSize: '1.4rem', margin: '0 0 20px',
        }}>
          {plan.emoji} {planTitle}
        </h2>
      )}

      {planSections.map((section, index) => section.content ? (
        <div key={index} style={{
          marginBottom: 14, padding: '13px 15px', borderRadius: 11,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderLeft: `3px solid ${PLATFORM_ACCENT}55`,
        }}>
          <MonospaceLabel color={`${PLATFORM_ACCENT}bb`} fontSize="0.6rem" marginBottom={7}>
            {section.label}
          </MonospaceLabel>
          <p style={{
            fontFamily: 'var(--serif, Georgia, serif)',
            fontSize: '0.92rem', color: '#f0e6d0',
            lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line',
          }}>
            {section.content}
          </p>
        </div>
      ) : null)}

      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <SecondaryButton onClick={onPlanRejected} disabled={isLoading}>
          {strings.planRejectButton}
        </SecondaryButton>
        <PrimaryButton
          onClick={onPlanApproved}
          isLoading={isLoading}
          style={{ flex: 1 }}>
          {strings.planApproveButton}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Step 6 — English approved ─────────────────────────────────
function WorkingLanguageApproved({ workingLanguage, onReturnToMenu }) {
  const strings = UI_STRINGS[workingLanguage];
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>✓</div>
      <MonospaceLabel color="#4ade80" fontSize="0.72rem" marginBottom={12}>
        {strings.englishApprovedTitle}
      </MonospaceLabel>
      <p style={{
        fontFamily: 'var(--serif, Georgia, serif)',
        color: 'rgba(255,255,255,0.42)', fontSize: '0.9rem',
        lineHeight: 1.7, marginBottom: 24,
        maxWidth: 360, marginLeft: 'auto', marginRight: 'auto',
      }}>
        {strings.englishApprovedMessage}
      </p>
      <button onClick={onReturnToMenu} style={{
        padding: '9px 22px', borderRadius: 10,
        fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', fontWeight: 700,
        cursor: 'pointer', border: `1px solid ${PLATFORM_ACCENT}`,
        background: `${PLATFORM_ACCENT}22`, color: PLATFORM_ACCENT,
      }}>
        {strings.returnToMenuButton}
      </button>
    </div>
  );
}

// ── Agent flow steps ──────────────────────────────────────────
const AGENT_FLOW_STEPS = {
  BRIEF_FORM:         'brief_form',
  GENERATING_PLAN:    'generating_plan',
  PLAN_REVIEW:        'plan_review',
  GENERATING_STORY:   'generating_story',
  STORY_REVIEW:       'story_review',
  WORKING_LANG_APPROVED: 'working_language_approved',
};

// ── Agent flow root component ─────────────────────────────────
export default function AgentFlow({ workingLanguage, onReturnToTrackSelection }) {
  const strings = UI_STRINGS[workingLanguage];

  const [currentStep,  setCurrentStep]  = useState(AGENT_FLOW_STEPS.BRIEF_FORM);
  const [storyName,    setStoryName]    = useState('');
  const [bookNumber,   setBookNumber]   = useState('I');
  const [approvedPlan, setApprovedPlan] = useState(null);
  const [currentStory, setCurrentStory] = useState(null);
  const [feedbackRound, setFeedbackRound] = useState(1);
  const [isLoading,    setIsLoading]    = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleError = (error) => {
    setErrorMessage(error.message || String(error));
    setIsLoading(false);
  };

  // Step 1 → 2: Writer submits brief, agent generates plan
  const handleBriefSubmitted = async (name, book) => {
    setStoryName(name);
    setBookNumber(book);
    setErrorMessage(null);
    setIsLoading(true);
    setCurrentStep(AGENT_FLOW_STEPS.GENERATING_PLAN);
    try {
      const plan = await generateStoryPlan(name, book, workingLanguage);
      setApprovedPlan(plan);
      setCurrentStep(AGENT_FLOW_STEPS.PLAN_REVIEW);
    } catch (error) {
      handleError(error);
      setCurrentStep(AGENT_FLOW_STEPS.BRIEF_FORM);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3a: Writer rejects plan, agent re-plans
  const handlePlanRejected = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    setCurrentStep(AGENT_FLOW_STEPS.GENERATING_PLAN);
    try {
      const newPlan = await generateStoryPlan(storyName, bookNumber, workingLanguage);
      setApprovedPlan(newPlan);
      setCurrentStep(AGENT_FLOW_STEPS.PLAN_REVIEW);
    } catch (error) {
      handleError(error);
      setCurrentStep(AGENT_FLOW_STEPS.PLAN_REVIEW);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3b → 4: Writer approves plan, agent writes nodes
  const handlePlanApproved = async () => {
    setErrorMessage(null);
    setIsLoading(true);
    setFeedbackRound(1);
    setCurrentStep(AGENT_FLOW_STEPS.GENERATING_STORY);
    try {
      const story = await generateStoryNodes(approvedPlan, storyName, bookNumber, workingLanguage);
      setCurrentStory(story);
      setCurrentStep(AGENT_FLOW_STEPS.STORY_REVIEW);
    } catch (error) {
      handleError(error);
      setCurrentStep(AGENT_FLOW_STEPS.PLAN_REVIEW);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 5a: Writer flags full story, agent regenerates all nodes
  const handleFullStoryRegenerated = async (writerFeedback) => {
    if (feedbackRound >= MAX_FEEDBACK_ROUNDS) return;
    setErrorMessage(null);
    setIsLoading(true);
    setFeedbackRound(round => round + 1);
    setCurrentStep(AGENT_FLOW_STEPS.GENERATING_STORY);
    try {
      const regeneratedStory = await regenerateAllNodes(
        currentStory, storyName, bookNumber, workingLanguage, writerFeedback
      );
      setCurrentStory(regeneratedStory);
      setCurrentStep(AGENT_FLOW_STEPS.STORY_REVIEW);
    } catch (error) {
      handleError(error);
      setCurrentStep(AGENT_FLOW_STEPS.STORY_REVIEW);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 5b: Writer flags single node, agent regenerates only that node
  const handleSingleNodeRegenerated = async (nodeId, writerFeedback) => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const storyWithRevisedNode = await regenerateSingleNode(
        currentStory, nodeId, workingLanguage, writerFeedback
      );
      setCurrentStory(storyWithRevisedNode);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 5c: All nodes approved — working language is done
  const handleAllNodesApproved = (approvedNodes) => {
    setCurrentStory(prev => ({ ...prev, nodes: approvedNodes }));
    setCurrentStep(AGENT_FLOW_STEPS.WORKING_LANG_APPROVED);
  };

  const handleReturnToTrackSelection = () => {
    onReturnToTrackSelection();
  };

  return (
    <div>
      {/* Back navigation — hidden during loading */}
      {currentStep !== AGENT_FLOW_STEPS.GENERATING_PLAN &&
       currentStep !== AGENT_FLOW_STEPS.GENERATING_STORY && (
        <div style={{ marginBottom: 20 }}>
          <button onClick={handleReturnToTrackSelection} style={{
            background: 'none', border: 'none', padding: 0,
            fontFamily: 'var(--mono, monospace)', fontSize: '0.7rem',
            color: 'rgba(255,255,255,0.38)', cursor: 'pointer', letterSpacing: '0.08em',
          }}>
            {strings.backButton}
          </button>
        </div>
      )}

      {/* Error display */}
      {errorMessage && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20,
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
          fontFamily: 'var(--serif, Georgia, serif)',
          color: '#ffb3b3', fontSize: '0.88rem', lineHeight: 1.5,
        }}>
          {errorMessage}
        </div>
      )}

      {/* Step rendering */}
      {currentStep === AGENT_FLOW_STEPS.BRIEF_FORM && (
        <StoryBriefForm
          workingLanguage={workingLanguage}
          onBriefSubmitted={handleBriefSubmitted}
          isLoading={isLoading}
        />
      )}

      {currentStep === AGENT_FLOW_STEPS.GENERATING_PLAN && (
        <AgentLoadingScreen
          workingLanguage={workingLanguage}
          currentRound={feedbackRound}
          isGeneratingPlan={true}
        />
      )}

      {currentStep === AGENT_FLOW_STEPS.PLAN_REVIEW && approvedPlan && (
        <StoryPlanReview
          plan={approvedPlan}
          workingLanguage={workingLanguage}
          onPlanApproved={handlePlanApproved}
          onPlanRejected={handlePlanRejected}
          isLoading={isLoading}
        />
      )}

      {currentStep === AGENT_FLOW_STEPS.GENERATING_STORY && (
        <AgentLoadingScreen
          workingLanguage={workingLanguage}
          currentRound={feedbackRound}
          isGeneratingPlan={false}
        />
      )}

      {currentStep === AGENT_FLOW_STEPS.STORY_REVIEW && currentStory && (
        <StoryReviewPanel
          story={currentStory}
          workingLanguage={workingLanguage}
          currentRound={feedbackRound}
          maxRounds={MAX_FEEDBACK_ROUNDS}
          onFullStoryRegenerated={handleFullStoryRegenerated}
          onSingleNodeRegenerated={handleSingleNodeRegenerated}
          onAllNodesApproved={handleAllNodesApproved}
        />
      )}

      {currentStep === AGENT_FLOW_STEPS.WORKING_LANG_APPROVED && (
        <WorkingLanguageApproved
          workingLanguage={workingLanguage}
          onReturnToMenu={handleReturnToTrackSelection}
        />
      )}
    </div>
  );
}
