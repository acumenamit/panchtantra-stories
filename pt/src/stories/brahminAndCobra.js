const brahminAndCobra = {
  id: 'brahmin-and-cobra',
  title:       { en: 'The Brahmin and the Cobra', hi: 'ब्राह्मण और नाग' },
  description: { en: 'A poor farmer discovers a cobra in his field — and shows it kindness. But when greed enters the heart, even a divine gift can turn to dust.',
                 hi: 'एक गरीब किसान को अपने खेत में एक नाग मिलता है — और वह उस पर दया दिखाता है। लेकिन जब लालच दिल में घर कर लेता है, तो दैवीय वरदान भी राख बन सकता है।' },
  theme:       { en: 'Greed destroys what gratitude builds', hi: 'लालच वह नष्ट करता है जो कृतज्ञता बनाती है' },
  age: '7+',
  duration:    { en: '10–14 min', hi: '१०–१४ मिनट' },
  addedOn: '2026-01-15',
  featured: false,
  emoji: '🐍',
  color: '#fbbf24',
  book:        { en: 'Panchatantra — Book II', hi: 'पञ्चतन्त्र — द्वितीय भाग' },
  progressSteps: ['start', 'cobra_gifts', 'son_arrives', 'son_acts', 'ending_wisdom'],

  nodes: {
    start: {
      scene: 'village',
      text: {
        en: `In a small village, there lived a Brahmin farmer named Haridatta. His fields were dry, his crops thin, and his purse empty. He worked hard every day, but fortune never smiled on him.\n\nOne scorching afternoon, exhausted under a tree, he saw a large cobra emerge from an anthill at the edge of his field. The cobra raised its hood and looked at him steadily.\n\nHaridatta's heart hammered with fear. But then a thought came to him:\n\n"Perhaps this serpent is the guardian deity of my field. All these years I have neglected to honour him."\n\nHe fetched a clay bowl, filled it with fresh milk, and placed it before the cobra with folded hands.`,
        hi: `एक छोटे से गाँव में हरिदत्त नाम का एक ब्राह्मण किसान रहता था। उसके खेत सूखे थे, फसल पतली थी, और थैली खाली थी। वह हर दिन मेहनत करता था, लेकिन किस्मत ने कभी उस पर मुस्कुराया नहीं।\n\nएक झुलसाती दोपहर, एक पेड़ के नीचे थका हुआ बैठा था, तभी उसने अपने खेत के किनारे एक बाँबी से एक बड़ा नाग निकलते देखा। नाग ने अपना फन उठाया और उसे स्थिर दृष्टि से देखा।\n\nहरिदत्त का दिल डर से धड़का। लेकिन फिर एक विचार आया:\n\n"शायद यह सर्प मेरे खेत का रक्षक देवता है। इन सालों में मैंने उसका सम्मान करना भूल गया।"\n\nवह एक मिट्टी का कटोरा लाया, उसे ताज़े दूध से भरा, और नाग के सामने हाथ जोड़कर रख दिया।`,
      },
      question: {
        en: 'Haridatta shows the cobra reverence instead of fear. Was this wise or foolish?',
        hi: 'हरिदत्त नाग के प्रति डर की जगह श्रद्धा दिखाता है। क्या यह बुद्धिमानी थी या मूर्खता?',
      },
      choices: [
        { text: { en: '🙏 Wise — honouring what we don\'t understand costs little and may give much', hi: '🙏 बुद्धिमानी — जो हम नहीं समझते उसका सम्मान करने में थोड़ा लगता है और बहुत मिल सकता है' }, next: 'cobra_gifts' },
        { text: { en: '😬 Risky — but kindness to the unknown is rarely truly foolish', hi: '😬 जोखिम भरा — लेकिन अज्ञात के प्रति दयालुता कभी भी सच में मूर्खता नहीं होती' }, next: 'cobra_gifts' },
      ],
    },

    cobra_gifts: {
      scene: 'village',
      text: {
        en: `The next morning, Haridatta returned to the anthill and found — inside the clay bowl — a gleaming gold coin.\n\nHe stared at it. Then he filled the bowl with milk again and went home.\n\nThe next morning, another gold coin.\n\nEvery day, without fail, the cobra left a gold coin in the bowl. Haridatta's fortunes changed. His fields prospered. His home grew warm and full.\n\nYears passed. Haridatta tended the cobra with quiet devotion — fresh milk every morning, a respectful bow, nothing more asked.\n\nThen one day, Haridatta had to travel to a distant village. He asked his young son to tend the cobra while he was away.`,
        hi: `अगली सुबह, हरिदत्त बाँबी के पास वापस आया और पाया — मिट्टी के कटोरे में — एक चमकता सोने का सिक्का।\n\nवह उसे देखता रहा। फिर उसने कटोरे में फिर से दूध भरा और घर चला गया।\n\nअगली सुबह, एक और सोने का सिक्का।\n\nहर दिन, बिना चूके, नाग कटोरे में एक सोने का सिक्का छोड़ता था। हरिदत्त का भाग्य बदल गया। उसके खेत फले-फूले। उसका घर गर्म और भरा हो गया।\n\nसाल बीत गए। हरिदत्त ने नाग की शांत भक्ति से देखभाल की — हर सुबह ताज़ा दूध, एक सम्मानजनक प्रणाम, कुछ और नहीं माँगा।\n\nफिर एक दिन, हरिदत्त को एक दूर के गाँव जाना पड़ा। उसने अपने युवा पुत्र से कहा कि वह उसकी अनुपस्थिति में नाग की देखभाल करे।`,
      },
      question: {
        en: 'The son learns about the gold coins. What do you think he is feeling?',
        hi: 'पुत्र को सोने के सिक्कों के बारे में पता चलता है। आपको क्या लगता है वह क्या महसूस कर रहा है?',
      },
      choices: [
        { text: { en: '🤩 Excited — one coin a day is slow, but the anthill might hold much more!', hi: '🤩 उत्साहित — एक सिक्का एक दिन धीमा है, लेकिन बाँबी में बहुत कुछ हो सकता है!' }, next: 'son_arrives' },
        { text: { en: '😌 Grateful — he will tend the cobra just as his father did',               hi: '😌 कृतज्ञ — वह नाग की देखभाल वैसे ही करेगा जैसे उसके पिता ने की' },          next: 'son_good' },
      ],
    },

    son_good: {
      scene: 'village',
      isAlternate: true,
      text: {
        en: `The son tended the cobra faithfully — milk every morning, a quiet bow, nothing more.\n\nWhen Haridatta returned, he found his son waiting with a calm face and the same number of gold coins as days passed.\n\n"You asked for nothing extra?" Haridatta said.\n\n"The cobra gives what it gives," the son replied. "It is not ours to demand more."\n\nHaridatta embraced his son with tears in his eyes.\n\n"You have understood something that takes most men a lifetime to learn," he said. "That gratitude is the seed of abundance — and greed is the frost that kills it."`,
        hi: `पुत्र ने नाग की वफ़ादारी से देखभाल की — हर सुबह दूध, एक शांत प्रणाम, कुछ और नहीं।\n\nजब हरिदत्त वापस आया, उसने अपने पुत्र को शांत चेहरे के साथ और बीते दिनों जितने सोने के सिक्कों के साथ प्रतीक्षा करते पाया।\n\n"तुमने कुछ अतिरिक्त नहीं माँगा?" हरिदत्त ने कहा।\n\n"नाग जो देता है वह देता है," पुत्र ने उत्तर दिया। "हमें अधिक माँगने का अधिकार नहीं है।"\n\nहरिदत्त ने आँखों में आँसू लिए अपने पुत्र को गले लगाया।\n\n"तुमने कुछ ऐसा समझ लिया है जिसे समझने में अधिकांश लोगों को जीवन भर लग जाता है," उसने कहा। "कि कृतज्ञता प्रचुरता का बीज है — और लालच वह पाला है जो उसे मार देता है।"`,
      },
      question: {
        en: 'The son chose contentment over greed. What is the teaching here?',
        hi: 'पुत्र ने लालच पर संतोष चुना। यहाँ क्या शिक्षा है?',
      },
      choices: [
        { text: { en: '🌱 Enough is a feast — the one who knows when to stop never goes hungry', hi: '🌱 पर्याप्त ही भोज है — जो रुकना जानता है वह कभी भूखा नहीं रहता' }, next: 'ending_contentment' },
        { text: { en: '🙏 Gratitude protects us from ourselves',                                hi: '🙏 कृतज्ञता हमें हमसे ही बचाती है' },                                      next: 'ending_contentment' },
      ],
    },

    son_arrives: {
      scene: 'village',
      text: {
        en: `The son placed the milk dutifully — but his eyes kept drifting to the anthill.\n\n"One coin a day," he thought. "But if the cobra has been giving coins for years, the anthill must be full of gold. Why wait? Why beg coin by coin when I could take it all at once?"\n\nThe next morning, instead of milk, the son came with a stick.\n\nHe struck at the cobra as it emerged.\n\nThe cobra was fast. It struck back — a single bite on the boy's hand. The son collapsed.\n\nBy some miracle he survived, but his hand bore the scar forever.\n\nWhen Haridatta returned, the cobra was gone. The bowl was empty. And it was never filled with gold again.`,
        hi: `पुत्र ने कर्तव्यपूर्वक दूध रखा — लेकिन उसकी आँखें बाँबी की ओर जाती रहीं।\n\n"एक सिक्का एक दिन," उसने सोचा। "लेकिन अगर नाग सालों से सिक्के दे रहा है, तो बाँबी सोने से भरी होनी चाहिए। इंतज़ार क्यों? एक-एक सिक्के के लिए भीख क्यों माँगूँ जब मैं सब एक बार में ले सकता हूँ?"\n\nअगली सुबह, दूध की जगह, पुत्र एक छड़ी लेकर आया।\n\nउसने निकलते हुए नाग पर प्रहार किया।\n\nनाग तेज़ था। उसने पलटकर काट लिया — लड़के के हाथ पर एक काटना। पुत्र गिर पड़ा।\n\nकिसी चमत्कार से वह बच गया, लेकिन उसके हाथ पर घाव का निशान हमेशा के लिए रह गया।\n\nजब हरिदत्त वापस आया, नाग जा चुका था। कटोरा खाली था। और वह कभी फिर सोने से नहीं भरा।`,
      },
      question: {
        en: 'The son lost everything chasing what was never his to take. What went wrong in his thinking?',
        hi: 'पुत्र ने वह सब खो दिया जो कभी उसका था ही नहीं, उसका पीछा करते हुए। उसकी सोच में क्या गलत हुआ?',
      },
      choices: [
        { text: { en: '💭 He confused a gift with a right — gratitude turned to entitlement',      hi: '💭 उसने उपहार को अधिकार समझ लिया — कृतज्ञता हकदारी बन गई' },         next: 'son_acts' },
        { text: { en: '⏳ He wanted all at once what could only be given slowly, over time', hi: '⏳ वह एक बार में वह सब चाहता था जो केवल धीरे-धीरे, समय के साथ मिल सकता था' }, next: 'son_acts' },
      ],
    },

    son_acts: {
      scene: 'village',
      text: {
        en: `Haridatta sat by the empty anthill for a long time.\n\nHe had lost more than gold. He had lost something rarer — a relationship built on trust, on daily faithfulness, on the simple act of showing up with an open hand and asking nothing in return.\n\nEventually he returned to the anthill every morning — with milk, with a bow, with patience.\n\nThe cobra never came back.\n\nBut Haridatta came anyway. Every morning.\n\nHis neighbours thought him foolish. But Haridatta understood something they did not:\n\nSome things, once broken by greed, cannot be repaired. You can only tend the empty space where they used to be, and hope your children learn what your own child did not.`,
        hi: `हरिदत्त खाली बाँबी के पास काफी देर तक बैठा रहा।\n\nउसने सोने से ज़्यादा खो दिया था। उसने कुछ दुर्लभ खो दिया था — विश्वास पर बनी एक संबंध, दैनिक वफ़ादारी पर, खुले हाथ से प्रकट होने और बदले में कुछ न माँगने के सरल कार्य पर।\n\nआखिरकार वह हर सुबह बाँबी पर वापस आने लगा — दूध के साथ, प्रणाम के साथ, धैर्य के साथ।\n\nनाग कभी वापस नहीं आया।\n\nलेकिन हरिदत्त फिर भी आता रहा। हर सुबह।\n\nउसके पड़ोसियों ने उसे मूर्ख समझा। लेकिन हरिदत्त ने कुछ ऐसा समझा जो वे नहीं समझते थे:\n\nकुछ चीज़ें, एक बार लालच से टूट जाने पर, ठीक नहीं हो सकतीं। तुम केवल उस खाली जगह की देखभाल कर सकते हो जहाँ वे हुआ करती थीं, और उम्मीद कर सकते हो कि तुम्हारे बच्चे वह सीखें जो तुम्हारे अपने बच्चे ने नहीं सीखा।`,
      },
      question: {
        en: 'Haridatta kept returning even after losing everything. What does that tell us about him?',
        hi: 'हरिदत्त सब खोने के बाद भी आता रहा। यह हमें उसके बारे में क्या बताता है?',
      },
      choices: [
        { text: { en: '🙏 He valued the practice of gratitude, not just its rewards',          hi: '🙏 उसने कृतज्ञता के अभ्यास को महत्व दिया, न कि सिर्फ उसके पुरस्कारों को' }, next: 'ending_wisdom' },
        { text: { en: '💔 He was teaching himself — and anyone watching — what greed truly costs', hi: '💔 वह खुद को — और जो देख रहे थे उन्हें — सिखा रहा था कि लालच की असली कीमत क्या है' }, next: 'ending_wisdom' },
      ],
    },

    ending_contentment: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The fields of Haridatta flourished for many more years.\n\nAnd the story of his son — the one who chose contentment over a grasping hand — spread through the village as a different kind of treasure.\n\n"There are two kinds of wealth," Haridatta told his grandchildren.\n\n"The wealth that sits in your purse — which can be lost, stolen, or spent. And the wealth that sits in your character — which no one can take from you.\n\nChoose the second kind first, and the first will follow."`,
        hi: `हरिदत्त के खेत कई और सालों तक फले-फूले।\n\nऔर उसके पुत्र की कहानी — जिसने लालची हाथ के बजाय संतोष चुना — गाँव में एक अलग तरह के खज़ाने की तरह फैल गई।\n\n"दो तरह की संपत्ति होती है," हरिदत्त ने अपने पोते-पोतियों को बताया।\n\n"वह संपत्ति जो तुम्हारी थैली में बैठती है — जो खो सकती है, चुराई जा सकती है, या खर्च हो सकती है। और वह संपत्ति जो तुम्हारे चरित्र में बैठती है — जिसे कोई तुमसे नहीं ले सकता।\n\nपहले दूसरी तरह चुनो, और पहली अपने आप आ जाएगी।"`,
      },
      lesson: { en: 'Contentment is the greatest wealth — and gratitude is the key that unlocks it.', hi: 'संतोष सबसे बड़ी संपत्ति है — और कृतज्ञता वह चाबी है जो इसे खोलती है।' },
      lessonIcon: '🌾',
    },

    ending_wisdom: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The empty anthill stood at the edge of the field for many years.\n\nSome said it was a sad sight. Haridatta never thought so.\n\n"It reminds me," he said, "that every blessing carries a lesson inside it. The cobra gave gold — but the real gift was never the gold. It was the daily practice of showing up, of gratitude, of asking nothing beyond what is freely given."\n\nThe Panchatantra teaches:\n"What greed grasps at, it destroys.\nWhat gratitude tends, it multiplies.\nThe open hand receives more than the clenched fist ever will."`,
        hi: `खाली बाँबी कई सालों तक खेत के किनारे खड़ी रही।\n\nकुछ कहते थे यह दुखद दृश्य था। हरिदत्त ने कभी ऐसा नहीं सोचा।\n\n"यह मुझे याद दिलाती है," उसने कहा, "कि हर आशीर्वाद के अंदर एक सबक होता है। नाग ने सोना दिया — लेकिन असली उपहार कभी सोना नहीं था। यह रोज़ आने का अभ्यास था, कृतज्ञता का, जो स्वतंत्र रूप से दिया जाए उससे ज़्यादा कुछ न माँगने का।"\n\nपञ्चतन्त्र सिखाता है:\n"लालच जो पकड़ता है, उसे नष्ट कर देता है।\nकृतज्ञता जो पालती है, उसे गुणा कर देती है।\nखुला हाथ बंद मुट्ठी से कहीं अधिक पाता है।"`,
      },
      lesson: { en: 'Greed destroys in one moment what gratitude built over years. The open hand receives more than the clenched fist.', hi: 'लालच एक पल में वह नष्ट कर देता है जो कृतज्ञता ने सालों में बनाया। खुला हाथ बंद मुट्ठी से कहीं अधिक पाता है।' },
      lessonIcon: '🪙',
    },
  },
};

export default brahminAndCobra;
