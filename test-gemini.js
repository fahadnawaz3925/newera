const { GoogleGenerativeAI } = require('@google/generative-ai');

async function run() {
  try {
    const key = process.env.GEMINI_API_KEY;
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=100`;
    const res = await fetch(url);
    const data = await res.json();
    const models = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'));
    console.log("Available Gemini text models:");
    models.forEach(m => console.log(m.name));
  } catch (err) {
    console.error(err);
  }
}
run();
