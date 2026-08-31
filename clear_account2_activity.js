require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const S3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucketName = process.env.R2_BUCKET_NAME || 'reels';

async function clearAccount2Activity() {
  console.log('=== Clearing Account 2 Recent Activity in Supabase ===');

  // 1. Fetch all non-pending items for account2
  const { data: nonPending, error: fetchErr } = await supabase
    .from('reels_queue')
    .select('id, status, url')
    .eq('account_id', 'account2')
    .neq('status', 'PENDING');

  if (fetchErr) {
    console.error('Error fetching non-pending items:', fetchErr.message);
  } else {
    console.log(`Found ${nonPending.length} non-pending (activity) items for Account 2.`);
    if (nonPending.length > 0) {
      const idsToDelete = nonPending.map(item => item.id);
      const { error: delErr } = await supabase
        .from('reels_queue')
        .delete()
        .in('id', idsToDelete);

      if (delErr) {
        console.error('Error deleting activity items:', delErr.message);
      } else {
        console.log(`✅ Successfully deleted ${idsToDelete.length} recent activity items for Account 2.`);
      }
    }
  }

  // 2. Clear any lingering rate limit file or stuck locks in R2
  console.log('\n=== Resetting R2 Cooldowns for Account 2 ===');
  try {
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'rate_limit_account2.txt' }));
    console.log('✅ Cleared rate_limit_account2.txt');
  } catch (e) {
    console.log('rate_limit_account2.txt not present or cleared');
  }

  try {
    await S3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'worker_lock_account2.json' }));
    console.log('✅ Cleared worker_lock_account2.json');
  } catch (e) {
    console.log('worker_lock_account2.json not present or cleared');
  }

  // Set last_published_account2 to 0 and next_scheduled_account2 to 0 to trigger immediate post
  await S3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'last_published_account2.txt',
    Body: '0',
    ContentType: 'text/plain'
  })).catch(e => console.error(e));

  await S3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'next_scheduled_account2.txt',
    Body: '0',
    ContentType: 'text/plain'
  })).catch(e => console.error(e));

  console.log('✅ Set last_published and next_scheduled for account2 to 0 (immediate post trigger).');

  // 3. Verify final state of Account 2
  const { data: finalQueue, error: finalErr } = await supabase
    .from('reels_queue')
    .select('id, status')
    .eq('account_id', 'account2');

  if (!finalErr) {
    const summary = {};
    finalQueue.forEach(item => {
      summary[item.status] = (summary[item.status] || 0) + 1;
    });
    console.log('\nFinal Account 2 Queue Breakdown:', summary);
    console.log(`Total items remaining for Account 2: ${finalQueue.length} (All PENDING & ready to post!)`);
  }
}

clearAccount2Activity();
