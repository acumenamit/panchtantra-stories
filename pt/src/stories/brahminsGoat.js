const brahminsGoat = {
  id: 'brahmins-goat',
  title:       { en: "The Brahmin's Goat",      hi: 'ब्राह्मण की बकरी' },
  description: { en: 'Three cunning thieves want a Brahmin\'s goat. Their weapon? The same lie, told three times. Can one man\'s mind hold firm against a storm of false words?',
                 hi: 'तीन चालाक ठगों की नज़र एक ब्राह्मण की बकरी पर है। उनका हथियार? एक ही झूठ, तीन बार बोला हुआ। क्या एक इंसान का मन झूठ के तूफ़ान में अडिग रह सकता है?' },
  theme:       { en: 'A lie repeated loudly is still a lie', hi: 'बार-बार बोला झूठ भी झूठ ही रहता है' },
  age: '6+',
  duration:    { en: '8–12 min', hi: '८–१२ मिनट' },
  addedOn: '2026-03-06',
  featured: false,
  emoji: '🐐',
  color: '#a78bfa',
  book:        { en: 'Panchatantra — Book V', hi: 'पञ्चतन्त्र — पञ्चम भाग' },
  progressSteps: ['start', 'second_thief', 'third_thief', 'brahmin_decides', 'ending_wisdom'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Brahmin walks happily with goat. First thief hides behind
    // a tree and calls it a dead dog.
    // IMAGE: start.jpg — cheerful Brahmin, goat on shoulders
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village',
      image: '/images/the-brahmins-goat/the-brahmins-goat-start.jpeg',
      text: {
        en: `In a small village, a kind Brahmin named Mitra Sharma had just performed a great ceremony. As his reward, a wealthy merchant gifted him a fine, healthy goat.

Mitra Sharma was overjoyed. He hoisted the goat onto his shoulders and set off down the long road home, his heart light and his steps cheerful.

But three cunning thieves had been watching from the shadows. They had no money and no morals — but they had a plan. A very clever, very wicked plan.

The first thief slipped ahead down the road. He waited behind a tree, and as the Brahmin passed, he called out in a tone of deep concern:

"O wise Brahmin! Why on earth are you carrying a dead dog on your shoulders?"`,
        hi: `एक छोटे से गाँव में, मित्र शर्मा नाम के एक भले ब्राह्मण ने एक बड़ा यज्ञ सम्पन्न किया था। इनाम में एक धनी व्यापारी ने उन्हें एक अच्छी, तंदुरुस्त बकरी उपहार में दी।

मित्र शर्मा बहुत खुश हुए। उन्होंने बकरी को कंधे पर उठाया और घर की लंबी राह पर चल पड़े, दिल हल्का और कदम हर्षित।

लेकिन तीन चालाक ठग परछाईं में बैठे सब देख रहे थे। उनके पास न पैसा था, न ईमान — लेकिन एक योजना थी। बहुत चालाक, बहुत दुष्ट योजना।

पहला ठग आगे राह पर फिसल गया। वह एक पेड़ के पीछे छुप गया, और जब ब्राह्मण पास से गुज़रा, गहरी चिंता के स्वर में बोला:

"हे विद्वान ब्राह्मण! आप कंधे पर मरे हुए कुत्ते को क्यों उठाए चल रहे हैं?"`,
      },
      question: {
        en: 'The Brahmin has a goat on his shoulders — everyone can see that! What does he do when the thief calls it a dead dog?',
        hi: 'ब्राह्मण के कंधे पर बकरी है — यह सब देख सकते हैं! जब ठग उसे मरा कुत्ता कहता है, तो वे क्या करते हैं?',
      },
      choices: [
        { text: { en: '😠 Scold the thief — "Are you blind? This is a goat!"',             hi: '😠 ठग को डाँटो — "क्या तुम अंधे हो? यह बकरी है!"' },    next: 'second_thief' },
        { text: { en: '🤔 Feel confused... could there be something wrong with the goat?', hi: '🤔 उलझन में पड़ जाओ... क्या बकरी में कुछ गड़बड़ है?' },       next: 'second_thief' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Second thief steps out from behind a boulder. Brahmin's
    // voice wobbles — the first seed of doubt takes root.
    // IMAGE: second-thief-doubt.jpg — Brahmin uncertain, second
    //        stranger emerging from boulder, doubt on his face
    // ──────────────────────────────────────────────────────────
    second_thief: {
      scene: 'forest_path',
      image: '/images/the-brahmins-goat/the-brahmins-goat-second-thief-doubt.jpeg',
      text: {
        en: `The Brahmin shook his head and walked on. "Foolish man," he muttered. "This is clearly a goat."

But a seed of doubt had been planted — tiny, barely felt — like a pebble in a sandal.

Half a mile down the road, the second thief stepped out from behind a boulder, wearing a look of great concern.

"O Brahmin! I have great respect for your learning, so I must ask — why are you carrying a dead dog? Are you not a Brahmin? Is this not against your customs?"

Mitra Sharma stopped. He craned his neck to look at the animal on his back. It was wriggling. It was warm. It had horns.

"This is a goat!" he said — but his voice wobbled, just a little.`,
        hi: `ब्राह्मण ने सिर हिलाया और आगे चले। "मूर्ख आदमी," वे बुदबुदाए। "यह साफ़ बकरी है।"

लेकिन संदेह का एक बीज बोया जा चुका था — छोटा सा, बमुश्किल महसूस होता — जूते में कंकड़ की तरह।

आधे मील आगे, दूसरा ठग एक चट्टान के पीछे से निकला, चेहरे पर गहरी चिंता लिए।

"हे ब्राह्मण! मुझे आपकी विद्वता का बहुत आदर है, इसलिए पूछना पड़ेगा — आप मरे हुए कुत्ते को क्यों उठाए हैं? क्या आप ब्राह्मण नहीं हैं? क्या यह आपकी मर्यादा के विरुद्ध नहीं है?"

मित्र शर्मा रुक गए। उन्होंने पीठ पर बैठे जानवर को देखने के लिए गर्दन मोड़ी। वह हिल रही थी। गर्म थी। उसके सींग थे।

"यह बकरी है!" उन्होंने कहा — लेकिन आवाज़ थोड़ी काँपी।`,
      },
      question: {
        en: 'Two strangers have now said the same strange thing. What should the Brahmin do?',
        hi: 'दो अजनबी अब एक ही अजीब बात कह चुके हैं। ब्राह्मण को क्या करना चाहिए?',
      },
      choices: [
        { text: { en: '💪 Trust his own eyes — two wrong people are still wrong', hi: '💪 अपनी आँखों पर भरोसा रखो — दो गलत लोग भी गलत ही हैं' }, next: 'third_thief' },
        { text: { en: '😰 Maybe put the goat down and inspect it more carefully?',  hi: '😰 शायद बकरी को नीचे रखकर ध्यान से जाँचें?' },                next: 'third_thief' },
      ],
    },

    // ── NODE 3 ─────────────────────────────────────────────────
    // Third thief appears at a bend in the road. Brahmin's hands
    // tremble. The big decision moment — hold firm or flee?
    // IMAGE: third-thief-decision.jpg — Brahmin frozen at bend,
    //        one thief before him arms raised, face anguished
    // ──────────────────────────────────────────────────────────
    third_thief: {
      scene: 'forest_path',
      image: '/images/the-brahmins-goat/the-brahmins-goat-third-thief-decision.jpeg',
      text: {
        en: `Mitra Sharma walked on, faster now, more anxious.

"Two people cannot both be wrong," a small, traitorous voice whispered inside him. "What if...?"

Then — as if summoned by that very thought — the third thief appeared at a bend in the road. He threw his hands up in horror.

"O great and learned Brahmin! I am shocked! Deeply shocked! How can a man of your stature carry a dead dog through the village? People will talk! Your reputation will be ruined! Please, set it down — I beg you!"

Three strangers. Three times. The same words.

Mitra Sharma's legs slowed. His hands trembled. The goat on his shoulders suddenly felt strange, unfamiliar — like something he could no longer quite trust.

"Can three people all be wrong?" he thought.`,
        hi: `मित्र शर्मा आगे चले, अब तेज़ कदमों से, ज़्यादा बेचैन।

"दो लोग दोनों गलत नहीं हो सकते," एक छोटी, विश्वासघाती आवाज़ उनके भीतर फुसफुसाई। "अगर...?"

तब — जैसे उसी विचार से बुलाया गया हो — तीसरा ठग रास्ते के मोड़ पर प्रकट हुआ। उसने भयभीत होकर हाथ उठाए।

"हे महान और विद्वान ब्राह्मण! मैं स्तब्ध हूँ! बहुत स्तब्ध! आप जैसा व्यक्ति गाँव से मरा हुआ कुत्ता उठाकर कैसे जा सकता है? लोग बातें बनाएंगे! आपकी प्रतिष्ठा बर्बाद हो जाएगी! कृपया इसे नीचे रख दें — मैं विनती करता हूँ!"

तीन अजनबी। तीन बार। एक ही बात।

मित्र शर्मा के कदम धीमे पड़े। हाथ काँपे। कंधे पर बैठी बकरी अचानक अजीब, अपरिचित लगने लगी — जैसे कोई चीज़ जिस पर अब भरोसा न हो।

"क्या तीन लोग सब गलत हो सकते हैं?" उन्होंने सोचा।`,
      },
      question: {
        en: 'Three people. Same lie. The goat is RIGHT THERE. What does the Brahmin do?',
        hi: 'तीन लोग। एक ही झूठ। बकरी सामने ही है। ब्राह्मण क्या करते हैं?',
      },
      choices: [
        { text: { en: '🐐 Hold firm — "I carried this goat from the merchant\'s house. It IS a goat!"', hi: '🐐 अडिग रहो — "मैं यह बकरी व्यापारी के घर से लाया हूँ। यह बकरी ही है!"' }, next: 'brahmin_holds' },
        { text: { en: '😱 Set the goat down and flee — three people must know something!',               hi: '😱 बकरी नीचे रखो और भागो — तीन लोग कुछ तो जानते होंगे!' },                          next: 'brahmin_decides' },
      ],
    },

    // ── NODE 4a — PATH A (Brave) ────────────────────────────────
    // Brahmin stands still, confronts the third thief with calm
    // confidence, adjusts goat and walks away. Thieves stunned.
    // IMAGE: brahmin-holds-firm.jpg — Brahmin tall and steady,
    //        goat on shoulders, thief before him looking startled
    // ──────────────────────────────────────────────────────────
    brahmin_holds: {
      scene: 'forest_path',
      image: '/images/the-brahmins-goat/the-brahmins-goat-brahmin-holds-firm.jpg',
      isAlternate: true,
      text: {
        en: `Mitra Sharma stood very still.

He closed his eyes. He breathed slowly.

Then he opened his eyes and looked directly at the third thief.

"I received this goat from the merchant Dhanadatta's own hands, less than one hour ago. I have carried it on my shoulders. It is warm. It is alive. It has horns, four legs, and a beard. Three of you have called it a dead dog. But I have eyes, hands, and a mind — and I know what I am holding."

He adjusted the goat on his shoulders and walked on.

The third thief, caught off guard, watched him go. He ran to find his companions.

"He didn't fall for it," the thief said, breathless.

The second thief shook his head in grudging respect. "He trusted himself."`,
        hi: `मित्र शर्मा बिल्कुल स्थिर खड़े हो गए।

उन्होंने आँखें बंद कीं। धीरे साँस ली।

फिर आँखें खोलकर सीधे तीसरे ठग को देखा।

"यह बकरी मुझे व्यापारी धनदत्त के हाथों से एक घंटे से भी कम पहले मिली है। मैं इसे कंधों पर उठाए चल रहा हूँ। यह गर्म है। जीवित है। इसके सींग हैं, चार पैर हैं, दाढ़ी है। तुम तीनों ने इसे मरा कुत्ता कहा। लेकिन मेरे पास आँखें हैं, हाथ हैं, और दिमाग है — और मैं जानता हूँ मैं क्या पकड़े हूँ।"

उन्होंने बकरी को कंधे पर ठीक किया और आगे चल दिए।

तीसरा ठग, हक्काबक्का, उन्हें जाते देखता रहा। फिर दौड़कर अपने साथियों के पास गया।

"वह फँसा नहीं," ठग ने हाँफते हुए कहा।

दूसरे ठग ने अनिच्छापूर्ण सम्मान से सिर हिलाया। "उसने खुद पर भरोसा किया।"`,
      },
      question: {
        en: 'The Brahmin walked away with his goat — and his dignity. What gave him the strength to resist?',
        hi: 'ब्राह्मण बकरी के साथ — और अपनी गरिमा के साथ — चले गए। उन्हें विरोध करने की शक्ति कहाँ से मिली?',
      },
      choices: [
        { text: { en: '🧠 He separated what he KNEW from what he was being told to fear',   hi: '🧠 उन्होंने जो वे जानते थे और जो डराया जा रहा था उसे अलग किया' },  next: 'ending_strength' },
        { text: { en: '🦁 Courage — it takes bravery to trust yourself against a crowd',    hi: '🦁 साहस — भीड़ के सामने खुद पर भरोसा करने के लिए हिम्मत चाहिए' }, next: 'ending_strength' },
      ],
    },

    // ── NODE 4b — PATH B (Tricked) ──────────────────────────────
    // Brahmin's nerve breaks — flings goat off, runs in disgust.
    // Thieves laugh. Goat stands alone. Later: wise elder speaks.
    // IMAGE: goat-abandoned.jpg — Brahmin fleeing, goat alone,
    //        three figures laughing in the shadows
    // ──────────────────────────────────────────────────────────
    brahmin_decides: {
      scene: 'forest_path',
      image: '/images/the-brahmins-goat/the-brahmins-goat-goat-abandoned.jpg',
      text: {
        en: `Mitra Sharma's nerve broke.

He flung the goat off his shoulders, leaped away with a cry of disgust, and ran down the road without looking back — convinced beyond all reason that he had been carrying something unclean.

The three thieves watched him go, then looked at each other and burst out laughing.

The goat stood on the road, blinking calmly.

The thieves led it away, delighted with their work.

Later, Mitra Sharma met a wise elder in the village who listened to his tale. The elder was quiet for a moment.

Then he said: "You saw it with your own eyes. You felt it with your own hands. But you trusted three strangers more than your own senses. Tell me — what did you actually know, and what did you only fear?"

The Brahmin had no answer.`,
        hi: `मित्र शर्मा की हिम्मत टूट गई।

उन्होंने बकरी को कंधे से फेंका, घृणा की चीख के साथ उछले, और पीछे मुड़े बिना राह पर दौड़ पड़े — पूरी तरह आश्वस्त कि वे कुछ अपवित्र उठाए हुए थे।

तीनों ठगों ने उन्हें जाते देखा, फिर एक-दूसरे को देखा और हँसी में फूट पड़े।

बकरी सड़क पर खड़ी, शांति से पलकें झपकाती रही।

ठग उसे ले गए, अपने काम से प्रसन्न।

बाद में, मित्र शर्मा की मुलाकात गाँव के एक बुद्धिमान बुज़ुर्ग से हुई जिन्होंने उनकी कहानी सुनी। बुज़ुर्ग एक पल चुप रहे।

फिर बोले: "आपने अपनी आँखों से देखा। अपने हाथों से महसूस किया। लेकिन तीन अजनबियों पर अपनी खुद की इंद्रियों से ज़्यादा भरोसा किया। बताइए — आप वास्तव में क्या जानते थे, और क्या केवल डर रहे थे?"

ब्राह्मण के पास कोई जवाब नहीं था।`,
      },
      question: {
        en: 'The Brahmin lost his goat to a lie he chose to believe. What was the real mistake?',
        hi: 'ब्राह्मण ने अपनी बकरी एक झूठ को खोई जिसे उन्होंने मानना चुना। असली गलती क्या थी?',
      },
      choices: [
        { text: { en: '👁️ He stopped trusting what he could see and feel for himself',  hi: '👁️ उन्होंने जो खुद देख और महसूस कर सकते थे उस पर भरोसा करना बंद कर दिया' }, next: 'ending_wisdom' },
        { text: { en: '🗣️ He gave three strangers the power to define his own reality', hi: '🗣️ उन्होंने तीन अजनबियों को अपनी हकीकत तय करने की ताकत दे दी' },           next: 'ending_wisdom' },
      ],
    },

    // ── NODE 5a — PATH A ENDING ─────────────────────────────────
    // Brahmin arrives home safely with goat. Next day tells his
    // children the story — a warm, triumphant family moment.
    // IMAGE: ending-wisdom.jpg — Brahmin under banyan tree at
    //        dawn, goat beside him, children gathered at his feet
    // ──────────────────────────────────────────────────────────
    ending_strength: {
      scene: 'forest_dawn',
      image: '/images/the-brahmins-goat/the-brahmins-goat-ending-wisdom.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `Mitra Sharma arrived home with his goat, cooked a good meal, and slept soundly.

The next day he told his children what had happened on the road.

"Three men tried to make you believe a lie?" his daughter asked.

"They tried," said Mitra Sharma. "And for a moment, I almost let them. The first time they said it, I knew it was false. The second time, I wobbled. The third time, I nearly ran."

"What stopped you?" his son asked.

"I asked myself — what do I actually know? Not what do I fear, not what others are telling me. What do I KNOW?" He smiled. "And I knew I was holding a goat."

The Panchatantra teaches:
"The one who trusts their own tested knowledge against a chorus of false voices is worth more than a hundred who bow to the loudest mouth in the room."`,
        hi: `मित्र शर्मा बकरी के साथ घर पहुँचे, अच्छा खाना बनाया, और चैन से सोए।

अगले दिन उन्होंने अपने बच्चों को राह में जो हुआ वो बताया।

"तीन लोगों ने आपको झूठ मनवाने की कोशिश की?" उनकी बेटी ने पूछा।

"कोशिश की," मित्र शर्मा ने कहा। "और एक पल के लिए, मैं लगभग मान बैठा। पहली बार जब उन्होंने कहा, मुझे पता था यह झूठ है। दूसरी बार, मैं डगमगाया। तीसरी बार, मैं लगभग भाग गया।"

"आपको किसने रोका?" उनके बेटे ने पूछा।

"मैंने खुद से पूछा — मैं वास्तव में क्या जानता हूँ? यह नहीं कि मैं क्या डर रहा हूँ, यह नहीं कि दूसरे क्या कह रहे हैं। मैं क्या जानता हूँ?" वे मुस्कुराए। "और मुझे पता था कि मेरे हाथ में बकरी है।"

पञ्चतन्त्र सिखाता है:
"जो अपने परखे हुए ज्ञान पर झूठी आवाज़ों के शोर में भरोसा रखता है, वह उन सौ लोगों से बेहतर है जो कमरे में सबसे ऊँची आवाज़ के आगे झुक जाते हैं।"`,
      },
      lesson: { en: "What you know with your own eyes and mind is more trustworthy than what a crowd repeats. A lie doesn't become truth just because it's told three times.", hi: 'जो आप अपनी आँखों और दिमाग से जानते हैं वह भीड़ की दोहराई बात से ज़्यादा भरोसेमंद है। झूठ तीन बार बोलने से सच नहीं बनता।' },
      lessonIcon: '🦁',
    },

    // ── NODE 5b — PATH B ENDING ─────────────────────────────────
    // Thieves are caught by the village headman, goat returned.
    // Brahmin confronts the three thieves with a quiet speech.
    // IMAGE: ending-caught.jpg — thieves heads bowed before
    //        Brahmin and headman, goat beside Brahmin, village
    // ──────────────────────────────────────────────────────────
    ending_wisdom: {
      scene: 'village',
      image: '/images/the-brahmins-goat/the-brahmins-goat-ending-caught.jpeg',
      isEnding: true,
      text: {
        en: `The thieves led the goat away, laughing.

But they did not celebrate for long.

A farmer saw them with an unfamiliar goat and reported them to the village headman. The thieves were caught, questioned, and made to return the goat to Mitra Sharma with an apology.

Mitra Sharma stood before the three thieves and said quietly:

"You did not steal my goat with your hands. You stole it with words. You found a crack in my mind — the fear of being wrong — and you pushed through it."

He paused.

"I will spend the rest of my life making that crack smaller."

The Panchatantra teaches:
"A single lie has no power. But a lie told with confidence, repeated by many, can make a wise man doubt his own hands.
Guard your mind as you would guard your home — for both can be entered without a key."`,
        hi: `ठग बकरी लेकर चल दिए, हँसते हुए।

लेकिन वे ज़्यादा देर खुश नहीं रहे।

एक किसान ने उन्हें अनजानी बकरी के साथ देखा और गाँव के मुखिया को बताया। ठग पकड़े गए, पूछताछ हुई, और उन्हें मित्र शर्मा को माफ़ी के साथ बकरी वापस करनी पड़ी।

मित्र शर्मा तीनों ठगों के सामने खड़े हुए और शांति से बोले:

"तुमने मेरी बकरी हाथों से नहीं चुराई। तुमने शब्दों से चुराई। तुमने मेरे मन में एक दरार ढूँढी — गलत होने का डर — और उसमें से घुस गए।"

वे रुके।

"मैं बाकी ज़िंदगी वह दरार छोटी करने में बिताऊँगा।"

पञ्चतन्त्र सिखाता है:
"एक अकेले झूठ में कोई ताकत नहीं होती। लेकिन विश्वास के साथ बोला, कई लोगों द्वारा दोहराया गया झूठ, एक बुद्धिमान व्यक्ति को भी अपने हाथों पर शक करा सकता है।
अपने मन की रक्षा वैसे करो जैसे अपने घर की — क्योंकि दोनों में बिना चाबी के प्रवेश हो सकता है।"`,
      },
      lesson: { en: "A lie gains power only when we choose to believe it. Trust what you know — not just what you are told.", hi: 'झूठ में ताकत तभी आती है जब हम उसे मानना चुनते हैं। जो आप जानते हैं उस पर भरोसा करो — सिर्फ जो बताया जाए उस पर नहीं।' },
      lessonIcon: '🐐',
    },

  },
};

export default brahminsGoat;