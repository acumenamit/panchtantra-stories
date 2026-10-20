// ─────────────────────────────────────────────────────────────
// claudeService.js
// All Claude API calls for the Story Agent live here.
// Nothing else in the codebase calls the API directly.
//
// Three responsibilities:
//   1. System prompts — rules the agent reads before generating
//   2. User message construction — formats the request clearly
//   3. Response parsing — extracts and validates JSON from responses
// ─────────────────────────────────────────────────────────────

const CLAUDE_API_URL  = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL    = 'claude-sonnet-4-20250514';

// ── System prompts ────────────────────────────────────────────

const buildStoryPlanSystemPrompt = (workingLanguage) => `
You are a Panchatantra story planning agent. A story writer has given you a story name and book number.
Your job is to produce a structured story PLAN — not the story itself.

Working language: ${workingLanguage === 'hi' ? 'HINDI (हिन्दी)' : 'ENGLISH'}
Respond entirely in ${workingLanguage === 'hi' ? 'Hindi' : 'English'}.

You know the Panchatantra stories well. Read the story name and book number,
surface your understanding of that story, and build a plan for the story writer
to review and approve before you write anything.

The structure section is critical. Do not describe a simple end-fork.
The platform supports rich branching — alternate paths, multiple forks,
paths that rejoin the main story. Describe the full interactive architecture.

OUTPUT FORMAT — valid JSON only, no markdown fences, no explanation text:
{
  "title": { "en": "...", "hi": "..." },
  "emoji": "🦁",
  "color": "#hex that matches the story mood",
  "age": "6+",
  "book": "Book I",
  "teaching": "The core Panchatantra wisdom this story carries",
  "character": "Main character — who they are, what they want, what stands in their way",
  "tension": "The central dramatic conflict",
  "structure": "Proposed interactive node architecture — describe the branching in detail. Where do alternate paths go? How many endings? Where does the primary fork sit? Which choices lead to alternate paths vs direct endings?",
  "paths": "Each ending path and the lesson it carries",
  "ageReasoning": "Suggested age and reasoning",
  "theme": "The moral and emotional territory of this story"
}
`.trim();

const buildStoryGenerationSystemPrompt = (workingLanguage) => `
You are a Panchatantra story generation agent for a children's interactive storytelling platform.
Generate a complete interactive story in ${workingLanguage === 'hi' ? 'HINDI (हिन्दी)' : 'ENGLISH'}.

━━━ FIXED RULES — never override ━━━
1. At least 1 fork node — a node with exactly 2 choices representing genuinely different decisions
2. At least 2 ending nodes — one per path from the primary fork
3. Every ending node must contain a lesson field and a Panchatantra teaching block in the story text
4. No Western idioms — never: fair-weather, castles in the air, tide turning, frost that kills, offstage, chorus of voices
5. No narrator commentary — show action and setting; never label emotions or tell the child what to feel
6. Every character who appears must have clothing specified
7. Never translate Dharma, niti, karma — use the Sanskrit word in both languages
8. Dream and vision sequences must be written as unfolding reality, not as hypothetical or imagined
9. Ancient pre-colonial India setting — no Mughal architecture, no European references
10. The question before each choice is one sentence only — names where the child is right now
11. Both endings must carry different but related lessons
12. isAlternate: true on nodes reached by non-primary choices that are not endings

━━━ FLEXIBLE RULES — agent defaults, story writer may adjust ━━━
- Node count: default 6-10, maximum 20
- Word count per node: default 100-200 words, maximum 300
- Single choice text: 2-8 words — feels like an instinctive response, not a scene summary
- Fork choice text: under 12 words each — names the action, not the reasoning behind it
- Tense: match to the story's nature — present for unfolding stories, past for completed events
- progressSteps: default 5 entries, maximum 10 — milestone nodes on the primary path only

━━━ OUTPUT FORMAT — valid JSON only, no markdown, no explanation ━━━
{
  "title": { "en": "...", "hi": "..." },
  "description": { "en": "...", "hi": "..." },
  "theme": { "en": "...", "hi": "..." },
  "book": { "en": "Panchatantra — Book I", "hi": "पञ्चतन्त्र — प्रथम भाग" },
  "age": "6+",
  "duration": { "en": "8-12 min", "hi": "8-12 मिनट" },
  "emoji": "🦁",
  "color": "#hex",
  "progressSteps": ["start", "node_id", "node_id", "node_id", "ending_primary"],
  "nodes": {
    "start": {
      "scene": "village",
      "isAlternate": false,
      "isEnding": false,
      "text": { "${workingLanguage}": "Story text here..." },
      "question": { "${workingLanguage}": "One sentence question?" },
      "choices": [
        { "text": { "${workingLanguage}": "💛 Choice text." }, "next": "next_node_id" }
      ]
    },
    "ending_primary": {
      "scene": "forest_dawn",
      "isAlternate": false,
      "isEnding": true,
      "text": { "${workingLanguage}": "Conclusion text...\\n\\n${workingLanguage === 'hi' ? 'पञ्चतन्त्र सिखाता है:' : 'The Panchatantra teaches:'}\\n\\"[Two to three direct lines. No Western metaphor.]\\"" },
      "lesson": { "${workingLanguage}": "One or two sentences written for a child." },
      "lessonIcon": "🌟"
    }
  }
}

Include ONLY the working language key in text fields for now.
The second language will be generated separately after approval.
`.trim();

const buildSecondLanguageSystemPrompt = (sourceLanguage, targetLanguage) => `
You are a bilingual translation agent for the Panchatantra Platform.
You have an approved interactive story in ${sourceLanguage === 'en' ? 'English' : 'Hindi'}.
Translate all text content into ${targetLanguage === 'en' ? 'English' : 'Hindi'}.

Translation rules:
- ${targetLanguage === 'hi' ? 'Use simple spoken Hindi — not formal or Sanskrit-heavy' : 'Use clear simple English for children aged 6-12'}
- Tenses must match the source text
- Sanskrit terms (Dharma, niti, karma, ahimsa) appear as-is in both languages — never translate them
- The result must feel natural, not like a translated document
- Preserve all JSON structure exactly — only translate text content values

Return the complete story JSON with BOTH language keys populated in every text field.
No markdown fences. No explanation.
`.trim();

// ── Low-level API caller ──────────────────────────────────────

async function callClaudeAPI(systemPrompt, userMessage, maxTokens = 4000) {
  const apiKey = process.env.REACT_APP_ANTHROPIC_KEY;
  if (!apiKey) {
    throw new Error('REACT_APP_ANTHROPIC_KEY is not set. Add it to your Vercel environment variables.');
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error?.message || `Claude API returned ${response.status}`);
  }

  const data      = await response.json();
  const rawText   = data.content?.map(block => block.text || '').join('') || '';
  const cleanJson = rawText.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleanJson);
  } catch {
    throw new Error(
      `Claude returned text that could not be parsed as JSON.\n` +
      `First 300 characters: ${rawText.slice(0, 300)}`
    );
  }
}

// ── Public service functions ──────────────────────────────────

export async function generateStoryPlan(storyName, bookNumber, workingLanguage) {
  const userMessage = workingLanguage === 'hi'
    ? `कहानी का नाम: ${storyName}\nपुस्तक संख्या: ${bookNumber}\n\nइस कहानी के लिए एक विस्तृत योजना बनाएँ।`
    : `Story name: ${storyName}\nBook: ${bookNumber}\n\nGenerate a detailed story plan for this Panchatantra story.`;

  return callClaudeAPI(
    buildStoryPlanSystemPrompt(workingLanguage),
    userMessage,
    2000
  );
}

export async function generateStoryNodes(approvedPlan, storyName, bookNumber, workingLanguage, additionalContext = '') {
  const planSummary = JSON.stringify(approvedPlan, null, 2);
  const userMessage = workingLanguage === 'hi'
    ? `कहानी: ${storyName}\nपुस्तक: ${bookNumber}\n\nस्वीकृत योजना:\n${planSummary}${additionalContext ? `\n\nअतिरिक्त संदर्भ:\n${additionalContext}` : ''}\n\nअब इस योजना के आधार पर पूरी कहानी हिन्दी में लिखें।`
    : `Story: ${storyName}\nBook: ${bookNumber}\n\nApproved plan:\n${planSummary}${additionalContext ? `\n\nAdditional context:\n${additionalContext}` : ''}\n\nNow write the complete story in English based on this plan.`;

  return callClaudeAPI(
    buildStoryGenerationSystemPrompt(workingLanguage),
    userMessage,
    5000
  );
}

export async function regenerateAllNodes(currentStory, storyName, bookNumber, workingLanguage, writerFeedback) {
  const currentStoryJson = JSON.stringify(currentStory, null, 2);
  const userMessage = workingLanguage === 'hi'
    ? `कहानी: ${storyName}\nपुस्तक: ${bookNumber}\n\nपिछला मसौदा:\n${currentStoryJson}\n\nलेखक की प्रतिक्रिया:\n${writerFeedback}\n\nइस प्रतिक्रिया के आधार पर पूरी कहानी फिर से लिखें।`
    : `Story: ${storyName}\nBook: ${bookNumber}\n\nCurrent draft:\n${currentStoryJson}\n\nWriter feedback:\n${writerFeedback}\n\nRegenerate the complete story based on this feedback.`;

  return callClaudeAPI(
    buildStoryGenerationSystemPrompt(workingLanguage),
    userMessage,
    5000
  );
}

export async function regenerateSingleNode(currentStory, nodeId, workingLanguage, writerFeedback) {
  const currentStoryJson = JSON.stringify(currentStory, null, 2);
  const userMessage = workingLanguage === 'hi'
    ? `पूरी कहानी:\n${currentStoryJson}\n\nकेवल नोड "${nodeId}" को फिर से लिखें।\nप्रतिक्रिया: ${writerFeedback}\n\nपूरी कहानी का JSON वापस करें जिसमें केवल "${nodeId}" बदला हो।`
    : `Full story:\n${currentStoryJson}\n\nRegenerate ONLY node "${nodeId}".\nFeedback: ${writerFeedback}\n\nReturn the complete story JSON with only "${nodeId}" revised. All other nodes unchanged.`;

  return callClaudeAPI(
    buildStoryGenerationSystemPrompt(workingLanguage),
    userMessage,
    5000
  );
}

export async function generateSecondLanguage(approvedStory, sourceLanguage, targetLanguage) {
  const storyJson   = JSON.stringify(approvedStory, null, 2);
  const sourceName  = sourceLanguage === 'en' ? 'English' : 'Hindi';
  const targetName  = targetLanguage === 'en' ? 'English' : 'Hindi';
  const userMessage = `Approved ${sourceName} story:\n${storyJson}\n\nTranslate all text fields into ${targetName} and return the complete story JSON with both languages populated in every text field.`;

  return callClaudeAPI(
    buildSecondLanguageSystemPrompt(sourceLanguage, targetLanguage),
    userMessage,
    6000
  );
}
