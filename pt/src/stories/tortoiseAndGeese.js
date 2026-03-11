const tortoiseAndGeese = {
  id: 'tortoise-and-geese',
  title:       { en: 'The Tortoise and the Geese',   hi: 'कछुआ और हंस' },
  description: { en: 'A tortoise is rescued by two geese friends who carry him to safety. There is just one rule — do not open your mouth no matter what. How hard can silence be?',
                 hi: 'एक कछुए को दो हंस मित्र बचाते हैं जो उसे सुरक्षा तक ले जाते हैं। बस एक नियम है — चाहे कुछ भी हो मुँह मत खोलो। चुप रहना कितना मुश्किल हो सकता है?' },
  theme:       { en: 'The hardest battle is with your own tongue', hi: 'सबसे कठिन लड़ाई अपनी ज़ुबान से होती है' },
  age: '6+',
  duration:    { en: '8–12 min', hi: '८–१२ मिनट' },
  addedOn: '2026-03-09',
  featured: false,
  emoji: '🐢',
  color: '#34d399',
  book:        { en: 'Panchatantra — Book II', hi: 'पञ्चतन्त्र — द्वितीय भाग' },
  progressSteps: ['start', 'in_the_air', 'the_taunt', 'safe_landing', 'ending_wise'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Lake is drying. Geese offer rescue. One rule: stay silent.
    // Tortoise agrees — confidently, almost carelessly.
    // Single choice — he thinks it will be easy. Forward only.
    // IMAGE: start.jpg — tortoise at the edge of a shrinking
    //        muddy lake, two geese standing before him holding
    //        a stick between their beaks, the sky behind them
    //        open and vast, the tortoise looking up with trust
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'river_bank',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-start.jpg',
      text: {
        en: `Kambugriva the tortoise had lived in the same lake his entire life.

He knew every stone, every reed, every shadow that fell across the water at sunset. He knew which corner stayed cool in summer and where the best mud was for sleeping. This lake was not just his home — it was everything he knew.

But the lake was dying.

For three summers, the rains had failed. The water had retreated from the banks, then from the shallows, then from places it had never retreated from before. Now the lake was a muddy bowl, shrinking a little more each morning. The fish were gone. The reeds had turned to dust.

Kambugriva sat at the cracked edge and looked at what remained.

His two oldest friends — the geese Sankata and Vikata — landed beside him. They had been watching from above for days.

"We are leaving for the great lake in the hills," Sankata said. "The water there is deep and cold and has never failed. Come with us."

"I cannot fly," said Kambugriva.

"No," said Vikata. "But you can hold."

They showed him a smooth straight stick. Each goose would hold one end in his beak. Kambugriva would bite the middle. They would carry him through the sky.

"There is one rule," Sankata said, and his voice was serious in a way that made Kambugriva pay attention. "Do not open your mouth. Not for any reason. Not to speak, not to cry out, not to answer anyone. Whatever you hear below — let it pass. The moment you open your mouth, you fall."

Kambugriva looked at the stick. Then at his dying lake. Then at his friends.

"I understand," he said. "I have kept quiet through harder things than a crowd of strangers."

He bit down on the stick.

The geese spread their wings.`,
        hi: `कम्बुग्रीव कछुआ अपने पूरे जीवन एक ही झील में रहा था।

वह हर पत्थर, हर नरकट, हर उस छाया को जानता था जो सूर्यास्त के समय पानी पर पड़ती थी। वह जानता था कि गर्मियों में कौन सा कोना ठंडा रहता है और सोने के लिए सबसे अच्छी मिट्टी कहाँ है। यह झील केवल उसका घर नहीं थी — यह सब कुछ था जो वह जानता था।

लेकिन झील मर रही थी।

तीन गर्मियों से बारिश नहीं हुई थी। पानी किनारों से हटा, फिर उथले हिस्सों से, फिर उन जगहों से जहाँ से वह पहले कभी नहीं हटा था। अब झील एक मिट्टी का कटोरा था, हर सुबह थोड़ा और सिकुड़ता। मछलियाँ जा चुकी थीं। नरकट धूल बन गए थे।

कम्बुग्रीव फटे किनारे पर बैठकर जो बचा था उसे देखता रहा।

उसके दो सबसे पुराने मित्र — हंस संकट और विकट — उसके पास उतरे। वे कई दिनों से ऊपर से देख रहे थे।

"हम पहाड़ियों में महान झील की ओर जा रहे हैं," संकट ने कहा। "वहाँ का पानी गहरा और ठंडा है और कभी नहीं सूखा। हमारे साथ चलो।"

"मैं उड़ नहीं सकता," कम्बुग्रीव ने कहा।

"नहीं," विकट ने कहा। "लेकिन तुम पकड़ सकते हो।"

उन्होंने उसे एक चिकनी सीधी लकड़ी दिखाई। हर हंस एक सिरा अपनी चोंच में पकड़ेगा। कम्बुग्रीव बीच को काटेगा। वे उसे आकाश में ले जाएंगे।

"एक नियम है," संकट ने कहा, और उसकी आवाज़ इतनी गंभीर थी कि कम्बुग्रीव ने ध्यान दिया। "मुँह मत खोलो। किसी भी कारण से नहीं। न बोलने के लिए, न चिल्लाने के लिए, न किसी को जवाब देने के लिए। नीचे से जो भी सुनो — जाने दो। जिस पल तुम मुँह खोलोगे, तुम गिरोगे।"

कम्बुग्रीव ने लकड़ी को देखा। फिर अपनी मरती झील को। फिर अपने मित्रों को।

"मैं समझता हूँ," उसने कहा। "मैंने अजनबियों की भीड़ से भी कठिन चीज़ों में चुप रहा हूँ।"

उसने लकड़ी काट ली।

हंसों ने पंख फैलाए।`,
      },
      question: {
        en: 'The geese warned you clearly. You agreed confidently. But somewhere deep down — do you actually know how hard this will be?',
        hi: 'हंसों ने साफ़ चेतावनी दी। तुमने आत्मविश्वास से हाँ कहा। लेकिन कहीं गहरे में — क्या तुम सच में जानते हो यह कितना मुश्किल होगा?',
      },
      choices: [
        { text: { en: '😌 "I understand completely. How hard can staying quiet possibly be?"', hi: '😌 "मैं पूरी तरह समझता हूँ। चुप रहना आखिर कितना मुश्किल हो सकता है?"' }, next: 'in_the_air' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // They are in the air. It is extraordinary. Then the first
    // people below spot them and start pointing, laughing.
    // Just amusement — not cruel yet. But the tortoise wants
    // to respond. He holds. It costs him something.
    // Single choice — strain, not confidence. Forward only.
    // IMAGE: in_the_air.jpg — tortoise biting a stick held at
    //        each end by two geese high in the sky, below them
    //        tiny village people pointing upward in amazement,
    //        the tortoise's eyes wide, jaw tight on the stick
    // ──────────────────────────────────────────────────────────
    in_the_air: {
      scene: 'forest_dawn',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-in-the-air.jpg',
      text: {
        en: `The ground fell away.

Kambugriva had never seen the world from above. For a moment — just a moment — every fear dissolved. The dying lake below looked small and far. The hills ahead glowed green and full of water. The wind moved through his shell in a way he had never felt.

He wanted to say something. He bit down harder instead.

They crossed over the first village.

Someone looked up. Then someone else. Then a small child pointed.

"Look! Look up there! What is THAT?"

"It's a tortoise! A tortoise carried by geese! Have you ever seen such a thing?"

Laughter. Pointing. The whole village craning their necks.

Kambugriva heard every word. His jaw tightened on the stick. They were just surprised, he told himself. It was strange, he knew. Let them look. Let them laugh. The lake in the hills was close now — he could feel the air growing cooler, greener.

He kept his mouth shut.

The village passed beneath them and fell behind.

He had done it. That was the hard part, surely.

Surely.`,
        hi: `ज़मीन नीचे चली गई।

कम्बुग्रीव ने कभी दुनिया को ऊपर से नहीं देखा था। एक पल के लिए — बस एक पल — हर डर घुल गया। नीचे की मरती झील छोटी और दूर लगी। आगे की पहाड़ियाँ हरी और पानी से भरी चमक रही थीं। हवा उसके कवच से ऐसे गुज़री जैसा उसने कभी महसूस नहीं किया था।

वह कुछ कहना चाहता था। इसके बजाय उसने और ज़ोर से काटा।

वे पहले गाँव के ऊपर से गुज़रे।

किसी ने ऊपर देखा। फिर किसी और ने। फिर एक छोटे बच्चे ने उँगली उठाई।

"देखो! ऊपर देखो! यह क्या है?"

"यह कछुआ है! हंसों द्वारा ले जाया जाता कछुआ! क्या तुमने ऐसा कभी देखा है?"

हँसी। उँगलियाँ उठाना। पूरे गाँव की गर्दनें ऊपर उठी हुईं।

कम्बुग्रीव ने हर शब्द सुना। लकड़ी पर उसके जबड़े का दबाव बढ़ गया। वे बस हैरान थे, उसने खुद को बताया। यह अजीब था, वह जानता था। उन्हें देखने दो। हँसने दो। पहाड़ियों की झील अब करीब थी — वह हवा को ठंडा, हरा होता महसूस कर सकता था।

उसने मुँह बंद रखा।

गाँव उनके नीचे से गुज़रा और पीछे रह गया।

उसने कर लिया था। यही मुश्किल हिस्सा था, ज़रूर।

ज़रूर।`,
      },
      question: {
        en: 'They laughed. You held on. Your jaw aches from biting so hard. But you are still in the air. What do you tell yourself right now?',
        hi: 'वे हँसे। तुम थामे रहे। बहुत ज़ोर से काटने से जबड़ा दर्द करता है। लेकिन तुम अभी भी हवा में हो। अभी खुद से क्या कहते हो?',
      },
      choices: [
        { text: { en: '😬 "They\'re laughing. Fine. Let them laugh. I am NOT saying anything."', hi: '😬 "वे हँस रहे हैं। ठीक है। हँसने दो। मैं कुछ नहीं कहूँगा।"' }, next: 'the_taunt' },
      ],
    },

    // ── NODE 3 — THE REAL FORK ─────────────────────────────────
    // Second village. A sharper voice. Not just laughter —
    // something that touches his identity. His right to be here.
    // This is the only real choice in the story.
    // IMAGE: the_taunt.jpg — tortoise gripping the stick high
    //        in the sky, below a crowd with one figure pointing
    //        upward with a sharp expression, the tortoise's eyes
    //        open and burning, every muscle in his jaw visible
    // ──────────────────────────────────────────────────────────
    the_taunt: {
      scene: 'forest_dark',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-taunt.jpg',
      text: {
        en: `The second village was larger.

The people had heard something was coming — word travels faster than geese — and a crowd had gathered in the open field, looking up.

At first it was the same. Laughter. Pointing. The ordinary astonishment of people who had never seen a flying tortoise.

Then one voice rose above the rest. Loud, clear, carrying perfectly up through the cold air:

"Look at that ridiculous creature — clinging to a stick, dangling in the sky like it has no dignity. Whoever heard of a tortoise thinking it deserves to fly? Some animals belong on the ground. That one should stay in the mud where it was born and stop pretending to be something it isn't."

The crowd laughed.

Kambugriva heard every word.

His eyes went wide. His blood went hot.

It was not the laughter that got to him. He could bear laughter. It was the word *deserves.* As if the sky had owners. As if flight was a privilege that had to be earned by the right kind of creature. As if he — Kambugriva, who had survived three summers of drought, who had watched his whole world dry up and still chosen to go on — had no right to want more than the mud he was born in.

The hills were right there. He could see the glint of the great lake, green and full, perhaps two minutes of flying away.

Two minutes of silence.

His jaw trembled.`,
        hi: `दूसरा गाँव बड़ा था।

लोगों ने सुना था कि कुछ आ रहा है — खबर हंसों से तेज़ उड़ती है — और एक भीड़ खुले मैदान में इकट्ठी हो गई थी, ऊपर देखते हुए।

पहले तो वही था। हँसी। उँगलियाँ उठाना। उन लोगों की सामान्य हैरानी जिन्होंने कभी उड़ता कछुआ नहीं देखा था।

फिर एक आवाज़ बाकी सबसे ऊपर उठी। ज़ोर से, साफ़, ठंडी हवा में ऊपर तक पूरी तरह पहुँचती:

"उस बेतुके प्राणी को देखो — एक लकड़ी से चिपका, आकाश में लटका, जैसे इसकी कोई शान न हो। कछुए ने कब सोचा कि वह उड़ने का हकदार है? कुछ जानवर ज़मीन पर ही होते हैं। उसे उसी कीचड़ में रहना चाहिए जहाँ वह पैदा हुआ और जो वह नहीं है उसका नाटक बंद करना चाहिए।"

भीड़ हँसी।

कम्बुग्रीव ने हर शब्द सुना।

उसकी आँखें फैल गईं। उसका खून गर्म हो गया।

हँसी ने उसे नहीं छुआ था। वह हँसी सह सकता था। जिस शब्द ने छुआ वह था *हकदार।* जैसे आकाश के मालिक हों। जैसे उड़ान एक विशेषाधिकार हो जो सही तरह के प्राणी को अर्जित करना पड़े। जैसे वह — कम्बुग्रीव, जिसने सूखे की तीन गर्मियाँ झेली थीं, जिसने अपनी पूरी दुनिया को सूखते देखा था और फिर भी आगे जाना चुना था — उस कीचड़ से ज़्यादा कुछ चाहने का कोई अधिकार नहीं था जहाँ वह पैदा हुआ था।

पहाड़ियाँ बिल्कुल वहीं थीं। वह उस महान झील की चमक देख सकता था, हरी और भरी, शायद दो मिनट की उड़ान दूर।

दो मिनट की चुप्पी।

उसके जबड़े में कंपन हुई।`,
      },
      question: {
        en: 'Someone just told you that you don\'t belong in the sky. That you should stay in the mud where you were born. The lake is two minutes away. What do you do?',
        hi: 'किसी ने अभी कहा कि तुम आकाश में नहीं हो। कि तुम्हें उसी कीचड़ में रहना चाहिए जहाँ तुम पैदा हुए। झील दो मिनट दूर है। तुम क्या करते हो?',
      },
      choices: [
        { text: { en: '🐢 "It doesn\'t matter what they say. The lake is close. Ten more minutes of silence is worth a lifetime."', hi: '🐢 "कोई फर्क नहीं पड़ता वे क्या कहते हैं। झील करीब है। दस मिनट की और चुप्पी पूरी ज़िंदगी के लायक है।"' }, next: 'safe_landing' },
        { text: { en: '😤 "No. I will NOT be told where I belong. Not by anyone."',                                              hi: '😤 "नहीं। मुझे कोई नहीं बताएगा कि मैं कहाँ का हूँ। कोई भी नहीं।"' },                                     next: 'opens_mouth' },
      ],
    },

    // ── NODE 4a — PATH A ───────────────────────────────────────
    // He holds. They land. The lake is everything.
    // But he sits there thinking about what was said.
    // Second fork — what does he take from this?
    // IMAGE: safe_landing.jpg — tortoise standing at the edge
    //        of a beautiful full green lake in the hills, two
    //        geese landing beside him, the tortoise's expression
    //        quiet and complicated — relief mixed with something
    //        unsettled, the lake vast and beautiful before him
    // ──────────────────────────────────────────────────────────
    safe_landing: {
      scene: 'river_bank',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-safe-landing.jpg',
      text: {
        en: `Kambugriva held on.

Two minutes. The longest two minutes of his life.

The crowd's voices faded below. The hills rose around them. And then — the lake. Enormous, cold, deep green, ringed by tall trees and fed by mountain streams. More water than he had ever seen. More water than his dying lake had held in its best years.

The geese descended slowly.

His feet touched the ground. His jaw unclenched. The stick dropped.

He stood at the edge of the new lake and looked at it for a long time without speaking.

Sankata and Vikata landed beside him quietly. They did not say *we told you so.* They did not say anything. They just stood with him at the water's edge.

After a while, Kambugriva walked in. The cold water rose around his shell. It was perfect.

He floated there until the sun began to set.

Then he climbed out and sat on a rock, still thinking.

About the voice below. About the word *deserves.* About the two minutes he had almost thrown away — not because he was weak, but because someone's words had felt more important in that moment than his own survival.

"They have already forgotten what they said," he told himself quietly.

"They moved on the moment we flew past. They are eating their dinner right now, not thinking of me at all."

He looked at the lake.

"But I almost fell."`,
        hi: `कम्बुग्रीव थामे रहा।

दो मिनट। अपनी ज़िंदगी के सबसे लंबे दो मिनट।

भीड़ की आवाज़ें नीचे फीकी पड़ गईं। पहाड़ियाँ उनके चारों ओर उठीं। और फिर — झील। विशाल, ठंडी, गहरी हरी, ऊँचे पेड़ों से घिरी और पहाड़ी नालों से भरती। जितना पानी उसने कभी नहीं देखा था। अपने अच्छे सालों में भी उसकी मरती झील ने जितना रखा था उससे ज़्यादा।

हंस धीरे-धीरे उतरे।

उसके पैर ज़मीन पर लगे। जबड़ा खुला। लकड़ी गिर गई।

वह नई झील के किनारे खड़ा हुआ और बिना बोले बहुत देर तक उसे देखता रहा।

संकट और विकट चुपचाप उसके पास उतरे। उन्होंने *हमने कहा था* नहीं कहा। उन्होंने कुछ नहीं कहा। वे बस पानी के किनारे उसके साथ खड़े रहे।

थोड़ी देर बाद, कम्बुग्रीव अंदर चला गया। ठंडा पानी उसके कवच के चारों ओर उठा। एकदम सही था।

वह तब तक तैरता रहा जब तक सूरज ढलने नहीं लगा।

फिर वह बाहर निकला और एक पत्थर पर बैठ गया, अभी भी सोचता हुआ।

नीचे की आवाज़ के बारे में। *हकदार* शब्द के बारे में। उन दो मिनटों के बारे में जो उसने लगभग बर्बाद कर दिए थे — इसलिए नहीं कि वह कमज़ोर था, बल्कि इसलिए कि किसी के शब्द उस पल उसके अपने जीवन से ज़्यादा महत्वपूर्ण लगे थे।

"उन्होंने वह भूल दिया जो उन्होंने कहा," उसने चुपचाप खुद से कहा।

"हम उड़कर निकले उसी पल वे आगे बढ़ गए। वे अभी खाना खा रहे हैं, मेरे बारे में बिल्कुल नहीं सोच रहे।"

उसने झील को देखा।

"लेकिन मैं लगभग गिर गया था।"`,
      },
      question: {
        en: 'You made it. You are sitting at the edge of the most beautiful lake you have ever seen. What did those two minutes teach you?',
        hi: 'तुम पहुँच गए। तुम उस सबसे सुंदर झील के किनारे बैठे हो जो तुमने कभी देखी। उन दो मिनटों ने तुम्हें क्या सिखाया?',
      },
      choices: [
        { text: { en: '🌊 "The people who say you don\'t belong somewhere are never the ones who have to live with what you lose by listening to them."', hi: '🌊 "जो लोग कहते हैं कि तुम कहीं के नहीं हो, वे कभी वे नहीं होते जिन्हें उन्हें सुनने से होने वाले नुकसान के साथ जीना पड़े।"' }, next: 'ending_wise' },
      ],
    },

    // ── NODE 4b — PATH B ───────────────────────────────────────
    // He opens his mouth. He falls.
    // He survives — shell saves him — lands in a field.
    // The geese circle back. Nobody says anything.
    // IMAGE: opens_mouth.jpg — tortoise falling through the air,
    //        mouth open, stick tumbling away, two geese above
    //        wheeling in alarm, the ground rushing up below,
    //        the hills and the lake visible in the far distance
    // ──────────────────────────────────────────────────────────
    opens_mouth: {
      scene: 'forest_dark',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-opens-mouth.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `"I belong wherever I CHOOSE to—"

The stick was gone.

For one strange suspended moment, Kambugriva hung in the air. He could see the geese above him, beaks empty, wings already folding into a dive. He could see the crowd below, faces tilting up, mouths open. He could see the hills ahead. The lake, green and full, exactly where it had always been. Two minutes away.

Then he fell.

His shell struck the earth of a ploughed field at the edge of the village. A tortoise shell is strong — he was winded, shaken, but unhurt. He lay still for a moment, looking up at the sky.

Sankata and Vikata circled down and landed beside him. They said nothing.

There was nothing to say.

The people from the village came running. They stood around him in a circle, looking down at this extraordinary creature who had fallen from the sky. Some were still laughing. Some had gone quiet.

The man whose voice had cut through the air — the one who had said *stay in the mud where you were born* — pushed to the front of the crowd, looked down at Kambugriva, and said:

"Well. Guess it was right after all."

Then he walked away.

He had already forgotten what he said. He would not think of it again.

Kambugriva lay in the field for a long time.

The hills were right there. The lake was right there. Two minutes of silence away.

He thought about what those words had cost him.

He thought about who had paid.

The Panchatantra teaches:
"The one who says you do not belong somewhere will sleep well tonight. They will not think of you again. But you will live with what their words cost you — if you let them in.
The hardest battle is not with your enemies. It is with your own tongue, in the moment when being right feels more important than arriving."`,
        hi: `"मैं वहाँ हूँ जहाँ मैं चुनूँ—"

लकड़ी जा चुकी थी।

एक अजीब रुके हुए पल के लिए, कम्बुग्रीव हवा में लटका रहा। वह ऊपर हंसों को देख सकता था, खाली चोंचें, पंख पहले से डाइव में मुड़ रहे थे। वह नीचे भीड़ को देख सकता था, चेहरे ऊपर झुके, मुँह खुले। वह आगे पहाड़ियाँ देख सकता था। झील, हरी और भरी, ठीक वहाँ जहाँ हमेशा थी। दो मिनट दूर।

फिर वह गिरा।

उसका कवच गाँव के किनारे जोते हुए खेत की मिट्टी से टकराया। कछुए का कवच मज़बूत होता है — वह हाँफ रहा था, हिला हुआ था, लेकिन चोट नहीं लगी थी। वह एक पल स्थिर लेटा रहा, आकाश की ओर देखता रहा।

संकट और विकट नीचे मंडराते हुए उसके पास उतरे। उन्होंने कुछ नहीं कहा।

कहने को कुछ नहीं था।

गाँव के लोग दौड़ते हुए आए। वे उसके चारों ओर एक घेरे में खड़े हो गए, इस असाधारण प्राणी को नीचे देखते हुए जो आकाश से गिरा था। कुछ अभी भी हँस रहे थे। कुछ चुप हो गए थे।

वह आदमी जिसकी आवाज़ हवा में कट गई थी — जिसने कहा था *उसी कीचड़ में रहो जहाँ पैदा हुए* — भीड़ के आगे आया, कम्बुग्रीव को नीचे देखा, और बोला:

"अच्छा। लगता है आखिरकार सही ही था।"

फिर चला गया।

उसने वह भूल दिया जो उसने कहा था। वह इसके बारे में दोबारा नहीं सोचेगा।

कम्बुग्रीव बहुत देर तक खेत में लेटा रहा।

पहाड़ियाँ बिल्कुल वहीं थीं। झील बिल्कुल वहीं थी। दो मिनट की चुप्पी दूर।

उसने सोचा कि उन शब्दों ने उसे क्या चुकाया था।

उसने सोचा कि किसने कीमत दी।

पञ्चतन्त्र सिखाता है:
"जो कहता है कि तुम कहीं के नहीं हो वह आज रात अच्छे से सोएगा। वह तुम्हारे बारे में दोबारा नहीं सोचेगा। लेकिन तुम वह जीओगे जो उसके शब्दों ने तुम्हें चुकाया — अगर तुमने उन्हें अंदर आने दिया।
सबसे कठिन लड़ाई तुम्हारे दुश्मनों से नहीं है। यह उस पल में तुम्हारी अपनी ज़ुबान से है जब सही होना पहुँचने से ज़्यादा ज़रूरी लगे।"`,
      },
      lesson: { en: "The people whose words make you fall will sleep well tonight. They have already forgotten. But you will live with what it cost you.", hi: 'जिनके शब्दों ने तुम्हें गिराया वे आज रात अच्छे से सोएंगे। वे पहले ही भूल चुके हैं। लेकिन तुम वह जीओगे जो इसने तुम्हें चुकाया।' },
      lessonIcon: '🍃',
    },

    // ── NODE 5 — PATH A · ENDING ───────────────────────────────
    // The lesson of the lake. Not triumphant — complicated.
    // He made it. But he knows how close it was.
    // IMAGE: ending_wise.jpg — tortoise floating alone in the
    //        vast beautiful hill lake at sunset, two geese
    //        resting on a nearby rock, the tortoise's expression
    //        peaceful but thoughtful, the light golden on the water
    // ──────────────────────────────────────────────────────────
    ending_wise: {
      scene: 'river_bank',
      image: '/images/the-tortoise-and-geese/the-tortoise-and-geese-ending-wise.jpg',
      isEnding: true,
      text: {
        en: `Kambugriva lived in the hill lake for many years.

It was everything his old lake had never been — deep, cold, full even in the worst summers, fed by snowmelt that never ran dry.

On warm evenings he floated on his back and looked at the sky. He thought sometimes of the voice below. The man who said he did not deserve to fly.

He thought: that man woke up the next morning and went about his life. He probably told the story at dinner for a night or two — *I saw a flying tortoise, can you imagine* — and then moved on. He never thought of Kambugriva again.

And Kambugriva was here.

Floating. Alive. In a lake that had never failed.

Not because he was stronger than the voice. Not because he had won an argument. But because for two minutes — the two hardest minutes of his life — he had understood something worth more than being right:

*That the people who tell you where you belong are never the ones who have to live with your choices. Only you are.*

The Panchatantra teaches:
"Guard your tongue more carefully than your purse. Your purse, if lost, can be refilled. But words once spoken and lives once fallen cannot be recalled.
The wisest answer to a taunt is not a better taunt. It is arrival."`,
        hi: `कम्बुग्रीव पहाड़ी झील में कई साल रहा।

यह वह सब कुछ था जो उसकी पुरानी झील कभी नहीं थी — गहरी, ठंडी, सबसे बुरी गर्मियों में भी भरी, बर्फ के पिघलने से भरती जो कभी नहीं सूखती।

गर्म शामों को वह पीठ के बल तैरता और आकाश देखता। वह कभी-कभी नीचे की आवाज़ के बारे में सोचता। वह आदमी जिसने कहा था कि वह उड़ने का हकदार नहीं।

उसने सोचा: वह आदमी अगली सुबह उठा और अपनी ज़िंदगी में लग गया। उसने शायद एक-दो रात खाने पर यह कहानी सुनाई — *मैंने एक उड़ता कछुआ देखा, सोच सकते हो* — और फिर आगे बढ़ गया। उसने कम्बुग्रीव के बारे में दोबारा नहीं सोचा।

और कम्बुग्रीव यहाँ था।

तैरता हुआ। जीवित। एक ऐसी झील में जो कभी नहीं सूखी।

इसलिए नहीं कि वह उस आवाज़ से ज़्यादा मज़बूत था। इसलिए नहीं कि उसने कोई बहस जीती। बल्कि इसलिए कि दो मिनट के लिए — अपनी ज़िंदगी के सबसे मुश्किल दो मिनट — उसने सही होने से ज़्यादा कीमती कुछ समझा था:

*कि जो लोग तुम्हें बताते हैं कि तुम कहाँ के हो वे कभी वे नहीं होते जिन्हें तुम्हारे चुनावों के साथ जीना पड़े। सिर्फ तुम होते हो।*

पञ्चतन्त्र सिखाता है:
"अपनी ज़ुबान की रखवाली अपनी थैली से ज़्यादा सावधानी से करो। थैली, खो जाए तो भरी जा सकती है। लेकिन कहे गए शब्द और एक बार गिरी ज़िंदगी वापस नहीं बुलाई जा सकती।
किसी ताने का सबसे बुद्धिमान जवाब बेहतर ताना नहीं है। यह पहुँचना है।"`,
      },
      lesson: { en: "The wisest answer to a taunt is not a better taunt. It is arrival. Guard your tongue more carefully than your purse.", hi: 'किसी ताने का सबसे बुद्धिमान जवाब बेहतर ताना नहीं है। यह पहुँचना है। अपनी ज़ुबान की रखवाली अपनी थैली से ज़्यादा सावधानी से करो।' },
      lessonIcon: '🌊',
    },

  },
};

export default tortoiseAndGeese;
