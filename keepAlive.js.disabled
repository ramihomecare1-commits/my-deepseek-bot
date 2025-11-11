const https = require('https');

function pingBot() {
  const url = 'https://my-deepseek-bot-1.onrender.com/bot-status';
  
  https.get(url, (res) => {
    console.log(`✅ Pinged bot - Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log('❌ Ping failed:', err.message);
  });
}

// Ping every 10 minutes to keep awake
setInterval(pingBot, 10 * 60 * 1000);

// Ping immediately on start
pingBot();

console.log('🔄 Keep-alive service started');
