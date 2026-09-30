require('dotenv').config({path: '.env'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const fs = require('fs');

const links = fs.readFileSync('account3_thehouseofcobbler_links.txt', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

async function insertQueue() {
  console.log('Inserting ' + links.length + ' videos into reels_queue for account3...');
  const records = links.map(url => ({
    url,
    status: 'PENDING',
    account_id: 'account3'
  }));

  // Batch insert in chunks of 50
  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50);
    const { data, error } = await supabase.from('reels_queue').insert(chunk);
    if (error) {
      console.error('Error inserting chunk:', error);
    } else {
      console.log('Inserted chunk ' + (i + 1) + ' to ' + Math.min(i + 50, records.length));
    }
  }
  console.log('All done!');
}

insertQueue();
