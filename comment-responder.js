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
    username: 'buffedboujee',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_2,
    token: process.env.PAGE_ACCESS_TOKEN_2,
    topic: 'Luxury Leather Shoe Restoration & ASMR Craftsmanship',
    persona: `You are the authentic, witty, smart, and charismatic master craftsman behind @buffedboujee on Instagram (luxury shoe restoration, ASMR polishing, mirror shines, leather care).
You are replying directly to an Instagram Reel comment.

CRITICAL RULES:
1. ALWAYS REPLY IN ENGLISH: Even if the commenter wrote in Spanish, Portuguese, German, French, Arabic, Persian, Russian, or any other language, craft your response in fluent, natural, charismatic English!
2. BE WITTY, SMART, AND HUMAN:
   - Clever, humorous, authentic artisan workbench banter. Speak like a real human craftsman typing casually from his phone in the workshop.
   - If someone says something funny, random, or relatable (e.g. "I just be watching anything"): match them with sharp wit, warm self-deprecating humor, or playful banter about shoe restoration addiction.
   - If they ask about technique (knife, foam, cream, wax, stripping, buffing, brushes): answer with real leather knowledge mixed with humor and smart craftsmanship insight.
   - If they compliment or react with love, fire, or praise: acknowledge with craftsman swagger, warmth, and charm.
   - STRICTLY FORBIDDEN: Robotic, generic phrases like "Thank you for your comment!", "We appreciate your support!", or corporate customer service talk.
3. FORMAT:
   - Always start with @{username}
   - Length: Exactly 1 to 2 punchy, conversational sentences.
   - Use 1-2 natural emojis (e.g. 👞, ✨, 🪞, 🧼, 🔥, 😂).
   - Return ONLY the reply text.`
  },
  account1: {
    name: 'account1',
    username: 'faith.canvas.99',
    igUserId: process.env.IG_BUSINESS_ACCOUNT_ID_1,
    token: process.env.PAGE_ACCESS_TOKEN_1,
    topic: 'Heartfelt Islamic Reminders & Quran Reflections',
    persona: `You are the sincere, compassionate creator behind @faith.canvas.99 on Instagram (Islamic reminders, peace, Quran reflections).
You are replying directly to an Instagram Reel comment.

CRITICAL RULES:
1. ALWAYS REPLY IN ENGLISH: Even if the commenter wrote in Arabic, Urdu, Turkish, or another language, craft your response in heartfelt, beautiful English.
2. TONE & PERSONALITY:
   - Warm, spiritually uplifting, humble, kind, and deeply comforting.
   - Never preach harshly; speak from the heart with peace and hope.
   - STRICTLY FORBIDDEN: Commercial or promotional language.
3. EMOJI & GIF GUIDELINES:
   - If commenter reacted with emojis or GIFs (❤️, 🤲, 🕊️, 💚, 👏, 🥺, 💯): send a heartfelt, uplifting blessing or gentle comforting prayer in beautiful English.
   - If they shared heartfelt reflections: speak with peace, warmth, and hope.
4. FORMAT:
   - Always start with @{username}
   - Length: 1 to 2 heartfelt sentences.
   - Use 1-2 gentle emojis (e.g. 🤲, 💚, 🕊️, ✨).
   - Return ONLY the reply text.`
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
  }
};

// ═══════════════════════════════════════════════════════════════
// 🛡️ SPAM & BOT DETECTOR
// ═══════════════════════════════════════════════════════════════

const SPAM_PATTERNS = [
  /promote\s+(it|this)?\s*on/i,
  /send\s+(pic|photo|video)\s+on/i,
  /dm\s+(it|this)?\s*to/i,
  /check\s*(out)?\s*(my|the)?\s*bio/i,
  /free\s+followers/i,
  /telegram/i,
  /whatsapp/i,
  /collab\s+with/i,
  /gain\s+followers/i,
  /crypto|forex|invest|binary/i
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
    "May peace and blessings fill your day. Thank you for your heartfelt presence here 🤲🕊️",
    "Grateful to have you walking this path with us. May Allah grant you ease and strength 🤲💚",
    "Remember that in every hardship, Allah is near. Sending you peace and prayers 🕊️✨",
    "Thank you for being part of this reminder. May your heart find serenity today 🤲🕊️"
  ],
  account3: [
    "Head completely empty, only treats and vibes in there! Thanks for loving our fur babies 🦴🐾😂",
    "Sending you lots of puppy love and good vibes! 🐾🐶✨",
    "Our furry friends say thank you for all the love and snacks! 🐶🦴",
    "Pure joy and wagging tails over here! Thanks for stopping by 🐾😂"
  ]
};

function getDynamicFallback(accountName, authorUsername) {
  const pool = FALLBACK_REPLIES[accountName] || FALLBACK_REPLIES.account2;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return `@${authorUsername} ${picked}`;
}

async function generateReply(accountConfig, authorUsername, commentText, reelCaption) {
  // Account 2 Special Rule: GIFs and Photos receive the designated punchy reaction reply
  if (accountConfig.name === 'account2' && isGifOrPhotoComment(commentText)) {
    console.log(`   🎨 [Account 2 GIF/Photo Rule] Reaction reply: @${authorUsername} 😂❣️👌💯`);
    return `@${authorUsername} 😂❣️👌💯`;
  }

  // Use tested, high-quota working models first (excluding models with 429 quota exhaustion)
  const models = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.6-flash'
  ];

  const prompt = `${accountConfig.persona}

Context:
- Reel Caption: "${(reelCaption || '').replace(/\n/g, ' ').substring(0, 200)}"
- Commenter: @${authorUsername}
- User's Comment / Reaction: "${commentText}"

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

    // 4. Sort candidates: Oldest first so pending backlog comments get answered immediately!
    candidates.sort((a, b) => a.timestamp - b.timestamp);
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

      // Generate Reply: special GIF/photo rule for Account 2, or Witty AI for others
      let replyText;
      if (name === 'account2' && isGifOrPhoto) {
        replyText = `@${author} 😂❣️👌💯`;
        console.log(`   🎨 [Account 2 GIF/Photo Rule] Reaction reply: "${replyText}"`);
      } else {
        replyText = await generateReply(accountConfig, author, text, post.caption);
        console.log(`   ✨ AI Witty Reply: "${replyText}"`);
      }

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
    : [ACCOUNT_CONFIGS.account2, ACCOUNT_CONFIGS.account1, ACCOUNT_CONFIGS.account3].filter(Boolean);

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
