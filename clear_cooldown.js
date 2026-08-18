require('dotenv').config();
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  }
});
const bucketName = process.env.R2_BUCKET_NAME;

async function clearCooldowns() {
  try {
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'rate_limit_account1.txt' }));
    console.log('Cleared cooldown for account1');
  } catch (e) { console.log('account1 clear error:', e.message); }

  try {
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'rate_limit_account2.txt' }));
    console.log('Cleared cooldown for account2');
  } catch (e) { console.log('account2 clear error:', e.message); }
}

clearCooldowns();
