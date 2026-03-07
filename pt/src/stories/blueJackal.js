const blueJackal = {
  id: 'blue-jackal',
  title:       { en: 'The Blue Jackal',         hi: 'नीला सियार' },
  description: { en: 'A jackal falls into a vat of blue dye and emerges looking like no animal anyone has ever seen. He could tell the truth — or he could become a king. What would you do?',
                 hi: 'एक सियार नीले रंग के कुंड में गिर जाता है और ऐसा दिखने लगता है जैसा कोई जानवर किसी ने नहीं देखा। वह सच बता सकता है — या राजा बन सकता है। तुम क्या करते?' },
  theme:       { en: 'A borrowed identity never truly fits', hi: 'उधार की पहचान कभी सच्ची नहीं होती' },
  age: '7+',
  duration:    { en: '10–14 min', hi: '१०–१४ मिनट' },
  addedOn: '2026-03-07',
  featured: false,
  emoji: '🐺',
  color: '#60a5fa',
  book:        { en: 'Panchatantra — Book III', hi: 'पञ्चतन्त्र — तृतीय भाग' },
  progressSteps: ['start', 'declares_kingship', 'ruling_the_forest', 'moonlit_night', 'ending_unmasked'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Jackal falls into dye vat, emerges bright blue.
    // Sees his reflection — shock turns into temptation.
    // IMAGE: start.jpg — blue jackal emerging from vat, staring
    //        at reflection in the water, eyes wide with wonder
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
        { text: { en: '😲 "I look like nothing anyone has ever seen... I could use this."', hi: '😲 "मैं ऐसा दिखता हूँ जैसा किसी ने कभी नहीं देखा... मैं इसका फ़ायदा उठा सकता हूँ।"' }, next: 'declares_kingship' },
        { text: { en: '😟 "This is just dye. I should tell everyone what happened."',        hi: '😟 "यह तो बस रंग है। मुझे सबको बताना चाहिए कि क्या हुआ।"' },                          next: 'declares_kingship' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Jackal walks into the forest. Animals flee in terror.
    // He makes his move — declares himself sent by the gods.
    // IMAGE: declares_kingship.jpg — blue jackal standing tall
    //        in forest clearing, animals cowering in awe around him
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
        en: 'Every animal in the forest believes you are a god-sent king. The lion himself bows. This is really working. What do you do next?',
        hi: 'जंगल का हर जानवर मानता है कि तुम भगवान के भेजे राजा हो। शेर खुद झुकता है। यह सच में काम कर रहा है। अब तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '👑 "Lions will hunt for me. Elephants will fan me. This is the life!"',       hi: '👑 "शेर मेरे लिए शिकार करेंगे। हाथी मुझे हवा देंगे। यही तो ज़िंदगी है!"' },        next: 'ruling_the_forest' },
        { text: { en: '😬 "Just for one day. Then I\'ll tell them. One day can\'t hurt... right?"', hi: '😬 "बस एक दिन। फिर बता दूँगा। एक दिन से क्या नुकसान... है ना?"' },               next: 'ruling_the_forest' },
      ],
    },

    // ── NODE 3 ─────────────────────────────────────────────────
    // Jackal rules in luxury. But jackals howl at night nearby.
    // He sends them away — but feels something pulling at him.
    // IMAGE: ruling_the_forest.jpg — blue jackal on rock throne,
    //        lions and elephants serving him, living in luxury
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

Chandarava looked at the jackals. Then at the forest full of animals who trusted him completely.

"These animals trust me," a voice inside him said. "Maybe I should just... come clean."

Another voice said: "But you will lose everything."`,
        hi: `दिन बीते। फिर हफ्ते।

चंदरव सच्चे राजा की तरह जीने लगा। शेर उसके लिए शिकार करते। हाथी उसे अपने कानों से हवा देते। बाघ उसकी माँद की रखवाली करते। यहाँ तक कि पक्षी उसके लिए सबसे मीठे जामुन लाते।

लेकिन चंदरव ने एक सख्त आदेश दिया था: सभी सियारों को दूर रखो। बहुत दूर।

क्योंकि सियार उसे जानते थे। और सियार पहचान जाते।

एक शाम, सियारों का एक झुंड जंगल के किनारे आया। चंदरव ने उन्हें अपने सिंहासन से देखा और उसकी छाती में कुछ अजीब हलचल हुई। कुछ गर्म और जाना-पहचाना।

वे बिल्कुल उसी जैसे दिखते थे। जैसा वह पहले था।

शेर उसकी तरफ मुड़ा। "क्या मैं उन्हें भगा दूँ, महाराज?"

चंदरव ने सियारों को देखा। फिर उन जानवरों से भरे जंगल को जो उस पर पूरा भरोसा करते थे।

"ये जानवर मुझ पर भरोसा करते हैं," उसके अंदर एक आवाज़ बोली। "शायद मुझे सच बता देना चाहिए।"

दूसरी आवाज़ बोली: "लेकिन तुम सब कुछ खो दोगे।"`,
      },
      question: {
        en: 'You have everything — power, comfort, loyalty. But it is all built on a lie. A pack of jackals is at the edge of the forest. What do you do?',
        hi: 'तुम्हारे पास सब कुछ है — शक्ति, आराम, वफ़ादारी। लेकिन यह सब एक झूठ पर टिका है। सियारों का झुंड जंगल के किनारे है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '🐺 "Chase them away. No jackal comes near this forest. Ever."',              hi: '🐺 "उन्हें भगा दो। कोई सियार इस जंगल के पास नहीं आएगा। कभी नहीं।"' },         next: 'moonlit_night' },
        { text: { en: '💛 "Wait. These animals trust me. I owe them the truth."',                  hi: '💛 "रुको। ये जानवर मुझ पर भरोसा करते हैं। मेरा फर्ज़ है कि मैं सच बताऊँ।"' }, next: 'ending_confessed' },
      ],
    },

    // ── NODE 4 — PATH A ─────────────────────────────────────────
    // Full moon night. Jackals howl in the distance.
    // The instinct rises. He tries to hold it. He can't.
    // IMAGE: moonlit_night.jpg — blue jackal alone under full
    //        moon, distant jackals on a hill, face torn with longing
    // ──────────────────────────────────────────────────────────
    moonlit_night: {
      scene: 'forest_dark',
      image: '/images/the-blue-jackal/the-blue-jackal-moonlit-night.jpg',
      isAlternate: true,
      text: {
        en: `The jackals were chased away. Life went on.

But then came the full moon.

Far away on a hill, a pack of jackals began to howl. A long, rising, ancient sound — the sound Chandarava had heard every night of his life before the dye, before the throne, before all of this.

Something in his chest cracked open.

His throat tightened. His head tilted up toward the moon without him deciding to tilt it. The howl rose inside him like water from a deep well —

"Don't," he told himself. "You are Kakudruma. King of the forest. Kings don't howl."

The jackals howled again.

His whole body trembled.

"Just hold it in. Just hold it in. Just hold it—"`,
        hi: `सियारों को भगा दिया गया। ज़िंदगी चलती रही।

लेकिन फिर पूर्णिमा आई।

दूर एक पहाड़ी पर, सियारों का एक झुंड चिल्लाने लगा। एक लंबी, उठती, पुरानी आवाज़ — वह आवाज़ जो चंदरव ने रंग से पहले, सिंहासन से पहले, इन सब से पहले हर रात सुनी थी।

उसकी छाती में कुछ टूट गया।

उसका गला भर आया। उसका सिर बिना सोचे चाँद की तरफ उठ गया। वह हुंकार उसके अंदर से एक गहरे कुएँ के पानी की तरह उठी —

"मत करो," उसने खुद से कहा। "तुम काकुद्रुम हो। जंगल के राजा। राजा नहीं चिल्लाते।"

सियार फिर चिल्लाए।

उसका पूरा शरीर काँपा।

"बस रोको। बस रोको। बस रो—"`,
      },
      question: {
        en: 'Every part of you wants to howl with them. You have been holding it in for weeks. The moon is full and the jackals are singing. What happens?',
        hi: 'तुम्हारा पूरा मन उनके साथ चिल्लाना चाहता है। तुम हफ्तों से रोक रहे हो। चाँद पूरा है और सियार गा रहे हैं। क्या होता है?',
      },
      choices: [
        { text: { en: '😰 "Don\'t howl. Don\'t howl. Don\'t—" ...and then it escapes anyway.',  hi: '😰 "मत चिल्लाओ। मत चिल्लाओ। मत—" ...और फिर निकल ही जाता है।' }, next: 'ending_unmasked' },
        { text: { en: '🐺 "Just one little howl won\'t hurt..." and he lets it out.',            hi: '🐺 "बस एक छोटी सी आवाज़ से क्या होगा..." और वह निकाल देता है।' },  next: 'ending_unmasked' },
      ],
    },

    // ── NODE 5a — PATH A ENDING ─────────────────────────────────
    // He howls. Animals recognise the sound instantly.
    // The lie collapses. He is chased out of the forest.
    // IMAGE: ending_unmasked.jpg — blue jackal mid-howl, animals
    //        recoiling, the lie exposed in one terrible moment
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

The animals surged forward.

Chandarava ran. He ran faster than he had ever run in his life — faster than the night the dogs had chased him into the dye vat.

He ran until the forest was far behind him, until the throne and the lions and the elephants were just a memory.

He sat alone at the edge of a field, panting, blue, and entirely himself.

The Panchatantra teaches:
"You can wear the colour of a king, speak in the voice of a god, and sit on the highest throne — but when the moon is full and your true nature calls, you will answer."`,
        hi: `"आओओओओ—"

वह हुंकार उससे रुकने से पहले ही निकल गई। लंबी, काँपती, बिल्कुल सियार की आवाज़। राजा की दहाड़ नहीं। किसी देवता की वाणी नहीं।

सियार की हुंकार।

जंगल बिल्कुल चुप हो गया।

फिर शेर बोला। बहुत धीरे।

"...यह तो सियार की आवाज़ है।"

हर सिर मुड़ा। हर आँख ने चंदरव को देखा। नीला रंग अभी भी था — लेकिन अब वे रंग के पार देख सकते थे। उसका आकार। उसका कद। उसकी पूँछ पकड़ने का तरीका।

"यह सियार है," भालू बोला। "बस नीले रंग से रंगा हुआ सियार।"

जानवर आगे बढ़े।

चंदरव भाग गया। वह इतनी तेज़ दौड़ा जितना उसने कभी नहीं दौड़ा था — उस रात से भी तेज़ जब कुत्तों ने उसे रंग के कुंड में धकेला था।

वह तब तक दौड़ा जब तक जंगल बहुत पीछे नहीं हो गया, जब तक सिंहासन और शेर और हाथी बस एक याद नहीं रह गए।

वह एक खेत के किनारे अकेला बैठा, हाँफता हुआ, नीला, और पूरी तरह वही जो वह था।

पञ्चतन्त्र सिखाता है:
"तुम राजा का रंग पहन सकते हो, देवता की आवाज़ में बोल सकते हो, और सबसे ऊँचे सिंहासन पर बैठ सकते हो — लेकिन जब चाँद पूरा हो और तुम्हारी असली फितरत बुलाए, तो तुम जवाब दोगे।"`,
      },
      lesson: { en: "A borrowed identity always breaks down. The life built on pretending to be someone else must eventually be abandoned — often at a run.", hi: 'उधार की पहचान हमेशा टूटती है। किसी और का नाटक करके बनाई गई ज़िंदगी को अंततः छोड़ना ही पड़ता है — अक्सर भागते हुए।' },
      lessonIcon: '🌕',
    },

    // ── NODE 5b — PATH B ENDING ─────────────────────────────────
    // Jackal confesses before the moon can expose him.
    // Animals furious — but he walks away with his dignity.
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

The silence stretched.

Then the lion's eyes narrowed. Then the bear growled. One by one, the animals turned away — some in anger, some in embarrassment at how easily they had believed.

No one offered to let him stay.

Chandarava walked out of the forest alone as the sun rose. Blue, hungry, and with nothing he hadn't come in with.

But something was different. Something had been put down.

He did not look back.

The Panchatantra teaches:
"The one who confesses his own lie stands taller in that moment than the one who wears a crown built on deceit. It costs everything — and yet somehow, you leave lighter."`,
        hi: `चंदरव धीरे-धीरे अपने सिंहासन से उठा।

"मुझे तुम सबको कुछ बताना है।"

जंगल चुप हो गया।

"मैं काकुद्रुम नहीं हूँ। मुझे किसी देवता ने नहीं भेजा। मैं एक सियार हूँ — भूखा, साधारण सियार — जो नीले रंग के कुंड में गिर गया और पाया कि तुम सब मुझसे डरते हो। और मैं लालच में आ गया। इसलिए मैंने झूठ बोला।"

चुप्पी खिंची।

फिर शेर की आँखें सिकुड़ीं। फिर भालू गुर्राया। एक-एक करके जानवर मुड़ गए — कुछ गुस्से में, कुछ इस बात पर शर्मिंदा कि वे इतनी आसानी से मान गए।

किसी ने उसे रुकने का प्रस्ताव नहीं दिया।

चंदरव सूरज उगते हुए अकेले जंगल से निकल गया। नीला, भूखा, और उतना ही लेकर जितना लेकर आया था।

लेकिन कुछ अलग था। कुछ उतार दिया गया था।

उसने पीछे मुड़कर नहीं देखा।

पञ्चतन्त्र सिखाता है:
"जो अपना झूठ खुद कबूल करता है, वह उस पल में उस इंसान से ऊँचा खड़ा होता है जो धोखे के ताज से सजा है। इसकी कीमत सब कुछ होती है — और फिर भी किसी तरह तुम हल्के होकर जाते हो।"`,
      },
      lesson: { en: "Telling the truth when it costs you everything is the bravest thing there is. You may lose the throne — but you keep yourself.", hi: 'जब सच बोलना सब कुछ छीन ले — तब भी सच बोलना सबसे बड़ी हिम्मत है। तुम सिंहासन खो सकते हो — लेकिन खुद को बचा लेते हो।' },
      lessonIcon: '🌅',
    },

  },
};

export default blueJackal;
