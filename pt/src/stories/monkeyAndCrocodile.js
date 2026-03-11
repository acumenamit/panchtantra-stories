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
        en: 'The crocodile is moved by the monkey\'s kindness. What do you think he should do?',
        hi: 'मगरमच्छ बंदर की दयालुता से प्रभावित है। आपको क्या लगता है उसे क्या करना चाहिए?',
      },
      choices: [
        { text: { en: '🤝 Thank him and return often — this could be a real friendship!', hi: '🤝 उसे धन्यवाद दो और अक्सर वापस आओ — यह सच्ची दोस्ती हो सकती है!' }, next: 'friendship_grows' },
        { text: { en: '🐊 Take the fruit and leave — crocodiles don\'t need monkey friends', hi: '🐊 फल लो और चले जाओ — मगरमच्छों को बंदर दोस्तों की ज़रूरत नहीं' }, next: 'no_friendship' },
      ],
    },

    friendship_grows: {
      scene: 'river_bank',
      text: {
        en: `Days turned to weeks. The crocodile returned every morning, and the monkey always had fruit waiting. They talked, laughed, and shared stories of the river and the trees.\n\nOne evening, Raktamukha sent home a large bundle of rose-apples with his friend. "For your wife," he said warmly. "From one home to another."\n\nKaralamakara's wife ate the fruit and found it delicious. But then a dark thought crept into her mind.\n\n"If the fruit from that tree is so sweet," she thought, "imagine how sweet must be the heart of the monkey who eats this fruit every day..."\n\nShe called her husband and said sweetly: "I want the monkey's heart. Bring it to me."`,
        hi: `दिन हफ्तों में बदल गए। मगरमच्छ हर सुबह वापस आता, और बंदर के पास हमेशा फल तैयार रहते। वे बातें करते, हँसते, और नदी और पेड़ों की कहानियाँ साझा करते।\n\nएक शाम, रक्तमुख ने अपने मित्र के साथ जामुन का एक बड़ा गट्ठर घर भेजा। "तुम्हारी पत्नी के लिए," उसने गर्मजोशी से कहा। "एक घर से दूसरे घर तक।"\n\nकरालमकर की पत्नी ने फल खाया और उसे स्वादिष्ट पाया। लेकिन फिर उसके मन में एक काला विचार आया।\n\n"अगर उस पेड़ का फल इतना मीठा है," उसने सोचा, "तो ज़रा सोचो उस बंदर का दिल कितना मीठा होगा जो हर दिन यह फल खाता है..."\n\nउसने अपने पति को बुलाया और मीठे स्वर में कहा: "मुझे बंदर का दिल चाहिए। इसे मेरे लिए ले आओ।"`,
      },
      question: {
        en: 'The crocodile is torn — his wife demands his best friend\'s heart. What should he do?',
        hi: 'मगरमच्छ दुविधा में है — उसकी पत्नी उसके सबसे अच्छे दोस्त का दिल माँगती है। उसे क्या करना चाहिए?',
      },
      choices: [
        { text: { en: '😔 Refuse his wife — a true friend cannot be betrayed', hi: '😔 पत्नी को मना करो — एक सच्चे मित्र के साथ विश्वासघात नहीं होता' }, next: 'crocodile_refuses' },
        { text: { en: '😰 Give in — he fears his wife\'s anger more than his conscience', hi: '😰 हार मानो — वह अपनी पत्नी के क्रोध से अपनी अंतरात्मा की आवाज़ से ज़्यादा डरता है' }, next: 'on_the_river' },
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
        en: 'The crocodile gets a second chance at friendship. What does this teach us?',
        hi: 'मगरमच्छ को दोस्ती का दूसरा मौका मिलता है। यह हमें क्या सिखाता है?',
      },
      choices: [
        { text: { en: '🌱 It\'s never too late to choose kindness and connection', hi: '🌱 दयालुता और जुड़ाव चुनने में कभी देर नहीं होती' }, next: 'friendship_grows' },
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
        en: 'The crocodile chose his friend over his fear. What is the lesson here?',
        hi: 'मगरमच्छ ने अपने डर के बजाय अपने मित्र को चुना। यहाँ क्या सीख है?',
      },
      choices: [
        { text: { en: '💎 True loyalty means choosing rightly even when it costs you', hi: '💎 सच्ची वफ़ादारी का मतलब है सही चुनाव करना भले ही उसकी कीमत चुकानी पड़े' }, next: 'ending_loyalty' },
      ],
    },

    on_the_river: {
      scene: 'river_bank',
      text: {
        en: `Heavy with guilt, the crocodile swam to the monkey's tree the next morning.\n\n"Friend!" he called. "My wife is very ill. She wishes to meet you — she says only a holy monkey like you can cure her. Please come across the river with me."\n\nRaktamukha, worried for his friend's wife, leaped onto the crocodile's back without hesitation.\n\nThey were halfway across the deep river when the crocodile began to slow down... and then spoke the terrible truth.\n\n"I'm sorry, friend. My wife wants your heart. I have no choice."\n\nRaktamukha felt the world drop away beneath him. But he did not panic.`,
        hi: `अपराधबोध से भरा मगरमच्छ अगली सुबह बंदर के पेड़ पर तैरकर आया।\n\n"मित्र!" उसने पुकारा। "मेरी पत्नी बहुत बीमार है। वह तुमसे मिलना चाहती है — उसका कहना है कि तुम जैसा पवित्र बंदर ही उसे ठीक कर सकता है। कृपया मेरे साथ नदी पार चलो।"\n\nरक्तमुख, अपने मित्र की पत्नी के लिए चिंतित होकर, बिना हिचकिचाए मगरमच्छ की पीठ पर कूद गया।\n\nवे गहरी नदी के बीच में थे जब मगरमच्छ धीमा पड़ने लगा... और फिर उसने भयानक सच बोला।\n\n"माफ करना, मित्र। मेरी पत्नी तुम्हारा दिल चाहती है। मेरे पास कोई चारा नहीं।"\n\nरक्तमुख को लगा जैसे उसके नीचे से ज़मीन खिसक गई हो। लेकिन उसने घबराहट नहीं दिखाई।`,
      },
      question: {
        en: 'Stranded in the middle of a river on a crocodile\'s back — what should the monkey do?',
        hi: 'मगरमच्छ की पीठ पर नदी के बीच में फँसा — बंदर को क्या करना चाहिए?',
      },
      choices: [
        { text: { en: '🧠 Stay calm and think — panic never saved anyone', hi: '🧠 शांत रहो और सोचो — घबराहट ने कभी किसी को नहीं बचाया' }, next: 'monkey_escapes' },
        { text: { en: '😨 Struggle and try to swim — fight for survival!', hi: '😨 संघर्ष करो और तैरने की कोशिश करो — जीवन के लिए लड़ो!' }, next: 'monkey_struggles' },
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
        en: 'The monkey steadies himself. What clever words does he use?',
        hi: 'बंदर खुद को संभालता है। वह कौन से चतुर शब्द इस्तेमाल करता है?',
      },
      choices: [
        { text: { en: '"I left my heart in the tree — take me back and I\'ll get it for you!"', hi: '"मेरा दिल पेड़ में छूट गया — मुझे वापस ले चलो और मैं तुम्हें दे दूँगा!"' }, next: 'monkey_escapes' },
      ],
    },

    monkey_escapes: {
      scene: 'river_bank',
      text: {
        en: `Raktamukha took one slow, deep breath. Then he laughed.\n\n"Oh, dear friend — you should have told me earlier! I would have brought it!"\n\nThe crocodile blinked. "What?"\n\n"My heart! I don't carry it with me when I travel — I leave it safely in the tree. All monkeys do. Take me back and I'll climb up and get it for you!"\n\nThe crocodile, not the cleverest of creatures, turned around and swam back to the bank.\n\nThe moment they touched the shore, Raktamukha leaped high into the branches, his heart hammering with relief.\n\n"You fool!" he called down. "Who leaves their heart in a tree? But you — you left your wisdom in your wife's pocket, and your friendship in the river. Go home."`,
        hi: `रक्तमुख ने एक लंबी, गहरी साँस ली। फिर वह हँसा।\n\n"अरे, प्रिय मित्र — तुमने मुझे पहले क्यों नहीं बताया! मैं इसे ले आता!"\n\nमगरमच्छ ने पलकें झपकाईं। "क्या?"\n\n"मेरा दिल! जब मैं यात्रा करता हूँ तो मैं इसे अपने साथ नहीं ले जाता — मैं इसे पेड़ में सुरक्षित छोड़ देता हूँ। सभी बंदर ऐसा करते हैं। मुझे वापस ले चलो और मैं ऊपर चढ़कर तुम्हें दे दूँगा!"\n\nमगरमच्छ, जो बहुत चतुर प्राणी नहीं था, मुड़ा और किनारे की ओर तैरकर वापस आया।\n\nजैसे ही वे किनारे को छूए, रक्तमुख डालियों में ऊँचा कूद गया, उसका दिल राहत से धड़क रहा था।\n\n"मूर्ख!" उसने नीचे पुकारा। "कौन अपना दिल पेड़ में छोड़ता है? लेकिन तुम — तुमने अपनी बुद्धि अपनी पत्नी की जेब में छोड़ दी, और अपनी दोस्ती नदी में। घर जाओ।"`,
      },
      question: {
        en: 'The monkey is safe. But he lost a friend to greed and weakness. What is the hardest lesson here?',
        hi: 'बंदर सुरक्षित है। लेकिन उसने लालच और कमज़ोरी के कारण एक मित्र खो दिया। यहाँ सबसे कठिन सीख क्या है?',
      },
      choices: [
        { text: { en: '🧠 Presence of mind in crisis is the greatest survival skill', hi: '🧠 संकट में मन की शांति सबसे बड़ा जीवन-कौशल है' }, next: 'ending_wisdom' },
        { text: { en: '💔 A friend who betrays once will betray again — choose your friends wisely', hi: '💔 जो मित्र एक बार धोखा दे, वह दोबारा भी देगा — मित्र सोच-समझकर चुनो' }, next: 'ending_friendship' },
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
