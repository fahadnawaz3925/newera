require('dotenv').config();
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const accountIdR2 = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'reels';

let S3 = null;
if (accountIdR2 && accessKeyId && secretAccessKey) {
  S3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountIdR2}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

const ALL_ACCOUNTS = ['account1', 'account2', 'account3', 'account4', 'account5'];

async function getStatus(account) {
  let isPaused = false;
  if (S3) {
    try {
      const res = await S3.send(new GetObjectCommand({ Bucket: bucketName, Key: `paused_${account}.txt` }));
      const str = (await res.Body.transformToString()).trim();
      isPaused = str === 'true' || str === '1';
    } catch (e) {}
  }
  const localFile = path.join(__dirname, `paused_${account}.txt`);
  if (!isPaused && fs.existsSync(localFile)) {
    isPaused = true;
  }
  return isPaused;
}

async function setPause(account, pause) {
  const localFile = path.join(__dirname, `paused_${account}.txt`);
  if (pause) {
    fs.writeFileSync(localFile, 'true');
    if (S3) {
      await S3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: `paused_${account}.txt`,
        Body: 'true',
        ContentType: 'text/plain'
      })).catch(console.error);
    }
  } else {
    if (fs.existsSync(localFile)) {
      try { fs.unlinkSync(localFile); } catch (e) {}
    }
    if (S3) {
      await S3.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: `paused_${account}.txt`
      })).catch(console.error);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const accountArg = args[0] || 'status';
  const actionArg = args[1];

  if (accountArg === 'status' || accountArg === 'all') {
    console.log('\n📊 Account Posting Status Overview:');
    console.log('──────────────────────────────────────');
    for (const acc of ALL_ACCOUNTS) {
      const paused = await getStatus(acc);
      console.log(`  ${acc.padEnd(10)}: ${paused ? '⏸️  PAUSED' : '🟢 ACTIVE (Posting on schedule)'}`);
    }
    console.log('──────────────────────────────────────\n');
    return;
  }

  const validAccount = ALL_ACCOUNTS.includes(accountArg) ? accountArg : null;
  if (!validAccount) {
    console.log(`❌ Invalid account "${accountArg}". Valid accounts: ${ALL_ACCOUNTS.join(', ')}`);
    console.log(`Usage: node toggle_pause.js [account_id] [pause|resume|status]`);
    process.exit(1);
  }

  if (!actionArg || actionArg === 'status') {
    const paused = await getStatus(validAccount);
    console.log(`\n${validAccount}: ${paused ? '⏸️  PAUSED' : '🟢 ACTIVE (Posting on schedule)'}\n`);
    return;
  }

  if (actionArg === 'pause') {
    await setPause(validAccount, true);
    console.log(`\n✅ ${validAccount} has been PAUSED. Worker will skip this account until resumed.\n`);
  } else if (actionArg === 'resume' || actionArg === 'unpause') {
    await setPause(validAccount, false);
    console.log(`\n✅ ${validAccount} has been RESUMED. Worker will continue scheduled posting.\n`);
  } else {
    console.log(`❌ Unknown action "${actionArg}". Use "pause", "resume", or "status".`);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { getStatus, setPause };
