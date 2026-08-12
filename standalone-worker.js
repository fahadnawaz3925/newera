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

// Generate all randomized transform parameters for a single video
function generateAntiCopyrightParams(targetAccount) {
  // Layer 1: Randomized visual transforms
  const cropX = randFloat(0.96, 0.99).toFixed(4);
  const cropY = randFloat(0.96, 0.99).toFixed(4);
  const brightness = randFloat(0.005, 0.025).toFixed(4);
  const contrast = randFloat(1.01, 1.04).toFixed(3);
  const saturation = randFloat(1.01, 1.05).toFixed(3);
  const gamma = randFloat(1.005, 1.02).toFixed(4);
  const noiseStrength = randFloat(1.0, 2.5).toFixed(2);
  const doMirror = true; // 100% mirroring is the most effective way to defeat spatial hashing
  const frameRate = randPick(['29.97', '30', '30.03']);

  // Layer 2: Randomized audio transforms
  const audioSpeedFactor = randFloat(1.02, 1.04).toFixed(4); // 2-4% speed change completely breaks audio temporal hashing
  const audioPitchRate = (44100 * parseFloat(audioSpeedFactor)).toFixed(0);
  const doStereoSwap = Math.random() < 0.5;
  const silenceMs = randInt(50, 200);
  const doReverb = Math.random() < 0.4;
  const bgNoiseMix = randFloat(-50, -40).toFixed(1);

  // Layer 3: Temporal disruption
  const trimStart = randFloat(0.1, 0.5).toFixed(3);
  const trimEnd = randFloat(0.1, 0.5).toFixed(3);
  const ptsFactor = (1 / parseFloat(audioSpeedFactor)).toFixed(4); // Sync video speed with audio speed precisely
  const gopSize = randInt(18, 30);

  // Layer 4: Encoding diversification (Instagram-optimized quality)
  const preset = 'ultrafast'; // Force ultrafast because Oracle Cloud VM gets heavily throttled on any other preset
  const videoBitrate = randPick(['6M', '7M', '8M']);
  const maxRate = randPick(['8M', '10M']);
  const audioBitrate = randPick(['128k', '144k', '160k', '192k']);
  const profile = randPick(['high', 'main']);
  const tune = 'film';   // Better quality for real-world footage
  const level = '4.1';   // Max compatibility with mobile players

  // Layer 5: Device profile rotation
  const device = randPick(DEVICE_PROFILES);
  // Randomize creation_time to be within last 1-48 hours
  const hoursAgo = randFloat(1, 48);
  const creationTime = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

  // Layer 6: Branded overlay
  const watermarkText = targetAccount === 'account2' ? '@buffedboujee' : '@faith.canvas38';
  const watermarkOpacity = randFloat(0.20, 0.35).toFixed(2);
  const watermarkSize = randInt(13, 17);

  // Layer 7: Color grading
  const colorGrade = randPick(COLOR_GRADES);

  // Build account-specific content metadata
  let metaTitle, metaArtist, metaComment, metaGenre;
  if (targetAccount === 'account2') {
    metaTitle = randPick([
      'ASMR Leather Shoe Shining & Restoration | Buffed & Boujee',
      'Satisfying Shoe Shine ASMR | Buffed & Boujee',
      'Leather Restoration ASMR | Buffed & Boujee',
      'Shoe Care & Polish ASMR | Buffed & Boujee',
    ]);
    metaArtist = 'buffedboujee';
    metaComment = randPick([
      'ASMR Shoe Shine, Leather Restoration, Oddly Satisfying, Leather Polish, Shoe Care',
      'Shoe Shining ASMR, Leather Polish, Satisfying Restoration, Premium Shoe Care',
      'Leather Shoe ASMR, Mirror Shine Polish, Oddly Satisfying, Buffed & Boujee',
    ]);
    metaGenre = 'ASMR / How-to & Style';
  } else {
    metaTitle = randPick([
      'Islamic Reminders & Quran Recitation | Faith Canvas',
      'Daily Quran Reminders | Faith Canvas',
      'Beautiful Quran & Islamic Wisdom | Faith Canvas',
      'Islamic Motivation & Hadith | Faith Canvas',
    ]);
    metaArtist = 'faith.canvas38';
    metaComment = randPick([
      'Islamic Reminders, Quran, Sunnah, Deen Over Dunya, Taqwa, Dua, Dhikr, Hadith',
      'Quran Recitation, Islamic Wisdom, Deen, Sunnah, Taqwa, Daily Reminders',
      'Islamic Motivation, Hadith, Quran, Dua, Allah, Faith Canvas',
    ]);
    metaGenre = 'Nonprofit & Activism / Religious Reminders';
  }

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
async function generateCaption(videoUrl, rawPath, targetAccount, coverPath = null, videoMetadata = null) {
  const geminiKey = process.env.GEMINI_API_KEY;
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

  const promptAccount2 = `You are an expert viral Instagram Reel caption writer for @buffedboujee — a Leather Shoe Shine & ASMR page.
${videoContext ? 'Video details: ' + videoContext + '\n' : ''}
Analyze this video's visual frame carefully and write a caption that feels authentic, engaging, and tailored to THIS specific video.

RULES:
- NEVER use any selling, promotional, or commercial language. We are NOT selling anything.
- NEVER mention products, prices, services, links, or "DM us".
- The ONLY call to action allowed is: "Follow @buffedboujee for more satisfying content 👞✨"
- Keep it conversational — like a real person sharing something cool, not a brand.

STRUCTURE:
1. A short, punchy hook line that stops the scroll (e.g., "That first brush stroke though... 🤌", "Turn your sound UP 🎧🔥", "Watch till the end for the reveal ✨").
2. 2-3 sentences describing what's happening in THIS specific video — the shoe type, the transformation, the ASMR sounds, the satisfying moments.
3. CTA: "Follow @buffedboujee for more satisfying content 👞✨"
4. 6-8 hashtags mixing trending & niche: #ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning

Do NOT use markdown, code blocks, or header symbols (###). Write plain text only.`;

  const promptAccount1 = `You are an expert viral Instagram Reel caption writer for @faith.canvas38 — an Islamic Reminders & Quran page.
${videoContext ? 'Video details: ' + videoContext + '\n' : ''}
Analyze this video's visual frame carefully and write a beautiful, heartfelt caption tailored to THIS specific video's Islamic topic.

RULES:
- NEVER use any selling, promotional, or commercial language. We are NOT selling anything.
- NEVER mention products, links, courses, "DM us", or anything transactional.
- The ONLY call to action allowed is: "Follow @faith.canvas38 for daily reminders 🤲🕊️"
- Keep it sincere, warm, and spiritually uplifting — like a brother/sister sharing a reminder from the heart.

STRUCTURE:
1. An emotional hook that makes people pause (e.g., "This verse hit different today 📖💔", "Save this for your lowest days 🤲", "SubhanAllah, listen to this... 🕊️✨", "A reminder your soul needed right now 💚").
2. 2-3 sentences of heartfelt reflection related to THIS video's specific topic — connect it to daily life, struggles, gratitude, or closeness to Allah. Reference the specific Quran verse, hadith, or Islamic concept if visible/audible in the video.
3. CTA: "Follow @faith.canvas38 for daily reminders 🤲🕊️"
4. 6-8 hashtags mixing trending & niche: #Islam #Quran #IslamicReminders #Deen #Allah #Sunnah #Muslim #DeenOverDunya #Taqwa #Hadith

Do NOT use markdown, code blocks, or header symbols (###). Write plain text only.`;

  const prompt = targetAccount === 'account2' ? promptAccount2 : promptAccount1;

  if (geminiKey) {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const modelsToTry = ['gemini-3.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];

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
            console.log(`Quota 429 encountered, sleeping 3s before retry/next model...`);
            await sleep(3000);
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
  } else {
    const titleLine = videoTitleClean ? `✨ ${videoTitleClean}` : `A reminder your soul needed right now 🤲💚`;
    const descLine = videoDescClean ? videoDescClean.slice(0, 180) : `In the quiet moments of life, turn your heart to Allah. He is closer to you than you think. Trust His plan, even when the path feels unclear.`;
    return `${titleLine}\n\n${descLine}\n\nFollow @faith.canvas38 for daily reminders 🤲🕊️\n\n#Islam #Quran #IslamicReminders #Deen #Allah #Sunnah #Muslim #DeenOverDunya #Taqwa`;
  }
}

// Single Video Processor
async function processSingleItem(item, targetAccount) {
  let IG_BUSINESS_ACCOUNT_ID, PAGE_ACCESS_TOKEN, IG_SESSION_ID;

  if (targetAccount === 'account2') {
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

  await supabase.from('reels_queue').update({ status: 'PROCESSING', error_log: null, source_hash: sourceUrlHash }).eq('id', item.id);

  let fileId;
  let rawUploadStoragePath = null;
  let videoMetadata = null;
  const isDirectUpload = item.url.startsWith('supabase://');

  try {
    fileId = crypto.randomBytes(8).toString('hex');
    const tempDir = os.tmpdir();
    const tempFileTemplate = path.join(tempDir, `${fileId}.%(ext)s`);

    let cookiePath = null;
    if (IG_SESSION_ID) {
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
    // 🛡️ ANTI-COPYRIGHT SHIELD — 8-Layer Transform Pipeline
    // ═══════════════════════════════════════════════════════════════
    const params = generateAntiCopyrightParams(targetAccount);

    console.log(`\n🛡️ Anti-Copyright Shield v2.0 — 8-Layer Pipeline for ${targetAccount}`);
    console.log(`  L1 Visual: crop(${params.cropX}x${params.cropY}) bright(${params.brightness}) contrast(${params.contrast}) sat(${params.saturation}) gamma(${params.gamma}) noise(${params.noiseStrength}) mirror(${params.doMirror}) fps(${params.frameRate})`);
    console.log(`  L2 Audio: speed(${params.audioSpeedFactor}) stereoSwap(${params.doStereoSwap}) silence(${params.silenceMs}ms) reverb(${params.doReverb}) bgNoise(${params.bgNoiseMix}dB)`);
    console.log(`  L3 Temporal: trimStart(${params.trimStart}s) trimEnd(${params.trimEnd}s) pts(${params.ptsFactor}) gop(${params.gopSize})`);
    console.log(`  L4 Encoding: preset(${params.preset}) vBitrate(${params.videoBitrate}) maxRate(${params.maxRate}) aBitrate(${params.audioBitrate}) profile(${params.profile})`);
    console.log(`  L5 Device: ${params.device.make} ${params.device.model} (${params.device.encoder})`);
    console.log(`  L6 Overlay: ${params.watermarkText} @ ${params.watermarkOpacity} opacity, ${params.watermarkSize}px`);
    console.log(`  L7 Color: ${params.colorGrade}`);
    console.log(`  L8 Dedup: sourceHash=${sourceUrlHash}`);

    // --- Build video filter chain ---
    const vfParts = [];

    // Layer 1: Randomized crop
    vfParts.push(`crop=iw*${params.cropX}:ih*${params.cropY}`);

    // Layer 1: Random horizontal mirror (50% chance)
    if (params.doMirror) vfParts.push('hflip');

    // Scale to 1080x1920
    vfParts.push('scale=1080:1920:force_original_aspect_ratio=decrease');
    vfParts.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2');

    // Layer 1.5: Minimal Ken Burns effect (Dynamic Zoom)
    vfParts.push(`zoompan=z='min(pzoom+0.00010,1.05)':d=1:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':fps=30:s=1080x1920`);

    // Layer 1: Randomized brightness/contrast/saturation/gamma
    vfParts.push(`eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}:gamma=${params.gamma}`);

    // Layer 1: Randomized noise injection
    vfParts.push(`noise=alls=${params.noiseStrength}:allf=t+u`);

    // Layer 7: Random color grading
    vfParts.push(params.colorGrade);

    // Layer 3: Temporal PTS shift (subtle speed variation)
    vfParts.push(`setpts=PTS*${params.ptsFactor}`);

    // Layer 6: Branded watermark overlay
    vfParts.push(`drawtext=text='${params.watermarkText}':fontsize=${params.watermarkSize}:fontcolor=white@${params.watermarkOpacity}:x=w-tw-20:y=h-th-20`);

    // Layer 9: Subtle hue shift (rotates colors by 1-3 degrees, imperceptible but defeats color histograms)
    vfParts.push(`hue=h=${randInt(1, 3)}`);

    // Force yuv420p output (colorbalance converts to yuv444p which breaks main/high H.264 profiles)
    vfParts.push('format=yuv420p');

    const videoFilterChain = vfParts.join(',');

    // --- Build audio filter chain ---
    const afParts = [];

    // Layer 2: Random pitch shift via sample rate manipulation
    afParts.push(`asetrate=${params.audioPitchRate}`);
    afParts.push('aresample=44100');

    // Layer 2: Random speed/tempo
    afParts.push(`atempo=${params.audioSpeedFactor}`);

    // Layer 2: Highpass + lowpass (always applied, prevents DC offset & ultrasonic noise)
    afParts.push('highpass=f=35');
    afParts.push('lowpass=f=16500');

    // Layer 2: EQ boost (account-specific frequency)
    if (targetAccount === 'account2') {
      afParts.push(`equalizer=f=${randInt(15000, 17000)}:width_type=h:width=1000:g=${randFloat(1.0, 2.0).toFixed(1)}`);
    } else {
      afParts.push(`equalizer=f=${randInt(13000, 15000)}:width_type=h:width=1000:g=${randFloat(0.8, 1.5).toFixed(1)}`);
    }

    // Layer 2: Stereo channel swap (50% chance)
    if (params.doStereoSwap) {
      afParts.push('pan=stereo|c0=c1|c1=c0');
    }

    // Layer 2: Subtle reverb (40% chance)
    if (params.doReverb) {
      afParts.push(`aecho=0.8:0.88:${randInt(4, 8)}:${randFloat(0.25, 0.45).toFixed(2)}`);
    }

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
    if (videoDuration && !isNaN(videoDuration) && videoDuration > 2) {
      trimEndTime = (videoDuration - parseFloat(params.trimEnd)).toFixed(3);
    }

    // --- Build full FFmpeg command ---
    const ffmpegArgs = [
      '-y',
      '-ss', params.trimStart,                     // Layer 3: Random trim from start
    ];

    if (trimEndTime) {
      ffmpegArgs.push('-to', trimEndTime);          // Layer 3: Random trim from end
    }

    ffmpegArgs.push(
      '-i', inputPath,
      // Layer 8: Background noise (faint rain/brown noise at 2.5% volume)
      '-f', 'lavfi', '-i', 'anoisesrc=color=brown:r=44100:amplitude=0.025',
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
      // Layer 4: Randomized encoding parameters
      '-r', params.frameRate,
      '-c:v', 'libx264',
      '-preset', params.preset,
      '-profile:v', params.profile,
      '-tune', params.tune,                           // Better quality for real footage
      '-level', params.level,                          // Max mobile compatibility
      '-threads', '2',
      '-b:v', params.videoBitrate,
      '-maxrate', params.maxRate,
      '-bufsize', '24M',
      '-g', String(params.gopSize),                  // Layer 3: Random GOP size
      '-c:a', 'aac',
      '-b:a', params.audioBitrate,
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

    // ─── Branded Intro/Outro Frames ───
    console.log(`🎬 Adding branded intro/outro frames...`);
    const introOutroPath = path.join(tempDir, `${fileId}_branded.mp4`);
    try {
      const introDuration = 0.5;
      const outroDuration = 0.8;
      let introText, outroText, accentColor;

      if (targetAccount === 'account2') {
        introText = '@buffedboujee';
        outroText = 'Follow @buffedboujee for more';
        accentColor = '#D4A574';
      } else {
        introText = '@faith.canvas38';
        outroText = 'Follow @faith.canvas38 for daily reminders';
        accentColor = '#2E7D32';
      }

      // Build intro/outro with color source + text overlay, then concat with main video
      await execa(ffmpegBinary, [
        '-y',
        // Input 0: Intro (solid dark frame with text)
        '-f', 'lavfi', '-t', String(introDuration),
        '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${introText}':fontsize=36:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(introDuration - 0.2).toFixed(1)}:d=0.2`,
        // Input 1: Intro silent audio
        '-f', 'lavfi', '-t', String(introDuration),
        '-i', 'anullsrc=r=44100:cl=stereo',
        // Input 2: Main video
        '-i', outputPath,
        // Input 3: Outro (solid dark frame with text)
        '-f', 'lavfi', '-t', String(outroDuration),
        '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${outroText}':fontsize=28:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(outroDuration - 0.3).toFixed(1)}:d=0.3`,
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
      console.log(`  ✅ Branded intro (${introDuration}s) + outro (${outroDuration}s) added!`);
    } catch (brandErr) {
      console.warn(`  ⚠️ Intro/outro failed (non-critical, using video without):`, brandErr.message);
      try { fs.unlinkSync(introOutroPath); } catch (e) { }
    }

    // Touch file modification timestamps to mirror fresh mobile capture
    try {
      const now = new Date();
      fs.utimesSync(outputPath, now, now);
    } catch (utimeErr) { }

    console.log(`  ✅ 8-Layer Anti-Copyright Shield + Quality Upgrades applied successfully!`);

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
    const fileStream = fs.createReadStream(outputPath);
    const putObjectCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: uploadName,
      Body: fileStream,
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
      access_token: PAGE_ACCESS_TOKEN
    };

    if (publicCoverUrl) {
      metaPayload.cover_url = publicCoverUrl;
    }

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

    // Update last_published timestamp in R2
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `last_published_${targetAccount}.txt`,
      Body: Date.now().toString(),
      ContentType: 'text/plain'
    })).catch(e => console.error(e));

    // Cleanup R2 temporary video asset (keep cover image on R2 so Meta image fetcher never 404s!)
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadName })).catch(e => console.error(e));
    console.log(`Temporary video file ${uploadName} cleaned up from R2. Cover image ${coverName} preserved for Meta.`);

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
    try {
      if (fileId) {
        const tempDir = os.tmpdir();
        const leftoverFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(fileId));
        for (const f of leftoverFiles) {
          try { fs.unlinkSync(path.join(tempDir, f)); } catch (e) { }
        }
        await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: `${fileId}.mp4` })).catch(e => console.error(e));
        if (rawUploadStoragePath) {
          await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: rawUploadStoragePath })).catch(e => console.error(e));
        }
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
}

// Continuous Daemon Loop
async function startDaemon() {
  console.log(`\n======================================================`);
  console.log(`🚀 Standalone 24/7 Reel Auto-Poster Daemon Started`);
  console.log(`======================================================\n`);

  const supportedAccounts = ['account1', 'account2'];

  // Track last log time per account to avoid spamming "waiting" logs
  const lastWaitLog = {};

  while (true) {
    for (const targetAccount of supportedAccounts) {
      try {
        // 0. Check Emergency Cooldown
        try {
          const rlCmd = new GetObjectCommand({ Bucket: bucketName, Key: `rate_limit_${targetAccount}.txt` });
          const rlRes = await S3.send(rlCmd);
          const rlUntil = parseInt(await rlRes.Body.transformToString(), 10);
          if (Date.now() < rlUntil) {
            const minsLeft = ((rlUntil - Date.now()) / 60000).toFixed(1);
            const logKey = `RL_${targetAccount}`;
            const lastLog = lastWaitLog[logKey] || 0;
            if (Date.now() - lastLog > 5 * 60 * 1000) {
              console.log(`[${targetAccount}] 🚨 EMERGENCY COOLDOWN ACTIVE. ${minsLeft} minutes remaining before resuming.`);
              lastWaitLog[logKey] = Date.now();
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
        
        // If there's no thumbnail_url column yet, the query will throw an error, which we ignore
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
            }
          } catch (e) {
            // Ignore extraction failures so it doesn't block the queue
          }
        }

        // 1. Check active PROCESSING items — reset stale ones (>10 min)
        let procQuery = supabase.from('reels_queue').select('*').eq('status', 'PROCESSING');
        if (targetAccount === 'account1') {
          procQuery = procQuery.or('account_id.eq.account1,account_id.is.null');
        } else {
          procQuery = procQuery.eq('account_id', targetAccount);
        }

        const { data: activeProcs } = await procQuery;
        if (activeProcs && activeProcs.length > 0) {
          const tenMinsAgo = Date.now() - 10 * 60 * 1000;
          const staleItems = activeProcs.filter(item => new Date(item.created_at).getTime() < tenMinsAgo);
          if (staleItems.length > 0) {
            console.log(`Resetting ${staleItems.length} orphaned processing item(s) for ${targetAccount}...`);
            await supabase.from('reels_queue').update({ status: 'PENDING', error_log: 'Reset orphaned PROCESSING state (>10m)' }).in('id', staleItems.map(i => i.id));
            continue;
          } else {
            // Active item currently being processed, skip
            continue;
          }
        }

        // 2. Fetch last_published timestamp from R2
        let lastPub = 0;
        try {
          const command = new GetObjectCommand({ Bucket: bucketName, Key: `last_published_${targetAccount}.txt` });
          const response = await S3.send(command);
          const text = await response.Body.transformToString();
          lastPub = parseInt(text, 10);
        } catch (e) {
          // No timestamp file = never published = first video should go immediately
        }

        // 3. Fetch oldest PENDING item
        let query = supabase.from('reels_queue').select('*').eq('status', 'PENDING');
        if (targetAccount === 'account1') {
          query = query.or('account_id.eq.account1,account_id.is.null');
        } else {
          query = query.eq('account_id', targetAccount);
        }

        const { data: queueItems } = await query.order('created_at', { ascending: true }).limit(1);

        if (!queueItems || queueItems.length === 0) continue;

        const item = queueItems[0];

        // 4. Determine cooldown: first video = instant, rest = 20-25 min gap
        const now = Date.now();
        const msSinceLastPost = now - (isNaN(lastPub) ? 0 : lastPub);
        const minsSinceLastPost = msSinceLastPost / (1000 * 60);

        // Pick a random cooldown between 20-25 min for natural spacing
        const COOLDOWN_MIN = 20;
        const COOLDOWN_MAX = 25;
        const cooldownTarget = COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);

        let isReady = false;

        if (lastPub === 0) {
          // Never published before — post the first video immediately
          console.log(`[${targetAccount}] 🆕 No previous post found — processing first video immediately!`);
          isReady = true;
        } else if (minsSinceLastPost >= cooldownTarget) {
          // Enough time has passed since last post
          console.log(`[${targetAccount}] ⏰ ${minsSinceLastPost.toFixed(1)} min since last post (cooldown: ${cooldownTarget.toFixed(1)} min) — ready to post!`);
          isReady = true;
        } else {
          // Still in cooldown — log every 2 minutes to avoid spam
          const waitMinsLeft = (cooldownTarget - minsSinceLastPost).toFixed(1);
          const logKey = `${targetAccount}`;
          const lastLog = lastWaitLog[logKey] || 0;
          if (now - lastLog > 2 * 60 * 1000) {
            console.log(`[${targetAccount}] ⏳ Waiting ~${waitMinsLeft} min before next post (${minsSinceLastPost.toFixed(1)}/${cooldownTarget.toFixed(1)} min elapsed)`);
            lastWaitLog[logKey] = now;
          }
          isReady = false;
        }

        if (isReady) {
          await processSingleItem(item, targetAccount);
        }
      } catch (loopErr) {
        console.error(`Error in daemon loop for ${targetAccount}:`, loopErr.message);
      }
    }

    // Poll every 15 seconds
    await sleep(15000);
  }
}

startDaemon();
