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
      const maxViews = parseInt(event.queryStringParameters?.maxViews || '10', 10);
      const minAgeHours = parseInt(event.queryStringParameters?.minAgeHours || '24', 10);
      const filterType = event.queryStringParameters?.filterType || 'views';

      let IG_BUSINESS_ACCOUNT_ID, PAGE_ACCESS_TOKEN;
      if (accountId === 'account2') {
        IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_2 || '17841437943644004';
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2 || 'EAATskyTkvQUBSPx63pc2l50ADuLfubOt2qve4xQZCTvtGd6jBwsnGyIozjMmeTh8aNSZC82VMfEVkZCDLeHTOZBg6buaBLsXglk8dI0CiFV3ZChF1VWsmWZAELZADUUh5nAopRQFvvhMTSXTnZCcKR4NdzV9FtZCB4qYQUKOWrDZABEcllZB5gzotc9LYrCRFNpSYxx';
      } else {
        IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_1 || '17841443749365419';
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1 || 'EAAekzJlZBCl0BSMCa03IvS4LvzBU7ioqGXCdm5iaGvFA1jBvQhmVHfA90TfGJZCgnJPtazLm91UthuDqIAIIeK1Xq6yd3LE7aZBs7GRNhMECD9JJ9eSSE05PUqCiHtUwj1T0jzI1AV3yVOB9jGgJFjwlq5EbJXyYwewagt9I60qh0a20YZCgfTRcZCjdoMJlQ9n1W';
      }

      if (!IG_BUSINESS_ACCOUNT_ID || !PAGE_ACCESS_TOKEN) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Missing Meta API credentials for ${accountId}` })
        };
      }

      let allItems = [];
      let nextUrl = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,like_count,comments_count&limit=50&access_token=${PAGE_ACCESS_TOKEN}`;
      let pageCount = 0;

      while (nextUrl && pageCount < 3) {
        pageCount++;
        const mediaRes = await fetch(nextUrl);
        const mediaData = await mediaRes.json();

        if (mediaData.error) {
          throw new Error(mediaData.error.message || 'Failed to fetch Instagram media list');
        }

        const items = mediaData.data || [];
        allItems = allItems.concat(items);
        nextUrl = mediaData.paging?.next || null;
      }

      const nowMs = Date.now();
      const minAgeMs = minAgeHours * 60 * 60 * 1000;
      const lowPerformingPosts = [];
      let hasInsightsPermission = true;

      for (const item of allItems) {
        const postTimestampMs = new Date(item.timestamp).getTime();
        const ageMs = nowMs - postTimestampMs;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

        if (ageMs < minAgeMs) {
          continue;
        }

        const likes = item.like_count || 0;
        const comments = item.comments_count || 0;
        const totalEngagement = likes + comments;

        let viewCount = 0;
        let insightsFetched = false;

        try {
          const insightsUrl = `https://graph.facebook.com/v19.0/${item.id}/insights?metric=plays&access_token=${PAGE_ACCESS_TOKEN}`;
          const insightsRes = await fetch(insightsUrl);
          const insightsData = await insightsRes.json();

          if (insightsData.error) {
            if (insightsData.error.code === 10 || insightsData.error.message?.includes('permission')) {
              hasInsightsPermission = false;
            }
          } else if (insightsData.data) {
            insightsFetched = true;
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

        let isLowPerforming = false;
        if (filterType === 'likes') {
          isLowPerforming = likes < maxViews;
        } else if (filterType === 'engagement') {
          isLowPerforming = totalEngagement < maxViews;
        } else {
          if (insightsFetched && hasInsightsPermission) {
            isLowPerforming = viewCount < maxViews;
          } else {
            isLowPerforming = likes < Math.max(1, Math.floor(maxViews / 2));
          }
        }

        if (isLowPerforming) {
          lowPerformingPosts.push({
            id: item.id,
            caption: item.caption ? item.caption.split('\n')[0] : 'No caption',
            timestamp: item.timestamp,
            ageHours,
            permalink: item.permalink || '#',
            thumbnailUrl: item.thumbnail_url || null,
            views: insightsFetched ? viewCount : null,
            likes,
            comments,
            totalEngagement,
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
          hasInsightsPermission,
          totalScanned: allItems.length,
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

      let PAGE_ACCESS_TOKEN, IG_SESSION_ID;
      if (accountId === 'account2') {
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_2 || 'EAATskyTkvQUBSPx63pc2l50ADuLfubOt2qve4xQZCTvtGd6jBwsnGyIozjMmeTh8aNSZC82VMfEVkZCDLeHTOZBg6buaBLsXglk8dI0CiFV3ZChF1VWsmWZAELZADUUh5nAopRQFvvhMTSXTnZCcKR4NdzV9FtZCB4qYQUKOWrDZABEcllZB5gzotc9LYrCRFNpSYxx';
        IG_SESSION_ID = process.env.IG_SESSION_ID_2;
      } else {
        PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1 || 'EAAekzJlZBCl0BSMCa03IvS4LvzBU7ioqGXCdm5iaGvFA1jBvQhmVHfA90TfGJZCgnJPtazLm91UthuDqIAIIeK1Xq6yd3LE7aZBs7GRNhMECD9JJ9eSSE05PUqCiHtUwj1T0jzI1AV3yVOB9jGgJFjwlq5EbJXyYwewagt9I60qh0a20YZCgfTRcZCjdoMJlQ9n1W';
        IG_SESSION_ID = process.env.IG_SESSION_ID_1;
      }

      const results = [];
      for (const id of idsToDelete) {
        let deletedSuccessfully = false;

        try {
          const deleteUrl = `https://graph.facebook.com/v19.0/${id}?access_token=${PAGE_ACCESS_TOKEN}`;
          const delRes = await fetch(deleteUrl, { method: 'DELETE' });
          const delData = await delRes.json();
          if (delData.success || delData.id) {
            deletedSuccessfully = true;
          }
        } catch (err) {}

        if (!deletedSuccessfully && IG_SESSION_ID) {
          try {
            const igRes = await fetch(`https://www.instagram.com/api/v1/media/${id}/delete/?media_type=VIDEO`, {
              method: 'POST',
              headers: {
                'Cookie': `sessionid=${IG_SESSION_ID}`,
                'User-Agent': 'Instagram 275.0.0.27.98 Android',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest'
              }
            });
            const igData = await igRes.json();
            if (igData.status === 'ok' || igData.did_delete) {
              deletedSuccessfully = true;
            }
          } catch (e) {}
        }

        if (supabase) {
          await supabase.from('reels_queue').update({ status: 'DELETED' }).eq('creation_id', id);
          await supabase.from('reels_queue').update({ status: 'DELETED' }).eq('id', id);
        }

        results.push({ id, success: true, apiDeleted: deletedSuccessfully });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: `Successfully processed deletion for ${idsToDelete.length} reel(s)`,
          results
        })
      };
    }

    return { statusCode: 405, headers, body: 'Method Not Allowed' };

  } catch (error) {
    console.error('API Analyze Reels Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
