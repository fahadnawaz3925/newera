const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

async function fix() {
  const { data, error } = await supabase
    .from('reels_queue')
    .update({ account_id: 'account2' })
    .eq('account_id', 'account1')
    .eq('status', 'PENDING');
    
  if (error) console.error(error);
  else console.log('Successfully updated pending items to account2!');
}
fix();
