const { schedule } = require('@netlify/functions');

const handler = async function(event, context) {
  // Get the URL of the current site, hardcoded to ensure cron works on Netlify
  const siteUrl = process.env.URL || 'https://abc3838.netlify.app';
  const workerUrl = `${siteUrl}/.netlify/functions/process-worker-background`;

  console.log(`Cron triggered! Invoking background worker at ${workerUrl}`);

  try {
    // We send a POST request to kick off the background function.
    // We don't wait for it to finish (because it's a background function, it returns 202 immediately).
    await fetch(workerUrl, { method: 'POST' });
    return { statusCode: 200 };
  } catch (err) {
    console.error('Error invoking background worker:', err);
    return { statusCode: 500 };
  }
};

exports.handler = schedule("*/5 * * * *", handler);


// Vercel Serverless Function Adapter
module.exports = async (req, res) => {
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
    const result = await exports.handler(event, {});
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
