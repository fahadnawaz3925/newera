const DEFAULT_FALLBACK_THUMB = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;
  if (!url) return { statusCode: 400, body: 'Missing URL' };
  
  try {
    if (url.startsWith('supabase://')) {
      return {
        statusCode: 302,
        headers: {
          Location: DEFAULT_FALLBACK_THUMB,
          'Cache-Control': 'public, max-age=86400'
        }
      };
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const match = html.match(/<meta property="og:image" content="([^"]+)"/i) || html.match(/<meta content="([^"]+)" property="og:image"/i);
    
    if (match && match[1]) {
      return {
        statusCode: 302,
        headers: {
          Location: match[1].replace(/&amp;/g, '&'),
          'Cache-Control': 'public, max-age=86400'
        }
      };
    }
    
    return {
      statusCode: 302,
      headers: {
        Location: DEFAULT_FALLBACK_THUMB,
        'Cache-Control': 'public, max-age=86400'
      }
    };
  } catch (err) {
    console.error('Error fetching thumbnail:', err);
    return {
      statusCode: 302,
      headers: {
        Location: DEFAULT_FALLBACK_THUMB,
        'Cache-Control': 'public, max-age=86400'
      }
    };
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
