const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILE = path.join(__dirname, 'youtube_api_credentials.json');

/**
 * Upload a vertical video to YouTube as a Public YouTube Short using official YouTube Data API v3
 * @param {Object} options
 * @param {string} options.videoPath - Absolute path to .mp4 video file
 * @param {string} options.title - Short title (will append #Shorts)
 * @param {string} options.description - Short description & tags
 * @returns {Promise<{success: boolean, videoId?: string, shortUrl?: string, error?: string}>}
 */
async function uploadShortViaYouTubeAPI({ videoPath, title, description }) {
  let credentials = null;

  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    } catch (e) { }
  }

  const clientId = credentials?.client_id || process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = credentials?.client_secret || process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = credentials?.refresh_token || process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing YouTube API credentials. Run generate_youtube_token.js first.`);
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file does not exist at: ${videoPath}`);
  }

  // Format title <= 100 characters with #Shorts
  let cleanTitle = (title || 'Satisfying ASMR Craft #Shorts').trim();
  if (!cleanTitle.toLowerCase().includes('#shorts')) {
    cleanTitle = `${cleanTitle} #Shorts`;
  }
  if (cleanTitle.length > 100) {
    cleanTitle = cleanTitle.substring(0, 92) + ' #Shorts';
  }

  console.log('===============================================================');
  console.log(`🎬 UPLOADING YOUTUBE SHORT VIA OFFICIAL API: "${cleanTitle}"`);
  console.log(`📁 File: ${videoPath}`);
  console.log('===============================================================');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });

  const fileSize = fs.statSync(videoPath).size;
  console.log(`📦 Video File Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: cleanTitle,
        description: (description || '').trim(),
        tags: ['Shorts', 'ASMR', 'ShoeShine', 'Satisfying', 'buffedboujee', 'shoerestoration'],
        categoryId: '26', // Howto & Style
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en'
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: fs.createReadStream(videoPath)
    }
  });

  const videoId = res.data?.id;
  if (!videoId) {
    throw new Error('Upload succeeded but YouTube API did not return a Video ID.');
  }

  const shortUrl = `https://youtube.com/shorts/${videoId}`;
  console.log('\n===============================================================');
  console.log(`🎉 SUCCESS! YouTube Short published live via API: ${shortUrl}`);
  console.log('===============================================================');

  return {
    success: true,
    videoId,
    shortUrl
  };
}

module.exports = { uploadShortViaYouTubeAPI };
