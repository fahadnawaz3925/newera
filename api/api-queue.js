const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const handler = async (event, context) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase credentials missing' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
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
    });
  }

  try {
    if (event.httpMethod === 'GET') {
      // Fetch queue
      const accountId = event.queryStringParameters?.accountId || 'account1';
      
      const { data, error } = await supabase
        .from('reels_queue')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      let lastPublished = 0;
      
      try {
        if (S3) {
          const command = new GetObjectCommand({ Bucket: bucketName, Key: `last_published_${accountId}.txt` });
          const response = await S3.send(command);
          const str = await response.Body.transformToString();
          lastPublished = parseInt(str);
        } else {
          const BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'reels';
          const { data: fileData, error: fileErr } = await supabase.storage.from(BUCKET_NAME).download(`last_published_${accountId}.txt`);
          if (!fileErr && fileData) {
            lastPublished = parseInt(await fileData.text());
          }
        }
      } catch (e) {}

      return {
        statusCode: 200,
        body: JSON.stringify({ queue: data, lastPublished })
      };
    } 
    else if (event.httpMethod === 'POST') {
      // Add to queue
      const { urls, accountId } = JSON.parse(event.body);
      if (!urls || !Array.isArray(urls)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Array of URLs is required' }) };
      }
      
      const targetAccount = accountId || 'account1';

      // Check if this account's queue currently has pending items
      let countQuery = supabase
        .from('reels_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');

      if (targetAccount === 'account1') {
        countQuery = countQuery.or('account_id.eq.account1,account_id.is.null');
      } else {
        countQuery = countQuery.eq('account_id', targetAccount);
      }

      const { count } = await countQuery;

      const rows = urls.map(url => ({ url, status: 'PENDING', account_id: targetAccount }));
      const { data, error } = await supabase
        .from('reels_queue')
        .insert(rows);

      if (error) throw error;

      // If the queue was empty, we want the first item to process instantly.
      // We set last_published to 0 to bypass the organic delay in the worker.
      if (count === 0) {
        if (S3) {
          const command = new PutObjectCommand({ Bucket: bucketName, Key: `last_published_${targetAccount}.txt`, Body: '0', ContentType: 'text/plain' });
          await S3.send(command).catch(e => console.error(e));
        } else {
          const BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'reels';
          await supabase.storage.from(BUCKET_NAME).upload(`last_published_${targetAccount}.txt`, '0', { 
            upsert: true, 
            contentType: 'text/plain' 
          });
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    }
    else if (event.httpMethod === 'DELETE') {
      const { id, ids, clearAll, scope, accountId } = JSON.parse(event.body);

      const targetAccount = accountId || 'account1';

      if (clearAll) {
        let statuses = ['PUBLISHED', 'FAILED', 'published', 'failed'];
        if (scope === 'pending') {
          statuses = ['PENDING', 'pending'];
        } else if (scope === 'all') {
          statuses = ['PENDING', 'pending', 'PUBLISHED', 'FAILED', 'published', 'failed', 'PROCESSING', 'processing'];
        }
        
        let query = supabase.from('reels_queue').delete();
        if (targetAccount === 'account1') {
          query = query.or(`account_id.eq.account1,account_id.is.null`);
        } else {
          query = query.eq('account_id', targetAccount);
        }

        const { error } = await query.in('status', statuses);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      }

      if (ids && Array.isArray(ids) && ids.length > 0) {
        const { error } = await supabase.from('reels_queue').delete().in('id', ids);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
      }

      if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'ID or IDs required' }) };

      const { error } = await supabase.from('reels_queue').delete().eq('id', id);
      if (error) throw error;
      
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }
    else if (event.httpMethod === 'PATCH') {
      // Reorder queue
      const { orderedIds } = JSON.parse(event.body);
      if (!orderedIds || !Array.isArray(orderedIds)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'orderedIds array required' }) };
      }

      // To reorder without a sort_order column, we cleverly rewrite the created_at timestamps.
      // The background worker picks the "oldest" first, so the item at index 0 should have the oldest timestamp.
      // We set the timestamps slightly in the past to ensure they stay ahead of newly added items.
      const baseTime = Date.now() - (1000 * 60 * 60 * 24); // Start 24 hours ago
      
      for (let i = 0; i < orderedIds.length; i++) {
        const fakeDate = new Date(baseTime + (i * 1000)).toISOString();
        const { error } = await supabase.from('reels_queue')
          .update({ created_at: fakeDate })
          .eq('id', orderedIds[i]);
          
        if (error) console.error('Error updating order:', error);
      }

      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };

  } catch (error) {
    console.error('api-queue error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
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
