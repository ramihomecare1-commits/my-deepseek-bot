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
const NEWS_ENABLED = true; // Always enabled - uses free public APIs (CryptoCompare + optional NewsAPI.org)
// Legacy: CRYPTOPANIC_API_KEY is optional and no longer required

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

// Check for separate API keys for each tier
const FREE_TIER_API_KEY = process.env.FREE_TIER_API_KEY || '';
const PREMIUM_TIER_API_KEY = process.env.PREMIUM_TIER_API_KEY || '';

// Legacy support (for backward compatibility)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Debug logging to help troubleshoot
console.log('🔍 API Key Detection:');
console.log(`   FREE_TIER_API_KEY: ${FREE_TIER_API_KEY ? '✅ Found (' + FREE_TIER_API_KEY.substring(0, 15) + '...)' : '❌ Not set'}`);
console.log(`   PREMIUM_TIER_API_KEY: ${PREMIUM_TIER_API_KEY ? '✅ Found (' + PREMIUM_TIER_API_KEY.substring(0, 15) + '...)' : '❌ Not set'}`);
console.log(`   GEMINI_API_KEY: ${GEMINI_API_KEY ? '✅ Found (' + GEMINI_API_KEY.substring(0, 10) + '...)' : '❌ Not set (legacy)'}`);
console.log(`   OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? '✅ Found (' + OPENROUTER_API_KEY.substring(0, 15) + '...)' : '❌ Not set (legacy)'}`);

// Fallback to generic AI_API_KEY if specific ones not set
const AI_API_KEY = process.env.API_KEY || process.env.AI_API_KEY || FREE_TIER_API_KEY || PREMIUM_TIER_API_KEY || OPENROUTER_API_KEY || GEMINI_API_KEY || '';

// Detect API type for backward compatibility
const API_TYPE = AI_API_KEY.startsWith('AIza') ? 'gemini' : 'openrouter';

// HYBRID MODE: Use Gemini for free monitoring, DeepSeek R1 for premium confirmations
const USE_HYBRID_MODE = Boolean(GEMINI_API_KEY && OPENROUTER_API_KEY);

console.log(`   Hybrid Mode: ${USE_HYBRID_MODE ? '✅ ENABLED' : '❌ DISABLED (need both keys)'}`);

// Free monitoring model (Tier 1)
// Default: DeepSeek Chat (FREE via OpenRouter)
const MONITORING_MODEL = process.env.MONITORING_MODEL || 'deepseek/deepseek-chat';
// Use FREE_TIER_API_KEY first, fallback to legacy OPENROUTER_API_KEY or AI_API_KEY
const MONITORING_API_KEY = FREE_TIER_API_KEY || OPENROUTER_API_KEY || AI_API_KEY;
const MONITORING_API_TYPE = 'openrouter';

console.log(`   Free Tier will use: ${MONITORING_API_TYPE.toUpperCase()} (${MONITORING_MODEL})`);

// Premium confirmation model (Tier 2)
// Default: DeepSeek R1 (best reasoning via OpenRouter)
// Note: R1 is slower but more accurate. Use 'deepseek/deepseek-chat' for faster responses.
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-r1';
// Use PREMIUM_TIER_API_KEY first, fallback to FREE_TIER_API_KEY (same OpenRouter key), then legacy keys
const PREMIUM_API_KEY = PREMIUM_TIER_API_KEY || FREE_TIER_API_KEY || OPENROUTER_API_KEY || AI_API_KEY;
const PREMIUM_API_TYPE = 'openrouter';

console.log(`   Premium Tier will use: ${PREMIUM_API_TYPE.toUpperCase()} (${AI_MODEL})`);
if (AI_MODEL.includes('r1')) {
  console.log(`   ⚠️ Note: R1 is slow (30-60s per request) but more accurate`);
  console.log(`   💡 Tip: Set AI_MODEL=deepseek/deepseek-chat for faster responses`);
}
console.log('');

// Two-Tier Monitoring Configuration
const MONITORING_ENABLED = (process.env.MONITORING_ENABLED || 'true').toLowerCase() === 'true';
const MONITORING_INTERVAL = Number(process.env.MONITORING_INTERVAL || 120000); // 2 minutes
const MONITORING_MODE = (process.env.MONITORING_MODE || 'ai').toLowerCase(); // 'ai' or 'algorithmic'
const ESCALATION_THRESHOLD = Number(process.env.ESCALATION_THRESHOLD || 0.85); // 85% confidence
const VOLATILITY_THRESHOLD = Number(process.env.VOLATILITY_THRESHOLD || 3.0); // 3% price change
const VOLUME_SPIKE_THRESHOLD = Number(process.env.VOLUME_SPIKE_THRESHOLD || 2.0); // 2x volume

// Trade Management Configuration
const TRADE_PROXIMITY_THRESHOLD = Number(process.env.TRADE_PROXIMITY_THRESHOLD || 1.0); // 1% proximity to trigger AI evaluation
const TRADE_CHECK_INTERVAL = Number(process.env.TRADE_CHECK_INTERVAL || 30000); // 30 seconds - check open trades
const AI_EVALUATION_COOLDOWN = Number(process.env.AI_EVALUATION_COOLDOWN || 300000); // 5 minutes - min time between AI evaluations for same trade
const AUTO_EXECUTE_AI_RECOMMENDATIONS = (process.env.AUTO_EXECUTE_AI_RECOMMENDATIONS || 'true').toLowerCase() === 'true'; // Auto-execute AI recommendations for Bybit demo trading

// OKX Demo Trading Configuration (Primary)
const OKX_API_KEY = process.env.OKX_API_KEY || '';
const OKX_API_SECRET = process.env.OKX_API_SECRET || '';
const OKX_PASSPHRASE = process.env.OKX_PASSPHRASE || '';
const OKX_ENABLED = Boolean(OKX_API_KEY && OKX_API_SECRET && OKX_PASSPHRASE);

// Bybit Demo Trading Configuration (Legacy - kept for backward compatibility, not used)
const BYBIT_API_KEY = process.env.BYBIT_API_KEY || '';
const BYBIT_API_SECRET = process.env.BYBIT_API_SECRET || '';
const BYBIT_TESTNET = (process.env.BYBIT_TESTNET || 'true').toLowerCase() === 'true';
const BYBIT_ENABLED = Boolean(BYBIT_API_KEY && BYBIT_API_SECRET);

// Risk Management Configuration
const MAX_RISK_PER_TRADE = Number(process.env.MAX_RISK_PER_TRADE || 2.0); // 2% max risk per trade
const DEFAULT_RISK_PER_TRADE = Number(process.env.DEFAULT_RISK_PER_TRADE || 1.0); // 1% default risk
const MAX_TOTAL_EXPOSURE = Number(process.env.MAX_TOTAL_EXPOSURE || 10.0); // 10% max total exposure
const MIN_RISK_REWARD = Number(process.env.MIN_RISK_REWARD || 1.5); // Minimum 1.5:1 R:R
const MAX_CONCURRENT_TRADES = Number(process.env.MAX_CONCURRENT_TRADES || 5); // Max 5 open trades

// Strategy Configuration
const ACTIVE_STRATEGY = process.env.ACTIVE_STRATEGY || 'ai_hybrid'; // 'rsi_bollinger' or 'ai_hybrid'
const USE_SENTIMENT_ANALYSIS = (process.env.USE_SENTIMENT_ANALYSIS || 'true').toLowerCase() === 'true';
const USE_MARKET_REGIME_DETECTION = (process.env.USE_MARKET_REGIME_DETECTION || 'true').toLowerCase() === 'true';

// Performance Analytics Configuration
const ENABLE_PERFORMANCE_TRACKING = (process.env.ENABLE_PERFORMANCE_TRACKING || 'true').toLowerCase() === 'true';
const PERFORMANCE_REPORT_INTERVAL = Number(process.env.PERFORMANCE_REPORT_INTERVAL || 86400000); // 24 hours

// Evaluation / News Deduplication Configuration
const ENABLE_EVALUATION_DEDUPLICATION = (process.env.ENABLE_EVALUATION_DEDUPLICATION || 'true').toLowerCase() === 'true';
const ENABLE_NEWS_DEDUPLICATION = (process.env.ENABLE_NEWS_DEDUPLICATION || 'true').toLowerCase() === 'true';
const EVALUATION_DEDUPLICATION_THRESHOLD = Number(process.env.EVALUATION_DEDUPLICATION_THRESHOLD || 50); // % duplicate to skip
const NEWS_DEDUPLICATION_THRESHOLD = Number(process.env.NEWS_DEDUPLICATION_THRESHOLD || 70); // % similarity to skip

// Rejection Notifications Configuration
const ENABLE_REJECTION_NOTIFICATIONS = (process.env.ENABLE_REJECTION_NOTIFICATIONS || 'true').toLowerCase() === 'true'; // Notify on Telegram when AI opportunities are rejected

// Notifications behavior
const ALLOW_MOCK_NOTIFICATIONS = (process.env.ALLOW_MOCK_NOTIFICATIONS || 'false').toLowerCase() === 'true';

// Proxy configuration for bypassing geo-restrictions
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const SCRAPER_API_ENABLED = SCRAPER_API_KEY.length > 0;
const SCRAPEOPS_API_KEY = process.env.SCRAPEOPS_API_KEY || '';
const SCRAPEOPS_ENABLED = SCRAPEOPS_API_KEY.length > 0;
const PROXY_PRIORITY = process.env.PROXY_PRIORITY || 'scrapeops'; // 'scrapeops', 'scraperapi', 'none'

// TAAPI.IO Configuration for bulk technical indicators
const TAAPI_API_KEY = process.env.TAAPI_API_KEY || '';
const TAAPI_ENABLED = Boolean(TAAPI_API_KEY);

// CoinGecko API Key (optional - for higher rate limits)
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';

// Log configuration status
console.log('🔧 Configuration Status:');
console.log(`   Telegram: ${TELEGRAM_ENABLED ? 'ENABLED' : 'DISABLED'}`);
console.log(`   CoinMarketCap: ${COINMARKETCAP_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌ (Set COINMARKETCAP_API_KEY)'}`);
console.log(`   CryptoCompare: ${process.env.CRYPTOCOMPARE_API_KEY ? 'ENABLED ✅' : 'DISABLED ❌'}`);
console.log(`   Proxy Services:`);
console.log(`   - ScrapeOps: ${SCRAPEOPS_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌'} (Priority: ${PROXY_PRIORITY === 'scrapeops' ? 'Primary' : 'Fallback'})`);
console.log(`   - ScraperAPI: ${SCRAPER_API_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌'} (Priority: ${PROXY_PRIORITY === 'scraperapi' ? 'Primary' : 'Fallback'})`);
if (!SCRAPEOPS_ENABLED && !SCRAPER_API_ENABLED) {
  console.log(`   💡 To enable proxy: Set SCRAPEOPS_API_KEY or SCRAPER_API_KEY environment variable`);
  console.log(`   💡 ScrapeOps: https://scrapeops.io/ (1,000 free credits)`);
  console.log(`   💡 ScraperAPI: https://www.scraperapi.com/ (1,000 requests/month free)`);
}
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
console.log(`      Mode: ${MONITORING_MODE.toUpperCase()} ${MONITORING_MODE === 'algorithmic' ? '(No AI cost! 🎉)' : '(AI-powered)'}`);
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
  MONITORING_MODE,
  ESCALATION_THRESHOLD,
  VOLATILITY_THRESHOLD,
  VOLUME_SPIKE_THRESHOLD,
  // Trade Management Configuration
  TRADE_PROXIMITY_THRESHOLD,
  TRADE_CHECK_INTERVAL,
  AI_EVALUATION_COOLDOWN,
  AUTO_EXECUTE_AI_RECOMMENDATIONS,
  // Risk Management Configuration
  MAX_RISK_PER_TRADE,
  DEFAULT_RISK_PER_TRADE,
  MAX_TOTAL_EXPOSURE,
  MIN_RISK_REWARD,
  MAX_CONCURRENT_TRADES,
  // Strategy Configuration
  ACTIVE_STRATEGY,
  USE_SENTIMENT_ANALYSIS,
  USE_MARKET_REGIME_DETECTION,
  // Performance Analytics Configuration
  ENABLE_PERFORMANCE_TRACKING,
  PERFORMANCE_REPORT_INTERVAL,
  // Deduplication Configuration
  ENABLE_EVALUATION_DEDUPLICATION,
  ENABLE_NEWS_DEDUPLICATION,
  EVALUATION_DEDUPLICATION_THRESHOLD,
  NEWS_DEDUPLICATION_THRESHOLD,
  // Rejection Notifications
  ENABLE_REJECTION_NOTIFICATIONS,
  // TAAPI.IO Configuration
  TAAPI_API_KEY,
  TAAPI_ENABLED,
  COINGECKO_API_KEY,
  // OKX Demo Trading Configuration
  OKX_API_KEY,
  OKX_API_SECRET,
  OKX_PASSPHRASE,
  OKX_ENABLED,
  // Bybit Demo Trading Configuration (Legacy)
  BYBIT_API_KEY,
  BYBIT_API_SECRET,
  BYBIT_TESTNET,
  BYBIT_ENABLED,
  // Proxy Configuration
  SCRAPER_API_KEY,
  SCRAPER_API_ENABLED,
  SCRAPEOPS_API_KEY,
  SCRAPEOPS_ENABLED,
  PROXY_PRIORITY
};
