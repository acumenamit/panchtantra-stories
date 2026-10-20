const weaverAndPrincess = {
  id: 'weaver-and-princess',
  title:       { en: 'The Weaver and the Princess',   hi: 'जुलाहा और राजकुमारी' },
  description: { en: 'A weaver falls in love with a princess he has no right to love. His painter friend builds him a disguise that could change everything. But when the king sends him to war, the disguise is no longer enough.',
                 hi: 'एक जुलाहे को एक राजकुमारी से प्यार हो जाता है जिससे प्यार करने का उसे कोई अधिकार नहीं। उसका चित्रकार मित्र उसके लिए एक वेश बनाता है जो सब कुछ बदल सकता है। लेकिन जब राजा उसे युद्ध पर भेजता है, तो वेश काफी नहीं रहता।' },
  theme:       { en: 'Courage is not the absence of fear — it is deciding you are worth the risk', hi: 'साहस डर का न होना नहीं है — यह तय करना है कि तुम जोखिम के लायक हो' },
  age: '7+',
  duration:    { en: '12–16 min', hi: '१२–१६ मिनट' },
  addedOn: '2026-03-19',
  featured: false,
  emoji: '🦅',
  color: '#f59e0b',
  book:        { en: 'Panchatantra — Book III', hi: 'पञ्चतन्त्र — तृतीय भाग' },
  progressSteps: ['start', 'the_idea', 'the_visit', 'the_summon', 'sent_to_war', 'ending_warrior'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Sundara the weaver sees the princess on her balcony.
    // His painter friend Mandaraka builds the Garuda disguise.
    // Single choice — courage fork, not moral fork.
    // IMAGE: start.jpg — a young weaver standing in a narrow
    //        street at dusk, looking up at a distant palace
    //        tower glowing with lamplight, his friend the painter
    //        beside him gesturing with paint-stained hands,
    //        between them on the ground a half-built mechanical
    //        bird of teak and bamboo, gold paint gleaming
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-start.jpg',
      text: {
        en: `Sundara was a weaver.

He was twenty-two years old, quick-handed, and good at his work. Every morning he sat at his loom in the weavers' quarter of the city and made cloth — cotton in the hot months, wool when the rains came, silk when a merchant paid enough to make the careful work worthwhile. His hands knew the loom without thinking. He did not need to look at what he was doing. He could think while he worked.

He had seen her three weeks ago — the princess Chitralekha — standing on the high balcony of the palace's inner tower as her palanquin passed in procession through the main road below. Just for a moment. The lamps on the palanquin caught her face. She was looking at the crowd as if she were actually looking for something.

Sundara had stopped walking. The crowd moved around him. He stood still until the procession turned the corner and was gone.

He had not slept well in three weeks.

His oldest friend was Mandaraka the painter — a man of extraordinary skill and very little caution, who had decorated the halls of three noblemen's houses and once painted a ceiling fresco so perfectly that a visiting poet had stood beneath it for half an hour mistaking it for the actual sky. Mandaraka listened to Sundara's problem, asked a few careful questions, and then was quiet for a long time.

Then he said: "I have an idea. You are not going to like it immediately. Give it a moment before you say no."`,
        hi: `सुंदर एक जुलाहा था।

वह बाईस साल का था, हाथों में फुर्ती थी, और अपने काम में अच्छा था। हर सुबह वह शहर के जुलाहों के मोहल्ले में अपने करघे पर बैठता और कपड़ा बनाता — गर्मी में सूती, बरसात में ऊनी, और जब कोई व्यापारी इतना देता कि सावधानी से किया काम सार्थक लगे तो रेशमी। उसके हाथ बिना सोचे करघे को जानते थे। काम करते हुए उसे देखने की ज़रूरत नहीं थी। वह काम करते हुए सोच सकता था।

और इन दिनों, वह सिर्फ एक चीज़ के बारे में सोच सकता था।

उसने तीन हफ्ते पहले उसे देखा था — राजकुमारी चित्रलेखा — नीचे मुख्य सड़क से जुलूस गुज़रते समय महल के भीतरी बुर्ज की ऊँची बालकनी पर खड़ी। बस एक पल के लिए। पालकी के दीयों की रोशनी उसके चेहरे पर पड़ी। वह भीड़ को देख रही थी जैसे वह सच में कुछ ढूँढ रही हो।

सुंदर रुक गया था। भीड़ उसके आसपास से बहती रही। वह तब तक खड़ा रहा जब तक जुलूस मोड़ पर नहीं मुड़ गया।

तीन हफ्तों से उसे ठीक से नींद नहीं आई थी।

उसका सबसे पुराना मित्र था मंदरक चित्रकार — असाधारण कौशल और बहुत कम सावधानी वाला आदमी, जिसने तीन अमीरों के घरों के हॉल सजाए थे और एक बार छत पर इतनी सटीक भित्तिचित्र बनाई थी कि एक आगंतुक कवि उसके नीचे आधे घंटे तक असली आकाश समझकर खड़ा रहा था। मंदरक ने सुंदर की समस्या सुनी, कुछ सावधान सवाल पूछे, और फिर काफी देर चुप रहा।

फिर बोला: "मेरे पास एक विचार है। तुम्हें यह तुरंत पसंद नहीं आएगा। ना कहने से पहले एक पल दो।"`,
      },
      question: {
        en: 'Your friend says he has an idea. What do you say?',
        hi: 'तुम्हारे मित्र के पास एक विचार है। तुम क्या कहते हो?',
      },
      choices: [
        { text: { en: '💛 "Tell me."', hi: '💛 "बताओ।"' }, next: 'the_idea' },
      ],
    },


    // ── NODE 1b ────────────────────────────────────────────────
    // Mandaraka reveals the drawings. The Garuda described in
    // full — teak, bamboo, gold-dust paint, the spring mechanism,
    // the test flight. Sundara's hesitation. His decision.
    // Single choice — for her. Forward only.
    // IMAGE: the_idea.jpg — Mandaraka and Sundara crouched over
    //        large detailed drawings spread on a studio floor,
    //        paint pots and brushes everywhere, the mechanical
    //        bird's design visible in the drawings, Mandaraka
    //        pointing at a detail, Sundara leaning in with an
    //        expression moving from doubt toward wonder
    // ──────────────────────────────────────────────────────────
    the_idea: {
      scene: 'village',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-idea.jpg',
      text: {
        en: `He showed Sundara the drawings.

A Garuda. Not a real one — a machine. Built from teak and bamboo and canvas, painted with gold dust on the leading edges, deep red fading to blue at the wingtip feathers. A hollow cavity in the back just wide enough for one person to sit with legs braced forward against two teak pegs, hands free for the control ropes. A leather strap across the chest. The floor of the cavity padded with folded cotton.

In the chest of the bird, hidden behind a painted panel — a coiled iron spring wound tight with a key. A large brass key. When released, the spring drove a system of wooden cogs that rocked both wings in a slow, powerful beat. One full winding gave three minutes of beating. After that, the wings still moved but had to be controlled by hand.

The head was carved teak: an eagle's open beak painted gold, eyes of polished black river stone set in carved sockets, a crest of painted feathers rising from the crown. The neck jointed in three places with leather hinges so it moved with the vibration of flight. The wingspan, fully extended, was thirty feet.

"It will look exactly like the vehicle of Vishnu," Mandaraka said. "In the dark. From a distance."

"It will look like a machine built by a painter," Sundara said.

"From two hundred feet, at night, with the lamps catching the gold paint, it will not," Mandaraka said. He paused. "I built a test frame yesterday. I flew it from the roof at sunset. Three people in the street below ran. One fell over."

Sundara looked at the drawings for a long time.

He was a weaver with no title and no wealth beyond his loom and a small house. She was a princess living in a palace.

"She might not even speak to me," he said.

"She might not," Mandaraka agreed. "But you will have tried. And a man who tries is different from a man who only looks from the street."

He spent six days building it.`,
        hi: `उसने सुंदर को रेखाचित्र दिखाए।

एक गरुड़। असली नहीं — एक यंत्र। सागौन और बाँस और कैनवास से बना, अगले किनारों पर सोने की धूल से रंगा, पंखों की नोक पर गहरा लाल जो नीले में बदलता। पीछे एक खोखली जगह जिसमें एक व्यक्ति दो सागौन की खूँटियों से पैर टिकाकर बैठ सके, हाथ नियंत्रण रस्सियों के लिए स्वतंत्र। सीने पर चमड़े का पट्टा। खोखले का फर्श मुड़े हुए सूती कपड़े से गद्देदार।

पक्षी के सीने में, एक रंगे पैनल के पीछे छुपी — एक चाबी से कसकर मुड़ी लोहे की कमानी। एक बड़ी पीतल की चाबी। छोड़ने पर, कमानी लकड़ी के दाँतों की एक प्रणाली चलाती जो दोनों पंखों को धीमी, शक्तिशाली गति में हिलाती। एक पूरी चाबी से तीन मिनट की गति मिलती। उसके बाद पंख हिलते रहते लेकिन हाथ से नियंत्रित करने पड़ते।

सिर सागौन का तराशा: सोने से रंगी खुली चील की चोंच, तराशी खाँचों में लगी नदी के चमकाए काले पत्थर की आँखें, मुकुट से उठती रंगे पंखों की कलगी। गर्दन तीन जगह चमड़े के कब्ज़ों से जुड़ी ताकि उड़ान के कंपन से हिले। पूरे फैलाव में पंख तीस फुट।

"यह बिल्कुल विष्णु के वाहन जैसा दिखेगा," मंदरक ने कहा। "अंधेरे में। दूर से।"

"यह एक चित्रकार द्वारा बनाई मशीन जैसा दिखेगा," सुंदर ने कहा।

"दो सौ फुट से, रात में, दीयों की रोशनी सोने के रंग पर पड़ने से, नहीं दिखेगा," मंदरक ने कहा। रुककर बोला: "कल शाम मैंने एक परीक्षण ढाँचा बनाया। छत से सूर्यास्त के समय उड़ाया। नीचे सड़क पर तीन लोग भागे। एक गिर भी गया।"

सुंदर ने बहुत देर तक रेखाचित्रों को देखा।

वह बिना किसी पदवी और धन के जुलाहा था — बस एक करघा और एक छोटा घर। वह एक महल में रहने वाली राजकुमारी थी।

"हो सकता है वह मुझसे बात भी न करे," उसने कहा।

"हो सकता है," मंदरक ने माना। "लेकिन तुमने कोशिश की होगी। और जो कोशिश करता है वह उससे अलग होता है जो सिर्फ सड़क से देखता है।"

उसने इसे बनाने में छह दिन लगाए।`,
      },
      question: {
        en: 'The Garuda is ready. The palace is right there. What do you do?',
        hi: 'गरुड़ तैयार है। महल बिल्कुल वहाँ है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '💛 "One flight. Just to stand before her once."', hi: '💛 "एक उड़ान। बस एक बार उसके सामने खड़े होने के लिए।"' }, next: 'the_visit' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Three visits. The princess. The palace described in full.
    // Then the king hears. Then the summons to the Rajya Sabha.
    // Single choice — the weight of what is now in motion.
    // IMAGE: the_visit.jpg — the mechanical Garuda perched on
    //        a wide carved sandstone balcony railing at night,
    //        the palace garden below lit with oil lamps, a young
    //        woman in silk standing very still looking at it,
    //        the gold paint of the wings catching lamplight,
    //        the city dark and small far below
    // ──────────────────────────────────────────────────────────
    the_visit: {
      scene: 'palace',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-visit.jpg',
      text: {
        en: `The first night, Sundara wound the key, took the ropes, stepped off the roof, and fell for three seconds before the wings caught.

The spring mechanism beat — a low rhythmic creak, a whistle of wind through the hollow body — and the Garuda glided out over the darkened city. Below him the lamps of ten thousand houses made a second sky. Ahead, the palace rose above everything else, its towers lit by rows of oil lamps on every window ledge, the gilded finials on the rooftops catching the light and throwing it back in gold.

He found the eastern balcony by the garden below it — the long formal garden with its rows of ashoka trees, its rectangular lotus pond reflecting the lamps set into the ground at intervals, the small music pavilion dark and quiet at the far end. The balcony was wide, its carved sandstone railing thick and flat. He angled the tail pedal, brought the nose up, and the Garuda's teak feet came down on the railing with a sound like a large bird landing on stone.

The balcony was empty.

He waited, feeling the Garuda's mechanism wind down to stillness beneath him.

Then she came.

Chitralekha came through the carved lattice doorway wrapped in a shawl of deep blue silk, a small brass lamp in her hand, and she stopped when she saw it. She stood very still and looked.

Standing before her, he was awestruck. He said: "Good evening."

She was quiet for a moment.

"You are not Vishnu," she said.

"No," Sundara said.

"Your wings," she said. "The gold on the leading edge is real gold dust. The rest is yellow ochre. I can tell from here. My father has three painters at court — I have watched them work since I was a child." A pause. "Who built it?"

"My friend. He is a painter."

"He is very good," she said.

They talked for two hours. They talked about the city below — she could see it every day from her balcony but never enter without a procession. They talked about weaving — the patterns, the tension of the thread, what it felt like to watch cloth grow under your hands from nothing. They talked about her garden, which she had planted herself, one tree at a time, over seven years.

She watched until he was out of sight.

He came back the second night. And the third.

On the third night she told him her name.

And then the king heard.

The servants had seen a divine being, vast and gold, landing on the princess's balcony three nights running. The king's court heard. The king's ministers heard. Word spread through the palace quietly, like the wind.

The king summoned the divine visitor to the Rajya Sabha.`,
        hi: `पहली रात, सुंदर ने चाबी दी, रस्सियाँ पकड़ीं, छत से कदम रखा, और तीन सेकंड गिरा जब तक पंख नहीं पकड़े।

कमानी तंत्र चला — एक धीमी लयबद्ध चरचराहट, खोखले शरीर से हवा की सीटी — और गरुड़ अँधेरे शहर के ऊपर से सरकने लगा। नीचे दस हज़ार घरों के दीयों ने एक दूसरा आकाश बनाया था। आगे, महल हर चीज़ से ऊँचा था, उसके बुर्ज हर खिड़की की दहलीज़ पर तेल के दीयों की कतारों से जगमगाते, छत पर सोने की कलशों पर रोशनी पड़कर सोना लौटाती।

उसे बगीचे से पूर्वी बालकनी मिली — अशोक के पेड़ों की कतारों वाला लंबा औपचारिक बगीचा, ज़मीन में लगे दीयों को दर्शाता आयताकार कमल-तालाब, दूर छोर पर अँधेरा और शांत संगीत मंडप। बालकनी चौड़ी थी, तराशी हुई लाल पत्थर की मुंडेर मोटी और सपाट। उसने पूँछ का पेडल दबाया, नाक ऊपर उठाया, और गरुड़ के सागौन के पैर मुंडेर पर उतरे, बिल्कुल वैसे जैसे एक बड़ा पक्षी पत्थर पर उतरता है।

बालकनी खाली थी।

वह रुका, गरुड़ का तंत्र उसके नीचे शांत होता महसूस करता।

फिर वह आई।

चित्रलेखा राजा की एकमात्र पुत्री थी और वह इक्कीस साल से इन कक्षों में रही थी, और उन सालों में उसने कभी अपनी बालकनी पर कबूतर के अलावा कुछ उतरते नहीं देखा था। वह तराशी हुई जाली के दरवाज़े से गहरे नीले रेशम की शाल में लिपटी आई, हाथ में एक छोटा पीतल का दीपक, और जब उसने इसे देखा तो रुक गई। वह बिल्कुल स्थिर खड़ी होकर देखती रही।

उसके सामने खड़े होकर वह अवाक रह गया। उसने कहा: "शुभ संध्या।"

वह एक पल चुप रही।

"तुम विष्णु नहीं हो," उसने कहा।

"नहीं," सुंदर ने कहा।

"तुम्हारे पंख," उसने कहा। "अगले किनारे पर सोना असली है। बाकी पीला गेरू है। मैं यहाँ से बता सकती हूँ। मेरे पिता के दरबार में तीन चित्रकार हैं — मैंने बचपन से उन्हें काम करते देखा है।" रुककर बोली: "इसे किसने बनाया?"

"मेरे मित्र ने। वे चित्रकार हैं।"

"वे बहुत अच्छे हैं," उसने कहा।

वे दो घंटे बात करते रहे। नीचे के शहर के बारे में — वह हर दिन अपनी बालकनी से उसे देख सकती थी लेकिन बिना जुलूस के कभी नहीं जा सकती थी। बुनाई के बारे में — पैटर्न, धागे का तनाव, कुछ नहीं से हाथों के नीचे कपड़ा उगते देखना कैसा लगता है। उसके बगीचे के बारे में, जिसे उसने खुद लगाया था, सात सालों में एक-एक पेड़।

जब वह चला गया — रात की हवा पकड़ते हुए, गरुड़ के रंगे पंख अँधेरे आकाश में चमकते — उसने तब तक देखा जब तक वह दिखना बंद नहीं हो गया।

वह दूसरी रात लौटा। और तीसरी।

तीसरी रात उसने उसे अपना नाम बताया।

और फिर राजा ने सुना।

सेवकों ने एक दिव्य प्राणी देखा था, विशाल और सुनहरा, तीन रातों तक राजकुमारी की बालकनी पर उतरता। राजा के दरबार ने सुना। राजा के मंत्रियों ने सुना। बात महल में फैल गई जैसे पानी पत्थर के फर्श पर फैलता है — चुपचाप, हर दिशा में एक साथ।

राजा ने दिव्य अतिथि को राज्यसभा में बुलाया।`,
      },
      question: {
        en: 'Three nights on the balcony. Her name, told in the lamplight. And now the king has summoned you. What just happened?',
        hi: 'बालकनी पर तीन रातें। दीयों की रोशनी में बताया उसका नाम। और अब राजा ने बुलाया है। यह सब क्या हो गया?',
      },
      choices: [
        { text: { en: '🌙 "Three nights. And then everything changed."', hi: '🌙 "तीन रातें। और फिर सब कुछ बदल गया।"' }, next: 'the_summon' },
      ],
    },

    // ── NODE 2b ────────────────────────────────────────────────
    // The Rajya Sabha — king summons Sundara, asks him to lead
    // the army. The weight of what is now in motion.
    // Single choice — "I never asked for this. But here it is."
    // IMAGE: the_summon.jpg — the mechanical Garuda landed on
    //        the black granite floor of the Rajya Sabha, forty
    //        oil lamps blazing from the ceiling, red sandstone
    //        columns carved with histories on both sides, the
    //        gold throne at the far end with the king seated,
    //        ministers in two rows, the black floor reflecting
    //        the Garuda and the lamps from below, the whole
    //        room doubled in the mirror of the stone
    // ──────────────────────────────────────────────────────────
    the_summon: {
      scene: 'palace',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-summon.jpg',
      text: {
        en: `The Rajya Sabha was the largest room in the palace and the oldest. The floor was black granite from the southern quarries, polished to a mirror finish so deep you could see the ceiling reflected in it as you walked — the gilded teak above becoming a second gilded teak below, so that entering the hall felt like walking into a space twice as tall as it was. The ceiling itself was hung with forty oil lamps on iron chains, each burning twelve wicks, filling the room from above with warm amber light that turned the sandstone columns red and made the gold leaf on the carvings between them seem to breathe.

The columns were red sandstone, eight on each side, each one as thick as three men standing together, carved from floor to ceiling with the histories of the kingdom — battles at river crossings, monsoons that had fed the land for a hundred years, processions of elephants carrying grain to granaries in times of famine. Between the carved panels the walls were plastered white and painted with the emblems of the royal house in vermilion, cobalt, and gold. A child could spend an entire morning reading the walls and still not reach the far end.

At the far end, on a raised marble platform reached by five wide steps, was the throne.

It was not a chair. It was carved from a single block of black granite — the same stone as the floor, as if the throne had grown from the earth of the palace itself. The arms were carved into rearing lions, their manes inlaid with ivory, their eyes set with garnets that caught the lamplight and threw it back in deep red. The back rose six feet above the seat and ended in a carved lotus the size of a cartwheel, entirely gilded, which on certain afternoons when the light came through the high western windows caught the sun and shone like a second lamp. The king's cushion was silk, the colour of old blood, changed every morning.

The king sat on this throne.

Sundara entered on the Garuda.

He had wound the mechanism fully — twice, as he always did — before launching from Mandaraka's roof. The spring drove the wings in their slow, powerful beat as he crossed the palace courtyard at height, descended toward the great entrance doors which the guards had opened and left open, and glided the length of the hall to a landing on the black granite floor.

The forty lamps caught the gold-dust paint on the leading edges of the wings and multiplied it. The black floor reflected the whole image back from below. The ministers standing in their two rows went entirely still.

The king folded his hands.

He looked at the Garuda for a long time. He looked at Sundara. Then he said, very carefully: "We have a difficulty. An enemy king has camped his army at the Shyama River. He threatens the northern border. My generals say we are matched in numbers. But they say also —" the king paused "— that a sign from the gods would break the enemy's will before a single spear is thrown."

He sat on the Garuda in the amber light of the Rajya Sabha, surrounded by ministers in silk uttariyas, before a throne of black granite and garnet and gold. He had come for Chitralekha — and somehow ended up here.

"Will you lead my army at dawn?" the king asked.`,
        hi: `राज्यसभा महल का सबसे बड़ा और सबसे पुराना कक्ष था। फर्श दक्षिणी खदानों का काला ग्रेनाइट था, इतना चमकाया कि चलते हुए छत का प्रतिबिंब दिखता — ऊपर का सुनहरा सागौन नीचे भी सुनहरा सागौन बनकर दिखता, जिससे हॉल में प्रवेश करना उसकी वास्तविक ऊँचाई से दोगुनी ऊँचाई वाली जगह में चलने जैसा लगता। छत पर ही लोहे की ज़ंजीरों पर चालीस तेल के दीपक लटके थे, हर एक में बारह बातियाँ, कमरे को ऊपर से गर्म अंबर रोशनी से भरते जो बलुआ पत्थर के स्तंभों को लाल करती और उनके बीच नक्काशी पर सोने की पत्ती को जीवंत करती।

स्तंभ लाल बलुआ पत्थर के थे — दोनों तरफ आठ-आठ, हर एक तीन आदमियों जितना मोटा, फर्श से छत तक राज्य के इतिहास की नक्काशी से भरे — नदी के पार लड़ाइयाँ, सौ साल तक भूमि को सींचते मानसून, अकाल के समय अन्न भंडारों तक अनाज ले जाते हाथियों के जुलूस। नक्काशी के पैनलों के बीच दीवारें सफेद पलस्तर की थीं और शाही घर के प्रतीक सिंदूरी, नीले और सोने में चित्रित थे। एक बच्चा पूरी सुबह दीवारें पढ़ सकता था और अभी भी दूसरे छोर तक नहीं पहुँचता।

दूसरे छोर पर, पाँच चौड़ी सीढ़ियों से पहुँचे उठे हुए संगमरमर के मंच पर, सिंहासन था।

यह कुर्सी नहीं थी। काले ग्रेनाइट के एक ही टुकड़े से तराशा — फर्श के उसी पत्थर से, मानो सिंहासन महल की धरती से ही उगा हो। बाहें उठे हुए सिंहों की आकृतियाँ थीं, उनकी अयालें हाथीदाँत से जड़ी, आँखों में गहरे लाल प्रकाश फेंकते गार्नेट। पीठ सीट से छह फुट ऊपर उठती थी और एक बैलगाड़ी के पहिये के आकार की तराशी कमल से खत्म होती, पूरी तरह सोने की पत्ती से ढकी, जो कुछ दोपहरों में जब ऊँची पश्चिमी खिड़कियों से सूरज आता तो एक दूसरे दीपक की तरह चमकती। राजा का गद्दा रेशमी था, पुराने खून के रंग का, हर सुबह बदला जाता।

राजा इस सिंहासन पर उस विशेष स्थिरता से बैठे थे जो तीस साल से इस कक्ष में निर्णय लेने वाले व्यक्ति में होती है।

सुंदर गरुड़ पर सवार होकर प्रवेश किया।

उसने मंदरक की छत से उड़ने से पहले तंत्र को पूरी तरह — दो बार — चाबी दी थी। कमानी ने पंखों को उनकी धीमी, शक्तिशाली गति में चलाया जब वह महल के आँगन के ऊपर से ऊँचाई पर गुज़रा, विशाल प्रवेश द्वारों की ओर उतरा जो पहरेदारों ने खोलकर खुले छोड़े थे, और हॉल की लंबाई में सरकते हुए काले ग्रेनाइट फर्श पर उतरा।

चालीस दीपकों ने पंखों के अगले किनारों पर सोने की धूल के रंग को पकड़ा और गुणा किया। काले फर्श ने नीचे से पूरी छवि को वापस दर्शाया। अपनी दो कतारों में खड़े मंत्री पूरी तरह स्थिर हो गए।

राजा ने हाथ जोड़े।

उन्होंने बहुत देर तक गरुड़ को देखा। सुंदर को देखा। फिर बहुत सावधानी से बोले: "हमारे सामने एक कठिनाई है। एक शत्रु राजा ने श्याम नदी पर अपनी सेना डेरा डाली है। वह उत्तरी सीमा को धमकी देता है। मेरे सेनापति कहते हैं हम संख्या में बराबर हैं। लेकिन वे यह भी कहते हैं —" राजा रुके "— कि देवताओं का एक संकेत एक भी भाला फेंके बिना शत्रु का मनोबल तोड़ देगा।"

वह राज्यसभा की अंबर रोशनी में गरुड़ पर बैठा था, रेशमी उत्तरीयों में मंत्रियों से घिरा, काले ग्रेनाइट और गार्नेट और सोने के सिंहासन के सामने। वह चित्रलेखा के लिए आया था — और न जाने कैसे यहाँ पहुँच गया था।

"क्या आप भोर में मेरी सेना का नेतृत्व करेंगे?" राजा ने पूछा।`,
      },
      question: {
        en: 'The king has asked. The whole court is waiting. What do you say?',
        hi: 'राजा ने पूछा है। पूरा दरबार इंतज़ार कर रहा है। तुम क्या कहते हो?',
      },
      choices: [
        { text: { en: '⚔️ "I will ride for my king."', hi: '⚔️ "मैं अपने राजा के लिए सवारी करूँगा।"' }, next: 'sent_to_war' },
      ],
    },

    // ── NODE 3 — THE REAL FORK ─────────────────────────────────
    // Dawn. The battlefield at the Shyama River described in full.
    // Sundara on the cliff above the king's army. The moment.
    // THE only real choice in the story.
    // IMAGE: sent_to_war.jpg — Garuda on a clifftop at pre-dawn,
    //        the vast pale riverbed below stretching between two
    //        armies, king's army behind in lamplight, enemy ahead
    //        in darkness, Sundara inside the Garuda looking out
    //        at the white sand and the sky turning from deep blue
    //        to the first pale orange at the horizon
    // ──────────────────────────────────────────────────────────
    sent_to_war: {
      scene: 'forest_dark',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-war.jpg',
      text: {
        en: `The night before the battle, Sundara did not sleep.

He sat on the roof of the quarters the king had given him — a room in the palace guest wing, with a carved stone window and a cotton mattress and a view of the northern hills — and wound the Garuda's key again and again in the dark, feeling the spring take tension and hold.

He thought about Mandaraka. About six days of building, of gold-dust paint and river-stone eyes. About a painter who built something extraordinary so his friend could stand before a princess.

He thought about the princess. About two hours of real conversation in the lamplight. About the way she had said: *He is very good.*

He thought about his hands on the loom, and whether they knew anything that mattered here.

At the fourth hour before dawn, the king's general came to say it was time.

---

The Shyama River was three hours' ride north. By the time they arrived the sky was the deep blue that comes just before the first light, and the riverbed — dry this season, white sand and scattered grey rock between high clay banks — stretched before them perhaps two hundred yards wide.

The king's army was behind Sundara on a long limestone ridge above the south bank. Ten thousand men. Their armour caught what little light remained from the lamps that had burned all night, now fading to dim orange in the pre-dawn. He could hear them: the shift of weight on stone, the low sound of breath, a horse blowing air once through its nose and then going still again. The general had arranged them in formation before first light — spearmen in rows, cavalry on the flanks, archers on the ridge above.

The cliff where Sundara stood with the Garuda was at the point of the ridge furthest forward, directly above the south bank. From here the riverbed spread below him, wide and pale and still. The white sand was perfectly still in the early morning. A heron — a real one — walked slowly across the sand near the far bank, head down, completely unbothered by the ten thousand people on either side of it.

Across the river, the enemy army was a dark mass in the grey pre-dawn light on the north bank. They had lit no lamps. From the ridge Sundara could see them the way you see clouds on the horizon — a shape rather than a detail, moving slowly as they settled into formation. They were quiet.

The sun was not yet up. The sky at the eastern horizon had begun to change — deep blue giving way to a band of pale green, and above that the first suggestion of orange. In perhaps twenty minutes it would be full dawn.

Sundara checked the leather strap across his chest. He checked the left rope, the right rope, the tail pedal. He found the brass key on its cord around his neck and wound the mechanism one final time, feeling the spring reach its full tension and hold.

The Garuda's gold-dust wings caught the first pale pre-dawn light and gave it back brighter than they received it.

From below, the king's army looked up at the cliff.

Across the river, a sound had begun from the enemy lines. Not a war cry. Something slower — a rhythmic beating of spear-shafts against shields, low and steady, building. The sound crossed the white sand, rose up the clay bank, climbed the ridge, and entered Sundara's chest.

He looked out at the riverbed. The heron was gone.

The white sand between two armies waited, perfectly empty, perfectly still.

He looked down at his hands on the ropes.

A weaver's hands. Callused from years at the loom.

Below him, the general looked up at the cliff and raised his hand, waiting for the signal.

Sundara took one breath.`,
        hi: `युद्ध से पहले की रात, सुंदर को नींद नहीं आई।

वह राजा ने जो कक्ष दिए थे उनकी छत पर बैठा — महल के अतिथि कक्ष में एक कमरा, तराशी हुई पत्थर की खिड़की और सूती गद्दे और उत्तरी पहाड़ियों का दृश्य — और अँधेरे में बार-बार गरुड़ की चाबी देता रहा, महसूस करता कि कमानी तनाव लेती और थामती है।

उसने मंदरक के बारे में सोचा। छह दिन के निर्माण के बारे में, सोने की धूल के रंग और नदी के पत्थर की आँखों के बारे में। एक चित्रकार जिसने कुछ असाधारण बनाया ताकि उसका मित्र एक राजकुमारी के सामने खड़ा हो सके।

उसने राजकुमारी के बारे में सोचा। दीयों की रोशनी में दो घंटे की असली बातचीत के बारे में। जिस तरह उसने कहा था: *वे बहुत अच्छे हैं।*

उसने करघे पर अपने हाथों के बारे में सोचा, और सोचा कि क्या वे यहाँ कुछ काम आएंगे।

भोर से चार घंटे पहले, राजा के सेनापति ने आकर कहा समय हो गया है।

---

श्याम नदी तीन घंटे की सवारी पर उत्तर में थी। जब वे पहुँचे तो आकाश वह गहरा नीला था जो पहली रोशनी से ठीक पहले होता है, और नदी का पाट — इस मौसम में सूखा, ऊँचे मिट्टी के किनारों के बीच सफेद रेत और बिखरी हुई धूसर चट्टानें — उनके सामने शायद दो सौ गज़ चौड़ा फैला था।

राजा की सेना दक्षिणी तट के ऊपर एक लंबी चूना पत्थर की पहाड़ी पर सुंदर के पीछे थी। दस हज़ार आदमी। उनके कवच ने रात भर जले उन दीयों की जो थोड़ी रोशनी बची थी उसे पकड़ा, अब भोर से पहले मद्धम नारंगी में घुलते। वह उन्हें सुन सकता था: पत्थर पर भार का बदलाव, साँसों की धीमी आवाज़, एक घोड़े का एक बार नाक से हवा निकालना और फिर स्थिर हो जाना। सेनापति ने पहली रोशनी से पहले उन्हें व्यूह में लगाया था — भाले वाले कतारों में, घुड़सवार किनारों पर, तीरंदाज़ ऊपर पहाड़ी पर।

जहाँ सुंदर गरुड़ के साथ खड़ा था वह चट्टान पहाड़ी के सबसे आगे के बिंदु पर थी, सीधे दक्षिणी तट के ऊपर। यहाँ से नदी का पाट नीचे फैला था, चौड़ा और पीला और स्थिर। सफेद रेत भोर की शुरुआत में बिल्कुल स्थिर थी। एक बगुला — असली — दूर तट के पास रेत पर धीरे-धीरे चल रहा था, सिर नीचे, दोनों तरफ के दस हज़ार लोगों से पूरी तरह बेपरवाह।

नदी के पार, उत्तरी तट पर, भोर से पहले की धूसर रोशनी में शत्रु सेना एक काली आकृति थी। उन्होंने कोई दीपक नहीं जलाया था। पहाड़ी से सुंदर उन्हें वैसे देख सकता था जैसे क्षितिज पर बादल देखते हैं — विस्तार की जगह आकार, व्यूह में बैठते हुए धीरे-धीरे हिलता। वे चुप थे।

सूरज अभी नहीं उगा था। पूर्वी क्षितिज पर आकाश बदलने लगा था — गहरा नीला हल्के हरे की एक पट्टी को रास्ता दे रहा था, और उसके ऊपर नारंगी का पहला संकेत। शायद बीस मिनट में पूरी भोर होगी।

सुंदर ने सीने पर चमड़े का पट्टा जाँचा। बाईं रस्सी, दाईं रस्सी, पूँछ का पेडल जाँचा। अपने गले के धागे पर पीतल की चाबी ढूँढी और तंत्र को एक आखिरी बार चाबी दी, महसूस किया कि कमानी अपने पूरे तनाव पर पहुँची और थम गई।

गरुड़ के सोने की धूल वाले पंखों ने भोर से पहले की पहली हल्की रोशनी पकड़ी और उससे ज़्यादा वापस दी।

नीचे से, राजा की सेना ने चट्टान की ओर देखा।

नदी के पार, शत्रु पंक्तियों से एक आवाज़ शुरू हुई थी। युद्धनाद नहीं। कुछ धीमा — ढालों पर भाले की मूठों की लयबद्ध थाप, धीमी और स्थिर, बढ़ती हुई। आवाज़ सफेद रेत पार की, मिट्टी का किनारा चढ़ी, पहाड़ी पर आई, और सुंदर की छाती में घुसी।

उसने नदी के पाट की ओर देखा। बगुला जा चुका था।

दो सेनाओं के बीच सफेद रेत प्रतीक्षा करती थी, बिल्कुल खाली, बिल्कुल स्थिर।

उसने रस्सियों पर अपने हाथों को नीचे देखा।

जुलाहे के हाथ। करघे से हर उँगली की जड़ पर पड़ी गाँठें। वह हर गाँठ जानता था। उसने हर एक बनाई थी, साल दर साल, धागा-धागा, कपड़ा-कपड़ा।

नीचे, सेनापति ने चट्टान की ओर देखा और संकेत का इंतज़ार करते हुए हाथ उठाया।

सुंदर ने एक साँस ली।`,
      },
      question: {
        en: 'The sun is rising. The army is waiting. What do you do?',
        hi: 'सूरज उग रहा है। सेना इंतज़ार कर रही है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '⚔️ "I am already here. I charge."', hi: '⚔️ "मैं पहले से यहाँ हूँ। मैं आगे बढ़ता हूँ।"' }, next: 'the_battle' },
        { text: { en: '🕊️ "I cannot do this. I am not what they think I am. I turn back."',                        hi: '🕊️ "मैं यह नहीं कर सकता। मैं वह नहीं हूँ जो वे सोचते हैं। मैं वापस जाता हूँ।"' },              next: 'ending_honest' },
      ],
    },

    // ── NODE 4a — PATH A ───────────────────────────────────────
    // He charges. What the battle looks and sounds like.
    // The army breaks. He returns. He tells her the truth.
    // She already knew.
    // IMAGE: the_battle.jpg — the Garuda in full flight over the
    //        white riverbed at dawn, the first orange light hitting
    //        the gold-dust wings so they blaze, seen from behind
    //        and below, the two armies on either bank tiny in the
    //        distance, the Garuda vast against the orange sky
    // ──────────────────────────────────────────────────────────
    the_battle: {
      scene: 'forest_dawn',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-battle.jpg',
      isAlternate: true,
      text: {
        en: `Sundara stepped off the cliff.

Three seconds of falling. The white sand riverbed rushing up. Then the wings caught, the mechanism beat — that low rhythmic creak, that hollow whistle — and the Garuda levelled and flew.

The sun cleared the horizon.

It had been waiting behind the eastern hills for hours and it came all at once — a full, sudden orange light that swept across the riverbed from east to west in the space of a breath and hit the Garuda's gold-dust wings from directly behind.

The wings blazed.

From the enemy side of the river, two hundred yards away across white sand — a vast winged creature, entirely gold, launched from the top of the cliff in the same instant the sun rose behind it, flying directly at them at the full speed of a glide, its wings beating in a slow powerful rhythm, a sound crossing the sand that was unlike any animal and unlike any machine, growing louder, growing larger.

The first row stepped back.

The second row, seeing the first step back, stepped back too.

The rhythmic beating of spear-shafts on shields that had been building for ten minutes stopped.

Sundara pulled the right rope, banking over the north bank at thirty feet, close enough that the shadow of the wings swept across the front rows. He felt the wind of his own passing. He pulled the left rope, curved back out over the river, the mechanism still beating, the wings still blazing in the full morning light.

Below him, on the sand, something was happening. The formation that had stood steady in the grey pre-dawn was moving. The front rows pushing back into the rows behind them, the sides beginning to open.

He made one more pass, low and fast over the riverbed.

When he climbed back to height and banked to look, the north bank was empty.

The army had withdrawn. They had gone, and the empty north bank and the silence that followed said everything about why.

Sundara glided back to the cliff. He landed badly — he was shaking — the teak feet hit the stone and the Garuda lurched and he had to grip the straps hard to stay inside. He sat there for a long moment, breathing.

Below him the king's army roared — a sound that rose from the ridge and crossed the river and kept going.

He had done it.

Not a god. A simple man on a wooden bird and he had held steady in the wake of the war.

---

That evening, he went to the palace. Not by air this time. Through the main gate on foot, brought by the general, dressed in a clean dhoti that Mandaraka had sent. He was taken to the Rajya Sabha, where the king thanked him in front of the full court. He was given gifts — silk, coin, land in the northern district.

Afterward, alone in a corridor lit by a single wall lamp, Chitralekha found him.

"You should know something," he said. "Before anything else. I am a weaver. My name is Sundara and I live in the weavers' quarter. My friend Mandaraka built the Garuda from a cart and a sail and six days of work. I am not Vishnu's vehicle. I am not divine. I am not —"

"I know," she said.

He stopped.

"I knew on the second night," she said. "The way you talked about thread tension. About the feeling of cloth growing under your hands. No divine being talks about cloth that way. Only someone who has made it." A pause. "I also recognised the gold-dust paint. Mandaraka used the same mixture on my father's eastern hall three years ago. I remembered the colour."

Sundara was quiet for a moment.

"You let me keep coming," he said.

"You kept coming," she said. "That was yours. Not the Garuda. Not the disguise. You."`,
        hi: `सुंदर ने चट्टान से कदम रखा।

तीन सेकंड की गिरावट। सफेद रेत का पाट तेज़ी से नज़दीक आता। फिर पंख पकड़े, तंत्र चला — वह धीमी लयबद्ध चरचराहट, वह खोखली सीटी — और गरुड़ सीधा होकर उड़ा।

सूरज ने ठीक उसी क्षण क्षितिज पार किया।

वह घंटों से पूर्वी पहाड़ियों के पीछे प्रतीक्षा में था और एक साथ आया — पूरी, अचानक नारंगी रोशनी जो एक साँस में पूरब से पश्चिम नदी के पाट पर फैली और गरुड़ के सोने की धूल वाले पंखों से सीधे पीछे से टकराई।

पंख दहक उठे।

नदी के उस पार से, दो सौ गज़ सफेद रेत के पार, उन्होंने जो देखा वह यह था: एक विशाल पंखों वाला प्राणी, पूरी तरह सुनहरा, ठीक उसी पल चट्टान के ऊपर से उछला जब उसके पीछे सूरज उगा, एक सरकने की पूरी गति से सीधे उनकी ओर उड़ता, पंख धीमी शक्तिशाली लय में फड़फड़ाते, रेत के पार एक आवाज़ जो किसी जानवर जैसी नहीं और किसी मशीन जैसी नहीं, ज़ोर होती, बड़ी होती।

पहली पंक्ति पीछे हटी।

दूसरी पंक्ति, पहली को पीछे हटते देखकर, वह भी पीछे हट गई।

दस मिनट से बनती ढालों पर भाले की मूठों की लयबद्ध थाप रुक गई। एक साथ। जो चुप्पी उसने छोड़ी वह विशाल थी।

सुंदर ने दाईं रस्सी खींची, तीस फुट पर उत्तरी तट के ऊपर बाईं ओर मुड़ा, इतना करीब कि पंखों की छाया अगली पंक्तियों पर से गुज़री। उसने अपने खुद के गुज़रने की हवा महसूस की। बाईं रस्सी खींची, नदी के ऊपर वापस मुड़ा, तंत्र अभी भी चलता, पंख पूरी सुबह की रोशनी में अभी भी दहकते।

नीचे, रेत पर, कुछ हो रहा था। जो व्यूह भोर से पहले की धूसर रोशनी में स्थिर खड़ा था वह हिल रहा था। अगली पंक्तियाँ उनके पीछे की पंक्तियों में धकेलती, किनारे खुलने लगते।

उसने एक बार और गुज़रा। नदी के पाट पर नीचे से तेज़, गरुड़ की छाया नीचे सफेद रेत पर दौड़ती।

जब वह ऊँचाई पर वापस चढ़ा और देखने के लिए मुड़ा, उत्तरी तट खाली था।

सेना हट गई थी। वे चले गए थे, और खाली उत्तरी तट और उसके बाद की चुप्पी ने सब कुछ कह दिया कि क्यों।

सुंदर चट्टान पर वापस सरका। वह बुरी तरह उतरा — वह काँप रहा था — सागौन के पैर पत्थर से टकराए और गरुड़ लड़खड़ाया और उसे पट्टों को कसकर पकड़ना पड़ा। वह एक लंबे पल वहाँ बैठा रहा, साँस लेता।

नीचे राजा की सेना गरजी — एक आवाज़ जो पहाड़ी से उठी, नदी पार की, और आगे जाती रही।

उसने कर दिया था।

देवता नहीं। एक साधारण आदमी एक लकड़ी के पक्षी पर — और युद्ध के बीच वह डटा रहा।

---

उस शाम, वह महल गया। इस बार हवा से नहीं। पैदल मुख्य द्वार से, सेनापति साथ लाया, मंदरक ने जो साफ धोती भेजी थी उसमें। उसे राज्यसभा में ले जाया गया, जहाँ राजा ने पूरे दरबार के सामने उसे धन्यवाद दिया। उसे उपहार मिले — रेशम, सिक्के, उत्तरी ज़िले में ज़मीन।

बाद में, एक दीवारी दीपक से रोशन एक गलियारे में अकेले, चित्रलेखा उसे मिली।

"तुम्हें कुछ जानना चाहिए," उसने कहा। "बाकी सब से पहले। मैं जुलाहा हूँ। मेरा नाम सुंदर है और मैं जुलाहों के मोहल्ले में रहता हूँ। मेरे मित्र मंदरक ने गरुड़ एक गाड़ी और एक पाल और छह दिन के काम से बनाया। मैं विष्णु का वाहन नहीं हूँ। मैं दिव्य नहीं हूँ। मैं —"

"मुझे पता है," उसने कहा।

वह रुक गया।

"दूसरी रात को पता चल गया था," उसने कहा। "जिस तरह तुमने धागे के तनाव के बारे में बात की। हाथों के नीचे कपड़ा उगते महसूस करने के बारे में। कोई दिव्य प्राणी कपड़े के बारे में ऐसे नहीं बोलता। सिर्फ वही बोलता है जिसने इसे बनाया हो।" रुककर बोली: "मैंने सोने की धूल का रंग भी पहचाना। मंदरक ने तीन साल पहले मेरे पिता के पूर्वी हॉल में यही मिश्रण इस्तेमाल किया था। रंग याद रहा।"

सुंदर एक पल चुप रहा।

"तुमने मुझे आते रहने दिया," उसने कहा।

"तुम आते रहे," उसने कहा। "यह तुम्हारा था। गरुड़ नहीं। वेश नहीं। तुम।"`,
      },
      question: {
        en: 'She already knew. From the second night. What does that tell you?',
        hi: 'उसे पहले से पता था। दूसरी रात से। यह तुम्हें क्या बताता है?',
      },
      choices: [
        { text: { en: '🪡 "The Garuda was not what crossed the river. I was."',            hi: '🪡 "नदी गरुड़ ने नहीं पार की। मैंने पार की।"' },                         next: 'ending_warrior' },
        { text: { en: '💛 "She saw me. Not the disguise. Me. That was worth everything."', hi: '💛 "उसने मुझे देखा। वेश को नहीं। मुझे। यह सब कुछ के लायक था।"' }, next: 'ending_warrior' },
      ],
    },

    // ── NODE 4b — PATH B ───────────────────────────────────────
    // He turns back. Lands outside the city. Removes the disguise.
    // Walks in as himself. Is brought before the king.
    // The princess speaks for him. The lesson is different.
    // IMAGE: ending_honest.jpg — a young man in plain clothes
    //        walking through a city gate at dawn alone, the
    //        Garuda visible behind him on the ground, its gold
    //        wings folded, the gate guards watching in confusion
    // ──────────────────────────────────────────────────────────
    ending_honest: {
      scene: 'village',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-honest.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `Sundara did not step off the cliff.

He sat on the Garuda at the clifftop while the sky changed from deep blue to pale green to the first edge of orange. He sat while the rhythmic beating from the enemy's shields rose across the riverbed and the general below kept his hand raised and the ten thousand men behind him waited.

He thought: I am a weaver. My friend built a machine.

He climbed down from the Garuda. He walked to the general and said, quietly, so only the general could hear: "I cannot do what you are asking. I am not what the king believes me to be. I am a weaver from the city. The Garuda is a machine built from teak and bamboo. I came to the palace because I fell in love. That is the whole truth."

The general looked at him for a long moment.

"Go," he said quietly. "Go before the men see this. I will tell the king."

Sundara walked back down the ridge and out of the battle, the sun rising behind him over the hills.

He was brought before the king that afternoon in the Rajya Sabha — not on the Garuda this time, but on foot, in his own clothes, a weaver standing on black granite in front of forty lamps and a throne of garnet and gold.

He told the king everything. The Garuda. Mandaraka. The three nights on the balcony. All of it.

The court was silent.

Then Chitralekha, who had been told to remain in her chambers and had not remained there, walked into the Rajya Sabha.

She stood beside Sundara. She did not look at her father. She looked at the ministers.

"He is the only person in three years who has spoken to me as if I were a person and not a position," she said. "I knew what the Garuda was on the second night. I let him keep coming because of what he said, not what he arrived on."

The king was quiet for a long time.

He looked at his daughter. He looked at the weaver. He looked at the machine standing in the corner of his great hall, its painted wings folded, the gold-dust catching the lamp light and giving it back quietly.

"You turned back," the king said at last. "At the cliff. With my army behind you and the enemy across the river. You turned back."

"Yes," Sundara said.

"Why?"

"Because the lie had come far enough," Sundara said. "A man should know where his truth ends and someone else's story begins."

The king said nothing for a moment. Then he nodded once.

The Panchatantra teaches:
"Borrowed courage carries you far. But there is a cliff at the edge of every borrowed thing — a moment when you must decide whether to step off it as someone else, or climb down as yourself.
The one who climbs down is not the coward. He is the one who knew the difference."`,
        hi: `सुंदर ने चट्टान से कदम नहीं रखा।

वह चट्टान के ऊपर गरुड़ पर बैठा रहा जबकि आकाश गहरे नीले से हल्के हरे में और फिर नारंगी की पहली धार में बदला। वह बैठा रहा जबकि दुश्मन की ढालों पर लयबद्ध थाप नदी के पाट से ऊपर आती रही और नीचे सेनापति का हाथ उठा रहा और उसके पीछे दस हज़ार आदमी इंतज़ार करते रहे।

उसने सोचा: मैं जुलाहा हूँ। मेरे मित्र ने एक यंत्र बनाया।

वह गरुड़ से उतरा। सेनापति के पास गया और धीरे से, इतनी धीरे कि सिर्फ सेनापति सुन सके, कहा: "मैं वह नहीं कर सकता जो तुम माँग रहे हो। मैं वह नहीं हूँ जो राजा मुझे समझते हैं। मैं शहर का जुलाहा हूँ। गरुड़ सागौन और बाँस से बना एक यंत्र है। मैं महल इसलिए आया क्योंकि प्यार हो गया था। यह पूरा सच है।"

सेनापति ने उसे एक लंबे पल देखा।

फिर गरुड़ को देखा।

फिर पीछे सेना को देखा।

"जाओ," उसने धीरे कहा। "पहले जाओ कि सेना यह देखे। मैं राजा को बताऊँगा।"

सुंदर पहाड़ी से नीचे उतरा और युद्ध से बाहर चला, पहाड़ियों के पीछे से उगता सूरज उसके पीछे।

उसे उस दोपहर राज्यसभा में राजा के सामने लाया गया — इस बार गरुड़ पर नहीं, पैदल, अपने कपड़ों में, एक जुलाहा चालीस दीपकों और गार्नेट और सोने के सिंहासन के सामने काले ग्रेनाइट पर खड़ा।

उसने राजा को सब बताया। गरुड़। मंदरक। बालकनी पर तीन रातें। सब कुछ।

दरबार चुप था।

फिर चित्रलेखा, जिसे अपने कक्षों में रहने को कहा गया था और वहाँ नहीं रही थी, राज्यसभा में आई।

वह सुंदर के बगल में खड़ी हो गई। उसने अपने पिता को नहीं देखा। मंत्रियों को देखा।

"तीन सालों में यह एकमात्र व्यक्ति है जिसने मुझसे ऐसे बात की जैसे मैं एक पद नहीं बल्कि एक इंसान हूँ," उसने कहा। "दूसरी रात को मुझे पता था गरुड़ क्या है। मैंने उसे आते रहने दिया क्योंकि उसने क्या कहा, न कि क्या लेकर आया।"

राजा काफी देर चुप रहे।

उन्होंने अपनी पुत्री को देखा। जुलाहे को देखा। उस यंत्र को देखा जो उनके महान हॉल के कोने में खड़ा था, रंगे पंख मुड़े, सोने की धूल दीयों की रोशनी पकड़कर चुपचाप वापस देती।

"तुम वापस आए," राजा ने आखिर में कहा। "चट्टान पर। पीछे सेना के साथ और नदी के पार दुश्मन। तुम वापस आए।"

"हाँ," सुंदर ने कहा।

"क्यों?"

"क्योंकि झूठ काफी दूर आ चुका था," सुंदर ने कहा। "एक इंसान को पता होना चाहिए कि उसका सच कहाँ खत्म होता है और किसी और की कहानी कहाँ शुरू।"

राजा एक पल चुप रहे। फिर उन्होंने एक बार सिर हिलाया।

पञ्चतन्त्र सिखाता है:
"उधार का साहस तुम्हें दूर ले जाता है। लेकिन हर उधारी चीज़ के किनारे पर एक चट्टान होती है — एक पल जब तुम्हें तय करना होता है कि किसी और के रूप में कदम रखो, या खुद बनकर नीचे उतरो।
जो नीचे उतरता है वह कायर नहीं है। वह वह है जो फर्क जानता था।"`,
      },
      lesson: { en: "Borrowed courage carries you far. But a man should know where his truth ends and someone else's story begins.", hi: 'उधार का साहस तुम्हें दूर ले जाता है। लेकिन एक इंसान को पता होना चाहिए कि उसका सच कहाँ खत्म होता है और किसी और की कहानी कहाँ शुरू।' },
      lessonIcon: '🕊️',
    },

    // ── NODE 5 — PATH A · ENDING ───────────────────────────────
    // Not triumphant. Warm. The weaver's hands. The truth told.
    // IMAGE: ending_warrior.jpg — Sundara and Chitralekha
    //        standing together on the palace balcony at dusk,
    //        the Garuda behind them with its wings folded,
    //        the city below lit with evening lamps, his plain
    //        weaver's dhoti beside her silk, both looking out
    //        at the same city from the same height
    // ──────────────────────────────────────────────────────────
    ending_warrior: {
      scene: 'palace',
      image: '/images/the-weaver-and-princess/the-weaver-and-princess-ending.jpg',
      isEnding: true,
      text: {
        en: `Mandaraka heard the whole story three days later, sitting cross-legged on his studio floor surrounded by paint pots and half-finished canvases.

He was quiet for a while.

Then he said: "She knew from the second night."

"Yes," Sundara said.

Mandaraka picked up a brush, looked at it, put it down again. "I spent six days on that gold-dust finish."

"She said you were very good."

A long pause.

"Well," said Mandaraka. "Good."

---

The Garuda stands now in a corner of the palace's eastern hall — the same hall where Mandaraka painted the ceiling fresco three years ago. It has been repainted once, the gold brightened, the red at the wing-tips deepened. A brass plate has been fixed below it with the name of its maker.

Sundara still weaves. He has a larger loom now, in a room at the eastern edge of the palace grounds, and he makes silk for the court — patterns he designs himself, based on things he sees from the windows. On certain afternoons Chitralekha sits in the room and reads while he works.

He still carries the brass key on a cord around his neck.

She asked him once why he kept it.

"Because," he said, "I want to remember what I wound it for. Not the disguise. Not the army. For the first visit. For wanting to be seen."

She looked at the key.

"You were seen," she said.

The Panchatantra teaches:
"Courage is not the absence of fear. It is looking down at your own hands — the hands you were born with, that know what they know and nothing more — and deciding they are enough for what the moment asks.
The Garuda was made of teak and bamboo and six days of a friend's love."`,
        hi: `मंदरक ने तीन दिन बाद पूरी कहानी सुनी, अपने स्टूडियो के फर्श पर रंग के बर्तनों और अधूरी कैनवास के बीच पालथी मारकर बैठे।

वह थोड़ी देर चुप रहा।

फिर बोला: "उसे दूसरी रात से पता था।"

"हाँ," सुंदर ने कहा।

मंदरक ने एक ब्रश उठाया, देखा, फिर रख दिया। "मैंने उस सोने की धूल की फिनिश पर छह दिन लगाए थे।"

"उसने कहा तुम बहुत अच्छे हो।"

एक लंबी चुप्पी।

"अच्छा," मंदरक ने कहा। "ठीक है।"

---

गरुड़ अब महल के पूर्वी हॉल के एक कोने में खड़ा है — वही हॉल जहाँ मंदरक ने तीन साल पहले छत की भित्तिचित्र बनाई थी। इसे एक बार फिर से रंगा गया है, सोना चमकाया, पंख की नोक पर लाल गहरा किया। नीचे एक पीतल की पट्टी लगी है जिस पर बनाने वाले का नाम है।

सुंदर अभी भी बुनता है। अब उसके पास एक बड़ा करघा है, महल के परिसर के पूर्वी किनारे पर एक कमरे में, और वह दरबार के लिए रेशम बनाता है — खिड़कियों से जो देखता है उस पर आधारित अपने डिज़ाइन के पैटर्न। कुछ दोपहरों में चित्रलेखा कमरे में बैठकर पढ़ती है जब वह काम करता है।

वह अभी भी पीतल की चाबी गले में धागे पर पहनता है।

उसने एक बार उससे पूछा कि वह इसे क्यों रखता है।

"क्योंकि," उसने कहा, "मैं याद रखना चाहता हूँ कि मैंने इसे किसलिए चाबी दी थी। वेश के लिए नहीं। सेना के लिए नहीं। पहली मुलाकात के लिए। देखे जाने की चाह के लिए।"

उसने चाबी को देखा।

"तुम देखे गए," उसने कहा।

पञ्चतन्त्र सिखाता है:
"साहस डर का न होना नहीं है। यह अपने हाथों को नीचे देखना है — वे हाथ जो तुम लेकर पैदा हुए, जो जो जानते हैं जानते हैं और उससे ज़्यादा नहीं — और तय करना है कि वे उस पल के लिए काफी हैं।
गरुड़ सागौन और बाँस और एक मित्र के प्यार के छह दिनों से बना था। उस नदी के पार जो उड़ा वह बिल्कुल अलग चीज़ थी।"`,
      },
      lesson: { en: "The Garuda was teak and bamboo and a friend's love. What flew across the river was courage — the kind that knows exactly what it is and goes anyway.", hi: 'गरुड़ सागौन और बाँस और एक मित्र का प्यार था। नदी के पार जो उड़ा वह साहस था — वह जो ठीक-ठीक जानता है कि वह क्या है और फिर भी जाता है।' },
      lessonIcon: '🪡',
    },

  },
};

export default weaverAndPrincess;
