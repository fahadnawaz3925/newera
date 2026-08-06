const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  try {
    if (event.httpMethod === 'GET') {
      const accountId = event.queryStringParameters?.accountId || 'account1';
      const maxViews = parseInt(event.queryStringParameters?.maxViews || '20', 10);
      const minAgeHours = parseInt(event.queryStringParameters?.minAgeHours || '24', 10);

      let IG_BUSINESS_ACCOUNT_ID, PAGE_ACCESS_TOKEN;
      if (accountId === 'account2') {
        IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_2;
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2;
      } else {
        IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_1;
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1;
      }

      if (!IG_BUSINESS_ACCOUNT_ID || !PAGE_ACCESS_TOKEN) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing Meta API credentials for ${accountId}` })
        };
      }

      // 1. Fetch recent media items from Meta Graph API
      const mediaUrl = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,like_count,comments_count&limit=50&access_token=${PAGE_ACCESS_TOKEN}`;
      const mediaRes = await fetch(mediaUrl);
      const mediaData = await mediaRes.json();

      if (mediaData.error) {
        throw new Error(mediaData.error.message || 'Failed to fetch Instagram media list');
      }

      const items = mediaData.data || [];
      const nowMs = Date.now();
      const minAgeMs = minAgeHours * 60 * 60 * 1000;
      const lowPerformingPosts = [];

      for (const item of items) {
        const postTimestampMs = new Date(item.timestamp).getTime();
        const ageMs = nowMs - postTimestampMs;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

        // Filter: Must be older than minAgeHours (e.g. 24 hours)
        if (ageMs < minAgeMs) {
          continue;
        }

        // 2. Fetch insights (plays / views) for this reel
        let viewCount = 0;
        try {
          const insightsUrl = `https://graph.facebook.com/v19.0/${item.id}/insights?metric=plays,views&access_token=${PAGE_ACCESS_TOKEN}`;
          const insightsRes = await fetch(insightsUrl);
          const insightsData = await insightsRes.json();

          if (insightsData.data) {
            for (const metric of insightsData.data) {
              if (metric.name === 'plays' || metric.name === 'views') {
                const val = metric.values?.[0]?.value || 0;
                if (val > viewCount) viewCount = val;
              }
            }
          }
        } catch (insightsErr) {
          console.warn(`Failed to fetch insights for media ${item.id}:`, insightsErr.message);
        }

        // Filter: Views must be less than maxViews threshold (e.g. < 20 views)
        if (viewCount < maxViews) {
          lowPerformingPosts.push({
            id: item.id,
            caption: item.caption ? item.caption.split('\n')[0] : 'No caption',
            timestamp: item.timestamp,
            ageHours,
            permalink: item.permalink || '#',
            thumbnailUrl: item.thumbnail_url || null,
            views: viewCount,
            likes: item.like_count || 0,
            comments: item.comments_count || 0,
            mediaType: item.media_type
          });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          accountId,
          maxViewsThreshold: maxViews,
          minAgeHoursThreshold: minAgeHours,
          count: lowPerformingPosts.length,
          posts: lowPerformingPosts
        })
      };
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        if (event.body) body = JSON.parse(event.body);
      } catch (e) {}

      const { accountId, mediaIds, mediaId } = body;
      const idsToDelete = mediaIds || (mediaId ? [mediaId] : []);

      if (!idsToDelete.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No media IDs provided for deletion' })
        };
      }

      let PAGE_ACCESS_TOKEN;
      if (accountId === 'account2') {
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2;
      } else {
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1;
      }

      if (!PAGE_ACCESS_TOKEN) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing Meta API token for ${accountId}` })
        };
      }

      const results = [];
      for (const id of idsToDelete) {
        try {
          const deleteUrl = `https://graph.facebook.com/v19.0/${id}?access_token=${PAGE_ACCESS_TOKEN}`;
          const delRes = await fetch(deleteUrl, { method: 'DELETE' });
          const delData = await delRes.json();

          if (delData.success || delData.id) {
            results.push({ id, success: true });
            if (supabase) {
              await supabase.from('reels_queue').update({ status: 'DELETED' }).eq('creation_id', id);
            }
          } else {
            results.push({ id, success: false, error: delData.error?.message || 'Meta API Delete error' });
          }
        } catch (err) {
          results.push({ id, success: false, error: err.message });
        }
      }

      const successfulDeletions = results.filter(r => r.success).length;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Successfully deleted ${successfulDeletions} of ${idsToDelete.length} reel(s)`,
          results
        })
      };
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };

  } catch (error) {
    console.error('Error in api-analyze-reels:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
