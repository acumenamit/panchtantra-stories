// ─────────────────────────────────────────────────────────────
// constants.js
// Platform-wide constants for the Story Agent.
// Kept in sync with the main platform (scenes.js, LangContext.js).
// ─────────────────────────────────────────────────────────────

// Primary saffron accent — matches the main platform
export const PLATFORM_ACCENT = '#fbbf24';

// Scene definitions — mirrors pt/src/scenes.js
export const SCENES = {
  forest_day:     { bg: 'linear-gradient(160deg,#0d2b0d,#05150a)', accent: '#4ade80' },
  forest_evening: { bg: 'linear-gradient(160deg,#3a1a0d,#1a0905)', accent: '#fb923c' },
  forest_dark:    { bg: 'linear-gradient(160deg,#0d0d1f,#06060f)', accent: '#818cf8' },
  forest_path:    { bg: 'linear-gradient(160deg,#0d2b1a,#05150d)', accent: '#34d399' },
  forest_dawn:    { bg: 'linear-gradient(160deg,#2b1a0d,#150d05)', accent: '#fbbf24' },
  river_bank:     { bg: 'linear-gradient(160deg,#0d1f2b,#050f15)', accent: '#38bdf8' },
  village:        { bg: 'linear-gradient(160deg,#1f1a0d,#0f0d05)', accent: '#fcd34d' },
  palace:         { bg: 'linear-gradient(160deg,#1f0d2b,#0f0515)', accent: '#c084fc' },
  lions_den:      { bg: 'linear-gradient(160deg,#2b0d0d,#150505)', accent: '#f87171' },
  well:           { bg: 'linear-gradient(160deg,#0d1a2b,#050d18)', accent: '#60a5fa' },
};

// Panchatantra book definitions — both languages
export const PANCHATANTRA_BOOKS = [
  { value: 'I',   labelEn: 'Book I — Mitra-bheda',        labelHi: 'भाग I — मित्रभेद'          },
  { value: 'II',  labelEn: 'Book II — Mitra-samprapti',   labelHi: 'भाग II — मित्रसंप्राप्ति'   },
  { value: 'III', labelEn: 'Book III — Kakolukiyam',      labelHi: 'भाग III — काकोलूकीयम'       },
  { value: 'IV',  labelEn: 'Book IV — Labdhapranasam',    labelHi: 'भाग IV — लब्धप्रणाशम'       },
  { value: 'V',   labelEn: 'Book V — Apariksitakarakam',  labelHi: 'भाग V — अपरीक्षितकारकम'    },
];

// Supported working languages
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', flag: '🇬🇧' },
  { code: 'hi', label: 'Hindi',   nativeLabel: 'हिन्दी',  flag: '🇮🇳' },
];

// Maximum feedback rounds before the story is locked for revision
export const MAX_FEEDBACK_ROUNDS = 4;

// ─────────────────────────────────────────────────────────────
// UI strings — all interface labels in both languages.
// Add new strings here when adding new UI elements.
// ─────────────────────────────────────────────────────────────
export const UI_STRINGS = {
  en: {
    // Language selection screen
    languageSelectionTitle:    'Choose your working language',
    languageSelectionSubtitle: 'All agent output and your review will be in this language',

    // Track selection screen
    trackSelectionTitle:       'How do you want to create?',
    trackSelectionSubtitle:    'Both tracks enter the same review pipeline',
    agentFlowTitle:            'Use the Agent',
    agentFlowSubtitle:         'Give me a story name — I\'ll plan and write it',
    writerFlowTitle:           'Write My Own',
    writerFlowSubtitle:        'I\'ll write the story myself, node by node',
    writerFlowComingSoon:      'Coming soon',

    // Brief form
    briefFormTitle:            'Name your story',
    briefFormSubtitle:         'Just two things. The agent knows the rest.',
    storyNameLabel:            'Story name',
    storyNamePlaceholder:      'e.g. The Lion and the Hare',
    bookNumberLabel:           'Book number',
    generatePlanButton:        '✦ Generate Story Plan',
    readingStoryMessage:       'Reading the story...',

    // Plan review
    planReviewTitle:           'Story Plan',
    planApproveButton:         '✓ Approve Plan — Write Story',
    planRejectButton:          '↺ Re-plan',
    planSectionTeaching:       '📖 Panchatantra Teaching',
    planSectionCharacter:      '👤 Main Character',
    planSectionTension:        '⚡ Dramatic Tension',
    planSectionStructure:      '🌿 Interactive Structure',
    planSectionPaths:          '🔀 Paths and Lessons',
    planSectionAge:            '🎯 Age Range',
    planSectionTheme:          '🎨 Thematic Territory',

    // Story review
    storyReviewTitle:          'Review Story',
    roundLabel:                'Round',
    ofLabel:                   'of',
    approveNodeButton:         'Approve',
    nodeApprovedLabel:         '✓ Approved',
    flagNodeButton:            'Flag for revision',
    nodeFlaggedLabel:          '⚑ Flagged',
    editNodeButton:            'Edit directly',
    approveAllButton:          'Approve all nodes — proceed to Hindi →',
    approveAllPendingButton:   'nodes approved — approve all to continue',
    regenerateFullButton:      '↺ Regenerate full story',
    roundsRemainingLabel:      'rounds left',

    // Node types
    nodeTypeSingle:            '→ SINGLE',
    nodeTypeFork:              '⑂ FORK',
    nodeTypeEnding:            '⬛ ENDING',
    nodeTypeAlternate:         '↪ ALT',

    // Flag modal
    flagModalTitle:            'Flag node for revision',
    flagScopeLabel:            'Regeneration scope',
    flagThisNodeOption:        'This node only',
    flagFullStoryOption:       'Full story',
    flagNoteLabel:             'What needs changing',
    flagNotePlaceholder:       'Be specific — e.g. "The choice text summarises the scene instead of naming the emotion"',
    flagSubmitButton:          'Submit flag',

    // Edit modal
    editModalTitle:            'Edit node',
    storyTextField:            'Story text',
    questionField:             'Question',
    lessonField:               'Lesson',
    saveChangesButton:         'Save changes',
    cancelButton:              'Cancel',

    // Structural validation
    structuralIssuesLabel:     '⚠ Structural issues',

    // Navigation
    backButton:                '← back',
    newStoryButton:            '← New story',
    returnToMenuButton:        '← Main menu',

    // Loading messages
    generatingPlanMessage:     'Reading the Panchatantra...',
    generatingPlanSubtitle:    'The agent knows the story — building the plan.',
    generatingStoryMessage:    'Writing your story...',
    generatingStorySubtitle:   'Reading the rules document and writing each node.',
    regeneratingMessage:       'Regenerating...',

    // Completion
    englishApprovedTitle:      'ENGLISH APPROVED',
    englishApprovedMessage:    'Next step: Hindi generation and review — coming in the next build.',

    // Footer
    internalToolLabel:         'Panchatantra Platform · Story Agent v1.0 · Internal tool',

    // Writer flow stub
    writerFlowTitle2:          'Write your own story',
    writerFlowDescription:     'Write your story node by node. The live validator checks structure as you go.',
    comingSoonLabel:           'COMING SOON',
    writerFlowComingMessage:   'Node editor, live structural validator — coming in the next build.',
    writerFlowWillInclude:     'WHAT THIS TRACK WILL INCLUDE',
    writerFlowFeature1:        'Story metadata form (title, book, age, theme)',
    writerFlowFeature2:        'Node-by-node editor — in Hindi or English',
    writerFlowFeature3:        'Live structural validator as nodes are added',
    writerFlowFeature4:        'Same review pipeline as the Agent flow',
    writerFlowUseAgentPrompt:  'IN THE MEANTIME, USE THE AGENT FLOW',
    chooseTrackButton:         '← Choose track',
  },

  hi: {
    languageSelectionTitle:    'अपनी कार्य भाषा चुनें',
    languageSelectionSubtitle: 'एजेंट का आउटपुट और आपकी समीक्षा इसी भाषा में होगी',

    trackSelectionTitle:       'आप कैसे बनाना चाहते हैं?',
    trackSelectionSubtitle:    'दोनों ट्रैक एक ही समीक्षा पाइपलाइन में जाते हैं',
    agentFlowTitle:            'एजेंट का उपयोग करें',
    agentFlowSubtitle:         'कहानी का नाम दें — मैं योजना बनाऊँगा और लिखूँगा',
    writerFlowTitle:           'खुद लिखें',
    writerFlowSubtitle:        'मैं खुद कहानी लिखूँगा, नोड दर नोड',
    writerFlowComingSoon:      'जल्द आ रहा है',

    briefFormTitle:            'कहानी का नाम बताएँ',
    briefFormSubtitle:         'बस दो चीज़ें। एजेंट बाकी सब जानता है।',
    storyNameLabel:            'कहानी का नाम',
    storyNamePlaceholder:      'जैसे — शेर और खरगोश',
    bookNumberLabel:           'पुस्तक संख्या',
    generatePlanButton:        '✦ कहानी की योजना बनाएँ',
    readingStoryMessage:       'कहानी पढ़ी जा रही है...',

    planReviewTitle:           'कहानी की योजना',
    planApproveButton:         '✓ योजना स्वीकृत — कहानी लिखें',
    planRejectButton:          '↺ पुनः योजना',
    planSectionTeaching:       '📖 पञ्चतन्त्र की शिक्षा',
    planSectionCharacter:      '👤 मुख्य पात्र',
    planSectionTension:        '⚡ नाटकीय तनाव',
    planSectionStructure:      '🌿 इंटरेक्टिव संरचना',
    planSectionPaths:          '🔀 मार्ग और शिक्षाएँ',
    planSectionAge:            '🎯 आयु वर्ग',
    planSectionTheme:          '🎨 विषयगत क्षेत्र',

    storyReviewTitle:          'कहानी की समीक्षा',
    roundLabel:                'चक्र',
    ofLabel:                   'में से',
    approveNodeButton:         'स्वीकृत करें',
    nodeApprovedLabel:         '✓ स्वीकृत',
    flagNodeButton:            'संशोधन के लिए चिह्नित करें',
    nodeFlaggedLabel:          '⚑ चिह्नित',
    editNodeButton:            'सीधे संपादित करें',
    approveAllButton:          'सभी नोड स्वीकृत करें — हिन्दी की ओर →',
    approveAllPendingButton:   'नोड स्वीकृत — जारी रखने के लिए सभी स्वीकृत करें',
    regenerateFullButton:      '↺ पूरी कहानी फिर से बनाएँ',
    roundsRemainingLabel:      'चक्र शेष',

    nodeTypeSingle:            '→ एकल',
    nodeTypeFork:              '⑂ शाखा',
    nodeTypeEnding:            '⬛ अंत',
    nodeTypeAlternate:         '↪ वैकल्पिक',

    flagModalTitle:            'नोड को संशोधन के लिए चिह्नित करें',
    flagScopeLabel:            'पुनर्निर्माण का दायरा',
    flagThisNodeOption:        'केवल यह नोड',
    flagFullStoryOption:       'पूरी कहानी',
    flagNoteLabel:             'क्या बदलना है',
    flagNotePlaceholder:       'विशिष्ट बताएँ — जैसे "चुनाव का पाठ भावना की बजाय दृश्य का सारांश देता है"',
    flagSubmitButton:          'चिह्न सबमिट करें',

    editModalTitle:            'नोड संपादित करें',
    storyTextField:            'कहानी पाठ',
    questionField:             'प्रश्न',
    lessonField:               'शिक्षा',
    saveChangesButton:         'परिवर्तन सहेजें',
    cancelButton:              'रद्द करें',

    structuralIssuesLabel:     '⚠ संरचनात्मक समस्याएँ',

    backButton:                '← वापस',
    newStoryButton:            '← नई कहानी',
    returnToMenuButton:        '← मुख्य मेनू',

    generatingPlanMessage:     'पञ्चतन्त्र पढ़ी जा रही है...',
    generatingPlanSubtitle:    'एजेंट कहानी जानता है — योजना बन रही है।',
    generatingStoryMessage:    'आपकी कहानी लिखी जा रही है...',
    generatingStorySubtitle:   'नियम पुस्तक पढ़ी जा रही है और कहानी लिखी जा रही है।',
    regeneratingMessage:       'पुनर्निर्माण हो रहा है...',

    englishApprovedTitle:      'अंग्रेज़ी स्वीकृत',
    englishApprovedMessage:    'अगला चरण: हिन्दी अनुवाद — अगले बिल्ड में आ रहा है।',

    internalToolLabel:         'पञ्चतन्त्र प्लेटफ़ॉर्म · स्टोरी एजेंट v1.0 · आंतरिक उपकरण',

    writerFlowTitle2:          'खुद लिखें',
    writerFlowDescription:     'नोड दर नोड अपनी कहानी लिखें। लाइव वैलिडेटर संरचना जाँचता रहेगा।',
    comingSoonLabel:           'जल्द आ रहा है',
    writerFlowComingMessage:   'नोड एडिटर, लाइव वैलिडेटर — अगले बिल्ड में।',
    writerFlowWillInclude:     'इस ट्रैक में आएगा',
    writerFlowFeature1:        'कहानी मेटाडेटा फॉर्म (शीर्षक, भाग, आयु, थीम)',
    writerFlowFeature2:        'नोड दर नोड एडिटर — हिन्दी या अंग्रेज़ी में',
    writerFlowFeature3:        'लाइव संरचना वैलिडेटर (नोड जोड़ते ही)',
    writerFlowFeature4:        'वही समीक्षा पाइपलाइन जो एजेंट फ्लो उपयोग करता है',
    writerFlowUseAgentPrompt:  'अभी के लिए, एजेंट फ्लो का उपयोग करें',
    chooseTrackButton:         '← ट्रैक चुनें',
  },
};
