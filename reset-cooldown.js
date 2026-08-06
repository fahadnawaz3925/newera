const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

async function resetCooldown() {
  await S3.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME || 'reels',
    Key: 'last_published_account2.txt',
    Body: '0',
    ContentType: 'text/plain'
  }));
  console.log('Successfully reset cooldown for account2 to 0!');
}
resetCooldown();
