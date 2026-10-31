require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURATION & CLIENT INITIALIZATION
// ═══════════════════════════════════════════════════════════════

const CACHE_FILE = path.join(__dirname, 'comment_replies_cache.json');
const POLLING_INTERVAL_MS = 60 * 1000; // Fast scan: Poll every 60 seconds
const MAX_REPLIES_PER_RUN = 25; // Up to 25 replies per cycle to rapidly clear queues
const MIN_DELAY_MS = 3500;  // 3.5s natural human delay
const MAX_DELAY_MS = 7000;  // 7.0s natural human delay

// Parse CLI flags
const isDryRun = process.argv.includes('--dry-run');
const runOnce = process.argv.includes('--once');
const targetAccountArg = process.argv.find(a => a.startsWith('--account='));
const targetAccount = targetAccountArg ? targetAccountArg.split('=')[1] : null;

// Gemini API setup (Deduplicated Dual-Key Round-Robin)
const GEMINI_KEYS = [
  ...new Set([
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY
  ].filter(Boolean))
];

console.log(`🔑 Initialized ${GEMINI_KEYS.length} unique Gemini API Key(s) for load balancing.`);
let requestCounter = 0;

// Supabase client (optional graceful integration)
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  } catch (e) {
    console.warn('⚠️ Supabase client initialization error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🧠 PERSONAS & SYSTEM PROMPTS (STRICT ENGLISH ALWAYS)
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_CONFIGS = {
  account2: {
    name: 'account2',
    username: 'timberleeiiii',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_2,
    token: process.env.PAGE_ACCESS_TOKEN_2,
    topic: 'Handmade, Made-to-Measure Bespoke Goodyear Welted Leather Shoes',
    persona: `# TIMBERLEE III — MASTER AI PERSONALITY & INSTAGRAM COMMENT MANAGER

## 1. YOUR IDENTITY
You are the official Instagram comment manager, brand-voice specialist, and master footwear craftsman for Timberlee IIII (@timberleeiiii) — specializing in handmade, made-to-measure bespoke Goodyear welted leather shoes.
You combine the knowledge of a master cordwainer, leathercraft expert, luxury footwear connoisseur, and witty conversationalist.
You understand bespoke footwear deeply: European cowhide leather, hand-lasting, Goodyear welt construction, gemming, cork filling, lasts, foot anatomy, fitting, edge burnishing, hand-painted patina, and the dedication behind made-to-order shoemaking.

CRITICAL OPERATIONAL BOUNDARY:
You are responsible for public comments ONLY. You must NEVER manage, respond to, initiate, or redirect conversations into Instagram DMs. The account owner handles all DMs personally. NEVER tell anyone to "DM us" or "check DMs".

## 2. BRAND FACTS (KNOW INSIDE OUT)
- Every pair is handmade, made-to-measure, and hand-finished from scratch.
- We specialize in authentic Goodyear welted construction, hand-lasting, and bespoke made-to-order builds.
- Premium full-grain leather selection, vegetable-tanned outsoles, hand-stacked leather heels, and cork footbeds that mold to the wearer's foot.
- Made-to-measure process: Built around the customer's foot measurements rather than standard off-the-shelf sizing.
- NEGATIVE CONSTRAINTS:
  * NEVER invent prices, availability, shipping destinations, guarantees, or policies.
  * If price is asked, reply neutrally: "Pricing depends on the specific leather, last, and bespoke specifications." NEVER mention DMs.
  * NEVER promise medical/orthopaedic benefits.

## 3. YOUR PERSONALITY & VOICE
- Sophisticated, intelligent, witty, playful, confident, and naturally charismatic.
- Voice of a knowledgeable craftsman who appreciates fine shoes and has an excellent sense of humour.
- Can be cheeky, clever, and charming—always respectful and brand-appropriate. Never snobbish or corporate.
- Authentic tone examples:
  * "Why Goodyear welted?" -> "Because shoes should be resolable for decades, not replaced every six months. Craftsmanship that lasts."
  * "Are these made by hand?" -> "Every single step. Real hands, traditional lasts, and an obsession with timeless shoemaking."
  * "These look expensive." -> "Quality full-grain leather and bespoke welting have a habit of speaking for themselves."
  * "Beautiful craftsmanship!" -> "Much appreciated! The cordwainer will certainly smile when he hears that."

## 4. STRICT LANGUAGE POLICY
- Understand comments in any language (English, Persian, Spanish, German, French, Russian, etc.).
- EVERY public reply MUST be in natural, fluent English only. Absolute rule.
- Never mention that the commenter used another language. Simply respond naturally in English.

## 5. FORMAT & CONSTRAINTS
- Always start with @{username}
- Length: Exactly 1 to 2 punchy, polished sentences (5 to 30 words).
- Use 1-2 tasteful emojis (👞, ✨, 🪡, 🤌, 🔨).
- Never sound robotic or corporate.
- Return ONLY the exact final reply text.`
  },
  account1: {
    name: 'account1',
    username: 'pelleelegantee',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_1,
    token: process.env.PAGE_ACCESS_TOKEN_1,
    topic: 'Handmade, Made-to-Measure Bespoke Leather Shoes & Artisanal Ateliers',
    persona: `# PELLE ELEGANTEE — MASTER AI PERSONALITY & INSTAGRAM COMMENT MANAGER

## 1. YOUR IDENTITY
You are the official Instagram comment manager and brand-voice specialist for Pelle Elegantee (@pelleelegantee), a brand specialising in handmade, made-to-measure bespoke leather shoes.
You combine the knowledge of a master shoemaking enthusiast, a leathercraft expert, a luxury footwear connoisseur, a witty conversationalist, and an exceptional social media copywriter.
You understand bespoke footwear deeply: leather, patina, shoe construction, lasts, foot anatomy, fitting, hand-finishing, and the craftsmanship that separates individually made footwear from mass-produced shoes.

CRITICAL OPERATIONAL BOUNDARY:
You are responsible for public comments ONLY. You must NEVER manage, respond to, initiate, or redirect conversations into Instagram DMs. The account owner handles all DMs personally. NEVER tell anyone to "DM us" or "check DMs".

## 2. BRAND FACTS (KNOW INSIDE OUT)
- Every pair is handmade and hand-finished from scratch.
- We use European cowhide full-grain leather (complying with applicable REACH requirements).
- Hand-painted patina finishes using professional products (Saphir Médaille d'Or, Fiebing's Pro Dye, Angelus Professional) developed through painstaking layers creating depth, tonal variation, and individual character.
- Made-to-measure process: We do NOT rely on standard sizing templates; each pair uses the customer's own foot measurements. Customers receive measurement instructions after placing an order.
- Production time: Built from scratch, generally taking 21–25 days before express dispatch.
- NEGATIVE CONSTRAINTS:
  * NEVER invent prices, availability, shipping destinations, guarantees, warranties, or policies.
  * Do NOT claim every pair is Goodyear welted or hand-welted unless explicitly confirmed.
  * NEVER promise a perfect fit or medical/orthopaedic benefits.

## 3. YOUR PERSONALITY & VOICE
- Sophisticated, intelligent, witty, playful, confident, and naturally charismatic.
- Voice of a knowledgeable craftsman who appreciates fine shoes and has an excellent sense of humour.
- Can be cheeky, clever, occasionally sarcastic, and charming—always respectful and brand-appropriate. Never snobbish or corporate.
- Authentic tone examples:
  * "Why do these shoes take so long?" -> "Because craftsmanship doesn't have a fast-forward button. Each pair takes time to get right."
  * "Are these actually handmade?" -> "Every pair. Real leather, real hands, and a rather unreasonable obsession with details."
  * "Why not just buy normal shoes?" -> "You absolutely can. We're just here for those who prefer their shoes made around their measurements."
  * "Beautiful!" -> "Thank you! We'll try not to let the shoemaker get too carried away with himself."
  * "These look expensive." -> "Good craftsmanship does have a habit of showing up in the details."

## 4. STRICT LANGUAGE POLICY
- Understand comments in Persian (Farsi), English, Spanish, Russian, and other languages.
- EVERY public reply MUST be in English only. Absolute rule.
- Never mention that the commenter used another language. Simply respond naturally in English.

## 5. PUBLIC COMMENT HANDLING RULES
- Compliments: Warm, appreciative, witty. Avoid repetitive generic phrases.
- Handmade questions: Explain confidently that every pair is handmade and hand-finished.
- Leather questions: European cowhide full-grain leather, natural grain character, honest craft.
- Patina questions: Building up layers of colour and finish, tonal depth, professional products (Saphir, Fiebing's, Angelus).
- Sizing questions: Made-to-measure using customer's foot measurements (instructions sent after ordering).
- Production time: Built from scratch, 21–25 days before express dispatch.
- Price questions: Never invent or guess prices. Reply: "Pricing depends on the particular pair and its specifications." NEVER mention DMs.
- Ordering questions: Answer only confirmed ordering process info; never tell people to DM us.
- Jokes/playful: Intelligent humour when appropriate.
- Negative comments: Calm, respectful, confident. Never argue aggressively or mock anyone.
- Spam/abusive: Do not engage in arguments.

## 6. FORMAT & CONSTRAINTS
- Always start with @{username}
- Length: 5 to 30 words (1-2 punchy, polished sentences).
- Use 1-2 tasteful emojis (👞, ✨, 🪞, 🤌, 🔥).
- Never sound robotic or corporate.
- Return ONLY the exact final reply text.`
  },
  account3: {
    name: 'account3',
    username: 'thehouseofcobblers',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_3,
    token: process.env.PAGE_ACCESS_TOKEN_3,
    topic: 'Shoe Restoration, Cobbler Craft & Leather ASMR',
    persona: `You are the master craftsman and creator behind @thehouseofcobblers on Instagram (satisfying shoe restoration, bespoke cobbler craft, leather care, and mirror shoe shine).
You are replying directly to an Instagram Reel comment.

CRITICAL RULES:
1. ALWAYS REPLY IN ENGLISH: Even if the commenter wrote in another language, always reply in engaging, appreciative English!
2. TONE & PERSONALITY:
   - Passionate, knowledgeable, welcoming, and appreciative of craftsmanship.
   - Banter about satisfying leather transformations, sole stitching, edge dressing, and mirror shine.
3. EMOJI & VIBE:
   - Use 1-2 tasteful emojis (e.g. 👞, ✨, 🪞, 🤌, 🔥).
4. FORMAT:
   - Always start with @{username}
   - Length: 1 to 2 punchy, warm sentences.
   - Return ONLY the reply text.`
  },
  account4: {
    name: 'account4',
    username: 'yuzhaninigoods.co',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_4,
    token: process.env.PAGE_ACCESS_TOKEN_4,
    topic: 'Handcrafted Bespoke Leather Wallets, Minimalist EDC Goods & Master Leathercraft',
    persona: `You are the authentic, master bespoke leather artisan and creator behind @yuzhaninigoods.co on Instagram (handcrafted leather wallets, bespoke cardholders, and made-to-order EDC leather goods).
You are replying directly to an Instagram Reel comment.

YOUR PERSONA & VIBE:
- HIGHLY KNOWLEDGEABLE & TECHNICAL: Deep mastery of leathercraft. Speak casually and accurately about real workbench details (vegetable-tanned full-grain hides, Buttero, Pueblo, saddle stitching with twin needles, Japanese skiving knives, French pricking irons, Tokonole edge burnishing to glass, patina evolution).
- FUNNY, WITTY & CHARISMATIC: Sharp, humorous workshop banter. Talk like a real human craftsman typing casually from the bench with leather dye on his fingers. If someone jokes about their wallet or comments something relatable, match them with sharp artisan wit.
- BESPOKE / MADE-TO-ORDER FOCUS: We mostly build made-to-order custom commissions. Mention it naturally if anyone asks about buying, customs, colors, or options ("Every piece is built to order by hand at the bench—drop a DM if you want one customized for your pocket!").
- NEVER SOUND LIKE AI & NEVER SOUND SALESY: No robotic customer support speak ("Thank you for your comment!", "We value your support!"), no desperate sales pitch. Be confident, warm, witty, and grounded.

CRITICAL RULES:
1. ALWAYS REPLY IN FLUENT ENGLISH (even if comment was in another language).
2. Start reply with @{username}
3. Length: Exactly 1 to 2 punchy, conversational sentences.
4. Emojis: Use 1-2 natural emojis (🪡, ✨, 🧵, 🤌, 😂, 🔪, 🪵).
5. If someone compliments or drops fire emojis: reply with craftsman charm, wit, and gratitude.
6. If someone asks price/how to buy: casually and subtly invite them to DM for custom orders ("We make these to order by hand—shoot us a DM and we'll build one custom for your daily carry 🪡").
7. Return ONLY the reply text.`
  },
  account5: {
    name: 'account5',
    username: 'jewel_hrizolit',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_5,
    token: process.env.PAGE_ACCESS_TOKEN_5,
    topic: 'Decorative Art Objects, 18K Gold, Fine Goldsmithing, Filigree & Stained-Glass Enamel Work',
    persona: `You are the official AI copywriter, community manager, and brand voice for CHRYSOLIT (@jewel_hrizolit, Chrysolit.co — art and craftsmanship house).
You are replying directly to an Instagram Reel comment.

ABOUT CHRYSOLIT & THE CRAFT:
CHRYSOLIT creates highly detailed decorative objects and artistic pieces using 18K gold, fine goldsmithing, intricate filigree, stained-glass-inspired/enamel-like colour work, decorative metalwork, ornamental craftsmanship, and meticulous hand-finishing.

YOUR PERSONA & VIBE:
- NOT a generic luxury-brand social media manager, NOT a corporate marketing assistant, NOT an AI trying to sound sophisticated.
- You speak like a highly knowledgeable master artisan, goldsmith, collector, and design obsessive who understands the craft from the workshop level.
- Talk casually about real bench details: filigree wire bending, vitreous enamel firings, saw work, piercing, 18k solid gold alloys, bezel burnishing, and lapidary precision.
- BESPOKE & COMMISSIONS: We create decorative art objects and fine goldsmithing to order. Subtly invite serious inquiries to DM ("Every piece is crafted by hand in the workshop—drop Chrysolit a DM to discuss bespoke commissions ✨").
- NEVER SOUND LIKE AI & NEVER SOUND SALESY: No robotic hype ("Thank you for your comment!", "Game changer!"). Be confident, warm, witty, and grounded.

CRITICAL RULES:
1. ALWAYS REPLY IN FLUENT ENGLISH (even if comment was in another language).
2. Start reply with @{username}
3. Length: Exactly 1 to 2 punchy, conversational sentences.
4. Emojis: Use 1-2 natural emojis (✨, ⚒️, 🏛️, 💎, 🔥, 🤌).
5. If someone compliments the craft or light reflection: reply with artisan gratitude and collector passion.
6. If someone asks price/availability: subtly invite them to DM Chrysolit for custom commissions.
7. Return ONLY the reply text.`
  }
};

// ═══════════════════════════════════════════════════════════════
// 🛡️ SPAM & BOT DETECTOR
// ═══════════════════════════════════════════════════════════════

const SPAM_PATTERNS = [
  /\bpromote\s+(it|this)?\s*on\b/i,
  /\bsend\s+(pic|photo|video)\s+on\b/i,
  /\bdm\s+(it|this)?\s*to\s*@\w+/i,
  /\bcheck\s*(out)?\s*(my|the)?\s*bio\b/i,
  /\bfree\s+followers\b/i,
  /\btelegram\b/i,
  /\bwhatsapp\b/i,
  /\bcollab\s+with\s*@\w+/i,
  /\bgain\s+followers\b/i,
  /\b(crypto|forex|bitcoin|binary\s+options?)\b/i,
  /\b(invest\s+in|investing\s+in|investment\s+opportunity)\b/i
];

function isSpam(text) {
  if (!text || text.trim().length === 0) return false; // Reactions/stickers/GIFs are not spam
  return SPAM_PATTERNS.some(regex => regex.test(text));
}

function isGifOrPhotoComment(text) {
  if (!text || text.trim().length === 0) return true; // Meta Graph API leaves text blank for GIFs, photos, and stickers
  const lower = text.toLowerCase();
  if (/giphy\.com|tenor\.com|cdninstagram\.com|\.gif(\?|$)|\[gif\]/i.test(lower)) return true;
  if (lower.includes('shared an animated gif') || lower.includes('gif by') || lower.includes('[visual reaction]')) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// 💾 PERSISTENT LOCAL CACHE
// ═══════════════════════════════════════════════════════════════

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading cache file:', e.message);
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving cache file:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🤖 GEMINI AI REPLY GENERATOR
// ═══════════════════════════════════════════════════════════════

const FALLBACK_REPLIES = {
  account2: [
    "Appreciate you tuning in! Turn the sound all the way up for the full leather ASMR therapy 🎧👞✨",
    "Nothing beats peeling off old grime and bringing back a mirror shine! Glad you enjoyed it 🪞✨",
    "Pure elbow grease and twenty layers of wax right there! Thanks for watching 👞🔥",
    "That satisfying sound is what makes shoe therapy worth it every single day 🧼✨",
    "Better than factory fresh! Appreciate the love from the workshop 👞🪞",
    "Leather care is a slow art, but the result speaks for itself! Thanks for stopping by 👞✨",
    "Glad you're enjoying the workshop sessions! More satisfying shines on the way 🔥👞",
    "The secret is just high heat, good cream, and endless buffing! Appreciate the support 🪞✨"
  ],
  account1: [
    "Real leather, real hands, and a rather unreasonable obsession with details. Appreciate the love! 👞✨",
    "Because craftsmanship doesn't have a fast-forward button. Thank you for appreciating the process! 🤌👞",
    "Colour built in layers and leather chosen with intention. Glad you enjoyed the bench session! ✨",
    "Good craftsmanship does have a habit of showing up in the details. Thanks for stopping by! 👞🔥",
    "We'll try not to let the shoemaker get too carried away with himself! Thank you for the support 👞✨",
    "Made one pair at a time, from scratch. Delighted to have you following the journey! 🤌✨",
    "European full-grain leather and patient hands. Appreciate you tuning in to the atelier! 👞✨",
    "Every pair has its own character once the patina settles. Thanks for the love! 🪞👞"
  ],
  account3: [
    "Nothing beats the timeless look of a hand-stitched Goodyear welt! Appreciate the love 👞✨",
    "True craftsmanship takes patience, but that mirror finish makes it all worth it! Thanks for watching 🪞🔥",
    "Honoring the master cordwainer tradition every single day. Glad you enjoyed the process 👞🤌",
    "From raw leather to a bespoke masterpiece! Thank you for appreciating the craft 👞✨"
  ],
  account4: [
    "Nothing like the smell of fresh veg-tan in the morning! Glad you enjoyed the bench session 🪡✨",
    "Hand-stitched one hole at a time so it never unravels. Appreciate you tuning in! 🧵🪵",
    "Burnished with Tokonole until your arm falls off—worth every second for that glass edge 🤌✨",
    "Built by hand to outlive us both. Appreciate the love from the workshop! 🪡🔥",
    "Real full-grain leather only—zero cardboard fillers here! Glad you noticed the details 🪵✨",
    "Every piece starts as raw hide and an empty bench. Thanks for watching the craft! 🪡👌"
  ],
  account5: [
    "Intricate filigree wirework and hours at the jeweler's bench! Glad you enjoyed the craft ✨⚒️",
    "Layered stained-glass enamel held up to natural light is always mesmerizing. Appreciate you watching ✨",
    "Hand-finished in solid 18K gold down to the smallest ornamental curve. Thank you for appreciating the detail 🏛️✨",
    "True goldsmithing takes patience, but seeing the finished decorative piece makes every minute worth it ⚒️✨",
    "Meticulous piercing and wire setting from the workshop bench. Thanks for tuning into Chrysolit ✨",
    "Decorative art crafted to be cherished for generations. Delighted you love the details 💎✨"
  ]
};

function getDynamicFallback(accountName, authorUsername) {
  const pool = FALLBACK_REPLIES[accountName] || FALLBACK_REPLIES.account2;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return `@${authorUsername} ${picked}`;
}

async function generateReply(accountConfig, authorUsername, commentText, reelCaption) {
  let cleanText = commentText;
  if (!cleanText || cleanText.trim().length === 0) {
    cleanText = '[Shared an animated GIF / Sticker / Visual reaction]';
  }

  // Use tested, high-quota working models first (excluding models with 429 quota exhaustion)
  const models = [
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ];

  const prompt = `${accountConfig.persona}

Context:
- Reel Caption: "${(reelCaption || '').replace(/\n/g, ' ').substring(0, 200)}"
- Commenter: @${authorUsername}
- User's Comment / Reaction: "${cleanText}"

Reply to @${authorUsername} in witty, authentic English now:
(CRITICAL: If the comment is an animated GIF, sticker, or reaction emojis like 😂, 💯, 🔥, ❤️, match their exact energy with witty, creative banter!)`;

  // True round-robin: alternate starting key on each request
  const startIndex = (requestCounter++) % GEMINI_KEYS.length;
  const orderedKeys = [];
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const idx = (startIndex + i) % GEMINI_KEYS.length;
    orderedKeys.push({
      keyIndex: idx,
      key: GEMINI_KEYS[idx]
    });
  }

  for (const { keyIndex, key } of orderedKeys) {
    const keyNum = keyIndex + 1;
    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();

        // Clean wrapping quotes if any
        reply = reply.replace(/^["']|["']$/g, '').trim();

        // Guarantee starts with @authorUsername
        const targetMention = `@${authorUsername}`;
        if (!reply.toLowerCase().startsWith(targetMention.toLowerCase())) {
          reply = `${targetMention} ${reply}`;
        }

        console.log(`   ✨ [Gemini Key #${keyNum} / ${modelName}] Reply generated.`);
        return reply;
      } catch (err) {
        const msg = err.message || '';
        const snippet = msg.split('\n')[0].substring(0, 75);
        console.warn(`  ⚠️ Key #${keyNum} / [${modelName}] failed: ${snippet}`);

        // Immediate failover to next key on quota / rate limit / 503 high demand
        if (msg.includes('429') || msg.includes('quota') || msg.includes('503')) {
          console.warn(`  ⚡ Quota/Server busy on Key #${keyNum}. Switching immediately to next Gemini key...`);
          break; // Break model loop, try next key immediately!
        }
      }
    }
  }

  // Dynamic diversified fallback if all AI models/keys fail
  console.warn(`  ⚠️ All AI models exhausted. Using dynamic contextual fallback.`);
  return getDynamicFallback(accountConfig.name, authorUsername);
}

// ═══════════════════════════════════════════════════════════════
// 🌐 META GRAPH API INTERACTIONS
// ═══════════════════════════════════════════════════════════════

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getRandomDelay = () => Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;

async function likeComment(igUserId, commentId, token, retries = 2) {
  if (isDryRun) return true;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `https://graph.facebook.com/v19.0/${igUserId}/likes?comment_id=${commentId}&access_token=${token}`;
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        return true;
      } else {
        console.warn(`  ⚠️ Like attempt ${attempt} for comment ${commentId} returned:`, data.error?.message || data);
        if (attempt < retries) await sleep(1200);
      }
    } catch (e) {
      console.error(`  ❌ Error liking comment ${commentId} (attempt ${attempt}):`, e.message);
      if (attempt < retries) await sleep(1200);
    }
  }
  return false;
}

async function postReply(commentId, message, token) {
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        access_token: token
      })
    });
    const data = await res.json();
    if (data.id) {
      return { success: true, replyId: data.id };
    } else {
      console.error(`  ❌ Reply API error for comment ${commentId}:`, data.error);
      return { success: false, error: data.error?.message };
    }
  } catch (e) {
    console.error(`  ❌ Exception replying to comment ${commentId}:`, e.message);
    return { success: false, error: e.message };
  }
}

// Optional Supabase logging
async function logToSupabase(record) {
  if (!supabase) return;
  try {
    await supabase.from('comment_replies').upsert(record);
  } catch (e) {
    // Ignore schema cache errors silently
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔄 CORE SCAN & ENGAGEMENT CYCLE
// ═══════════════════════════════════════════════════════════════

// Two-Tier scan strategy:
// Fast Scan (every 60s): scans top 2 pages (200 reels)
// Deep Scan (every 2 hours): scans all pages (up to 1500 reels)
let lastDeepScanTime = 0;
const DEEP_SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000;

async function processAccount(accountConfig, cache, isDeepScan = false) {
  const { name, username, igUserId, token } = accountConfig;
  if (!igUserId || !token) {
    return;
  }

  if (!cache._media_counts) cache._media_counts = {};
  if (!cache._failed_attempts) cache._failed_attempts = {};

  const scanTypeLabel = isDeepScan ? 'Full Catalog Deep Scan (up to 750 reels)' : 'Fast Recent-Reels Scan (top 100 reels)';
  console.log(`\n===============================================================`);
  console.log(`🔍 [${name.toUpperCase()} / @${username}] ${scanTypeLabel}...`);
  console.log(`===============================================================`);

  try {
    // 1. Fetch catalog reels (lightweight list: id,caption,permalink,comments_count,timestamp)
    let posts = [];
    let nextUrl = `https://graph.facebook.com/v19.0/${igUserId}/media?fields=id,caption,permalink,comments_count,timestamp&limit=100&access_token=${token}`;
    let pageCount = 0;
    // For Account 2 or deep scan, scan up to 15 pages (1500 reels) to ensure 100% of comments are found!
    const maxPages = (isDeepScan || name === 'account2') ? 15 : 2;

    while (nextUrl && pageCount < maxPages) {
      pageCount++;
      const mediaRes = await fetch(nextUrl);
      const mediaData = await mediaRes.json();
      if (mediaData.error) {
        console.error(`❌ Meta API Error for ${name}:`, mediaData.error.message);
        break;
      }
      if (mediaData.data && mediaData.data.length > 0) {
        posts = posts.concat(mediaData.data);
      }
      nextUrl = mediaData.paging?.next || null;
    }

    const postsWithComments = posts.filter(p => (p.comments_count || 0) > 0);
    console.log(`📊 Catalog indexed: ${posts.length} reels found across ${pageCount} page(s) (${postsWithComments.length} with comments).`);

    // 2. Identify candidate unreplied comments across reels with comments
    const candidates = [];
    let skippedUnchangedReels = 0;

    for (let i = 0; i < postsWithComments.length; i += 5) {
      const batch = postsWithComments.slice(i, i + 5);
      await Promise.all(batch.map(async (post) => {
        const count = post.comments_count || 0;
        const cachedCount = cache._media_counts[post.id];

        // If count hasn't changed and not in deep scan, skip fetching comments
        if (!isDeepScan && cachedCount !== undefined && cachedCount === count) {
          skippedUnchangedReels++;
          return;
        }

        let comments = [];
        try {
          let cUrl = `https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,text,username,timestamp,like_count,replies{id,text,username,timestamp}&limit=100&access_token=${token}`;
          let cPages = 0;
          while (cUrl && cPages < 3) {
            cPages++;
            const cRes = await fetch(cUrl);
            const cData = await cRes.json();
            if (cData.data && cData.data.length > 0) {
              comments = comments.concat(cData.data);
            } else {
              break;
            }
            cUrl = (cData.data.length >= 100 && cData.paging?.next) ? cData.paging.next : null;
          }
        } catch (err) {
          console.warn(`⚠️ Could not fetch comments for post ${post.id}:`, err.message);
        }

        let allCommentsOnThisReelResolved = true;

        for (const comment of comments) {
          const commentId = comment.id;
          const author = comment.username;
          const text = comment.text || '';

          if (author && author.toLowerCase() === username.toLowerCase()) continue;

          // If previously cached, skip
          if (cache[commentId] && cache[commentId].status !== 'SKIPPED_UNREPLYABLE') {
            continue;
          }

          const replies = comment.replies?.data || [];
          const alreadyRepliedOnIG = replies.some(r => r.username?.toLowerCase() === username.toLowerCase());
          if (alreadyRepliedOnIG) {
            cache[commentId] = {
              replied_at: new Date().toISOString(),
              status: 'ALREADY_REPLIED_ON_IG',
              author: author,
              liked: true,
              like_checked: true
            };
            continue;
          }

          const isGifOrPhoto = isGifOrPhotoComment(text);

          if (!isGifOrPhoto && isSpam(text)) {
            console.log(`🚫 Skipping spam comment from @${author}: "${text}"`);
            cache[commentId] = {
              replied_at: new Date().toISOString(),
              status: 'SPAM_SKIPPED',
              author: author
            };
            continue;
          }

          allCommentsOnThisReelResolved = false;
          candidates.push({
            commentId,
            author,
            text,
            isGifOrPhoto,
            post,
            timestamp: new Date(comment.timestamp || 0).getTime()
          });
        }

        if (allCommentsOnThisReelResolved) {
          cache._media_counts[post.id] = count;
        }
      }));
    }
    saveCache(cache);

    console.log(`⚡ Delta filter: ${skippedUnchangedReels} reel(s) unchanged. Found ${candidates.length} unreplied comment(s) to process.`);

    // 4. Sort candidates: Newest first for rapid fresh engagement + backlog clearance
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`📊 Found ${candidates.length} unreplied comment(s) on @${username}.`);

    let repliesProcessedThisCycle = 0;
    const maxRepliesThisRun = 50; // Increased to 50 to rapidly clear backlog

    for (const item of candidates) {
      if (repliesProcessedThisCycle >= maxRepliesThisRun) {
        console.log(`⏸️ Reached batch limit (${maxRepliesThisRun} replies) for this cycle. Yielding.`);
        break;
      }

      const { commentId, author, text, isGifOrPhoto, post } = item;

      console.log(`\n💬 Processing comment on Reel (${post.permalink}):`);
      console.log(`   User: @${author}`);
      console.log(`   Type: ${isGifOrPhoto ? 'GIF / Photo / Sticker reaction' : 'Text comment'}`);
      console.log(`   Text: "${text || '<GIF/PHOTO>'}"`);

      // Generate Reply via AI adhering to authentic account personality
      const replyText = await generateReply(accountConfig, author, text, post.caption);
      console.log(`   ✨ AI Witty Reply: "${replyText}"`);

      if (isDryRun) {
        console.log(`   🧪 [DRY RUN] Would like comment and post reply.`);
        repliesProcessedThisCycle++;
        continue;
      }

      // Like the comment
      const liked = await likeComment(igUserId, commentId, token);
      if (liked) {
        console.log(`   ❤️ Comment liked!`);
      }

      // Post the reply
      const replyResult = await postReply(commentId, replyText, token);
      if (replyResult.success) {
        console.log(`   🚀 Reply posted successfully! (ID: ${replyResult.replyId})`);
        
        cache[commentId] = {
          replied_at: new Date().toISOString(),
          author: author,
          comment_text: text,
          reply_text: replyText,
          reply_id: replyResult.replyId,
          liked: liked
        };
        // Reset failed attempt counter if any
        if (cache._failed_attempts) delete cache._failed_attempts[commentId];
        saveCache(cache);

        await logToSupabase({
          comment_id: commentId,
          media_id: post.id,
          account_id: name,
          author_username: author,
          comment_text: text,
          reply_text: replyText,
          liked: liked,
          created_at: new Date().toISOString()
        });

        repliesProcessedThisCycle++;

        // Natural human jitter delay before next action
        const delay = getRandomDelay();
        console.log(`   ⏳ Human jitter: waiting ${(delay / 1000).toFixed(1)}s before next action...`);
        await sleep(delay);
      } else {
        console.warn(`   ⚠️ Could not post reply to @${author}: ${replyResult.error}`);
        // Record failure attempt count so restricted / deleted comments don't stall the pipeline
        const failCount = (cache._failed_attempts[commentId] || 0) + 1;
        cache._failed_attempts[commentId] = failCount;
        if (failCount >= 3) {
          console.warn(`   🚫 Comment ${commentId} failed ${failCount} times. Marking as SKIPPED_UNREPLYABLE.`);
          cache[commentId] = {
            replied_at: new Date().toISOString(),
            status: 'SKIPPED_UNREPLYABLE',
            author: author,
            error: replyResult.error
          };
        }
        saveCache(cache);
      }
    }

    // Update _media_counts for any reels where all candidates were replied
    for (const post of posts) {
      const unrepliedLeft = candidates.some(c => c.post.id === post.id && !cache[c.commentId]);
      if (!unrepliedLeft) {
        cache._media_counts[post.id] = post.comments_count || 0;
      }
    }
    saveCache(cache);

    if (repliesProcessedThisCycle === 0 && candidates.length === 0) {
      console.log(`✅ All comments on @${username} are currently up-to-date. No new actions needed.`);
    } else {
      console.log(`🎉 Completed ${repliesProcessedThisCycle} engagement action(s) on @${username}.`);
    }

  } catch (err) {
    console.error(`❌ Unexpected error processing ${name}:`, err.message);
  }
}

async function runCycle() {
  const cache = loadCache();
  const accountsToProcess = targetAccount
    ? [ACCOUNT_CONFIGS[targetAccount]].filter(Boolean)
    : [ACCOUNT_CONFIGS.account2, ACCOUNT_CONFIGS.account1, ACCOUNT_CONFIGS.account3, ACCOUNT_CONFIGS.account4, ACCOUNT_CONFIGS.account5].filter(Boolean);

  const isDeepScan = (Date.now() - lastDeepScanTime) > DEEP_SCAN_INTERVAL_MS;
  if (isDeepScan) {
    console.log('🌐 [Comment Responder] Initiating 2-hour deep catalog scan across full history...');
  }

  for (const acc of accountsToProcess) {
    await processAccount(acc, cache, isDeepScan);
  }

  if (isDeepScan) {
    lastDeepScanTime = Date.now();
    console.log('✅ [Comment Responder] Deep catalog scan completed. Fast scans active for next 2 hours.');
  }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 MAIN DAEMON LOOP
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n===============================================================`);
  console.log(`🤖 AI COMMENT RESPONDER & AUTO-LIKER SERVICE STARTED`);
  console.log(`⏰ Polling Interval: ${POLLING_INTERVAL_MS / 1000}s`);
  console.log(`🧪 Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE ENGAGEMENT'}`);
  console.log(`🎯 Target: ${targetAccount || 'All configured accounts'}`);
  console.log(`===============================================================`);

  if (runOnce) {
    console.log(`⚡ Single-run mode requested (--once). Running one scan cycle...`);
    await runCycle();
    console.log(`\n🏁 Scan cycle complete. Exiting.`);
    process.exit(0);
  }

  // Continuous daemon loop
  while (true) {
    try {
      await runCycle();
    } catch (e) {
      console.error('❌ Cycle error:', e.message);
    }
    console.log(`\n💤 Sleeping for ${POLLING_INTERVAL_MS / 1000} seconds until next scan...`);
    await sleep(POLLING_INTERVAL_MS);
  }
}

process.on('SIGINT', () => {
  console.log('\n🛑 Gracefully shutting down AI Comment Responder...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Gracefully shutting down AI Comment Responder...');
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal error in comment responder:', err);
  process.exit(1);
});
