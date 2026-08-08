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
});

// Sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// AI Caption Generator
async function generateCaption(videoUrl, rawPath, targetAccount) {
  const geminiKey = process.env.GEMINI_API_KEY;

  if (targetAccount === 'account2') {
    if (!geminiKey) return "Oddly satisfying leather shoe shining ASMR ✨🎧 Relax and enjoy the restoration process #ASMR #ShoeShine #LeatherRestoration #OddlySatisfying #Satisfying #ASMRSounds #LeatherShining";

    const prompt = `Write an engaging, viral Instagram Reel caption for a leather shoe polishing ASMR video. 
Include:
1. A satisfying, hooky title with relevant emojis (e.g. 👞✨, 🎧💆‍♂️).
2. A brief 1-2 sentence description highlighting the satisfying process, the shine, or the relaxing sounds of leather shoe polishing/restoration.
3. 5-8 relevant viral hashtags (e.g., #ASMR #ShoeShine #LeatherRestoration #Satisfying #ShoeCare #OddlySatisfying #ASMRSounds #LeatherCare).
Keep text clean, respectful, and appealing to ASMR/satisfying video fans. Do NOT include markdown code blocks or quotes around the caption.`;

    const genAI = new GoogleGenerativeAI(geminiKey);
    const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.0-flash-001', 'gemini-2.5-pro'];

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting caption generation with model: ${modelName} for ${targetAccount}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response?.text()?.trim();
        if (text) {
          console.log(`Caption successfully generated using model: ${modelName}`);
          return text;
        }
      } catch (err) {
        console.warn(`Model ${modelName} failed for ${targetAccount}:`, err.message);
      }
    }
    return "Oddly satisfying leather shoe shining ASMR ✨🎧 Relax and enjoy the restoration process #ASMR #ShoeShine #LeatherRestoration #OddlySatisfying #Satisfying #ASMRSounds #LeatherShining";
  } else {
    if (!geminiKey) return "SubhanAllah ✨ Powerful Islamic Reminder #Islamic #Shorts #Reels #Iman #Quran";

    const prompt = `Write an engaging, viral Instagram Reel caption for an Islamic video. 
Include:
1. An inspiring title/hook with emoji.
2. A short 2-3 sentence reflection/lesson about Iman, Taqwa, or remembrance of Allah.
3. 5-8 relevant viral hashtags (e.g., #IslamicReminders #Quran #Sunnah #Deen #Hadith #DeenOverDunya).
Keep text clean, respectful, and beautiful. Do NOT include markdown code blocks or quotes around the caption.`;

    const genAI = new GoogleGenerativeAI(geminiKey);
    const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.0-flash-001', 'gemini-2.5-pro'];

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting caption generation with model: ${modelName} for ${targetAccount}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response?.text()?.trim();
        if (text) {
          console.log(`Caption successfully generated using model: ${modelName}`);
          return text;
        }
      } catch (err) {
        console.warn(`Model ${modelName} failed for ${targetAccount}:`, err.message);
      }
    }
    return "SubhanAllah ✨ Powerful Islamic Reminder #Islamic #Shorts #Reels #Iman #Quran #Sunnah #Deen";
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

  await supabase.from('reels_queue').update({ status: 'PROCESSING', error_log: null }).eq('id', item.id);

  let fileId;
  let rawUploadStoragePath = null;
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
      console.log(`Downloading video ${item.url} via yt-dlp...`);
      const ytDlpOptions = ['-o', tempFileTemplate, '-f', 'best', '--no-playlist'];
      if (cookiePath && item.url.includes('instagram.com')) {
        ytDlpOptions.push('--cookies', cookiePath);
      }

      await execa('yt-dlp', [...ytDlpOptions, item.url]);

      const files = fs.readdirSync(tempDir);
      downloadedFile = files.find(f => f.startsWith(fileId) && !f.endsWith('.txt') && !f.endsWith('.json'));
      if (!downloadedFile) throw new Error('Failed to find downloaded video file');
    }

    const inputPath = path.join(tempDir, downloadedFile);
    const outputPath = path.join(tempDir, `${fileId}_transformed.mp4`);
    const coverPath = path.join(tempDir, `${fileId}_cover.jpg`);

    console.log(`Extracting cover thumbnail frame with FFmpeg...`);
    try {
      await execa('ffmpeg', [
        '-y',
        '-ss', '00:00:01',
        '-i', inputPath,
        '-vframes', '1',
        '-q:v', '2',
        coverPath
      ]);
    } catch (coverErr) {
      console.warn('Failed to extract cover image frame:', coverErr.message);
    }

    console.log(`Transforming video with FFmpeg (stripping metadata & shifting sound frequency for uniqueness)...`);
    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-map_metadata', '-1',
      '-vf', 'eq=brightness=0.01:contrast=1.02:saturation=1.03,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
      '-af', 'asetrate=44100*1.01,aresample=44100',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-threads', '2',
      '-crf', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath
    ];

    await execa('ffmpeg', ffmpegArgs);

    // AI Caption Generation
    console.log(`Generating AI Caption...`);
    const caption = await generateCaption(item.url, rawUploadStoragePath, targetAccount);

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
        publicCoverUrl = await getSignedUrl(S3, getCoverCmd, { expiresIn: 3600 });
        console.log(`Presigned cover URL generated for Meta`);
      } catch (e) {
        console.warn('Failed to presign cover URL:', e.message);
      }
    }

    // Meta Reel Upload
    console.log(`Creating Meta Reel container for ${targetAccount}...`);
    const metaPayload = {
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: caption,
      access_token: PAGE_ACCESS_TOKEN
    };

    if (publicCoverUrl) {
      metaPayload.cover_url = publicCoverUrl;
    }

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

    // Cleanup R2 temporary video asset and cover image
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadName })).catch(e => console.error(e));
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: coverName })).catch(e => console.error(e));

  } catch (processError) {
    console.error(`❌ Error processing item ${item.id} for ${targetAccount}:`, processError.message);
    await supabase.from('reels_queue').update({ status: 'FAILED', error_log: processError.message }).eq('id', item.id);
  } finally {
    try {
      if (fileId) {
        const tempDir = os.tmpdir();
        const leftoverFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(fileId));
        for (const f of leftoverFiles) {
          try { fs.unlinkSync(path.join(tempDir, f)); } catch (e) { }
        }
        await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: `${fileId}.mp4` })).catch(e => console.error(e));
        await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: `${fileId}_cover.jpg` })).catch(e => console.error(e));
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
