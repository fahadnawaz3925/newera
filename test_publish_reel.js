require('dotenv').config();
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const IG_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_1;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1;

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

async function run() {
  const getCmd = new GetObjectCommand({ Bucket: bucketName, Key: 'a994afaf-3bc3-4a54-a386-1b9292a33ad8.mp4' });
  const publicVideoUrl = await getSignedUrl(S3, getCmd, { expiresIn: 3600 });
  console.log('Video URL:', publicVideoUrl);

  console.log('Creating container without cover_url...');
  const createRes = await fetch(`https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: publicVideoUrl,
      caption: 'Test Reel without cover',
      access_token: PAGE_ACCESS_TOKEN
    })
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(JSON.stringify(createData));
  const containerId = createData.id;
  console.log('Container ID:', containerId);

  let isReady = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${PAGE_ACCESS_TOKEN}`);
    const statusData = await statusRes.json();
    console.log('Status:', statusData.status_code);
    if (statusData.status_code === 'FINISHED') {
      isReady = true;
      break;
    } else if (statusData.status_code === 'ERROR') {
      console.log('FULL ERROR DATA:', JSON.stringify(statusData, null, 2));
      throw new Error('Container Error');
    }
  }

  if (isReady) {
    console.log('Publishing...');
    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: PAGE_ACCESS_TOKEN
      })
    });
    const publishData = await publishRes.json();
    console.log('Publish Result:', publishData);
  }
}
run().catch(console.error);
