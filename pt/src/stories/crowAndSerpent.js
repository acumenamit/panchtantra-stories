const crowAndSerpent = {
  id: 'crow-and-serpent',
  title:       { en: 'The Crow and the Serpent', hi: 'कौआ और साँप' },
  description: { en: 'A deadly serpent threatens a crow family\'s home. When strength fails, can a clever plan turn an enemy\'s own greed into his downfall?',
                 hi: 'एक घातक साँप कौए के परिवार के घर को खतरे में डालता है। जब ताकत नाकाम हो जाती है, तो क्या एक चतुर योजना दुश्मन के लालच को ही उसका पतन बना सकती है?' },
  theme:       { en: 'Strategy defeats strength', hi: 'नीति बल को परास्त करती है' },
  age: '8+',
  duration:    { en: '10–15 min', hi: '१०–१५ मिनट' },
  addedOn: '2025-12-01',
  featured: false,
  emoji: '🐦‍⬛',
  color: '#c084fc',
  book:        { en: 'Panchatantra — Book I', hi: 'पञ्चतन्त्र — प्रथम भाग' },
  progressSteps: ['start', 'seek_advice', 'the_plan', 'plan_works', 'ending_wisdom'],

  nodes: {
    start: {
      scene: 'village',
      text: {
        en: `High in a tall banyan tree at the edge of a village, a crow and his wife had built their nest. Every spring, they raised their chicks there — until the serpent arrived.\n\nA great black serpent had made his home in the hollow of the same tree. Every year, while the crow parents were away searching for food, the serpent would slither up and devour their eggs and newborn chicks.\n\nThe crow couple returned to find empty nests and broken shells, year after year.\n\n"We must leave this tree," the wife wept.\n\n"No," said the husband, his eyes hard with grief. "This is our home. I will find a way."`,
        hi: `एक गाँव के किनारे एक ऊँचे बरगद के पेड़ में, एक कौए और उसकी पत्नी ने अपना घोंसला बनाया था। हर वसंत में, वे वहाँ अपने चूज़े पालते थे — जब तक साँप नहीं आया।\n\nएक विशाल काले साँप ने उसी पेड़ के खोखले में अपना घर बना लिया था। हर साल, जब कौए के माता-पिता खाना ढूँढने बाहर जाते, साँप ऊपर चढ़ जाता और उनके अंडे और नवजात चूज़ों को खा जाता।\n\nकौए का जोड़ा साल दर साल खाली घोंसले और टूटे खोल पाकर वापस लौटता।\n\n"हमें यह पेड़ छोड़ देना चाहिए," पत्नी रोई।\n\n"नहीं," पति ने दुःख से कठोर आँखों से कहा। "यह हमारा घर है। मैं कोई रास्ता खोजूँगा।"`,
      },
      question: {
        en: 'You came home to an empty nest again. Your eggs — gone. This is the third year. Something burns in you. What does it want to do?',
        hi: 'तुम फिर से खाली घोंसले पर वापस आए। तुम्हारे अंडे — गए। यह तीसरा साल है। तुम्हारे भीतर कुछ जलता है। वह क्या करना चाहता है?',
      },
      choices: [
        { text: { en: 'Fly at him. Right now. I don\'t care.',  hi: 'अभी उस पर झपटो। अभी। परवाह नहीं।' }, next: 'direct_attack' },
        { text: { en: 'Wait. Anger won\'t fix this. Think.',    hi: 'रुको। गुस्से से यह ठीक नहीं होगा। सोचो।' }, next: 'seek_advice' },
      ],
    },

    direct_attack: {
      scene: 'village',
      isAlternate: true,
      text: {
        en: `The crow dived at the serpent with all his fury — pecking, clawing, crying out.\n\nBut the serpent was enormous. He simply raised his hood and hissed, and the crow was forced to retreat, breathless and bleeding from a small wound on his wing.\n\n"You are brave," his wife said, tending to him. "But bravery without a plan is just a faster way to lose."\n\nThe crow sat quietly, nursing his wing. She was right.\n\n"Let us go to our friend the jackal," he said at last. "He has faced worse enemies than us. Let us think before we act again."`,
        hi: `कौए ने पूरे गुस्से के साथ साँप पर झपट्टा मारा — चोंच मारते, पंजे चलाते, चिल्लाते हुए।\n\nलेकिन साँप विशाल था। उसने बस अपना फन उठाया और फुफकारा, और कौआ थका हुआ और पंख पर एक छोटे घाव के साथ पीछे हटने पर मजबूर हो गया।\n\n"तुम साहसी हो," उसकी पत्नी ने उसकी देखभाल करते हुए कहा। "लेकिन बिना योजना का साहस बस हारने का एक तेज़ तरीका है।"\n\nकौआ चुपचाप बैठकर अपने पंख की देखभाल करने लगा। वह सही थी।\n\n"चलो अपने मित्र सियार के पास चलते हैं," उसने आखिरकार कहा। "उसने हमसे भी बुरे दुश्मनों का सामना किया है। एक बार और काम करने से पहले सोचते हैं।"`,
      },
      question: {
        en: 'Your wing hurts. The serpent didn\'t even move from his spot. Your wife is right — that was just a faster way to lose. What do you feel right now?',
        hi: 'पंख दर्द करता है। साँप अपनी जगह से हिला भी नहीं। पत्नी सही है — यह तो बस हारने का तेज़ तरीका था। अभी क्या महसूस हो रहा है?',
      },
      choices: [
        { text: { en: 'Fine. I need a plan, not just fury.', hi: 'ठीक है। सिर्फ गुस्सा नहीं, एक योजना चाहिए।' }, next: 'seek_advice' },
      ],
    },

    seek_advice: {
      scene: 'forest_path',
      text: {
        en: `The crow flew to his old friend, a clever jackal who lived at the edge of the forest.\n\nHe told the jackal everything — the serpent, the stolen eggs, years of grief.\n\nThe jackal listened carefully, his amber eyes sharp with thought.\n\n"You cannot beat him with your beak," the jackal said. "He is bigger and stronger. But every creature, no matter how powerful, has one weakness."\n\n"What is the serpent's weakness?" the crow asked.\n\n"Greed," said the jackal simply. "And the pride that makes him careless. Now listen closely — I have a plan. But it requires you to be more cunning than afraid."`,
        hi: `कौआ अपने पुराने मित्र, एक चतुर सियार के पास उड़ा जो जंगल के किनारे रहता था।\n\nउसने सियार को सब कुछ बताया — साँप, चुराए गए अंडे, सालों का दुःख।\n\nसियार ने ध्यान से सुना, उसकी琥珀रंगी आँखें विचार में तेज़ थीं।\n\n"तुम उसे अपनी चोंच से नहीं हरा सकते," सियार ने कहा। "वह बड़ा और मज़बूत है। लेकिन हर प्राणी, चाहे वह कितना भी शक्तिशाली हो, की एक कमज़ोरी होती है।"\n\n"साँप की कमज़ोरी क्या है?" कौए ने पूछा।\n\n"लालच," सियार ने सरलता से कहा। "और वह अहंकार जो उसे लापरवाह बनाता है। अब ध्यान से सुनो — मेरे पास एक योजना है। लेकिन इसके लिए तुम्हें डरे हुए से ज़्यादा चालाक होना होगा।"`,
      },
      question: {
        en: 'The jackal says every powerful enemy has a crack. You\'ve been so afraid of this serpent for so long. But now — sitting here — something changes. What is it?',
        hi: 'सियार कहता है हर शक्तिशाली दुश्मन में एक दरार होती है। तुम इतने लंबे समय से इस साँप से इतना डरते रहे हो। लेकिन अब — यहाँ बैठे — कुछ बदलता है। वह क्या है?',
      },
      choices: [
        { text: { en: 'I stop seeing a monster. I start seeing a problem I can solve.', hi: 'मैं एक राक्षस देखना बंद कर देता हूँ। एक ऐसी समस्या देखने लगता हूँ जिसे मैं सुलझा सकता हूँ।' }, next: 'the_plan' },
      ],
    },

    the_plan: {
      scene: 'palace',
      text: {
        en: `The jackal whispered the plan. The crow's eyes grew wide — then bright.\n\nThe next day, the crow flew over the royal palace at the edge of the city. The queen and her ladies were bathing in the palace garden pool, their golden necklaces and jewels left on the steps.\n\nThe crow swooped down, snatched the most dazzling necklace in his beak, and flew slowly — deliberately, low enough to be seen — back toward his banyan tree.\n\nThe palace guards shouted. Then they ran.\n\nThe crow dropped the necklace into the hollow of the tree — right next to the sleeping serpent — and flew up to his nest to wait.`,
        hi: `सियार ने फुसफुसाकर योजना बताई। कौए की आँखें पहले चौड़ी हुईं — फिर चमक उठीं।\n\nअगले दिन, कौआ शहर के किनारे राजमहल के ऊपर उड़ा। रानी और उसकी सहेलियाँ महल के बगीचे के तालाब में नहा रही थीं, उनके सोने के हार और गहने सीढ़ियों पर रखे थे।\n\nकौए ने झपट्टा मारा, अपनी चोंच में सबसे चमकीला हार पकड़ा, और धीरे-धीरे — जानबूझकर, इतना नीचे कि देखा जाए — अपने बरगद के पेड़ की ओर उड़ा।\n\nमहल के रक्षक चिल्लाए। फिर दौड़ पड़े।\n\nकौए ने हार को पेड़ के खोखले में गिरा दिया — सोते हुए साँप के ठीक बगल में — और प्रतीक्षा करने के लिए अपने घोंसले में उड़ गया।`,
      },
      question: {
        en: 'The necklace is in the hollow. The guards are coming. You\'re in your nest above, watching. Your heart is hammering. What do you feel?',
        hi: 'हार खोखले में है। रक्षक आ रहे हैं। तुम ऊपर अपने घोंसले में, देख रहे हो। दिल धड़क रहा है। क्या महसूस हो रहा है?',
      },
      choices: [
        { text: { en: 'Please let it work. Please.',               hi: 'बस काम करे यह। बस।' },                       next: 'plan_works' },
        { text: { en: 'What if something goes wrong? What if they blame me?', hi: 'क्या होगा अगर कुछ गलत हो जाए? क्या होगा अगर मुझे दोषी ठहराएँ?' }, next: 'plan_risk' },
      ],
    },

    plan_risk: {
      scene: 'village',
      isAlternate: true,
      text: {
        en: `The crow waited in his nest, his heart pounding.\n\nWhat if the guards didn't follow? What if the serpent woke and moved the necklace? What if they blamed the crow instead?\n\nThen came the shouts. The guards arrived at the tree, peered into the hollow, and found — the gleaming necklace, and coiled beside it, the enormous black serpent.\n\nThe guards had long sticks. The serpent had nowhere to run.\n\nRaktamukha watched from above as the problem that had haunted him for years was swept away in mere minutes — not by his beak, but by a plan that used the world's own forces against his enemy.\n\n"This," thought the crow, "is what wisdom looks like."`,
        hi: `कौआ अपने घोंसले में इंतज़ार करता रहा, उसका दिल धड़क रहा था।\n\nक्या होगा अगर रक्षकों ने पीछा नहीं किया? क्या होगा अगर साँप जाग गया और हार हटा दिया? क्या होगा अगर उन्होंने इसके बजाय कौए को दोषी ठहराया?\n\nफिर चीखें आईं। रक्षक पेड़ पर पहुँचे, खोखले में झाँका, और पाया — चमकता हुआ हार, और उसके बगल में कुंडली मारे, विशाल काला साँप।\n\nरक्षकों के पास लंबी छड़ें थीं। साँप के पास भागने की कोई जगह नहीं थी।\n\nरक्तमुख ने ऊपर से देखा जैसे वह समस्या जो उसे सालों से सता रही थी, कुछ ही मिनटों में दूर हो गई — उसकी चोंच से नहीं, बल्कि एक ऐसी योजना से जिसने दुनिया की अपनी शक्तियों को उसके दुश्मन के खिलाफ इस्तेमाल किया।\n\n"यही," कौए ने सोचा, "बुद्धि कैसी दिखती है।"`,
      },
      question: {
        en: 'You were scared it would go wrong — and it went right. You\'re watching from above as the serpent is driven away. What settles in you?',
        hi: 'तुम डरे हुए थे कि गलत होगा — और सब सही हो गया। तुम ऊपर से देख रहे हो जैसे साँप को भगाया जा रहा है। तुम्हारे भीतर क्या ठहरता है?',
      },
      choices: [
        { text: { en: 'I didn\'t beat him with my beak. I understood him.', hi: 'मैंने उसे चोंच से नहीं हराया। मैंने उसे समझा।' }, next: 'ending_wisdom' },
        { text: { en: 'I couldn\'t have done this alone. The jackal gave me this.', hi: 'मैं यह अकेले नहीं कर सकता था। सियार ने मुझे यह दिया।' }, next: 'ending_counsel' },
      ],
    },

    plan_works: {
      scene: 'village',
      text: {
        en: `The guards reached the tree, peered into the dark hollow — and jumped back in alarm.\n\nThe great black serpent lay coiled around the royal necklace, hissing.\n\nThe guards had long sticks. They were many. The serpent was alone.\n\nThe crow watched from his branch as shouts and commotion filled the tree below. When silence returned, the hollow was empty. The serpent was gone — driven away, never to return.\n\nThat evening, the crow couple sat in their nest as the sun set golden over the banyan tree.\n\n"How did a necklace defeat a serpent?" the wife marvelled.\n\n"It didn't," said the crow quietly. "The serpent's own home defeated him. We just showed the right people where to look."`,
        hi: `रक्षक पेड़ पर पहुँचे, अँधेरे खोखले में झाँका — और चौंककर पीछे हट गए।\n\nविशाल काला साँप राजकीय हार के चारों ओर कुंडली मारे, फुफकारते हुए लेटा था।\n\nरक्षकों के पास लंबी छड़ें थीं। वे कई थे। साँप अकेला था।\n\nकौए ने अपनी डाल से देखा जैसे नीचे पेड़ में शोर और हड़कंप मचा। जब शांति वापस आई, खोखला खाली था। साँप चला गया था — भगाया गया, कभी वापस न आने के लिए।\n\nउस शाम, कौए का जोड़ा अपने घोंसले में बैठा जैसे सूरज बरगद के पेड़ पर सोने जैसा अस्त हुआ।\n\n"एक हार ने साँप को कैसे हराया?" पत्नी ने आश्चर्य से पूछा।\n\n"नहीं हराया," कौए ने चुपचाप कहा। "साँप के अपने घर ने उसे हराया। हमने बस सही लोगों को दिखाया कि कहाँ देखना है।"`,
      },
      question: {
        en: 'Your wife asks how a necklace defeated a serpent. You know the answer. What do you want to tell her?',
        hi: 'पत्नी पूछती है कि एक हार ने साँप को कैसे हराया। तुम जवाब जानते हो। उसे क्या बताना चाहते हो?',
      },
      choices: [
        { text: { en: 'It wasn\'t the necklace. I used his own greed against him.', hi: 'हार नहीं था। मैंने उसके लालच को उसके खिलाफ इस्तेमाल किया।' }, next: 'ending_wisdom' },
        { text: { en: 'It was the jackal. He saw what I couldn\'t.',                hi: 'सियार था। उसने वह देखा जो मैं नहीं देख सकता था।' },         next: 'ending_counsel' },
      ],
    },

    ending_wisdom: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `In the seasons that followed, the crow and his wife raised their chicks in peace.\n\nAnd whenever the young ones asked, "Father, how did you defeat the great serpent?" the crow would say:\n\n"I didn't fight him. I understood him. I understood what he wanted, where he lived, and what would bring his own world crashing down on him. A wise enemy is not defeated by force — he is defeated by knowing him better than he knows himself."\n\nThe Panchatantra teaches:\n"Before you raise your hand, raise your mind.\nThe cleverest victory is the one your enemy never sees coming."`,
        hi: `उसके बाद के मौसमों में, कौए और उसकी पत्नी ने शांति से अपने चूज़े पाले।\n\nऔर जब भी छोटे पूछते, "पिताजी, आपने महान साँप को कैसे हराया?" कौआ कहता:\n\n"मैंने उससे लड़ा नहीं। मैंने उसे समझा। मैं समझा कि वह क्या चाहता था, वह कहाँ रहता था, और क्या उसकी अपनी दुनिया को उस पर ही गिरा देगा। एक बुद्धिमान दुश्मन को ताकत से नहीं हराया जाता — उसे खुद से बेहतर जानकर हराया जाता है।"\n\nपञ्चतन्त्र सिखाता है:\n"हाथ उठाने से पहले, दिमाग उठाओ।\nसबसे चतुर जीत वह है जो तुम्हारा दुश्मन आते हुए कभी नहीं देखता।"`,
      },
      lesson: { en: 'Before you raise your hand, raise your mind. Strategy beats strength every time.', hi: 'हाथ उठाने से पहले, दिमाग उठाओ। नीति हर बार बल को हराती है।' },
      lessonIcon: '♟️',
    },

    ending_counsel: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The crow never forgot his debt to the jackal.\n\nEvery week, he flew to the edge of the forest with fruit and news from the village — a friendship of exchange, of mutual respect.\n\n"Why do you still visit him?" his wife asked one season. "The danger is long past."\n\n"Because," said the crow, "the day I needed wisdom I didn't have, he gave it freely. That is not a debt you repay once and forget. That is a friendship you tend for life."\n\nNitishastra teaches: "Surround yourself with those wiser than you, and wisdom will find you when you need it most."`,
        hi: `कौआ कभी सियार का अपना ऋण नहीं भूला।\n\nहर हफ्ते, वह जंगल के किनारे फल और गाँव की खबरें लेकर उड़ता — आदान-प्रदान की, आपसी सम्मान की दोस्ती।\n\n"तुम अभी भी उससे क्यों मिलते हो?" एक मौसम में उसकी पत्नी ने पूछा। "खतरा तो बहुत पहले खत्म हो गया।"\n\n"क्योंकि," कौए ने कहा, "जिस दिन मुझे वह बुद्धि चाहिए थी जो मेरे पास नहीं थी, उसने उसे स्वतंत्र रूप से दिया। यह एक ऐसा ऋण नहीं है जिसे तुम एक बार चुकाकर भूल जाओ। यह एक ऐसी दोस्ती है जिसे तुम जीवन भर निभाते हो।"\n\nनीतिशास्त्र सिखाता है: "अपने से बुद्धिमान लोगों के साथ रहो, और जब तुम्हें सबसे ज़्यादा ज़रूरत होगी, बुद्धि तुम तक आ जाएगी।"`,
      },
      lesson: { en: 'A wise friend in need is worth more than a thousand fair-weather allies.', hi: 'मुसीबत में एक बुद्धिमान मित्र हज़ार सुविधा के साथियों से ज़्यादा कीमती है।' },
      lessonIcon: '🦊',
    },
  },
};

export default crowAndSerpent;
