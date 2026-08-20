require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fixQueue() {
  const { data, error } = await supabase
    .from('reels_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching queue:', error);
    return;
  }
  
  console.log('Recent Queue Items:');
  for (const item of data) {
    console.log(`ID: ${item.id} | Account: ${item.account_id} | Status: ${item.status} | URL: ${item.video_url}`);
    
    // If the account is account1 but it's a cat video, move it to account3
    if (item.account_id === 'account1' && item.video_url && item.video_url.includes('cat_reel')) {
      console.log(`-> Updating item ${item.id} to account3 and PENDING`);
      await supabase.from('reels_queue').update({
        account_id: 'account3',
        status: 'PENDING',
        error_log: null
      }).eq('id', item.id);
    }
  }
}

fixQueue();
