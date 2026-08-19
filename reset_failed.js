require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function resetFailed() {
  const { data, error } = await supabase
    .from('reels_queue')
    .update({ status: 'PENDING', error_log: null })
    .in('status', ['FAILED', 'PROCESSING']);
    
  if (error) console.error('Error resetting queue:', error);
  else console.log('Queue reset complete!');

  const { error: accErr } = await supabase
    .from('reels_accounts')
    .update({ last_post_time: '2020-01-01T00:00:00.000Z' })
    .in('account_id', ['account1', 'account2', 'account3']);

  if (accErr) console.error('Error resetting cooldowns:', accErr);
  else console.log('Cooldowns reset complete!');
}

resetFailed();
