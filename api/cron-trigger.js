const handler = async function(event, context) {
  const host = event.headers?.host || process.env.VERCEL_URL || process.env.URL || 'islamic-reels-poster.vercel.app';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const workerUrl = `${protocol}://${host}/api/process-worker-background`;

  console.log(`Cron triggered! Invoking background worker at ${workerUrl}`);

  try {
    const res = await fetch(workerUrl, { method: 'POST' });
    return { statusCode: 200, body: JSON.stringify({ message: 'Background worker invoked', workerUrl, status: res.status }) };
  } catch (err) {
    console.error('Error invoking background worker:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

exports.handler = handler;

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
    headers: req.headers || {},
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
