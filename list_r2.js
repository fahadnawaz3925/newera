require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});
S3.send(new ListObjectsV2Command({ Bucket: 'reels', Prefix: 'f408' }))
  .then(d => console.log(d.Contents ? d.Contents.map(c => c.Key) : 'Empty'))
  .catch(console.error);
