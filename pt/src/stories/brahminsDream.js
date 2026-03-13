const brahminsDream = {
  id: 'brahmins-dream',
  title:       { en: "The Brahmin's Dream",          hi: 'ब्राह्मण का सपना' },
  description: { en: 'A poor brahmin finds a pot of sesame seeds and lies down to sleep. But his mind has other plans. One thought leads to another — and an entire empire rises and falls before morning.',
                 hi: 'एक गरीब ब्राह्मण को तिल का एक घड़ा मिलता है और वह सोने लेट जाता है। लेकिन उसके मन की और ही योजना है। एक विचार दूसरे को जन्म देता है — और सुबह होने से पहले एक पूरा साम्राज्य उठता और गिरता है।' },
  theme:       { en: 'A dream unguarded can cost you everything real', hi: 'बेलगाम सपना सब कुछ असली छीन सकता है' },
  age: '6+',
  duration:    { en: '8–12 min', hi: '८–१२ मिनट' },
  addedOn: '2026-03-09',
  featured: false,
  emoji: '🏺',
  color: '#f59e0b',
  book:        { en: 'Panchatantra — Book IV', hi: 'पञ्चतन्त्र — चतुर्थ भाग' },
  progressSteps: ['start', 'seeds_to_gold', 'gold_to_cattle', 'cattle_to_family', 'ending_crash'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Brahmin finds the pot. Lies down. First thought arrives.
    // Single choice — just one small wondering. Forward only.
    // IMAGE: start.jpg — a thin brahmin lying on a simple mat
    //        in a bare room at night, a clay pot of sesame seeds
    //        beside him, one eye open, a single small thought
    //        bubble beginning to form above his head, moonlight
    //        through a small window, expression of quiet curiosity
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-start.jpg',
      text: {
        en: `Svabhavakripana the brahmin was, by his own admission, a man of very little.

A bare room. A thin mat. A small fire that gave more smoke than heat. He worked as a teacher of verses, which in his village meant he was paid mostly in gratitude and occasionally in grain.

But today had been different.

A wealthy merchant, pleased with a recitation, had given him something extraordinary — a large clay pot, filled to the brim with sesame seeds. Good seeds. Clean seeds. Worth real money at the market.

He carried it home carefully, set it beside his mat, and lay down to sleep.

He placed one hand on the pot. Just to be sure it was there.

It was there.

He stared at the ceiling.

The fire crackled. Outside, the village settled into night. Somewhere a dog barked once and went quiet.

Svabhavakripana looked at the pot.

The pot looked back.

And one small thought, quiet as a mouse, crept into his mind:

"What if I sold these seeds tomorrow?"`,
        hi: `स्वभावकृपण ब्राह्मण, अपनी स्वीकृति से, बहुत कम का आदमी था।

एक खाली कमरा। एक पतली चटाई। एक छोटी आग जो गर्मी से ज़्यादा धुआँ देती थी। वह श्लोक पढ़ाने का काम करता था, जिसका मतलब उसके गाँव में था कि उसे ज़्यादातर कृतज्ञता और कभी-कभी अनाज मिलता था।

लेकिन आज का दिन अलग था।

एक अमीर व्यापारी, एक पाठ से प्रसन्न होकर, उसे कुछ असाधारण दे गया था — एक बड़ा मिट्टी का घड़ा, तिल के बीजों से भरा हुआ। अच्छे बीज। साफ़ बीज। बाज़ार में असली पैसे की कीमत।

वह उसे सावधानी से घर ले आया, चटाई के पास रखा, और सोने लेट गया।

उसने एक हाथ घड़े पर रखा। बस यह पक्का करने के लिए कि वह वहाँ है।

था।

उसने छत को देखा।

आग चटचटाई। बाहर, गाँव रात में सो गया। कहीं एक कुत्ता एक बार भौंका और चुप हो गया।

स्वभावकृपण ने घड़े को देखा।

घड़े ने वापस देखा।

और एक छोटा विचार, चूहे जितना शांत, उसके मन में आ घुसा:

"क्या हो अगर मैं कल ये बीज बेच दूँ?"`,
      },
      question: {
        en: 'Just one small thought. Harmless enough. Where does it go from here?',
        hi: 'बस एक छोटा सा विचार। काफी हानिरहित। यहाँ से यह कहाँ जाता है?',
      },
      choices: [
        { text: { en: '😏 "Oh, this is interesting. Keep going."', hi: '😏 "ओह, यह दिलचस्प है। आगे बढ़ते हैं।"' }, next: 'seeds_to_gold' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Seeds sold, money in hand. Mind races to goats.
    // Single choice — the first leap. Forward only.
    // IMAGE: seeds_to_gold.jpg — the brahmin still lying on his
    //        mat, eyes now bright and open, above him a dream
    //        sequence begins to form: seeds transforming into
    //        gleaming coins in his imagination, his hands
    //        gesturing slightly in the air as he thinks
    // ──────────────────────────────────────────────────────────
    seeds_to_gold: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-seeds-to-gold.jpg',
      text: {
        en: `The thought had a life of its own now.

He would sell the seeds first thing in the morning. The merchant had said good seeds — the market would agree. He calculated quickly in the dark. That many seeds, that weight, that quality...

He sat up slightly.

Yes. A real sum. Not a fortune, but a start.

And with a start—

He lay back down. His hands laced behind his head. The ceiling was becoming interesting.

With that money — not all of it, just half — he could buy goats. Two, maybe three. Young ones. Healthy. Goats multiplied quickly if you knew what you were doing, and Svabhavakripana knew enough.

He closed his eyes and saw them clearly. Three goats in a small pen behind his house, which he didn't have yet but would. Brown ones. One with a bell.

Three goats became six. Six became twelve.

His breathing slowed. His face had a different expression now — something between calculation and pleasure.

"Goats," he murmured softly.

The pot sat beside him, full and silent and entirely unaware of what it had started.`,
        hi: `अब वह विचार अपनी ज़िंदगी जीने लगा था।

वह सुबह सबसे पहले बीज बेचेगा। व्यापारी ने अच्छे बीज कहे थे — बाज़ार भी मानेगा। उसने अँधेरे में जल्दी से हिसाब लगाया। इतने बीज, इतना वज़न, इतनी गुणवत्ता...

वह थोड़ा उठकर बैठ गया।

हाँ। एक असली रकम। भाग्य नहीं, लेकिन एक शुरुआत।

और एक शुरुआत के साथ —

वह फिर लेट गया। हाथ सिर के पीछे बाँध लिए। छत दिलचस्प होती जा रही थी।

उस पैसे से — सब नहीं, बस आधे से — वह बकरियाँ खरीद सकता था। दो, शायद तीन। छोटी। स्वस्थ। बकरियाँ जल्दी बढ़ती हैं अगर तुम जानते हो क्या करना है, और स्वभावकृपण काफी जानता था।

उसने आँखें बंद कीं और उन्हें साफ़ देखा। अपने घर के पीछे एक छोटे बाड़े में तीन बकरियाँ, जो अभी नहीं था लेकिन होगा। भूरी। एक के गले में घंटी।

तीन बकरियाँ छह हो गईं। छह बारह।

उसकी साँस धीमी हो गई। उसके चेहरे पर अब एक अलग भाव था — हिसाब और खुशी के बीच कुछ।

"बकरियाँ," उसने धीरे से बुदबुदाया।

घड़ा उसके पास बैठा रहा, भरा हुआ और चुप, इस बात से बिल्कुल अनजान कि उसने क्या शुरू किया था।`,
      },
      question: {
        en: 'The goats are multiplying nicely in your mind. Where does this go next?',
        hi: 'बकरियाँ मन में अच्छी तरह बढ़ रही हैं। यह आगे कहाँ जाता है?',
      },
      choices: [
        { text: { en: '🤩 "Yes. Yes! This could actually work."', hi: '🤩 "हाँ। हाँ! यह सच में काम कर सकता है।"' }, next: 'gold_to_cattle' },
      ],
    },

    // ── NODE 3 ─────────────────────────────────────────────────
    // Goats to cows to buffaloes to horses. A prosperous man now.
    // Mind leaps to the social — a house, a wife, a family.
    // Single choice — the biggest leap yet. Forward only.
    // IMAGE: gold_to_cattle.jpg — brahmin on his mat, eyes closed
    //        and smiling, above him an elaborate dream world
    //        visible: goats, then cows, then buffaloes in
    //        procession, a fine house beginning to take shape
    //        at the edge of the dream, wealth accumulating
    // ──────────────────────────────────────────────────────────
    gold_to_cattle: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-gold-to-cattle.jpg',
      text: {
        en: `The goats became cows without any effort at all.

Twelve goats, carefully traded, carefully timed — cows. Four cows, then eight. He knew a man outside the village who dealt in cattle. Honest enough. They shook hands in his mind and the deal was done.

Eight cows became four buffaloes. Buffaloes were where the real money was — milk in quantity, the kind merchants bought by the vat. He would need a larger pen now. He built it in his mind in about thirty seconds, which was faster than actual construction but produced excellent results.

The fire had burned low. He didn't notice.

The buffaloes became horses. Not many — two, perhaps three. A man with horses was a man people looked at differently. A man with horses could travel. A man with horses could do business with the people in the city, not just the village.

He was sitting up again now, though he didn't remember doing it.

His hands were moving slightly in the dark — adding, counting, arranging.

A house. He would need a proper house. Stone, not mud. Two rooms, then three. A courtyard with a tulsi plant in the centre, because that was what a proper home had.

And a house needed — he paused here, just for a moment, because this was a larger thought than the others.

A house needed a family.`,
        hi: `बकरियाँ बिना किसी मेहनत के गायें बन गईं।

बारह बकरियाँ, सावधानी से बेची, सावधानी से समय लगाया — गायें। चार गायें, फिर आठ। वह गाँव के बाहर एक आदमी को जानता था जो मवेशियों का व्यापार करता था। काफी ईमानदार। उन्होंने मन में हाथ मिलाया और सौदा हो गया।

आठ गायें चार भैंसें बन गईं। भैंसें वह जगह थीं जहाँ असली पैसा था — ढेर सारा दूध, जैसा व्यापारी घड़ों में खरीदते हैं। अब उसे बड़े बाड़े की ज़रूरत होगी। उसने इसे मन में लगभग तीस सेकंड में बना लिया, जो असली निर्माण से तेज़ था लेकिन बेहतरीन नतीजे देता था।

आग मद्धम हो गई थी। उसने ध्यान नहीं दिया।

भैंसें घोड़े बन गईं। ज़्यादा नहीं — दो, शायद तीन। घोड़े वाले आदमी को लोग अलग नज़र से देखते हैं। घोड़े वाला आदमी यात्रा कर सकता है। घोड़े वाला आदमी गाँव के नहीं, शहर के लोगों से व्यापार कर सकता है।

वह अब फिर से बैठ गया था, हालाँकि उसे याद नहीं कि कब।

उसके हाथ अँधेरे में थोड़ा हिल रहे थे — जोड़ते, गिनते, व्यवस्थित करते।

एक घर। उसे एक सही घर चाहिए होगा। पत्थर का, मिट्टी का नहीं। दो कमरे, फिर तीन। बीच में तुलसी का पौधा लगे आँगन, क्योंकि सही घर में यही होता है।

और एक घर की ज़रूरत थी — यहाँ वह एक पल रुका, बस एक पल, क्योंकि यह बाकी से बड़ा विचार था।

एक घर को परिवार की ज़रूरत थी।`,
      },
      question: {
        en: 'The house is built. The courtyard has a tulsi plant. What comes next in this world you are making?',
        hi: 'घर बन गया। आँगन में तुलसी का पौधा है। इस दुनिया में जो तुम बना रहे हो, आगे क्या आता है?',
      },
      choices: [
        { text: { en: '😄 "I am just getting started."', hi: '😄 "मैं तो अभी शुरू ही हुआ हूँ।"' }, next: 'cattle_to_family' },
      ],
    },

    // ── NODE 4 — THE REAL FORK ─────────────────────────────────
    // The empire is complete. Now the son misbehaves.
    // Brahmin reaches to discipline him. One moment of choice.
    // IMAGE: cattle_to_family.jpg — brahmin sitting upright on
    //        his mat now, fully animated, arm beginning to extend
    //        outward mid-gesture, the clay pot VERY visible and
    //        close beside him, above him in dream: a beautiful
    //        house, wife, child, the whole imagined empire at
    //        its peak — and the child beginning to misbehave
    // ──────────────────────────────────────────────────────────
    cattle_to_family: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-family.jpg',
      text: {
        en: `And then — because why not, because things were going so well, because a man with horses and buffaloes and a stone house is a man who can ask for things — he had a wife.

She arrived the way good things arrive when everything is going very well: completely, without difficulty, as if she had been waiting just offstage for the right moment. Sensible. Capable. She kept the stone house in good order. He approved of her enormously.

He was barely done approving when —

They had a son.

And now he could see it all so clearly — the boy especially. Five years old perhaps, round-faced, with his mother's eyes. Running in the courtyard. Getting into things. A normal, healthy, maddening child.

He watched the boy with the particular mixture of pride and exasperation that only a parent knows.

The horses needed attention and the boy had gone into the stable despite being told three times this week, explicitly, not to go into the stable, and now there was mud everywhere—

Svabhavakripana raised his arm.

"Come here. I have told you before about the stable. You do not listen and a father must—"

He paused.

His arm was still in the air.

Somewhere behind the courtyard and the boy and the mud-covered stable, something hard and cool pressed against his elbow.

He had forgotten it was there.`,
        hi: `और फिर — क्यों नहीं, क्योंकि सब कुछ इतना अच्छा चल रहा था, क्योंकि घोड़ों और भैंसों और तुलसी के पौधे वाले पत्थर के घर वाला आदमी माँग सकता है — उसकी एक पत्नी थी।

वह उस तरह आई जैसे अच्छी चीज़ें तब आती हैं जब सब कुछ ठीक चल रहा हो: पूरी तरह, बिना किसी मुश्किल के, जैसे सही पल का इंतज़ार करते हुए पर्दे के पीछे खड़ी थी। समझदार। सक्षम। वह पत्थर के घर को ठीक रखती थी। वह उसे बहुत पसंद था।

वह मुश्किल से उसे पसंद करना खत्म कर पाया था जब —

उनका एक बेटा था।

और अब वह सब इतना साफ़ दिख रहा था — खासकर लड़का। शायद पाँच साल का, गोल चेहरा, माँ की आँखें। आँगन में दौड़ता हुआ। चीज़ों में हाथ डालता हुआ। एक सामान्य, स्वस्थ, थकाने वाला बच्चा।

उसने लड़के को उस खास मिश्रण से देखा जो सिर्फ माता-पिता जानते हैं — गर्व और झुँझलाहट का।

घोड़ों को ध्यान देने की ज़रूरत थी और लड़का अस्तबल में चला गया था, इस हफ्ते तीन बार साफ़ मना करने के बावजूद, अस्तबल में मत जाओ, और अब हर जगह कीचड़ था —

स्वभावकृपण ने हाथ उठाया।

"इधर आओ। मैंने तुम्हें अस्तबल के बारे में पहले भी बताया है। तुम सुनते नहीं और एक पिता को —"

वह रुका।

उसका हाथ अभी भी हवा में था।

आँगन और लड़के और कीचड़ भरे अस्तबल के पीछे कहीं, कुछ सख्त और ठंडा उसकी कोहनी से लगा।

वह भूल गया था कि वह वहाँ था।`,
      },
      question: {
        en: 'Your arm is up. The boy is waiting. Something cold is pressing against your elbow. What do you do?',
        hi: 'तुम्हारा हाथ उठा है। लड़का इंतज़ार कर रहा है। कुछ ठंडा तुम्हारी कोहनी से लग रहा है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '👆 "Teach him. My arm is already raised — finish it."',  hi: '👆 "उसे सिखाओ। हाथ पहले से उठा है — पूरा करो।"' }, next: 'ending_crash' },
        { text: { en: '😌 "Stop. Something just touched my elbow."',    hi: '😌 "रुको। अभी कुछ मेरी कोहनी से लगा।"' },              next: 'ending_awake' },
      ],
    },

    // ── ENDING 1 ───────────────────────────────────────────────
    // He reaches. His elbow hits the pot. Seeds everywhere.
    // Sits in the dark surrounded by the ruins of everything.
    // IMAGE: ending_crash.jpg — brahmin sitting in shock on his
    //        mat, the shattered or tipped clay pot beside him,
    //        sesame seeds scattered across the floor catching
    //        the moonlight, his arm still extended mid-gesture,
    //        his expression the particular blankness of someone
    //        who has just lost something very real and very gone
    // ──────────────────────────────────────────────────────────
    ending_crash: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-ending-crash.jpg',
      isEnding: true,
      text: {
        en: `His elbow caught the pot.

The sound was not dramatic. A soft thud, a rolling, a long hiss as thousands of seeds poured across the floor.

Svabhavakripana sat very still.

He looked at the seeds spread across the bare floor. White in the moonlight. Every single one of them exactly where it had been before — still seeds, still real, still worth the same money at tomorrow's market.

Except that now they were all over the floor.

He sat there for a long time.

The horses were gone. The buffaloes were gone. The stone house with the courtyard and the tulsi plant — gone. The sensible wife he had approved of — gone. The round-faced boy with mud on his feet who did not listen — gone.

He had built an empire tonight.

He had also destroyed it.

Both, without leaving this room. Both, without the seeds ever becoming anything more than seeds.

He began, slowly, to sweep them back into the pot with his hands.

The fire had gone out. The room was cold. Outside, the dog barked once and went quiet.

The Panchatantra teaches:
"The man who lives only in his dreams forgets to guard what is real. While he is being a king in his mind, the seeds spill on the floor.
You cannot hold the pot and the empire at the same time. Choose which one is in your hands."`,
        hi: `उसकी कोहनी घड़े से लगी।

आवाज़ नाटकीय नहीं थी। एक हल्की थपथपाहट, लुढ़कना, एक लंबी सी आवाज़ जब हज़ारों बीज फर्श पर बिखर गए।

स्वभावकृपण बिल्कुल स्थिर बैठा रहा।

उसने खाली फर्श पर फैले बीजों को देखा। चाँदनी में सफ़ेद। उनमें से हर एक ठीक वहीं था जहाँ पहले था — अभी भी बीज, अभी भी असली, कल के बाज़ार में अभी भी उतनी ही कीमत।

बस अब वे फर्श पर बिखरे थे।

वह बहुत देर तक वहाँ बैठा रहा।

घोड़े चले गए। भैंसें चली गईं। आँगन और तुलसी के पौधे वाला पत्थर का घर — चला गया। वह समझदार पत्नी जिसे वह पसंद करता था — चली गई। पैरों पर कीचड़ लगाए वह गोल चेहरे वाला लड़का जो नहीं सुनता था — चला गया।

उसने आज रात एक साम्राज्य बनाया था।

उसने उसे नष्ट भी किया था।

दोनों, इस कमरे से बाहर जाए बिना। दोनों, बिना बीजों के बीजों से कुछ और बने।

उसने धीरे-धीरे उन्हें हाथों से घड़े में वापस समेटना शुरू किया।

आग बुझ गई थी। कमरा ठंडा था। बाहर, कुत्ता एक बार भौंका और चुप हो गया।

पञ्चतन्त्र सिखाता है:
"जो आदमी केवल सपनों में जीता है वह असली चीज़ की रखवाली करना भूल जाता है। जब वह मन में राजा बन रहा होता है, बीज फर्श पर बिखर जाते हैं।
घड़ा और साम्राज्य एक साथ हाथ में नहीं रह सकते। चुनो कि तुम्हारे हाथ में कौन सा है।"`,
      },
      lesson: { en: "You cannot hold the pot and the empire at the same time. Dreams are good servants but dangerous masters.", hi: 'घड़ा और साम्राज्य एक साथ हाथ में नहीं रह सकते। सपने अच्छे सेवक हैं लेकिन खतरनाक मालिक।' },
      lessonIcon: '🏺',
    },

    // ── ENDING 2 ───────────────────────────────────────────────
    // He catches himself. Opens his eyes. Pot still there.
    // In the morning, sells the seeds — one real step at a time.
    // IMAGE: ending_awake.jpg — brahmin sitting on his mat in
    //        early morning light, the clay pot safe beside him,
    //        his hand resting gently on it, a small genuine smile,
    //        the window showing the first pale light of dawn,
    //        the room the same bare room but now somehow enough
    // ──────────────────────────────────────────────────────────
    ending_awake: {
      scene: 'village',
      image: '/images/the-brahmins-dream/the-brahmins-dream-ending-awake.jpg',
      isEnding: true,
      text: {
        en: `Svabhavakripana opened his eyes.

The room was dark. The fire was low. The pot was beside him, one foot from his elbow, exactly where he had placed it.

He looked at his arm — still raised slightly, reaching toward a boy who did not exist, in a courtyard that had never been built, behind a house he did not own.

He lowered his arm slowly.

He sat with it for a moment. The whole journey — the seeds, the goats, the cows, the buffaloes, the horses, the stone house, the sensible wife, the round-faced boy with mud on his feet. The entire empire that had risen and nearly fallen in the space of a single night.

Then he laughed. A short, real, quiet laugh — the kind that comes when you catch yourself doing something very human.

He put his hand on the pot. It was cool and full and solid.

"Still here," he said.

He lay back down. This time he slept.

In the morning, he went to the market. He sold the seeds for a fair price. He spent the money carefully — a little for food, a little saved, a little toward a better fire for the winter.

One step. One real step.

And as he walked home with his hands in his pockets and the faint smell of sesame still on his fingers, he thought about the stone house and almost smiled.

The Panchatantra teaches:
"The same imagination that builds castles in the air can build real ones on the ground — but only if you keep one eye open and one hand on what you actually have.
Dream well. And then wake up and begin."`,
        hi: `स्वभावकृपण ने आँखें खोलीं।

कमरा अँधेरा था। आग मद्धम थी। घड़ा उसके पास था, कोहनी से एक फुट दूर, ठीक वहाँ जहाँ उसने रखा था।

उसने अपना हाथ देखा — अभी भी थोड़ा उठा हुआ, एक ऐसे लड़के की तरफ पहुँचता जो था ही नहीं, उस आँगन में जो कभी बना ही नहीं, उस घर के पीछे जो उसका था ही नहीं।

उसने धीरे-धीरे हाथ नीचे किया।

वह एक पल के साथ बैठा रहा। पूरी यात्रा — बीज, बकरियाँ, गायें, भैंसें, घोड़े, पत्थर का घर, समझदार पत्नी, पैरों पर कीचड़ लगाए गोल चेहरे वाला लड़का। पूरा साम्राज्य जो एक ही रात में उठा था और लगभग गिर गया था।

फिर वह हँसा। एक छोटी, असली, शांत हँसी — जो तब आती है जब तुम खुद को कुछ बहुत इंसानी करते हुए पकड़ लो।

उसने घड़े पर हाथ रखा। ठंडा और भरा और ठोस था।

"अभी भी यहाँ है," उसने कहा।

वह फिर लेट गया। इस बार सो गया।

सुबह, वह बाज़ार गया। उसने बीज सही दाम पर बेचे। पैसे सावधानी से खर्च किए — थोड़ा खाने के लिए, थोड़ा बचाया, थोड़ा सर्दी के लिए बेहतर आग की तरफ।

एक कदम। एक असली कदम।

और जब वह जेब में हाथ डाले घर चला और उँगलियों पर तिल की हल्की खुशबू थी, तो उसने पत्थर के घर के बारे में सोचा और लगभग मुस्कुराया।

पञ्चतन्त्र सिखाता है:
"वही कल्पना जो हवा में महल बनाती है, ज़मीन पर भी असली महल बना सकती है — लेकिन सिर्फ तभी जब एक आँख खुली रहे और एक हाथ वह थामे जो तुम्हारे पास सच में है।
खूब सपने देखो। और फिर जागो और शुरू करो।"`,
      },
      lesson: { en: "Dream well — and then wake up and begin. The same imagination that builds castles in the air can build real ones, if you keep one hand on what you have.", hi: 'खूब सपने देखो — और फिर जागो और शुरू करो। वही कल्पना हवा में और ज़मीन पर दोनों महल बना सकती है, अगर एक हाथ वह थामे जो तुम्हारे पास है।' },
      lessonIcon: '🌅',
    },

  },
};

export default brahminsDream;
