const blueJackal = {
  id: 'blue-jackal',
  title:       { en: 'The Blue Jackal',         hi: 'नीला सियार' },
  description: { en: 'A jackal falls into a vat of blue dye and emerges looking like no animal anyone has ever seen. He could tell the truth — or he could become a king. What would you do?',
                 hi: 'एक सियार नीले रंग के कुंड में गिर जाता है और ऐसा दिखने लगता है जैसा कोई जानवर किसी ने नहीं देखा। वह सच बता सकता है — या राजा बन सकता है। तुम क्या करते?' },
  theme:       { en: 'A borrowed identity never truly fits', hi: 'उधार की पहचान कभी सच्ची नहीं होती' },
  age: '7+',
  duration:    { en: '12–16 min', hi: '१२–१६ मिनट' },
  addedOn: '2026-03-07',
  featured: false,
  emoji: '🐺',
  color: '#60a5fa',
  book:        { en: 'Panchatantra — Book III', hi: 'पञ्चतन्त्र — तृतीय भाग' },
  progressSteps: ['start', 'declares_kingship', 'ruling_the_forest', 'moonlit_night', 'ending_unmasked'],

  nodes: {

    // ── NODE 1 (BOTH PATHS) ────────────────────────────────────
    // Jackal falls into dye vat, emerges blue, sees reflection.
    // THIS is the real fork — lie vs truth.
    // IMAGE: start.jpg — blue jackal emerging from dye vat,
    //        staring at reflection in puddle, eyes wide with wonder
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village',
      image: '/images/the-blue-jackal/the-blue-jackal-start.jpg',
      text: {
        en: `In the forest outside a small town, there lived a jackal named Chandarava. He was clever and quick — but also always hungry, always scheming, always looking for an easier life.

One evening, chased by a pack of dogs into the town, he stumbled and fell — SPLASH — into a large vat of blue dye outside a cloth merchant's house.

The dogs sniffed at the vat, then backed away in confusion. They had never seen anything like this before. They ran off, yelping.

Chandarava climbed out, dripping. He looked down at himself.

He was blue. Completely, brilliantly, impossibly blue. No such animal existed in the world.

He walked to a still puddle and stared at his reflection for a long, long time.

"No one," he thought slowly, "has ever seen anything like me."`,
        hi: `एक छोटे से शहर के बाहर जंगल में चंदरव नाम का एक सियार रहता था। वह चालाक और फुर्तीला था — लेकिन हमेशा भूखा, हमेशा चालें सोचता, हमेशा आसान ज़िंदगी की तलाश में।

एक शाम, कुत्तों के एक झुंड से भागते हुए शहर में घुसा, लड़खड़ाया और — छपाक — एक कपड़े के व्यापारी के घर के बाहर रखे नीले रंग के बड़े कुंड में गिर गया।

कुत्तों ने कुंड को सूँघा, फिर उलझन में पीछे हट गए। उन्होंने ऐसा कुछ कभी नहीं देखा था। वे भौंकते हुए भाग गए।

चंदरव टपकता हुआ बाहर निकला। उसने खुद को नीचे देखा।

वह नीला था। पूरी तरह, चमकीला, असंभव रूप से नीला। दुनिया में ऐसा कोई जानवर नहीं था।

वह एक शांत पोखरे के पास गया और बहुत देर तक अपना प्रतिबिंब देखता रहा।

"किसी ने," उसने धीरे-धीरे सोचा, "ऐसा कुछ कभी नहीं देखा।"`,
      },
      question: {
        en: 'You are soaking wet, bright blue, and every animal who sees you stumbles back in shock. A wild thought crosses your mind. What do you do?',
        hi: 'तुम पूरी तरह भीगे हो, चमकीले नीले हो, और जो भी जानवर तुम्हें देखता है घबराकर पीछे हट जाता है। एक पागल विचार मन में आता है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '😲 "I could be a king. Right now. All I have to do is walk back in there."', hi: '😲 "मैं राजा बन सकता हूँ। अभी। बस वापस जाना है।"' },                             next: 'declares_kingship' },
        { text: { en: '🌀 "I should tell them the truth. They know me. They\'ll understand."',      hi: '🌀 "मुझे सच बताना चाहिए। ये मुझे जानते हैं। समझेंगे।"' },                          next: 'tells_the_truth' },
      ],
    },

    // ════════════════════════════════════════════════════════════
    //  PATH A — THE LIE
    // ════════════════════════════════════════════════════════════

    // ── PATH A · NODE 2 ────────────────────────────────────────
    // Jackal walks into forest, animals flee in terror.
    // He declares himself a god-sent king. It works.
    // IMAGE: declares_kingship.jpg — blue jackal standing tall,
    //        animals cowering in awe around him
    // ──────────────────────────────────────────────────────────
    declares_kingship: {
      scene: 'forest_day',
      image: '/images/the-blue-jackal/the-blue-jackal-declares-kingship.jpg',
      text: {
        en: `Chandarava walked back into the forest — slowly, deliberately, head held high.

A deer saw him first. It froze. Then bolted.

A bear spotted him and crashed away through the undergrowth.

Even a lion, the great Durdarsha, backed against a tree with wide eyes.

"W-what ARE you?" the lion whispered.

Chandarava let the silence stretch. Let the fear settle. Then he spoke in the deepest, most majestic voice he could manage:

"I am Kakudruma. The Creator himself mixed the colours of the heavens to make me, and sent me down to rule this forest. All creatures — lion, elephant, tiger — shall bow to me. And I shall be a just and glorious king."

He looked around at the trembling animals.

Not one of them questioned it.`,
        hi: `चंदरव जंगल में वापस चला — धीरे-धीरे, सोच-समझकर, सिर ऊँचा किए।

पहले एक हिरण ने उसे देखा। वह जम गया। फिर भाग गया।

एक भालू ने उसे देखा और झाड़ियों में घुस गया।

यहाँ तक कि एक शेर, महान दुर्दर्श, एक पेड़ से पीठ लगाकर आँखें फाड़े देखता रहा।

"त-तुम क्या हो?" शेर ने फुसफुसाया।

चंदरव ने चुप्पी को खिंचने दिया। डर को बैठने दिया। फिर जितनी गहरी, शानदार आवाज़ निकाल सका, बोला:

"मैं काकुद्रुम हूँ। स्वयं विधाता ने स्वर्ग के रंगों को मिलाकर मुझे बनाया है, और इस जंगल पर राज करने के लिए भेजा है। सभी प्राणी — शेर, हाथी, बाघ — मुझे प्रणाम करेंगे। और मैं एक न्यायी और महान राजा बनूँगा।"

उसने काँपते जानवरों को देखा।

एक ने भी सवाल नहीं किया।`,
      },
      question: {
        en: 'Every animal in the forest believes you are a god-sent king. The lion himself bows. You are all in now. How deep do you go?',
        hi: 'जंगल का हर जानवर मानता है कि तुम भगवान के भेजे राजा हो। शेर खुद झुकता है। अब तुम पूरी तरह अंदर हो। कितनी गहराई में जाओगे?',
      },
      choices: [
        { text: { en: '👑 "I\'m going all in. Lions. Elephants. A throne. Let\'s go."',        hi: '👑 "मैं पूरी तरह जा रहा हूँ। शेर। हाथी। सिंहासन। चलो।"' },             next: 'ruling_the_forest' },
        { text: { en: '😬 "Just for a while. Until I figure out a better plan. Just for now."', hi: '😬 "बस थोड़ी देर। जब तक कोई बेहतर योजना न सोचूँ। अभी के लिए।"' }, next: 'ruling_the_forest' },
      ],
    },

    // ── PATH A · NODE 3 ────────────────────────────────────────
    // Weeks pass. Jackal lives in luxury. Jackals appear nearby.
    // THE real fork on Path A — keep lying or confess.
    // IMAGE: ruling_the_forest.jpg — blue jackal on rock throne,
    //        lions and elephants serving him, a flicker of guilt
    // ──────────────────────────────────────────────────────────
    ruling_the_forest: {
      scene: 'forest_evening',
      image: '/images/the-blue-jackal/the-blue-jackal-ruling-the-forest.jpg',
      text: {
        en: `Days passed. Then weeks.

Chandarava lived like a true king. Lions hunted for his meals. Elephants fanned him with their ears. Tigers guarded his den. Even the birds brought him the sweetest berries.

But Chandarava had given one strict order: keep all jackals away. Far away.

Because jackals knew him. And jackals would know.

One evening, a pack of jackals wandered near the edge of the forest. Chandarava spotted them from his throne and felt something strange stir inside his chest. Something warm and familiar.

They looked exactly like him. Like who he used to be.

The lion turned to him. "Shall I chase them off, my king?"

"These animals trust me completely," a voice inside him said. "Maybe I should just... come clean."

Another voice said: "But you will lose everything."`,
        hi: `दिन बीते। फिर हफ्ते।

चंदरव सच्चे राजा की तरह जीने लगा। शेर उसके लिए शिकार करते। हाथी उसे अपने कानों से हवा देते। बाघ उसकी माँद की रखवाली करते। यहाँ तक कि पक्षी उसके लिए सबसे मीठे जामुन लाते।

लेकिन चंदरव ने एक सख्त आदेश दिया था: सभी सियारों को दूर रखो। बहुत दूर।

क्योंकि सियार उसे जानते थे। और सियार पहचान जाते।

एक शाम, सियारों का एक झुंड जंगल के किनारे आया। चंदरव ने उन्हें अपने सिंहासन से देखा और उसकी छाती में कुछ अजीब हलचल हुई। कुछ गर्म और जाना-पहचाना।

वे बिल्कुल उसी जैसे दिखते थे। जैसा वह पहले था।

शेर उसकी तरफ मुड़ा। "क्या मैं उन्हें भगा दूँ, महाराज?"

"ये जानवर मुझ पर पूरा भरोसा करते हैं," उसके अंदर एक आवाज़ बोली। "शायद मुझे सच बता देना चाहिए।"

दूसरी आवाज़ बोली: "लेकिन तुम सब कुछ खो दोगे।"`,
      },
      question: {
        en: 'You have everything — power, comfort, loyalty. But it is all built on a lie. A pack of jackals is at the edge of the forest. What do you do?',
        hi: 'तुम्हारे पास सब कुछ है — शक्ति, आराम, वफ़ादारी। लेकिन यह सब एक झूठ पर टिका है। सियारों का झुंड जंगल के किनारे है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '🐺 "Chase them away. No jackal comes near this forest. Ever."', hi: '🐺 "उन्हें भगा दो। कोई सियार इस जंगल के पास नहीं आएगा। कभी नहीं।"' },        next: 'moonlit_night' },
        { text: { en: '💛 "Wait. These animals trust me. I owe them the truth."',      hi: '💛 "रुको। ये जानवर मुझ पर भरोसा करते हैं। मेरा फर्ज़ है कि मैं सच बताऊँ।"' }, next: 'ending_confessed' },
      ],
    },

    // ── PATH A · NODE 4 ────────────────────────────────────────
    // Full moon. Jackals howl. The instinct rises. He can't stop it.
    // IMAGE: moonlit_night.jpg — blue jackal alone under full moon,
    //        distant jackals howling, face torn with longing
    // ──────────────────────────────────────────────────────────
    moonlit_night: {
      scene: 'forest_dark',
      image: '/images/the-blue-jackal/the-blue-jackal-moonlit-night.jpg',
      isAlternate: true,
      text: {
        en: `The jackals were chased away. Life went on.

But then came the full moon.

Far away on a hill, a pack of jackals began to howl. A long, rising, ancient sound — the sound Chandarava had heard every night of his life before the dye, before the throne, before all of this.

Something in him gave way.

His throat tightened. His head tilted up toward the moon without him deciding to tilt it. The howl rose inside him like water from a deep well —

"Don't," he told himself. "You are Kakudruma. King of the forest. Kings don't howl."

The jackals howled again.

His whole body trembled.

"Just hold it in. Just hold it in. Just hold it—"`,
        hi: `सियारों को भगा दिया गया। ज़िंदगी चलती रही।

लेकिन फिर पूर्णिमा आई।

दूर एक पहाड़ी पर, सियारों का एक झुंड चिल्लाने लगा। एक लंबी, उठती, पुरानी आवाज़ — वह आवाज़ जो चंदरव ने रंग से पहले, सिंहासन से पहले, इन सब से पहले हर रात सुनी थी।

उसके भीतर कुछ ढह गया।

उसका गला भर आया। उसका सिर बिना सोचे चाँद की तरफ उठ गया। वह हुंकार उसके अंदर से एक गहरे कुएँ के पानी की तरह उठी —

"मत करो," उसने खुद से कहा। "तुम काकुद्रुम हो। जंगल के राजा। राजा नहीं चिल्लाते।"

सियार फिर चिल्लाए।

उसका पूरा शरीर काँपा।

"बस रोको। बस रोको। बस रो—"`,
      },
      question: {
        en: 'The jackals are howling. Every part of you remembers what you are. Can you hold it in?',
        hi: 'सियार चिल्ला रहे हैं। तुम्हारा पूरा वजूद याद दिला रहा है कि तुम क्या हो। क्या तुम रोक सकते हो?',
      },
      choices: [
        { text: { en: '😰 "No. No no no. I am Kakudruma. I am a KING. I will NOT— ...oh no."', hi: '😰 "नहीं। नहीं नहीं नहीं। मैं काकुद्रुम हूँ। मैं राजा हूँ। मैं नहीं— ...ओह नहीं।"' }, next: 'ending_unmasked' },
        { text: { en: '🐺 "Just once. Just quietly. Just to feel it one more time..."',          hi: '🐺 "बस एक बार। बस धीरे से। बस एक बार और महसूस करने के लिए..."' },               next: 'ending_unmasked' },
      ],
    },

    // ── PATH A · ENDING 1 ──────────────────────────────────────
    // He howls. Animals recognise the sound. Everything collapses.
    // IMAGE: ending_unmasked.jpg — blue jackal mid-howl, animals
    //        recoiling in shock, the lie exposed in one moment
    // ──────────────────────────────────────────────────────────
    ending_unmasked: {
      scene: 'forest_dark',
      image: '/images/the-blue-jackal/the-blue-jackal-ending-unmasked.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `"AOOOOOOOO—"

The howl tore out of him before he could stop it. Long, wavering, unmistakably a jackal's howl. Not a king's roar. Not a god's voice.

A jackal's howl.

The forest went completely silent.

Then the lion spoke. Very quietly.

"...That is a jackal's cry."

Every head turned. Every eye looked at Chandarava. The blue was still there — but now they saw past the colour. They saw the shape of him. The size of him. The way he held his tail.

"He's a jackal," said the bear. "He's just a jackal covered in blue dye."

Chandarava ran. He ran faster than he had ever run in his life.

He sat alone at the edge of a field, panting, blue, and entirely himself.

The Panchatantra teaches:
"You can wear the colour of a king, speak in the voice of a god, and sit on the highest throne — but when the moon is full and your true nature calls, you will answer."`,
        hi: `"आओओओओ—"

वह हुंकार उससे रुकने से पहले ही निकल गई। लंबी, काँपती, बिल्कुल सियार की आवाज़। राजा की दहाड़ नहीं। किसी देवता की वाणी नहीं।

सियार की हुंकार।

जंगल बिल्कुल चुप हो गया।

फिर शेर बोला। बहुत धीरे।

"...यह तो सियार की आवाज़ है।"

हर सिर मुड़ा। हर आँख ने चंदरव को देखा। नीला रंग अभी भी था — लेकिन अब वे रंग के पार देख सकते थे।

"यह सियार है," भालू बोला। "बस नीले रंग से रंगा हुआ सियार।"

चंदरव भाग गया। वह इतनी तेज़ दौड़ा जितना उसने कभी नहीं दौड़ा था।

वह एक खेत के किनारे अकेला बैठा, हाँफता हुआ, नीला, और पूरी तरह वही जो वह था।

पञ्चतन्त्र सिखाता है:
"तुम राजा का रंग पहन सकते हो, देवता की आवाज़ में बोल सकते हो, और सबसे ऊँचे सिंहासन पर बैठ सकते हो — लेकिन जब चाँद पूरा हो और तुम्हारी असली फितरत बुलाए, तो तुम जवाब दोगे।"`,
      },
      lesson: { en: "A borrowed identity always breaks down. The life built on pretending to be someone else must eventually be abandoned — often at a run.", hi: 'उधार की पहचान हमेशा टूटती है। किसी और का नाटक करके बनाई गई ज़िंदगी को अंततः छोड़ना ही पड़ता है — अक्सर भागते हुए।' },
      lessonIcon: '🌕',
    },

    // ── PATH A · ENDING 2 ──────────────────────────────────────
    // Jackal confesses before the moon can expose him.
    // Walks away with nothing — but with himself intact.
    // IMAGE: ending_confessed.jpg — blue jackal walking alone
    //        out of the forest at dawn, head low but dignified
    // ──────────────────────────────────────────────────────────
    ending_confessed: {
      scene: 'forest_dawn',
      image: '/images/the-blue-jackal/the-blue-jackal-ending-confessed.jpg',
      isEnding: true,
      text: {
        en: `Chandarava stood up slowly from his throne.

"I have something to tell you all."

The forest went quiet.

"I am not Kakudruma. I am not sent by the gods. I am a jackal — a hungry, ordinary jackal — who fell into a vat of blue dye and found that you were all afraid of me. And I was tempted. So I lied."

The silence stretched. Then the lion's eyes narrowed. The bear growled. One by one, the animals turned away.

No one offered to let him stay.

Chandarava walked out of the forest alone as the sun rose. Blue, hungry, and with nothing he hadn't come in with.

But something was different. Something had been put down.

He did not look back.

The Panchatantra teaches:
"Telling the truth when it costs you everything is the bravest thing there is. You may lose the throne — but you keep yourself."`,
        hi: `चंदरव धीरे-धीरे अपने सिंहासन से उठा।

"मुझे तुम सबको कुछ बताना है।"

जंगल चुप हो गया।

"मैं काकुद्रुम नहीं हूँ। मुझे किसी देवता ने नहीं भेजा। मैं एक सियार हूँ — भूखा, साधारण सियार — जो नीले रंग के कुंड में गिर गया और पाया कि तुम सब मुझसे डरते हो। और मैं लालच में आ गया। इसलिए मैंने झूठ बोला।"

चुप्पी खिंची। फिर शेर की आँखें सिकुड़ीं। भालू गुर्राया। एक-एक करके जानवर मुड़ गए।

किसी ने उसे रुकने का प्रस्ताव नहीं दिया।

चंदरव सूरज उगते हुए अकेले जंगल से निकल गया। नीला, भूखा, और उतना ही लेकर जितना लेकर आया था।

लेकिन कुछ अलग था। कुछ उतार दिया गया था।

उसने पीछे मुड़कर नहीं देखा।

पञ्चतन्त्र सिखाता है:
"जब सच बोलना सब कुछ छीन ले — तब भी सच बोलना सबसे बड़ी हिम्मत है। तुम सिंहासन खो सकते हो — लेकिन खुद को बचा लेते हो।"`,
      },
      lesson: { en: "Telling the truth when it costs you everything is the bravest thing there is. You may lose the throne — but you keep yourself.", hi: 'जब सच बोलना सब कुछ छीन ले — तब भी सच बोलना सबसे बड़ी हिम्मत है। तुम सिंहासन खो सकते हो — लेकिन खुद को बचा लेते हो।' },
      lessonIcon: '🌅',
    },

    // ════════════════════════════════════════════════════════════
    //  PATH B — THE TRUTH NOBODY BELIEVES
    // ════════════════════════════════════════════════════════════

    // ── PATH B · NODE 2 ────────────────────────────────────────
    // Jackal walks back in and tells everyone the truth immediately.
    // Animals panic anyway. Nobody believes a blue creature.
    // IMAGE: tells_the_truth.jpg — blue jackal standing with open
    //        paws in a pleading gesture, animals backing away in
    //        fear despite his honest expression
    // ──────────────────────────────────────────────────────────
    tells_the_truth: {
      scene: 'forest_day',
      image: '/images/the-blue-jackal/the-blue-jackal-tells-the-truth.jpg',
      text: {
        en: `Chandarava walked back into the forest and immediately raised his voice.

"Friends! It's me — Chandarava! I fell into a dye vat in the town. It's just colour — I'm still the same jackal you've always known. Please, don't be afraid!"

The deer froze. Then bolted.

The bear took one look and crashed into the bushes.

Even the lion, Durdarsha, pressed himself against a tree, eyes wide.

"That's exactly what a dangerous creature would say," the lion growled. "A real jackal would just look like a jackal."

"I AM a real jackal!" Chandarava said. "Smell me! You know my scent!"

But the animals were too frightened to get close enough to smell anything.

"He's trying to trick us," someone whispered. "No jackal is blue. This must be something sent to fool us."

Chandarava stood in the middle of the clearing, paws open, completely honest — and completely alone.`,
        hi: `चंदरव जंगल में वापस चला और तुरंत बोला।

"दोस्तों! मैं हूँ — चंदरव! मैं शहर में एक रंग के कुंड में गिर गया था। यह बस रंग है — मैं अभी भी वही सियार हूँ जिसे तुम हमेशा से जानते हो। कृपया, डरो मत!"

हिरण जम गया। फिर भाग गया।

भालू ने एक नज़र देखा और झाड़ियों में घुस गया।

यहाँ तक कि शेर दुर्दर्श, एक पेड़ से चिपक गया, आँखें फैली हुईं।

"यही तो एक खतरनाक प्राणी कहेगा," शेर गुर्राया। "असली सियार तो सियार जैसा दिखता है।"

"मैं असली सियार हूँ!" चंदरव बोला। "मुझे सूँघो! तुम मेरी गंध जानते हो!"

लेकिन जानवर इतने डरे हुए थे कि पास आकर कुछ सूँघने की हिम्मत नहीं थी।

"यह हमें धोखा देने की कोशिश कर रहा है," किसी ने फुसफुसाया। "कोई सियार नीला नहीं होता। यह ज़रूर कुछ भेजा गया है हमें बेवकूफ बनाने के लिए।"

चंदरव मैदान के बीच में खड़ा था, पंजे खुले, पूरी तरह ईमानदार — और पूरी तरह अकेला।`,
      },
      question: {
        en: 'You just told the whole forest the truth. But they are backing away in terror anyway. Nobody is listening. How does that feel?',
        hi: 'तुमने पूरे जंगल को सच बताया। लेकिन वे फिर भी डर के मारे पीछे हट रहे हैं। कोई नहीं सुन रहा। यह कैसा लगता है?',
      },
      choices: [
        { text: { en: '😤 "This is ridiculous. Someone touch me, smell me — you KNOW me!"', hi: '😤 "यह बेतुका है। कोई मुझे छुओ, सूँघो — तुम मुझे जानते हो!"' }, next: 'crowded_out' },
        { text: { en: '😔 "They\'re not going to believe me. I can see it in their eyes."',  hi: '😔 "ये मुझ पर यकीन नहीं करेंगे। मैं उनकी आँखों में देख सकता हूँ।"' }, next: 'crowded_out' },
      ],
    },

    // ── PATH B · NODE 3 ────────────────────────────────────────
    // Animals hold a council without him. A small deer quietly
    // says "what if he really is just a jackal?" — gets shouted down.
    // IMAGE: crowded_out.jpg — animals in a tight circle holding
    //        council, blue jackal watching from outside the circle,
    //        a small deer glancing back at him with uncertainty
    // ──────────────────────────────────────────────────────────
    crowded_out: {
      scene: 'forest_day',
      image: '/images/the-blue-jackal/the-blue-jackal-crowded-out.jpg',
      text: {
        en: `The animals held a council. Without him.

Chandarava sat outside the circle of gathered creatures and listened.

"We must treat it as a divine being," the lion said. "Until we know more."

"Or a dangerous one," the bear added.

A small deer — young, quiet — raised her voice hesitantly.

"But... what if he really is just Chandarava? He does sound like Chandarava. What if it truly is only dye?"

A ripple of discomfort ran through the circle.

"A jackal covered in blue dye?" the lion scoffed. "Have you ever seen such a thing?"

"No," said the deer quietly. "But that doesn't mean it can't happen."

The lion looked around the circle. Nobody else spoke up for the deer's idea.

"It's settled," he said. "The blue one rules. We bow until we know otherwise."

Outside the circle, Chandarava caught the deer's eye. She gave him the smallest nod.

One animal had heard him.`,
        hi: `जानवरों ने परिषद बुलाई। उसके बिना।

चंदरव इकट्ठे प्राणियों के घेरे के बाहर बैठकर सुनता रहा।

"हमें इसे एक दैवीय प्राणी मानना चाहिए," शेर ने कहा। "जब तक हम और न जान लें।"

"या खतरनाक," भालू ने जोड़ा।

एक छोटी हिरनी — जवान, शांत — ने झिझकते हुए आवाज़ उठाई।

"लेकिन... क्या हो अगर यह सच में सिर्फ चंदरव हो? यह चंदरव जैसा ही बोलता है। क्या हो अगर सच में बस रंग हो?"

घेरे में बेचैनी की लहर दौड़ी।

"नीले रंग से रंगा सियार?" शेर ने मज़ाक उड़ाया। "क्या तुमने कभी ऐसा देखा है?"

"नहीं," हिरनी ने धीरे कहा। "लेकिन इसका मतलब यह नहीं कि हो नहीं सकता।"

शेर ने घेरे में चारों तरफ देखा। हिरनी के विचार के लिए और कोई नहीं बोला।

"तय हो गया," उसने कहा। "नीला वाला राज करेगा। जब तक हम और न जानें, हम झुकते हैं।"

घेरे के बाहर, चंदरव की नज़र हिरनी से मिली। उसने बहुत छोटा सा सिर हिलाया।

एक जानवर ने उसे सुना था।`,
      },
      question: {
        en: 'The one animal who believed you just got silenced by the crowd. What do you do?',
        hi: 'जिस एक जानवर ने तुम पर यकीन किया उसे भीड़ ने चुप करा दिया। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '💪 "I walk into that circle. I\'m not letting them decide who I am without me."', hi: '💪 "मैं उस घेरे में जाता हूँ। मैं उन्हें मेरे बिना तय नहीं करने दूँगा कि मैं कौन हूँ।"' }, next: 'speaks_up' },
        { text: { en: '😶 "What\'s the point. They\'ve already decided. I\'ll just wait."',               hi: '😶 "क्या फ़ायदा। उन्होंने पहले ही तय कर लिया है। मैं बस इंतज़ार करूँगा।"' },             next: 'gave_up' },
      ],
    },

    // ── PATH B · NODE 4a ───────────────────────────────────────
    // Jackal walks into the council. Makes his case one more time.
    // The deer stands with him. It almost works — then doesn't.
    // IMAGE: speaks_up.jpg — blue jackal standing inside the
    //        animal circle, small deer beside him, lion looming,
    //        a moment of courage against the crowd
    // ──────────────────────────────────────────────────────────
    speaks_up: {
      scene: 'forest_day',
      image: '/images/the-blue-jackal/the-blue-jackal-speaks-up.jpg',
      isAlternate: true,
      text: {
        en: `Chandarava stood up and walked straight into the circle.

Every animal went tense.

"My name is Chandarava," he said clearly. "I have lived in this forest my whole life. I was born near the old fig tree at the south path. I know which berries grow bitter after the rains. I know the lion's den smells of river mud. I know these things because I am from here. I am one of you."

The deer stepped forward and stood beside him.

"I believe him," she said. Her voice was small but steady.

For a moment — just a moment — something shifted in the circle. A few animals exchanged glances. The old tortoise tilted his head.

Then the lion roared.

"ENOUGH. Blue is not natural. Blue is not jackal. We bow to what we do not understand — that is how we stay safe."

The moment passed. The circle closed.

Chandarava was escorted to a throne he had never asked for, with a deer walking quietly beside him — the only one who had truly seen him.`,
        hi: `चंदरव उठा और सीधे घेरे में चला गया।

हर जानवर तन गया।

"मेरा नाम चंदरव है," उसने स्पष्ट रूप से कहा। "मैं अपनी पूरी ज़िंदगी इस जंगल में रहा हूँ। मैं दक्षिण रास्ते पर पुराने अंजीर के पेड़ के पास पैदा हुआ था। मुझे पता है कौन से जामुन बारिश के बाद कड़वे हो जाते हैं। मुझे पता है शेर की माँद में नदी की मिट्टी की गंध आती है। मैं ये चीज़ें जानता हूँ क्योंकि मैं यहाँ का हूँ। मैं तुम्हीं में से एक हूँ।"

हिरनी आगे आई और उसके पास खड़ी हो गई।

"मुझे यकीन है," उसने कहा। उसकी आवाज़ छोटी थी लेकिन स्थिर।

एक पल के लिए — बस एक पल — घेरे में कुछ बदला। कुछ जानवरों ने नज़रें मिलाईं। बूढ़े कछुए ने सिर झुकाया।

फिर शेर दहाड़ा।

"बस। नीला कुदरती नहीं है। नीला सियार नहीं है। हम उसके आगे झुकते हैं जो हम नहीं समझते — यही हमें सुरक्षित रखता है।"

वह पल गुज़र गया। घेरा बंद हो गया।

चंदरव को उस सिंहासन तक ले जाया गया जो उसने कभी नहीं माँगा था, एक हिरनी उसके बगल में चुपचाप चलती हुई — एकमात्र जिसने उसे सच में देखा था।`,
      },
      question: {
        en: 'You said everything true. The deer believed you. But the lion\'s fear was louder. You still got crowned. What do you hold onto?',
        hi: 'तुमने सब सच कहा। हिरनी ने तुम पर यकीन किया। लेकिन शेर का डर ज़्यादा ज़ोर से बोला। फिर भी तुम्हें ताज पहनाया गया। तुम किसे थामे रखते हो?',
      },
      choices: [
        { text: { en: '🌱 "The deer heard me. One is enough. I\'ll keep being honest."',         hi: '🌱 "हिरनी ने सुना। एक काफी है। मैं ईमानदार रहूँगा।"' },               next: 'ruling_unwillingly' },
        { text: { en: '😞 "Not even the truth was enough. Maybe nothing I do matters here."', hi: '😞 "सच भी काफी नहीं था। शायद यहाँ कुछ भी मायने नहीं रखता।"' }, next: 'ruling_unwillingly' },
      ],
    },

    // ── PATH B · NODE 4b ───────────────────────────────────────
    // Jackal stays outside the circle. Council ends without him.
    // Animals escort him to the throne. Deer finds him after.
    // IMAGE: gave_up.jpg — blue jackal sitting alone outside the
    //        disbanded council, animals dispersing around him,
    //        the small deer approaching him quietly from the side
    // ──────────────────────────────────────────────────────────
    gave_up: {
      scene: 'forest_day',
      image: '/images/the-blue-jackal/the-blue-jackal-gave-up.jpg',
      isAlternate: true,
      text: {
        en: `Chandarava stayed where he was.

He watched the council from outside. He heard the lion's voice rise and fall. He heard the small deer try — and get silenced. He heard his own name spoken as if it belonged to someone else.

And he said nothing.

The council ended. Animals began filing out of the circle. Some glanced at him sideways. Nobody spoke to him directly.

Then the lion approached.

"You will take the throne," he said. Not a question. Not an invitation.

Chandarava stood up and followed. What else was there to do?

Later, the small deer found him sitting alone before the throne.

She had waited at the edge of the circle the whole time, hoping he would walk in.

She sat down beside him without saying a word.

After a long silence, she said quietly: "I would have stood with you."

Chandarava looked at the ground.

"I know," he said. "I know."`,
        hi: `चंदरव जहाँ था वहीं रहा।

उसने बाहर से परिषद देखी। शेर की आवाज़ उठते-गिरते सुनी। छोटी हिरनी की कोशिश सुनी — और उसे चुप कराया जाते सुना। अपना नाम किसी और का जैसे बोला जाते सुना।

और उसने कुछ नहीं कहा।

परिषद खत्म हुई। जानवर घेरे से निकलने लगे। कुछ ने तिरछी नज़र से उसे देखा। किसी ने सीधे बात नहीं की।

फिर शेर आया।

"तुम सिंहासन लोगे," उसने कहा। सवाल नहीं। निमंत्रण नहीं।

चंदरव उठा और पीछे चल दिया। और क्या करता?

बाद में, छोटी हिरनी उसे सिंहासन के सामने अकेले बैठे मिली।

वह पूरे समय घेरे के किनारे इंतज़ार करती रही थी, उम्मीद में कि वह अंदर आएगा।

वह बिना कुछ कहे उसके पास बैठ गई।

लंबी चुप्पी के बाद, उसने धीरे कहा: "मैं तुम्हारे साथ खड़ी होती।"

चंदरव ने ज़मीन देखी।

"मुझे पता है," उसने कहा। "मुझे पता है।"`,
      },
      question: {
        en: 'You let them decide without you. The deer waited for you to walk in. You didn\'t. What are you feeling right now?',
        hi: 'तुमने उन्हें तुम्हारे बिना तय करने दिया। हिरनी इंतज़ार करती रही कि तुम अंदर आओ। तुम नहीं आए। अभी तुम क्या महसूस कर रहे हो?',
      },
      choices: [
        { text: { en: '😔 "Regret. I had the truth and I stayed outside. I should have walked in."', hi: '😔 "पछतावा। मेरे पास सच था और मैं बाहर रहा। मुझे अंदर जाना चाहिए था।"' }, next: 'ruling_unwillingly' },
        { text: { en: '😶 "Nothing. What would it have changed? The lion had already decided."',    hi: '😶 "कुछ नहीं। क्या बदलता? शेर ने पहले ही तय कर लिया था।"' },               next: 'ruling_unwillingly' },
      ],
    },

    // ── PATH B · NODE 5 ────────────────────────────────────────
    // Jackal rules a throne he never wanted. Feels like a cage.
    // He doesn't chase the jackals — he watches them with longing.
    // IMAGE: ruling_unwillingly.jpg — blue jackal sits on throne
    //        looking hollow, animals bowing around him, the small
    //        deer nearby, jackals visible at the forest edge
    // ──────────────────────────────────────────────────────────
    ruling_unwillingly: {
      scene: 'forest_evening',
      image: '/images/the-blue-jackal/the-blue-jackal-ruling-unwillingly.jpg',
      text: {
        en: `The throne felt nothing like Chandarava had imagined a throne would feel.

It felt like a cage made of other animals' fear.

He sat through the days. Animals brought him food. They bowed. They treated him with reverence. And every single one of them was bowing to something he had told them, clearly and honestly, did not exist.

The deer visited him each morning. She would sit nearby without saying much. Just being there.

One evening a pack of jackals appeared at the edge of the forest. Chandarava watched them from his throne.

He did not chase them away.

He just watched them play and tumble and call to each other in the old familiar voices.

Something ached.

The lion noticed. "Shall I drive them off, my king?"

"No," said Chandarava quietly. "Let them be."`,
        hi: `सिंहासन वैसा नहीं लगा जैसा चंदरव ने सोचा था कि सिंहासन लगता होगा।

यह दूसरे जानवरों के डर से बनी एक पिंजरे जैसी लग रही थी।

वह दिन गुज़ारता रहा। जानवर उसके लिए खाना लाते। झुकते। श्रद्धा से पेश आते। और उनमें से हर एक किसी ऐसी चीज़ के सामने झुक रहा था जो उसने उन्हें साफ-साफ और ईमानदारी से बताया था कि मौजूद नहीं है।

हिरनी हर सुबह उसके पास आती। वह बिना ज़्यादा बोले पास बैठी रहती। बस वहाँ होती।

एक शाम सियारों का एक झुंड जंगल के किनारे आया। चंदरव ने उन्हें सिंहासन से देखा।

उसने उन्हें नहीं भगाया।

बस देखता रहा जब वे खेले, उछले, और पुरानी जानी-पहचानी आवाज़ों में एक-दूसरे को बुलाते रहे।

कुछ दुखा।

शेर ने देखा। "क्या मैं उन्हें भगा दूँ, महाराज?"

"नहीं," चंदरव ने धीरे कहा। "उन्हें रहने दो।"`,
      },
      question: {
        en: 'You are sitting on a throne you never asked for, wearing a crown built on everyone else\'s fear. What goes through your mind?',
        hi: 'तुम उस सिंहासन पर बैठे हो जो तुमने कभी नहीं माँगा, एक ऐसा ताज पहने हो जो सबके डर से बना है। मन में क्या चलता है?',
      },
      choices: [
        { text: { en: '🐾 "I just want to go home. Back to the forest. Back to being myself."', hi: '🐾 "मैं बस घर जाना चाहता हूँ। जंगल वापस। खुद वापस।"' },          next: 'moonlit_night_b' },
        { text: { en: '👁️ "I\'ll wait. One day they\'ll see. One day they\'ll understand."',   hi: '👁️ "मैं इंतज़ार करूँगा। एक दिन वे देखेंगे। एक दिन समझेंगे।"' }, next: 'moonlit_night_b' },
      ],
    },

    // ── PATH B · NODE 6 ────────────────────────────────────────
    // Full moon. Jackals howl. He doesn't fight it — he's tired.
    // He howls back joyfully, wanting to be heard as himself.
    // IMAGE: moonlit_night_b.jpg — blue jackal howling joyfully
    //        at the full moon, the small deer watching nearby,
    //        a release rather than a failure
    // ──────────────────────────────────────────────────────────
    moonlit_night_b: {
      scene: 'forest_dark',
      image: '/images/the-blue-jackal/the-blue-jackal-moonlit-night-b.jpg',
      isAlternate: true,
      text: {
        en: `The full moon rose.

Far away on the hill, the jackals began to howl.

Chandarava listened. He didn't try to stop himself. He wasn't trying to be Kakudruma anymore. He was just tired — tired of being feared, tired of being worshipped, tired of being anything other than what he was.

He tilted his head up toward the moon.

And he howled. Loudly. Joyfully. The most honest sound he had made since falling into the dye vat.

Not because he had forgotten himself.

But because for the first time in weeks, he just wanted to be heard as what he actually was.

The deer, sitting nearby, did not run.

She had known all along.`,
        hi: `पूर्णिमा उगी।

दूर पहाड़ी पर, सियार चिल्लाने लगे।

चंदरव ने सुना। उसने खुद को रोकने की कोशिश नहीं की। वह अब काकुद्रुम बनने की कोशिश नहीं कर रहा था। वह बस थका हुआ था — डराने से थका, पूजे जाने से थका, जो वह था उसके अलावा कुछ और होने से थका।

उसने सिर चाँद की तरफ उठाया।

और चिल्लाया। ज़ोर से। खुशी से। रंग के कुंड में गिरने के बाद से निकाली सबसे ईमानदार आवाज़।

इसलिए नहीं कि वह खुद को भूल गया था।

बल्कि इसलिए कि हफ्तों में पहली बार, वह बस सुना जाना चाहता था — जो वह वाकई था।

पास बैठी हिरनी नहीं भागी।

वह शुरू से जानती थी।`,
      },
      question: {
        en: 'The jackals are singing under the full moon. You didn\'t chase them away. For the first time in weeks something feels true. What do you do?',
        hi: 'सियार पूर्णिमा के नीचे गा रहे हैं। तुमने उन्हें नहीं भगाया। हफ्तों में पहली बार कुछ सच लगता है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '🌕 "I howl back. Loudly. Joyfully. I don\'t care who hears."',         hi: '🌕 "मैं वापस चिल्लाता हूँ। ज़ोर से। खुशी से। परवाह नहीं कौन सुनता है।"' }, next: 'animals_realise' },
        { text: { en: '🤍 "Just quietly. Just enough to feel real again. Just for me."',       hi: '🤍 "बस धीरे से। बस इतना कि फिर से असली लगे। बस मेरे लिए।"' },           next: 'animals_realise' },
      ],
    },

    // ── PATH B · NODE 7 ────────────────────────────────────────
    // Animals hear the jackal cry. Instead of rage — silence.
    // Someone remembers he told them the truth on the first day.
    // IMAGE: animals_realise.jpg — animals standing in stunned
    //        silence under moonlight, some with heads bowed in
    //        shame, the deer standing beside the blue jackal
    // ──────────────────────────────────────────────────────────
    animals_realise: {
      scene: 'forest_dark',
      image: '/images/the-blue-jackal/the-blue-jackal-animals-realise.jpg',
      isAlternate: true,
      text: {
        en: `The forest went silent.

Every animal had heard it. That sound. Unmistakably a jackal's cry.

But this time, instead of rage — a terrible stillness.

The old tortoise spoke first, very slowly.

"He told us. On the very first day. He stood in the clearing with his paws open and he said: I am Chandarava. I fell into a dye vat. It is only colour."

Nobody spoke.

"We didn't believe him," the tortoise continued. "Not because he lied. Because he looked different. Because we were afraid of something we had never seen before. And so we made him into a god — because that was easier than simply listening."

The bear sat down heavily.

The lion said nothing. His ears were flat.

The small deer walked quietly to Chandarava's side and stood there.

"I heard you," she said. "I always heard you."`,
        hi: `जंगल चुप हो गया।

हर जानवर ने सुना था। वह आवाज़। बिल्कुल सियार की चीख।

लेकिन इस बार, गुस्से की जगह — एक भयानक स्थिरता।

बूढ़ा कछुआ पहले बोला, बहुत धीरे।

"उसने बताया था। पहले ही दिन। वह खुले पंजों के साथ मैदान में खड़ा था और उसने कहा था: मैं चंदरव हूँ। मैं रंग के कुंड में गिर गया था। यह बस रंग है।"

कोई नहीं बोला।

"हमने उस पर यकीन नहीं किया," कछुए ने जारी रखा। "इसलिए नहीं कि उसने झूठ बोला। इसलिए कि वह अलग दिखता था। इसलिए कि हम किसी ऐसी चीज़ से डरे जो हमने पहले कभी नहीं देखी थी। और इसलिए हमने उसे भगवान बना दिया — क्योंकि यह बस सुनने से आसान था।"

भालू भारी कदमों से बैठ गया।

शेर कुछ नहीं बोला। उसके कान झुके हुए थे।

छोटी हिरनी चुपचाप चंदरव के पास आई और वहाँ खड़ी हो गई।

"मैंने सुना था," उसने कहा। "मैंने हमेशा सुना था।"`,
      },
      question: {
        en: 'The animals just remembered that you told them the truth from the very beginning. They are looking at you differently now. What do you want to say?',
        hi: 'जानवरों को अभी याद आया कि तुमने शुरू से ही सच बताया था। वे अब तुम्हें अलग नज़रों से देख रहे हैं। तुम क्या कहना चाहते हो?',
      },
      choices: [
        { text: { en: '💬 "I told you. I told you on the very first day and you didn\'t listen."', hi: '💬 "मैंने बताया था। पहले ही दिन बताया था और तुमने नहीं सुना।"' },          next: 'ending_believed' },
        { text: { en: '🤝 "It\'s okay. I know how frightening something different can look."',     hi: '🤝 "कोई बात नहीं। मैं जानता हूँ अलग दिखने वाली चीज़ कितनी डरावनी लग सकती है।"' }, next: 'ending_believed' },
      ],
    },

    // ── PATH B · ENDING 3 ──────────────────────────────────────
    // Not a victory. Something was lost and something was learned.
    // The lesson lands on the animals — not the jackal.
    // IMAGE: ending_believed.jpg — blue jackal and the small deer
    //        walking side by side at dawn, animals watching from
    //        behind with changed expressions, quiet and reflective
    // ──────────────────────────────────────────────────────────
    ending_believed: {
      scene: 'forest_dawn',
      image: '/images/the-blue-jackal/the-blue-jackal-ending-believed.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `The animals did not ask Chandarava to stay as king.

And Chandarava did not ask to.

He stepped down from the throne and walked to the edge of the forest as the sun rose. The deer walked with him.

Behind them, the animals stood in the early morning light — quieter than they had been in a long time. Some looked at the ground. The lion stared at nothing.

At the edge of the trees, Chandarava paused.

"The dye will wash out," he said. "In a few rains. You'll see."

He looked back once at the forest he had been part of his whole life.

"Maybe next time," he said quietly, "listen first."

Then he walked on.

The Panchatantra teaches:
"We fear what we do not understand. And in our fear, we often refuse to hear the truth even when it is standing right in front of us, paws open, asking to be seen.
The cost of that fear is never paid by the one who is feared.
It is paid by the one who told the truth — and was not believed."`,
        hi: `जानवरों ने चंदरव से राजा के रूप में रुकने को नहीं कहा।

और चंदरव ने माँगा भी नहीं।

वह सिंहासन से उतरा और सूरज उगते हुए जंगल के किनारे की तरफ चला। हिरनी उसके साथ चली।

उनके पीछे, जानवर सुबह की शुरुआती रोशनी में खड़े थे — काफी देर से जितने शांत थे उससे ज़्यादा शांत। कुछ ज़मीन देख रहे थे। शेर किसी अनजान दिशा में ताक रहा था।

पेड़ों के किनारे, चंदरव रुका।

"रंग धुल जाएगा," उसने कहा। "कुछ बारिशों में। तुम देखोगे।"

उसने एक बार उस जंगल की तरफ देखा जिसका वह पूरी ज़िंदगी हिस्सा था।

"शायद अगली बार," उसने धीरे कहा, "पहले सुनना।"

फिर वह आगे चल दिया।

पञ्चतन्त्र सिखाता है:
"हम उसे डरते हैं जिसे नहीं समझते। और अपने डर में, हम अक्सर सच सुनने से मना कर देते हैं, भले ही वह सच हमारे सामने खड़ा हो, खुले पंजों के साथ, देखे जाने की माँग करता।
उस डर की कीमत वह नहीं चुकाता जिससे डरा जाता है।
वह चुकाता है जिसने सच बोला — और जिस पर यकीन नहीं किया गया।"`,
      },
      lesson: { en: "We often refuse to hear the truth when it comes in an unfamiliar shape. The one who pays the price for our fear is always the one who was honest.", hi: 'हम अक्सर सच सुनने से मना कर देते हैं जब वह अनजानी शक्ल में आता है। हमारे डर की कीमत हमेशा वही चुकाता है जो ईमानदार था।' },
      lessonIcon: '🦌',
    },

  },
};

export default blueJackal;
