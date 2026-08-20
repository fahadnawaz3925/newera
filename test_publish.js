require('dotenv').config();


async function testPublish() {
  const IG_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID_1;
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN_1;
  
  console.log(`Testing image publish for account ${IG_ACCOUNT_ID}...`);
  
  try {
    // Step 1: Create media container (Image)
    const createUrl = `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`;
    console.log('Creating container...');
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
        caption: 'Test post from API',
        access_token: PAGE_ACCESS_TOKEN
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(JSON.stringify(createData));
    const containerId = createData.id;
    console.log(`✅ Container created: ${containerId}`);
    
    // Wait a few seconds for Meta to process the image
    console.log('Waiting 10 seconds for Meta to process the image...');
    await new Promise(r => setTimeout(r, 10000));
    
    // Step 2: Publish
    const publishUrl = `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`;
    console.log('Publishing...');
    const publishRes = await fetch(publishUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: PAGE_ACCESS_TOKEN
      })
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) throw new Error(JSON.stringify(publishData));
    console.log(`🎉 SUCCESS! Post ID: ${publishData.id}`);
    
  } catch (err) {
    console.error('❌ API Error:');
    console.error(err.message);
  }
}

testPublish();
