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
