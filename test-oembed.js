const fetch = require('node-fetch');
require('dotenv').config();

async function testOembed() {
  const url = 'https://www.instagram.com/reel/DS-gJnKjeOm/';
  const token = process.env.PAGE_ACCESS_TOKEN_1;
  const oembedUrl = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`;
  
  console.log('Fetching:', oembedUrl);
  const res = await fetch(oembedUrl);
  const data = await res.json();
  console.log(data);
}

testOembed();
