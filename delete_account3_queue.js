require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function deleteAccount3Queue() {
  console.log('Deleting all entries for account3 from reels_queue...');
  const { error } = await supabase
    .from('reels_queue')
    .delete()
    .eq('account_id', 'account3');

  if (error) {
    console.error('Error deleting account3 queue:', error);
  } else {
    console.log('Successfully deleted all account3 entries.');
  }
}

deleteAccount3Queue();
