const { schedule } = require('@netlify/functions');

const handler = async function(event, context) {
  // Get the URL of the current site, hardcoded to ensure cron works on Netlify
  const siteUrl = process.env.URL || 'https://abc3838.netlify.app';
  const workerUrl = `${siteUrl}/.netlify/functions/process-worker-background`;

  console.log(`Cron triggered! Invoking background worker at ${workerUrl}`);

  try {
    // We send a POST request to kick off the background function.
    // We don't wait for it to finish (because it's a background function, it returns 202 immediately).
    await fetch(workerUrl, { method: 'POST' });
    return { statusCode: 200 };
  } catch (err) {
    console.error('Error invoking background worker:', err);
    return { statusCode: 500 };
  }
};

exports.handler = schedule("*/5 * * * *", handler);
