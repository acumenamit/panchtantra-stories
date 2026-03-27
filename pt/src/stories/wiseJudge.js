const wiseJudge = {
  id: 'wise-judge',
  title:       { en: 'The Wise Judge',             ar: 'القاضي الحكيم' },
  description: { en: 'A merchant dies and leaves everything to his apprentice — not his son. You are the judge. Two men stand before you. Only one can be right.',
                 ar: 'يموت تاجر ويترك كل شيء لتلميذه — لا لابنه. أنت القاضي. رجلان يقفان أمامك. واحد فقط يمكن أن يكون على حق.' },
  theme:       { en: 'Justice means hearing what was said — not only who is saying it', ar: 'العدل يعني سماع ما قيل — لا من قاله فحسب' },
  age: '8+',
  duration:    { en: '10–14 min', ar: '١٠–١٤ دقيقة' },
  addedOn: '2026-03-27',
  featured: false,
  emoji: '⚖️',
  color: '#6366f1',
  book:        { en: 'Hikayat — Arabic Folk Tales', ar: 'حكايات — قصص عربية' },
  progressSteps: ['start', 'the_sons_case', 'the_apprentices_case', 'twist', 'ending_mercy'],

  nodes: {

    // ── NODE 1 ─────────────────────────────────────────────────
    // The merchant is dead. The son arrives in court furious.
    // You are the judge. Single choice — you must hear both sides.
    // ──────────────────────────────────────────────────────────
    start: {
      scene: 'village_day',
      text: {
        en: `The merchant Yusuf al-Rashid died on a Tuesday.

By Wednesday morning, his son Tariq was standing in your courtroom.

You have been a judge in this city for eleven years. You have heard disputes over land, over water, over the custody of children and the debts of dead men. You thought you had heard everything.

Tariq al-Rashid is twenty-three years old. He is well-dressed, well-fed, and furious. He stands with the particular anger of a man who believes something has been taken from him.

Behind him, quieter, stands a young man you do not recognise. He is perhaps twenty, simply dressed, holding a folded document in both hands. He has the look of someone who has not slept.

"My father's will," Tariq says, before you have even called the court to order. "I want it declared void."

You hold up your hand. He stops.

You have learned, in eleven years, that the first person to speak in a dispute is rarely the one with the strongest case. They are simply the one with the most anger.

"Sit down," you say. "Both of you."

They sit.

"I will hear the son first," you say. "Then I will hear — " you look at the young man with the document, "— who are you?"

"Kareem," he says quietly. "I was Master Yusuf's apprentice for six years."

You nod.

"I will hear Kareem second. Then I will decide."

The courtroom is silent. Outside, the city goes about its business. Inside, two young men wait — one with fury, one with a piece of paper — for you to tell them which of them inherits a dead man's life's work.`,
        ar: `مات التاجر يوسف الرشيد يوم الثلاثاء.

صباح الأربعاء، كان ابنه طارق واقفاً في قاعة محكمتك.

عملت قاضياً في هذه المدينة أحد عشر عاماً. سمعت نزاعات على الأراضي، على الماء، على حضانة الأطفال وديون الموتى. ظننت أنك سمعت كل شيء.

طارق الرشيد في الثالثة والعشرين من عمره. أنيق الملبس، ممتلئ البنية، وغاضب. يقف بغضب رجل يؤمن أن شيئاً قد سُرق منه.

خلفه، أكثر هدوءاً، يقف شاب لا تعرفه. ربما في العشرين، بسيط الملبس، يمسك وثيقة مطوية بكلتا يديه. يبدو عليه أنه لم ينم.

"وصية أبي،" يقول طارق، قبل أن تفتتح الجلسة حتى. "أريدها أن تُعلن باطلة."

ترفع يدك. يتوقف.

تعلمت، في أحد عشر عاماً، أن أول من يتكلم في نزاع نادراً ما يكون صاحب أقوى حجة. إنه ببساطة صاحب أكبر غضب.

"اجلسا،" تقول. "كلاكما."

يجلسان.

"سأسمع الابن أولاً،" تقول. "ثم سأسمع — " تنظر إلى الشاب صاحب الوثيقة، "— من أنت؟"

"كريم،" يقول بهدوء. "كنت تلميذ الأستاذ يوسف ست سنوات."

تومئ.

"سأسمع كريماً ثانياً. ثم سأقرر."

الصمت يسود القاعة. في الخارج، تواصل المدينة أعمالها. في الداخل، ينتظر شابان — أحدهما بغضب، والآخر بقطعة ورق — ليخبرهما أيهما يرث عمل رجل ميت.`,
      },
      question: {
        en: 'Two men. One fortune. Before you hear a single word — what does your instinct tell you?',
        ar: 'رجلان. ثروة واحدة. قبل أن تسمع كلمة واحدة — ماذا تقول لك حدسك؟',
      },
      choices: [
        { text: { en: '⚖️ "I feel nothing yet. I need to hear both sides before I feel anything."', ar: '⚖️ "لا أشعر بشيء بعد. أحتاج أن أسمع الطرفين قبل أن أشعر بأي شيء."' }, next: 'the_sons_case' },
      ],
    },

    // ── NODE 2 ─────────────────────────────────────────────────
    // The son makes his case. Emotional, blood-based argument.
    // ──────────────────────────────────────────────────────────
    the_sons_case: {
      scene: 'village_day',
      text: {
        en: `Tariq stands. He is a good speaker — you can tell he has rehearsed this.

"My father built his business with his own hands," he begins. "Thirty years. He started with one cart and a borrowed scale. He ended with three warehouses, six trade routes, and a reputation that reached as far as Damascus."

He pauses to let this settle.

"I am his son. His only son. My mother died when I was four. My father raised me alone, and I watched him build every part of what he had. I worked in those warehouses as a boy. I know the smell of every spice he traded."

His voice tightens.

"And then — six years ago — this boy arrives. A stranger's son from a village no one has heard of. My father takes him in, teaches him, feeds him, pays him. And now I am standing here because my father — in the last month of his life, when he was ill and confused — signed a document that gives this stranger everything."

He looks at you directly.

"I am not arguing against the apprentice. I am arguing that my father was not himself when he signed that paper. A man does not give his life's work to a servant and leave his own blood with nothing. Not unless something is wrong."

He sits.

The courtroom is quiet.

You have heard this argument before. Not these exact words — but this shape. The shape of a person who cannot accept that they were not chosen.

But you have also heard it from people who were right.

Now you look at Kareem.`,
        ar: `يقوم طارق. إنه متحدث جيد — تستطيع أن تلمس أنه تدرّب على هذا.

"بنى أبي تجارته بيديه،" يبدأ. "ثلاثون عاماً. بدأ بعربة واحدة وميزان مستعار. وانتهى بثلاثة مستودعات وستة طرق تجارية وسمعة وصلت إلى دمشق."

يتوقف ليترك الكلام يستقر.

"أنا ابنه. ابنه الوحيد. ماتت أمي حين كنت في الرابعة. ربّاني أبي وحده، وشاهدته يبني كل ما يملك. عملت في تلك المستودعات طفلاً. أعرف رائحة كل بهار كان يتاجر به."

يشتد صوته.

"ثم — قبل ست سنوات — يأتي هذا الشاب. ابن غريب من قرية لم يسمع بها أحد. يأخذه أبي، يعلّمه، يطعمه، يدفع له. والآن أقف هنا لأن أبي — في الشهر الأخير من حياته، حين كان مريضاً ومرتبكاً — وقّع على وثيقة تعطي هذا الغريب كل شيء."

ينظر إليك مباشرة.

"لا أحتج على التلميذ. أحتج على أن أبي لم يكن في حالته الطبيعية حين وقّع تلك الورقة. الرجل لا يعطي عمل حياته لخادم ويترك دمه بلا شيء. ليس إلا إذا كان ثمة خطأ ما."

يجلس.

الصمت يسود القاعة.

سمعت هذه الحجة من قبل. ليس بهذه الكلمات بالضبط — لكن بهذا الشكل. شكل شخص لا يستطيع قبول أنه لم يُختر.

لكنك سمعتها أيضاً ممن كانوا على حق.

الآن تنظر إلى كريم.`,
      },
      question: {
        en: 'The son has spoken. He is angry — but is he wrong? What do you think before you hear the other side?',
        ar: 'تكلّم الابن. إنه غاضب — لكن هل هو مخطئ؟ ماذا تعتقد قبل أن تسمع الطرف الآخر؟',
      },
      choices: [
        { text: { en: '🤔 "I hear his pain. But pain is not evidence. I need to hear Kareem."', ar: '🤔 "أسمع ألمه. لكن الألم ليس دليلاً. أحتاج أن أسمع كريماً."' }, next: 'the_apprentices_case' },
      ],
    },

    // ── NODE 3 — THE REAL FORK ─────────────────────────────────
    // Kareem speaks. Shows the will. Quiet and factual.
    // The judge must decide which way to lean.
    // ──────────────────────────────────────────────────────────
    the_apprentices_case: {
      scene: 'village_day',
      text: {
        en: `Kareem stands slowly, as if he is not sure he deserves the space.

He places the document on the table in front of you. You do not touch it yet.

"I came to Master Yusuf when I was fourteen," he says. "My father had died and left debts. Master Yusuf did not know my father — he heard I needed work and he gave me a chance."

His voice is steady. He is not performing.

"For six years I worked for him. I learned the trade routes, the weights, the suppliers, how to read a contract, how to spot a dishonest scale. He taught me everything he knew." A pause. "He told me once that knowledge given away doubles. That was how he thought."

He looks at the document.

"Eight months ago, before he became ill, he called me to his office. He was healthy. He was clear. There were two witnesses — his neighbour Ibrahim and the scribe Mahmoud, both of whom will confirm what I say. He told me he had decided to leave the business to me. He said — " Kareem stops, steadies himself — "he said Tariq had been offered the business twice and had refused both times. He said he wanted it to go to someone who would carry it forward."

The courtroom is completely still.

You look at Tariq. His jaw is tight. He does not deny this — but his eyes say something complicated.

You pick up the document. The signatures are there. The witnesses' marks are there. It was written eight months ago, not in the last confused weeks of a dying man.

The son's case just became much harder.

But you are not done yet. You have one question that no one has asked.`,
        ar: `يقوم كريم ببطء، كأنه غير متأكد من أنه يستحق هذا الحيز.

يضع الوثيقة على الطاولة أمامك. لا تلمسها بعد.

"جئت إلى الأستاذ يوسف وعمري أربعة عشر عاماً،" يقول. "كان أبي قد مات وترك ديوناً. لم يكن الأستاذ يوسف يعرف أبي — سمع أنني أحتاج عملاً فأعطاني فرصة."

صوته ثابت. لا يمثّل.

"ست سنوات عملت معه. تعلمت طرق التجارة، الأوزان، الموردين، كيف أقرأ عقداً، كيف أكشف ميزاناً غير أمين. علّمني كل ما يعرفه." توقف. "قال لي مرة إن المعرفة التي تُعطى تتضاعف. هكذا كان يفكر."

ينظر إلى الوثيقة.

"قبل ثمانية أشهر، قبل أن يمرض، استدعاني إلى مكتبه. كان بصحة جيدة. كان واضح الذهن. كان ثمة شاهدان — جاره إبراهيم والكاتب محمود، وكلاهما سيؤكد ما أقوله. أخبرني أنه قرر أن يترك التجارة لي. قال — " يتوقف كريم، يتماسك — "قال إن طارقاً عُرضت عليه التجارة مرتين ورفض في كلتا المرتين. قال إنه يريدها أن تذهب إلى من سيواصل المسيرة."

القاعة ساكنة تماماً.

تنظر إلى طارق. فكّه متصلّب. لا ينفي هذا — لكن عينيه تقولان شيئاً معقداً.

تمسك الوثيقة. التواقيع موجودة. علامات الشهود موجودة. كُتبت قبل ثمانية أشهر، لا في الأسابيع الأخيرة المضطربة من حياة رجل محتضر.

حجة الابن صارت أصعب بكثير.

لكنك لم تنته بعد. عندك سؤال واحد لم يطرحه أحد.`,
      },
      question: {
        en: 'The will is legal. The witnesses are real. But Tariq did not deny the refusals. As the judge — what do you do?',
        ar: 'الوصية قانونية. الشهود حقيقيون. لكن طارقاً لم ينفِ الرفضَين. كقاضٍ — ماذا تفعل؟',
      },
      choices: [
        { text: { en: '⚖️ "I rule now — the will is clear and legal. The apprentice inherits."', ar: '⚖️ "أحكم الآن — الوصية واضحة وقانونية. التلميذ يرث."' }, next: 'ruling_for_apprentice' },
        { text: { en: '🤔 "I have one question first. I want to ask Tariq something no one has asked yet."', ar: '🤔 "عندي سؤال واحد أولاً. أريد أن أسأل طارقاً شيئاً لم يسأله أحد بعد."' }, next: 'twist' },
      ],
    },

    // ── NODE 4a — RULES WITHOUT ASKING ────────────────────────
    // Judge rules immediately for apprentice. Correct but cold.
    // ──────────────────────────────────────────────────────────
    ruling_for_apprentice: {
      scene: 'village_day',
      isAlternate: true,
      isEnding: true,
      text: {
        en: `You set the document down.

"The will of Yusuf al-Rashid is legal and witnessed," you say. "It was written eight months before his death, by a man in full health and clear mind. The business passes to Kareem."

Tariq's face goes still.

"You cannot — " he starts.

"I can," you say, not unkindly. "And I have."

Kareem bows his head. He does not look triumphant — he looks like a man who has just been given something very heavy to carry.

Tariq stands for a long moment. Then he walks out without another word. The door of the courtroom closes behind him.

You watch him go.

You were right. The law was on your side. The document was clear. You made the correct ruling.

But for the rest of that afternoon, you find yourself wondering about the two refusals. Why did Tariq refuse twice? What happened between a father and a son that made a man choose a stranger over his own blood?

You ruled correctly. But you ruled without knowing the whole story.

A wise judge can do that. Sometimes the law is clear and must be followed.

But the wisest judges know the difference between a case that is finished — and a story that isn't.`,
        ar: `تضع الوثيقة على الطاولة.

"وصية يوسف الرشيد قانونية وموثّقة،" تقول. "كُتبت قبل ثمانية أشهر من وفاته، بيد رجل في كامل صحته وعقله. التجارة تنتقل إلى كريم."

يتجمّد وجه طارق.

"لا تستطيع — " يبدأ.

"أستطيع،" تقول، بلا قسوة. "وقد فعلت."

يطأطئ كريم رأسه. لا يبدو منتصراً — يبدو كرجل أُعطي للتو شيئاً ثقيلاً جداً ليحمله.

يقف طارق لحظة طويلة. ثم يخرج دون كلمة أخرى. يُغلق باب القاعة خلفه.

تراقبه يرحل.

كنت على حق. القانون كان في صفك. الوثيقة كانت واضحة. أصدرت الحكم الصحيح.

لكن طوال بقية ذلك اليوم، تجد نفسك تتساءل عن الرفضين. لماذا رفض طارق مرتين؟ ما الذي جرى بين أب وابن جعل رجلاً يختار غريباً على دمه؟

حكمت بشكل صحيح. لكنك حكمت دون أن تعرف القصة كاملة.

يستطيع القاضي الحكيم أن يفعل ذلك. أحياناً يكون القانون واضحاً ويجب اتباعه.

لكن أحكم القضاة يعرفون الفرق بين قضية انتهت — وقصة لم تنتهِ.`,
        },
      lesson: { en: "The law can be clear and still leave questions unanswered. The wisest judgements address not just what is legal — but what is true.", ar: "يمكن أن يكون القانون واضحاً ومع ذلك يترك أسئلة دون إجابة. أحكم القرارات لا تعالج ما هو قانوني فحسب — بل ما هو حقيقي." },
      lessonIcon: '⚖️',
    },

    // ── NODE 4b — ASKS THE QUESTION ────────────────────────────
    // Judge asks why Tariq refused twice. The answer changes everything.
    // Second fork: mercy or strict justice.
    // ──────────────────────────────────────────────────────────
    twist: {
      scene: 'village_day',
      text: {
        en: `"Tariq," you say.

He looks up.

"Kareem says you were offered the business twice and refused. Is that true?"

The courtroom goes very still.

Tariq is quiet for a long moment. The anger in his face does something complicated — it doesn't disappear, but something underneath it shifts.

"Yes," he says finally. "It's true."

"Why?"

Another silence. Longer.

"Because I didn't want it," he says. "I never wanted it. I hated the warehouses. I hated the trade routes. I hated the smell of the spices. I left this city when I was eighteen because I wanted to paint. I am a painter. I have lived in Cairo for five years painting portraits."

He stops.

"My father never accepted it. Every time I came back, he tried to give me the business. Twice I said no. We argued. The last time I saw him alive — " his voice breaks slightly — "we were still arguing about it."

The courtroom is silent.

"Then why are you here?" you ask quietly. "If you didn't want the business — why contest the will?"

Tariq looks at his hands.

"Because he left me nothing," he says. "Not nothing as in — I wanted the warehouses. Nothing as in — he didn't leave me a letter. Not a word. He left everything to the apprentice and he left me silence." He looks up. "I don't want the business. I want to know that my father knew I existed."

The room is very quiet.

Kareem is looking at the floor.

You understand now what this case is actually about.

It was never about money.`,
        ar: `"طارق،" تقول.

يرفع نظره.

"يقول كريم إنك عُرضت عليك التجارة مرتين ورفضت. هل هذا صحيح؟"

تصبح القاعة ساكنة جداً.

يصمت طارق لحظة طويلة. يحدث شيء معقد في وجهه الغاضب — لا يختفي الغضب، لكن شيئاً تحته يتحول.

"نعم،" يقول أخيراً. "هذا صحيح."

"لماذا؟"

صمت آخر. أطول.

"لأنني لم أرده،" يقول. "لم أرده قط. كرهت المستودعات. كرهت طرق التجارة. كرهت رائحة البهارات. غادرت هذه المدينة وعمري ثمانية عشر عاماً لأنني أردت أن أرسم. أنا رسام. عشت في القاهرة خمس سنوات أرسم البورتريهات."

يتوقف.

"لم يقبل أبي هذا قط. في كل مرة عدت فيها، حاول أن يعطيني التجارة. مرتين قلت لا. تجادلنا. آخر مرة رأيته فيها حياً — " ينكسر صوته قليلاً — "كنا لا نزال نتجادل بشأنها."

الصمت يعم القاعة.

"إذن لماذا أنت هنا؟" تسأل بهدوء. "إذا كنت لا تريد التجارة — لماذا تطعن في الوصية؟"

ينظر طارق إلى يديه.

"لأنه لم يترك لي شيئاً،" يقول. "ليس لا شيء بمعنى — أردت المستودعات. لا شيء بمعنى — لم يترك لي رسالة. ولا كلمة. ترك كل شيء للتلميذ وتركني في صمت." يرفع نظره. "لا أريد التجارة. أريد أن أعرف أن أبي كان يعلم أنني موجود."

الغرفة ساكنة جداً.

كريم ينظر إلى الأرض.

تفهم الآن ما هذه القضية فعلاً.

لم تكن يوماً عن المال.`,
      },
      question: {
        en: 'Tariq does not want the business. He wants to know his father saw him. You are still the judge. What do you do?',
        ar: 'طارق لا يريد التجارة. يريد أن يعرف أن أباه رآه. لا تزال القاضي. ماذا تفعل؟',
      },
      choices: [
        { text: { en: '🤝 "I will uphold the will — but I will ask Kareem to honour the father\'s memory in another way."', ar: '🤝 "سأُمضي الوصية — لكنني سأطلب من كريم أن يكرّم ذكرى الأب بطريقة أخرى."' }, next: 'ending_mercy' },
        { text: { en: '⚖️ "The will is the will. My job is the law — not the feelings behind it."', ar: '⚖️ "الوصية هي الوصية. عملي هو القانون — لا المشاعر خلفه."' }, next: 'ending_strict' },
      ],
    },

    // ── ENDING A — mercy ───────────────────────────────────────
    ending_mercy: {
      scene: 'village_evening',
      isEnding: true,
      text: {
        en: `You look at Kareem.

"The will of Yusuf al-Rashid stands," you say. "The business is yours."

Kareem nods.

"But I am asking you something that the law cannot require — only your conscience can." You pause. "Yusuf al-Rashid taught you for six years. He shaped you. You carry his knowledge and his methods and his name in everything you do." You look at him steadily. "In the years ahead, as you run this business — remember where it came from. And perhaps find a way to let his son know that his father spoke of him."

Kareem looks up. Something in his face opens.

"He did," Kareem says quietly. "Master Yusuf spoke of Tariq often. He was proud of the paintings. He had three of them in his office. He just — he didn't know how to say it."

The courtroom is very still.

Tariq is not looking at you. He is looking at Kareem.

"Three paintings?" he says.

"Three," says Kareem. "The harbour at dawn. Two children on a rooftop. And one of your mother."

You watch something shift in the room — something that no court ruling could have moved.

You close the session.

You have ruled on the law. But you have also done something the law alone cannot do — you have given two young men the beginning of a conversation their father never finished.

The wisest judgements don't just end disputes. They make space for what the dispute was really about.`,
        ar: `تنظر إلى كريم.

"وصية يوسف الرشيد ثابتة،" تقول. "التجارة لك."

يومئ كريم.

"لكنني أطلب منك شيئاً لا يستطيع القانون إلزامك به — وعيك الخاص هو الذي يستطيع." تتوقف. "علّمك يوسف الرشيد ست سنوات. شكّلك. تحمل معرفته وأساليبه واسمه في كل ما تفعله." تنظر إليه بثبات. "في السنوات القادمة، وأنت تدير هذه التجارة — تذكّر من أين جاءت. وربما اجد طريقة لتُعلم ابنه أن أباه كان يتكلم عنه."

يرفع كريم نظره. يتفتّح شيء في وجهه.

"كان يفعل،" يقول كريم بهدوء. "كان الأستاذ يوسف يتكلم عن طارق كثيراً. كان فخوراً بلوحاته. كان يملك ثلاثاً منها في مكتبه. فقط — لم يكن يعرف كيف يقوله."

القاعة ساكنة جداً.

طارق لا ينظر إليك. ينظر إلى كريم.

"ثلاث لوحات؟" يقول.

"ثلاث،" يقول كريم. "الميناء عند الفجر. طفلان على سطح. وواحدة لأمك."

تراقب شيئاً يتحول في الغرفة — شيئاً لم يكن بإمكان أي حكم قضائي أن يحرّكه.

تغلق الجلسة.

حكمت بالقانون. لكنك فعلت أيضاً شيئاً لا يستطيع القانون وحده فعله — أعطيت شابّين بداية محادثة لم ينهِها أبوهما قط.

أحكم القرارات لا تنهي النزاعات فحسب. تفتح المجال لما كان النزاع يدور حوله حقاً.`,
      },
      lesson: { en: "The wisest judgements don't just end disputes. They make space for what the dispute was really about.", ar: "أحكم القرارات لا تنهي النزاعات فحسب. تفتح المجال لما كان النزاع يدور حوله حقاً." },
      lessonIcon: '🕊️',
    },

    // ── ENDING B — strict ──────────────────────────────────────
    ending_strict: {
      scene: 'village_evening',
      isEnding: true,
      text: {
        en: `You set the document down on the table.

"The will of Yusuf al-Rashid is legal, witnessed, and written by a man in full health," you say. "The business passes to Kareem. This court is closed."

Tariq stands.

For a moment you think he will argue. But he doesn't. Something in his face has already gone somewhere else — somewhere past anger, into a quieter and more permanent kind of loss.

He walks out.

Kareem holds the document. He does not look happy. He looks like a man who has won something that cost more than he expected.

You made the correct ruling. There is no question of that. The law was clear, the document was sound, and you followed it precisely.

In eleven years as a judge, you have learned that this is sometimes all a judge can do.

The law is not designed to heal every wound. It is designed to be clear, and consistent, and fair to what was written down. It cannot reach into the silence between a father and a son. It cannot recover a conversation that was never had.

You did your job.

That has to be enough.

And yet — on the walk home that evening, you find yourself thinking about what you might have asked. A single question. The question no one asked.

You already know what it would have uncovered.

You chose not to ask it.

That was also a choice.`,
        ar: `تضع الوثيقة على الطاولة.

"وصية يوسف الرشيد قانونية وموثّقة وكُتبت بيد رجل في كامل صحته،" تقول. "التجارة تنتقل إلى كريم. الجلسة منتهية."

يقوم طارق.

للحظة تظن أنه سيحتج. لكنه لا يفعل. ذهب شيء في وجهه إلى مكان آخر — ما وراء الغضب، إلى نوع أهدأ وأكثر ديمومة من الخسارة.

يخرج.

يمسك كريم الوثيقة. لا يبدو سعيداً. يبدو كرجل ربح شيئاً كلّفه أكثر مما توقّع.

أصدرت الحكم الصحيح. لا شك في ذلك. كان القانون واضحاً، والوثيقة سليمة، واتبعتهما بدقة.

في أحد عشر عاماً كقاضٍ، تعلّمت أن هذا أحياناً كل ما يستطيع القاضي فعله.

القانون لم يُصمَّم لشفاء كل جرح. صُمِّم ليكون واضحاً ومتسقاً وعادلاً لما كُتب. لا يستطيع أن يصل إلى الصمت بين أب وابن. لا يستطيع استعادة محادثة لم تحدث قط.

أدّيت عملك.

يجب أن يكفي هذا.

ومع ذلك — في المشي إلى البيت ذلك المساء، تجد نفسك تفكر فيما كان بإمكانك سؤاله. سؤال واحد. السؤال الذي لم يسأله أحد.

تعرف بالفعل ما كان سيكشفه.

اخترت ألا تسأله.

كان ذلك أيضاً خياراً.`,
      },
      lesson: { en: "The law can only reach what was written down. The wisest judges know when to look beyond the document — and when that too is a choice.", ar: "القانون لا يصل إلا إلى ما كُتب. أحكم القضاة يعرفون متى ينظرون ما وراء الوثيقة — ومتى يكون ذلك أيضاً خياراً." },
      lessonIcon: '📜',
    },

  },
};

export default wiseJudge;
