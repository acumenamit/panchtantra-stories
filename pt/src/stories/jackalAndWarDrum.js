const jackalAndWarDrum = {
  id: 'jackal-and-war-drum',
  title:       { en: 'The Jackal and the Boom',      hi: 'सियार और वह धूम' },
  description: { en: 'A starving jackal wanders into an abandoned battlefield and hears a sound unlike anything in the world. His mind builds a monster. But is the monster real — or is it made entirely of fear?',
                 hi: 'एक भूखा सियार एक सुनसान युद्धभूमि में भटकता है और एक ऐसी आवाज़ सुनता है जैसी दुनिया में कोई नहीं। उसका मन एक राक्षस बनाता है। लेकिन क्या राक्षस सच में है — या वह पूरी तरह डर से बना है?' },
  theme:       { en: 'Fear makes monsters out of nothing', hi: 'डर कुछ नहीं से राक्षस बना देता है' },
  age: '6+',
  duration:    { en: '8–12 min', hi: '८–१२ मिनट' },
  addedOn: '2026-03-07',
  featured: false,
  emoji: '🐾',
  color: '#fb923c',
  book:        { en: 'Panchatantra — Book I', hi: 'पञ्चतन्त्र — प्रथम भाग' },
  progressSteps: ['start', 'the_mind_invents', 'the_approach', 'sees_the_drum', 'ending_proud'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Starving jackal enters abandoned battlefield at dusk.
    // Hears the boom for the first time. Legs want to run.
    // Single choice — hunger overriding fear. Forward only.
    // IMAGE: start.jpg — thin jackal at edge of battlefield at
    //        dusk, ears pinned back, one paw raised mid-step,
    //        broken weapons and abandoned carts in the distance
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'forest_evening',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-start.jpg',
      text: {
        en: `Gomaya the jackal had not eaten in three days.

He had searched the forest edge, the river bank, the village outskirts — nothing. His ribs showed beneath his fur. His legs were thin. Even his hunger felt tired.

As the sun bled red across the sky, he found himself at the edge of an old battlefield. A great war had been fought here long ago. Now it was silent — abandoned carts, broken weapons half-buried in the earth, tattered banners hanging limp in the evening air.

But there was food here. He could smell it. Old bones, dried meat still clinging to armour. Enough to last him a week.

He took one step onto the battlefield.

BOOM.

The sound hit him like a wall. Deep, resonant, enormous — unlike anything he had ever heard in his life. It seemed to come from everywhere and nowhere at once. It rolled across the field and shook the air in his chest.

Gomaya's legs moved before his mind did. He spun around, ready to run.

Then he stopped.

His stomach growled. Three days. Three empty days.

He stood at the edge of the field, one paw raised, the sound still ringing in his ears.`,
        hi: `गोमाय सियार ने तीन दिनों से कुछ नहीं खाया था।

उसने जंगल के किनारे, नदी के तट, गाँव के बाहर — सब खोजा। कुछ नहीं। उसकी पसलियाँ बालों के नीचे दिख रही थीं। पैर पतले थे। यहाँ तक कि उसकी भूख भी थकी हुई लगती थी।

जब सूरज आकाश में लाल होकर डूब रहा था, वह एक पुरानी युद्धभूमि के किनारे पहुँचा। यहाँ बहुत पहले एक बड़ी लड़ाई हुई थी। अब यह सुनसान था — छोड़ी हुई गाड़ियाँ, ज़मीन में आधे दबे टूटे हथियार, शाम की हवा में लटकती मैली पताकाएँ।

लेकिन यहाँ खाना था। वह सूँघ सकता था। पुरानी हड्डियाँ, कवच से चिपका सूखा माँस। एक हफ्ते के लिए काफी।

उसने युद्धभूमि पर एक कदम रखा।

धूम।

आवाज़ ने उसे दीवार की तरह मारा। गहरी, गूँजती, विशाल — जैसी उसने अपने जीवन में कभी नहीं सुनी थी। वह एक साथ हर जगह से और कहीं से नहीं आती लगती थी। यह मैदान पर फैली और उसके सीने में हवा को हिला दिया।

गोमाय के पैर उसके मन से पहले हिल गए। वह मुड़ा, भागने को तैयार।

फिर रुक गया।

उसका पेट गुर्राया। तीन दिन। तीन खाली दिन।

वह मैदान के किनारे खड़ा था, एक पंजा उठा हुआ, कानों में अभी भी वह आवाज़ गूँज रही थी।`,
      },
      question: {
        en: 'Your legs want to run. Your stomach says stay. What do you hold onto right now?',
        hi: 'पैर भागना चाहते हैं। पेट कहता है रुको। अभी तुम किसे थामे रहते हो?',
      },
      choices: [
        { text: { en: '😤 "I\'ve been hungry for three days. Whatever that sound is — it\'s not going to stop me from eating tonight."', hi: '😤 "तीन दिन से भूखा हूँ। वह आवाज़ चाहे जो हो — आज रात मुझे खाने से नहीं रोकेगी।"' }, next: 'the_mind_invents' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Jackal creeps forward. Boom comes again and again.
    // His mind builds the monster — bigger with every sound.
    // Single choice — fear named, not surrendered to. Forward only.
    // IMAGE: the_mind_invents.jpg — jackal crouched low in the
    //        dark battlefield, shadow of an enormous imagined
    //        creature looming above him from his own mind,
    //        eyes wide, teeth clenched
    // ──────────────────────────────────────────────────────────
    the_mind_invents: {
      scene: 'forest_dark',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-mind-invents.jpg',
      text: {
        en: `Gomaya crept forward. Low to the ground, belly almost brushing the earth.

BOOM.

He froze. His heart hammered. Then — silence. He crept forward again.

BOOM.

Louder this time. Or maybe the same, but now he was closer. He couldn't tell. He couldn't think. His mind had started doing something he couldn't stop — it was building something. Something enormous. Something with a hide thick as a castle wall and a voice that shook mountains.

Every time the sound came, his mind made the thing a little bigger.

First it was an animal. Then it was a demon. Then it was something that had no name in any language — something ancient and terrible that fed on jackals and darkness and the smell of fear.

"It will hear me breathing," he thought. "It can probably hear my heart."

He pressed himself flat against the earth behind an overturned cart.

BOOM.

The ground vibrated beneath his paws.

He stayed there a long time. The sound kept coming. Regular. Patient. Utterly indifferent to him.

Slowly, despite everything, a small strange thought arrived.

Demons aren't patient. Demons don't boom at regular intervals. Whatever this was — it didn't seem to be hunting him.

It didn't seem to be doing anything at all.`,
        hi: `गोमाय आगे रेंगा। ज़मीन के करीब, पेट लगभग मिट्टी छूता।

धूम।

वह जम गया। दिल ज़ोर से धड़का। फिर — चुप्पी। वह फिर आगे रेंगा।

धूम।

इस बार ज़ोर से। या शायद वही, लेकिन अब वह करीब था। वह बता नहीं सकता था। सोच नहीं सकता था। उसके मन ने कुछ ऐसा शुरू कर दिया था जिसे वह रोक नहीं सकता था — वह कुछ बना रहा था। कुछ विशाल। कुछ जिसकी खाल महल की दीवार जितनी मोटी हो और जिसकी आवाज़ पहाड़ हिला दे।

जब भी वह आवाज़ आती, उसके मन ने उस चीज़ को थोड़ा और बड़ा बना दिया।

पहले वह एक जानवर था। फिर वह एक दानव था। फिर वह कुछ ऐसा था जिसका कोई नाम किसी भाषा में नहीं था — कुछ पुराना और भयानक जो सियारों और अँधेरे और डर की गंध पर पलता था।

"यह मेरी साँस सुन लेगा," उसने सोचा। "शायद मेरा दिल भी सुन सकता है।"

वह एक उलटी गाड़ी के पीछे ज़मीन से चिपक गया।

धूम।

उसके पंजों के नीचे ज़मीन काँपी।

वह वहाँ बहुत देर रहा। वह आवाज़ आती रही। नियमित। धैर्य से। उसकी पूरी तरह परवाह किए बिना।

धीरे-धीरे, सब कुछ के बावजूद, एक छोटा अजीब विचार आया।

दानव धैर्यवान नहीं होते। दानव नियमित अंतराल पर नहीं बोलते। यह जो भी था — यह उसका शिकार करता नहीं लग रहा था।

यह कुछ भी करता नहीं लग रहा था।`,
      },
      question: {
        en: 'Every boom makes the monster in your head bigger. But it hasn\'t moved. It hasn\'t come for you. What do you tell yourself right now?',
        hi: 'हर धूम तुम्हारे दिमाग के राक्षस को बड़ा करती है। लेकिन वह हिला नहीं। तुम्हारे पास नहीं आया। अभी तुम खुद से क्या कहते हो?',
      },
      choices: [
        { text: { en: '😰 "Every time it booms, it gets bigger in my head. I don\'t know what\'s in there. But I\'m still not running."', hi: '😰 "हर बार जब यह बोलती है, मेरे दिमाग में बड़ी होती जाती है। नहीं जानता क्या है वहाँ। लेकिन मैं अभी भी भाग नहीं रहा।"' }, next: 'the_approach' },
      ],
    },

    // ── NODE 3 — THE REAL FORK ─────────────────────────────────
    // Jackal is close now. One more step would reveal everything.
    // Everything in him says run. This is the only real choice.
    // IMAGE: the_approach.jpg — jackal crouched at corner of a
    //        crumbling wall, one paw reaching around the edge,
    //        the source of the sound just out of sight
    // ──────────────────────────────────────────────────────────
    the_approach: {
      scene: 'forest_dark',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-approach.jpg',
      text: {
        en: `Gomaya had been creeping for what felt like hours.

He was close now. Very close. The booming was so loud here it seemed to press against his ears from the inside. His fur stood completely on end. Every instinct he had was screaming at him — stop, go back, do not round this corner.

He pressed himself against the crumbling remains of a stone wall.

On the other side of this wall — whatever it was.

He could feel the air move with each boom. He could feel the vibration travel up his paws through the stone. Whatever was on the other side, it was right there. One step. One look.

All he had to do was look.

His legs were shaking. His breath came in short, shallow bursts.

"If it is a demon," he thought, "looking will not make it more of a demon. It is what it is whether I look or not."

He thought about three days without food.

He thought about the thing his mind had been building all evening — enormous, ancient, nameless.

He put one paw forward.`,
        hi: `गोमाय घंटों से रेंगता आ रहा था ऐसा लग रहा था।

वह अब करीब था। बहुत करीब। यहाँ वह गूँज इतनी ज़ोर से थी कि अंदर से कानों पर दबाती लगती थी। उसके बाल पूरी तरह खड़े थे। उसकी हर वृत्ति उसे चिल्ला रही थी — रुको, वापस जाओ, इस कोने को मत मोड़ो।

वह एक पत्थर की टूटती दीवार के खिलाफ चिपक गया।

इस दीवार के दूसरी तरफ — जो भी था।

वह हर धूम के साथ हवा महसूस कर सकता था। वह पत्थर के ज़रिए पंजों में कंपन महसूस कर सकता था। दूसरी तरफ जो भी था, वह बिल्कुल वहीं था। एक कदम। एक नज़र।

बस देखना था।

उसके पैर काँप रहे थे। साँस छोटी, उथली।

"अगर यह दानव है," उसने सोचा, "तो देखने से यह ज़्यादा दानव नहीं बनेगा। यह जो है वह है चाहे मैं देखूँ या नहीं।"

उसने तीन दिन बिना खाने के सोचे।

उसने उस चीज़ के बारे में सोचा जो उसके मन ने पूरी शाम बनाई थी — विशाल, पुरानी, बेनाम।

उसने एक पंजा आगे रखा।`,
      },
      question: {
        en: 'One step. One look. That is all it takes to know. Do you look — or do you go back into the dark?',
        hi: 'एक कदम। एक नज़र। बस इतना काफी है जानने के लिए। क्या तुम देखते हो — या वापस अँधेरे में जाते हो?',
      },
      choices: [
        { text: { en: '🦊 "I\'m looking. Whatever it is — I need to know."',      hi: '🦊 "मैं देखूँगा। जो भी हो — मुझे जानना है।"' },          next: 'sees_the_drum' },
        { text: { en: '😨 "I can\'t. I\'m going back. It\'s not worth it."',      hi: '😨 "नहीं कर सकता। वापस जाता हूँ। इसकी कोई ज़रूरत नहीं।"' }, next: 'turns_back' },
      ],
    },

    // ── NODE 4a — PATH A ───────────────────────────────────────
    // He looks. It's a war drum. A branch in the wind hits it.
    // Relief mixed with embarrassment mixed with joy.
    // Second real fork — tell everyone or keep it secret.
    // IMAGE: sees_the_drum.jpg — jackal standing before a large
    //        war drum, a tree branch swinging against it,
    //        jackal's face between disbelief and laughter
    // ──────────────────────────────────────────────────────────
    sees_the_drum: {
      scene: 'forest_dark',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-sees-drum.jpg',
      isAlternate: true,
      text: {
        en: `Gomaya stepped around the wall.

He saw it.

A drum. A war drum — enormous, stretched with thick hide, mounted on a wooden frame. Left behind when the armies fled, long ago. A branch from a nearby tree had grown and bent over the years until it hung directly over it. In the evening breeze, the branch swung. When it swung far enough — it struck.

BOOM.

Gomaya stood completely still.

The branch swung again.

BOOM.

The monster. The demon. The ancient nameless thing that fed on jackals and darkness and the smell of fear.

A branch. A drum. Wind.

He looked at it for a long time. Around it — bones, dried meat, old grain scattered from torn supply sacks. More food than he had seen in weeks. The drum stood in the middle of it all, patient and enormous and utterly harmless.

A sound that had nearly unmade him was just the world being the world.

He sat down slowly.

Then, despite everything — he started to laugh. A real laugh, helpless and full, the kind that comes when fear releases all at once.

BOOM, said the drum.

"Yes," said Gomaya. "Yes, I know."`,
        hi: `गोमाय दीवार के आसपास आया।

उसने देखा।

एक नगाड़ा। एक युद्ध का नगाड़ा — विशाल, मोटी खाल से ढका, लकड़ी के ढाँचे पर लगा। जब सेनाएँ भागीं तब पीछे छूट गया था, बहुत पहले। पास के एक पेड़ की शाखा सालों में बढ़ी और झुकी थी जब तक सीधे उसके ऊपर नहीं आ गई। शाम की हवा में, शाखा झूलती। जब काफी दूर झूलती — टकराती।

धूम।

गोमाय बिल्कुल स्थिर खड़ा रहा।

शाखा फिर झूली।

धूम।

राक्षस। दानव। वह पुरानी बेनाम चीज़ जो सियारों और अँधेरे और डर की गंध पर पलती थी।

एक शाखा। एक नगाड़ा। हवा।

उसने बहुत देर तक उसे देखा। उसके आसपास — हड्डियाँ, सूखा माँस, टूटे थैलों से बिखरा पुराना अनाज। हफ्तों में देखे से ज़्यादा खाना। नगाड़ा सबके बीच खड़ा था, धैर्यशील और विशाल और पूरी तरह हानिरहित।

एक आवाज़ जो लगभग उसे तोड़ देती वह बस दुनिया का दुनिया होना था।

वह धीरे-धीरे बैठ गया।

फिर, सब कुछ के बावजूद — वह हँसने लगा। एक असली हँसी, बेबस और भरपूर, जो तब आती है जब डर एक साथ छूट जाता है।

धूम, नगाड़े ने कहा।

"हाँ," गोमाय ने कहा। "हाँ, मुझे पता है।"`,
      },
      question: {
        en: 'You found food. You found the truth. And you found it because you looked. Now — what do you do with what you know?',
        hi: 'तुम्हें खाना मिला। सच मिला। और मिला क्योंकि तुमने देखा। अब — जो तुम जानते हो उसका क्या करते हो?',
      },
      choices: [
        { text: { en: '😂 "I\'m going back to tell every animal what\'s in here. No one should be afraid of this."', hi: '😂 "मैं वापस जाऊँगा और हर जानवर को बताऊँगा यहाँ क्या है। किसी को इससे नहीं डरना चाहिए।"' }, next: 'ending_proud' },
        { text: { en: '😌 "I\'m keeping this to myself. This battlefield is mine now."',                              hi: '😌 "यह मैं खुद तक रखूँगा। यह युद्धभूमि अब मेरी है।"' },                                           next: 'ending_wise' },
      ],
    },

    // ── NODE 4b — PATH B ───────────────────────────────────────
    // He turns back. Spends the night at the edge, starving.
    // The sound keeps coming. Monster grows through the night.
    // IMAGE: turns_back.jpg — jackal curled at the edge of the
    //        battlefield in darkness, back turned to the source,
    //        eyes open and haunted
    // ──────────────────────────────────────────────────────────
    turns_back: {
      scene: 'forest_dark',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-turns-back.jpg',
      isEnding: true,
      text: {
        en: `Gomaya pulled his paw back.

He turned around. He walked back the way he came, back to the edge of the battlefield, back to the tree line where it was dark and familiar and safe.

He curled up under a thorn bush and closed his eyes.

BOOM.

He pulled himself tighter.

BOOM.

He told himself he had made the right decision. Smart, not cowardly. There was no shame in not knowing. There was no shame in being careful.

BOOM.

But the thing in his head kept growing. All through the night, each sound added something new to it — another layer of hide, another row of teeth, another impossible dimension. By the time the sky began to lighten, the creature in his mind was so large it filled the entire battlefield.

He would never go in there. Not today. Not any day.

He uncurled himself in the grey morning light and began walking — away from the battlefield, away from the food he had smelled so clearly, away from whatever was in there.

His stomach was silent now. Even hunger, it seemed, had given up.

He walked until the booming could no longer be heard.

Then he kept walking.

The Panchatantra teaches:
"Fear that is never questioned grows larger every night. The monster behind the wall is almost never as large as the one you build inside your mind. But you will never know — unless you look."`,
        hi: `गोमाय ने अपना पंजा वापस खींचा।

वह मुड़ा। जहाँ से आया था वापस चला, युद्धभूमि के किनारे पर, पेड़ों की उस रेखा तक जहाँ अँधेरा और जाना-पहचाना और सुरक्षित था।

वह एक काँटेदार झाड़ी के नीचे लेट गया और आँखें बंद कर लीं।

धूम।

वह और सिकुड़ गया।

धूम।

उसने खुद को बताया कि उसने सही फैसला किया। चालाक, कायर नहीं। न जानने में कोई शर्म नहीं। सावधान रहने में कोई शर्म नहीं।

धूम।

लेकिन उसके मन की वह चीज़ बढ़ती रही। पूरी रात, हर आवाज़ ने उसमें कुछ नया जोड़ा — खाल की एक और परत, दाँतों की एक और कतार, एक और असंभव आयाम। जब तक आकाश हल्का होने लगा, उसके मन का वह प्राणी इतना बड़ा था कि पूरी युद्धभूमि भर गई।

वह वहाँ कभी नहीं जाएगा। आज नहीं। किसी दिन नहीं।

उसने खुद को भोर की स्लेटी रोशनी में उठाया और चलने लगा — युद्धभूमि से दूर, उस खाने से दूर जो उसने इतने साफ़ सूँघा था, वहाँ जो भी था उससे दूर।

उसका पेट अब चुप था। यहाँ तक कि भूख भी हार मान चुकी लगती थी।

वह तब तक चलता रहा जब तक वह धूम सुनाई देना बंद नहीं हुई।

फिर चलता रहा।

पञ्चतन्त्र सिखाता है:
"डर जिस पर कभी सवाल नहीं उठाया जाता वह हर रात बड़ा होता है। दीवार के पीछे का राक्षस लगभग कभी उतना बड़ा नहीं होता जितना तुम अपने मन में बनाते हो। लेकिन तुम कभी नहीं जानोगे — जब तक देखोगे नहीं।"`,
      },
      lesson: { en: "Fear that goes unquestioned grows larger every night. The only way to shrink a monster is to look at it.", hi: 'डर जिस पर सवाल नहीं उठाया जाता वह हर रात बड़ा होता है। राक्षस को छोटा करने का एकमात्र तरीका है उसे देखना।' },
      lessonIcon: '🌑',
    },

    // ── NODE 5a — PATH A · ENDING 1 ────────────────────────────
    // Jackal goes back and tells every animal. Leads them in.
    // IMAGE: ending_proud.jpg — jackal leading group of animals
    //        onto battlefield at dawn, war drum visible ahead
    // ──────────────────────────────────────────────────────────
    ending_proud: {
      scene: 'forest_dawn',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-ending-proud.jpg',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `Gomaya ate well that night. He ate until the hollow ache in his ribs began to soften.

Then he curled up beside the drum and slept — the best sleep he had had in days — while it boomed calmly over him in the breeze.

In the morning, he went back to the forest.

He found the deer first, then the foxes, then the old bear who had not eaten in days.

"Come," he said. "I need to show you something."

"The battlefield?" the deer said, ears back. "There is something terrible in there. Everyone knows."

"Everyone is wrong," said Gomaya. "Come."

He led them across the field to the drum. He showed them the branch. He let the breeze do the rest.

BOOM.

The deer flinched. Then stared. Then looked at Gomaya.

"That's it?"

"That's it," said Gomaya.

They ate together — all of them — in the shade of the enormous drum that had terrorised the forest for weeks. The boom came every few minutes, regular as breathing, harmless as wind.

By the end of the day, animals who had been starving were full.

The Panchatantra teaches:
"Courage is not the absence of fear. It is taking the step anyway — and then turning around to take it again with someone who is still afraid, so they don't have to be afraid alone."`,
        hi: `गोमाय ने उस रात खूब खाया। तब तक खाया जब तक पसलियों का खालीपन थोड़ा कम नहीं हो गया।

फिर नगाड़े के पास लेट गया और सोया — दिनों में सबसे अच्छी नींद — जबकि हवा में यह शांति से उसके ऊपर बोलता रहा।

सुबह, वह जंगल वापस गया।

पहले हिरन मिला, फिर लोमड़ियाँ, फिर वह बूढ़ा भालू जिसने दिनों से नहीं खाया था।

"आओ," उसने कहा। "मुझे तुम्हें कुछ दिखाना है।"

"युद्धभूमि?" हिरन ने कहा, कान पीछे। "वहाँ कुछ भयानक है। सब जानते हैं।"

"सब गलत हैं," गोमाय ने कहा। "आओ।"

वह उन्हें मैदान पार कराकर नगाड़े तक ले गया। उसने शाखा दिखाई। हवा को बाकी करने दिया।

धूम।

हिरन चौंका। फिर देखा। फिर गोमाय को देखा।

"बस यही है?"

"बस यही है," गोमाय ने कहा।

वे सब साथ खाए — सब मिलकर — उस विशाल नगाड़े की छाया में जिसने हफ्तों जंगल को आतंकित किया था। धूम हर कुछ मिनट में आती रही, साँस जैसी नियमित, हवा जैसी हानिरहित।

दिन के अंत तक, भूखे जानवर पेट भरकर थे।

पञ्चतन्त्र सिखाता है:
"साहस डर का न होना नहीं है। यह फिर भी कदम उठाना है — और फिर मुड़कर किसी ऐसे के साथ फिर से उठाना है जो अभी भी डरा हुआ है, ताकि उन्हें अकेले नहीं डरना पड़े।"`,
      },
      lesson: { en: "Courage is not the absence of fear. It is looking anyway — and then going back for the ones who couldn't look alone.", hi: 'साहस डर का न होना नहीं है। यह फिर भी देखना है — और फिर उनके लिए वापस जाना जो अकेले नहीं देख सके।' },
      lessonIcon: '🥁',
    },

    // ── NODE 5b — PATH A · ENDING 2 ────────────────────────────
    // Jackal keeps the battlefield secret. Lives well — alone.
    // Watches other animals starve. The cost of hoarding truth.
    // IMAGE: ending_wise.jpg — jackal eating alone beside the drum,
    //        thin hungry animals visible through gap in the wall
    // ──────────────────────────────────────────────────────────
    ending_wise: {
      scene: 'forest_dawn',
      image: '/images/the-jackal-and-war-drum/the-jackal-and-war-drum-ending-wise.jpg',
      isEnding: true,
      text: {
        en: `Gomaya ate well that night. And the night after. And the night after that.

The battlefield was his. He returned each evening, stepped past the drum without a second glance, and ate from the scattered stores that no other animal dared approach.

He grew fat while the forest around him thinned.

One evening he passed the old deer on his way in. She was thin — ribs showing, eyes dull.

"Where do you go each evening?" she asked.

Gomaya paused.

He thought about the booming. About how afraid he had been. About how the knowing had made all the difference.

"Nowhere," he said. "Just walking."

He ate alone that night. The great boom rang out around him, regular and indifferent.

But the deer's dull eyes stayed with him.

There is a kind of courage that only saves yourself. And a kind that looks behind and asks — who else is still afraid, and could I show them what I know?

The Panchatantra teaches:
"Knowledge kept only for yourself is a fire that warms only one. Knowledge shared is a fire that warms the whole forest.
Ask yourself — what do you know that someone else is still afraid of?"`,
        hi: `गोमाय ने उस रात खूब खाया। और उसके बाद की रात। और उसके बाद भी।

युद्धभूमि उसकी थी। वह हर शाम लौटता, नगाड़े के पास से बिना दूसरी नज़र के गुज़रता, और बिखरे भंडार से खाता जिसके पास कोई और जानवर पहुँचने की हिम्मत नहीं करता था।

जब उसके आसपास जंगल पतला होता गया, वह मोटा होता गया।

एक शाम वह अंदर जाते हुए बूढ़े हिरन के पास से गुज़रा। वह पतला था — पसलियाँ दिखती, आँखें बेजान।

"तुम हर शाम कहाँ जाते हो?" उसने पूछा।

गोमाय रुका।

उसने उस धूम के बारे में सोचा। कितना डरा था। जानने ने कितना फर्क किया था।

"कहीं नहीं," उसने कहा। "बस टहल रहा हूँ।"

उस रात वह अकेले खाया। वह बड़ी धूम उसके आसपास गूँजती रही, नियमित और बेपरवाह।

लेकिन हिरन की बेजान आँखें उसके साथ रहीं।

एक तरह का साहस है जो सिर्फ खुद को बचाता है। और एक तरह जो पीछे देखता है और पूछता है — और कौन अभी भी डरा हुआ है, और क्या मैं उन्हें वह दिखा सकता हूँ जो मैं जानता हूँ?

पञ्चतन्त्र सिखाता है:
"ज्ञान जो सिर्फ अपने लिए रखा जाए वह एक आग है जो सिर्फ एक को गर्म करती है। साझा किया गया ज्ञान एक आग है जो पूरे जंगल को गर्म करती है।
खुद से पूछो — क्या जानते हो जिससे कोई और अभी भी डरा हुआ है?"`,
      },
      lesson: { en: "Knowledge kept only for yourself warms only one. The truest courage is going back for the ones still afraid.", hi: 'ज्ञान जो सिर्फ अपने लिए रखा जाए सिर्फ एक को गर्म करता है। सबसे सच्चा साहस उनके लिए वापस जाना है जो अभी भी डरे हैं।' },
      lessonIcon: '🔥',
    },

  },
};

export default jackalAndWarDrum;