// Simple sleep util
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get top 25 coins data (reduced for stability)
function getTop100Coins() {
  return [
    { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin', coinmarketcap_id: '1', coinpaprika_id: 'btc-bitcoin' },
    { symbol: 'ETH', name: 'Ethereum', id: 'ethereum', coinmarketcap_id: '1027', coinpaprika_id: 'eth-ethereum' },
    { symbol: 'USDT', name: 'Tether', id: 'tether', coinmarketcap_id: '825', coinpaprika_id: 'usdt-tether' },
    { symbol: 'BNB', name: 'Binance Coin', id: 'binancecoin', coinmarketcap_id: '1839', coinpaprika_id: 'bnb-binance-coin' },
    { symbol: 'SOL', name: 'Solana', id: 'solana', coinmarketcap_id: '5426', coinpaprika_id: 'sol-solana' },
    { symbol: 'USDC', name: 'USD Coin', id: 'usd-coin', coinmarketcap_id: '3408', coinpaprika_id: 'usdc-usd-coin' },
    { symbol: 'XRP', name: 'Ripple', id: 'ripple', coinmarketcap_id: '52', coinpaprika_id: 'xrp-xrp' },
    { symbol: 'DOGE', name: 'Dogecoin', id: 'dogecoin', coinmarketcap_id: '74', coinpaprika_id: 'doge-dogecoin' },
    { symbol: 'ADA', name: 'Cardano', id: 'cardano', coinmarketcap_id: '2010', coinpaprika_id: 'ada-cardano' },
    { symbol: 'TRX', name: 'TRON', id: 'tron', coinmarketcap_id: '1958', coinpaprika_id: 'trx-tron' },
    { symbol: 'AVAX', name: 'Avalanche', id: 'avalanche-2', coinmarketcap_id: '5805', coinpaprika_id: 'avax-avalanche' },
    { symbol: 'SHIB', name: 'Shiba Inu', id: 'shiba-inu', coinmarketcap_id: '5994', coinpaprika_id: 'shib-shiba-inu' },
    { symbol: 'TON', name: 'Toncoin', id: 'the-open-network', coinmarketcap_id: '11419', coinpaprika_id: 'ton-the-open-network' },
    { symbol: 'LINK', name: 'Chainlink', id: 'chainlink', coinmarketcap_id: '1975', coinpaprika_id: 'link-chainlink' },
    { symbol: 'DOT', name: 'Polkadot', id: 'polkadot', coinmarketcap_id: '6636', coinpaprika_id: 'dot-polkadot' },
    { symbol: 'BCH', name: 'Bitcoin Cash', id: 'bitcoin-cash', coinmarketcap_id: '1831', coinpaprika_id: 'bch-bitcoin-cash' },
    { symbol: 'MATIC', name: 'Polygon', id: 'matic-network', coinmarketcap_id: '3890', coinpaprika_id: 'matic-polygon' },
    { symbol: 'DAI', name: 'Dai', id: 'dai', coinmarketcap_id: '4943', coinpaprika_id: 'dai-dai' },
    { symbol: 'LTC', name: 'Litecoin', id: 'litecoin', coinmarketcap_id: '2', coinpaprika_id: 'ltc-litecoin' },
    { symbol: 'UNI', name: 'Uniswap', id: 'uniswap', coinmarketcap_id: '7083', coinpaprika_id: 'uni-uniswap' },
    { symbol: 'ATOM', name: 'Cosmos', id: 'cosmos', coinmarketcap_id: '3794', coinpaprika_id: 'atom-cosmos' },
    { symbol: 'XLM', name: 'Stellar', id: 'stellar', coinmarketcap_id: '512', coinpaprika_id: 'xlm-stellar' },
    { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic', coinmarketcap_id: '1321', coinpaprika_id: 'etc-ethereum-classic' },
    { symbol: 'XMR', name: 'Monero', id: 'monero', coinmarketcap_id: '328', coinpaprika_id: 'xmr-monero' },
    { symbol: 'ALGO', name: 'Algorand', id: 'algorand', coinmarketcap_id: '4030', coinpaprika_id: 'algo-algorand' },
    { symbol: 'FIL', name: 'Filecoin', id: 'filecoin', coinmarketcap_id: '2280', coinpaprika_id: 'fil-filecoin' },
    { symbol: 'ICP', name: 'Internet Computer', id: 'internet-computer', coinmarketcap_id: '8916', coinpaprika_id: 'icp-internet-computer' },
    { symbol: 'VET', name: 'VeChain', id: 'vechain', coinmarketcap_id: '3077', coinpaprika_id: 'vet-vechain' },
    { symbol: 'EOS', name: 'EOS', id: 'eos', coinmarketcap_id: '1765', coinpaprika_id: 'eos-eos' },
    { symbol: 'XTZ', name: 'Tezos', id: 'tezos', coinmarketcap_id: '2011', coinpaprika_id: 'xtz-tezos' },
    { symbol: 'AAVE', name: 'Aave', id: 'aave', coinmarketcap_id: '7278', coinpaprika_id: 'aave-aave' },
    { symbol: 'MKR', name: 'Maker', id: 'maker', coinmarketcap_id: '1518', coinpaprika_id: 'mkr-maker' },
    { symbol: 'GRT', name: 'The Graph', id: 'the-graph', coinmarketcap_id: '6719', coinpaprika_id: 'grt-the-graph' },
    { symbol: 'BSV', name: 'Bitcoin SV', id: 'bitcoin-cash-sv', coinmarketcap_id: '3602', coinpaprika_id: 'bsv-bitcoin-sv' },
    { symbol: 'THETA', name: 'Theta Network', id: 'theta-token', coinmarketcap_id: '2416', coinpaprika_id: 'theta-theta-token' },
    { symbol: 'RUNE', name: 'THORChain', id: 'thorchain', coinmarketcap_id: '4157', coinpaprika_id: 'rune-thorchain' },
    { symbol: 'NEO', name: 'NEO', id: 'neo', coinmarketcap_id: '1376', coinpaprika_id: 'neo-neo' },
    { symbol: 'FTM', name: 'Fantom', id: 'fantom', coinmarketcap_id: '3513', coinpaprika_id: 'ftm-fantom' },
    { symbol: 'KLAY', name: 'Klaytn', id: 'klay-token', coinmarketcap_id: '4256', coinpaprika_id: 'klay-klay-token' },
    { symbol: 'WAVES', name: 'Waves', id: 'waves', coinmarketcap_id: '1274', coinpaprika_id: 'waves-waves' },
    { symbol: 'BAT', name: 'Basic Attention Token', id: 'basic-attention-token', coinmarketcap_id: '1697', coinpaprika_id: 'bat-basic-attention-token' },
    { symbol: 'ZEC', name: 'Zcash', id: 'zcash', coinmarketcap_id: '1437', coinpaprika_id: 'zec-zcash' },
    { symbol: 'DASH', name: 'Dash', id: 'dash', coinmarketcap_id: '131', coinpaprika_id: 'dash-dash' },
    { symbol: 'ENJ', name: 'Enjin Coin', id: 'enjincoin', coinmarketcap_id: '2130', coinpaprika_id: 'enj-enjincoin' }
    // Limited to top 25 coins for stability
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
