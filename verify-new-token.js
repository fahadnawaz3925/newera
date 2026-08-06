/**
 * HOW TO REGENERATE ACCOUNT 1 TOKEN WITH DELETION PERMISSIONS
 * 
 * Account 1's current token is MISSING: instagram_manage_contents
 * Account 2's token HAS: instagram_manage_contents (which allows deletion)
 * 
 * Steps to fix:
 * 1. Go to https://developers.facebook.com/tools/explorer/
 * 2. Select App ID: 2151523492432477 (Account 1's App)
 * 3. Click "Generate Access Token"
 * 4. In permissions, make sure these are ALL checked:
 *    - pages_show_list
 *    - instagram_basic
 *    - instagram_manage_comments
 *    - instagram_content_publish
 *    - instagram_manage_contents   <-- THIS IS THE MISSING ONE
 *    - instagram_manage_insights
 *    - pages_read_engagement
 *    - public_profile
 * 5. Click "Generate Token" and copy it
 * 6. Then run this script with the new token to verify it can delete:
 * 
 *    node scratch/test-new-token.js YOUR_NEW_TOKEN_HERE
 */

const newToken = process.argv[2];
if (!newToken) {
  console.log('Usage: node this-file.js YOUR_NEW_TOKEN');
  process.exit(1);
}

async function verifyToken(token) {
  console.log('Checking new token permissions...');
  const res = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`);
  const data = await res.json();
  console.log('Scopes:', data.data?.scopes?.join(', '));
  const hasDeletePerm = data.data?.scopes?.includes('instagram_manage_contents');
  if (hasDeletePerm) {
    console.log('\n✅ Token has instagram_manage_contents - deletion will work!');
    console.log('\nPaste this as your new PAGE_ACCESS_TOKEN_1 in .env and Vercel env vars:');
    console.log(token);
  } else {
    console.log('\n❌ Token still missing instagram_manage_contents. Please regenerate again with that permission.');
  }
}

verifyToken(newToken);
