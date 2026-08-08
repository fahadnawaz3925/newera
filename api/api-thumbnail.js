const DEFAULT_FALLBACK_THUMB = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80';

// Core handler logic (standalone function, not on exports)
async function handleThumbnail(url) {
  if (!url) {
    return { statusCode: 302, headers: { Location: DEFAULT_FALLBACK_THUMB, 'Cache-Control': 'public, max-age=86400' } };
  }

  try {
    if (url.startsWith('supabase://')) {
      return { statusCode: 302, headers: { Location: DEFAULT_FALLBACK_THUMB, 'Cache-Control': 'public, max-age=86400' } };
    }

    // 1. Instagram Reel / Post shortcode fast redirect
    const igMatch = url.match(/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i);
    if (igMatch && igMatch[1]) {
      return {
        statusCode: 302,
        headers: { Location: `https://www.instagram.com/p/${igMatch[1]}/media/?size=m`, 'Cache-Control': 'public, max-age=86400' }
      };
    }

    // 2. YouTube Video / Shorts fast redirect
    const ytMatch = url.match(/(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
    if (ytMatch && ytMatch[1]) {
      return {
        statusCode: 302,
        headers: { Location: `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`, 'Cache-Control': 'public, max-age=86400' }
      };
    }

    // 3. Fallback html scraper for other URLs
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      const html = await res.text();
      const match = html.match(/<meta property="og:image" content="([^"]+)"/i) || html.match(/<meta content="([^"]+)" property="og:image"/i);
      if (match && match[1]) {
        return { statusCode: 302, headers: { Location: match[1].replace(/&amp;/g, '&'), 'Cache-Control': 'public, max-age=86400' } };
      }
    } catch (scrapeErr) {
      console.warn('Scrape fallback error:', scrapeErr.message);
    }

    return { statusCode: 302, headers: { Location: DEFAULT_FALLBACK_THUMB, 'Cache-Control': 'public, max-age=86400' } };
  } catch (err) {
    console.error('Error fetching thumbnail:', err);
    return { statusCode: 302, headers: { Location: DEFAULT_FALLBACK_THUMB, 'Cache-Control': 'public, max-age=86400' } };
  }
}

// Vercel Serverless Function (default export)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.query?.url;
  const result = await handleThumbnail(url);

  // Set response headers
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }

  // Handle redirect
  if (result.statusCode >= 300 && result.statusCode < 400 && result.headers?.Location) {
    return res.redirect(result.statusCode, result.headers.Location);
  }

  return res.status(result.statusCode || 200).end();
};
