require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function repostAccount3() {
  console.log('Fetching PUBLISHED videos for account3...');
  const { data, error } = await supabase
    .from('reels_queue')
    .select('id, url, status')
    .eq('account_id', 'account3')
    .eq('status', 'PUBLISHED');

  if (error) {
    console.error('Error fetching queue:', error);
    return;
  }

  if (data.length === 0) {
    console.log('No published videos found for account3.');
    return;
  }

  console.log(`Found ${data.length} published videos. Resetting to PENDING...`);
  
  for (const item of data) {
    const { error: updateError } = await supabase
      .from('reels_queue')
      .update({
        status: 'PENDING',
        creation_id: null,
        error_log: null
      })
      .eq('id', item.id);
      
    if (updateError) {
      console.error(`Failed to update ${item.id}:`, updateError);
    } else {
      console.log(`Reset ${item.id} (${item.url})`);
    }
  }
  console.log('Done resetting videos for account3.');
}

repostAccount3();
