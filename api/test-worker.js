const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, body: 'Missing required environment variables' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    const { data: queueItems, error: fetchError } = await supabase
      .from('reels_queue')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchError) throw fetchError;

    if (!queueItems || queueItems.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No pending reels in the queue.' }) };
    }

    const item = queueItems[0];
    
    // Simulate reading last_published.txt
    let minutesSinceLastPub = 999;
    try {
      const { data: fileData, error: fileErr } = await supabase.storage.from('reels').download('last_published.txt');
      if (!fileErr && fileData) {
        const text = await fileData.text();
        const lastPubTime = parseInt(text);
        if (!isNaN(lastPubTime)) {
          minutesSinceLastPub = (Date.now() - lastPubTime) / (1000 * 60);
        }
      }
    } catch (e) {}

    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        message: 'Successfully reached processing check!', 
        itemId: item.id,
        minutesSinceLastPub: minutesSinceLastPub
      }) 
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message, stack: error.stack }) };
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
