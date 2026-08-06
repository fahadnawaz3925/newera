const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.from('reels_queue').select('*').eq('status', 'FAILED').order('created_at', { ascending: false }).limit(3);
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}
check();
