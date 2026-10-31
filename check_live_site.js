async function check() {
  const res = await fetch('https://newerafootwear.vercel.app?v=' + Date.now());
  const html = await res.text();
  const selectMatch = html.match(/<select id="account-select"[\s\S]*?<\/select>/);
  console.log('--- LIVE SELECT ON VERCEL (newerafootwear.vercel.app) ---');
  console.log(selectMatch ? selectMatch[0] : 'SELECT NOT FOUND');
}
check().catch(console.error);
