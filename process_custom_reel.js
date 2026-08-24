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
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
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

const ffmpegBinary = 'ffmpeg';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function randFloat(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const DEVICE_PROFILES = [
  { make: 'Apple', model: 'iPhone 15 Pro Max', encoder: 'iOS 17.5.1 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Apple', model: 'iPhone 16 Pro', encoder: 'iOS 18.2 QuickTime', handler: 'Core Media Data Handler' },
  { make: 'Samsung', model: 'Galaxy S24 Ultra', encoder: 'Samsung Video Encoder 2.1', handler: 'VideoHandle' },
  { make: 'Google', model: 'Pixel 9 Pro', encoder: 'Android MediaCodec 14', handler: 'VideoHandle' },
];

const COLOR_GRADES = [
  'colorbalance=rs=0.02:gs=-0.01:bs=0.03',
  'colorbalance=rs=-0.02:gs=0.01:bs=0.01',
  'colorbalance=rs=0.03:gs=0.01:bs=-0.02',
  'colorbalance=rs=0.02:gs=0.02:bs=0.00',
];

function generateAntiCopyrightParams(targetAccount, config) {
  const doMirror = true; // account2 flips
  const cropX = randInt(2, 5);
  const cropY = randInt(2, 5);
  const brightness = randFloat(-0.03, 0.03);
  const contrast = randFloat(0.96, 1.04);
  const saturation = randFloat(1.05, 1.20);
  const gamma = randFloat(0.96, 1.04);
  const frameRate = 30;

  const audioSpeedFactor = randFloat(0.98, 1.02);
  const audioPitchRate = 44100;
  const doStereoSwap = Math.random() > 0.5;
  const silenceMs = randInt(50, 120);
  const doReverb = Math.random() > 0.5;
  const bgNoiseMix = randFloat(0.01, 0.03);
  const doPhaser = Math.random() > 0.7;

  const trimStart = randFloat(0.1, 0.3);
  const trimEnd = randFloat(0.1, 0.3);
  const ptsFactor = 1 / audioSpeedFactor;

  const preset = 'fast';
  const profile = 'main';
  const tune = 'film';
  const level = '4.0';
  const gopSize = randInt(20, 40);

  const videoBitrate = randInt(2500, 3500) + 'k';
  const maxRate = '4500k';
  const audioBitrate = '192k';
  const noiseStrength = randInt(1, 3);
  const rotAngle = randFloat(-0.01, 0.01);
  const fadeDuration = randFloat(0.1, 0.25);

  const device = randPick(DEVICE_PROFILES);
  const now = new Date();
  now.setMinutes(now.getMinutes() - randInt(10, 300));
  const creationTime = now.toISOString();

  let watermarkText = (config && config.watermark_text) ? config.watermark_text : '@buffedboujee';
  const watermarkOpacity = randFloat(0.35, 0.5);
  const watermarkSize = randInt(18, 22);
  let colorGrade = randPick(COLOR_GRADES);

  return {
    cropX, cropY, brightness, contrast, saturation, gamma, noiseStrength, doMirror, frameRate,
    audioSpeedFactor, audioPitchRate, doStereoSwap, silenceMs, doReverb, bgNoiseMix,
    trimStart, trimEnd, ptsFactor, gopSize,
    preset, videoBitrate, maxRate, audioBitrate, profile, tune, level,
    device, creationTime,
    watermarkText, watermarkOpacity, watermarkSize,
    colorGrade,
    rotAngle, doPhaser, fadeDuration,
    metaTitle: 'Shoe Shine ASMR', metaArtist: 'buffedboujee', metaComment: 'Shoe Shine ASMR', metaGenre: 'Entertainment'
  };
}

function fileToGenerativePart(filePath, mimeType = 'image/jpeg') {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType
    },
  };
}

async function generateCaption(videoUrl, coverPath, config) {
  const apiKeys = [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY].filter(Boolean);
  const hasCover = coverPath && fs.existsSync(coverPath);
  const prompt = (config && config.caption_prompt) || 
    "Write a short viral Instagram reel caption for a satisfying shoe shine / leather care ASMR video. Include emojis, engaging text, call to follow @buffedboujee, and relevant hashtags (#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare).";

  if (apiKeys.length > 0) {
    for (const key of apiKeys) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const contents = hasCover ? [prompt, fileToGenerativePart(coverPath)] : [prompt];
        const res = await model.generateContent(contents);
        let text = res.response?.text()?.trim();
        if (text) {
          text = text.replace(/^#+\s*/gm, '').replace(/```[\s\S]*?```/g, '').trim();
          console.log('✅ AI Caption generated successfully.');
          return text;
        }
      } catch (err) {
        console.warn('Gemini caption generation error:', err.message);
      }
    }
  }

  return `👞✨ UNBELIEVABLE Shoe Shine Transformation!\n\nTurn your sound UP for this satisfying leather restoration 🎧🔥 Watch the magic happen from dusty to a flawless mirror shine.\n\nFollow @buffedboujee for daily satisfying ASMR content! 👞✨\n\n#ASMR #ShoeShine #Satisfying #OddlySatisfying #LeatherCare #ShoeRestoration #ASMRSounds #ShoeCleaning #Restoration`;
}

async function main() {
  const targetAccount = 'account2';
  const targetUrl = 'http://92.4.70.128:3000/videos/001_%5B145.0M_views%5D_UNBELIEVABLE%20Shoe%20Shine%20EXPERIENCE%20l%20Shoe%20Shine%20ASMR%20%23satisfying%20%23shoe_%5BTv5SuU9dw9U%5D.mp4';

  console.log('====================================================');
  console.log('🚀 STEP 1: Ensuring all other account2 links are PAUSED');
  console.log('====================================================');

  const { data: pausedData, error: pauseErr } = await supabase
    .from('reels_queue')
    .update({ status: 'PAUSED' })
    .eq('account_id', targetAccount)
    .in('status', ['PENDING', 'FAILED'])
    .neq('url', targetUrl)
    .select('id');

  if (pauseErr) {
    console.warn('Warning pausing items:', pauseErr.message);
  } else {
    console.log(`✅ Confirmed ${pausedData?.length || 0} other items set to PAUSED.`);
  }

  console.log('\n====================================================');
  console.log('📝 STEP 2: Creating / Updating queue entry for target video');
  console.log('====================================================');

  let queueItem;
  const { data: existing } = await supabase
    .from('reels_queue')
    .select('*')
    .eq('url', targetUrl)
    .limit(1);

  if (existing && existing.length > 0) {
    queueItem = existing[0];
    await supabase.from('reels_queue').update({
      account_id: targetAccount,
      status: 'PROCESSING',
      error_log: null
    }).eq('id', queueItem.id);
    console.log(`Found existing item ${queueItem.id}, set to PROCESSING.`);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('reels_queue')
      .insert({
        account_id: targetAccount,
        url: targetUrl,
        status: 'PROCESSING'
      })
      .select()
      .single();

    if (insErr) throw new Error('Failed to insert target video: ' + insErr.message);
    queueItem = inserted;
    console.log(`Created new queue item ${queueItem.id}.`);
  }

  const { data: accData } = await supabase.from('reels_accounts').select('*').eq('account_id', targetAccount).single();
  const accountConfig = accData || null;
  const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_2;
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2;

  if (!IG_BUSINESS_ACCOUNT_ID || !PAGE_ACCESS_TOKEN) {
    throw new Error('Missing IG_BUSINESS_ACCOUNT_ID_2 or PAGE_ACCESS_TOKEN_2 in .env');
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const rawDownloadedPath = path.join(tempDir, `${fileId}_raw.mp4`);
  const outputPath = path.join(tempDir, `${fileId}_transformed.mp4`);
  const coverPath = path.join(tempDir, `${fileId}_cover.jpg`);

  try {
    console.log('\n====================================================');
    console.log('📥 STEP 3: Downloading video file...');
    console.log('====================================================');
    console.log(`URL: ${targetUrl}`);

    const response = await fetch(targetUrl);
    if (!response.ok) throw new Error(`HTTP Download error: ${response.statusText}`);
    const fileStream = fs.createWriteStream(rawDownloadedPath);
    await pipeline(response.body, fileStream);

    const stats = fs.statSync(rawDownloadedPath);
    console.log(`✅ Downloaded ${(stats.size / (1024 * 1024)).toFixed(2)} MB to ${rawDownloadedPath}`);

    console.log('\n====================================================');
    console.log('🛡️ STEP 4: Applying 10-Layer Anti-Copyright Shield...');
    console.log('====================================================');

    const params = generateAntiCopyrightParams(targetAccount, accountConfig);
    console.log(`  Visual: crop(${params.cropX}x${params.cropY}) bright(${params.brightness}) contrast(${params.contrast}) sat(${params.saturation}) gamma(${params.gamma}) mirror(${params.doMirror})`);
    console.log(`  Audio: speed(${params.audioSpeedFactor}) stereoSwap(${params.doStereoSwap}) silence(${params.silenceMs}ms)`);
    console.log(`  Overlay: ${params.watermarkText}`);

    const vfParts = [
      `crop=iw*(1-${params.cropX}/100):ih*(1-${params.cropY}/100)`,
      `scale=1080:1920:force_original_aspect_ratio=decrease`,
      `pad=1080:1920:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1'
    ];
    if (params.doMirror) vfParts.push('hflip');
    vfParts.push(`eq=brightness=${params.brightness}:contrast=${params.contrast}:saturation=${params.saturation}:gamma=${params.gamma}`);
    vfParts.push(`noise=alls=${params.noiseStrength}:allf=u`);
    if (params.colorGrade) vfParts.push(params.colorGrade);
    vfParts.push(`setpts=PTS*${params.ptsFactor}`);
    vfParts.push(`drawtext=text='${params.watermarkText}':fontsize=${params.watermarkSize}:fontcolor=white@${params.watermarkOpacity}:x=w-tw-20:y=h-th-20`);
    vfParts.push(`hue=h=${randInt(1, 3)}`);
    vfParts.push(`vignette=PI/4+PI/${randInt(15, 30)}`);
    const invisibleHash = Math.random().toString(36).substring(2, 10);
    vfParts.push(`drawtext=text='${invisibleHash}':fontsize=50:fontcolor=white@0.01:x=w*t/15:y=h*t/20`);
    vfParts.push(`rotate=${params.rotAngle}*PI/180:c=black:ow=1080:oh=1920`);
    vfParts.push('setsar=1');
    vfParts.push('format=yuv420p');

    const afParts = [];
    if (params.audioSpeedFactor !== 1) afParts.push(`atempo=${params.audioSpeedFactor}`);
    afParts.push('highpass=f=35');
    afParts.push('lowpass=f=16500');
    afParts.push(`equalizer=f=${randInt(15000, 17000)}:width_type=h:width=1000:g=${randFloat(1.0, 2.0).toFixed(1)}`);
    if (params.doStereoSwap) afParts.push('pan=stereo|c0=c1|c1=c0');
    if (params.doReverb) afParts.push(`aecho=0.8:0.88:${randInt(4, 8)}:${randFloat(0.25, 0.45).toFixed(2)}`);
    if (params.doPhaser) afParts.push(`aphaser=in_gain=0.4:out_gain=0.6:delay=${randFloat(3, 5).toFixed(1)}:decay=${randFloat(0.1, 0.3).toFixed(2)}:speed=${randFloat(0.4, 0.7).toFixed(2)}`);
    afParts.push(`afade=t=in:st=0:d=${params.fadeDuration}`);

    let videoDuration = null;
    try {
      const probe = await execa('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', rawDownloadedPath
      ]);
      videoDuration = parseFloat(probe.stdout?.trim());
    } catch(e){}

    let trimEndTime = null;
    if (videoDuration && !isNaN(videoDuration) && videoDuration > 2 && parseFloat(params.trimEnd) > 0) {
      trimEndTime = (videoDuration - parseFloat(params.trimEnd)).toFixed(3);
    }

    const ffmpegArgs = ['-y'];
    if (parseFloat(params.trimStart) > 0) ffmpegArgs.push('-ss', String(params.trimStart));
    if (trimEndTime) ffmpegArgs.push('-to', String(trimEndTime));

    ffmpegArgs.push(
      '-i', rawDownloadedPath,
      '-f', 'lavfi', '-i', 'anoisesrc=color=brown:r=44100:amplitude=0.025',
      '-map_metadata', '-1',
      '-metadata', `title=${params.metaTitle}`,
      '-metadata', `artist=${params.metaArtist}`,
      '-metadata', `comment=${params.metaComment}`,
      '-metadata', `genre=${params.metaGenre}`,
      '-metadata', `make=${params.device.make}`,
      '-metadata', `model=${params.device.model}`,
      '-metadata', `encoder=${params.device.encoder}`,
      '-metadata', `handler_name=${params.device.handler}`,
      '-metadata', `creation_time=${params.creationTime}`,
      '-vf', vfParts.join(','),
      '-filter_complex', `[0:a]${afParts.join(',')}[a1];[a1][1:a]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-r', String(params.frameRate),
      '-c:v', 'libx264',
      '-preset', params.preset,
      '-profile:v', params.profile,
      '-tune', params.tune,
      '-level', params.level,
      '-threads', '2',
      '-b:v', params.videoBitrate,
      '-maxrate', params.maxRate,
      '-bufsize', '24M',
      '-g', String(params.gopSize),
      '-c:a', 'aac',
      '-b:a', params.audioBitrate,
      '-movflags', '+faststart',
      outputPath
    );

    console.log('Running FFmpeg transformation...');
    await execa(ffmpegBinary, ffmpegArgs);
    console.log('✅ FFmpeg primary transformation complete.');

    // Branded Intro/Outro Frames
    console.log('Adding branded intro & outro frames...');
    const introOutroPath = path.join(tempDir, `${fileId}_branded.mp4`);
    const introDuration = 0.5;
    const outroDuration = 0.8;
    const introText = '@buffedboujee';
    const outroText = 'Follow @buffedboujee for more';

    try {
      await execa(ffmpegBinary, [
        '-y',
        '-f', 'lavfi', '-t', String(introDuration),
        '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${introText}':fontsize=36:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(introDuration - 0.2).toFixed(1)}:d=0.2,setsar=1`,
        '-f', 'lavfi', '-t', String(introDuration),
        '-i', 'anullsrc=r=44100:cl=stereo',
        '-i', outputPath,
        '-f', 'lavfi', '-t', String(outroDuration),
        '-i', `color=c=black:s=1080x1920:r=${params.frameRate},format=yuv420p,drawtext=text='${outroText}':fontsize=28:fontcolor=white:x=(w-tw)/2:y=(h-th)/2,fade=t=in:st=0:d=0.3,fade=t=out:st=${(outroDuration - 0.3).toFixed(1)}:d=0.3,setsar=1`,
        '-f', 'lavfi', '-t', String(outroDuration),
        '-i', 'anullsrc=r=44100:cl=stereo',
        '-filter_complex', `[0:v]fps=${params.frameRate}[v0]; [2:v]fps=${params.frameRate}[v1]; [3:v]fps=${params.frameRate}[v2]; [v0][1:a][v1][2:a][v2][4:a]concat=n=3:v=1:a=1[outv][outa]`,
        '-map', '[outv]', '-map', '[outa]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main',
        '-c:a', 'aac', '-b:a', params.audioBitrate,
        '-movflags', '+faststart', '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M',
        introOutroPath
      ]);
      fs.renameSync(introOutroPath, outputPath);
      console.log('✅ Branded intro/outro successfully attached.');
    } catch(bErr) {
      console.warn('Intro/outro skipped:', bErr.message);
    }

    // Thumbnail Extraction
    console.log('\n====================================================');
    console.log('🖼️ STEP 5: Extracting cover thumbnail & AI Caption...');
    console.log('====================================================');
    const randomTimeStr = '2.5';
    await execa(ffmpegBinary, [
      '-y', '-ss', randomTimeStr, '-i', outputPath,
      '-vframes', '1',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,unsharp=5:5:0.5:5:5:0',
      '-q:v', '1',
      coverPath
    ]);
    console.log('✅ Thumbnail cover extracted.');

    const caption = await generateCaption(targetUrl, coverPath, accountConfig);
    console.log('Caption to be posted:\n', caption);

    console.log('\n====================================================');
    console.log('☁️ STEP 6: Uploading to Cloudflare R2...');
    console.log('====================================================');
    const uploadName = `${fileId}.mp4`;
    const coverName = `${fileId}_cover.jpg`;

    const videoBuffer = fs.readFileSync(outputPath);
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: uploadName,
      Body: videoBuffer,
      ContentType: 'video/mp4',
    }));

    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: uploadName });
    const publicVideoUrl = await getSignedUrl(S3, getCmd, { expiresIn: 3600 });
    console.log('✅ Video uploaded to R2.');

    let publicCoverUrl = null;
    if (fs.existsSync(coverPath)) {
      await S3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: coverName,
        Body: fs.readFileSync(coverPath),
        ContentType: 'image/jpeg',
      }));
      const getCoverCmd = new GetObjectCommand({ Bucket: bucketName, Key: coverName });
      publicCoverUrl = await getSignedUrl(S3, getCoverCmd, { expiresIn: 604800 });
      console.log('✅ Cover uploaded to R2.');
    }

    console.log('\n====================================================');
    console.log('📸 STEP 7: Creating Meta Instagram Reel Container...');
    console.log('====================================================');
    const thumbOffsetMs = 2500;
    const metaPayload = {
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: caption,
      thumb_offset: thumbOffsetMs,
      access_token: PAGE_ACCESS_TOKEN
    };
    if (publicCoverUrl) metaPayload.cover_url = publicCoverUrl;

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
    console.log(`✅ Meta Container Created! ID: ${creation_id}`);
    await supabase.from('reels_queue').update({ creation_id }).eq('id', queueItem.id);

    console.log('Polling Meta container status...');
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 40) {
      attempts++;
      await sleep(5000);
      const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creation_id}?fields=status_code&access_token=${PAGE_ACCESS_TOKEN}`);
      const statusData = await statusRes.json();
      console.log(`   [Attempt ${attempts}] Status: ${statusData.status_code}`);
      if (statusData.status_code === 'FINISHED') isReady = true;
      else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
        throw new Error(`Meta Processing Failed: ${statusData.status_code}`);
      }
    }
    if (!isReady) throw new Error('Timeout waiting for Meta Reel processing');

    console.log('\n====================================================');
    console.log('🚀 STEP 8: Publishing Reel to Account 2 (@buffedboujee)...');
    console.log('====================================================');
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish?creation_id=${creation_id}&access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST'
    });
    const publishData = await publishRes.json();
    if (publishData.error) {
      throw new Error(`Meta API Publish Error: ${publishData.error.error_user_msg || publishData.error.message}`);
    }

    console.log('🎉 REEL PUBLISHED SUCCESSFULLY!');
    console.log('Instagram Post ID:', publishData.id);

    await supabase.from('reels_queue').update({
      status: 'PUBLISHED',
      error_log: null
    }).eq('id', queueItem.id);

    // Update timestamps in R2
    const now = Date.now();
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `last_published_${targetAccount}.txt`,
      Body: now.toString(),
      ContentType: 'text/plain'
    })).catch(e => {});

    // Cleanup temporary R2 video
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadName })).catch(e => {});

    // Cleanup local files
    try { fs.unlinkSync(rawDownloadedPath); } catch(e){}
    try { fs.unlinkSync(outputPath); } catch(e){}
    try { fs.unlinkSync(coverPath); } catch(e){}

    console.log('\n====================================================');
    console.log(`✅ COMPLETE! Reel published to Account 2. Post ID: ${publishData.id}`);
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ ERROR during processing:', err.message);
    if (queueItem && queueItem.id) {
      await supabase.from('reels_queue').update({
        status: 'FAILED',
        error_log: err.message
      }).eq('id', queueItem.id);
    }
    process.exit(1);
  }
}

main();
