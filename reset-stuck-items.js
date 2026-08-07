const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

async function resetStuckItems() {
  console.log("Resetting items stuck in PROCESSING back to PENDING...");
  const { data, error } = await supabase
    .from('reels_queue')
    .update({ status: 'PENDING', error_log: null })
    .eq('status', 'PROCESSING')
    .select();

  if (error) {
    console.error("Error resetting stuck items:", error);
  } else {
    console.log(`Successfully reset ${data ? data.length : 0} items from PROCESSING to PENDING.`);
  }
}

resetStuckItems();
