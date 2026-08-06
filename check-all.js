const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.from('reels_queue').select('*');
  if (error) {
    console.error(error);
    return;
  }
  const summary = data.reduce((acc, row) => {
    const key = `${row.account_id || 'null'}_${row.status}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log("Summary:", summary);

  const acc2 = data.filter(d => d.account_id === 'account2');
  console.log("Account 2 items count:", acc2.length);
  if (acc2.length > 0) {
    console.log("Latest Account 2 items:", JSON.stringify(acc2.slice(0, 5), null, 2));
  }
}
check();
