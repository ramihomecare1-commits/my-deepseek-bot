// Simple sleep util
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Get top 100 coins data
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
    // Add remaining coins from original list...
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
    { symbol: 'ENJ', name: 'Enjin Coin', id: 'enjincoin', coinmarketcap_id: '2130', coinpaprika_id: 'enj-enjincoin' },
    { symbol: 'COMP', name: 'Compound', id: 'compound-governance-token', coinmarketcap_id: '5692', coinpaprika_id: 'comp-compound' },
    { symbol: 'YFI', name: 'yearn.finance', id: 'yearn-finance', coinmarketcap_id: '5864', coinpaprika_id: 'yfi-yearn-finance' },
    { symbol: 'SNX', name: 'Synthetix', id: 'havven', coinmarketcap_id: '2586', coinpaprika_id: 'snx-synthetix-network-token' },
    { symbol: 'SUSHI', name: 'SushiSwap', id: 'sushi', coinmarketcap_id: '6758', coinpaprika_id: 'sushi-sushiswap' },
    { symbol: 'CRV', name: 'Curve DAO Token', id: 'curve-dao-token', coinmarketcap_id: '6538', coinpaprika_id: 'crv-curve-dao-token' },
    { symbol: 'KSM', name: 'Kusama', id: 'kusama', coinmarketcap_id: '5034', coinpaprika_id: 'ksm-kusama' },
    { symbol: 'ZIL', name: 'Zilliqa', id: 'zilliqa', coinmarketcap_id: '2469', coinpaprika_id: 'zil-zilliqa' },
    { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near', coinmarketcap_id: '6535', coinpaprika_id: 'near-near-protocol' },
    { symbol: 'CELO', name: 'Celo', id: 'celo', coinmarketcap_id: '5567', coinpaprika_id: 'celo-celo' },
    { symbol: 'CHZ', name: 'Chiliz', id: 'chiliz', coinmarketcap_id: '4066', coinpaprika_id: 'chz-chiliz' },
    { symbol: 'QTUM', name: 'Qtum', id: 'qtum', coinmarketcap_id: '1684', coinpaprika_id: 'qtum-qtum' },
    { symbol: 'HNT', name: 'Helium', id: 'helium', coinmarketcap_id: '5665', coinpaprika_id: 'hnt-helium' },
    { symbol: 'BTT', name: 'BitTorrent', id: 'bittorrent', coinmarketcap_id: '16086', coinpaprika_id: 'btt-bittorrent' },
    { symbol: 'ONE', name: 'Harmony', id: 'harmony', coinmarketcap_id: '3945', coinpaprika_id: 'one-harmony' },
    { symbol: 'IOTA', name: 'IOTA', id: 'iota', coinmarketcap_id: '1720', coinpaprika_id: 'miota-iota' },
    { symbol: 'EGLD', name: 'MultiversX', id: 'elrond-erd-2', coinmarketcap_id: '6892', coinpaprika_id: 'egld-elrond' },
    { symbol: 'RVN', name: 'Ravencoin', id: 'ravencoin', coinmarketcap_id: '2577', coinpaprika_id: 'rvn-ravencoin' },
    { symbol: 'SC', name: 'Siacoin', id: 'siacoin', coinmarketcap_id: '1042', coinpaprika_id: 'sc-siacoin' },
    { symbol: 'ZEN', name: 'Horizen', id: 'zencash', coinmarketcap_id: '1698', coinpaprika_id: 'zen-horizen' },
    { symbol: 'ONT', name: 'Ontology', id: 'ontology', coinmarketcap_id: '2566', coinpaprika_id: 'ont-ontology' },
    { symbol: 'IOST', name: 'IOST', id: 'iostoken', coinmarketcap_id: '2405', coinpaprika_id: 'iost-iost' },
    { symbol: 'STORJ', name: 'Storj', id: 'storj', coinmarketcap_id: '1772', coinpaprika_id: 'storj-storj' },
    { symbol: 'RSR', name: 'Reserve Rights', id: 'reserve-rights-token', coinmarketcap_id: '3964', coinpaprika_id: 'rsr-reserve-rights' },
    { symbol: 'ANKR', name: 'Ankr', id: 'ankr', coinmarketcap_id: '3783', coinpaprika_id: 'ankr-ankr' },
    { symbol: 'OCEAN', name: 'Ocean Protocol', id: 'ocean-protocol', coinmarketcap_id: '3911', coinpaprika_id: 'ocean-ocean-protocol' },
    { symbol: 'CKB', name: 'Nervos Network', id: 'nervos-network', coinmarketcap_id: '4948', coinpaprika_id: 'ckb-nervos-network' },
    { symbol: 'AR', name: 'Arweave', id: 'arweave', coinmarketcap_id: '5632', coinpaprika_id: 'ar-arweave' },
    { symbol: 'DGB', name: 'DigiByte', id: 'digibyte', coinmarketcap_id: '109', coinpaprika_id: 'dgb-digibyte' },
    { symbol: 'LSK', name: 'Lisk', id: 'lisk', coinmarketcap_id: '1214', coinpaprika_id: 'lsk-lisk' },
    { symbol: 'REP', name: 'Augur', id: 'augur', coinmarketcap_id: '1104', coinpaprika_id: 'rep-augur' },
    { symbol: 'BAND', name: 'Band Protocol', id: 'band-protocol', coinmarketcap_id: '4679', coinpaprika_id: 'band-band-protocol' },
    { symbol: 'NANO', name: 'Nano', id: 'nano', coinmarketcap_id: '1567', coinpaprika_id: 'nano-nano' },
    { symbol: 'UMA', name: 'UMA', id: 'uma', coinmarketcap_id: '5617', coinpaprika_id: 'uma-uma' },
    { symbol: 'SXP', name: 'Swipe', id: 'swipe', coinmarketcap_id: '4279', coinpaprika_id: 'sxp-swipe' },
    { symbol: 'FET', name: 'Fetch.ai', id: 'fetch-ai', coinmarketcap_id: '3773', coinpaprika_id: 'fet-fetch' },
    { symbol: 'CEL', name: 'Celsius', id: 'celsius-degree-token', coinmarketcap_id: '2700', coinpaprika_id: 'cel-celsius' },
    { symbol: 'RLC', name: 'iExec RLC', id: 'rlc', coinmarketcap_id: '1637', coinpaprika_id: 'rlc-iexec-rlc' },
    { symbol: 'OXT', name: 'Orchid', id: 'orchid-protocol', coinmarketcap_id: '5026', coinpaprika_id: 'oxt-orchid' },
    { symbol: 'CTSI', name: 'Cartesi', id: 'cartesi', coinmarketcap_id: '5444', coinpaprika_id: 'ctsi-cartesi' },
    { symbol: 'NU', name: 'NuCypher', id: 'nucypher', coinmarketcap_id: '4761', coinpaprika_id: 'nu-nucypher' },
    { symbol: 'DODO', name: 'DODO', id: 'dodo', coinmarketcap_id: '7224', coinpaprika_id: 'dodo-dodo' },
    { symbol: 'POLY', name: 'Polymath', id: 'polymath', coinmarketcap_id: '2496', coinpaprika_id: 'poly-polymath' },
    { symbol: 'MLN', name: 'Enzyme', id: 'melon', coinmarketcap_id: '1552', coinpaprika_id: 'mln-enzyme' },
    { symbol: 'AUDIO', name: 'Audius', id: 'audius', coinmarketcap_id: '7455', coinpaprika_id: 'audio-audius' },
    { symbol: 'SRM', name: 'Serum', id: 'serum', coinmarketcap_id: '6187', coinpaprika_id: 'srm-serum' },
    { symbol: 'COCOS', name: 'Cocos-BCX', id: 'cocos-bcx', coinmarketcap_id: '4276', coinpaprika_id: 'cocos-cocos-bcx' },
    { symbol: 'TRB', name: 'Tellor', id: 'tellor', coinmarketcap_id: '4944', coinpaprika_id: 'trb-tellor' },
    { symbol: 'MDT', name: 'Measurable Data Token', id: 'measurable-data-token', coinmarketcap_id: '2348', coinpaprika_id: 'mdt-measurable-data-token' },
    { symbol: 'WTC', name: 'Waltonchain', id: 'waltonchain', coinmarketcap_id: '1925', coinpaprika_id: 'wtc-waltonchain' },
    { symbol: 'GXC', name: 'GXChain', id: 'gxchain', coinmarketcap_id: '1750', coinpaprika_id: 'gxc-gxchain' },
    { symbol: 'MTL', name: 'Metal', id: 'metal', coinmarketcap_id: '1788', coinpaprika_id: 'mtl-metal' }
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
