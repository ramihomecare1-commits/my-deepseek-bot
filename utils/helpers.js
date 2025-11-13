// Simple sleep util
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get top 10 coins (reduced to avoid API rate limits)
// Free CoinGecko API: 10-30 requests/minute
// Free CoinPaprika API: 20,000 requests/month (~13 per minute sustained)
function getTop100Coins() {
  return [
    { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin', coinmarketcap_id: '1', coinpaprika_id: 'btc-bitcoin' },
    { symbol: 'ETH', name: 'Ethereum', id: 'ethereum', coinmarketcap_id: '1027', coinpaprika_id: 'eth-ethereum' },
    { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin', coinmarketcap_id: '1839', coinpaprika_id: 'bnb-binance-coin' },
    { symbol: 'SOL', name: 'Solana', id: 'solana', coinmarketcap_id: '5426', coinpaprika_id: 'sol-solana' },
    { symbol: 'XRP', name: 'Ripple', id: 'ripple', coinmarketcap_id: '52', coinpaprika_id: 'xrp-xrp' },
    { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin', coinmarketcap_id: '74', coinpaprika_id: 'doge-dogecoin' },
    { symbol: 'ADA', name: 'Cardano', id: 'cardano', coinmarketcap_id: '2010', coinpaprika_id: 'ada-cardano' },
    { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2', coinmarketcap_id: '5805', coinpaprika_id: 'avax-avalanche' },
    { symbol: 'LINK', name: 'Chainlink', id: 'chainlink', coinmarketcap_id: '1975', coinpaprika_id: 'link-chainlink' },
    { symbol: 'DOT', name: 'Polkadot', id: 'polkadot', coinmarketcap_id: '6636', coinpaprika_id: 'dot-polkadot' }
    // Limited to top 10 to avoid API rate limits (429 errors)
    // Each coin makes ~3-4 API calls (price + historical data)
    // 10 coins = ~40 requests per scan
    // With 3-5 second delays, this stays under free tier limits
  ];
}

// Format currency
function formatCurrency(amount, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(amount);
}

// Format percentage
function formatPercentage(value, decimals = 2) {
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

// Generate random color for charts
function generateColor() {
  const colors = [
    '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', 
    '#eab308', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Deep clone object
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

module.exports = {
  sleep,
  getTop100Coins,
  formatCurrency,
  formatPercentage,
  generateColor,
  isValidEmail,
  deepClone,
  debounce,
  throttle,
  generateId
};
