// API Configuration
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || '';
const COINMARKETCAP_ENABLED = Boolean(COINMARKETCAP_API_KEY);
const COINPAPRIKA_ENABLED = true;

// Telegram configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

// News configuration
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const NEWS_ENABLED = Boolean(CRYPTOPANIC_API_KEY);

// Rate limiting
const API_DELAY = Number(process.env.API_DELAY_MS || 1000);
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

// Scan intervals
const SCAN_INTERVAL_OPTIONS = {
  '10m': 10 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

// AI Configuration - check multiple possible env var names
const AI_API_KEY = process.env.API_KEY || process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || '';
// Use environment variable for model, or default to a reliable paid model
// Free models have very strict rate limits (429 errors)
// Recommended: 'deepseek/deepseek-chat' (very cheap, ~$0.14 per million tokens)
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-chat';

// Notifications behavior
const ALLOW_MOCK_NOTIFICATIONS = (process.env.ALLOW_MOCK_NOTIFICATIONS || 'false').toLowerCase() === 'true';

// Log configuration status
console.log('🔧 Configuration Status:');
console.log(`   Telegram: ${TELEGRAM_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log(`   CoinMarketCap: ${COINMARKETCAP_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log(`   News: ${NEWS_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log(`   AI: ${AI_API_KEY ? 'ENABLED' : 'DISABLED'}`);
console.log(`   Mock Notifications: ${ALLOW_MOCK_NOTIFICATIONS ? 'ALLOWED' : 'BLOCKED'}`);

module.exports = {
  COINMARKETCAP_API_KEY,
  COINMARKETCAP_ENABLED,
  COINPAPRIKA_ENABLED,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED,
  CRYPTOPANIC_API_KEY,
  NEWS_ENABLED,
  API_DELAY,
  NOTIFICATION_COOLDOWN_MS,
  SCAN_INTERVAL_OPTIONS,
  AI_API_KEY,
  AI_MODEL,
  ALLOW_MOCK_NOTIFICATIONS
};
