const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const SOURCE_DIR = 'D:\\1.ISLAMIC REELS PROJECT\\the house of cobbler\\House of cobbler (processed )';
const SSH_KEY = 'oracle_key_new_2.pem';
const REMOTE_HOST = 'ubuntu@80.225.198.44';
const REMOTE_DEST = '/home/ubuntu/the_house_of_cobbler';
const PUBLIC_DIR_NAME = 'The House of cobblers';
const BASE_URL = 'http://80.225.198.44:3000';
const CONCURRENCY = 3;

function getRemoteFileStats() {
  console.log('🔍 Checking existing files and sizes on remote server...');
  try {
    const cmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${REMOTE_HOST} "ls -l --time-style=+%s '${REMOTE_DEST}'"`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const fileStats = new Map();
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 7) {
        const size = parseInt(parts[4], 10);
        const name = parts.slice(6).join(' ');
        if (name && !isNaN(size)) {
          fileStats.set(name, size);
        }
      }
    }
    console.log(`Found ${fileStats.size} files already on server.`);
    return fileStats;
  } catch (err) {
    console.error('Error listing remote files:', err.message);
    return new Map();
  }
}

function uploadSingleFile(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', SSH_KEY,
      '-o', 'StrictHostKeyChecking=no',
      filePath,
      `${REMOTE_HOST}:${REMOTE_DEST}/`
    ];

    const proc = spawn('scp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`SCP error (code ${code}): ${stderr.trim()}`));
    });
    proc.on('error', reject);
  });
}

async function runUpload() {
  const localFiles = fs.readdirSync(SOURCE_DIR)
    .filter(f => f.endsWith('.mp4'))
    .sort();

  console.log(`📂 Total local video files: ${localFiles.length}`);
  const remoteFileStats = getRemoteFileStats();

  const toUpload = localFiles.filter(f => {
    const localSize = fs.statSync(path.join(SOURCE_DIR, f)).size;
    const remoteSize = remoteFileStats.get(f);
    return remoteSize === undefined || remoteSize !== localSize;
  });

  console.log(`⏳ Files remaining to upload: ${toUpload.length}`);

  let uploadedBytes = 0;
  const startTime = Date.now();
  let activeIndex = 0;
  let completedCount = localFiles.length - toUpload.length;

  async function worker(workerId) {
    while (activeIndex < toUpload.length) {
      const idx = activeIndex++;
      const file = toUpload[idx];
      const filePath = path.join(SOURCE_DIR, file);
      const fileSize = fs.statSync(filePath).size;
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(1);

      try {
        await uploadSingleFile(filePath);
        completedCount++;
        uploadedBytes += fileSize;

        const elapsedSec = (Date.now() - startTime) / 1000;
        const speedMBs = elapsedSec > 0 ? (uploadedBytes / (1024 * 1024) / elapsedSec).toFixed(1) : '0.0';
        const progressPct = ((completedCount / localFiles.length) * 100).toFixed(1);

        console.log(`[${completedCount}/${localFiles.length}] (${progressPct}%) Uploaded ${file} (${sizeMB} MB) | Avg: ${speedMBs} MB/s [W${workerId}]`);
      } catch (err) {
        console.error(`❌ [W${workerId}] Failed to upload ${file}:`, err.message);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);
  console.log('\n🎉 All uploads finished!');

  // Verify final count on server
  console.log('\n🔍 Verifying server file count...');
  try {
    const checkCmd = `ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${REMOTE_HOST} "ls -1 '${REMOTE_DEST}' | wc -l"`;
    const finalCount = execSync(checkCmd, { encoding: 'utf8' }).trim();
    console.log(`Total files on server: ${finalCount} / ${localFiles.length}`);
  } catch (e) {
    console.error('Count verification error:', e.message);
  }

  // Generate links file
  console.log('\n🔗 Generating URLs for all 300 videos...');
  const links = localFiles.map(f => `${BASE_URL}/${encodeURIComponent(f)}`);
  const linksFilePath = path.join(__dirname, 'account3_thehouseofcobbler_links.txt');
  fs.writeFileSync(linksFilePath, links.join('\n'), 'utf8');
  console.log(`✅ Saved ${links.length} video links to ${linksFilePath}`);

  console.log('\n🚀 Upload and link generation complete!');
}

runUpload().catch(console.error);
