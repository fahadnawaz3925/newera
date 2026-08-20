require('dotenv').config();
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { 
    accessKeyId: process.env.R2_ACCESS_KEY_ID, 
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY 
  },
  forcePathStyle: true,
});

getSignedUrl(S3, new GetObjectCommand({ Bucket: 'reels', Key: 'f408ec875f5c2079.mp4' }), { expiresIn: 86400 })
  .then(console.log)
  .catch(console.error);
