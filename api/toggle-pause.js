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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const accountId = event.queryStringParameters?.accountId || (event.body ? JSON.parse(event.body).accountId : 'account1') || 'account1';

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
      const targetAcc = body.accountId || accountId;

      if (!S3) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'R2 storage not configured' }) };
      }

      if (action === 'pause') {
        await S3.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: `paused_${targetAcc}.txt`,
          Body: 'true',
          ContentType: 'text/plain'
        }));
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ accountId: targetAcc, isPaused: true, message: `Account ${targetAcc} paused successfully` })
        };
      } else {
        await S3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: `paused_${targetAcc}.txt`
        })).catch(() => {});
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ accountId: targetAcc, isPaused: false, message: `Account ${targetAcc} resumed successfully` })
        };
      }
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  } catch (error) {
    console.error('Error in toggle-pause:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
