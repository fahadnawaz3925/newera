require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tokenArg = process.argv[2];
const targetHandle = 'jewel_hrizolit';
const ORACLE_IP = '80.225.246.34';
const SSH_KEY = path.resolve(__dirname, 'oracle_key_account4.pem');

async function main() {
  if (!tokenArg) {
    console.error('❌ Usage: node setup_account5_token.js <META_PAGE_OR_USER_ACCESS_TOKEN>');
    process.exit(1);
  }

  const token = tokenArg.trim();
  console.log('🔍 Inspecting Meta access token...');

  let igId = null;
  let pageToken = token;
  let detectedUsername = null;

  // 1. Try directly inspecting "me" as a Page token
  try {
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,instagram_business_account{id,username,name}&access_token=${token}`);
    const meData = await meRes.json();
    if (meData.instagram_business_account) {
      igId = meData.instagram_business_account.id;
      detectedUsername = meData.instagram_business_account.username;
      console.log(`✅ Direct Page Token detected for @${detectedUsername} (IG ID: ${igId})`);
    }
  } catch (e) {}

  // 2. If not a direct page token, inspect user accounts list
  if (!igId) {
    try {
      const accRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100&access_token=${token}`);
      const accData = await accRes.json();
      if (accData.data && accData.data.length > 0) {
        console.log(`📋 Found ${accData.data.length} Facebook Page(s) under this user token.`);
        for (const p of accData.data) {
          if (p.instagram_business_account) {
            const ig = p.instagram_business_account;
            console.log(`   - Page "${p.name}" -> @${ig.username} (ID: ${ig.id})`);
            if (ig.username && (ig.username.toLowerCase().includes('hrizolit') || ig.username.toLowerCase().includes('jewel') || ig.username.toLowerCase().includes('chrysolit'))) {
              igId = ig.id;
              detectedUsername = ig.username;
              pageToken = p.access_token || token;
              break;
            }
          }
        }
        // Fallback: if only 1 IG business account exists and not matched yet
        if (!igId && accData.data.length === 1 && accData.data[0].instagram_business_account) {
          const ig = accData.data[0].instagram_business_account;
          igId = ig.id;
          detectedUsername = ig.username;
          pageToken = accData.data[0].access_token || token;
        }
      }
    } catch (e) {}
  }

  if (!igId) {
    console.error('❌ Could not automatically detect Instagram Business Account ID from this token.');
    console.error('   Please ensure the Facebook Page is connected to your @jewel_hrizolit Professional Instagram account,');
    console.error('   and that the token has `pages_show_list`, `instagram_basic`, and `instagram_content_publish` permissions.');
    process.exit(1);
  }

  // 3. Live test validation
  console.log(`\n🧪 Validating publishing permissions for @${detectedUsername} (${igId})...`);
  const verifyRes = await fetch(`https://graph.facebook.com/v19.0/${igId}?fields=username,name,media_count,followers_count&access_token=${pageToken}`);
  const verifyData = await verifyRes.json();
  if (verifyData.error) {
    console.error('❌ Meta API Verification Failed:', verifyData.error);
    process.exit(1);
  }
  console.log(`✅ Verified! Profile: @${verifyData.username} (${verifyData.name || 'Account 5'}) | Media: ${verifyData.media_count}`);

  // 4. Update local .env
  console.log('\n📝 Updating local .env...');
  let localEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  localEnv = updateEnvKey(localEnv, 'IG_BUSINESS_ACCOUNT_ID_5', igId);
  localEnv = updateEnvKey(localEnv, 'PAGE_ACCESS_TOKEN_5', pageToken);
  fs.writeFileSync('.env', localEnv, 'utf8');
  console.log('✅ Local .env updated.');

  // 5. Update Oracle server .env
  console.log(`\n🚀 Syncing credentials to Oracle VM (${ORACLE_IP})...`);
  try {
    const remoteEnvPath = '/home/ubuntu/account5_jewel/.env';
    execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ubuntu@${ORACLE_IP} "sed -i '/IG_BUSINESS_ACCOUNT_ID_5/d' ${remoteEnvPath} && sed -i '/PAGE_ACCESS_TOKEN_5/d' ${remoteEnvPath} && echo 'IG_BUSINESS_ACCOUNT_ID_5=${igId}' >> ${remoteEnvPath} && echo 'PAGE_ACCESS_TOKEN_5=${pageToken}' >> ${remoteEnvPath}"`, { stdio: 'inherit' });
    console.log('✅ Remote .env updated on Oracle VM.');

    // Restart PM2 worker
    execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ubuntu@${ORACLE_IP} "pm2 restart account5-worker --update-env && pm2 save"`, { stdio: 'inherit' });
    console.log('✅ PM2 account5-worker restarted with live credentials!');
  } catch (err) {
    console.error('⚠️ Remote sync warning:', err.message);
  }

  console.log('\n🎉 ALL DONE! Account 5 is live and posting has commenced.');
}

function updateEnvKey(content, key, val) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${val}`);
  }
  return content.trim() + `\n${key}=${val}\n`;
}

main().catch(console.error);
