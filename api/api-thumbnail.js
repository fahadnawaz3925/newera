exports.handler = async (event) => {
  const url = event.queryStringParameters.url;
  if (!url) return { statusCode: 400, body: 'Missing URL' };
  
  try {
    const res = await fetch(url); // intentionally no user-agent to force static SSR
    const html = await res.text();
    const match = html.match(/<meta property="og:image" content="([^"]+)"/i);
    
    if (match && match[1]) {
      return {
        statusCode: 302,
        headers: {
          Location: match[1].replace(/&amp;/g, '&'),
          'Cache-Control': 'public, max-age=86400'
        }
      };
    }
    
    return { statusCode: 404, body: 'Thumbnail not found in HTML' };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'Error fetching thumbnail' };
  }
};


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
