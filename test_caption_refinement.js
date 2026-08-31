require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

function cleanVideoTitle(rawTitle) {
  if (!rawTitle) return '';
  let title = rawTitle;
  try {
    title = decodeURIComponent(title);
  } catch (e) {}

  title = title.replace(/\.[a-zA-Z0-9]+$/i, '');
  title = title.replace(/^.*[\\\/]/, '');
  title = title.replace(/[_-]?\[[a-zA-Z0-9_-]+\]/gi, '');
  title = title.replace(/\[[a-zA-Z0-9_-]+\]/gi, '');
  title = title.replace(/^\d+[\s_+%-]*/, '');
  title = title.replace(/^\d+[a-zA-Z_]+[\s_+%-]*/, '');
  title = title.replace(/\[\s*\d+(\.\d+)?[KMBkmb]?[\s_-]*views?\s*\]/gi, '');
  title = title.replace(/\(\s*\d+(\.\d+)?[KMBkmb]?[\s_-]*views?\s*\)/gi, '');
  title = title.replace(/\b\d+(\.\d+)?[KMBkmb]?\s*views?\b/gi, '');
  title = title.replace(/\b\d+(\.\d+)?[KMBkmb]\b/gi, '');
  title = title.replace(/\[.*?\]/g, '');
  title = title.replace(/\(.*?\)/g, '');
  title = title.replace(/#[a-zA-Z0-9_]+/g, '');
  title = title.replace(/[|l_]+/g, ' ');
  title = title.replace(/[-]{2,}/g, ' ');
  title = title.replace(/\s+/g, ' ').trim();
  title = title.replace(/^[^a-zA-Z0-9\u00C0-\u024F\u0600-\u06FF]+/, '').trim();
  title = title.replace(/[^a-zA-Z0-9\u00C0-\u024F\u0600-\u06FF\s.!?]+$/, '').trim();

  return title;
}

function cleanAndSanitizeCaption(rawText, targetAccount) {
  if (!rawText) return '';
  let text = rawText.trim();

  if (/option\s*1\b/i.test(text)) {
    const optMatch = text.match(/(?:(?:\*{1,3}|#{1,6})?\s*Option\s*1[^\n]*\n+)([\s\S]*?)(?=(?:\*{1,3}|#{1,6})?\s*Option\s*2\b|\Z)/i);
    if (optMatch && optMatch[1] && optMatch[1].trim().length > 30) {
      text = optMatch[1].trim();
    }
  }

  text = text.replace(/^(?:Here (?:is|are)[^\n]*|Sure[^\n]*|Certainly[^\n]*|Depending on the vibe[^\n]*|Caption:?)[^\n]*\n+/im, '');
  text = text.replace(/^(?:Here (?:is|are)[^\n]*|Sure[^\n]*|Certainly[^\n]*|Depending on the vibe[^\n]*|Caption:?)[^\n]*\n+/im, '');
  text = text.replace(/^\s*(?:\*{1,3}|#{1,6})\s*(?:Hook|Caption|Description|Body|Call to Action|CTA|Hashtags|Option \d+)[^\n]*\n+/gim, '');
  text = text.replace(/\*\*(?:Hook|Caption|Description|Body|Call to Action|CTA|Hashtags):\*\*\s*/gi, '');
  text = text.replace(/\n+(?:Hope this helps|Let me know|Enjoy|Feel free to ask)[^\n]*$/i, '');
  text = text.replace(/```[\s\S]*?```/g, '').replace(/^#{1,6}\s+/gm, '').trim();
  text = text.replace(/\s*[-=_]{3,}\s*$/g, '').trim();
  text = text.replace(/\[\s*\d+(\.\d+)?[KMBkmb]?[\s_-]*views?\s*\]/gi, '');
  text = text.replace(/\b\d+(\.\d+)?[KMBkmb]?\s*views?\b/gi, '');
  text = text.replace(/(?:video|reel|clip|part|rank)\s*#?\s*\d+\b/gi, '');
  text = text.replace(/^\d+[\s_+%-]+/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

async function testGeneration() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY
  ].filter(Boolean);

  const rawTitles = [
    '082_[917.0K_views]_ASMR Shoe SHİNING✨✨✨ #asmr #restoration_[xyz].mp4',
    '001_[145.0M_views]_UNBELIEVABLE Shoe Shine EXPERIENCE l Shoe Shine ASMR #satisfying #shoe_[Tv5SuU9dw9U].mp4'
  ];

  const models = [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest'
  ];

  const systemInstruction = "You are an expert viral social media manager. Output EXACTLY ONE final, ready-to-publish Instagram Reel caption. NEVER output video numbers (e.g. '001', 'video #1') or view counts (e.g. '145M views'). NEVER output multiple options. Start directly with the hook line.";

  for (const raw of rawTitles) {
    const cleaned = cleanVideoTitle(raw);
    console.log(`\n========================================`);
    console.log(`Raw: "${raw}"`);
    console.log(`Cleaned: "${cleaned}"`);
    console.log(`========================================`);

    const prompt = `Video Topic / Focus: "${cleaned}"

You are an elite viral social media writer for @buffedboujee — a luxury Leather Shoe Shine, ASMR, and Craftsmanship page.

Analyze the video's title, topic, or visual cues and write ONE captivating, scroll-stopping Instagram Reel caption celebrating the sensory ASMR shoe shine experience.

CORE GUIDELINES:
- Sensory, immersive, and satisfying tone focusing on the crisp ASMR sounds (horsehair brushes, creamy leather balm, rhythmic buffing) and the dramatic before-and-after transformation.
- Highlight the satisfying craft: restoring dull, tired leather into a flawless mirror gloss shine.
- STRICT NEGATIVE CONSTRAINT: NEVER mention video numbers, video indices, ranks (e.g. '001', 'video #1', '#123'), or view counts (e.g. '145M views', '917k views').
- The ONLY call to action allowed: "Follow @buffedboujee for more satisfying content 👞✨"

STRUCTURE:
1. Hook Line: Short, punchy hook with sound/visual emojis that stops the scroll (e.g. "Turn your sound ALL the way up for this... 🎧🔥" or "That mirror shine reveal is pure satisfaction ✨🪞").
2. 2-3 sentences of captivating description bringing the ASMR textures, rhythmic buffing, and leather restoration to life.
3. Engaging Question / CTA: "Rate this shine from 1 to 10! 👇\nFollow @buffedboujee for more satisfying content 👞✨"
4. 8-10 trending hashtags on separate lines (#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning #Menswear #DapperStyle #RelaxingSounds).

CRITICAL FORMATTING INSTRUCTIONS:
- Output ONLY the final publish-ready caption text.
- Start directly with the first hook line.`;

    let done = false;
    for (const key of keys) {
      if (done) break;
      const genAI = new GoogleGenerativeAI(key);
      for (const m of models) {
        if (done) break;
        try {
          const model = genAI.getGenerativeModel({ model: m, systemInstruction });
          const res = await model.generateContent(prompt);
          const text = res.response.text();
          const finalCaption = cleanAndSanitizeCaption(text, 'account2');
          console.log(`✅ [Generated with ${m}]:\n${finalCaption}`);
          done = true;
        } catch (e) {
          // fallback to next model
        }
      }
    }
  }
}

testGeneration();
