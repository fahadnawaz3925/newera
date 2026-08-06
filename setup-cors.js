const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const corsParams = {
  Bucket: env.R2_BUCKET_NAME || 'reels',
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        AllowedOrigins: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3000,
      },
    ],
  },
};

const run = async () => {
  try {
    const data = await S3.send(new PutBucketCorsCommand(corsParams));
    console.log("Success! CORS configured for R2 bucket.", data);
  } catch (err) {
    console.error("Error setting CORS", err);
  }
};
run();
