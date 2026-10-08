require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LOCAL_FOLDER = 'D:\\1.ISLAMIC REELS PROJECT\\JEWEL_HRIZOLIT PROCESSED';
const ORACLE_BASE_URL = 'http://80.225.246.34:3000/jewel';
const ORACLE_LOCAL_PATH = '/home/ubuntu/JEWEL_HRIZOLIT PROCESSED';

async function setupAccount5Queue() {
  console.log('💎 Reading video files from local directory...');
  const files = fs.readdirSync(LOCAL_FOLDER).filter(f => f.endsWith('.mp4'));
  console.log(`📊 Found ${files.length} video files.`);

  function getNumber(filename) {
    const match = filename.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Sort descending: 540 -> 001
  files.sort((a, b) => {
    return getNumber(b) - getNumber(a);
  });

  console.log(`\n🔝 Top 5 files in descending sequence:`);
  files.slice(0, 5).forEach((f, idx) => console.log(`   #${idx + 1}: ${f}`));

  console.log(`\n🔻 Bottom 5 files in descending sequence:`);
  files.slice(-5).forEach((f, idx) => console.log(`   #${files.length - 4 + idx}: ${f}`));

  console.log('\n🧹 Clearing existing account5 items from reels_queue...');
  const { error: delErr } = await supabase
    .from('reels_queue')
    .delete()
    .eq('account_id', 'account5');
  if (delErr) {
    console.warn('⚠️ Warning on delete:', delErr.message);
  } else {
    console.log('✅ Cleared existing account5 items.');
  }

  // Base timestamp: 3 hours ago, spaced by 1 second so FIFO created_at ASC picks 540 first
  const baseTime = Date.now() - (files.length * 2000);

  const rows = files.map((filename, idx) => {
    const sequentialTimestamp = new Date(baseTime + (idx * 1000)).toISOString();
    return {
      account_id: 'account5',
      url: `${ORACLE_BASE_URL}/${encodeURIComponent(filename)}`,
      status: 'PENDING',
      created_at: sequentialTimestamp
    };
  });

  console.log(`\n📥 Inserting ${rows.length} rows into reels_queue in batches of 50...`);
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: insErr } = await supabase.from('reels_queue').insert(batch);
    if (insErr) {
      console.error(`❌ Error inserting batch at index ${i}:`, insErr);
      throw insErr;
    }
    const progress = Math.min(i + batchSize, rows.length);
    console.log(`   ✅ Inserted ${progress}/${rows.length} items...`);
  }

  console.log('\n🎯 VERIFYING FINAL ORDER IN SUPABASE:');
  const { data: verifyAsc } = await supabase
    .from('reels_queue')
    .select('id, url, status, created_at')
    .eq('account_id', 'account5')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(5);

  console.log('Next 5 items to be posted (FIFO created_at ASC):');
  verifyAsc.forEach((x, idx) => {
    console.log(`   ${idx + 1}. ${x.url.split('/').pop()} [${x.created_at}]`);
  });

  const { count } = await supabase
    .from('reels_queue')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', 'account5');

  console.log(`\n✅ Account 5 queue successfully synchronized: ${count} videos in descending order (540 to 001)!`);
}

setupAccount5Queue().catch(console.error);
