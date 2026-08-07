const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');

const handler = async (event, context) => {
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


const vercelAdapter = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body
  };

  try {
    const result = await handler(event, {});
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        res.setHeader(k, v);
      }
    }
    res.status(result.statusCode || 200);
    try {
      return res.json(JSON.parse(result.body));
    } catch (e) {
      return res.send(result.body);
    }
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message });
  }
};

vercelAdapter.handler = handler;
module.exports = vercelAdapter;
exports.handler = handler;
