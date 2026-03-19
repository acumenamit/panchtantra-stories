const monkeyAndCrocodile = {
  id: 'monkey-and-crocodile',
  title:       { en: 'The Monkey and the Crocodile', hi: 'बंदर और मगरमच्छ' },
  description: { en: 'A clever monkey befriends a crocodile — but the crocodile\'s greedy wife wants the monkey\'s heart. Can friendship survive betrayal?',
                 hi: 'एक चतुर बंदर एक मगरमच्छ से दोस्ती करता है — लेकिन मगरमच्छ की लालची पत्नी बंदर का दिल चाहती है। क्या दोस्ती विश्वासघात से बच सकती है?' },
  theme:       { en: 'Presence of mind defeats treachery', hi: 'सूझबूझ विश्वासघात को हराती है' },
  age: '7+',
  duration:    { en: '10–14 min', hi: '१०–१४ मिनट' },
  addedOn: '2025-11-01',
  featured: false,
  emoji: '🐒',
  color: '#34d399',
  book:        { en: 'Panchatantra — Book II', hi: 'पञ्चतन्त्र — द्वितीय भाग' },
  progressSteps: ['start', 'friendship_grows', 'on_the_river', 'monkey_escapes', 'ending_wisdom'],

  nodes: {
    start: {
      scene: 'river_bank',
      text: {
        en: `On the banks of a wide, sparkling river, there lived a clever monkey named Raktamukha. He spent his days leaping between the branches of a great rose-apple tree, eating its sweet fruit and watching the world below.\n\nOne day, a large crocodile named Karalamakara pulled himself onto the bank below the tree, looking tired and hungry.\n\nRaktamukha, who had a generous heart, tossed down a handful of ripe rose-apples.\n\n"Eat, friend!" he called. "There is plenty here!"\n\nThe crocodile looked up in surprise. No one had ever called him friend before.`,
        hi: `एक चौड़ी, चमकती नदी के किनारे, रक्तमुख नाम का एक चतुर बंदर रहता था। वह अपने दिन एक बड़े जामुन के पेड़ की डालियों पर कूदते हुए, मीठे फल खाते हुए और नीचे की दुनिया देखते हुए बिताता था।\n\nएक दिन, करालमकर नाम का एक बड़ा मगरमच्छ थका और भूखा होकर पेड़ के नीचे किनारे पर आया।\n\nरक्तमुख, जिसका दिल उदार था, ने मुट्ठी भर पके जामुन नीचे फेंके।\n\n"खाओ, मित्र!" उसने पुकारा। "यहाँ बहुत हैं!"\n\nमगरमच्छ ने आश्चर्य से ऊपर देखा। किसी ने उसे पहले कभी मित्र नहीं कहा था।`,
      },
      question: {
        en: 'Someone just called you "friend" for the first time. You didn\'t expect it. What moves in you?',
        hi: 'किसी ने पहली बार तुम्हें "मित्र" कहा। तुमने उम्मीद नहीं की थी। तुम्हारे भीतर क्या हिलता है?',
      },
      choices: [
        { text: { en: 'Something warm. I want to come back.',  hi: 'कुछ गर्म-सा। वापस आना चाहता हूँ।' }, next: 'friendship_grows' },
        { text: { en: 'Nothing. I don\'t need this.',          hi: 'कुछ नहीं। मुझे इसकी ज़रूरत नहीं।' }, next: 'no_friendship' },
      ],
    },

    friendship_grows: {
      scene: 'river_bank',
      text: {
        en: `Days turned to weeks. The crocodile returned every morning, and the monkey always had fruit waiting. They talked, laughed, and shared stories of the river and the trees.\n\nOne evening, Raktamukha sent home a large bundle of rose-apples with his friend. "For your wife," he said warmly. "From one home to another."\n\nKaralamakara's wife ate the fruit and found it delicious. But then a dark thought came to her.\n\n"If the fruit from that tree is so sweet," she thought, "imagine how sweet must be the heart of the monkey who eats this fruit every day..."\n\nShe called her husband and said sweetly: "I want the monkey's heart. Bring it to me."`,
        hi: `दिन हफ्तों में बदल गए। मगरमच्छ हर सुबह वापस आता, और बंदर के पास हमेशा फल तैयार रहते। वे बातें करते, हँसते, और नदी और पेड़ों की कहानियाँ साझा करते।\n\nएक शाम, रक्तमुख ने अपने मित्र के साथ जामुन का एक बड़ा गट्ठर घर भेजा। "तुम्हारी पत्नी के लिए," उसने गर्मजोशी से कहा। "एक घर से दूसरे घर तक।"\n\nकरालमकर की पत्नी ने फल खाया और उसे स्वादिष्ट पाया। लेकिन फिर उसे एक काला विचार आया।\n\n"अगर उस पेड़ का फल इतना मीठा है," उसने सोचा, "तो ज़रा सोचो उस बंदर का दिल कितना मीठा होगा जो हर दिन यह फल खाता है..."\n\nउसने अपने पति को बुलाया और मीठे स्वर में कहा: "मुझे बंदर का दिल चाहिए। इसे मेरे लिए ले आओ।"`,
      },
      question: {
        en: 'Your wife\'s words sit in your stomach like a stone. Your best friend is up in that tree right now, saving fruit for you. What do you feel?',
        hi: 'पत्नी के शब्द पेट में पत्थर की तरह बैठे हैं। तुम्हारा सबसे अच्छा दोस्त अभी उस पेड़ पर है, तुम्हारे लिए फल बचा रहा है। तुम क्या महसूस करते हो?',
      },
      choices: [
        { text: { en: 'I can\'t do it. I won\'t.',         hi: 'मैं यह नहीं कर सकता। नहीं करूँगा।' },    next: 'crocodile_refuses' },
        { text: { en: 'I don\'t have a choice. She\'s my wife.', hi: 'मेरे पास कोई चारा नहीं। वह मेरी पत्नी है।' }, next: 'on_the_river' },
      ],
    },

    no_friendship: {
      scene: 'river_bank',
      isAlternate: true,
      text: {
        en: `The crocodile took the fruit and slid back into the water without a word.\n\nRaktamukha watched him go, feeling a little sad.\n\nDays passed. The crocodile grew lonelier. He had food, yes — but no one to talk to, no one who remembered his name, no one who saved the best fruits just for him.\n\nOne morning, he found himself drifting back to the rose-apple tree. The monkey was still there.\n\n"I was rude before," the crocodile said gruffly. "Could we... start again?"\n\nRaktamukha smiled and tossed down a fruit. "A friend who arrives late is still a friend."`,
        hi: `मगरमच्छ फल लेकर बिना एक शब्द कहे पानी में वापस चला गया।\n\nरक्तमुख ने उसे जाते देखा, थोड़ा दुखी होकर।\n\nदिन बीतते गए। मगरमच्छ और अकेला होता गया। खाना था, हाँ — लेकिन बात करने वाला कोई नहीं, उसका नाम याद रखने वाला कोई नहीं, उसके लिए सबसे अच्छे फल बचाने वाला कोई नहीं।\n\nएक सुबह, वह खुद को जामुन के पेड़ की ओर बहता हुआ पाया। बंदर अभी भी वहाँ था।\n\n"मैं पहले असभ्य था," मगरमच्छ ने रूखेपन से कहा। "क्या हम... फिर से शुरू कर सकते हैं?"\n\nरक्तमुख मुस्कुराया और एक फल नीचे फेंका। "देर से आने वाला मित्र भी मित्र ही होता है।"`,
      },
      question: {
        en: 'Days have passed. The loneliness is heavier than you expected. You find yourself drifting back to the rose-apple tree. What do you tell yourself?',
        hi: 'दिन बीत गए। अकेलापन उम्मीद से ज़्यादा भारी है। खुद को जामुन के पेड़ की तरफ बहते पाते हो। खुद से क्या कहते हो?',
      },
      choices: [
        { text: { en: 'I was wrong to push him away. Let me try again.', hi: 'उसे दूर धकेलना गलत था। एक बार और कोशिश करता हूँ।' }, next: 'friendship_grows' },
      ],
    },

    crocodile_refuses: {
      scene: 'river_bank',
      isAlternate: true,
      text: {
        en: `"No," said the crocodile, surprising even himself with his firmness.\n\n"Raktamukha has done nothing but show me kindness. I will not betray him for anyone."\n\nHis wife raged and sulked for days. But the crocodile held firm.\n\nWhen he returned to the tree and told the monkey everything — his wife's demand, and his refusal — Raktamukha was quiet for a long time.\n\n"You chose truth over comfort," the monkey finally said. "That is rarer than you know, my friend. That is rarer than you know."\n\nTheir friendship, tested by fire, became the truest thing in the forest.`,
        hi: `"नहीं," मगरमच्छ ने कहा, अपनी दृढ़ता से खुद भी चौंककर।\n\n"रक्तमुख ने मेरे साथ सिर्फ दयालुता की है। मैं किसी के लिए भी उसके साथ विश्वासघात नहीं करूँगा।"\n\nउसकी पत्नी दिनों तक गुस्से में रही। लेकिन मगरमच्छ डटा रहा।\n\nजब वह पेड़ के पास वापस आया और बंदर को सब कुछ बताया — अपनी पत्नी की माँग, और उसका इनकार — रक्तमुख काफी देर तक चुप रहा।\n\n"तुमने आराम के बजाय सच चुना," बंदर ने आखिरकार कहा। "यह तुम जानते हो उससे ज़्यादा दुर्लभ है, मेरे मित्र। यह तुम जानते हो उससे ज़्यादा दुर्लभ है।"\n\nआग में परखी हुई उनकी दोस्ती जंगल की सबसे सच्ची चीज़ बन गई।`,
      },
      question: {
        en: 'You said no to your wife. You told your friend the truth. The friendship held. What do you feel now that the hardest moment has passed?',
        hi: 'तुमने पत्नी को मना किया। दोस्त को सच बताया। दोस्ती टिकी रही। सबसे कठिन पल गुज़र जाने के बाद अब क्या महसूस होता है?',
      },
      choices: [
        { text: { en: 'Some things are worth more than peace at home.', hi: 'कुछ चीज़ें घर की शांति से ज़्यादा कीमती होती हैं।' }, next: 'ending_loyalty' },
      ],
    },

    on_the_river: {
      scene: 'river_bank',
      text: {
        en: `Heavy with guilt, the crocodile swam to the monkey's tree the next morning.\n\n"Friend!" he called. "My wife is very ill. She wishes to meet you — she says only a holy monkey like you can cure her. Please come across the river with me."\n\nRaktamukha, worried for his friend's wife, leaped onto the crocodile's back without hesitation.\n\nThey were halfway across the deep river when the crocodile began to slow down... and then spoke the terrible truth.\n\n"I'm sorry, friend. My wife wants your heart. I have no choice."\n\nRaktamukha felt the world drop away beneath him. But he did not panic.`,
        hi: `अपराधबोध से भरा मगरमच्छ अगली सुबह बंदर के पेड़ पर तैरकर आया।\n\n"मित्र!" उसने पुकारा। "मेरी पत्नी बहुत बीमार है। वह तुमसे मिलना चाहती है — उसका कहना है कि तुम जैसा पवित्र बंदर ही उसे ठीक कर सकता है। कृपया मेरे साथ नदी पार चलो।"\n\nरक्तमुख, अपने मित्र की पत्नी के लिए चिंतित होकर, बिना हिचकिचाए मगरमच्छ की पीठ पर कूद गया।\n\nवे गहरी नदी के बीच में थे जब मगरमच्छ धीमा पड़ने लगा... और फिर उसने भयानक सच बोला।\n\n"माफ करना, मित्र। मेरी पत्नी तुम्हारा दिल चाहती है। मेरे पास कोई चारा नहीं।"\n\nरक्तमुख को लगा जैसे उसके नीचे से ज़मीन खिसक गई हो। लेकिन उसने घबराहट नहीं दिखाई।`,
      },
      question: {
        en: 'Your friend just told you he\'s taking you to your death. You\'re in the middle of a river. You can\'t swim to shore. What happens inside you right now?',
        hi: 'तुम्हारे दोस्त ने अभी बताया कि वह तुम्हें मौत की तरफ ले जा रहा है। नदी के बीच में हो। किनारे तक तैर नहीं सकते। अभी तुम्हारे भीतर क्या हो रहा है?',
      },
      choices: [
        { text: { en: 'Something goes very quiet. Start thinking.',  hi: 'कुछ बहुत शांत हो जाता है। सोचना शुरू करो।' }, next: 'monkey_escapes' },
        { text: { en: 'Every part of me wants to fight.',            hi: 'मेरा पूरा वजूद लड़ना चाहता है।' },              next: 'monkey_struggles' },
      ],
    },

    monkey_struggles: {
      scene: 'river_bank',
      isAlternate: true,
      text: {
        en: `Raktamukha thrashed and struggled, trying to leap into the water.\n\nBut the river was wide and deep, and the current was strong. He was tiring fast.\n\nThen — a moment of stillness. He stopped fighting and let his mind work instead.\n\n"Wait," he thought. "A crocodile cannot eat a heart that is not here. And I left my heart... back in the tree!"\n\nIt was the oldest trick — but told with such sudden calm confidence that the crocodile's grip loosened just enough.`,
        hi: `रक्तमुख छटपटाया और संघर्ष करने लगा, पानी में कूदने की कोशिश करते हुए।\n\nलेकिन नदी चौड़ी और गहरी थी, और धारा तेज़ थी। वह जल्दी थकने लगा।\n\nफिर — एक पल की शांति। उसने लड़ना बंद किया और इसके बजाय अपने दिमाग को काम करने दिया।\n\n"रुको," उसने सोचा। "मगरमच्छ वह दिल नहीं खा सकता जो यहाँ है ही नहीं। और मेरा दिल... पेड़ में पीछे रह गया!"\n\nयह सबसे पुरानी चाल थी — लेकिन इतनी अचानक शांत आत्मविश्वास के साथ कही गई कि मगरमच्छ की पकड़ थोड़ी ढीली हो गई।`,
      },
      question: {
        en: 'Fighting the river is burning you out. But somewhere in the exhaustion, your mind goes still. One thought arrives. What do you do with it?',
        hi: 'नदी से लड़ते-लड़ते थक रहे हो। लेकिन थकान में कहीं दिमाग शांत हो जाता है। एक विचार आता है। उसके साथ क्या करते हो?',
      },
      choices: [
        { text: { en: 'Stop. Think. I have one shot at this.', hi: 'रुको। सोचो। एक मौका है मेरे पास।' }, next: 'monkey_escapes' },
      ],
    },

    monkey_escapes: {
      scene: 'river_bank',
      text: {
        en: `Raktamukha took one slow, deep breath. Then he laughed.\n\n"Oh, dear friend — you should have told me earlier! I would have brought it!"\n\nThe crocodile blinked. "What?"\n\n"My heart! I don't carry it with me when I travel — I leave it safely in the tree. All monkeys do. Take me back and I'll climb up and get it for you!"\n\nThe crocodile, not the cleverest of creatures, turned around and swam back to the bank.\n\nThe moment they touched the shore, Raktamukha leaped high into the branches, his heart hammering with relief.\n\n"You fool!" he called down. "Who leaves their heart in a tree? But you — you left your wisdom in your wife's pocket, and your friendship in the river. Go home."`,
        hi: `रक्तमुख ने एक लंबी, गहरी साँस ली। फिर वह हँसा।\n\n"अरे, प्रिय मित्र — तुमने मुझे पहले क्यों नहीं बताया! मैं इसे ले आता!"\n\nमगरमच्छ ने पलकें झपकाईं। "क्या?"\n\n"मेरा दिल! जब मैं यात्रा करता हूँ तो मैं इसे अपने साथ नहीं ले जाता — मैं इसे पेड़ में सुरक्षित छोड़ देता हूँ। सभी बंदर ऐसा करते हैं। मुझे वापस ले चलो और मैं ऊपर चढ़कर तुम्हें दे दूँगा!"\n\nमगरमच्छ, जो बहुत चतुर प्राणी नहीं था, मुड़ा और किनारे की ओर तैरकर वापस आया।\n\nजैसे ही वे किनारे को छूए, रक्तमुख डालियों में ऊँचा कूद गया, उसका दिल राहत से धड़क रहा था।\n\n"मूर्ख!" उसने नीचे पुकारा। "कौन अपना दिल पेड़ में छोड़ता है? लेकिन तुम — तुमने अपनी बुद्धि अपनी पत्नी की जेब में छोड़ दी, और अपनी दोस्ती नदी में। घर जाओ।"`,
      },
      question: {
        en: 'You\'re safe. He\'s below, looking up at you. This was your friend. What do you feel right now?',
        hi: 'तुम सुरक्षित हो। वह नीचे है, तुम्हारी तरफ देख रहा है। यह तुम्हारा दोस्त था। अभी क्या महसूस हो रहा है?',
      },
      choices: [
        { text: { en: 'I\'m alive. That\'s what matters.',                  hi: 'मैं जीवित हूँ। यही मायने रखता है।' },                next: 'ending_wisdom' },
        { text: { en: 'I saved myself. But I lost something I can\'t get back.', hi: 'खुद को बचाया। लेकिन कुछ खो दिया जो वापस नहीं आएगा।' }, next: 'ending_friendship' },
      ],
    },

    ending_wisdom: {
      scene: 'river_bank', isEnding: true,
      text: {
        en: `Raktamukha sat in his tree for a long time, watching the river flow.\n\nHe had faced death — and beaten it not with claws or strength, but with a single calm thought at the right moment.\n\nThe Panchatantra teaches:\n"In times of danger, the one who keeps his head while others lose theirs shall always find a way."\n\nPresence of mind is not a gift you are born with. It is a habit you build — by staying curious, thinking clearly, and never letting fear make your decisions.`,
        hi: `रक्तमुख काफी देर तक अपने पेड़ में बैठकर नदी को बहते देखता रहा।\n\nउसने मृत्यु का सामना किया था — और उसे पंजों या ताकत से नहीं, बल्कि सही समय पर एक शांत विचार से हराया था।\n\nपञ्चतन्त्र सिखाता है:\n"संकट के समय, जो व्यक्ति तब भी अपना दिमाग शांत रखता है जब बाकी सब घबरा जाते हैं, वह हमेशा रास्ता खोज लेता है।"\n\nमन की शांति कोई जन्मजात उपहार नहीं है। यह एक आदत है जो तुम बनाते हो — जिज्ञासु रहकर, स्पष्ट सोचकर, और कभी भी डर को अपने फैसले न करने देकर।`,
      },
      lesson: { en: 'In the face of danger, a calm mind is sharper than any weapon.', hi: 'खतरे के सामने, शांत मन किसी भी हथियार से तेज़ होता है।' },
      lessonIcon: '🧠',
    },

    ending_friendship: {
      scene: 'river_bank', isEnding: true,
      text: {
        en: `As the seasons changed, Raktamukha sometimes saw the crocodile drifting past below — alone now, shunned by other river creatures who had heard the story.\n\nHe felt no hatred. Only a quiet sadness.\n\n"A good friend," the monkey thought, "is rarer than rose-apples in winter. And a friendship destroyed by greed leaves a hole that nothing else can fill."\n\nNitishastra teaches: "Test a friend in small things before trusting them in large ones. And be the kind of friend you yourself would wish to have."`,
        hi: `जैसे-जैसे मौसम बदले, रक्तमुख कभी-कभी मगरमच्छ को नीचे से अकेले गुज़रते देखता था — अब अकेला, दूसरे नदी के जानवरों द्वारा ठुकराया हुआ जिन्होंने यह कहानी सुन ली थी।\n\nउसे कोई नफ़रत नहीं थी। केवल एक शांत उदासी।\n\n"एक अच्छा मित्र," बंदर ने सोचा, "सर्दियों में जामुन से भी दुर्लभ है। और लालच से नष्ट की गई दोस्ती एक ऐसा खालीपन छोड़ती है जिसे कोई और चीज़ नहीं भर सकती।"\n\nनीतिशास्त्र सिखाता है: "बड़ी बातों में भरोसा करने से पहले छोटी बातों में मित्र को परखो। और ऐसे मित्र बनो जैसा मित्र तुम खुद चाहते हो।"`,
      },
      lesson: { en: 'Choose friends wisely — and be worthy of the friends you choose.', hi: 'मित्र समझदारी से चुनो — और जिन मित्रों को चुनो उनके योग्य बनो।' },
      lessonIcon: '💔',
    },

    ending_loyalty: {
      scene: 'river_bank', isEnding: true,
      text: {
        en: `The crocodile and the monkey remained friends for many years — and their story became famous along the river.\n\nNot because the crocodile was strong, or the monkey was clever. But because one ordinary creature, in one difficult moment, chose to do the right thing.\n\nNitishastra teaches:\n"The truest test of character is not what you do when it is easy — but what you do when everything pulls you the other way."`,
        hi: `मगरमच्छ और बंदर कई सालों तक मित्र रहे — और उनकी कहानी नदी के किनारे प्रसिद्ध हो गई।\n\nइसलिए नहीं कि मगरमच्छ शक्तिशाली था, या बंदर चतुर था। बल्कि इसलिए कि एक साधारण प्राणी ने, एक कठिन पल में, सही काम करना चुना।\n\nनीतिशास्त्र सिखाता है:\n"चरित्र की सबसे सच्ची परीक्षा यह नहीं है कि जब आसान हो तो तुम क्या करते हो — बल्कि यह है कि जब सब कुछ तुम्हें दूसरी दिशा में खींच रहा हो तो तुम क्या करते हो।"`,
      },
      lesson: { en: 'The truest test of character is what you do when doing right is hardest.', hi: 'चरित्र की सबसे सच्ची परीक्षा वह है जो तुम तब करते हो जब सही करना सबसे कठिन हो।' },
      lessonIcon: '💎',
    },
  },
};

export default monkeyAndCrocodile;
