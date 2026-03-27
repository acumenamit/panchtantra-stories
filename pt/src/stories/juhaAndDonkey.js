const juhaAndDonkey = {
  id: 'juha-and-donkey',
  title:       { en: 'Juha and the Donkey',        ar: 'جحا والحمار' },
  description: { en: 'Juha buys a fine donkey at the market and sets off home — but three clever strangers are about to make him question everything he knows to be true.',
                 ar: 'يشتري جحا حماراً جميلاً من السوق ويتجه نحو البيت — لكن ثلاثة غرباء أذكياء على وشك أن يجعلاه يشكّ في كل ما يعرفه.' },
  theme:       { en: 'Trust your own eyes — not every confident voice', ar: 'ثق بعينيك — ليس بكل صوت واثق' },
  age: '6+',
  duration:    { en: '8–12 min', ar: '٨–١٢ دقيقة' },
  addedOn: '2026-03-27',
  featured: true,
  emoji: '🫏',
  color: '#f59e0b',
  book:        { en: 'Hikayat — Arabic Folk Tales', ar: 'حكايات — قصص عربية' },
  progressSteps: ['start', 'first_trick', 'the_doubt', 'ending_fooled', 'ending_wise'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // Juha at the market, proud of his new donkey.
    // Sets off home. First swindler strikes.
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village_day',
      text: {
        en: `Juha had been to the market three times before finally buying the donkey.

He had checked its teeth. He had checked its legs. He had walked around it twice, tapped its sides, looked it in the eye. A strong animal. A healthy animal. He paid the merchant twelve silver coins — almost everything he had — and took the rope in his hand.

He was proud. He could feel it, warm in his chest, as he led the donkey out of the market and onto the road home.

The donkey was grey with a white patch on its nose. It walked beside him steadily, head low, ears moving slowly. Its hooves clicked on the stones of the road.

Juha whistled to himself.

He had gone perhaps half a mile when a stranger appeared on the road ahead — a man he had never seen before, leaning on a stick, watching him approach.

"Peace be upon you," said the stranger.

"And upon you peace," said Juha.

The stranger looked at the donkey. He tilted his head. He frowned slightly, the way a man frowns when something is not quite right.

"Tell me," the stranger said, "where did you find a goat that size?"

Juha stopped.

"This is not a goat," Juha said. "This is a donkey."

"A donkey?" The stranger looked again, longer this time. "Well — perhaps you know better than I do." He shrugged and walked on.

Juha stood for a moment in the road.

A goat.

He looked at the animal beside him. Grey. White patch on the nose. Ears moving slowly. Hooves on stone.

He laughed quietly to himself and kept walking.`,
        ar: `ذهب جحا إلى السوق ثلاث مرات قبل أن يشتري الحمار أخيراً.

فحص أسنانه. فحص قوائمه. دار حوله مرتين، ونقر على جنبيه، ونظر في عينيه. حيوان قوي. حيوان سليم. دفع للتاجر اثني عشر درهماً فضياً — كل ما يملك تقريباً — وأمسك الحبل بيده.

كان فخوراً. يحسّه دافئاً في صدره، وهو يقود الحمار خارج السوق وعلى الطريق نحو البيت.

كان الحمار رمادياً بقعة بيضاء على أنفه. يمشي بجانبه بثبات، رأسه منخفض، أذناه تتحركان ببطء. حوافره تدقّ على حجارة الطريق.

صفّر جحا لنفسه.

كان قد مشى نحو نصف ميل حين ظهر غريب على الطريق أمامه — رجل لم يره من قبل، متكئاً على عصا، يراقبه وهو يقترب.

"السلام عليكم،" قال الغريب.

"وعليكم السلام،" قال جحا.

نظر الغريب إلى الحمار. أمال رأسه. عبس قليلاً، كما يعبس رجل حين يكون شيء ما غير صحيح تماماً.

"أخبرني،" قال الغريب، "أين وجدت معزاً بهذا الحجم؟"

توقف جحا.

"هذا ليس معزاً،" قال جحا. "هذا حمار."

"حمار؟" نظر الغريب مرة أخرى، أطول هذه المرة. "حسناً — ربما أنت تعرف أكثر مني." هزّ كتفيه ومضى.

وقف جحا لحظة في الطريق.

معزى.

نظر إلى الحيوان بجانبه. رمادي. بقعة بيضاء على الأنف. أذنان تتحركان ببطء. حوافر على حجر.

ضحك بهدوء لنفسه وواصل المشي.`,
      },
      question: {
        en: 'One stranger called your donkey a goat. You know what you bought. What do you feel right now?',
        ar: 'غريب واحد سمّى حمارك معزاً. أنت تعرف ما اشتريت. ماذا تشعر الآن؟',
      },
      choices: [
        { text: { en: '😄 "He was confused. I bought a donkey. I know what I bought."', ar: '😄 "هو مخطئ. اشتريت حماراً. أنا أعرف ما اشتريت."' }, next: 'first_trick' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // Second swindler. Now Juha is starting to waver.
    // The doubt is growing. Real fork here.
    // ──────────────────────────────────────────────────────────
    first_trick: {
      scene: 'village_day',
      text: {
        en: `Juha walked on.

The road was quiet. Dust. Stones. The donkey's hooves. His own sandals.

Then — a second stranger, sitting on a low wall by the side of the road. An old woman, white hair, sharp eyes. She watched him approach the way a hawk watches something in the grass.

"God give you health," she called out.

"And you," said Juha.

She looked at the donkey for a long time.

"My son," she said slowly, "I have lived seventy years and I know animals. That is a sheep."

Juha stopped.

"It is a donkey," he said. "I bought it this morning at the market."

"You bought it at the market," she said, nodding. "And the man who sold it to you — did he say it was a donkey?"

"He — yes. Of course."

"Of course," she said, and looked at the animal again with her sharp old eyes.

Juha opened his mouth to say something and found he had nothing to say.

He looked at the donkey. Grey. Four legs. White patch on the nose.

A donkey.

Wasn't it?

He said goodbye to the old woman and walked on. But his feet felt different now. A little less certain on the road.

Behind him, he did not see the old woman stand up from the wall — or smile — or follow at a distance.

He was watching the animal.

Was it a donkey?

He had been so sure.`,
        ar: `مشى جحا.

كان الطريق هادئاً. غبار. حجارة. حوافر الحمار. صندلاه هو.

ثم — غريب ثانٍ، جالس على جدار منخفض بجانب الطريق. امرأة عجوز، شعرها أبيض، عيناها حادتان. تراقبه وهو يقترب كما تراقب الصقرة شيئاً في العشب.

"الله يعطيك الصحة،" نادت.

"وأنت كذلك،" قال جحا.

نظرت إلى الحمار طويلاً.

"يا بني،" قالت ببطء، "لقد عشت سبعين سنة وأعرف الحيوانات. هذه خروف."

توقف جحا.

"إنه حمار،" قال. "اشتريته هذا الصباح من السوق."

"اشتريته من السوق،" قالت وهي تومئ. "والرجل الذي باعه لك — هل قال إنه حمار؟"

"هو — نعم. بالطبع."

"بالطبع،" قالت، ونظرت إلى الحيوان مرة أخرى بعينيها الحادتين العجوزتين.

فتح جحا فمه ليقول شيئاً فوجد أنه لا يملك ما يقوله.

نظر إلى الحمار. رمادي. أربع قوائم. بقعة بيضاء على الأنف.

حمار.

أليس كذلك؟

ودّع العجوز ومضى. لكن قدميه شعرتا بثقل مختلف الآن. أقل يقيناً بقليل على الطريق.

خلفه، لم ير العجوز تقف من الجدار — أو تبتسم — أو تتبعه من بُعد.

كان يراقب الحيوان.

هل هو حمار؟

كان متأكداً جداً.`,
      },
      question: {
        en: 'Two strangers. Two wrong names. But you checked it yourself at the market. What do you do?',
        ar: 'غريبان. اسمان خاطئان. لكنك فحصته بنفسك في السوق. ماذا تفعل؟',
      },
      choices: [
        { text: { en: '💪 "Two strangers don\'t know better than my own eyes. It\'s a donkey. I\'m sure."', ar: '💪 "غريبان لا يعرفان أفضل من عينيّ. إنه حمار. أنا متأكد."' }, next: 'holds_firm' },
        { text: { en: '😟 "Two people saw something different. What if I\'m the one who is wrong?"', ar: '😟 "شخصان رأيا شيئاً مختلفاً. ماذا لو كنت أنا المخطئ؟"' }, next: 'the_doubt' },
      ],
    },

    // ── NODE 3a — PATH A (doubts himself) ──────────────────────
    // Third swindler finishes the job. Juha convinced it's a dog.
    // Lets the rope go. Arrives home with nothing.
    // ──────────────────────────────────────────────────────────
    the_doubt: {
      scene: 'village_day',
      text: {
        en: `Juha walked more slowly now.

His eyes kept going back to the animal. He had checked it at the market, hadn't he? He had been so careful. But then — what did he know, really? He was no expert. The old woman had lived seventy years. The first man had seemed very certain.

He was so deep in his thoughts that he almost walked into the third stranger.

A young man, well-dressed, standing directly in the road.

"Brother," said the young man, looking at the animal with wide eyes, "why are you leading a dog on a rope?"

Juha's mouth went dry.

"This is not a dog," Juha said. But even as he said it, his voice was uncertain.

"I can see it has four legs," the young man said, generously. "But look at it — look at the face. Look at the way it stands."

Juha looked.

He had been looking at this animal for an hour. He had stopped seeing it.

"I — I bought it as a donkey," Juha said.

"Then you were deceived," the young man said, not unkindly. "I am sorry."

He walked away.

Juha stood alone in the road.

Three people. Three different animals. And now his own memory felt slippery — what had he really seen at the market? What had he really paid for?

The rope in his hand felt strange.

He looked down at the animal.

He let go of the rope.

He walked home with empty hands.

When his wife asked where the donkey was, Juha said: "I am not sure it was a donkey."

And he sat down, and he thought about what he had seen — and what he had allowed three strangers to unsee for him.`,
        ar: `مشى جحا بشكل أبطأ الآن.

عيناه تعودان إلى الحيوان باستمرار. لقد فحصه في السوق، أليس كذلك؟ كان دقيقاً جداً. لكن — ماذا يعرف هو، حقاً؟ لم يكن خبيراً. لقد عاشت العجوز سبعين سنة. الرجل الأول بدا واثقاً جداً.

كان غارقاً في أفكاره لدرجة أنه كاد يصطدم بالغريب الثالث.

شاب، حسن الملبس، واقف مباشرة في الطريق.

"يا أخي،" قال الشاب، ناظراً إلى الحيوان بعيون واسعة، "لماذا تقود كلباً بحبل؟"

جفّ فم جحا.

"هذا ليس كلباً،" قال جحا. لكن حتى وهو يقولها، كان صوته متردداً.

"أرى أن له أربع قوائم،" قال الشاب، بسخاء. "لكن انظر إليه — انظر إلى الوجه. انظر إلى طريقة وقوفه."

نظر جحا.

كان ينظر إلى هذا الحيوان منذ ساعة. توقف عن رؤيته.

"أنا — اشتريته كحمار،" قال جحا.

"إذن خُدعت،" قال الشاب، ليس بقسوة. "أنا آسف."

مشى بعيداً.

وقف جحا وحيداً في الطريق.

ثلاثة أشخاص. ثلاثة حيوانات مختلفة. والآن شعرت ذاكرته بالزلق — ماذا رأى حقاً في السوق؟ ماذا دفع ثمنه حقاً؟

شعر الحبل في يده بغرابة.

نظر إلى الحيوان.

أطلق الحبل.

مشى نحو البيت بيدين فارغتين.

حين سألته زوجته عن الحمار، قال جحا: "لست متأكداً أنه كان حماراً."

وجلس، وفكّر فيما رأى — وفيما سمح لثلاثة غرباء أن يُلغوه من ذاكرته.`,
      },
      question: {
        en: 'You let go of the rope. You walked home with nothing. Now you understand what happened. What do you feel?',
        ar: 'أطلقت الحبل. مشيت إلى البيت بلا شيء. الآن تفهم ما حدث. ماذا تشعر؟',
      },
      choices: [
        { text: { en: '😔 "I saw it clearly at the market. Three loud voices made me forget what my own eyes told me."', ar: '😔 "رأيته بوضوح في السوق. ثلاثة أصوات عالية جعلتني أنسى ما أخبرتني به عيناي."' }, next: 'ending_fooled' },
      ],
    },

    // ── NODE 3b — PATH B (holds firm) ──────────────────────────
    // Third swindler tries. Juha doesn't budge. Arrives home.
    // ──────────────────────────────────────────────────────────
    holds_firm: {
      scene: 'village_day',
      text: {
        en: `Juha tightened his grip on the rope and walked on.

The road curved. A grove of palms. The sound of water somewhere.

Then — a third stranger. A young man, well-dressed, stepping into the road directly ahead.

"God's peace," he said.

"And upon you," said Juha.

The young man looked at the donkey. He opened his mouth.

"Before you say anything," said Juha, "it is a donkey. I bought it this morning at the market. I checked its teeth, its legs, and its eyes. I paid twelve silver coins. I have been walking with it for an hour. Two people have already told me it is something else. You are about to tell me the same thing. It is still a donkey."

The young man stared at him.

He closed his mouth.

He stepped aside.

Juha walked past him without slowing down.

He arrived home as the sun was setting. His wife came out to meet him and looked at the donkey with surprise.

"You actually bought one," she said.

"I told you I would," said Juha.

He tied the donkey in the yard, gave it water and feed, and sat down on the step. His hands were steady. His chest felt quiet.

Three people had tried to take away what he knew. Not with force — just with confident voices and a question dropped like a stone into still water.

He had kept hold of the rope.`,
        ar: `شدّ جحا قبضته على الحبل ومضى.

انعطف الطريق. بستان من النخيل. صوت ماء في مكان ما.

ثم — غريب ثالث. شاب، حسن الملبس، يخطو في الطريق مباشرة أمامه.

"سلام الله،" قال.

"وعليكم،" قال جحا.

نظر الشاب إلى الحمار. فتح فمه.

"قبل أن تقول أي شيء،" قال جحا، "إنه حمار. اشتريته هذا الصباح من السوق. فحصت أسنانه وقوائمه وعينيه. دفعت اثني عشر درهماً فضياً. مشيت معه ساعة. أخبرني شخصان بالفعل أنه شيء آخر. أنت على وشك أن تقول الشيء ذاته. لا يزال حماراً."

حدّق الشاب فيه.

أغلق فمه.

تنحّى جانباً.

مشى جحا مجتازاً إياه دون أن يبطئ.

وصل إلى البيت والشمس تغرب. خرجت زوجته لتلقيه ونظرت إلى الحمار بدهشة.

"اشتريت واحداً فعلاً،" قالت.

"أخبرتك أنني سأفعل،" قال جحا.

ربط الحمار في الفناء وأعطاه ماء وعلفاً، وجلس على الدرجة. يداه ثابتتان. صدره هادئ.

ثلاثة أشخاص حاولوا أن يسلبوا ما يعرفه. ليس بالقوة — فقط بأصوات واثقة وسؤال يُلقى كحجر في ماء ساكن.

ظلّ ممسكاً بالحبل.`,
      },
      question: {
        en: 'You held on. You arrived home with the donkey. What did you learn from the three strangers?',
        ar: 'تمسّكت. وصلت إلى البيت بالحمار. ماذا تعلمت من الغرباء الثلاثة؟',
      },
      choices: [
        { text: { en: '🫏 "A confident voice is not the same as a true voice. I knew what I saw."', ar: '🫏 "الصوت الواثق ليس هو الصوت الصادق. كنت أعرف ما رأيت."' }, next: 'ending_wise' },
      ],
    },

    // ── ENDING A — fooled ──────────────────────────────────────
    ending_fooled: {
      scene: 'village_evening',
      isEnding: true,
      text: {
        en: `That night, Juha's wife sent her brother to find the donkey.

He found it two miles down the road, still wearing its rope, standing quietly by a wall. The three strangers were nowhere to be seen. His brother-in-law brought it home.

Juha sat with the donkey in the yard for a long time.

He touched its nose. The white patch. He looked at its legs. Its teeth. Everything he had checked so carefully at the market.

It was a donkey. It had always been a donkey.

He had known this. And then three strangers — one after another — had said different things with confident voices. Not shouting. Not threatening. Just: "That is a goat." "That is a sheep." "That is a dog." 

And he had allowed their certainty to replace his own.

The donkey looked at him with large, patient eyes.

"You knew," said Juha. "You were a donkey the whole time."

The donkey said nothing, which was exactly the right thing to say.

Juha learned something that night that no market sells and no coin buys: if ten people tell you the sky is green, go outside and look up. Your own eyes were given to you first.`,
        ar: `في تلك الليلة، أرسلت زوجة جحا أخاها للبحث عن الحمار.

وجده على بُعد ميلين في الطريق، لا يزال يرتدي حبله، واقفاً بهدوء بجانب جدار. لم يكن الغرباء الثلاثة في مكان يُرى. أعاده صهره إلى البيت.

جلس جحا مع الحمار في الفناء طويلاً.

لمس أنفه. البقعة البيضاء. نظر إلى قوائمه. أسنانه. كل ما فحصه بعناية في السوق.

كان حماراً. كان دائماً حماراً.

كان يعرف هذا. ثم جاء ثلاثة غرباء — واحداً تلو الآخر — وقالوا أشياء مختلفة بأصوات واثقة. لا صراخ. لا تهديد. فقط: "هذا معزى." "هذا خروف." "هذا كلب."

وسمح لهم بأن تحلّ يقينهم محلّ يقينه.

نظر إليه الحمار بعيون كبيرة صابرة.

"كنت تعرف،" قال جحا. "كنت حماراً طوال الوقت."

لم يقل الحمار شيئاً، وهذا كان بالضبط الشيء الصحيح ليقوله.

تعلّم جحا تلك الليلة شيئاً لا يبيعه سوق ولا يشتريه درهم: إذا أخبرك عشرة أشخاص أن السماء خضراء، اخرج وانظر إلى أعلى. عيناك أُعطيتا لك أولاً.`,
      },
      lesson: { en: "If ten confident voices tell you the sky is green — go outside and look up. Your own eyes were given to you first.", ar: "إذا أخبرك عشرة أصوات واثقة أن السماء خضراء — اخرج وانظر إلى أعلى. عيناك أُعطيتا لك أولاً." },
      lessonIcon: '🫏',
    },

    // ── ENDING B — held firm ───────────────────────────────────
    ending_wise: {
      scene: 'village_evening',
      isEnding: true,
      text: {
        en: `That night, Juha's neighbour came to visit and heard the story of the three strangers.

"You were lucky," the neighbour said. "Most men would have let go of the rope."

"I was not lucky," said Juha. "I was scared. The second stranger almost had me."

"But you held on."

"I held on because I remembered the market," Juha said. "I remembered kneeling in the dust and checking the teeth myself. I remembered the merchant's face. I remembered counting out the twelve coins." He paused. "Once I remembered all of that — the strangers' voices became smaller."

The neighbour was quiet for a moment.

"What if there had been ten strangers?" he asked.

Juha thought about this.

"Then I would have needed to remember more carefully," he said.

The donkey, tied in the yard, made a small sound in the darkness.

Juha smiled.

There is a kind of thief who takes nothing from your pocket. He takes something harder to get back — your trust in your own eyes. The only protection against him is this: know what you know, and know how you know it.`,
        ar: `في تلك الليلة، جاء جار جحا يزوره وسمع قصة الغرباء الثلاثة.

"كنت محظوظاً،" قال الجار. "معظم الرجال كانوا سيتركون الحبل."

"لم أكن محظوظاً،" قال جحا. "كنت خائفاً. الغريبة الثانية كادت تأخذني."

"لكنك تمسّكت."

"تمسّكت لأنني تذكرت السوق،" قال جحا. "تذكرت كيف جثوت في التراب وفحصت الأسنان بنفسي. تذكرت وجه التاجر. تذكرت عدّ الدراهم الاثني عشر." توقف. "حين تذكرت كل ذلك — صارت أصوات الغرباء أصغر."

صمت الجار لحظة.

"ماذا لو كان هناك عشرة غرباء؟" سأل.

فكّر جحا في هذا.

"كنت سأحتاج إلى أن أتذكر بعناية أكبر،" قال.

الحمار، المربوط في الفناء، أصدر صوتاً صغيراً في الظلام.

ابتسم جحا.

هناك نوع من اللصوص لا يأخذ شيئاً من جيبك. يأخذ شيئاً أصعب استرداداً — ثقتك بعينيك. الحماية الوحيدة منه هي هذه: اعرف ما تعرف، واعرف كيف تعرفه.`,
      },
      lesson: { en: "Know what you know — and know how you know it. A confident voice is not the same as a true voice.", ar: "اعرف ما تعرف — واعرف كيف تعرفه. الصوت الواثق ليس هو الصوت الصادق." },
      lessonIcon: '🌟',
    },

  },
};

export default juhaAndDonkey;
