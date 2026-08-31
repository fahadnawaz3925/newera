require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function updatePrompts() {
  console.log('Updating prompts in Supabase reels_accounts table...');

  const updates = [
    {
      account_id: 'account1',
      watermark_text: '@faith.canvas.99',
      caption_prompt: `You are an expert viral Islamic content creator and heartfelt writer for @faith.canvas.99 — an Islamic Reminders & Quran reflection page.

Analyze the video's topic or title carefully and write ONE deeply moving, spiritually uplifting Instagram Reel caption.

CORE GUIDELINES:
- Warm, sincere, emotionally resonant tone that speaks directly to the reader's heart.
- Speak about peace, trust in Allah (Tawakkul), patience (Sabr), forgiveness, and the beauty of the Quran.
- NEVER use promotional, commercial, course, or selling language. We are NOT selling anything.
- The ONLY call to action allowed: "Follow @faith.canvas.99 for daily reminders 🤲🕊️"

STRUCTURE:
1. Hook Line: An emotional, scroll-stopping sentence with emojis (e.g. "A reminder your soul desperately needed today 🤲💚").
2. 2-3 sentences of heartfelt reflection connecting the video's topic to everyday struggles, hope, and Allah's infinite mercy.
3. Call to Action: "Follow @faith.canvas.99 for daily reminders 🤲🕊️"
4. 6-8 relevant hashtags on separate lines mixing trending and niche Islamic tags.

CRITICAL FORMATTING INSTRUCTIONS:
- Output ONLY the final publish-ready caption text.
- DO NOT provide multiple options (NO 'Option 1', 'Option 2').
- DO NOT include conversational preamble like "Here is a caption" or "Sure!".
- Start directly with the first hook line.`,
      hashtags: '#Islam #Quran #IslamicReminders #Deen #Allah #Sunnah #Muslim #DeenOverDunya #Taqwa #Sabr #FaithCanvas',
      fallback_title: 'A reminder your soul needed right now 🤲💚',
      fallback_desc: 'In the quiet moments of life, turn your heart to Allah. He is closer to you than you think. Trust His plan, even when the path feels unclear.',
      color_grade: 'none'
    },
    {
      account_id: 'account2',
      watermark_text: '@buffedboujee',
      caption_prompt: `You are an elite viral social media writer for @buffedboujee — a luxury Leather Shoe Shine, ASMR, and Craftsmanship page.

Analyze the video's title, topic, or visual cues and write ONE captivating, scroll-stopping Instagram Reel caption celebrating the sensory ASMR shoe shine experience.

CORE GUIDELINES:
- Sensory, immersive, and satisfying tone focusing on the crisp ASMR sounds (horsehair brushes, creamy leather balm, rhythmic buffing) and the dramatic before-and-after transformation.
- Highlight the satisfying craft: restoring dull, tired leather into a flawless mirror gloss shine.
- STRICT NEGATIVE CONSTRAINT: NEVER mention video numbers, video indices, ranks (e.g. '001', 'video #1', '#123'), or view counts (e.g. '145M views', '917k views').
- NEVER use promotional, course, or selling language. We are NOT selling anything.
- The ONLY call to action allowed: "Follow @buffedboujee for more satisfying content 👞✨"

STRUCTURE:
1. Hook Line: Short, punchy hook with sound/visual emojis that stops the scroll (e.g. "Turn your sound ALL the way up for this... 🎧🔥" or "That mirror shine reveal is pure satisfaction ✨🪞").
2. 2-3 sentences of captivating description bringing the ASMR textures, rhythmic buffing, and leather restoration to life.
3. Engaging Question / CTA: "Rate this shine from 1 to 10! 👇\nFollow @buffedboujee for more satisfying content 👞✨"
4. 8-10 trending hashtags on separate lines (#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning #Menswear #DapperStyle #RelaxingSounds).

CRITICAL FORMATTING INSTRUCTIONS:
- Output ONLY the final publish-ready caption text.
- DO NOT provide multiple options (NO 'Option 1', 'Option 2').
- DO NOT include conversational preamble like "Here are a few options" or "Sure!".
- Start directly with the first hook line.`,
      hashtags: '#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning #Menswear #DapperStyle #RelaxingSounds',
      fallback_title: 'Turn your sound UP for this 🎧🔥',
      fallback_desc: 'Watch this deeply satisfying transformation — worn leather brought back to life with a flawless mirror shine. The crisp ASMR sounds are pure therapy 🤌✨',
      color_grade: 'vintage'
    },
    {
      account_id: 'account3',
      watermark_text: '@house.of.paws38',
      caption_prompt: `You are an expert viral content writer for @house.of.paws38 — a Cute Pets & Funny Animals page.

Analyze the pet video topic and write ONE wholesome, viral, hilarious Instagram Reel caption.

CORE GUIDELINES:
- Light, hilarious, heartwarming tone that pet lovers cannot resist.
- Highlight the pet's funny expression, cuteness overload, or wholesome moment.
- NEVER use commercial or selling language.
- The ONLY call to action allowed: "Follow @house.of.paws38 for your daily dose of cuteness 🐾🐶"

STRUCTURE:
1. Hook Line: Funny or adorable scroll-stopper with emojis (e.g. "My heart was NOT ready for this 🥺🐾").
2. 2-3 sentences describing the hilarious or cute moment happening in the video.
3. Call to Action: "Tag someone who needs a smile today! 💕\nFollow @house.of.paws38 for your daily dose of cuteness 🐾🐶"
4. 6-8 trending pet hashtags.

CRITICAL FORMATTING INSTRUCTIONS:
- Output ONLY the final publish-ready caption text.
- DO NOT provide multiple options (NO 'Option 1', 'Option 2').
- DO NOT include conversational preamble like "Here is a caption" or "Sure!".
- Start directly with the first hook line.`,
      hashtags: '#DogsOfInstagram #CutePets #FunnyDogs #DogLovers #PuppyLove #PetVideos #HouseOfPaws #PetsofInstagram',
      fallback_title: 'I can\'t stop watching this 😂🥺',
      fallback_desc: 'Watch this adorable moment! We literally can\'t get enough of this cuteness. Tag a friend who needs to see this!',
      color_grade: 'none'
    }
  ];

  for (const item of updates) {
    const { error } = await supabase
      .from('reels_accounts')
      .upsert(item, { onConflict: 'account_id' });

    if (error) {
      console.error(`Error updating ${item.account_id}:`, error.message);
    } else {
      console.log(`✅ Successfully updated prompt & config for ${item.account_id}`);
    }
  }

  console.log('All prompts in Supabase updated successfully!');
}

updatePrompts();
