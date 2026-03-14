const fourFriendsAndHunter = {
  id: 'four-friends-and-hunter',
  title:       { en: 'The Four Friends and the Hunter', hi: 'चार मित्र और शिकारी' },
  description: { en: 'A deer, a crow, a mouse, and a tortoise form an unlikely friendship. When the hunter\'s net falls, only loyalty and quick thinking can save them all.',
                 hi: 'एक हिरण, एक कौआ, एक चूहा और एक कछुआ एक अप्रत्याशित मित्रता बनाते हैं। जब शिकारी का जाल गिरता है, तो केवल वफ़ादारी और तेज़ सोच ही सबको बचा सकती है।' },
  theme:       { en: 'United friends are stronger than any enemy', hi: 'एकजुट मित्र किसी भी दुश्मन से मज़बूत होते हैं' },
  age: '6+',
  duration:    { en: '10–14 min', hi: '१०–१४ मिनट' },
  addedOn: '2026-03-05',
  featured: true,
  emoji: '🦌',
  color: '#60a5fa',
  book:        { en: 'Panchatantra — Book III', hi: 'पञ्चतन्त्र — तृतीय भाग' },
  progressSteps: ['start', 'deer_caught', 'friends_rescue', 'tortoise_danger', 'ending_wisdom'],

  nodes: {
    start: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-start.jpg',
      scene: 'forest_day',
      text: {
        en: `By a clear forest lake lived four unlikely friends: Chitragreeva the crow, who saw everything from the treetops; Hiranyaka the mouse, who lived in a hole by the roots; Mantharaka the tortoise, who basked on the rocks at the water's edge; and Shvetanka the deer, who came to drink each evening.\n\nThey were very different creatures. They had nothing in common except one thing: when any one of them was in trouble, the others came.\n\nOne golden afternoon, Shvetanka the deer did not arrive at the lake.\n\nChitragreeva the crow, always watching, flew wide circles over the forest. From the air, he spotted the deer — struggling in a hunter's net, far from the lake.`,
        hi: `एक साफ जंगल की झील के पास चार अप्रत्याशित मित्र रहते थे: चित्रग्रीव नाम का कौआ, जो पेड़ की चोटी से सब कुछ देखता था; हिरण्यक नाम का चूहा, जो जड़ों के पास एक बिल में रहता था; मन्थरक नाम का कछुआ, जो पानी के किनारे चट्टानों पर धूप सेंकता था; और श्वेतांक नाम का हिरण, जो हर शाम पानी पीने आता था।\n\nवे बहुत अलग-अलग प्राणी थे। उनमें एक बात के अलावा कुछ भी समान नहीं था: जब उनमें से कोई एक मुसीबत में होता, तो बाकी आ जाते।\n\nएक सुनहरी दोपहर, श्वेतांक हिरण झील पर नहीं आया।\n\nचित्रग्रीव कौआ, हमेशा देखते रहते, जंगल के ऊपर चौड़े चक्कर लगाता उड़ा। हवा से, उसने हिरण को देखा — एक शिकारी के जाल में फँसा, झील से बहुत दूर।`,
      },
      question: {
        en: 'The crow has spotted the deer in a trap. He is small — what should he do first?',
        hi: 'कौए ने जाल में हिरण को देखा है। वह छोटा है — उसे पहले क्या करना चाहिए?',
      },
      choices: [
        { text: { en: '🐦 Fly to the deer immediately and try to peck through the net alone',  hi: '🐦 तुरंत हिरण के पास उड़ो और अकेले जाल को चोंच से काटने की कोशिश करो' }, next: 'crow_alone' },
        { text: { en: '🤝 Alert all the friends first — this needs everyone working together', hi: '🤝 पहले सभी मित्रों को सूचित करो — इसके लिए सबको मिलकर काम करना होगा' }, next: 'deer_caught' },
      ],
    },

    crow_alone: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-crow-alone.jpg',
      scene: 'forest_path',
      isAlternate: true,
      text: {
        en: `Chitragreeva flew straight to the net and pecked furiously at the ropes.\n\nBut his beak was small. The ropes were thick. He could barely make a dent.\n\nThe deer thrashed, making noise. In the distance, the hunter heard and began walking back.\n\nChitragreeva looked at his tiny beak. Then he thought of Hiranyaka the mouse — whose teeth could chew through rope in minutes.\n\n"I should have gone for help first," he thought.\n\nHe flew back at full speed.`,
        hi: `चित्रग्रीव सीधे जाल के पास उड़ा और रस्सियों पर ज़ोर से चोंच मारने लगा।\n\nलेकिन उसकी चोंच छोटी थी। रस्सियाँ मोटी थीं। वह मुश्किल से कोई निशान बना सका।\n\nहिरण छटपटाया, शोर मचाया। दूरी में, शिकारी ने सुना और वापस चलने लगा।\n\nचित्रग्रीव ने अपनी छोटी चोंच को देखा। फिर उसने हिरण्यक चूहे के बारे में सोचा — जिसके दाँत मिनटों में रस्सी चबा सकते थे।\n\n"मुझे पहले मदद लेने जाना चाहिए था," उसने सोचा।\n\nवह पूरी गति से वापस उड़ा।`,
      },
      question: {
        en: 'The crow realised he can\'t do it alone. What does this teach us about asking for help?',
        hi: 'कौए को एहसास हुआ कि वह अकेले नहीं कर सकता। यह हमें मदद माँगने के बारे में क्या सिखाता है?',
      },
      choices: [
        { text: { en: '🤝 Knowing when to ask for help is wisdom, not weakness', hi: '🤝 यह जानना कि कब मदद माँगनी है बुद्धिमानी है, कमज़ोरी नहीं' }, next: 'deer_caught' },
        { text: { en: '⚡ Acting fast matters — but acting smart matters more',  hi: '⚡ तेज़ी से कार्य करना महत्वपूर्ण है — लेकिन समझदारी से कार्य करना अधिक महत्वपूर्ण है' }, next: 'deer_caught' },
      ],
    },

    deer_caught: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-deer-caught.jpg',
      scene: 'forest_path',
      text: {
        en: `Chitragreeva flew back to the lake, crying out the alarm.\n\nHiranyaka the mouse leaped up immediately. "Where? Show me!"\n\nMantharaka the tortoise began to move — slowly, steadily.\n\n"You stay here," said the crow gently. "You are too slow. The hunter may return before we finish. Stay safe."\n\n"My friends are in danger," said the tortoise simply. "I am coming."\n\nChitragreeva carried the mouse in his beak — flying fast, flying low — while the tortoise trundled behind.\n\nThey reached the deer. Hiranyaka set to work on the ropes with his sharp teeth — gnaw, gnaw, gnaw.`,
        hi: `चित्रग्रीव झील के पास वापस उड़ा, चेतावनी देते हुए।\n\nहिरण्यक चूहा तुरंत उछल पड़ा। "कहाँ? दिखाओ!"\n\nमन्थरक कछुआ चलने लगा — धीरे-धीरे, स्थिरता से।\n\n"तुम यहाँ रहो," कौए ने धीरे से कहा। "तुम बहुत धीमे हो। हम खत्म करने से पहले शिकारी वापस आ सकता है। सुरक्षित रहो।"\n\n"मेरे मित्र खतरे में हैं," कछुए ने सरलता से कहा। "मैं आ रहा हूँ।"\n\nचित्रग्रीव ने चूहे को अपनी चोंच में उठाया — तेज़ उड़ते हुए, नीचे उड़ते हुए — जबकि कछुआ पीछे लुढ़कता चला।\n\nवे हिरण के पास पहुँचे। हिरण्यक अपने तेज़ दाँतों से रस्सियों पर काम करने लगा — कुतरना, कुतरना, कुतरना।`,
      },
      question: {
        en: 'Each friend brings a different strength. Can you see why all four were needed?',
        hi: 'हर मित्र एक अलग शक्ति लाता है। क्या आप देख सकते हैं कि चारों की ज़रूरत क्यों थी?',
      },
      choices: [
        { text: { en: '👀 The crow\'s eyes spotted the danger — without him, no one would know', hi: '👀 कौए की आँखों ने खतरा देखा — उसके बिना, कोई नहीं जानता' }, next: 'friends_rescue' },
        { text: { en: '🦷 The mouse\'s teeth could free them — the crow\'s beak never could',   hi: '🦷 चूहे के दाँत उन्हें आज़ाद कर सकते थे — कौए की चोंच कभी नहीं' },   next: 'friends_rescue' },
      ],
    },

    friends_rescue: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-friends-rescue.jpg',
      scene: 'forest_path',
      text: {
        en: `Hiranyaka chewed through the last rope just as the sound of the hunter's footsteps grew louder through the trees.\n\n"RUN!" cried the crow.\n\nThe deer leaped away into the forest. The crow took flight. The mouse scurried into a hollow log.\n\nThe hunter arrived — and found only a pile of chewed ropes and an empty clearing.\n\nHe looked around, bewildered. Then his eyes fell on something else entirely:\n\nA tortoise. Slow, plodding, still far from the safety of the trees.\n\nThe hunter smiled and reached for his bag.`,
        hi: `हिरण्यक ने आखिरी रस्सी तब चबाई जब जंगल में शिकारी के कदमों की आवाज़ तेज़ होती गई।\n\n"भागो!" कौए ने चिल्लाया।\n\nहिरण जंगल में कूदकर भाग गया। कौआ उड़ गया। चूहा एक खोखले लट्ठे में घुस गया।\n\nशिकारी पहुँचा — और केवल चबाई हुई रस्सियों का ढेर और एक खाली मैदान पाया।\n\nवह घबराकर इधर-उधर देखने लगा। फिर उसकी आँखें कुछ और पर पड़ीं:\n\nएक कछुआ। धीमा, लुढ़कता, अभी भी पेड़ों की सुरक्षा से बहुत दूर।\n\nशिकारी मुस्कुराया और अपने थैले की ओर हाथ बढ़ाया।`,
      },
      question: {
        en: 'The tortoise who insisted on coming is now in danger because of his slowness. Was it right for him to come?',
        hi: 'कछुआ जो आने पर ज़ोर देता था, अब अपनी धीमेपन की वजह से खतरे में है। क्या उसका आना सही था?',
      },
      choices: [
        { text: { en: '❤️ Yes — a friend who stays safe while others suffer is no friend at all', hi: '❤️ हाँ — जो मित्र दूसरों के दुख में सुरक्षित रहे वह मित्र ही नहीं' }, next: 'tortoise_danger' },
        { text: { en: '🤔 Maybe — bravery without ability can create new problems',              hi: '🤔 शायद — बिना क्षमता का साहस नई समस्याएँ पैदा कर सकता है' },         next: 'tortoise_danger' },
      ],
    },

    tortoise_danger: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-tortoise-danger.jpg',
      scene: 'forest_dark',
      text: {
        en: `The hunter scooped up Mantharaka and tied him in his bag.\n\nFrom the trees, the three friends watched in horror.\n\n"This is my fault," said Mantharaka from inside the bag. "I should have listened."\n\n"No," said Chitragreeva firmly. "We do not abandon friends. We find a way."\n\nThe mouse thought quickly. "Chitragreeva — fly ahead of the hunter on the path. Land on the ground as if you are injured. Drag your wing. Make him think you are easy prey."\n\n"And then?"\n\n"He will put down the bag to catch you. The moment he does — Hiranyaka, you chew through the bag. I will keep the hunter distracted. Shvetanka — run parallel in the trees, make noise, confuse him."`,
        hi: `शिकारी ने मन्थरक को उठाया और अपने थैले में बाँध दिया।\n\nपेड़ों से, तीन मित्रों ने भय से देखा।\n\n"यह मेरी गलती है," मन्थरक ने थैले के अंदर से कहा। "मुझे सुनना चाहिए था।"\n\n"नहीं," चित्रग्रीव ने दृढ़ता से कहा। "हम मित्रों को नहीं छोड़ते। हम रास्ता खोजते हैं।"\n\nचूहे ने जल्दी से सोचा। "चित्रग्रीव — रास्ते में शिकारी के आगे उड़ो। ज़मीन पर ऐसे उतरो जैसे तुम घायल हो। अपना पंख खींचो। उसे सोचने दो कि तुम आसान शिकार हो।"\n\n"और फिर?"\n\n"वह तुम्हें पकड़ने के लिए थैला रख देगा। जैसे ही वह रखे — हिरण्यक, तुम थैले को चबाओ। मैं शिकारी को व्यस्त रखूँगा। श्वेतांक — पेड़ों में साथ-साथ दौड़ो, शोर मचाओ, उसे भ्रमित करो।"`,
      },
      question: {
        en: 'Each friend has a role in the rescue. This is a plan that uses everyone\'s strengths. What does this show?',
        hi: 'हर मित्र की बचाव में एक भूमिका है। यह एक ऐसी योजना है जो सबकी शक्तियों का उपयोग करती है। यह क्या दर्शाता है?',
      },
      choices: [
        { text: { en: '🌟 Together, small creatures can outsmart and outmanoeuvre the powerful', hi: '🌟 मिलकर, छोटे प्राणी शक्तिशाली को मात दे सकते हैं' },         next: 'plan_executes' },
        { text: { en: '♟️ A good plan assigns each person what they do best',                  hi: '♟️ एक अच्छी योजना हर व्यक्ति को वह काम देती है जो वह सबसे अच्छा करता है' }, next: 'plan_executes' },
      ],
    },

    plan_executes: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-plan-executes.jpg',
      scene: 'forest_path',
      text: {
        en: `The plan unfolded perfectly.\n\nChitragreeva landed on the path ahead, dragging his wing, crying piteously. The hunter's eyes lit up — two catches in one day!\n\nHe set down the bag and crept forward.\n\nHiranyaka darted out, chewed through the bag's knot in seconds, and Mantharaka was free.\n\nThe deer crashed loudly through the bushes to the left. The hunter spun around.\n\nThe crow flew up, perfectly uninjured, and called from high above.\n\nThe hunter looked left. He looked right. He looked at his empty bag on the ground.\n\nHe went home with nothing.`,
        hi: `योजना पूरी तरह से काम आई।\n\nचित्रग्रीव आगे रास्ते पर उतरा, पंख खींचते हुए, करुणापूर्वक चिल्लाते हुए। शिकारी की आँखें चमकीं — एक दिन में दो शिकार!\n\nउसने थैला रख दिया और आगे रेंगा।\n\nहिरण्यक दौड़ा, सेकंडों में थैले की गाँठ चबाई, और मन्थरक आज़ाद हो गया।\n\nहिरण बाईं तरफ झाड़ियों से ज़ोर से गुज़रा। शिकारी घूम गया।\n\nकौआ ऊपर उड़ा, पूरी तरह से बिना घाव के, और ऊँचाई से पुकारा।\n\nशिकारी ने बाईं ओर देखा। दाईं ओर देखा। ज़मीन पर अपना खाली थैला देखा।\n\nवह खाली हाथ घर गया।`,
      },
      question: {
        en: 'Four very different creatures, working as one, defeated a human hunter. What is the deepest lesson?',
        hi: 'चार बहुत अलग प्राणी, एक होकर, एक मानव शिकारी को हरा दिया। सबसे गहरी शिक्षा क्या है?',
      },
      choices: [
        { text: { en: '🤝 Unity multiplies strength — divided, each was prey; together, they were unbeatable', hi: '🤝 एकता शक्ति को गुणा करती है — अलग-अलग, हर कोई शिकार था; मिलकर, वे अजेय थे' }, next: 'ending_wisdom' },
        { text: { en: '💙 True friendship shows up — even slowly, even at risk to itself',                    hi: '💙 सच्ची दोस्ती आती है — धीरे-धीरे भी, खुद को जोखिम में डालकर भी' },                    next: 'ending_friendship' },
      ],
    },

    ending_wisdom: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-ending-wisdom.jpg',
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `That evening, the four friends gathered at the lake as the sun set.\n\nMantharaka was quiet for a long time. Then he said: "I was slow. I nearly cost us everything. And yet you came back for me."\n\n"Of course," said Hiranyaka simply.\n\n"That is friendship," said Chitragreeva. "Not that we are the same. Not that we are equally fast or strong. But that we show up for each other in the moments that matter."\n\nShvetanka dipped his head to drink, and the water was sweet.\n\nThe Panchatantra teaches:\n"Four together are stronger than forty alone.\nIn unity, the small become mighty.\nIn loyalty, the weak become invincible."`,
        hi: `उस शाम, चारों मित्र झील पर इकट्ठे हुए जैसे सूरज डूब रहा था।\n\nमन्थरक काफी देर तक चुप रहा। फिर उसने कहा: "मैं धीमा था। मैंने लगभग हम सबको खतरे में डाल दिया। और फिर भी तुम मेरे लिए वापस आए।"\n\n"बिल्कुल," हिरण्यक ने सरलता से कहा।\n\n"यही दोस्ती है," चित्रग्रीव ने कहा। "यह नहीं कि हम एक जैसे हैं। यह नहीं कि हम समान रूप से तेज़ या मज़बूत हैं। बल्कि यह कि हम उन पलों में एक-दूसरे के लिए आते हैं जो मायने रखते हैं।"\n\nश्वेतांक ने पीने के लिए सिर झुकाया, और पानी मीठा था।\n\nपञ्चतन्त्र सिखाता है:\n"चार मिलकर चालीस अकेलों से मज़बूत हैं।\nएकता में, छोटे शक्तिशाली बन जाते हैं।\nवफ़ादारी में, कमज़ोर अजेय बन जाते हैं।"`,
      },
      lesson: { en: 'United friends are stronger than any enemy. Show up for each other in the moments that matter.', hi: 'एकजुट मित्र किसी भी दुश्मन से मज़बूत होते हैं। उन पलों में एक-दूसरे के लिए आओ जो मायने रखते हैं।' },
      lessonIcon: '🤝',
    },

    ending_friendship: {
      image: '/images/the-four-friends-and-the-hunter/the-four-friends-and-the-hunter-ending-friendship.jpg',
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The tortoise reached the lake long after the others.\n\nNo one had left. All three sat waiting.\n\n"You waited," said Mantharaka, surprised.\n\n"You came for us when you were slow," said Shvetanka. "We can wait for you when you are slower."\n\nMantharaka looked at each of his friends for a long moment.\n\nThen he said something the Panchatantra has remembered for two thousand years:\n\n"A friend who stays only when it is easy is no true friend. But a friend who stays when it is hard — that friend is family."\n\nNitishastra teaches: "Do not measure friends by what they have. Measure them by what they do when you need them most."`,
        hi: `कछुआ दूसरों के बहुत बाद झील पर पहुँचा।\n\nकोई नहीं गया था। तीनों इंतज़ार करते बैठे थे।\n\n"तुम रुके," मन्थरक ने आश्चर्य से कहा।\n\n"जब तुम धीमे थे तो तुम हमारे लिए आए," श्वेतांक ने कहा। "जब तुम और धीमे हो तो हम तुम्हारे लिए इंतज़ार कर सकते हैं।"\n\nमन्थरक ने एक लंबे पल के लिए अपने हर मित्र को देखा।\n\nफिर उसने कुछ ऐसा कहा जिसे पञ्चतन्त्र ने दो हज़ार साल तक याद रखा:\n\n"जो मित्र केवल तब रहे जब आसान हो वह सच्चा मित्र नहीं। लेकिन जो मित्र तब रहे जब कठिन हो — वह मित्र परिवार है।"\n\nनीतिशास्त्र सिखाता है: "मित्रों को इससे मत नापो कि उनके पास क्या है। उन्हें इससे नापो कि जब तुम्हें सबसे ज़्यादा ज़रूरत हो तो वे क्या करते हैं।"`,
      },
      lesson: { en: 'A friend who stays when it is hard is not a friend — they are family.', hi: 'जो मित्र कठिन समय में रहे वह मित्र नहीं — वह परिवार है।' },
      lessonIcon: '💙',
    },
  },
};

export default fourFriendsAndHunter;
