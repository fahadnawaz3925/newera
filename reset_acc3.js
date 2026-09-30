const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function resetAccount3() {
  console.log('Resetting stuck items for Account 3...');
  
  const { data, error } = await supabase
    .from('reels_queue')
    .update({ status: 'PENDING' })
    .in('status', ['FAILED', 'DOWNLOADING', 'PROCESSING'])
    .eq('account_id', 'account3')
    .select('id, status');

  if (error) {
    console.error('Error resetting items:', error);
  } else {
    console.log(`Successfully reset ${data.length} items back to PENDING for Account 3.`);
    data.forEach(item => console.log(`- Item ${item.id}`));
  }
}

resetAccount3();
