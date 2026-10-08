require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  for (const acc of ['account1', 'account2', 'account3', 'account4', 'account5']) {
    const { data, error } = await supabase.from('reels_queue').select('status, url').eq('account_id', acc);
    if (error) {
      console.error(acc, error);
      continue;
    }
    const counts = {};
    data.forEach(d => counts[d.status] = (counts[d.status] || 0) + 1);
    console.log(`[${acc}] Total: ${data.length}`, counts);
    if (data.length > 0) {
      console.log(`  Sample 1st URL: ${data[0].url.substring(0, 80)}`);
    }
  }
}
check().catch(console.error);
