// Simple sleep util
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get top 10 coins (excluding stablecoins and wrapped tokens)
// Matches the bulk scan monitoring (10 coins)
// Free CoinGecko API: 10-30 requests/minute
// Free CoinPaprika API: 20,000 requests/month (~13 per minute sustained)
function getTop100Coins() {
  const allCoins = [
    { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin', coinmarketcap_id: '1', coinpaprika_id: 'btc-bitcoin' },
    { symbol: 'ETH', name: 'Ethereum', id: 'ethereum', coinmarketcap_id: '1027', coinpaprika_id: 'eth-ethereum' },
    { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin', coinmarketcap_id: '1839', coinpaprika_id: 'bnb-binance-coin' },
    { symbol: 'SOL', name: 'Solana', id: 'solana', coinmarketcap_id: '5426', coinpaprika_id: 'sol-solana' },
    { symbol: 'XRP', name: 'Ripple', id: 'ripple', coinmarketcap_id: '52', coinpaprika_id: 'xrp-xrp' },
    { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin', coinmarketcap_id: '74', coinpaprika_id: 'doge-dogecoin' },
    { symbol: 'ADA', name: 'Cardano', id: 'cardano', coinmarketcap_id: '2010', coinpaprika_id: 'ada-cardano' },
    { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2', coinmarketcap_id: '5805', coinpaprika_id: 'avax-avalanche' },
    { symbol: 'LINK', name: 'Chainlink', id: 'chainlink', coinmarketcap_id: '1975', coinpaprika_id: 'link-chainlink' },
    { symbol: 'DOT', name: 'Polkadot', id: 'polkadot', coinmarketcap_id: '6636', coinpaprika_id: 'dot-polkadot' },
    { symbol: 'TRX', name: 'TRON', id: 'tron', coinmarketcap_id: '1958', coinpaprika_id: 'trx-tron' },
    { symbol: 'MATIC', name: 'Polygon', id: 'matic-network', coinmarketcap_id: '3890', coinpaprika_id: 'matic-polygon' },
    { symbol: 'LTC', name: 'Litecoin', id: 'litecoin', coinmarketcap_id: '2', coinpaprika_id: 'ltc-litecoin' },
    { symbol: 'UNI', name: 'Uniswap', id: 'uniswap', coinmarketcap_id: '7083', coinpaprika_id: 'uni-uniswap' },
    { symbol: 'ATOM', name: 'Cosmos', id: 'cosmos', coinmarketcap_id: '3794', coinpaprika_id: 'atom-cosmos' },
    { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic', coinmarketcap_id: '1321', coinpaprika_id: 'etc-ethereum-classic' },
    { symbol: 'XLM', name: 'Stellar', id: 'stellar', coinmarketcap_id: '512', coinpaprika_id: 'xlm-stellar' },
    { symbol: 'FIL', name: 'Filecoin', id: 'filecoin', coinmarketcap_id: '2280', coinpaprika_id: 'fil-filecoin' },
    { symbol: 'HBAR', name: 'Hedera', id: 'hedera-hashgraph', coinmarketcap_id: '4642', coinpaprika_id: 'hbar-hedera' },
    { symbol: 'APT', name: 'Aptos', id: 'aptos', coinmarketcap_id: '21794', coinpaprika_id: 'apt-aptos' },
    { symbol: 'ARB', name: 'Arbitrum', id: 'arbitrum', coinmarketcap_id: '11841', coinpaprika_id: 'arb-arbitrum' },
    { symbol: 'OP', name: 'Optimism', id: 'optimism', coinmarketcap_id: '11840', coinpaprika_id: 'op-optimism' },
    { symbol: 'SUI', name: 'Sui', id: 'sui', coinmarketcap_id: '20947', coinpaprika_id: 'sui-sui' },
    { symbol: 'TON', name: 'Toncoin', id: 'the-open-network', coinmarketcap_id: '11419', coinpaprika_id: 'ton-toncoin' },
    { symbol: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu', coinmarketcap_id: '11974', coinpaprika_id: 'shib-shiba-inu' }
  ];
  
  // Return only first 10 coins to save API calls
  return allCoins.slice(0, 10);
  
  // Note: Excludes: USDT, USDC, BUSD, DAI, TUSD (stablecoins)
  // Excludes: WETH, WBTC, WBNB (wrapped tokens)
  // Each coin makes ~3-4 API calls (price + historical data)
  // 10 coins = ~40 requests per scan
  // With 3-5 second delays, this stays under free tier limits
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
