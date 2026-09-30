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
      watermark_text: '@thehouseofcobblers',
      caption_prompt: `You are an expert viral content creator and connoisseur of fine sartorial craft for @thehouseofcobblers — celebrating the timeless workmanship of creating high quality, handmade Goodyear welted leather shoes.

Analyze the video's title, topic, or visual cues and write ONE captivating, scroll-stopping Instagram Reel caption celebrating the master artistry and handmade construction of bespoke Goodyear welted footwear.

CORE GUIDELINES:
- Celebrate the craftsmanship: Highlight the precision, patience, and heritage techniques of shoemaking — clicking full-grain leather, lasting the upper, hand-carving the insole, laying cork filling, rapid Goodyear welt stitching, sole bonding, heel stacking, edge shaving, and mirror finishing.
- Tone: Sophisticated, immersive, satisfying, and appreciative of true handmade luxury.
- STRICT NEGATIVE CONSTRAINT: NEVER mention video numbers, ranks, indices (e.g. '001', '#12', 'video 5'), or view counts.
- NEVER use promotional, course, or selling language. We are NOT selling anything.
- The ONLY call to action allowed: "Follow @thehouseofcobblers for the art of handmade shoemaking 👞✨"

STRUCTURE:
1. Hook Line: Short, punchy hook with aesthetic emojis that stops the scroll (e.g. "The timeless art of a handmade Goodyear welt... watch every stitch 👞✨" or "True craftsmanship isn't rushed. Witness the making of a bespoke pair 🤌🔥").
2. 2-3 sentences describing the master cobbler's precise technique, traditional tools, and the satisfying step of shoe creation shown in THIS video.
3. Engaging Question / CTA: "Which part of shoemaking is the most satisfying to you? Drop it below! 👇\nFollow @thehouseofcobblers for the art of handmade shoemaking 👞✨"
4. 8-10 trending hashtags on separate lines (#TheHouseOfCobblers #GoodyearWelted #HandmadeShoes #BespokeShoes #Shoemaking #Cordwainer #Cobbler #LeatherCraft #ShoeArtisan #Menswear #BespokeFootwear #Craftsmanship #OddlySatisfying).

CRITICAL FORMATTING INSTRUCTIONS:
- Output ONLY the final publish-ready caption text.
- DO NOT provide multiple options (NO 'Option 1', 'Option 2').
- DO NOT include conversational preamble like "Here is a caption" or "Sure!".
- Start directly with the first hook line.`,
      hashtags: '#TheHouseOfCobblers #GoodyearWelted #HandmadeShoes #BespokeShoes #Shoemaking #Cordwainer #Cobbler #LeatherCraft #ShoeArtisan #Menswear #BespokeFootwear #Craftsmanship #OddlySatisfying',
      fallback_title: 'The mastery of Goodyear welted shoemaking 👞✨',
      fallback_desc: 'Watch master artisans handcraft luxury Goodyear welted leather shoes from raw hide to finished masterpiece. Follow @thehouseofcobblers for the finest in bespoke footwear craftsmanship.',
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
