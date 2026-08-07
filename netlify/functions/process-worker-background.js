const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const ytDlp = require('yt-dlp-exec');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ffmpeg = require('ffmpeg-static');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Downloads standalone yt-dlp binary for Linux (no Python required) and caches it in /tmp
let _cachedYtDlpBinaryPath = null;
async function getYtDlpBinary() {
  if (process.platform === 'win32') {
    const winBin = path.resolve('./node_modules/yt-dlp-exec/bin/yt-dlp.exe');
    if (fs.existsSync(winBin)) return ytDlp.create(winBin);
    return ytDlp;
  }
  const tmpBin = path.join(os.tmpdir(), 'yt-dlp-standalone');
  if (_cachedYtDlpBinaryPath && fs.existsSync(_cachedYtDlpBinaryPath)) {
    return ytDlp.create(_cachedYtDlpBinaryPath);
  }
  if (fs.existsSync(tmpBin)) {
    _cachedYtDlpBinaryPath = tmpBin;
    return ytDlp.create(tmpBin);
  }
  console.log('Downloading standalone yt-dlp binary for Linux...');
  try {
    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', { redirect: 'follow' });
    if (!res.ok) throw new Error(`Failed to download yt-dlp binary: ${res.status}`);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(tmpBin, Buffer.from(buffer));
    fs.chmodSync(tmpBin, 0o755);
    _cachedYtDlpBinaryPath = tmpBin;
    console.log('yt-dlp standalone binary downloaded successfully to', tmpBin);
    return ytDlp.create(tmpBin);
  } catch (e) {
    console.warn('Failed to download standalone yt-dlp binary, falling back to bundled:', e.message);
    return ytDlp;
  }
}

async function processSingleItem(supabase, S3, bucketName, item, targetAccount) {
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

  const { error: updateErr } = await supabase.from('reels_queue').update({ status: 'PROCESSING' }).eq('id', item.id);
  if (updateErr) console.error('Failed to update status to PROCESSING:', updateErr.message);

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
      console.log(`Direct upload detected for ${targetAccount}. Downloading from R2: ${rawUploadStoragePath}`);
      
      const ext = path.extname(rawUploadStoragePath) || '.mp4';
      downloadedFile = `${fileId}_raw${ext}`;
      const destPath = path.join(tempDir, downloadedFile);
      
      const getRawCmd = new GetObjectCommand({ Bucket: bucketName, Key: rawUploadStoragePath });
      const getRawRes = await S3.send(getRawCmd);
      const arrayBuffer = await getRawRes.Body.transformToByteArray();
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
      
    } else {
      console.log(`Downloading external URL ${item.url} for ${targetAccount} via yt-dlp to temp directory`);
      
      try {
        // Always get the best available standalone binary (no Python dependency)
        const ytDlpCustom = await getYtDlpBinary();

        const ytDlpOptions = { output: tempFileTemplate, format: 'best', writeInfoJson: true };
        if (cookiePath && item.url.includes('instagram.com')) ytDlpOptions.cookies = cookiePath;
        if (item.url.includes('youtube.com') || item.url.includes('youtu.be')) {
          ytDlpOptions.extractorArgs = 'youtube:player_client=android';
          ytDlpOptions.jsRuntimes = 'node';
        }
        
        let downloadSuccess = false;
        let retryCount = 0;
        while (!downloadSuccess && retryCount < 3) {
          try {
            await ytDlpCustom(item.url, ytDlpOptions);
            downloadSuccess = true;
          } catch (dlErr) {
            retryCount++;
            console.warn(`yt-dlp download attempt ${retryCount} failed for ${item.url}: ${dlErr.message}`);
            // If cookie failed or caused HTTP 400, remove cookie and retry immediately without cookie
            if (ytDlpOptions.cookies) {
              console.log('Retrying yt-dlp download without session cookies...');
              delete ytDlpOptions.cookies;
            }
            if (retryCount >= 3) throw dlErr;
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } finally {
        if (cookiePath && fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
      }

      const files = fs.readdirSync(tempDir);
      downloadedFile = files.find(f => f.startsWith(fileId) && !f.endsWith('.info.json'));
      if (!downloadedFile) throw new Error(`yt-dlp failed to create file for ${item.url}`);
    }
    
    const finalFilePath = path.join(tempDir, downloadedFile);
    
    console.log(`Running advanced Anti-Detection & Uniqueness FFmpeg transformations for ${targetAccount}...`);
    const outputExt = '.mp4';
    const transformedFilePath = path.join(tempDir, `transformed_${fileId}${outputExt}`);
    
    // 1. Micro-Speed & Timestamp (PTS) alteration (+/- 1.2%)
    const speedFactor = Number((0.988 + Math.random() * 0.024).toFixed(4));
    const setptsFactor = Number((1 / speedFactor).toFixed(4));
    const audioSpeed = speedFactor.toFixed(4);

    // 2. Micro-Crop & Micro-Zoom (1.5% to 3.5%)
    const cropScaleW = (1 - (Math.random() * 0.025 + 0.015)).toFixed(3);
    const cropScaleH = (1 - (Math.random() * 0.025 + 0.015)).toFixed(3);
    const cropX = Math.random() > 0.5 ? '0' : '(in_w-out_w)';
    const cropY = Math.random() > 0.5 ? '0' : '(in_h-out_h)';

    // 3. Pixel Color, Gamma, & Exposure Micro-Shifting
    const brightness = ((Math.random() * 0.04) - 0.02).toFixed(3);
    const contrast = ((Math.random() * 0.06) + 0.97).toFixed(3);
    const saturation = ((Math.random() * 0.08) + 0.96).toFixed(3);
    const gamma = ((Math.random() * 0.04) + 0.98).toFixed(3);

    const vfArgs = `crop=in_w*${cropScaleW}:in_h*${cropScaleH}:${cropX}:${cropY},eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma},noise=alls=1:allf=t,setpts=${setptsFactor}*PTS`;
    const afArgs = `atempo=${audioSpeed},volume=${(0.98 + Math.random() * 0.04).toFixed(3)}`;

    // 4. Dynamic Binary Metadata & Account Tagging
    const randomSalt = crypto.randomBytes(6).toString('hex');
    const creatorTag = targetAccount === 'account2' ? 'buffedboujee' : 'faith.canvas38';
    const metaTitle = `@${creatorTag}_${randomSalt}`;
    const creationTime = new Date(Date.now() - Math.floor(Math.random() * 3600000)).toISOString();
    const randomCrf = Math.floor(Math.random() * 3) + 22; // 22, 23, 24
    
    const ext = path.extname(downloadedFile).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

    let actualFfmpegPath = ffmpeg;
    if (!process.env.IS_LOCAL && !process.env.NETLIFY_DEV) {
      const tmpFfmpegPath = path.join(os.tmpdir(), 'ffmpeg');
      if (fs.existsSync(actualFfmpegPath)) {
        fs.copyFileSync(actualFfmpegPath, tmpFfmpegPath);
        fs.chmodSync(tmpFfmpegPath, 0o777);
        actualFfmpegPath = tmpFfmpegPath;
      }
    }

    try {
      if (isImage) {
        execSync(`"${actualFfmpegPath}" -loop 1 -framerate 30 -i "${finalFilePath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -preset fast -tune stillimage -t 15 -pix_fmt yuv420p -map_metadata -1 -metadata title="${metaTitle}" -metadata creation_time="${creationTime}" -metadata comment="${metaTitle}" "${transformedFilePath}"`);
      } else {
        execSync(`"${actualFfmpegPath}" -i "${finalFilePath}" -vf "${vfArgs}" -af "${afArgs}" -c:v libx264 -pix_fmt yuv420p -crf ${randomCrf} -preset fast -g 60 -c:a aac -b:a 128k -ar 44100 -map_metadata -1 -metadata title="${metaTitle}" -metadata artist="${metaTitle}" -metadata copyright="${metaTitle}" -metadata creation_time="${creationTime}" -metadata comment="${metaTitle}" "${transformedFilePath}"`);
      }
      fs.unlinkSync(finalFilePath);
    } catch (ffErr) {
      console.error('FFmpeg transformation warning:', ffErr);
      fs.renameSync(finalFilePath, transformedFilePath);
    }

    const uploadName = `${fileId}${outputExt}`;
    const filesForInfo = fs.readdirSync(tempDir);
    const infoJsonFile = filesForInfo.find(f => f.startsWith(fileId) && f.endsWith('.info.json'));
    let aiCaption = '';
    let videoDuration = 15;
    
    try {
      let originalDescription = '';
      let uploaderName = 'User';
      
      if (infoJsonFile) {
        const infoJsonPath = path.join(tempDir, infoJsonFile);
        const infoData = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
        originalDescription = infoData.description || '';
        uploaderName = infoData.uploader || infoData.uploader_id || 'Unknown';
        if (infoData.duration) videoDuration = infoData.duration;
        fs.unlinkSync(infoJsonPath);
      }
      
      const cleanUploader = (uploaderName && !['user', 'unknown', 'buffedboujee', 'faith.canvas38', 'faithcanvas'].includes(uploaderName.toLowerCase().trim())) 
        ? uploaderName.trim() 
        : null;

      if (process.env.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const modelsToTry = [
          'gemini-flash-latest',
          'gemini-flash-lite-latest',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite'
        ];

        let prompt = '';
        if (targetAccount === 'account2') {
          prompt = `Write a completely unique, fresh, and highly engaging Instagram Reel caption for this video. The theme is ASMR, Leather Shoe Polish, and Shoe Restoration.
Rules:
1. Always write entirely in English.
2. Start with a brand new, punchy, viral hook (vary your style: curiosity, question, bold statement, or reaction).
3. Describe the satisfying sensory details of shoe restoration (crisp horsehair brushing, deep leather conditioning, rich wax polish, mirror glass shine buff).
4. Use clean line breaks and relevant emojis.
5. End with an engaging question or call-to-action (e.g., rate the shine from 1-10, save for later).
6. Select 6-8 distinct, high-reach SEO hashtags related to shoe shine, leather care, restoration, and satisfying ASMR (e.g. #ShoeShine #LeatherRestoration #ASMRCommunity #SatisfyingASMR #LeatherCare #OddlySatisfying #ShoeCare #CobblerLife).
7. Do NOT include quotes around the text.
Original description for context (if any): "${originalDescription || ''}"`;
        } else {
          prompt = `Write a completely unique, inspiring, and engaging Instagram Reel description for this video. The content is focused on Islam and Islamic reminders.
Rules:
1. Always write entirely in English.
2. Start with a fresh, captivating hook (spiritual reflection, reminder, inspiring thought, or question).
3. Use clean line breaks and thoughtful emojis.
4. Select 6-8 distinct, high-reach Islamic hashtags (e.g. #islamicquotes, #deen, #muslim, #quran, #reminder, #hadith, #islamicreminder, #faith).
5. Do NOT include quotes around the text.
6. Do NOT make this a sales pitch.
Original description for context: "${originalDescription || ''}"`;
        }

        for (const modelName of modelsToTry) {
          try {
            console.log(`Attempting caption generation with model: ${modelName} for ${targetAccount}`);
            const model = genAI.getGenerativeModel({ 
              model: modelName,
              generationConfig: { temperature: 0.85, topP: 0.95 },
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
              ]
            });
            const result = await model.generateContent(prompt);
            const text = result?.response?.text()?.trim();
            if (text && text.length > 20) {
              aiCaption = text;
              console.log(`Caption successfully generated using model: ${modelName}`);
              break;
            }
          } catch (modelErr) {
            console.warn(`Model ${modelName} failed (${modelErr.message || modelErr}). Trying next fallback model...`);
          }
        }
      }

      // Guaranteed Fallback if Gemini fails or API key is absent
      if (!aiCaption) {
        console.log(`AI generation unavailable or exhausted. Using curated fallback caption for ${targetAccount}...`);
        if (targetAccount === 'account2') {
          const fallbackAcc2 = [
            `Turn your volume UP for this one... 🎧✨\n\nPut on your headphones and let your stress melt away as we bring these beat-up leather shoes back to life.\n\nFrom the crisp sound of the horsehair brush to that sleek, ultimate mirror-finish shine, this transformation is pure audio and visual therapy. 👞🔥\n\nWhich sound gave you the most tingles—the brushing or the wax buff? Drop a comment below! 👇\n\n📌 Save this for the next time you need an instant mental reset.\n\n#ShoeShine #LeatherRestoration #ASMRCommunity #SatisfyingASMR #LeatherCare #OddlySatisfying #ShoeCare #CobblerLife`,
            `Proof that leather restoration is cheaper than therapy 🎧✨\n\nPlug in your headphones and let your brain completely reset. 🧠💆‍♂️\n\nWatching tired, worn leather transform into a buttery, glass-like glaze is pure satisfaction. Every brush stroke and wax glide is designed to melt away stress.\n\nRate this final mirror shine from 1 to 10 in the comments! 👇✨\n\n#ShoeRestoration #ShoeShine #LeatherCare #SatisfyingVideos #ASMRSounds #OddlySatisfying #DetailingASMR`,
            `They thought these were beyond saving. Watch the transformation... 🪄👞\n\nThere is something deeply satisfying about stripping away scuffs and bringing out that deep, rich mirror shine.\n\nDrop a 🧊 in the comments if this gave you instant satisfaction! 👇\n\n#ShoeShine #LeatherCare #ShoeRestoration #SatisfyingASMR #CobblerLife #LeatherRepair #OddlySatisfying`,
            `The most satisfying 30 seconds of your day 🎧👞\n\nCrisp brushing, deep conditioning, and a flawless high-gloss finish. Sound on for the full ASMR experience!\n\nWhat pair should we restore next? Let us know in the comments! 👇\n\n#ShoeShine #LeatherRestoration #ASMR #OddlySatisfying #LeatherCraft #ShoeCare #Satisfying`
          ];
          aiCaption = fallbackAcc2[Math.floor(Math.random() * fallbackAcc2.length)];
        } else {
          const fallbackAcc1 = [
            `Your soul is not broken; it is simply tired of things that pull it away from its Creator. 🌿\n\nTake a deep breath and remember that every moment is a chance to turn back to Allah. The door of Taubah (repentance) is always open, and His mercy is greater than any mistake.\n\n✨ Guard your prayers\n✨ Protect your heart\n✨ Trust in His divine timing\n\nSave this for the days you need a gentle reminder to keep going. 🕊️🤲\n\n#islamicreminders #deen #quran #tawbah #muslimmindset #islamicquotes #faith #allah`,
            `What if the peace you’ve been searching for is sitting right in your next Sujood? 🤍✨\n\nIn a world full of noise and distraction, remember that real tranquility is found only in the remembrance of Allah.\n\nNever lose hope in His mercy, for He hears the silent prayers of every seeking heart. 🤲\n\n#islamicreminder #deen #quran #tawbah #muslim #islamicquotes #hadith #faith`
          ];
          aiCaption = fallbackAcc1[Math.floor(Math.random() * fallbackAcc1.length)];
        }
      }

      if (cleanUploader) {
        aiCaption += `\n\n🎥 Content via: ${cleanUploader}`;
      }
    } catch (aiErr) {
      console.error('Caption processing error:', aiErr);
    }

    // 3. Upload to R2
    console.log(`Uploading ${uploadName} to R2 for ${targetAccount}...`);
    const fileBuffer = fs.readFileSync(transformedFilePath);
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: uploadName,
      Body: fileBuffer,
      ContentType: 'video/mp4'
    });
    await S3.send(putCmd);
    fs.unlinkSync(transformedFilePath);

    // Generate a pre-signed URL for Meta to download from R2 (expires in 1 hr)
    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: uploadName });
    const publicUrl = await getSignedUrl(S3, getCmd, { expiresIn: 3600 });

    // 4. Meta Create Container
    console.log(`Initializing Meta Reels container for ${targetAccount} (${IG_BUSINESS_ACCOUNT_ID})...`);
    const metaCreateUrl = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media`;
    const metaPayload = { media_type: 'REELS', video_url: publicUrl, access_token: PAGE_ACCESS_TOKEN, share_to_feed: 'true' };
    if (aiCaption) metaPayload.caption = aiCaption;
    
    const randomOffsetMs = Math.floor((Math.random() * (Math.max(1, videoDuration - 2)) + 1) * 1000);
    metaPayload.thumb_offset = randomOffsetMs.toString();

    const createRes = await fetch(metaCreateUrl, { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(metaPayload).toString()
    });
    const createData = await createRes.json();
    if (createData.error) {
      const errDetail = createData.error.error_user_msg || createData.error.message;
      const subcode = createData.error.error_subcode ? ` (subcode: ${createData.error.error_subcode})` : '';
      throw new Error(`Meta API Create Error: ${errDetail}${subcode}`);
    }
    const creation_id = createData.id;

    await supabase.from('reels_queue').update({ creation_id }).eq('id', item.id);

    // 5. Poll Meta Status
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 36) {
      attempts++;
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creation_id}?${new URLSearchParams({ fields: 'status_code', access_token: PAGE_ACCESS_TOKEN })}`);
      const statusData = await statusRes.json();
      if (statusData.error) {
        const errDetail = statusData.error.error_user_msg || statusData.error.message;
        throw new Error(`Meta API Status Error: ${errDetail}`);
      }
      if (statusData.status_code === 'FINISHED') isReady = true;
      else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') throw new Error(`Meta Processing Failed: ${statusData.status_code}`);
    }
    if (!isReady) throw new Error('Timeout waiting for Meta to finish processing.');

    // 6. Meta Publish
    console.log(`Publishing Reel for ${targetAccount}...`);
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish?${new URLSearchParams({ creation_id: creation_id, access_token: PAGE_ACCESS_TOKEN })}`, { method: 'POST' });
    const publishData = await publishRes.json();
    if (publishData.error) {
      const errDetail = publishData.error.error_user_msg || publishData.error.message;
      const subcode = publishData.error.error_subcode ? ` (subcode: ${publishData.error.error_subcode})` : '';
      throw new Error(`Meta API Publish Error: ${errDetail}${subcode}`);
    }

    console.log(`Reel published successfully for ${targetAccount}! 🎉`);

    // 7. Mark Success in Supabase IMMEDIATELY before external cleanup
    await supabase.from('reels_queue').update({ status: 'PUBLISHED', error_log: null }).eq('id', item.id);

    // 8. Cleanup R2 temporary asset & update cooldown timestamp
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: uploadName })).catch(e => console.error(e));
    
    const finalLockCmd = new PutObjectCommand({ 
      Bucket: bucketName, 
      Key: `last_published_${targetAccount}.txt`, 
      Body: Date.now().toString(), 
      ContentType: 'text/plain' 
    });
    await S3.send(finalLockCmd).catch(e => console.error(e));

  } catch (processError) {
    console.error(`Error processing item ${item.id} for ${targetAccount}:`, processError);
    await supabase.from('reels_queue').update({ status: 'FAILED', error_log: processError.message }).eq('id', item.id);
  } finally {
    try {
      if (fileId) {
        const tempDir = os.tmpdir();
        const leftoverFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(fileId));
        for (const f of leftoverFiles) {
          try { fs.unlinkSync(path.join(tempDir, f)); } catch (e) {}
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

const handler = async function(event, context) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase environment variables');
    return { statusCode: 500 };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const accountIdR2 = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || 'reels';
  
  if (!accountIdR2 || !accessKeyId || !secretAccessKey) {
    console.error('Missing R2 environment variables');
    return { statusCode: 500 };
  }

  const S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountIdR2}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const supportedAccounts = ['account1', 'account2'];
    
    // Evaluate each account independently to ensure zero starvation across accounts
    for (const targetAccount of supportedAccounts) {
      try {
        // 1. STRICT CONCURRENCY GUARD: Check if an item is ALREADY being processed for this account
        let procQuery = supabase
          .from('reels_queue')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'PROCESSING');
        
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
            console.log(`Resetting ${staleItems.length} orphaned processing item(s) for ${targetAccount} back to PENDING...`);
            const staleIds = staleItems.map(i => i.id);
            await supabase.from('reels_queue').update({ status: 'PENDING', error_log: 'Reset orphaned PROCESSING state (>10m)' }).in('id', staleIds);
            continue; // Skip this tick after clearing stale items to prevent burst processing
          } else {
            console.log(`[CONCURRENCY GUARD] ${targetAccount} already has ${activeProcs.length} video(s) in active PROCESSING state. Skipping to enforce 1-at-a-time processing.`);
            continue;
          }
        }

        // 3. Fetch cooldown for this specific account
        let lastPub = 0;
        try {
          const command = new GetObjectCommand({ Bucket: bucketName, Key: `last_published_${targetAccount}.txt` });
          const response = await S3.send(command);
          const text = await response.Body.transformToString();
          lastPub = parseInt(text, 10);
        } catch (e) {
          // File not found or first run
        }
        
        const now = Date.now();
        const cooldownMinutes = (now - (isNaN(lastPub) ? 0 : lastPub)) / (1000 * 60);

        // 4. Fetch oldest pending item specifically for this account
        let query = supabase
          .from('reels_queue')
          .select('*')
          .eq('status', 'PENDING');
        
        if (targetAccount === 'account1') {
          query = query.or('account_id.eq.account1,account_id.is.null');
        } else {
          query = query.eq('account_id', targetAccount);
        }

        const { data: queueItems, error: fetchError } = await query
          .order('created_at', { ascending: true })
          .limit(1);

        if (fetchError) {
          console.error(`Error querying queue for ${targetAccount}:`, fetchError);
          continue;
        }

        if (!queueItems || queueItems.length === 0) {
          console.log(`No pending items in queue for ${targetAccount}.`);
          continue;
        }

        const item = queueItems[0];
        const isDirectUpload = item.url && item.url.startsWith('supabase://');

        // 5. Check readiness (organic 20-25m delay, direct upload bypass, or local testing)
        let isReady = false;
        if (process.env.IS_LOCAL || isDirectUpload) {
          isReady = true;
        } else if (cooldownMinutes >= 20) {
          if (cooldownMinutes < 25 && Math.random() > 0.5) {
            console.log(`${targetAccount} is between 20-25m cooldown (${cooldownMinutes.toFixed(1)}m). Applying organic jitter; skipping this tick.`);
            isReady = false;
          } else {
            isReady = true;
          }
        }

        if (!isReady) {
          console.log(`${targetAccount} is on cooldown (${cooldownMinutes.toFixed(1)}m elapsed / 20m required). Skipping for now.`);
          continue;
        }

        console.log(`Ready to process item ${item.id} for ${targetAccount} (${cooldownMinutes.toFixed(1)}m since last post).`);
        await processSingleItem(supabase, S3, bucketName, item, targetAccount);

      } catch (accErr) {
        console.error(`Error during processing cycle for ${targetAccount}:`, accErr);
      }
    }

    return { statusCode: 200 };

  } catch (error) {
    console.error('Background worker handler fatal error:', error);
    return { statusCode: 500, body: error.stack || error.message };
  }
};

exports.handler = handler;
