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
