const lionAndHare = {
  id: 'lion-and-hare',
  title: 'The Lion and the Hare',
  description: 'A tiny hare uses wit to free the forest from a fearsome lion. Can cleverness defeat raw power?',
  theme: 'Wisdom conquers Strength',
  age: '6+',
  duration: '8–12 min',
  emoji: '🦁',
  color: '#f87171',
  book: 'Panchatantra — Book I',
  progressSteps: ['start', 'lion_accepts', 'hare_plan', 'well_trick', 'ending_wisdom'],

  nodes: {
    start: {
      scene: 'forest_day',
      text: `In the great forest of Vindhya, there lived a mighty lion named Bhasuraka. Every day, he would hunt and kill many animals — far more than he could eat. The animals lived in constant fear.\n\nOne day, all the forest animals gathered together under the old banyan tree. The deer, rabbits, elephants, monkeys, and birds all spoke with one voice:\n\n"O mighty lion! We will send you one animal each day as your meal. In return, please stop the needless killing. The forest is becoming empty!"`,
      question: "The lion thinks about the animals' offer. What do YOU think the lion should do?",
      choices: [
        { text: '🤝 Accept the deal — steady meals sound good!', next: 'lion_accepts' },
        { text: '😤 Refuse! A king hunts what he wants, when he wants!', next: 'lion_refuses' },
      ],
    },
    lion_accepts: {
      scene: 'forest_evening',
      text: `The lion Bhasuraka stroked his mane thoughtfully. "Very well," he roared. "Send me one animal each day, and I shall spare the rest."\n\nThe animals were relieved. Days passed peacefully. Then came the turn of a small, clever hare named Sthirajeevi. The other animals looked at him with sad eyes.\n\n"Little hare, today is your day," they said.\n\nSthirajeevi smiled calmly. "Do not worry, friends. Leave this to me. I have a plan."`,
      question: "The hare walks slowly toward the lion's den, arriving very late. What is he planning?",
      choices: [
        { text: "🧠 He wants to make the lion angry first — that's part of the plan!", next: 'hare_plan' },
        { text: '😰 He\'s scared and trying to delay the inevitable...', next: 'hare_delay' },
      ],
    },
    lion_refuses: {
      scene: 'forest_dark',
      isAlternate: true,
      text: `"SILENCE!" roared the lion. "I am the king! I hunt as I please!"\n\nThe animals scattered in fear. Days passed, and Bhasuraka continued his rampage. Soon, the deer were gone. Then the smaller animals. The forest grew quiet and empty.\n\nWith no prey left, the lion grew hungry. Very hungry. He wandered alone in a silent, barren forest.\n\n"Where have all the animals gone?" he wondered.\n\nThen he realized — he had destroyed the very kingdom he ruled. A king who does not protect his subjects has no kingdom at all.`,
      question: 'The lion sits alone, hungry and surrounded by silence. What lesson has he learned?',
      choices: [
        { text: '👑 A true king protects his people — power without wisdom destroys itself', next: 'lesson_king' },
        { text: '🌿 The forest will recover if I leave now and find new territory', next: 'lesson_escape' },
      ],
    },
    hare_delay: {
      scene: 'forest_path',
      isAlternate: true,
      text: `"Poor little hare," thought the animals, watching him shuffle away.\n\nBut Sthirajeevi WAS scared — and he let that fear drive him to simply run and hide deep in the jungle.\n\nThe lion waited. And waited. His anger grew like a storm. When no animal arrived, he went on a killing rampage worse than before.\n\nThe other animals paid the price for the hare's cowardice.\n\nThat night, Sthirajeevi heard the cries of his friends and felt the weight of his choice. Running away from a problem rarely makes it disappear — it often makes it worse.`,
      question: 'Sthirajeevi feels terrible. What should he do now?',
      choices: [
        { text: '💪 Face the lion with a plan — courage and cleverness together', next: 'hare_plan' },
        { text: "😢 It's too late now... just hide forever", next: 'lesson_cowardice' },
      ],
    },
    hare_plan: {
      scene: 'lions_den',
      text: `Sthirajeevi arrived at the lion's den looking calm despite arriving hours late.\n\n"WHERE HAVE YOU BEEN?!" bellowed Bhasuraka, shaking the ground.\n\n"O Great King," said the hare with a deep bow. "I was on my way when ANOTHER lion stopped me! He is huge, bigger than you, and he said — YOU are not the real king of this forest! HE is!"\n\nThe lion's eyes went wide with fury. "WHAT?! Show me this imposter immediately!"\n\n"Follow me, Your Majesty," said the tiny hare, leading the enormous lion through the forest...`,
      question: 'The hare leads the lion to a deep, still well. What happens next?',
      choices: [
        { text: "🪞 The lion sees his own reflection and thinks it's the other lion!", next: 'well_trick' },
        { text: '🏃 The hare runs away — it was just a trick to escape!', next: 'hare_escape' },
      ],
    },
    well_trick: {
      scene: 'well',
      text: `The hare stopped at the edge of a deep well. "There, O King! Look inside — the other lion lurks in there!"\n\nBhasuraka peered into the well. In the still water below, he saw a huge lion staring back — growling, snarling, ready to fight.\n\n(It was, of course, his own reflection.)\n\n"RAAAARGH!" roared Bhasuraka, and the reflection roared back!\n\n"I'll destroy you!" he bellowed — and leaped headfirst into the well.\n\nSPLASH.\n\nThe great roars faded. The forest fell silent. Then, slowly, the sounds of life returned — birds singing, deer running freely, creatures no longer afraid.`,
      question: "The animals celebrate their freedom! But the young ones ask — was it RIGHT to trick the lion?",
      choices: [
        { text: '✅ Yes! When a tyrant cannot be reasoned with, clever action saves many lives', next: 'ending_wisdom' },
        { text: "🤔 Maybe... but couldn't the hare have found a more peaceful solution?", next: 'ending_reflect' },
      ],
    },
    hare_escape: {
      scene: 'forest_evening',
      isAlternate: true,
      text: `The hare bolted into the bushes!\n\nBut the lion was fast. He caught up and cornered Sthirajeevi against a rocky cliff.\n\n"You thought you could trick ME?!" the lion snarled.\n\nThe hare's heart pounded. He looked left — rocks. He looked right — the lion. Then he looked down... and saw the deep well just three steps away.\n\n"Wait, wait, wait!" said the hare. "I wasn't running away! I was leading you here — the other lion IS real, look into that well!"\n\nThe lion hesitated... then looked.`,
      question: 'The lion looks into the well and sees his reflection roaring back. What does he do?',
      choices: [
        { text: "🦁 He leaps into the well to destroy the 'other lion'!", next: 'ending_wisdom' },
        { text: "🧐 He pauses — realizes it's a trick — and a wise conversation follows", next: 'lion_wise' },
      ],
    },
    lion_wise: {
      scene: 'lions_den',
      isAlternate: true,
      text: `The lion stared at the hare. Then... slowly... he began to laugh. A deep, rumbling, genuine laugh.\n\n"You are clever, little one. Very clever indeed." He sat down heavily. "I have been killing and killing, and I never once thought about what I was destroying."\n\nThe hare, trembling but brave, sat before the lion. "Great King, you have strength no one can match. But strength guided by wisdom — that is what makes a true king."\n\nThe lion was quiet for a long time. Then he nodded.`,
      question: 'A lion who listens — what happens next in the forest?',
      choices: [
        { text: '🌟 The lion becomes a just ruler and the forest flourishes!', next: 'ending_wisdom' },
        { text: '🤝 Lion and hare become unlikely friends and advisors to each other', next: 'ending_reflect' },
      ],
    },
    lesson_king: {
      scene: 'forest_dawn', isAlternate: true, isEnding: true,
      text: `The lion wandered to a new forest, carrying the heavy lesson in his heart.\n\nYears later, the animals of Vindhya heard a story of a lion in another forest — one who protected his subjects, hunted only what he needed, whose roar meant safety rather than fear.\n\nNitishastra teaches us: "A king's greatest strength is not his claws, but his wisdom. Power used without restraint destroys the very kingdom it seeks to rule."`,
      lesson: 'A ruler who does not care for those under him will have no one left to rule.',
      lessonIcon: '👑',
    },
    lesson_escape: {
      scene: 'forest_dark', isAlternate: true, isEnding: true,
      text: `The lion left for new lands... and the same pattern repeated. He hunted without thought, and the new forest too grew empty.\n\nSome lessons must be fully learned, not escaped from.\n\nThe wise elders would say: "A fish that jumps from one pond to another without changing its ways will make every pond the same."`,
      lesson: "Changing your place doesn't change your nature. True growth comes from within.",
      lessonIcon: '🌱',
    },
    lesson_cowardice: {
      scene: 'forest_dark', isAlternate: true, isEnding: true,
      text: `The hare hid for the rest of his days, haunted by what might have been.\n\nThe forest suffered. Animals lived in fear. And Sthirajeevi, who had a gift for cleverness, let it go to waste.\n\nNitishastra teaches: "A lamp that refuses to burn for fear of being blown out helps no one. Better to burn and be extinguished than to leave the world in darkness."\n\nCourage is not the absence of fear — it is acting wisely DESPITE fear.`,
      lesson: 'Hiding from a problem out of fear is itself a choice — and often the worst one.',
      lessonIcon: '🕯️',
    },
    ending_wisdom: {
      scene: 'forest_dawn', isEnding: true,
      text: `The forest of Vindhya bloomed with new life. Animals grazed without fear. Birds filled the trees with song. Even the trees seemed to stand taller.\n\nAnd the story of the small hare who outwitted the great lion was told for generations — not as a story of weakness defeating strength, but of WISDOM guiding the world toward peace.\n\nAs the Panchatantra teaches:\n"One who has wisdom has everything.\nOne who lacks wisdom, even strength becomes his downfall."`,
      lesson: "True intelligence is not just knowing things — it's using what you know to protect others and bring peace.",
      lessonIcon: '🌟',
    },
    ending_reflect: {
      scene: 'forest_dawn', isEnding: true,
      text: `The wise owl of the forest, watching everything from a high branch, later told the young ones:\n\n"There is rarely only one right path. The hare's cleverness saved lives — that is true. But a world where wisdom and strength can speak to each other is more beautiful still."\n\nThe young ones argued and discussed long into the night. And that, said the owl, was the real gift of the Panchatantra — not just stories, but the wisdom to keep asking better questions.`,
      lesson: "Great stories don't just give you answers — they teach you to ask better questions.",
      lessonIcon: '🦉',
    },
  },
};

export default lionAndHare;
