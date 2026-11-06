const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const accountIdR2 = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'reels';

let S3 = null;
if (accountIdR2 && accessKeyId && secretAccessKey) {
  S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountIdR2}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const accountId = (event.queryStringParameters && event.queryStringParameters.accountId) || 
                    (event.body ? JSON.parse(event.body).accountId : 'account1') || 'account1';

  try {
    if (event.httpMethod === 'GET') {
      let isPaused = false;
      if (S3) {
        try {
          const res = await S3.send(new GetObjectCommand({ Bucket: bucketName, Key: `paused_${accountId}.txt` }));
          const str = (await res.Body.transformToString()).trim();
          isPaused = str === 'true' || str === '1';
        } catch (e) {}
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ accountId, isPaused })
      };
    }

    if (event.httpMethod === 'POST') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
      const action = body.action || (body.pause ? 'pause' : 'resume');
      const shouldPause = action === 'pause';

      if (S3) {
        if (shouldPause) {
          await S3.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: `paused_${accountId}.txt`,
            Body: 'true',
            ContentType: 'text/plain'
          }));
        } else {
          try {
            await S3.send(new DeleteObjectCommand({
              Bucket: bucketName,
              Key: `paused_${accountId}.txt`
            }));
          } catch (delErr) {}
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          accountId,
          isPaused: shouldPause,
          message: `Posting for ${accountId} is now ${shouldPause ? 'PAUSED' : 'ACTIVE'}`
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
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
