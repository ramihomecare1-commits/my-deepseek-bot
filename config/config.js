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
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || ''; // Optional: NewsAPI.org key for additional news sources
const NEWS_ENABLED = Boolean(CRYPTOPANIC_API_KEY); // Legacy: CryptoPanic (optional)
// Note: News is now fetched from free public APIs (CryptoCompare + optional NewsAPI.org)

// Rate limiting
// Increased to 3000ms (3 seconds) to avoid 429 rate limit errors
// Free CoinGecko: 10-30 requests/minute = need 2-6 second delays
// Free CoinPaprika: ~13 requests/minute sustained
const API_DELAY = Number(process.env.API_DELAY_MS || 3000);
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

// Scan intervals
const SCAN_INTERVAL_OPTIONS = {
  '10m': 10 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

// AI Configuration - Support for HYBRID setup (Gemini FREE + DeepSeek R1 PREMIUM)
// You can use different APIs for monitoring (free) and confirmation (premium)

// Check for separate API keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Debug logging to help troubleshoot
console.log('🔍 API Key Detection:');
console.log(`   GEMINI_API_KEY: ${GEMINI_API_KEY ? '✅ Found (' + GEMINI_API_KEY.substring(0, 10) + '...)' : '❌ Not set'}`);
console.log(`   OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? '✅ Found (' + OPENROUTER_API_KEY.substring(0, 15) + '...)' : '❌ Not set'}`);

// Fallback to generic AI_API_KEY if specific ones not set
const AI_API_KEY = process.env.API_KEY || process.env.AI_API_KEY || OPENROUTER_API_KEY || GEMINI_API_KEY || '';

// Detect API type for backward compatibility
const API_TYPE = AI_API_KEY.startsWith('AIza') ? 'gemini' : 'openrouter';

// HYBRID MODE: Use Gemini for free monitoring, DeepSeek R1 for premium confirmations
const USE_HYBRID_MODE = Boolean(GEMINI_API_KEY && OPENROUTER_API_KEY);

console.log(`   Hybrid Mode: ${USE_HYBRID_MODE ? '✅ ENABLED' : '❌ DISABLED (need both keys)'}`);

// Free monitoring model (Tier 1)
// Default: DeepSeek Chat (FREE via OpenRouter)
const MONITORING_MODEL = process.env.MONITORING_MODEL || 'deepseek/deepseek-chat';
const MONITORING_API_KEY = OPENROUTER_API_KEY || AI_API_KEY;
const MONITORING_API_TYPE = 'openrouter';

console.log(`   Free Tier will use: ${MONITORING_API_TYPE.toUpperCase()} (${MONITORING_MODEL})`);

// Premium confirmation model (Tier 2)
// Default: DeepSeek R1 (best reasoning via OpenRouter)
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-r1';
const PREMIUM_API_KEY = OPENROUTER_API_KEY || AI_API_KEY;
const PREMIUM_API_TYPE = 'openrouter';

console.log(`   Premium Tier will use: ${PREMIUM_API_TYPE.toUpperCase()} (${AI_MODEL})`);
console.log('');

// Two-Tier Monitoring Configuration
const MONITORING_ENABLED = (process.env.MONITORING_ENABLED || 'true').toLowerCase() === 'true';
const MONITORING_INTERVAL = Number(process.env.MONITORING_INTERVAL || 60000); // 1 minute
const ESCALATION_THRESHOLD = Number(process.env.ESCALATION_THRESHOLD || 0.70); // 70% confidence
const VOLATILITY_THRESHOLD = Number(process.env.VOLATILITY_THRESHOLD || 3.0); // 3% price change
const VOLUME_SPIKE_THRESHOLD = Number(process.env.VOLUME_SPIKE_THRESHOLD || 2.0); // 2x volume

// Notifications behavior
const ALLOW_MOCK_NOTIFICATIONS = (process.env.ALLOW_MOCK_NOTIFICATIONS || 'false').toLowerCase() === 'true';

// Proxy configuration for bypassing geo-restrictions
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const SCRAPER_API_ENABLED = SCRAPER_API_KEY.length > 0;

// Log configuration status
console.log('🔧 Configuration Status:');
console.log(`   Telegram: ${TELEGRAM_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log(`   CoinMarketCap: ${COINMARKETCAP_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌ (Set COINMARKETCAP_API_KEY)'}`);
console.log(`   CryptoCompare: ${process.env.CRYPTOCOMPARE_API_KEY ? 'ENABLED ✅' : 'DISABLED ❌'}`);
console.log(`   ScraperAPI Proxy: ${SCRAPER_API_ENABLED ? 'ENABLED ✅ (Bypasses geo-blocks)' : 'DISABLED ❌'}`);
console.log(`   News: ENABLED ✅ (Free public APIs: CryptoCompare${NEWSAPI_KEY ? ' + NewsAPI.org' : ''})`);
console.log(`   Mock Notifications: ${ALLOW_MOCK_NOTIFICATIONS ? 'ALLOWED' : 'BLOCKED'}`);
console.log(`   API Delay: ${API_DELAY}ms between requests`);
console.log('');
console.log('🤖 Two-Tier AI Monitoring:');
console.log(`   Monitoring: ${MONITORING_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌'}`);
console.log(`   Mode: ${USE_HYBRID_MODE ? 'HYBRID (Gemini + DeepSeek) 🔥' : (MONITORING_API_TYPE === 'gemini' ? 'Gemini Only' : 'OpenRouter Only')}`);
console.log('');
console.log('   📊 FREE TIER (Monitoring every minute):');
console.log(`      Model: ${MONITORING_MODEL}`);
console.log(`      API: ${MONITORING_API_TYPE.toUpperCase()} ${MONITORING_API_TYPE === 'gemini' ? '(Google)' : '(OpenRouter)'}`);
console.log(`      Key: ${MONITORING_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`      Cost: ${MONITORING_API_TYPE === 'gemini' ? 'FREE! 🎉' : '~$0.001/hour'}`);
console.log('');
console.log('   💎 PREMIUM TIER (Confirmations only):');
console.log(`      Model: ${AI_MODEL}`);
console.log(`      API: ${PREMIUM_API_TYPE.toUpperCase()} ${PREMIUM_API_TYPE === 'gemini' ? '(Google)' : '(OpenRouter)'}`);
console.log(`      Key: ${PREMIUM_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`      Cost: ${PREMIUM_API_TYPE === 'gemini' ? 'FREE! 🎉' : '~$0.02-0.05 per call'}`);
console.log('');
console.log(`   ⚙️  Settings:`);
console.log(`      Interval: ${MONITORING_INTERVAL / 1000}s`);
console.log(`      Escalation: ${(ESCALATION_THRESHOLD * 100).toFixed(0)}% confidence`);
console.log(`      Volatility: ${VOLATILITY_THRESHOLD}% trigger`);

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
  API_TYPE,
  ALLOW_MOCK_NOTIFICATIONS,
  // Hybrid API Support
  USE_HYBRID_MODE,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  // Two-Tier Monitoring with separate APIs
  MONITORING_ENABLED,
  MONITORING_MODEL,
  MONITORING_API_KEY,
  MONITORING_API_TYPE,
  PREMIUM_API_KEY,
  PREMIUM_API_TYPE,
  MONITORING_INTERVAL,
  ESCALATION_THRESHOLD,
  VOLATILITY_THRESHOLD,
  VOLUME_SPIKE_THRESHOLD
};
