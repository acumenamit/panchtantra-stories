const lionAndHare = {
  id: 'lion-and-hare',
  title:       { en: 'The Lion and the Hare',  hi: 'शेर और खरगोश' },
  description: { en: 'A tiny hare uses wit to free the forest from a fearsome lion. Can cleverness defeat raw power?',
                 hi: 'एक छोटा खरगोश अपनी चतुराई से जंगल को एक भयानक शेर से मुक्त कराता है। क्या बुद्धि बल को हरा सकती है?' },
  theme:       { en: 'Wisdom conquers Strength', hi: 'बुद्धि बल से श्रेष्ठ है' },
  age: '6+',
  duration:    { en: '8–12 min', hi: '८–१२ मिनट' },
  addedOn: '2025-10-01',
  featured: false,
  emoji: '🦁',
  color: '#f87171',
  book:        { en: 'Panchatantra — Book I', hi: 'पञ्चतन्त्र — प्रथम भाग' },
  progressSteps: ['start', 'lion_accepts', 'hare_plan', 'well_trick', 'ending_wisdom'],

  nodes: {
    start: {
      scene: 'forest_day',
      text: {
        en: `In the great forest of Vindhya, there lived a mighty lion named Bhasuraka. Every day, he would hunt and kill many animals — far more than he could eat. The animals lived in constant fear.\n\nOne day, all the forest animals gathered together under the old banyan tree. The deer, rabbits, elephants, monkeys, and birds all spoke with one voice:\n\n"O mighty lion! We will send you one animal each day as your meal. In return, please stop the needless killing. The forest is becoming empty!"`,
        hi: `विन्ध्य के महान जंगल में भासुरक नाम का एक शक्तिशाली शेर रहता था। वह हर दिन बहुत से जानवरों को मारता था — जितना वह खा भी नहीं सकता था। सभी जानवर भय में जी रहे थे।\n\nएक दिन, जंगल के सभी जानवर पुराने बरगद के पेड़ के नीचे इकट्ठे हुए। हिरण, खरगोश, हाथी, बंदर और पक्षी सभी ने मिलकर कहा:\n\n"हे महाबली शेर! हम प्रतिदिन आपके लिए एक जानवर भेजेंगे। बदले में, कृपया इस व्यर्थ के हत्याकांड को बंद करें। जंगल खाली होता जा रहा है!"`,
      },
      question: {
        en: 'You are powerful. You are hungry. The animals kneel and offer you a deal — one meal a day, no more killing. Something stirs in you. What is it?',
        hi: 'तुम शक्तिशाली हो। तुम भूखे हो। जानवर झुककर एक सौदा पेश करते हैं — रोज़ एक भोजन, बस। कुछ हिलता है तुम्हारे भीतर। वह क्या है?',
      },
      choices: [
        { text: { en: 'A deal. Fine. At least I won\'t have to chase.',  hi: 'ठीक है सौदा। कम से कम पीछा तो नहीं करना पड़ेगा।' }, next: 'lion_accepts' },
        { text: { en: 'I am the king. No one tells me how to hunt.',     hi: 'मैं राजा हूँ। कोई मुझे शिकार करना नहीं सिखाएगा।' },  next: 'lion_refuses' },
      ],
    },

    lion_accepts: {
      scene: 'forest_evening',
      text: {
        en: `The lion Bhasuraka stroked his mane thoughtfully. "Very well," he roared. "Send me one animal each day, and I shall spare the rest."\n\nThe animals were relieved. Days passed peacefully. Then came the turn of a small, clever hare named Sthirajeevi. The other animals looked at him with sad eyes.\n\n"Little hare, today is your day," they said.\n\nSthirajeevi smiled calmly. "Do not worry, friends. Leave this to me. I have a plan."`,
        hi: `शेर भासुरक ने सोच-समझकर अपनी अयाल पर हाथ फेरा। "बहुत अच्छा," वह गरजा। "मुझे रोज़ एक जानवर भेजो, और मैं बाकी सबको छोड़ दूँगा।"\n\nजानवरों ने राहत की साँस ली। दिन शांति से गुज़रने लगे। फिर स्थिरजीवी नाम के एक छोटे, चतुर खरगोश की बारी आई। बाकी जानवरों ने उसे दुखभरी नज़रों से देखा।\n\n"छोटे खरगोश, आज तुम्हारी बारी है," उन्होंने कहा।\n\nस्थिरजीवी शांति से मुस्कुराया। "चिंता मत करो, मित्रों। यह मुझ पर छोड़ दो। मेरे पास एक योजना है।"`,
      },
      question: {
        en: 'The hare arrives hours late, small and unhurried. He doesn\'t tremble. Something about that irritates you — and also, quietly, interests you. What do you feel?',
        hi: 'खरगोश घंटों देर से आता है, छोटा और बेफिक्र। काँपता नहीं। इसमें कुछ है जो तुम्हें चिढ़ाता है — और चुपचाप, उत्सुक भी करता है। तुम क्या महसूस करते हो?',
      },
      choices: [
        { text: { en: "He's not afraid of me. I want to hear what he says.", hi: 'यह मुझसे डरता नहीं। सुनना चाहता हूँ यह क्या कहता है।' }, next: 'hare_plan' },
        { text: { en: 'Late is late. I\'m hungry and I\'m done waiting.',     hi: 'देर तो देर है। मैं भूखा हूँ और अब और इंतज़ार नहीं।' },  next: 'hare_delay' },
      ],
    },

    lion_refuses: {
      scene: 'forest_dark', isAlternate: true,
      text: {
        en: `"SILENCE!" roared the lion. "I am the king! I hunt as I please!"\n\nThe animals scattered in fear. Days passed, and Bhasuraka continued his rampage. Soon, the deer were gone. Then the smaller animals. The forest grew quiet and empty.\n\nWith no prey left, the lion grew hungry. Very hungry. He wandered alone in a silent, barren forest.\n\n"Where have all the animals gone?" he wondered.\n\nThen he realized — he had destroyed the very kingdom he ruled. A king who does not protect his subjects has no kingdom at all.`,
        hi: `"चुप रहो!" शेर दहाड़ा। "मैं राजा हूँ! मैं जैसे चाहूँ शिकार करूँगा!"\n\nजानवर डर के मारे भाग गए। दिन बीतते गए और भासुरक का उत्पात जारी रहा। जल्द ही हिरण गायब हो गए। फिर छोटे जानवर भी। जंगल शांत और सूना हो गया।\n\nकोई शिकार न बचने पर, शेर को भूख लगने लगी। बहुत तेज़ भूख। वह एकाकी, शांत, बंजर जंगल में भटकने लगा।\n\n"सब जानवर कहाँ गए?" उसने सोचा।\n\nतब उसे समझ आया — उसने स्वयं उस राज्य को नष्ट कर दिया था जिस पर वह राज करता था। जो राजा अपनी प्रजा की रक्षा नहीं करता, उसका कोई राज्य नहीं होता।`,
      },
      question: {
        en: 'The forest is silent. You won every hunt. Now there is nothing left. This isn\'t what power was supposed to feel like. What do you tell yourself?',
        hi: 'जंगल में सन्नाटा है। तुमने हर शिकार जीता। अब कुछ नहीं बचा। शक्ति ऐसी नहीं लगनी चाहिए थी। खुद से क्या कहते हो?',
      },
      choices: [
        { text: { en: 'I had a kingdom. I destroyed it. That is on me.',          hi: 'मेरे पास एक राज्य था। मैंने उसे नष्ट किया। यह मेरी ग़लती है।' }, next: 'lesson_king' },
        { text: { en: 'There are other forests. I\'ll start again somewhere else.', hi: 'और भी जंगल हैं। कहीं और से शुरू करूँगा।' },                   next: 'lesson_escape' },
      ],
    },

    hare_delay: {
      scene: 'forest_path', isAlternate: true,
      text: {
        en: `"Poor little hare," thought the animals, watching him shuffle away.\n\nBut Sthirajeevi WAS scared — and he let that fear drive him to simply run and hide deep in the jungle.\n\nThe lion waited. And waited. His anger rose and would not stop. When no animal arrived, he went on a killing rampage worse than before.\n\nThe other animals paid the price for the hare's cowardice.\n\nThat night, Sthirajeevi heard the cries of his friends and felt the weight of his choice. Running away from a problem rarely makes it disappear — it often makes it worse.`,
        hi: `"बेचारा छोटा खरगोश," जानवरों ने सोचा, उसे जाते हुए देखकर।\n\nलेकिन स्थिरजीवी सच में डरा हुआ था — और उस डर ने उसे जंगल की गहराई में भागकर छुपने पर मजबूर कर दिया।\n\nशेर इंतज़ार करता रहा। और इंतज़ार करता रहा। उसका क्रोध बढ़ता गया और थमा नहीं। जब कोई जानवर नहीं आया, तो उसने पहले से भी बुरा नरसंहार किया।\n\nबाकी जानवरों ने खरगोश की कायरता की कीमत चुकाई।\n\nउस रात, स्थिरजीवी ने अपने मित्रों की चीखें सुनीं और अपने निर्णय का बोझ महसूस किया। समस्या से भागना उसे शायद ही कभी खत्म करता है — अक्सर वह और बड़ी हो जाती है।`,
      },
      question: {
        en: 'You ran. You\'re safe. But tonight you can hear your friends crying from far away. You did this. What do you do with that feeling?',
        hi: 'तुम भागे। तुम सुरक्षित हो। लेकिन आज रात दूर से मित्रों की चीखें सुनाई दे रही हैं। यह तुमने किया। इस एहसास के साथ क्या करते हो?',
      },
      choices: [
        { text: { en: 'I have to go back. Running was wrong. I have an idea.', hi: 'वापस जाना होगा। भागना गलत था। मेरे पास एक उपाय है।' }, next: 'hare_plan' },
        { text: { en: 'I can\'t face this. I\'ll stay hidden and hope it stops.', hi: 'यह झेल नहीं सकता। छुपा रहूँगा और उम्मीद करूँगा कि बंद हो जाए।' }, next: 'lesson_cowardice' },
      ],
    },

    hare_plan: {
      scene: 'lions_den',
      text: {
        en: `Sthirajeevi arrived at the lion's den looking calm despite arriving hours late.\n\n"WHERE HAVE YOU BEEN?!" bellowed Bhasuraka, shaking the ground.\n\n"O Great King," said the hare with a deep bow. "I was on my way when ANOTHER lion stopped me! He is huge, bigger than you, and he said — YOU are not the real king of this forest! HE is!"\n\nThe lion's eyes went wide with fury. "WHAT?! Show me this imposter immediately!"\n\n"Follow me, Your Majesty," said the tiny hare, leading the enormous lion through the forest...`,
        hi: `स्थिरजीवी घंटों देर से आने के बावजूद शांत चेहरे के साथ शेर की गुफा पर पहुँचा।\n\n"तुम इतनी देर कहाँ थे?!" भासुरक गरजा, ज़मीन काँप उठी।\n\n"हे महाराज," खरगोश ने गहरा प्रणाम करते हुए कहा। "मैं रास्ते में था तभी एक और शेर ने मुझे रोका! वह बहुत बड़ा है, आपसे भी बड़ा, और उसने कहा — इस जंगल का असली राजा आप नहीं, वह है!"\n\nशेर की आँखें क्रोध से फैल गईं। "क्या?! मुझे अभी उस ढोंगी के पास ले चलो!"\n\n"मेरे पीछे आइए, महाराज," छोटे खरगोश ने कहा, और विशाल शेर को जंगल में ले चला...`,
      },
      question: {
        en: 'The lion is right beside you, enormous and furious. He\'s looking into the well. One more second and it\'s over. Your whole body is shaking. What do you feel?',
        hi: 'शेर तुम्हारे ठीक बगल में है, विशाल और क्रोधित। कुएँ में झाँक रहा है। एक और पल और यह खत्म हो जाएगा। पूरा शरीर काँप रहा है। क्या महसूस हो रहा है?',
      },
      choices: [
        { text: { en: 'Terror. But I hold still. This has to work.', hi: 'दहशत। लेकिन मैं टिका हूँ। यह काम करना चाहिए।' }, next: 'well_trick' },
        { text: { en: 'I can\'t do it. I bolt.',                     hi: 'नहीं झेल सकता। भाग जाता हूँ।' },                next: 'hare_escape' },
      ],
    },

    well_trick: {
      scene: 'well',
      text: {
        en: `The hare stopped at the edge of a deep well. "There, O King! Look inside — the other lion lurks in there!"\n\nBhasuraka peered into the well. In the still water below, he saw a huge lion staring back — growling, snarling, ready to fight.\n\n(It was, of course, his own reflection.)\n\n"RAAAARGH!" roared Bhasuraka, and the reflection roared back!\n\n"I'll destroy you!" he bellowed — and leaped headfirst into the well.\n\nSPLASH.\n\nThe great roars faded. The forest fell silent. Then, slowly, the sounds of life returned — birds singing, deer running freely, creatures no longer afraid.`,
        hi: `खरगोश एक गहरे कुएँ के किनारे रुक गया। "वहाँ देखिए, महाराज! अंदर झाँकिए — वह दूसरा शेर वहीं छुपा है!"\n\nभासुरक ने कुएँ में झाँका। नीचे के शांत पानी में उसे एक विशाल शेर दिखा — गुर्राता, दाँत दिखाता, लड़ने को तैयार।\n\n(वह, ज़ाहिर है, उसका अपना प्रतिबिंब था।)\n\n"ग्राआआर!" भासुरक दहाड़ा, और प्रतिबिंब भी दहाड़ा!\n\n"मैं तुम्हें नष्ट कर दूँगा!" वह चिल्लाया — और सिर के बल कुएँ में कूद गया।\n\nधड़ाम!\n\nभयानक दहाड़ें शांत हो गईं। जंगल में सन्नाटा छा गया। फिर धीरे-धीरे जीवन की आवाज़ें वापस आईं — पक्षियों का गाना, हिरणों की दौड़, जानवर जो अब डरे नहीं थे।`,
      },
      question: {
        en: 'The animals are celebrating. They\'re calling you a hero. But you led a living creature to his death using a lie. Both of these things are true at the same time. What sits in your chest?',
        hi: 'जानवर जश्न मना रहे हैं। तुम्हें नायक बुला रहे हैं। लेकिन तुमने एक जीवित प्राणी को झूठ से मौत की तरफ ले गए। ये दोनों बातें एक साथ सच हैं। सीने में क्या बैठा है?',
      },
      choices: [
        { text: { en: 'I did what I had to. Hundreds of lives against one.', hi: 'जो करना था, किया। सैकड़ों जीवन एक के सामने।' },          next: 'ending_wisdom' },
        { text: { en: 'I\'m not sure it was right. Even if it worked.',      hi: 'पक्का नहीं कि यह सही था। भले ही काम किया।' }, next: 'ending_reflect' },
      ],
    },

    hare_escape: {
      scene: 'forest_evening', isAlternate: true,
      text: {
        en: `The hare bolted into the bushes!\n\nBut the lion was fast. He caught up and cornered Sthirajeevi against a rocky cliff.\n\n"You thought you could trick ME?!" the lion snarled.\n\nThe hare's heart pounded. He looked left — rocks. He looked right — the lion. Then he looked down... and saw the deep well just three steps away.\n\n"Wait, wait, wait!" said the hare. "I wasn't running away! I was leading you here — the other lion IS real, look into that well!"\n\nThe lion hesitated... then looked.`,
        hi: `खरगोश झाड़ियों में भाग गया!\n\nलेकिन शेर तेज़ था। उसने स्थिरजीवी को एक चट्टानी दीवार के पास घेर लिया।\n\n"तुमने सोचा तुम मुझे चकमा दे सकते हो?!" शेर गरजा।\n\nखरगोश का दिल धड़क रहा था। उसने बाईं ओर देखा — चट्टानें। दाईं ओर देखा — शेर। फिर नीचे देखा... और तीन कदम दूर वह गहरा कुआँ दिखा।\n\n"रुकिए, रुकिए, रुकिए!" खरगोश बोला। "मैं भाग नहीं रहा था! मैं आपको यहीं लाना चाहता था — वह दूसरा शेर सच में है, उस कुएँ में झाँकिए!"\n\nशेर हिचकिचाया... फिर देखा।`,
      },
      question: {
        en: 'You told the lion there\'s another lion in the well. He\'s looking. He\'s about to leap. You lied — but it might save everyone. What do you want to happen right now?',
        hi: 'तुमने शेर को बताया कि कुएँ में एक और शेर है। वह देख रहा है। कूदने वाला है। तुमने झूठ बोला — लेकिन इससे सबकी जान बच सकती है। अभी तुम क्या चाहते हो?',
      },
      choices: [
        { text: { en: 'Jump. Please just jump. End this.',                        hi: 'कूद जा। बस कूद जा। खत्म हो जाए यह।' },                          next: 'ending_wisdom' },
        { text: { en: 'Wait. What if he doesn\'t? What if he turns and listens?', hi: 'रुको। क्या होगा अगर न कूदे? क्या होगा अगर वो मुड़कर सुने?' }, next: 'lion_wise' },
      ],
    },

    lion_wise: {
      scene: 'lions_den', isAlternate: true,
      text: {
        en: `The lion stared at the hare. Then... slowly... he began to laugh. A deep, rumbling, genuine laugh.\n\n"You are clever, little one. Very clever indeed." He sat down heavily. "I have been killing and killing, and I never once thought about what I was destroying."\n\nThe hare, trembling but brave, sat before the lion. "Great King, you have strength no one can match. But strength guided by wisdom — that is what makes a true king."\n\nThe lion was quiet for a long time. Then he nodded.`,
        hi: `शेर ने खरगोश को देखा। फिर... धीरे-धीरे... वह हँसने लगा। एक गहरी, गूँजती, सच्ची हँसी।\n\n"तुम चालाक हो, छोटे। बहुत चालाक।" वह भारी कदमों से बैठ गया। "मैं मारता रहा, मारता रहा, और मैंने कभी नहीं सोचा कि मैं क्या नष्ट कर रहा हूँ।"\n\nखरगोश, काँपते हुए लेकिन साहसी, शेर के सामने बैठ गया। "महाराज, आपके पास ऐसी शक्ति है जिसकी बराबरी कोई नहीं कर सकता। लेकिन बुद्धि से निर्देशित शक्ति — यही एक सच्चे राजा को महान बनाती है।"\n\nशेर बहुत देर तक चुप रहा। फिर उसने सिर हिलाया।`,
      },
      question: {
        en: 'The lion didn\'t leap. He\'s sitting with you now, quiet. He asks: "Why didn\'t you just run?" What do you say?',
        hi: 'शेर नहीं कूदा। वह अब तुम्हारे साथ चुपचाप बैठा है। पूछता है: "तुम बस भागे क्यों नहीं?" तुम क्या कहते हो?',
      },
      choices: [
        { text: { en: 'Because running never actually solves anything.',    hi: 'क्योंकि भागने से कुछ हल नहीं होता।' },                 next: 'ending_wisdom' },
        { text: { en: 'Because I wanted to see if you could change.',       hi: 'क्योंकि देखना चाहता था कि तुम बदल सकते हो।' }, next: 'ending_reflect' },
      ],
    },

    lesson_king: {
      scene: 'forest_dawn', isAlternate: true, isEnding: true,
      text: {
        en: `The lion wandered to a new forest, carrying the heavy lesson in his heart.\n\nYears later, the animals of Vindhya heard a story of a lion in another forest — one who protected his subjects, hunted only what he needed, whose roar meant safety rather than fear.\n\nNitishastra teaches us: "A king's greatest strength is not his claws, but his wisdom. Power used without restraint destroys the very kingdom it seeks to rule."`,
        hi: `शेर एक नए जंगल में चला गया, दिल में एक भारी सबक लेकर।\n\nकई साल बाद, विन्ध्य के जानवरों ने एक दूसरे जंगल के शेर की कहानी सुनी — जो अपनी प्रजा की रक्षा करता था, केवल उतना शिकार करता था जितनी ज़रूरत हो, जिसकी दहाड़ डर नहीं, सुरक्षा का संदेश देती थी।\n\nनीतिशास्त्र सिखाता है: "राजा की सबसे बड़ी शक्ति उसके पंजे नहीं, बल्कि उसकी बुद्धि है। बिना संयम के उपयोग की गई शक्ति उसी राज्य को नष्ट कर देती है जिस पर वह राज करना चाहती है।"`,
      },
      lesson: { en: 'A ruler who does not care for those under him will have no one left to rule.', hi: 'जो शासक अपनी प्रजा की परवाह नहीं करता, उसके पास राज करने के लिए कोई नहीं बचता।' },
      lessonIcon: '👑',
    },

    lesson_escape: {
      scene: 'forest_dark', isAlternate: true, isEnding: true,
      text: {
        en: `The lion left for new lands... and the same pattern repeated. He hunted without thought, and the new forest too grew empty.\n\nSome lessons must be fully learned, not escaped from.\n\nThe wise elders would say: "A fish that jumps from one pond to another without changing its ways will make every pond the same."`,
        hi: `शेर नई भूमि पर चला गया... और वही सब दोहराया गया। उसने बिना सोचे शिकार किया, और नया जंगल भी खाली हो गया।\n\nकुछ सबक पूरी तरह सीखने होते हैं, उनसे भागा नहीं जा सकता।\n\nबुज़ुर्ग कहते: "जो मछली अपनी आदत बदले बिना एक तालाब से दूसरे तालाब में कूदती है, वह हर तालाब को एक जैसा बना देती है।"`,
      },
      lesson: { en: "Changing your place doesn't change your nature. True growth comes from within.", hi: 'जगह बदलने से स्वभाव नहीं बदलता। सच्चा विकास अंदर से आता है।' },
      lessonIcon: '🌱',
    },

    lesson_cowardice: {
      scene: 'forest_dark', isAlternate: true, isEnding: true,
      text: {
        en: `The hare hid for the rest of his days, haunted by what might have been.\n\nThe forest suffered. Animals lived in fear. And Sthirajeevi, who had a gift for cleverness, let it go to waste.\n\nNitishastra teaches: "A lamp that refuses to burn for fear of being blown out helps no one. Better to burn and be extinguished than to leave the world in darkness."\n\nCourage is not the absence of fear — it is acting wisely DESPITE fear.`,
        hi: `खरगोश बाकी जीवन छुपकर गुज़ारता रहा, जो हो सकता था उसके सपनों में डूबा रहा।\n\nजंगल तकलीफ में रहा। जानवर डर में जीते रहे। और स्थिरजीवी, जो चतुराई का उपहार लेकर पैदा हुआ था, उसे बेकार जाने दिया।\n\nनीतिशास्त्र सिखाता है: "जो दीपक बुझ जाने के डर से जलने से मना करे, वह किसी के काम नहीं आता। जलकर बुझ जाना बेहतर है, बजाय दुनिया को अंधेरे में छोड़ने के।"\n\nसाहस डर का न होना नहीं है — साहस है डर के बावजूद बुद्धिमानी से काम करना।`,
      },
      lesson: { en: 'Hiding from a problem out of fear is itself a choice — and often the worst one.', hi: 'डर से समस्या से छुपना भी एक चुनाव है — और अक्सर सबसे बुरा।' },
      lessonIcon: '🕯️',
    },

    ending_wisdom: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The forest of Vindhya bloomed with new life. Animals grazed without fear. Birds filled the trees with song. Even the trees seemed to stand taller.\n\nAnd the story of the small hare who outwitted the great lion was told for generations — not as a story of weakness defeating strength, but of WISDOM guiding the world toward peace.\n\nAs the Panchatantra teaches:\n"One who has wisdom has everything.\nOne who lacks wisdom, even strength becomes his downfall."`,
        hi: `विन्ध्य का जंगल नई ज़िंदगी से खिल उठा। जानवर बिना डर के चरने लगे। पक्षियों ने पेड़ों को गीतों से भर दिया। पेड़ भी जैसे और ऊँचे खड़े हो गए।\n\nऔर उस छोटे खरगोश की कहानी जिसने महान शेर को मात दी, पीढ़ियों तक सुनाई जाती रही — कमज़ोरी के बल पर जीत की नहीं, बल्कि बुद्धि से दुनिया को शांति की ओर ले जाने की कहानी।\n\nजैसा पञ्चतन्त्र सिखाता है:\n"जिसके पास बुद्धि है उसके पास सब कुछ है।\nजिसके पास बुद्धि नहीं, उसकी शक्ति भी उसका पतन बन जाती है।"`,
      },
      lesson: { en: "True intelligence is not just knowing things — it's using what you know to protect others and bring peace.", hi: 'सच्ची बुद्धिमत्ता केवल जानना नहीं है — बल्कि जो जानते हैं उसे दूसरों की रक्षा और शांति के लिए उपयोग करना है।' },
      lessonIcon: '🌟',
    },

    ending_reflect: {
      scene: 'forest_dawn', isEnding: true,
      text: {
        en: `The wise owl of the forest, watching everything from a high branch, later told the young ones:\n\n"There is rarely only one right path. The hare's cleverness saved lives — that is true. But a world where wisdom and strength can speak to each other is more beautiful still."\n\nThe young ones argued and discussed long into the night. And that, said the owl, was the real gift of the Panchatantra — not just stories, but the wisdom to keep asking better questions.`,
        hi: `जंगल का बुद्धिमान उल्लू, जो एक ऊँची डाल से सब देख रहा था, बाद में छोटे जानवरों को बताने लगा:\n\n"शायद ही कोई एक सही रास्ता होता है। खरगोश की चतुराई ने जीवन बचाए — यह सच है। लेकिन एक ऐसी दुनिया जहाँ बुद्धि और शक्ति आपस में बात कर सकें, और भी सुंदर होती है।"\n\nछोटे जानवर देर रात तक बहस और चर्चा करते रहे। और यही, उल्लू ने कहा, पञ्चतन्त्र का असली उपहार था — सिर्फ कहानियाँ नहीं, बल्कि बेहतर सवाल पूछते रहने की बुद्धि।`,
      },
      lesson: { en: "Great stories don't just give you answers — they teach you to ask better questions.", hi: 'महान कहानियाँ सिर्फ जवाब नहीं देतीं — वे बेहतर सवाल पूछना सिखाती हैं।' },
      lessonIcon: '🦉',
    },
  },
};

export default lionAndHare;
