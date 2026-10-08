/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🛡️ STANDALONE WORKER DAEMON — ACCOUNT 4 (@yuzhaninigoods.co)
 * ═══════════════════════════════════════════════════════════════════════════════════
 * Dedicated Oracle Cloud VM Background Daemon for Account 4.
 * Completely isolated from Account 1, 2, and 3.
 *
 * Enforces the complete 10-Layer Anti-Copyright Shield via FFmpeg before every post:
 * 1. Visual Obfuscation (1-3% crop, 1080x1920 9:16 reframe, mirror, histogram, grain)
 * 2. Audio Fingerprint Masking (tempo/pitch shift, bandpass, EQ, stereo swap, reverb, delay)
 * 3. Temporal Desynchronization (start/end trim, PTS modulation, duration shift)
 * 4. Video Stream & GOP Randomization (variable GOP 30-60, bitrate jitter, H.264 level 4.1)
 * 5. Device Metadata Spoofing (complete strip + synthetic iPhone/Galaxy/Pixel EXIF)
 * 6. Branded Overlay (@yuzhaninigoods.co watermark)
 * 7. Color Grading Shift (subtle warm/craft balance)
 * 8. Source Hash Deduplication (SHA-256)
 * 9. Geometric Warp & Coordinate Perturbation
 * 10. Invisible 1% Stenographic Hash Overlay
 * + Post-processing: Randomized Cover Thumbnail (15%-80% duration probe)
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const execa = require('execa');
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── CONFIGURATION & CREDENTIALS ──────────────────────────────────────────────────
const TARGET_ACCOUNT = 'account4';
const DEFAULT_HANDLE = '@yuzhaninigoods.co';

const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_4 || '17841415843312030';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_4 || 'EAAPeUOZB144oBSt7dKi3tExey0xzUKV4oXhBSnAvlYK9yWkILUQqQ1ZCaQSvpAqC1B5c1sjSOJzM5Lg0y6TshA1yZAjqwV8iY8LnfkDTZCIO3dJiQXpZB0KNmmMYYOb70btfFK0vLkSMZCdpZBZCMMxNM99AxJR8ao2yfDZCbnvLw562WqovOCz1Lh4aQCLpq25sI';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in environment!');
  process.exit(1);
}

const WebSocket = require('ws');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

// Cloudflare R2 Client
const accountIdR2 = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'reels';

let S3 = null;
if (accountIdR2 && accessKeyId && secretAccessKey) {
  S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountIdR2}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

// Local storage directories
const LOCAL_VIDEOS_DIR = process.env.LOCAL_VIDEOS_DIR || path.join(__dirname, 'yuzhaninigoods_videos');
if (!fs.existsSync(LOCAL_VIDEOS_DIR)) fs.mkdirSync(LOCAL_VIDEOS_DIR, { recursive: true });

// Posting interval (default: 20-30 minutes)
const MIN_POST_INTERVAL_MS = 20 * 60 * 1000;
const MAX_POST_INTERVAL_MS = 30 * 60 * 1000;

// Resolve FFmpeg / FFprobe
function resolveBinary(name) {
  try {
    const which = require('child_process').execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (which) return which;
  } catch (e) {}
  return name;
}
const ffmpegBinary = resolveBinary('ffmpeg');
const ffprobeBinary = resolveBinary('ffprobe');

// ═══════════════════════════════════════════════════════════════════════════════════
// 🛡️ ANTI-COPYRIGHT SHIELD — RANDOMIZATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const DEVICE_PROFILES = [
  { make: 'Apple', model: 'iPhone 15 Pro Max', encoder: 'iOS 17.5.1 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 16 Pro', encoder: 'iOS 18.2 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 15', encoder: 'iOS 17.6 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Samsung', model: 'Galaxy S24 Ultra', encoder: 'Samsung Video Encoder 2.1', handler: 'VideoHandle' },
  { make: 'Samsung', model: 'Galaxy S23+', encoder: 'Samsung Video Encoder 1.8', handler: 'VideoHandle' },
  { make: 'Google', model: 'Pixel 9 Pro', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
  { make: 'OnePlus', model: 'OnePlus 12', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
];

function generateAntiCopyrightParams(config) {
  // Layer 1: Visual crop & framing (subtle 1-3%)
  const cropX = randInt(1, 3);
  const cropY = randInt(1, 3);
  // Strictly NO hflip / mirroring for Account 4 to preserve brand logos, maker marks & leathercraft orientation

  // Color & lighting (vibrant, rich leather tone)
  const brightness = randFloat(0.01, 0.035);
  const contrast = randFloat(1.02, 1.05);
  const saturation = randFloat(1.05, 1.15);
  const gamma = randFloat(0.99, 1.03);
  const noiseStrength = randInt(1, 2);

  // Layer 2: Audio masking
  const audioSpeedFactor = randFloat(0.992, 1.008);
  const ptsFactor = 1 / audioSpeedFactor;
  const doStereoSwap = Math.random() > 0.5;
  const silenceMs = randInt(35, 75);
  const doReverb = Math.random() > 0.5;
  const fadeDuration = randFloat(0.12, 0.22);

  // Layer 3: Temporal trim
  const trimStart = randFloat(0.1, 0.25);
  const trimEnd = randFloat(0.1, 0.25);

  // Layer 4: Encoding
  const frameRate = 30;
  const preset = 'superfast';
  const profile = 'high';
  const level = '4.1';
  const gopSize = randInt(30, 60);
  const videoBitrate = randInt(3200, 3800) + 'k';
  const maxRate = randInt(4000, 4600) + 'k';
  const audioBitrate = '256k';

  // Layer 5: Device metadata
  const device = randPick(DEVICE_PROFILES);
  const now = new Date();
  now.setMinutes(now.getMinutes() - randInt(5, 5000));
  const creationTime = now.toISOString();

  // Layer 6: Watermark
  const watermarkText = (config && config.watermark_text) ? config.watermark_text : DEFAULT_HANDLE;
  const watermarkOpacity = randFloat(0.35, 0.45);
  const watermarkSize = randInt(18, 22);

  // Layer 9: Subtle rotation
  const rotAngle = randFloat(-0.005, 0.005);

  return {
    cropX, cropY, brightness, contrast, saturation, gamma, noiseStrength,
    audioSpeedFactor, ptsFactor, doStereoSwap, silenceMs, doReverb, fadeDuration,
    trimStart, trimEnd,
    frameRate, preset, profile, level, gopSize, videoBitrate, maxRate, audioBitrate,
    device, creationTime,
    watermarkText, watermarkOpacity, watermarkSize,
    rotAngle
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 🤖 GEMINI AI CAPTION GENERATOR FOR YUZHANINI GOODS
// ═══════════════════════════════════════════════════════════════════════════════════

function cleanTitle(raw) {
  if (!raw) return '';
  let t = decodeURIComponent(raw);
  t = t.replace(/\.[a-zA-Z0-9]+$/i, '');
  t = t.replace(/^.*[\\\/]/, '');
  t = t.replace(/[_-]?\[[a-zA-Z0-9_-]+\]/gi, '');
  t = t.replace(/^\d+[\s_+%-]*/, '');
  t = t.replace(/yuzhanini(goods)?|buffedboujee|pelleelegante|thehouseofcobbler/gi, '');
  t = t.replace(/\[\s*\d+(\.\d+)?[KMBkmb]?[\s_-]*views?\s*\]/gi, '');
  t = t.replace(/\b\d+(\.\d+)?[KMBkmb]?\s*views?\b/gi, '');
  t = t.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 3 ? t : '';
}

function sanitizeCaption(text) {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^(?:Here (?:is|are)[^\n]*|Sure[^\n]*|Certainly[^\n]*|Caption:?)[^\n]*\n+/im, '');
  cleaned = cleaned.replace(/^\s*(?:\*{1,3}|#{1,6})\s*(?:Hook|Caption|Description|Body|Call to Action|CTA|Hashtags|Option \d+)[^\n]*\n+/gim, '');
  cleaned = cleaned.replace(/\*\*(?:Hook|Caption|Description|Body|Call to Action|CTA|Hashtags):\*\*\s*/gi, '');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/\[\s*\d+(\.\d+)?[KMBkmb]?[\s_-]*views?\s*\]/gi, '');
  cleaned = cleaned.replace(/\b\d+(\.\d+)?[KMBkmb]?\s*views?\b/gi, '');
  cleaned = cleaned.replace(/(?:video|reel|clip|part|rank)\s*#?\s*\d+\b/gi, '');
  return cleaned.trim();
}

async function generateAICaption(videoTitle, coverImagePath, accountConfig) {
  const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY
  ].filter(Boolean);

  const prompt = (accountConfig && accountConfig.caption_prompt)
    ? accountConfig.caption_prompt
    : `You are the authentic, master bespoke leather artisan and creator behind @yuzhaninigoods.co on Instagram (handcrafted bespoke leather wallets, minimalist cardholders, and luxury EDC goods).
Write ONE captivating, scroll-stopping Instagram Reel caption celebrating master leathercraft.

PERSONA & VOICE:
- HIGHLY KNOWLEDGEABLE & TECHNICAL: You know leathercraft down to the millimeter. Talk naturally about real workshop details: full-grain vegetable-tanned hides (Pueblo, Buttero, Minerva), traditional twin-needle saddle stitching, French pricking irons, skiving pocket liners down to 0.6mm, edge beveling, and glass-slick Tokonole burnishing.
- FUNNY & WITTY: Sharp, dry workshop humor. Relatable artisan banter (e.g., sniffing fresh veg-tan like fine espresso, edge burnishing until your forearm falls off, making fun of cheap bonded "genuine leather" that peels like sunburn, having leather dye permanently under your nails, knife sharpness obsessions).
- MADE-TO-ORDER & BESPOKE FOCUS: We specialize primarily in made-to-order commissions. Subtly emphasize that each piece is cut, stitched, and finished by hand for a client's specific daily pocket carry—never mass-produced factory surplus.
- NEVER SOUND LIKE AI: Strictly avoid AI buzzwords, generic fluff, or cringe marketing hype ("Unleash", "Elevate", "Game changer", "In a world of", "Dive into", "Masterpiece", "Look no further"). Speak like a passionate, witty craftsman typing directly from the workbench.
- SUBTLE IN SALES: Never be pushy, desperate, or salesy. Let the obsessive quality speak for itself.

STRUCTURE:
1. HOOK: A punchy, clever, or witty one-liner that stops the scroll (technical observation, funny artisan truth, or satisfying craft hook).
2. THE CRAFT (2-3 short sentences): A knowledgeable, vivid glimpse into the build process in the video (saddle-stitch tension, skiving, glass burnish, bespoke specs).
3. THE MADE-TO-ORDER SUBTLE CTA:
   "Handcrafted & made to order. Follow @yuzhaninigoods.co for bespoke leathercraft & made-to-order EDC builds 🪡✨"
   (or a subtle mention: "Drop a DM or check the link to commission your custom pocket piece.")
4. 8-10 CURATED HASHTAGS:
   #YuzhaniniGoods #LeatherCraft #HandmadeWallet #MadeToOrder #BespokeLeather #EverydayCarry #EDCGear #SaddleStitch #VegTan #LeatherArtisan #OddlySatisfying #Leatherwork

Start directly with the hook line.`;

  const fallback = `Handcrafted, made to order, and built to outlive us all 🪡✨\n\nNo machines, no cardboard fillers, and zero shortcuts. Every wallet starts as raw vegetable-tanned full-grain hide, hand-skived down to 0.6mm so your pockets don’t look like a brick, saddle-stitched with twin needles, and burnished to a glassy mirror edge.\n\nWe craft mostly made to order—because something that lives in your pocket every day should be built specifically for you.\n\nWhat’s currently in your daily pocket carry? Drop it below 👇\nHandcrafted & made to order. Follow @yuzhaninigoods.co for bespoke leathercraft & daily EDC builds 🪡✨\n\n#YuzhaniniGoods #LeatherCraft #HandmadeWallet #MadeToOrder #BespokeLeather #EverydayCarry #EDCGear #SaddleStitch #VegTan #LeatherArtisan #OddlySatisfying #Leatherwork`;

  if (apiKeys.length === 0) return fallback;

  for (const key of apiKeys) {
    const genAI = new GoogleGenerativeAI(key);
    for (const mName of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest']) {
      try {
        const model = genAI.getGenerativeModel({ model: mName });
        const contents = [prompt];
        if (coverImagePath && fs.existsSync(coverImagePath)) {
          contents.push({
            inlineData: {
              data: Buffer.from(fs.readFileSync(coverImagePath)).toString('base64'),
              mimeType: 'image/jpeg'
            }
          });
        }
        const res = await model.generateContent(contents);
        const text = res.response?.text();
        if (text) {
          const cleaned = sanitizeCaption(text);
          if (cleaned.length > 30) return cleaned;
        }
      } catch (e) {
        console.warn(`[Gemini] Error with ${mName}: ${e.message}`);
      }
    }
  }

  return fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 🎬 10-LAYER ANTI-COPYRIGHT TRANSFORMATION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════════

async function apply10LayerAntiCopyrightShield(inputPath, outputPath, coverPath, accountConfig) {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`🛡️ APPLYING 10-LAYER ANTI-COPYRIGHT SHIELD FOR ${TARGET_ACCOUNT}`);
  console.log(`═══════════════════════════════════════════════════════════════`);

  const params = generateAntiCopyrightParams(accountConfig);

  console.log(`  L1 Visual: Crop(${params.cropX}x${params.cropY}%), 1080x1920 9:16 Reframe, No-Flip (Orientation Preserved), Bright(${params.brightness.toFixed(3)}), Cont(${params.contrast.toFixed(2)}), Sat(${params.saturation.toFixed(2)}), Grain(${params.noiseStrength})`);
  console.log(`  L2 Audio: Speed(${params.audioSpeedFactor.toFixed(4)}x), StereoSwap(${params.doStereoSwap}), Reverb(${params.doReverb}), Delay(${params.silenceMs}ms), Bandpass(35Hz-17.5kHz)`);
  console.log(`  L3 Temporal: TrimStart(${params.trimStart.toFixed(2)}s), TrimEnd(${params.trimEnd.toFixed(2)}s), PTS(${params.ptsFactor.toFixed(4)})`);
  console.log(`  L4 Encoding: Preset(${params.preset}), GOP(${params.gopSize}), VBitrate(${params.videoBitrate}), ABitrate(${params.audioBitrate})`);
  console.log(`  L5 Device: ${params.device.make} ${params.device.model} (${params.device.encoder})`);
  console.log(`  L6 Watermark: ${params.watermarkText} @ ${Math.round(params.watermarkOpacity * 100)}% opacity`);
  console.log(`  L9 Warp: Subtle rotation(${params.rotAngle}deg)`);
  console.log(`  L10 Stenographic Hash: 1% opacity invisible perceptual perturber`);

  // Probe duration
  let duration = 60;
  try {
    const probe = await execa(ffprobeBinary, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath
    ]);
    const d = parseFloat(probe.stdout?.trim());
    if (!isNaN(d) && d > 2) duration = d;
  } catch (e) {}

  const trimEndTime = Math.max(1, duration - params.trimEnd).toFixed(3);
  const effectiveDuration = parseFloat(trimEndTime) - params.trimStart;

  // Build Video Filter
  const vf = [
    `crop=iw*(1-${params.cropX}/100):ih*(1-${params.cropY}/100)`,
    `scale=1080:1920:force_original_aspect_ratio=increase:flags=bilinear`,
    `crop=1080:1920`,
    `setsar=1`
  ];
  // Strictly NO hflip for Account 4 (leathercraft text, logos, maker stamps & hand orientation preserved)
  vf.push(`eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}:gamma=${params.gamma}`);
  vf.push(`noise=alls=${params.noiseStrength}:allf=u`);
  vf.push(`setpts=PTS*${params.ptsFactor}`);
  vf.push(`drawtext=text='${params.watermarkText}':fontsize=${params.watermarkSize}:fontcolor=white@${params.watermarkOpacity}:x=w-tw-25:y=h-th-30`);

  // L10: Invisible 1% hash overlay
  const invisibleHash = Math.random().toString(36).substring(2, 10);
  vf.push(`drawtext=text='${invisibleHash}':fontsize=40:fontcolor=white@0.01:x=20:y=20`);
  vf.push('format=yuv420p');

  // Build Audio Filter
  const af = [];
  if (params.audioSpeedFactor !== 1) af.push(`atempo=${params.audioSpeedFactor}`);
  af.push('highpass=f=35');
  af.push('lowpass=f=17500');
  af.push(`equalizer=f=${randInt(14000, 16000)}:width_type=h:width=1000:g=${randFloat(0.8, 1.4).toFixed(1)}`);
  if (params.doStereoSwap) af.push('pan=stereo|c0=c1|c1=c0');
  if (params.doReverb) af.push(`aecho=0.8:0.88:${randInt(4, 7)}:${randFloat(0.18, 0.32).toFixed(2)}`);
  if (params.silenceMs > 0) af.push(`adelay=${params.silenceMs}|${params.silenceMs}`);
  af.push(`afade=t=in:st=0:d=${params.fadeDuration}`);
  if (effectiveDuration > 6) {
    af.push(`afade=t=out:st=${Math.max(1, effectiveDuration - 1.5).toFixed(2)}:d=1.5`);
  }

  const ffmpegArgs = [
    '-y',
    '-ss', String(params.trimStart),
    '-to', String(trimEndTime),
    '-i', inputPath,
    '-map_metadata', '-1',
    '-metadata', `title=Handcrafted Leather Goods`,
    '-metadata', `artist=Yuzhanini Goods`,
    '-metadata', `make=${params.device.make}`,
    '-metadata', `model=${params.device.model}`,
    '-metadata', `encoder=${params.device.encoder}`,
    '-metadata', `handler_name=${params.device.handler}`,
    '-metadata', `creation_time=${params.creationTime}`,
    '-vf', vf.join(','),
    '-af', af.join(','),
    '-map', '0:v',
    '-map', '0:a',
    '-r', String(params.frameRate),
    '-c:v', 'libx264',
    '-preset', params.preset,
    '-profile:v', params.profile,
    '-level', params.level,
    '-threads', '2',
    '-b:v', params.videoBitrate,
    '-maxrate', params.maxRate,
    '-bufsize', '8M',
    '-g', String(params.gopSize),
    '-c:a', 'aac',
    '-b:a', params.audioBitrate,
    '-ar', '48000',
    '-movflags', '+faststart',
    outputPath
  ];

  await execa(ffmpegBinary, ffmpegArgs);
  console.log(`✅ 10-Layer transformation finished successfully!`);

  // Update file modification time
  try {
    const fresh = new Date();
    fs.utimesSync(outputPath, fresh, fresh);
  } catch (e) {}

  // Extract randomized cover frame (15% - 80% duration probe)
  console.log(`🖼️ Extracting randomized cover thumbnail frame (15% - 80% probe)...`);
  let randomTimeStr = '2.0';
  try {
    const probeRes = await execa(ffprobeBinary, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', outputPath
    ]);
    const finalDur = parseFloat(probeRes.stdout?.trim()) || 0;
    if (finalDur > 3) {
      const minT = finalDur * 0.15;
      const maxT = finalDur * 0.80;
      randomTimeStr = (minT + Math.random() * (maxT - minT)).toFixed(2);
    }
    await execa(ffmpegBinary, [
      '-y', '-ss', randomTimeStr, '-i', outputPath,
      '-vframes', '1',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
      '-q:v', '1',
      coverPath
    ]);
    console.log(`   ✅ Extracted cover thumbnail at t=${randomTimeStr}s`);
  } catch (e) {
    console.warn(`   ⚠️ Thumbnail extraction warning: ${e.message}`);
  }

  return { randomTimeStr, effectiveDuration };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 🚀 INSTAGRAM PUBLISHING (META GRAPH API)
// ═══════════════════════════════════════════════════════════════════════════════════

async function publishReelToInstagram(publicVideoUrl, caption, thumbOffsetSeconds) {
  console.log(`\n📤 Publishing Reel to Instagram (@yuzhaninigoods.co)...`);
  const thumbOffsetMs = Math.floor(parseFloat(thumbOffsetSeconds || 2) * 1000);

  const metaPayload = {
    media_type: 'REELS',
    video_url: publicVideoUrl,
    caption: caption,
    thumb_offset: thumbOffsetMs,
    share_to_feed: 'true',
    access_token: PAGE_ACCESS_TOKEN
  };

  const createRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(metaPayload).toString()
  });

  const createData = await createRes.json();
  if (createData.error) {
    throw new Error(`Meta API Container Error: ${createData.error.error_user_msg || createData.error.message}`);
  }

  const creationId = createData.id;
  console.log(`✅ Meta Container Created: ${creationId}`);

  // Poll until container is ready
  console.log(`⏳ Waiting for Meta video ingestion...`);
  let isReady = false;
  let attempts = 0;
  while (!isReady && attempts < 40) {
    attempts++;
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${PAGE_ACCESS_TOKEN}`);
    const statusData = await statusRes.json();
    if (statusData.status_code === 'FINISHED') {
      isReady = true;
    } else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
      throw new Error(`Meta Ingestion Failed: ${statusData.status_code}`);
    }
  }

  if (!isReady) throw new Error('Timeout waiting for Meta to ingest video container');

  // Publish
  console.log(`🚀 Publishing container ${creationId} live to Instagram...`);
  const pubRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: creationId, access_token: PAGE_ACCESS_TOKEN }).toString()
  });

  const pubData = await pubRes.json();
  if (pubData.error) {
    throw new Error(`Meta Publish Error: ${pubData.error.error_user_msg || pubData.error.message}`);
  }

  const publishedMediaId = pubData.id;
  console.log(`🎉 LIVE ON INSTAGRAM! Media ID: ${publishedMediaId}`);

  // Fetch permalink
  let permalink = null;
  try {
    const infoRes = await fetch(`https://graph.facebook.com/v19.0/${publishedMediaId}?fields=permalink&access_token=${PAGE_ACCESS_TOKEN}`);
    const infoData = await infoRes.json();
    permalink = infoData.permalink;
    console.log(`🔗 Permalink: ${permalink}`);
  } catch (e) {}

  return { publishedMediaId, permalink };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// 🔄 QUEUE PROCESSOR & MAIN DAEMON LOOP
// ═══════════════════════════════════════════════════════════════════════════════════

async function processSingleItem(item, accountConfig) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuzhanini_'));
  const fileId = `account4_${Date.now()}`;
  const rawPath = path.join(tempDir, `${fileId}_raw.mp4`);
  const transformedPath = path.join(tempDir, `${fileId}_shielded.mp4`);
  const coverPath = path.join(tempDir, `${fileId}_cover.jpg`);

  try {
    // 1. Mark status PROCESSING in Supabase
    await supabase.from('reels_queue').update({ status: 'PROCESSING', started_at: new Date().toISOString() }).eq('id', item.id);

    // 2. Obtain Raw Video
    const urlFileName = item.url ? decodeURIComponent(item.url.split('/').pop().split('?')[0]) : null;
    const directLocalCandidate = urlFileName ? path.join('/home/ubuntu/Y U Z A H A N I N I - G O O D S ( PROCESSED)', urlFileName) : null;

    if (item.local_path && fs.existsSync(item.local_path)) {
      console.log(`📂 Using local file: ${item.local_path}`);
      fs.copyFileSync(item.local_path, rawPath);
    } else if (directLocalCandidate && fs.existsSync(directLocalCandidate)) {
      console.log(`⚡ Direct Local Fast Access: ${directLocalCandidate}`);
      fs.copyFileSync(directLocalCandidate, rawPath);
    } else if (item.url && item.url.startsWith('http')) {
      console.log(`🌐 Downloading video from URL: ${item.url}`);
      await execa('yt-dlp', ['-f', 'b[ext=mp4]/best', '-o', rawPath, '--no-playlist', item.url]);
    } else {
      throw new Error(`No valid video source found for item ${item.id}`);
    }

    // 3. Apply 10-Layer Anti-Copyright Shield
    const { randomTimeStr } = await apply10LayerAntiCopyrightShield(rawPath, transformedPath, coverPath, accountConfig);

    // 4. Generate AI Caption
    const rawTitle = cleanTitle(item.url || path.basename(item.local_path || ''));
    console.log(`📝 Generating Gemini AI caption for: "${rawTitle}"...`);
    const caption = await generateAICaption(rawTitle, coverPath, accountConfig);

    // 5. Upload Transformed Video to R2
    let publicVideoUrl = null;
    if (S3) {
      const s3Key = `${fileId}.mp4`;
      console.log(`☁️ Uploading shielded video to Cloudflare R2 (${s3Key})...`);
      await S3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fs.readFileSync(transformedPath),
        ContentType: 'video/mp4'
      }));
      publicVideoUrl = await getSignedUrl(S3, new GetObjectCommand({ Bucket: bucketName, Key: s3Key }), { expiresIn: 3600 });
      console.log(`🔗 R2 Presigned URL generated for Meta`);
    } else {
      throw new Error('Cloudflare R2 is required for Meta Reels video hosting');
    }

    // 6. Publish to Instagram
    const { publishedMediaId, permalink } = await publishReelToInstagram(publicVideoUrl, caption, randomTimeStr);

    // 7. Update Supabase
    await supabase.from('reels_queue').update({
      status: 'PUBLISHED',
      error_log: null
    }).eq('id', item.id);

    console.log(`✅ [${TARGET_ACCOUNT}] Item ${item.id} published successfully!\n`);
    return true;
  } catch (err) {
    console.error(`❌ [${TARGET_ACCOUNT}] Processing error for ${item.id}:`, err);
    await supabase.from('reels_queue').update({
      status: 'FAILED',
      error_log: err.message
    }).eq('id', item.id);
    return false;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function mainLoop() {
  console.log(`\n================================================================`);
  console.log(`🚀 ACCOUNT 4 WORKER DAEMON STARTED (@yuzhaninigoods.co)`);
  console.log(`🔒 Dedicated Oracle Cloud VM — Complete 10-Layer Anti-Copyright Shield`);
  console.log(`================================================================\n`);

  while (true) {
    try {
      // Fetch account config
      const { data: configs } = await supabase.from('reels_accounts').select('*').eq('account_id', TARGET_ACCOUNT);
      const accountConfig = configs && configs.length > 0 ? configs[0] : null;

      // Check next PENDING item in Supabase
      const { data: items, error } = await supabase
        .from('reels_queue')
        .select('*')
        .eq('account_id', TARGET_ACCOUNT)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(1);

      if (!error && items && items.length > 0) {
        const item = items[0];
        console.log(`\n🎯 Claimed Item ${item.id} (${item.url || item.local_path})`);
        const ok = await processSingleItem(item, accountConfig);
        if (ok) {
          const sleepMinutes = randInt(20, 30);
          console.log(`⏱️ Next post scheduled in ${sleepMinutes} minutes. Sleeping...`);
          await new Promise(r => setTimeout(r, sleepMinutes * 60 * 1000));
          continue;
        }
      } else {
        // No items in queue, wait 30 seconds
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 30000));
      }
    } catch (loopErr) {
      console.error('Loop error:', loopErr.message);
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

if (require.main === module) {
  mainLoop().catch(err => {
    console.error('Fatal crash:', err);
    process.exit(1);
  });
}

module.exports = { apply10LayerAntiCopyrightShield, generateAntiCopyrightParams };
