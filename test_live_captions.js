require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testLiveModels() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY
  ].filter(Boolean);

  const modelsToTest = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-2.5-flash-lite',
    'gemini-3.7-flash'
  ];

  for (const key of keys) {
    console.log(`\n========================================`);
    console.log(`Testing Key: ${key.substring(0, 15)}...`);
    console.log(`========================================`);

    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of modelsToTest) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const res = await model.generateContent("Write 1 punchy sentence for a shoe shine Instagram reel.");
        const text = res.response.text();
        console.log(`✅ [${modelName}] Success: "${text.trim().replace(/\n/g, ' ')}"`);
      } catch (err) {
        console.log(`❌ [${modelName}] Error: ${err.message.split('\n')[0]}`);
      }
    }
  }
}

testLiveModels();
