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
        en: 'Your father places milk before a cobra with folded hands. He\'s not afraid. He\'s grateful. You\'ve never seen him look like that before. What do you feel watching him?',
        hi: 'तुम्हारे पिता हाथ जोड़कर नाग के सामने दूध रखते हैं। वे डरे नहीं हैं। कृतज्ञ हैं। तुमने उन्हें पहले कभी ऐसे नहीं देखा। उन्हें देखकर तुम क्या महसूस करते हो?',
      },
      choices: [
        { text: { en: 'Something quiet. Like he knows something I don\'t.', hi: 'कुछ शांत-सा। जैसे वे कुछ जानते हैं जो मैं नहीं जानता।' }, next: 'cobra_gifts' },
      ],
    },

    cobra_gifts: {
      scene: 'village',
      text: {
        en: `The next morning, Haridatta returned to the anthill and found — inside the clay bowl — a gleaming gold coin.\n\nHe stared at it. Then he filled the bowl with milk again and went home.\n\nThe next morning, another gold coin.\n\nEvery day, without fail, the cobra left a gold coin in the bowl. Haridatta's fortunes changed. His fields prospered. His home grew warm and full.\n\nYears passed. Haridatta tended the cobra with quiet devotion — fresh milk every morning, a respectful bow, nothing more asked.\n\nThen one day, Haridatta had to travel to a distant village. He asked his young son to tend the cobra while he was away.`,
        hi: `अगली सुबह, हरिदत्त बाँबी के पास वापस आया और पाया — मिट्टी के कटोरे में — एक चमकता सोने का सिक्का।\n\nवह उसे देखता रहा। फिर उसने कटोरे में फिर से दूध भरा और घर चला गया।\n\nअगली सुबह, एक और सोने का सिक्का।\n\nहर दिन, बिना चूके, नाग कटोरे में एक सोने का सिक्का छोड़ता था। हरिदत्त का भाग्य बदल गया। उसके खेत फले-फूले। उसका घर गर्म और भरा हो गया।\n\nसाल बीत गए। हरिदत्त ने नाग की शांत भक्ति से देखभाल की — हर सुबह ताज़ा दूध, एक सम्मानजनक प्रणाम, कुछ और नहीं माँगा।\n\nफिर एक दिन, हरिदत्त को एक दूर के गाँव जाना पड़ा। उसने अपने युवा पुत्र से कहा कि वह उसकी अनुपस्थिति में नाग की देखभाल करे।`,
      },
      question: {
        en: 'Your father just left. The cobra\'s anthill is right there. You know about the gold coins. You\'re alone. What moves in you?',
        hi: 'तुम्हारे पिता अभी गए। नाग की बाँबी वहीं है। तुम्हें सोने के सिक्कों के बारे में पता है। तुम अकेले हो। तुम्हारे भीतर क्या हिलता है?',
      },
      choices: [
        { text: { en: 'One coin a day is so slow. The anthill must be full.',    hi: 'एक सिक्का एक दिन बहुत धीमा है। बाँबी भरी होनी चाहिए।' },    next: 'son_arrives' },
        { text: { en: 'Father trusted me with this. I\'ll do exactly what he did.', hi: 'पिताजी ने मुझ पर भरोसा किया। वही करूँगा जो उन्होंने किया।' }, next: 'son_good' },
      ],
    },

    son_good: {
      scene: 'village',
      isAlternate: true,
      text: {
        en: `The son tended the cobra faithfully — milk every morning, a quiet bow, nothing more.\n\nWhen Haridatta returned, he found his son waiting with a calm face and the same number of gold coins as days passed.\n\n"You asked for nothing extra?" Haridatta said.\n\n"The cobra gives what it gives," the son replied. "It is not ours to demand more."\n\nHaridatta embraced his son with tears in his eyes.\n\n"You have understood something that takes most men a lifetime to learn," he said. "That gratitude is the seed of abundance — and greed is the drought that withers it."`,
        hi: `पुत्र ने नाग की वफ़ादारी से देखभाल की — हर सुबह दूध, एक शांत प्रणाम, कुछ और नहीं।\n\nजब हरिदत्त वापस आया, उसने अपने पुत्र को शांत चेहरे के साथ और बीते दिनों जितने सोने के सिक्कों के साथ प्रतीक्षा करते पाया।\n\n"तुमने कुछ अतिरिक्त नहीं माँगा?" हरिदत्त ने कहा।\n\n"नाग जो देता है वह देता है," पुत्र ने उत्तर दिया। "हमें अधिक माँगने का अधिकार नहीं है।"\n\nहरिदत्त ने आँखों में आँसू लिए अपने पुत्र को गले लगाया।\n\n"तुमने कुछ ऐसा समझ लिया है जिसे समझने में अधिकांश लोगों को जीवन भर लग जाता है," उसने कहा। "कि कृतज्ञता प्रचुरता का बीज है — और लालच वह सूखा है जो उसे मुरझा देता है।"`,
      },
      question: {
        en: 'Your father is back. He asks if everything was alright. You hand him the coins — every single one. What do you feel right now?',
        hi: 'पिताजी वापस आ गए। पूछते हैं सब ठीक था? तुम उन्हें सिक्के देते हो — एक-एक करके सब। अभी क्या महसूस हो रहा है?',
      },
      choices: [
        { text: { en: 'Like I didn\'t lose anything. Like I kept something.', hi: 'जैसे मैंने कुछ खोया नहीं। जैसे कुछ बचाया।' }, next: 'ending_contentment' },
      ],
    },

    son_arrives: {
      scene: 'village',
      text: {
        en: `The son placed the milk dutifully — but his eyes kept drifting to the anthill.\n\n"One coin a day," he thought. "But if the cobra has been giving coins for years, the anthill must be full of gold. Why wait? Why beg coin by coin when I could take it all at once?"\n\nThe next morning, instead of milk, the son came with a stick.\n\nHe struck at the cobra as it emerged.\n\nThe cobra was fast. It struck back — a single bite on the boy's hand. The son collapsed.\n\nBy some miracle he survived, but his hand bore the scar forever.\n\nWhen Haridatta returned, the cobra was gone. The bowl was empty. And it was never filled with gold again.`,
        hi: `पुत्र ने कर्तव्यपूर्वक दूध रखा — लेकिन उसकी आँखें बाँबी की ओर जाती रहीं।\n\n"एक सिक्का एक दिन," उसने सोचा। "लेकिन अगर नाग सालों से सिक्के दे रहा है, तो बाँबी सोने से भरी होनी चाहिए। इंतज़ार क्यों? एक-एक सिक्के के लिए भीख क्यों माँगूँ जब मैं सब एक बार में ले सकता हूँ?"\n\nअगली सुबह, दूध की जगह, पुत्र एक छड़ी लेकर आया।\n\nउसने निकलते हुए नाग पर प्रहार किया।\n\nनाग तेज़ था। उसने पलटकर काट लिया — लड़के के हाथ पर एक काटना। पुत्र गिर पड़ा।\n\nकिसी चमत्कार से वह बच गया, लेकिन उसके हाथ पर घाव का निशान हमेशा के लिए रह गया।\n\nजब हरिदत्त वापस आया, नाग जा चुका था। कटोरा खाली था। और वह कभी फिर सोने से नहीं भरा।`,
      },
      question: {
        en: 'You\'re standing over the anthill, stick in hand. The cobra is about to emerge. You can still put the stick down. What do you tell yourself?',
        hi: 'तुम बाँबी के ऊपर खड़े हो, हाथ में छड़ी। नाग निकलने वाला है। अभी भी छड़ी रख सकते हो। खुद से क्या कहते हो?',
      },
      choices: [
        { text: { en: 'I\'ve come this far. It\'s just a snake. Do it.', hi: 'इतनी दूर आ गया हूँ। बस एक साँप है। करो।' },        next: 'son_acts' },
        { text: { en: 'No. This isn\'t mine to take. Put it down.',      hi: 'नहीं। यह मेरा लेने का नहीं है। रख दो।' }, next: 'son_good' },
      ],
    },

    son_acts: {
      scene: 'village',
      text: {
        en: `Haridatta sat by the empty anthill for a long time.\n\nHe had lost more than gold. He had lost something rarer — a relationship built on trust, on daily faithfulness, on the simple act of showing up with an open hand and asking nothing in return.\n\nEventually he returned to the anthill every morning — with milk, with a bow, with patience.\n\nThe cobra never came back.\n\nBut Haridatta came anyway. Every morning.\n\nHis neighbours thought him foolish. But Haridatta understood something they did not:\n\nSome things, once broken by greed, cannot be repaired. You can only tend the empty space where they used to be, and hope your children learn what your own child did not.`,
        hi: `हरिदत्त खाली बाँबी के पास काफी देर तक बैठा रहा।\n\nउसने सोने से ज़्यादा खो दिया था। उसने कुछ दुर्लभ खो दिया था — विश्वास पर बनी एक संबंध, दैनिक वफ़ादारी पर, खुले हाथ से प्रकट होने और बदले में कुछ न माँगने के सरल कार्य पर।\n\nआखिरकार वह हर सुबह बाँबी पर वापस आने लगा — दूध के साथ, प्रणाम के साथ, धैर्य के साथ।\n\nनाग कभी वापस नहीं आया।\n\nलेकिन हरिदत्त फिर भी आता रहा। हर सुबह।\n\nउसके पड़ोसियों ने उसे मूर्ख समझा। लेकिन हरिदत्त ने कुछ ऐसा समझा जो वे नहीं समझते थे:\n\nकुछ चीज़ें, एक बार लालच से टूट जाने पर, ठीक नहीं हो सकतीं। तुम केवल उस खाली जगह की देखभाल कर सकते हो जहाँ वे हुआ करती थीं, और उम्मीद कर सकते हो कि तुम्हारे बच्चे वह सीखें जो तुम्हारे अपने बच्चे ने नहीं सीखा।`,
      },
      question: {
        en: 'Your father sits by the empty anthill every morning now. He doesn\'t blame you. He just sits. What does watching him do to you?',
        hi: 'तुम्हारे पिता अब हर सुबह खाली बाँबी के पास बैठते हैं। तुम्हें दोष नहीं देते। बस बैठते हैं। उन्हें देखना तुम्हारे साथ क्या करता है?',
      },
      choices: [
        { text: { en: 'It hurts more than the bite ever did.', hi: 'यह उस डंक से भी ज़्यादा दर्द देता है।' }, next: 'ending_wisdom' },
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
