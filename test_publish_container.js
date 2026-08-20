require('dotenv').config();
const fetch = require('node-fetch') || globalThis.fetch;
fetch(`https://graph.facebook.com/v19.0/${process.env.IG_BUSINESS_ACCOUNT_ID_1}/media_publish?creation_id=18099326981458313&access_token=${process.env.PAGE_ACCESS_TOKEN_1}`, { method: 'POST' })
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(console.error);
