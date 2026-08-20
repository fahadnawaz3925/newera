require('dotenv').config();
const fetch = require('node-fetch') || globalThis.fetch;
fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account,name,access_token&access_token=EAAXw22YHwGQBSVijZCDpCnm26BCVW2T1S5jPkMqLPVoyxJxZBHbf1MA7BcI23gGsyCOYTpc1sAHVdwcBqGZBhfPr1zoZCZBZAGDokJr3dik6HlEa30QRjDtX9GmSiBsddLQ2nKmODNhiZBPsHLoMnAFcLk9rRIoviENAolo4eDBX9TvTZAkB2umJajgvc5BrcogNiPFOMLZC8X0qMwOZCdKZAeI9ERY6Q73n0DB6ytRmzyyuNZBE1Oz0ZAZAQhvnbakdkmA5zeJ64EkvmIWfh6ZABH5z83g`)
  .then(r => r.json())
  .then(d => console.log(JSON.stringify(d, null, 2)))
  .catch(console.error);
