require('dotenv').config();
const fs = require('fs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fetch = require('node-fetch') || globalThis.fetch;
const { pipeline } = require('stream/promises');

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucketName = process.env.R2_BUCKET_NAME;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTest() {
  try {
    console.log("1. Downloading a tiny 5-second test video...");
    const vidRes = await fetch('https://www.w3schools.com/html/mov_bbb.mp4');
    const localPath = 'test_sample.mp4';
    await pipeline(vidRes.body, fs.createWriteStream(localPath));

    console.log("2. Uploading test video to R2...");
    const fileBuffer = fs.readFileSync(localPath);
    await S3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: 'test_sample.mp4',
      Body: fileBuffer,
      ContentType: 'video/mp4',
    }));

    console.log("3. Generating R2 presigned URL...");
    const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: 'test_sample.mp4' });
    const publicVideoUrl = await getSignedUrl(S3, getCmd, { expiresIn: 3600 });

    console.log("4. Hitting Meta Graph API to create Reel container...");
    const metaPayload = {
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: 'Testing automated API pipeline for Account 1! 🚀✨',
      thumb_offset: 2000,
      access_token: process.env.PAGE_ACCESS_TOKEN_1
    };

    const createRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.IG_BUSINESS_ACCOUNT_ID_1}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(metaPayload).toString()
    });
    const createData = await createRes.json();
    
    if (createData.error) {
      throw new Error(`Meta API Create Error: ${createData.error.message}`);
    }
    
    const creation_id = createData.id;
    console.log(`✅ Meta container created: ${creation_id}`);

    console.log(`5. Polling Meta container status...`);
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 20) {
      attempts++;
      await sleep(5000);
      const statusRes = await fetch(`https://graph.facebook.com/v19.0/${creation_id}?fields=status_code&access_token=${process.env.PAGE_ACCESS_TOKEN_1}`);
      const statusData = await statusRes.json();
      console.log(`   Status: ${statusData.status_code}`);
      if (statusData.status_code === 'FINISHED') isReady = true;
      else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
        throw new Error(`Meta Processing Failed: ${statusData.status_code}`);
      }
    }

    console.log(`6. Publishing Reel to Instagram Account 1...`);
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.IG_BUSINESS_ACCOUNT_ID_1}/media_publish?creation_id=${creation_id}&access_token=${process.env.PAGE_ACCESS_TOKEN_1}`, { method: 'POST' });
    const publishData = await publishRes.json();
    
    if (publishData.error) {
      console.error(publishData.error);
      throw new Error(`Meta API Publish Error: ${publishData.error.message}`);
    }

    console.log(`🎉 SUCCESS! Test Reel published to Account 1: ${publishData.id}`);

  } catch (e) {
    console.error("Test Failed:", e.message);
  }
}

runTest();
