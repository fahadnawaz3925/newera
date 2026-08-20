require('dotenv').config();
const fetch = require('node-fetch') || globalThis.fetch;
fetch(`https://graph.facebook.com/v19.0/18099326981458313?fields=status_code,status&access_token=${process.env.PAGE_ACCESS_TOKEN_1}`)
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(console.error);
