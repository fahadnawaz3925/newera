const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME || 'reels';

    if (!accountId || !accessKeyId || !secretAccessKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing Cloudflare R2 environment variables' }) };
    }

    const S3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const body = JSON.parse(event.body);
    const originalName = body.fileName || 'upload.bin';
    const ext = path.extname(originalName);
    
    // Generate a secure random filename to prevent collisions
    const randomId = crypto.randomBytes(8).toString('hex');
    const safeName = `${randomId}${ext}`;
    const storagePath = `uploads/${safeName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: storagePath,
      ContentType: body.contentType || 'application/octet-stream',
    });

    const signedUrl = await getSignedUrl(S3, command, { expiresIn: 3600 });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedUrl: signedUrl,
        storagePath: storagePath
      })
    };
  } catch (error) {
    console.error('API Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
