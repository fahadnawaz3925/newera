require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const execa = require('execa');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env file!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const accountIdR2 = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'reels';

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountIdR2}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

// Binary path resolvers
const ffmpegBinary = 'ffmpeg'; // Force system ffmpeg to fix drawtext missing library in ffmpeg-static

const localYtDlp = path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ytDlpBinary = fs.existsSync(localYtDlp) ? localYtDlp : 'yt-dlp';

// Sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Proxy Rotation Pool
const IG_PROXIES = process.env.IG_PROXIES ? process.env.IG_PROXIES.split(',').map(p => p.trim()).filter(Boolean) : [];
let currentProxyIndex = 0;

function getNextProxy() {
  if (IG_PROXIES.length === 0) return process.env.IG_PROXY || null;
  const proxy = IG_PROXIES[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % IG_PROXIES.length;
  return proxy;
}

// ═══════════════════════════════════════════════════════════════
// 🔒 GLOBAL MUTEX & CROSS-ACCOUNT STAGGERING ENGINE
// Guarantees STRICTLY ONE video publishes at a time across all accounts
// ═══════════════════════════════════════════════════════════════
const GLOBAL_LOCK_KEY = 'global_publisher_lock.json';
const GLOBAL_LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 min max lock duration before auto-recovery
const GLOBAL_MIN_STAGGER_MINS = 7.0; // Min 7 min interval between ANY post across accounts

async function acquireGlobalLock(accountId, itemId = 'pre-claim') {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucketName, Key: GLOBAL_LOCK_KEY });
    const res = await S3.send(cmd);
    const bodyStr = await res.Body.transformToString();
    const lock = JSON.parse(bodyStr);
    
    if (lock && lock.isLocked) {
      const lockAge = Date.now() - (lock.lockedAt || 0);
      if (lockAge < GLOBAL_LOCK_TIMEOUT_MS) {
        return { 
          acquired: false, 
          holder: lock.lockedByAccount, 
          itemId: lock.itemId,
          ageMins: (lockAge / 60000).toFixed(1) 
        };
      }
      console.log(`[GLOBAL LOCK] ⚠️ Stale lock detected (${(lockAge/60000).toFixed(1)}m old held by ${lock.lockedByAccount}). Auto-recovering lock.`);
    }
  } catch (e) {
    // No lock file exists, proceed
  }

  const lockData = {
    isLocked: true,
    lockedByAccount: accountId,
    itemId: itemId,
    lockedAt: Date.now(),
    pid: process.pid,
    hostname: os.hostname()
  };

  try {
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: GLOBAL_LOCK_KEY,
      Body: JSON.stringify(lockData),
      ContentType: 'application/json'
    }));
    return { acquired: true };
  } catch (err) {
    console.error('Failed to write global lock to R2:', err.message);
    return { acquired: false, error: err.message };
  }
}

async function releaseGlobalLock(accountId) {
  try {
    const lockData = {
      isLocked: false,
      lastReleasedByAccount: accountId,
      releasedAt: Date.now()
    };
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: GLOBAL_LOCK_KEY,
      Body: JSON.stringify(lockData),
      ContentType: 'application/json'
    }));
  } catch (err) {
    console.error('Failed to release global lock in R2:', err.message);
  }
}


// ═══════════════════════════════════════════════════════════════
// 🛡️ ANTI-COPYRIGHT SHIELD — Randomization Engine
// ═══════════════════════════════════════════════════════════════

// Helper: random float in range [min, max]
function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

// Helper: random integer in range [min, max]
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: pick random item from array
function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Layer 5: Device profile pool for metadata rotation
const DEVICE_PROFILES = [
  { make: 'Apple', model: 'iPhone 15 Pro Max', encoder: 'iOS 17.5.1 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 16 Pro', encoder: 'iOS 18.2 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 14 Pro', encoder: 'iOS 17.4 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 15', encoder: 'iOS 17.6 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Samsung', model: 'Galaxy S24 Ultra', encoder: 'Samsung Video Encoder 2.1', handler: 'VideoHandle' },
  { make: 'Samsung', model: 'Galaxy S23+', encoder: 'Samsung Video Encoder 1.8', handler: 'VideoHandle' },
  { make: 'Google', model: 'Pixel 9 Pro', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
  { make: 'Google', model: 'Pixel 8a', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
  { make: 'OnePlus', model: 'OnePlus 12', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
];

// Layer 7: Color grading presets (subtle, imperceptible shifts)
const COLOR_GRADES = [
  'colorbalance=rs=0.02:gs=-0.01:bs=0.03',       // warm
  'colorbalance=rs=-0.02:gs=0.01:bs=0.01',        // cool
  'colorbalance=rs=0.01:gs=0.02:bs=-0.01',         // green tint
  'colorbalance=rs=-0.01:gs=-0.01:bs=0.02',        // blue tint
  'colorbalance=rs=0.03:gs=0.01:bs=-0.02',         // golden
  'colorbalance=rs=0.01:gs=-0.02:bs=0.01',         // magenta hint
  'colorbalance=rs=-0.01:gs=0.02:bs=0.02',         // teal
  'colorbalance=rs=0.02:gs=0.02:bs=0.00',          // sunrise
];

const COLOR_PRESETS = {
  'warm': 'colorbalance=rs=0.02:gs=-0.01:bs=0.03',
  'cool': 'colorbalance=rs=-0.02:gs=0.01:bs=0.01',
  'vintage': 'colorbalance=rs=0.03:gs=0.01:bs=-0.02', // golden
  'none': null
};

// Generate all randomized transform parameters for a single video
function generateAntiCopyrightParams(targetAccount, config) {
  let isFlip = false;
  if (targetAccount === 'account2') isFlip = true;
  const doMirror = isFlip;

  // Zoom to hide edge watermarks & vary frame (subtle 1-3% to preserve maximum sharpness)
  const cropX = randInt(1, 3);
  const cropY = randInt(1, 3);

  // Bright, clean lighting (positive brightness and rich contrast for account2 to eliminate any darkness)
  const brightness = targetAccount === 'account2' ? randFloat(0.015, 0.040) : randFloat(-0.01, 0.02);
  const contrast = targetAccount === 'account2' ? randFloat(1.02, 1.06) : randFloat(0.98, 1.03);
  const saturation = targetAccount === 'account2' ? randFloat(1.08, 1.20) : randFloat(1.02, 1.15);
  const gamma = targetAccount === 'account2' ? randFloat(1.00, 1.04) : randFloat(0.98, 1.02);
  
  const frameRate = 30; // Standard 30fps for Instagram Reels

  // Audio masking
  const audioSpeedFactor = randFloat(0.99, 1.01);
  const audioPitchRate = 48000;
  const doStereoSwap = Math.random() > 0.5;
  const silenceMs = randInt(30, 80);
  const doReverb = Math.random() > 0.6;
  const bgNoiseMix = randFloat(0.008, 0.015); 
  const doPhaser = false; // Disabled to maintain pure studio audio clarity

  // Trimming to bypass duration matching
  const trimStart = randFloat(0.1, 0.3); 
  const trimEnd = randFloat(0.1, 0.3);

  const ptsFactor = 1 / audioSpeedFactor;

  // Maximum Quality Video & Audio Encoding Parameters
  const preset = randPick(['medium', 'fast']); // High-quality macroblock search
  const profile = 'high';                      // H.264 High Profile (best compression/sharpness)
  const tune = 'film';
  const level = '4.2';

  const gopSize = randInt(30, 60); 

  const videoBitrate = randInt(6500, 8500) + 'k'; // High bitrate 6.5 - 8.5 Mbps for crisp 1080p HD
  const maxRate = randInt(10000, 12000) + 'k';   // Max 10-12 Mbps peak
  const audioBitrate = '320k';                    // Crystal clear studio audio (320 kbps AAC)

  const noiseStrength = randInt(1, 2);           // Ultra-low imperceptible noise

  const lensDistortion = randFloat(-0.005, 0.005);
  const rotAngle = randFloat(-0.005, 0.005);
  const fadeDuration = randFloat(0.1, 0.2);

  const device = randPick(DEVICE_PROFILES);
  
  const now = new Date();
  now.setMinutes(now.getMinutes() - randInt(5, 6000));
  const creationTime = now.toISOString();

  // DYNAMIC CONFIGURATIONS
  let watermarkText = (config && config.watermark_text) ? config.watermark_text : '@' + targetAccount;
  const watermarkOpacity = randFloat(0.3, 0.5);
  const watermarkSize = randInt(16, 24);
  let colorGradeLabel = config && config.color_grade !== 'none' ? config.color_grade : randPick(['vintage', 'warm', 'cool', 'none']);
  let colorGrade = colorGradeLabel === 'none' ? null : (COLOR_PRESETS[colorGradeLabel] || randPick(COLOR_GRADES));

  // Metadata
  let metaTitle = (config && config.fallback_title) ? config.fallback_title : 'Reel';
  let metaArtist = watermarkText.replace('@', '');
  let metaComment = (config && config.hashtags) ? config.hashtags : 'Reels';
  let metaGenre = 'Entertainment';

  return {
    // Layer 1
    cropX, cropY, brightness, contrast, saturation, gamma, noiseStrength, doMirror, frameRate,
    // Layer 2
    audioSpeedFactor, audioPitchRate, doStereoSwap, silenceMs, doReverb, bgNoiseMix,
    // Layer 3
    trimStart, trimEnd, ptsFactor, gopSize,
    // Layer 4
    preset, videoBitrate, maxRate, audioBitrate, profile, tune, level,
    // Layer 5
    device, creationTime,
    // Layer 6
    watermarkText, watermarkOpacity, watermarkSize,
    // Layer 7
    colorGrade,
    // Layer 9
    lensDistortion, rotAngle,
    // Layer 10
    doPhaser, fadeDuration,
    // Metadata
    metaTitle, metaArtist, metaComment, metaGenre,
  };
}

// Helper for Gemini Multimodal Image Input
function fileToGenerativePart(filePath, mimeType = 'image/jpeg') {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType
    },
  };
}

// AI Caption Generator with Retry & Dynamic Video Context Fallback
async function generateCaption(videoUrl, rawPath, targetAccount, coverPath = null, videoMetadata = null, config = null) {
  const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY
  ].filter(Boolean);
  const hasCoverImage = coverPath && fs.existsSync(coverPath);

  let videoContext = '';
  let videoTitleClean = '';
  let videoDescClean = '';

  if (videoMetadata) {
    if (videoMetadata.title && !videoMetadata.title.startsWith('Video by')) {
      videoTitleClean = videoMetadata.title.trim();
      videoContext += `\nVideo Title: "${videoTitleClean}"`;
    }
    if (videoMetadata.description && videoMetadata.description.trim().length > 10) {
      videoDescClean = videoMetadata.description.slice(0, 400).trim();
      videoContext += `\nVideo Description: "${videoDescClean}"`;
    }
  }

  let prompt;
  if (config && config.caption_prompt) {
    prompt = config.caption_prompt;
    if (videoContext) prompt = `${videoContext}\n\n${prompt}`;
  } else {
    // Fallback if DB fails
    prompt = "Write a viral Instagram reel caption for this video. Use emojis and hashtags.";
  }

  if (apiKeys.length > 0) {
    const modelsToTry = [
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.7-flash',
      'gemini-pro-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite'
    ];

    for (const geminiKey of apiKeys) {
      const genAI = new GoogleGenerativeAI(geminiKey);
      
      for (const modelName of modelsToTry) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`Attempting visual caption generation with model: ${modelName} (Attempt ${attempt}) for ${targetAccount}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const contents = hasCoverImage
              ? [prompt, fileToGenerativePart(coverPath)]
              : [prompt];

            const result = await model.generateContent(contents);
            let text = result.response?.text()?.trim();
            if (text) {
              text = text.replace(/^#+\s*/gm, '').replace(/```[\s\S]*?```/g, '').trim();
              console.log(`Caption successfully generated using model: ${modelName}`);
              return text;
            }
          } catch (err) {
            console.warn(`Model ${modelName} attempt ${attempt} failed for ${targetAccount}:`, err.message);
            if (err.message.includes('429')) {
              console.log(`Quota 429 encountered, switching to next model or API key...`);
              break; // Break the attempt loop to try the next model or key immediately
            } else {
              console.log(`Sleeping 3s before retry...`);
              await sleep(3000);
            }
          }
        }
      }
    }
  }

  // Dynamic Video-Specific Fallback (Never a static generic string!)
  if (targetAccount === 'account2') {
    const titleLine = videoTitleClean ? `👞✨ ${videoTitleClean}` : `Turn your sound UP for this 🎧🔥`;
    const descLine = videoDescClean ? videoDescClean.slice(0, 180) : `Watch this satisfying transformation — worn leather brought back to a gorgeous mirror shine. The sounds are everything 🤌`;
    return `${titleLine}\n\n${descLine}\n\nFollow @buffedboujee for more satisfying content 👞✨\n\n#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning`;
  } else if (targetAccount === 'account3') {
    const titleLine = videoTitleClean ? `🐶 ${videoTitleClean}` : `I can't stop watching this 😂🥺`;
    const descLine = videoDescClean ? videoDescClean.slice(0, 180) : `Watch this adorable moment! We literally can't get enough of this cuteness. Tag a friend who needs to see this!`;
    return `${titleLine}\n\n${descLine}\n\nFollow @house.of.paws38 for your daily dose of cuteness 🐾🐶\n\n#DogsOfInstagram #CutePets #FunnyDogs #DogLovers #PuppyLove #PetVideos #HouseOfPaws`;
  } else {
    const titleLine = videoTitleClean ? `✨ ${videoTitleClean}` : `A reminder your soul needed right now 🤲💚`;
    const descLine = videoDescClean ? videoDescClean.slice(0, 180) : `In the quiet moments of life, turn your heart to Allah. He is closer to you than you think. Trust His plan, even when the path feels unclear.`;
    return `${titleLine}\n\n${descLine}\n\nFollow @faith.canvas.99 for daily reminders 🤲🕊️\n\n#Islam #Quran #IslamicReminders #Deen #Allah #Sunnah #Muslim #DeenOverDunya #Taqwa`;
  }
}

// Single Video Processor
async function processSingleItem(item, targetAccount) {
  // Fetch dynamic configuration from DB
  const { data: accData, error: accErr } = await supabase.from('reels_accounts').select('*').eq('account_id', targetAccount).single();
  const accountConfig = accData || null;
  let IG_BUSINESS_ACCOUNT_ID, PAGE_ACCESS_TOKEN, IG_SESSION_ID;

  if (targetAccount === 'account3') {
    IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_3;
    PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_3;
    IG_SESSION_ID = process.env.IG_SESSION_ID_3;
  } else if (targetAccount === 'account2') {
    IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_2;
    PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2;
    IG_SESSION_ID = process.env.IG_SESSION_ID_2;
  } else {
    IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_1;
    PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1;
    IG_SESSION_ID = process.env.IG_SESSION_ID_1;
  }

  if (!IG_BUSINESS_ACCOUNT_ID || !PAGE_ACCESS_TOKEN) {
    const errMsg = `Missing env vars for ${targetAccount} (IG_BUSINESS_ACCOUNT_ID or PAGE_ACCESS_TOKEN)`;
    console.error(errMsg);
    await supabase.from('reels_queue').update({ status: 'FAILED', error_log: errMsg }).eq('id', item.id);
    return;
  }

  console.log(`\n========================================`);
  console.log(`🎬 Processing item ${item.id} for ${targetAccount}...`);
  console.log(`========================================`);

  // Layer 8: Smart Duplicate Tracking — check if this URL was already posted
  const sourceUrlHash = crypto.createHash('md5').update(item.url).digest('hex');
  const { data: existingDupes } = await supabase.from('reels_queue')
    .select('id')
    .eq('source_hash', sourceUrlHash)
    .eq('status', 'PUBLISHED')
    .neq('id', item.id)
    .limit(1);

  if (existingDupes && existingDupes.length > 0) {
    const warnMsg = `⚠️ DUPLICATE DETECTED — URL hash ${sourceUrlHash} was already posted (item ${existingDupes[0].id}). Skipping to avoid copyright flag.`;
    console.warn(warnMsg);
    await supabase.from('reels_queue').update({ status: 'SKIPPED', error_log: warnMsg }).eq('id', item.id);
    return;
  }

  // Note: The RPC already marked it as PROCESSING, so we just update the hash and account
  const { data: updateData, error: updateError } = await supabase
    .from('reels_queue')
    .update({ 
      error_log: null, 
      source_hash: sourceUrlHash,
      account_id: targetAccount
    })
    .eq('id', item.id)
    .select();

  if (updateError) {
    console.log(`⚠️ Failed to update hash for ${item.id}. Skipping.`);
    return;
  }

  let fileId;
  let rawUploadStoragePath = null;
  let videoMetadata = null;
  const isDirectUpload = item.url.startsWith('supabase://');

  try {
    fileId = crypto.randomBytes(8).toString('hex');
    const tempDir = os.tmpdir();
    const tempFileTemplate = path.join(tempDir, `${fileId}.%(ext)s`);

    let cookiePath = null;
    const persistentCookiePath = path.join(__dirname, `cookies_${targetAccount}.txt`);
    if (fs.existsSync(persistentCookiePath)) {
      cookiePath = persistentCookiePath;
      console.log(`Using persistent master cookie file for ${targetAccount}`);
    } else if (IG_SESSION_ID) {
      cookiePath = path.join(tempDir, `cookies_${fileId}.txt`);
      const cookieContent = `# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\t${IG_SESSION_ID}\n`;
      fs.writeFileSync(cookiePath, cookieContent);
    }

    let downloadedFile = null;

    if (isDirectUpload) {
      rawUploadStoragePath = item.url.replace('supabase://', '');
      console.log(`Direct upload detected. Downloading from R2: ${rawUploadStoragePath}`);

      const ext = path.extname(rawUploadStoragePath) || '.mp4';
      downloadedFile = `${fileId}_raw${ext}`;
      const destPath = path.join(tempDir, downloadedFile);

      const getRawCmd = new GetObjectCommand({ Bucket: bucketName, Key: rawUploadStoragePath });
      const getRawRes = await S3.send(getRawCmd);
      const arrayBuffer = await getRawRes.Body.transformToByteArray();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));

    } else {
      console.log(`Downloading video ${item.url} via yt-dlp (best quality)...`);
      let downloadSuccess = false;
      let lastDownloadError = null;

      // Allow up to 3 proxy rotation retries (or more if many proxies)
      const maxRetries = Math.max(1, Math.min(3, IG_PROXIES.length || 1));
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const ytDlpOptions = [
          '-o', tempFileTemplate, 
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best', 
          '--no-playlist', 
          '--merge-output-format', 'mp4',
          '--sleep-requests', '3',
          '--sleep-interval', '10',
          '--max-sleep-interval', '30',
          '--fragment-retries', '5'
        ];

        if (cookiePath && item.url.includes('instagram.com')) {
          ytDlpOptions.push('--cookies', cookiePath);
        }

        const proxy = getNextProxy();
        if (proxy) {
          // Hide password in logs
          const safeProxyLog = proxy.includes('@') ? proxy.split('@').pop() : proxy;
          console.log(`[Attempt ${attempt}/${maxRetries}] Using proxy: ${safeProxyLog}`);
          ytDlpOptions.push('--proxy', proxy);
        }

        try {
          // Extract original metadata for context (with proxy)
          try {
            const dumpOpts = ['--dump-json', '--no-playlist', item.url];
            if (proxy) { dumpOpts.push('--proxy', proxy); }
            if (cookiePath && item.url.includes('instagram.com')) { dumpOpts.push('--cookies', cookiePath); }
            const dumpRes = await execa(ytDlpBinary, dumpOpts);
            if (dumpRes.stdout) videoMetadata = JSON.parse(dumpRes.stdout);
          } catch (dumpErr) { }

          await execa(ytDlpBinary, [...ytDlpOptions, item.url]);
          downloadSuccess = true;
          break; // Success, exit retry loop
        } catch (err) {
          lastDownloadError = err;
          console.warn(`[Attempt ${attempt}/${maxRetries}] Download failed:`, err.message.substring(0, 150));
          if (err.message.includes('429') || err.message.includes('401') || err.message.includes('blocked')) {
             if (attempt < maxRetries) {
               console.log(`IP block detected! Rotating to next proxy and retrying in 5 seconds...`);
               await sleep(5000);
             }
          } else {
             // If it's not a block, no need to burn through proxies
             break;
          }
        }
      }

      if (!downloadSuccess) {
         throw lastDownloadError || new Error('Download failed after proxy rotation');
      }

      const files = fs.readdirSync(tempDir);
      downloadedFile = files.find(f => f.startsWith(fileId) && !f.endsWith('.txt') && !f.endsWith('.json'));
      if (!downloadedFile) throw new Error('Failed to find downloaded video file');
    }

    const inputPath = path.join(tempDir, downloadedFile);
    const outputPath = path.join(tempDir, `${fileId}_transformed.mp4`);
    const coverPath = path.join(tempDir, `${fileId}_cover.jpg`);

    // ─── Thumbnail Extraction moved to post-transformation to ensure randomness and copyright shielding ───

    // ═══════════════════════════════════════════════════════════════
    // 🛡️ ANTI-COPYRIGHT SHIELD — 10-Layer Transform Pipeline
    // ═══════════════════════════════════════════════════════════════
    const params = generateAntiCopyrightParams(targetAccount, accountConfig);

    console.log(`\n🛡️ Anti-Copyright Shield v2.0 — 10-Layer Pipeline for ${targetAccount}`);
    console.log(`  L1 Visual: crop(${params.cropX}x${params.cropY}) bright(${params.brightness}) contrast(${params.contrast}) sat(${params.saturation}) gamma(${params.gamma}) noise(${params.noiseStrength}) mirror(${params.doMirror}) fps(${params.frameRate})`);
    console.log(`  L2 Audio: speed(${params.audioSpeedFactor}) stereoSwap(${params.doStereoSwap}) silence(${params.silenceMs}ms) reverb(${params.doReverb}) bgNoise(${params.bgNoiseMix}dB)`);
    console.log(`  L3 Temporal: trimStart(${params.trimStart}s) trimEnd(${params.trimEnd}s) pts(${params.ptsFactor}) gop(${params.gopSize})`);
    console.log(`  L4 Encoding: preset(${params.preset}) vBitrate(${params.videoBitrate}) maxRate(${params.maxRate}) aBitrate(${params.audioBitrate}) profile(${params.profile})`);
    console.log(`  L5 Device: ${params.device.make} ${params.device.model} (${params.device.encoder})`);
    console.log(`  L6 Overlay: ${params.watermarkText} @ ${params.watermarkOpacity} opacity, ${params.watermarkSize}px`);
    console.log(`  L7 Color: ${params.colorGrade}`);
    console.log(`  L8 Dedup: sourceHash=${sourceUrlHash}`);
    console.log(`  L9 Geometric Warp: lensDistortion(${params.lensDistortion}) rotation(${params.rotAngle}deg)`);
    console.log(`  L10 Audio Scramble: phaser(${params.doPhaser}) fade(${params.fadeDuration}s)`);

    // --- Build video filter chain ---
    const vfParts = [];

    // Layer 1: Visual Obfuscation
    // Crop subtle 1-3% to hide edge artifacts/watermarks
    vfParts.push(`crop=iw*(1-${params.cropX}/100):ih*(1-${params.cropY}/100)`);
    // Scale and crop to fill the full 1080x1920 9:16 vertical Reel frame with ZERO black letterbox bars!
    vfParts.push(`scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos`);
    vfParts.push('crop=1080:1920');
    vfParts.push('setsar=1');

    // Layer 1: Random horizontal mirror (50% chance)
    if (params.doMirror) vfParts.push('hflip');

    // Layer 1: Randomized brightness/contrast/saturation/gamma
    vfParts.push(`eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}:gamma=${params.gamma}`);

    // Layer 1: Randomized noise injection (spatial only for speed)
    vfParts.push(`noise=alls=${params.noiseStrength}:allf=u`);

    // Layer 7: Random color grading
    if (params.colorGrade) {
      vfParts.push(params.colorGrade);
    }

    // Layer 3: Temporal PTS shift (subtle speed variation)
    vfParts.push(`setpts=PTS*${params.ptsFactor}`);

    // Layer 6: Branded watermark overlay
    vfParts.push(`drawtext=text='${params.watermarkText}':fontsize=${params.watermarkSize}:fontcolor=white@${params.watermarkOpacity}:x=w-tw-20:y=h-th-20`);

    // Layer 9: Subtle hue shift (rotates colors by 1-2 degrees, imperceptible but defeats color histograms)
    vfParts.push(`hue=h=${randInt(1, 2)}`);

    // Layer 10: Vignette (DISABLED for account2 and account3 to prevent edge shadow/darkness)
    if (targetAccount !== 'account2' && targetAccount !== 'account3') {
      vfParts.push(`vignette=PI/4+PI/${randInt(18, 32)}`);
    }

    // Layer 11: Invisible moving text hash (moves across the screen at 1% opacity, invisible to humans, completely breaks structural similarity algorithms)
    const invisibleHash = Math.random().toString(36).substring(2, 10);
    vfParts.push(`drawtext=text='${invisibleHash}':fontsize=50:fontcolor=white@0.01:x=w*t/15:y=h*t/20`);

    // Layer 9: Geometric Distortion (Micro-rotation with no black borders)
    vfParts.push(`rotate=${params.rotAngle}*PI/180:ow=1080:oh=1920`);

    // Force SAR to 1:1 and yuv420p output (prevents concat errors)
    vfParts.push('setsar=1');
    vfParts.push('format=yuv420p');

    const videoFilterChain = vfParts.join(',');

    // --- Build audio filter chain ---
    const afParts = [];

    // Layer 2: Random speed/tempo (keeps pitch the same, stays exactly in sync with video PTS)
    if (params.audioSpeedFactor !== "1.0000") {
      afParts.push(`atempo=${params.audioSpeedFactor}`);
    }

    // Layer 2: Highpass + lowpass (always applied, prevents DC offset & ultrasonic noise)
    afParts.push('highpass=f=35');
    afParts.push('lowpass=f=17500');

    // Layer 2: EQ boost (account-specific frequency)
    if (targetAccount === 'account2') {
      afParts.push(`equalizer=f=${randInt(15000, 17000)}:width_type=h:width=1000:g=${randFloat(0.8, 1.5).toFixed(1)}`);
    } else {
      afParts.push(`equalizer=f=${randInt(13000, 15000)}:width_type=h:width=1000:g=${randFloat(0.5, 1.2).toFixed(1)}`);
    }

    // Layer 2: Stereo channel swap (50% chance)
    if (params.doStereoSwap) {
      afParts.push('pan=stereo|c0=c1|c1=c0');
    }

    // Layer 2: Subtle reverb (40% chance)
    if (params.doReverb) {
      afParts.push(`aecho=0.8:0.88:${randInt(4, 8)}:${randFloat(0.20, 0.35).toFixed(2)}`);
    }

    // Layer 10: Smooth fade-in
    afParts.push(`afade=t=in:st=0:d=${params.fadeDuration}`);

    const audioFilterChain = afParts.join(',');

    // --- Probe duration for temporal trimming (Layer 3) ---
    let videoDuration = null;
    try {
      const durationProbe = await execa('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', inputPath
      ]);
      videoDuration = parseFloat(durationProbe.stdout?.trim());
    } catch (e) { }

    // Calculate trim end time
    let trimEndTime = null;
    if (videoDuration && !isNaN(videoDuration) && videoDuration > 2 && parseFloat(params.trimEnd) > 0) {
      trimEndTime = (videoDuration - parseFloat(params.trimEnd)).toFixed(3);
    }

    // --- Build full FFmpeg command ---
    const ffmpegArgs = [ '-y' ];
    
    if (parseFloat(params.trimStart) > 0) {
      ffmpegArgs.push('-ss', params.trimStart); // Layer 3: Random trim from start
    }

    if (trimEndTime) {
      ffmpegArgs.push('-to', trimEndTime);      // Layer 3: Random trim from end
    }

    ffmpegArgs.push(
      '-i', inputPath,
      // Layer 8: Background noise (imperceptible brown noise at 1.2% volume)
      '-f', 'lavfi', '-i', 'anoisesrc=color=brown:r=48000:amplitude=0.012',
      '-map_metadata', '-1',                        // Strip ALL original metadata
      // Layer 5: Randomized device-spoofed metadata
      '-metadata', `title=${params.metaTitle}`,
      '-metadata', `artist=${params.metaArtist}`,
      '-metadata', `comment=${params.metaComment}`,
      '-metadata', `genre=${params.metaGenre}`,
      '-metadata', `make=${params.device.make}`,
      '-metadata', `model=${params.device.model}`,
      '-metadata', `encoder=${params.device.encoder}`,
      '-metadata', `handler_name=${params.device.handler}`,
      '-metadata', `creation_time=${params.creationTime}`,
      // Layer 1 + 6 + 7: Video filter chain
      '-vf', videoFilterChain,
      // Layer 2 + 8: Audio filter complex (mix original with brown noise)
      '-filter_complex', `[0:a]${audioFilterChain}[a1];[a1][1:a]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      // Layer 4: Highest Quality Encoding parameters
      '-r', params.frameRate,
      '-c:v', 'libx264',
      '-preset', params.preset,
      '-profile:v', params.profile,
      '-tune', params.tune,
      '-level', params.level,
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-threads', '2',
      '-b:v', params.videoBitrate,
      '-maxrate', params.maxRate,
      '-bufsize', '24M',
      '-g', String(params.gopSize),
      '-c:a', 'aac',
      '-b:a', params.audioBitrate,
      '-ar', '48000',
      '-movflags', '+faststart',
      outputPath
    );

    await execa(ffmpegBinary, ffmpegArgs);

    // Layer 2: Inject random silence at the start (shifts audio waveform fingerprint)
    if (params.silenceMs > 0) {
      const silencePath = path.join(tempDir, `${fileId}_silence.mp4`);
      try {
        await execa(ffmpegBinary, [
          '-y',
          '-f', 'lavfi', '-t', (params.silenceMs / 1000).toFixed(3),
          '-i', `anullsrc=r=44100:cl=stereo`,
          '-i', outputPath,
          '-filter_complex', `[0:a][1:a]concat=n=2:v=0:a=1[outa]`,
          '-map', '1:v', '-map', '[outa]',
          '-c:v', 'copy', '-c:a', 'aac', '-b:a', params.audioBitrate,
          '-movflags', '+faststart',
          silencePath
        ]);
        // Replace output with silence-injected version
        fs.renameSync(silencePath, outputPath);
        console.log(`  ✅ Injected ${params.silenceMs}ms silence at audio start`);
      } catch (silErr) {
        console.warn(`  ⚠️ Silence injection failed (non-critical):`, silErr.message);
        // Clean up failed silence file
        try { fs.unlinkSync(silencePath); } catch (e) { }
      }
    }

    // ─── Branded Intro/Outro Frames (Only for account1; disabled for account2 & account3 to eliminate black intro frames) ───
    if (targetAccount === 'account1') {
      console.log(`🎬 Adding branded intro/outro frames for account1...`);
      const introOutroPath = path.join(tempDir, `${fileId}_branded.mp4`);
      try {
        const introDuration = 0.5;
        const outroDuration = 0.8;
        const introText = '@faith.canvas.99';
        const outroText = 'Follow @faith.canvas.99 for daily reminders';

        // Build intro/outro with color source + text overlay, then concat with main video
        await execa(ffmpegBinary, [
          '-y',
          // Input 0: Intro
          '-f', 'lavfi', '-t', String(introDuration),
          '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${introText}':fontsize=36:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(introDuration - 0.2).toFixed(1)}:d=0.2,setsar=1`,
          // Input 1: Intro silent audio
          '-f', 'lavfi', '-t', String(introDuration),
          '-i', 'anullsrc=r=44100:cl=stereo',
          // Input 2: Main video
          '-i', outputPath,
          // Input 3: Outro
          '-f', 'lavfi', '-t', String(outroDuration),
          '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${outroText}':fontsize=28:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(outroDuration - 0.3).toFixed(1)}:d=0.3,setsar=1`,
          // Input 4: Outro silent audio
          '-f', 'lavfi', '-t', String(outroDuration),
          '-i', 'anullsrc=r=44100:cl=stereo',
          // Concat intro + main + outro
          '-filter_complex',
          `[0:v]fps=${params.frameRate}[v0]; [2:v]fps=${params.frameRate}[v1]; [3:v]fps=${params.frameRate}[v2]; [v0][1:a][v1][2:a][v2][4:a]concat=n=3:v=1:a=1[outv][outa]`,
          '-map', '[outv]', '-map', '[outa]',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main',
          '-c:a', 'aac', '-b:a', params.audioBitrate,
          '-movflags', '+faststart', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M',
          introOutroPath
        ]);

        // Replace output with branded version
        fs.renameSync(introOutroPath, outputPath);
        console.log(`  ✅ Branded intro (${introDuration}s) + outro (${outroDuration}s) added for account1!`);
      } catch (brandErr) {
        console.warn(`  ⚠️ Intro/outro failed (non-critical, using video without):`, brandErr.message);
        try { fs.unlinkSync(introOutroPath); } catch (e) { }
      }
    } else {
      console.log(`🎬 Clean start for ${targetAccount} (zero black frames)...`);
    }

    // Touch file modification timestamps to mirror fresh mobile capture
    try {
      const now = new Date();
      fs.utimesSync(outputPath, now, now);
    } catch (utimeErr) { }

    console.log(`  ✅ 10-Layer Anti-Copyright Shield + Quality Upgrades applied successfully!`);

    // ─── Random Thumbnail Extraction from Transformed Video ───
    console.log(`🖼️ Extracting random thumbnail from transformed video (for anti-copyright shield)...`);
    let randomTimeStr = '1.5';
    try {
      // Pick a random time between 15% and 80% of video duration (excluding intro/outro)
      try {
        const probeRes = await execa('ffprobe', [
          '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', outputPath
        ]);
        const finalDuration = parseFloat(probeRes.stdout?.trim()) || 0;
        if (finalDuration > 3) {
          const minTime = finalDuration * 0.15;
          const maxTime = finalDuration * 0.80;
          randomTimeStr = (Math.random() * (maxTime - minTime) + minTime).toFixed(2);
        }
      } catch (e) { }

      await execa(ffmpegBinary, [
        '-y', '-ss', randomTimeStr, '-i', outputPath,
        '-vframes', '1', 
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.5:5:5:0', 
        '-q:v', '1',
        coverPath
      ]);
      console.log(`   ✅ Extracted random transformed frame at t=${randomTimeStr}s`);
    } catch (coverErr) {
      console.warn('   ⚠️ Failed to extract random cover frame:', coverErr.message);
    }

    // AI Caption Generation (Multimodal Visual Analysis of Video Frame + Metadata Context)
    console.log(`Generating AI Caption based on video visual analysis & metadata...`);
    const caption = await generateCaption(item.url, rawUploadStoragePath, targetAccount, coverPath, videoMetadata);

    // Upload Transformed Video & Cover to Cloudflare R2
    const uploadName = `${fileId}.mp4`;
    const coverName = `${fileId}_cover.jpg`;

    console.log(`Uploading transformed video to R2 (${uploadName})...`);
    const fileBuffer = fs.readFileSync(outputPath);
    const putObjectCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: uploadName,
      Body: fileBuffer,
      ContentType: 'video/mp4',
    });
    await S3.send(putObjectCmd);

    // Generate a presigned URL (valid 1 hour) so Meta can download the video
    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: uploadName });
    const publicVideoUrl = await getSignedUrl(S3, getCmd, { expiresIn: 3600 });
    console.log(`Presigned video URL generated for Meta (expires in 1h)`);

    let publicCoverUrl = null;
    if (fs.existsSync(coverPath)) {
      console.log(`Uploading cover image thumbnail to R2 (${coverName})...`);
      const coverStream = fs.createReadStream(coverPath);
      await S3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: coverName,
        Body: coverStream,
        ContentType: 'image/jpeg',
      })).catch(e => console.warn('Cover R2 upload failed:', e.message));

      try {
        const getCoverCmd = new GetObjectCommand({ Bucket: bucketName, Key: coverName });
        // Presign cover URL for 7 days (604,800s) so Meta CDN fetch succeeds cleanly!
        publicCoverUrl = await getSignedUrl(S3, getCoverCmd, { expiresIn: 604800 });
        console.log(`Presigned 7-day cover URL generated for Meta`);
      } catch (e) {
        console.warn('Failed to presign cover URL:', e.message);
      }
    }

    // Meta Reel Upload with Native Server-Side thumb_offset + cover_url
    console.log(`Creating Meta Reel container for ${targetAccount}...`);
    const thumbOffsetMs = Math.floor(parseFloat(randomTimeStr) * 1000);

    const metaPayload = {
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: caption,
      thumb_offset: thumbOffsetMs,
      share_to_feed: 'true',
      access_token: PAGE_ACCESS_TOKEN
    };
    if (publicCoverUrl) metaPayload.cover_url = publicCoverUrl;

    // Log the exact caption and thumbnail config being sent
    console.log(`📝 AI Caption (first 150 chars):\n${caption.substring(0, 150)}...`);
    console.log(`🖼️ thumb_offset: ${thumbOffsetMs}ms | cover_url: ${publicCoverUrl ? 'YES' : 'NO'}`);

    const createRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(metaPayload).toString()
    });
    const createData = await createRes.json();
    if (createData.error) {
      throw new Error(`Meta API Create Error: ${createData.error.error_user_msg || createData.error.message}`);
    }
    const creation_id = createData.id;
    console.log(`✅ Meta container created: ${creation_id}`);
    await supabase.from('reels_queue').update({ creation_id }).eq('id', item.id);

    // Poll Meta Status
    console.log(`Polling Meta container status...`);
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 36) {
      attempts++;
      await sleep(5000);
      const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creation_id}?${new URLSearchParams({ fields: 'status_code', access_token: PAGE_ACCESS_TOKEN })}`);
      const statusData = await statusRes.json();
      if (statusData.status_code === 'FINISHED') isReady = true;
      else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
        throw new Error(`Meta Processing Failed: ${statusData.status_code}`);
      }
    }
    if (!isReady) throw new Error('Timeout waiting for Meta to process reel container');

    // Meta Publish
    console.log(`Publishing Reel to Instagram...`);
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish?${new URLSearchParams({ creation_id, access_token: PAGE_ACCESS_TOKEN })}`, { method: 'POST' });
    const publishData = await publishRes.json();
    if (publishData.error) {
      throw new Error(`Meta API Publish Error: ${publishData.error.error_user_msg || publishData.error.message}`);
    }

    console.log(`✅ Reel published successfully for ${targetAccount}! 🎉`);

    // Mark PUBLISHED immediately in Supabase
    await supabase.from('reels_queue').update({ status: 'PUBLISHED', error_log: null }).eq('id', item.id);

    const now = Date.now();
    const nextIntervalMins = randFloat(20, 25);
    const nextPostTime = now + Math.round(nextIntervalMins * 60 * 1000);
    scheduledNextPost[targetAccount] = nextPostTime;

    // Update last_published, next_scheduled, and last_published_global in R2
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `last_published_${targetAccount}.txt`,
      Body: now.toString(),
      ContentType: 'text/plain'
    })).catch(e => console.error(e));

    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `next_scheduled_${targetAccount}.txt`,
      Body: nextPostTime.toString(),
      ContentType: 'text/plain'
    })).catch(e => console.error(e));

    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: 'last_published_global.txt',
      Body: now.toString(),
      ContentType: 'text/plain'
    })).catch(e => console.error(e));

    console.log(`⏱️ Next post for ${targetAccount} scheduled in ${nextIntervalMins.toFixed(1)} minutes (at ${new Date(nextPostTime).toLocaleTimeString()})`);

    // Cleanup R2 temporary video asset (keep cover image on R2 so Meta image fetcher never 404s!)
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadName })).catch(e => console.error(e));
    if (rawUploadStoragePath) {
      await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: rawUploadStoragePath })).catch(e => console.error(e));
    }
    console.log(`Temporary video file ${uploadName} and raw source cleaned up from R2. Cover image ${coverName} preserved for Meta.`);

  } catch (processError) {
    console.error(`❌ Error processing item ${item.id} for ${targetAccount}:`, processError.message);
    await supabase.from('reels_queue').update({ status: 'FAILED', error_log: processError.message }).eq('id', item.id);
    
    // Emergency Cooldown on 429 or 401
    if (processError.message.includes('429') || processError.message.includes('401')) {
      console.log(`🚨 INSTAGRAM BAN DETECTED (429/401). Triggering 60-minute emergency cooldown for ${targetAccount}!`);
      try {
        const cooldownTime = Date.now() + 60 * 60 * 1000;
        await S3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: `rate_limit_${targetAccount}.txt`,
          Body: cooldownTime.toString(),
          ContentType: 'text/plain'
        }));
      } catch (e) {
        console.error('Failed to set rate limit:', e.message);
      }
    }
  } finally {
    // ALWAYS release global lock on exit (success or failure)
    await releaseGlobalLock(targetAccount);

    try {
      if (fileId) {
        const tempDir = os.tmpdir();
        const leftoverFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(fileId));
        for (const f of leftoverFiles) {
          try { fs.unlinkSync(path.join(tempDir, f)); } catch (e) { }
        }
        await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: `${fileId}.mp4` })).catch(e => console.error(e));
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
}

// In-memory cache for next scheduled post time per account
const scheduledNextPost = {};

// Continuous Daemon Loop
async function startDaemon() {
  console.log(`\n======================================================`);
  console.log(`🚀 Standalone 24/7 Reel Auto-Poster Daemon Started`);
  console.log(`⏱️ Schedule: Every 20-25 minutes per account independently`);
  console.log(`🔒 Global Mutex: STRICTLY 1 video rendering/publishing at a time`);
  console.log(`⏱️ Cross-Account Staggering: Min ${GLOBAL_MIN_STAGGER_MINS} minutes between ANY account posts`);
  console.log(`======================================================\n`);

  const supportedAccounts = ['account1', 'account2', 'account3'];

  // Track last log time per account to avoid spamming "waiting" logs
  const lastWaitLog = {};

  while (true) {
    for (const targetAccount of supportedAccounts) {
      try {
        const now = Date.now();

        // 0. Check Emergency Cooldown
        try {
          const rlCmd = new GetObjectCommand({ Bucket: bucketName, Key: `rate_limit_${targetAccount}.txt` });
          const rlRes = await S3.send(rlCmd);
          const rlUntil = parseInt(await rlRes.Body.transformToString(), 10);
          if (now < rlUntil) {
            const minsLeft = ((rlUntil - now) / 60000).toFixed(1);
            const logKey = `RL_${targetAccount}`;
            const lastLog = lastWaitLog[logKey] || 0;
            if (now - lastLog > 5 * 60 * 1000) {
              console.log(`[${targetAccount}] 🚨 EMERGENCY COOLDOWN ACTIVE. ${minsLeft} minutes remaining before resuming.`);
              lastWaitLog[logKey] = now;
            }
            continue; // Skip processing for this account until cooldown is over
          }
        } catch (e) {
          // No rate limit file, proceed
        }

        // Thumbnail Hydration Pass (Check 1 item missing thumbnail)
        let hydrateQuery = supabase.from('reels_queue').select('id, url').is('thumbnail_url', null).limit(1);
        if (targetAccount === 'account1') {
          hydrateQuery = hydrateQuery.or('account_id.eq.account1,account_id.is.null');
        } else {
          hydrateQuery = hydrateQuery.eq('account_id', targetAccount);
        }
        const { data: missingThumbs, error: thumbErr } = await hydrateQuery;
        
        if (!thumbErr && missingThumbs && missingThumbs.length > 0) {
          const tItem = missingThumbs[0];
          console.log(`[${targetAccount}] 🖼️ Hydrating missing thumbnail for ${tItem.id}...`);
          try {
            const ytDlpThumbOpts = ['--dump-json', '--no-playlist', '--no-warnings'];
            const proxyToUse = getNextProxy();
            if (proxyToUse) ytDlpThumbOpts.push('--proxy', proxyToUse);
            
            let tmpCookie = null;
            if (process.env.IG_SESSION_ID && tItem.url.includes('instagram.com')) {
              tmpCookie = path.join(os.tmpdir(), `cookie_thumb_${tItem.id}.txt`);
              fs.writeFileSync(tmpCookie, `# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\t${process.env.IG_SESSION_ID}\n`);
              ytDlpThumbOpts.push('--cookies', tmpCookie);
            }
            
            const dumpRes = await execa(ytDlpBinary, [...ytDlpThumbOpts, tItem.url]);
            if (tmpCookie) try { fs.unlinkSync(tmpCookie); } catch(e){}
            const meta = JSON.parse(dumpRes.stdout);
            if (meta.thumbnail) {
              await supabase.from('reels_queue').update({ thumbnail_url: meta.thumbnail }).eq('id', tItem.id);
              console.log(`   ✅ Thumbnail hydrated.`);
            } else {
              await supabase.from('reels_queue').update({ thumbnail_url: 'FAILED' }).eq('id', tItem.id);
              console.log(`   ❌ Thumbnail not found in metadata.`);
            }
          } catch (e) {
            await supabase.from('reels_queue').update({ thumbnail_url: 'FAILED' }).eq('id', tItem.id);
            console.log(`   ❌ Thumbnail hydration failed: ${e.message.split('\n')[0]}`);
          }
        }

        // 1. Check active PROCESSING items and auto-recover stale ones (>15 min)
        let procQuery = supabase.from('reels_queue').select('*').eq('status', 'PROCESSING');
        if (targetAccount === 'account1') {
          procQuery = procQuery.or('account_id.eq.account1,account_id.is.null');
        } else {
          procQuery = procQuery.eq('account_id', targetAccount);
        }

        const { data: activeProcs } = await procQuery;
        if (activeProcs && activeProcs.length > 0) {
          const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
          const staleItems = activeProcs.filter(item => new Date(item.created_at).getTime() < fifteenMinsAgo);
          if (staleItems.length > 0) {
            console.log(`[${targetAccount}] 🔄 Resetting ${staleItems.length} stuck PROCESSING item(s) (>15m) back to PENDING...`);
            await supabase.from('reels_queue').update({ status: 'PENDING', error_log: 'Reset stuck PROCESSING state (>15m)' }).in('id', staleItems.map(i => i.id));
          }
          // If an item is still actively processing within 15 min, wait for it
          continue;
        }

        // 2. Check if there are pending items in the queue for this account
        let pendQuery = supabase.from('reels_queue').select('id', { count: 'exact', head: true }).eq('status', 'PENDING');
        if (targetAccount === 'account1') {
          pendQuery = pendQuery.or('account_id.eq.account1,account_id.is.null');
        } else {
          pendQuery = pendQuery.eq('account_id', targetAccount);
        }
        const { count: pendingCount } = await pendQuery;
        if (!pendingCount || pendingCount === 0) {
          // No items in queue for this account, move to next
          continue;
        }

        // 3. Check Global Staggering Interval across ALL accounts (Min 7 mins between ANY post)
        let lastGlobalPub = 0;
        try {
          const gCmd = new GetObjectCommand({ Bucket: bucketName, Key: 'last_published_global.txt' });
          const gRes = await S3.send(gCmd);
          lastGlobalPub = parseInt(await gRes.Body.transformToString(), 10);
        } catch (e) {}

        const globalElapsedMins = (now - lastGlobalPub) / 60000;
        if (lastGlobalPub > 0 && globalElapsedMins < GLOBAL_MIN_STAGGER_MINS) {
          const staggerWaitLeft = (GLOBAL_MIN_STAGGER_MINS - globalElapsedMins).toFixed(1);
          const gLogKey = `GLOBAL_STAGGER`;
          const lastGLog = lastWaitLog[gLogKey] || 0;
          if (now - lastGLog > 2 * 60 * 1000) {
            console.log(`[GLOBAL] ⏱️ Global stagger active: waiting ~${staggerWaitLeft} min before ANY account can post (avoiding simultaneous posts).`);
            lastWaitLog[gLogKey] = now;
          }
          continue; // Wait for global stagger before processing any account
        }

        // 4. Fetch last_published timestamp for this specific account from R2
        let lastPub = 0;
        try {
          const command = new GetObjectCommand({ Bucket: bucketName, Key: `last_published_${targetAccount}.txt` });
          const response = await S3.send(command);
          const text = await response.Body.transformToString();
          lastPub = parseInt(text, 10);
        } catch (e) {
          // No timestamp file = never published
        }

        // 5. Fetch next_scheduled timestamp for this specific account
        let nextScheduled = scheduledNextPost[targetAccount] || 0;
        if (!nextScheduled) {
          try {
            const command = new GetObjectCommand({ Bucket: bucketName, Key: `next_scheduled_${targetAccount}.txt` });
            const response = await S3.send(command);
            const text = await response.Body.transformToString();
            nextScheduled = parseInt(text, 10);
            scheduledNextPost[targetAccount] = nextScheduled;
          } catch (e) {
            // No next_scheduled file yet
          }
        }

        // 6. Determine whether ready to post (20-25 min per-account interval)
        let isReady = false;

        if (lastPub === 0) {
          // First video ever or reset queue — post immediately!
          console.log(`[${targetAccount}] 🆕 No previous post found — ready to post!`);
          isReady = true;
        } else {
          // If nextScheduled is missing or invalid, generate a 20-25 min target
          if (!nextScheduled || isNaN(nextScheduled) || nextScheduled < lastPub) {
            const intervalMins = randFloat(20, 25);
            nextScheduled = lastPub + Math.round(intervalMins * 60 * 1000);
            scheduledNextPost[targetAccount] = nextScheduled;
            await S3.send(new PutObjectCommand({
              Bucket: bucketName,
              Key: `next_scheduled_${targetAccount}.txt`,
              Body: nextScheduled.toString(),
              ContentType: 'text/plain'
            })).catch(e => {});
          }

          if (now >= nextScheduled) {
            const minsSinceLastPost = ((now - lastPub) / 60000).toFixed(1);
            console.log(`[${targetAccount}] ⏰ 20-25 min cooldown elapsed (${minsSinceLastPost} min since last post) — ready to post!`);
            isReady = true;
          } else {
            const waitMinsLeft = ((nextScheduled - now) / 60000).toFixed(1);
            const minsSinceLastPost = ((now - lastPub) / 60000).toFixed(1);
            const logKey = `${targetAccount}`;
            const lastLog = lastWaitLog[logKey] || 0;
            if (now - lastLog > 2 * 60 * 1000) {
              console.log(`[${targetAccount}] ⏳ Next post in ~${waitMinsLeft} min (${minsSinceLastPost} min elapsed since last post) [${pendingCount} video(s) queued]`);
              lastWaitLog[logKey] = now;
            }
            isReady = false;
          }
        }

        if (isReady) {
          // 7. Acquire Global Lock FIRST before claiming or processing
          const lockResult = await acquireGlobalLock(targetAccount, 'claiming');
          if (!lockResult.acquired) {
            const logKey = `LOCKED_${targetAccount}`;
            const lastLog = lastWaitLog[logKey] || 0;
            if (now - lastLog > 2 * 60 * 1000) {
              console.log(`[${targetAccount}] 🔒 Global lock held by "${lockResult.holder}" (locked ${lockResult.ageMins}m ago). Waiting.`);
              lastWaitLog[logKey] = now;
            }
            continue;
          }

          // 8. Claim oldest PENDING item in exact FIFO sequential order
          let claimQuery = supabase
            .from('reels_queue')
            .select('*')
            .eq('status', 'PENDING');

          if (targetAccount === 'account1') {
            claimQuery = claimQuery.or('account_id.eq.account1,account_id.is.null');
          } else {
            claimQuery = claimQuery.eq('account_id', targetAccount);
          }

          const { data: queueItems, error: claimError } = await claimQuery
            .order('created_at', { ascending: true })
            .limit(1);
            
          if (claimError) {
            console.error(`Claim Error for ${targetAccount}:`, claimError.message);
            await releaseGlobalLock(targetAccount);
            continue;
          }

          if (!queueItems || queueItems.length === 0) {
            await releaseGlobalLock(targetAccount);
            continue;
          }

          const item = queueItems[0];
          // Mark item as PROCESSING
          await supabase.from('reels_queue').update({ status: 'PROCESSING' }).eq('id', item.id);

          // 9. Immediately reserve schedule and global timestamp so no race condition can occur during FFmpeg render
          const nextIntervalMins = randFloat(20, 25);
          const nextPostTime = Date.now() + Math.round(nextIntervalMins * 60 * 1000);
          scheduledNextPost[targetAccount] = nextPostTime;
          await S3.send(new PutObjectCommand({ Bucket: bucketName, Key: `next_scheduled_${targetAccount}.txt`, Body: nextPostTime.toString(), ContentType: 'text/plain' })).catch(e => {});
          await S3.send(new PutObjectCommand({ Bucket: bucketName, Key: 'last_published_global.txt', Body: Date.now().toString(), ContentType: 'text/plain' })).catch(e => {});

          // Process the single claimed item in exact FIFO sequence (Global lock released in processSingleItem.finally)
          await processSingleItem(item, targetAccount);
        }
      } catch (loopErr) {
        console.error(`Error in daemon loop for ${targetAccount}:`, loopErr.message);
        await releaseGlobalLock(targetAccount).catch(e => {});
      }
    }

    // Poll every 15 seconds
    await sleep(15000);
  }
}

startDaemon();


