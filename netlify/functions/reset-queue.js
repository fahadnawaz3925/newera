const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase credentials missing' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let body = {};
    try {
      if (event.body) body = JSON.parse(event.body);
    } catch (e) {}
    const accountId = body.accountId || event.queryStringParameters?.accountId;

    // Reset "published" and "failed" items back to "PENDING" to restart the loop
    let query = supabase
      .from('reels_queue')
      .update({ status: 'PENDING' })
      .in('status', ['PUBLISHED', 'FAILED', 'published', 'failed']);

    if (accountId) {
      if (accountId === 'account1') {
        query = query.or('account_id.eq.account1,account_id.is.null');
      } else {
        query = query.eq('account_id', accountId);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Queue successfully reset!' }),
    };
  } catch (err) {
    console.error('Error resetting queue:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to reset queue' }),
    };
  }
};
