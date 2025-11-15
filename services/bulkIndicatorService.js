const axios = require('axios');
const config = require('../config/config');

/**
 * Bulk Indicator Service - Calculates RSI and Bollinger Bands from CoinGecko data
 * No external indicator API needed - completely free for all 200 coins!
 * Uses daily candles to match TradingView/exchanges format
 */
class BulkIndicatorService {
  constructor() {
    // No longer need TAAPI.IO - we calculate indicators ourselves!
    this.rsiPeriod = 14; // RSI(14) - 14 days (matches TradingView)
    this.bbPeriod = 20; // Bollinger Bands(20) - 20 days (matches TradingView)
    this.bbStdDev = 2; // 2 standard deviations (matches TradingView)
    this.idCache = new Map(); // Cache for CoinGecko ID lookups
  }

  /**
   * Calculate RSI (Relative Strength Index) from price history
   * RSI = 100 - (100 / (1 + RS))
   * RS = Average Gain / Average Loss over period
   */
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      return null; // Not enough data
    }

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    // Calculate initial average gain and loss
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) {
        avgGain += changes[i];
      } else {
        avgLoss += Math.abs(changes[i]);
      }
    }
    
    avgGain /= period;
    avgLoss /= period;

    // Use Wilder's smoothing method for remaining periods
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) {
      return 100; // All gains, no losses
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
  }

  /**
   * Calculate Bollinger Bands from price history
   * Returns { upper, middle, lower }
   */
  calculateBollingerBands(prices, period = 20, stdDevMultiplier = 2) {
    if (prices.length < period) {
      return null; // Not enough data
    }

    // Get last N prices
    const recentPrices = prices.slice(-period);
    
    // Calculate Simple Moving Average (middle band)
    const sum = recentPrices.reduce((a, b) => a + b, 0);
    const sma = sum / period;

    // Calculate standard deviation
    const variance = recentPrices.reduce((sum, price) => {
      return sum + Math.pow(price - sma, 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);

    // Calculate bands
    const upper = sma + (stdDev * stdDevMultiplier);
    const lower = sma - (stdDev * stdDevMultiplier);

    return {
      upper,
      middle: sma,
      lower
    };
  }

  /**
   * Fetch historical price data from CoinGecko for a coin
   * Returns array of prices (daily candles) - matches TradingView/exchanges format
   */
  async fetchHistoricalPrices(coinId, days = 60, retryCount = 0, maxRetries = 2) {
    const coinGeckoKey = process.env.COINGECKO_API_KEY || config.COINGECKO_API_KEY;
    const baseUrl = 'https://api.coingecko.com/api/v3';
    
    try {
      const headers = {};
      if (coinGeckoKey) {
        headers['x-cg-demo-api-key'] = coinGeckoKey;
      }

      // Fetch market chart data (daily candles - matches TradingView/exchanges)
      // For daily data, don't use 'interval' parameter - it defaults to daily
      const response = await axios.get(
        `${baseUrl}/coins/${coinId}/market_chart`,
        {
          params: {
            vs_currency: 'usd',
            days: days
            // No 'interval' parameter = daily candles (matches TradingView)
          },
          timeout: 15000,
          headers
        }
      );

      // Extract prices from the response
      // Response format: { prices: [[timestamp, price], ...] }
      // These are daily closing prices
      if (response.data && response.data.prices) {
        return response.data.prices.map(entry => entry[1]); // Extract just the prices
      }

      return [];
    } catch (error) {
      // Handle rate limit errors with exponential backoff
      if (error.response && error.response.status === 429 && retryCount < maxRetries) {
        const backoffDelay = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        console.log(`⚠️ Rate limit for ${coinId}, retrying in ${backoffDelay/1000}s... (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return this.fetchHistoricalPrices(coinId, days, retryCount + 1, maxRetries);
      }
      
      // Only log rate limit errors (429) - silently skip 404s (coin not found)
      if (error.response && error.response.status === 429) {
        console.log(`⏭️ Skipping ${coinId} after ${maxRetries} retries (will try on next scan)`);
      }
      // Silently skip 404s (coin not found/delisted) and other errors
      return [];
    }
  }

  /**
   * Get top 200 coins by market cap from CoinGecko
   * Returns array of { symbol, name, rank, marketCap }
   */
  async getTop200Coins() {
    // CoinGecko API key (optional - improves rate limits)
    const coinGeckoKey = process.env.COINGECKO_API_KEY || config.COINGECKO_API_KEY;
    
    try {
      // Always use free API URL - works for both free tier and Demo API keys
      // Pro API keys should use pro-api.coingecko.com, but most users have Demo keys
      const baseUrl = 'https://api.coingecko.com/api/v3';
      
      const params = {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 200,
        page: 1,
        sparkline: false
      };

      console.log(`📡 Fetching top 200 coins from CoinGecko${coinGeckoKey ? ' (with Demo API key)' : ' (Free tier)'}...`);
      
      // Demo API key goes in header (improves rate limits on free API)
      const headers = {};
      if (coinGeckoKey) {
        headers['x-cg-demo-api-key'] = coinGeckoKey;
      }
      
      const response = await axios.get(
        `${baseUrl}/coins/markets`,
        {
          params,
          timeout: 15000,
          headers
        }
      );

      const coins = response.data.map((coin, index) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        rank: index + 1,
        marketCap: coin.market_cap,
        price: coin.current_price,
        priceChange24h: coin.price_change_percentage_24h || 0
      }));
      
      console.log(`✅ Fetched ${coins.length} coins from CoinGecko`);
      return coins;
    } catch (error) {
      if (error.response) {
        if (error.response.status === 429) {
          console.error('❌ CoinGecko rate limit exceeded (429)');
          console.error('   💡 Consider setting COINGECKO_API_KEY for higher rate limits');
          console.error('   💡 Or wait 60 seconds before trying again');
        } else if (error.response.status === 400) {
          console.error('❌ CoinGecko bad request (400)');
          console.error('   Response:', error.response.data);
          console.error('   💡 Check if COINGECKO_API_KEY is valid');
        } else if (error.response.status === 401) {
          console.error('❌ CoinGecko unauthorized (401)');
          console.error('   💡 Your COINGECKO_API_KEY may be invalid or expired');
        } else {
          console.error('❌ Error fetching top 200 coins:', error.message);
          console.error('   Status:', error.response.status);
        }
      } else {
        console.error('❌ Error fetching top 200 coins:', error.message);
      }
      return [];
    }
  }

  /**
   * Convert CoinGecko symbol to CoinGecko ID (needed for historical data)
   * Most symbols match, but some need mapping
   */
  getCoinGeckoId(symbol, name) {
    // Expanded mappings for common coins (top 200)
    const symbolToId = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'BNB': 'binancecoin',
      'SOL': 'solana',
      'XRP': 'ripple',
      'DOGE': 'dogecoin',
      'ADA': 'cardano',
      'AVAX': 'avalanche-2',
      'LINK': 'chainlink',
      'DOT': 'polkadot',
      'MATIC': 'matic-network',
      'LTC': 'litecoin',
      'XMR': 'monero',
      'ETC': 'ethereum-classic',
      'APT': 'aptos',
      'XAUT': 'tether-gold',
      'ENA': 'ethena',
      'PI': 'pinetwork',
      'OKB': 'okb',
      'PEPE': 'pepe',
      'ONDO': 'ondo-finance',
      'WETH': 'weth',
      'USDF': 'usdf',
      'PUMP': 'pump-fun',
      'JITOSOL': 'jito-governance-token',
      'JLP': 'jupiter-exchange-solana',
      'ASTER': 'aster',
      'RENDER': 'render-token',
      'RSETH': 'kelp-dao-restaked-eth',
      'USDG': 'global-dollar',
      'FBTC': 'ignition-fbtc',
      'FLR': 'flare-networks',
      'WBETH': 'wrapped-beacon-eth',
      'HYPE': 'hyperliquid',
      'BCH': 'bitcoin-cash',
      'WETH': 'weth',
      'XLM': 'stellar',
      'WEETH': 'wrapped-eeth',
      'LEO': 'leo-token',
      'USDE': 'usde',
      'BSC-USD': 'binance-bridged-usdt-bnb-smart-chain',
      'CBBTC': 'compound-wrapped-btc'
    };

    if (symbolToId[symbol]) {
      return symbolToId[symbol];
    }

    // Try common variations
    const lowerSymbol = symbol.toLowerCase();
    
    // Some coins use hyphenated names
    const commonMappings = {
      'usdc': 'usd-coin',
      'usdt': 'tether',
      'dai': 'dai',
      'shib': 'shiba-inu',
      'trx': 'tron',
      'atom': 'cosmos',
      'algo': 'algorand',
      'vet': 'vechain',
      'icp': 'internet-computer',
      'fil': 'filecoin',
      'near': 'near',
      'egld': 'elrond-erd-2',
      'hbar': 'hedera-hashgraph',
      'axs': 'axie-infinity',
      'sand': 'the-sandbox',
      'mana': 'decentraland',
      'gala': 'gala',
      'enj': 'enjincoin',
      'chz': 'chiliz',
      'flow': 'flow',
      'theta': 'theta-token',
      'zil': 'zilliqa',
      'bat': 'basic-attention-token',
      'zec': 'zcash',
      'dash': 'dash',
      'xlm': 'stellar',
      'eos': 'eos',
      'xtz': 'tezos',
      'mkr': 'maker',
      'comp': 'compound-governance-token',
      'yfi': 'yearn-finance',
      'sushi': 'sushi',
      'aave': 'aave',
      'uni': 'uniswap',
      'crv': 'curve-dao-token',
      'snx': 'havven',
      '1inch': '1inch',
      'grt': 'the-graph',
      'ftm': 'fantom',
      'celo': 'celo',
      'kava': 'kava',
      'band': 'band-protocol',
      'zrx': '0x',
      'ren': 'republic-protocol',
      'uma': 'uma',
      'bal': 'balancer',
      'knc': 'kyber-network-crystal',
      'lrc': 'loopring',
      'omg': 'omisego',
      'poly': 'polymath',
      'storj': 'storj',
      'gnt': 'golem',
      'rep': 'augur',
      'ant': 'aragon',
      'zcn': '0chain',
      'skl': 'skale',
      'ogn': 'origin-protocol',
      'rad': 'radicle',
      'api3': 'api3',
      'dg': 'degate',
      'rndr': 'render-token',
      'cro': 'crypto-com-chain',
      'cake': 'pancakeswap-token',
      'bake': 'bakerytoken',
      'burger': 'burger-swap',
      'sxp': 'swipe',
      'xvs': 'venus',
      'alpaca': 'alpaca-finance',
      'tko': 'tokocrypto',
      'perl': 'perlin',
      'linear': 'linear',
      'auto': 'auto',
      'dodo': 'dodo',
      'swingby': 'swingby',
      'bondly': 'bondly',
      'troy': 'troy',
      'vite': 'vite',
      'lit': 'litentry',
      'sfp': 'safepal',
      'dusk': 'dusk-network',
      'bcha': 'bitcoin-cash-abc-2',
      'qkc': 'quarkchain',
      'btt': 'bittorrent',
      'matic': 'matic-network',
      'celr': 'celer-network',
      'atm': 'atletico-madrid',
      'ctsi': 'cartesi',
      'lrc': 'loopring',
      'adx': 'adex',
      'auction': 'auction',
      'dar': 'mines-of-dalarnia',
      'bnx': 'binaryx',
      'rgt': 'rari-governance-token',
      'movr': 'moonriver',
      'cvg': 'convergence',
      'ctk': 'certik',
      'badger': 'badger-dao',
      'fis': 'stafi',
      'om': 'mantra-dao',
      'pond': 'marinade-staked-sol',
      'dydx': 'dydx',
      'gala': 'gala',
      'celo': 'celo',
      'klay': 'klay-token',
      'rune': 'thorchain',
      'luna': 'terra-luna',
      'ust': 'terrausd',
      'rose': 'oasis-network',
      'wbtc': 'wrapped-bitcoin',
      'paxg': 'pax-gold',
      'mim': 'magic-internet-money',
      'ohm': 'olympus',
      'gohm': 'governance-ohm',
      'spell': 'spell-token',
      'farm': 'harvest-finance',
      'boo': 'spookyswap',
      'alpha': 'alpha-finance',
      'fxs': 'frax-share',
      'synthetix': 'havven',
      'snx': 'havven',
      'ousd': 'origin-dollar',
      'eurt': 'tether-eurt',
      'cusdc': 'compound-usd-coin',
      'cdai': 'cdai',
      'cwbtc': 'compound-wrapped-btc',
      'ccomp': 'compound-governance-token',
      'cuni': 'compound-uniswap',
      'clink': 'compound-chainlink-token',
      'cbat': 'compound-basic-attention-token',
      'czrx': 'compound-0x',
      'cusdt': 'compound-usdt',
      'crep': 'compound-augur',
      'cweth': 'compound-weth',
      'csai': 'compound-sai',
      'ctusd': 'compound-true-usd',
      'cusdp': 'compound-usd-coin-pos',
      'cusdcv2': 'compound-usd-coin-v2',
      'cdai2': 'compound-dai-v2',
      'cwbtc2': 'compound-wrapped-btc-v2',
      'ccomp2': 'compound-governance-token-v2',
      'cuni2': 'compound-uniswap-v2',
      'clink2': 'compound-chainlink-token-v2',
      'cbat2': 'compound-basic-attention-token-v2',
      'czrx2': 'compound-0x-v2',
      'cusdt2': 'compound-usdt-v2',
      'crep2': 'compound-augur-v2',
      'cweth2': 'compound-weth-v2',
      'csai2': 'compound-sai-v2',
      'ctusd2': 'compound-true-usd-v2',
      'cusdp2': 'compound-usd-coin-pos-v2'
    };

    // Check common mappings first
    if (commonMappings[lowerSymbol]) {
      return commonMappings[lowerSymbol];
    }

    // Default: use lowercase symbol (works for many coins)
    return lowerSymbol;
  }

  /**
   * Find CoinGecko ID by searching with symbol/name
   * Fallback when direct mapping fails
   * Uses cached results to avoid repeated API calls
   */
  async findCoinGeckoIdBySearch(symbol, name) {
    // Check cache first
    const cacheKey = symbol.toLowerCase();
    if (this.idCache.has(cacheKey)) {
      return this.idCache.get(cacheKey);
    }

    const coinGeckoKey = process.env.COINGECKO_API_KEY || config.COINGECKO_API_KEY;
    const baseUrl = 'https://api.coingecko.com/api/v3';
    
    try {
      const headers = {};
      if (coinGeckoKey) {
        headers['x-cg-demo-api-key'] = coinGeckoKey;
      }

      // Try searching by symbol first, then by name
      const searchTerms = [symbol.toLowerCase(), name?.toLowerCase()].filter(Boolean);
      
      for (const term of searchTerms) {
        // Small delay before search API call to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const response = await axios.get(
          `${baseUrl}/search`,
          {
            params: { query: term },
            timeout: 5000,
            headers
          }
        );

        if (response.data?.coins && response.data.coins.length > 0) {
          // Find exact symbol match
          const exactMatch = response.data.coins.find(
            coin => coin.symbol?.toLowerCase() === symbol.toLowerCase()
          );
          if (exactMatch) {
            this.idCache.set(cacheKey, exactMatch.id);
            return exactMatch.id;
          }
          // Otherwise return first result
          const foundId = response.data.coins[0].id;
          this.idCache.set(cacheKey, foundId);
          return foundId;
        }
      }
      
      return null;
    } catch (error) {
      // If rate limited, don't retry immediately
      if (error.response?.status === 429) {
        return null; // Will be skipped, can retry on next scan
      }
      return null;
    }
  }

  /**
   * Calculate indicators for a coin from historical price data
   * Returns { rsi, bollinger: { upper, middle, lower } }
   * Uses daily candles to match TradingView/exchanges format
   */
  async calculateIndicatorsForCoin(coin) {
    try {
      // Get CoinGecko ID
      let coinId = this.getCoinGeckoId(coin.symbol, coin.name);
      
      // Try fetching historical prices
      let prices = await this.fetchHistoricalPrices(coinId, 60);
      
      // If 404 error, try to find correct ID via search (only if we got 0 prices)
      // Note: We check prices.length === 0 instead of checking error status
      // because fetchHistoricalPrices returns [] on error, not throwing
      if (prices.length === 0) {
        // Only search if we haven't tried this coin before (avoid rate limits)
        const foundId = await this.findCoinGeckoIdBySearch(coin.symbol, coin.name);
        if (foundId && foundId !== coinId) {
          coinId = foundId;
          // Small delay before retry to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
          prices = await this.fetchHistoricalPrices(coinId, 60);
        }
      }
      
      if (prices.length < this.bbPeriod) {
        // Not enough data for indicators (need at least 20 days for BB)
        return null;
      }

      // Calculate RSI (14 days) - matches TradingView RSI(14)
      const rsi = this.calculateRSI(prices, this.rsiPeriod);

      // Calculate Bollinger Bands (20 days, 2 std dev) - matches TradingView BB(20,2)
      const bollinger = this.calculateBollingerBands(prices, this.bbPeriod, this.bbStdDev);

      return {
        rsi,
        bollinger
      };
    } catch (error) {
      // Silently skip coins that can't be found (reduce log noise)
      return null;
    }
  }

  /**
   * Scan top coins for oversold opportunities
   * Returns coins sorted by most oversold (lowest RSI, below BB lower, etc.)
   * Default: 25 coins (configurable via maxCoins parameter)
   */
  async scanBulkCoinsForOversold(options = {}) {
    const {
      maxCoins = 25, // Reduced to 25 to avoid rate limits (was 200)
      rsiThreshold = 30,
      minTriggers = 2, // Need at least 2 indicators to trigger
      enableBollinger = true, // Whether to check Bollinger Bands
      minPriceChange = 5, // Minimum price change % to consider
      requireVolume = false, // Whether to require volume spike
      volumeMultiplier = 2, // Volume multiplier threshold
      indicators = ['rsi', 'bbands2'] // RSI and Bollinger Bands
    } = options;

    try {
      console.log(`📊 Starting bulk scan for top ${maxCoins} coins...`);

      // 1. Get top 200 coins by market cap
      const topCoins = await this.getTop200Coins();
      if (topCoins.length === 0) {
        console.warn('⚠️ No coins fetched from CoinGecko');
        return [];
      }

      console.log(`✅ Fetched ${topCoins.length} coins from CoinGecko`);

      // 2. Filter out stablecoins and wrapped/derivative tokens
      const stablecoins = [
        'USDT', 'USDC', 'BUSD', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDP', 
        'GUSD', 'PYUSD', 'USDD', 'FRAX', 'LUSD', 'USDJ', 'BSC-USD',
        'SUSD', 'TRIBE', 'FEI', 'EURS', 'EURT', 'USDN'
      ];
      
      const wrappedDerivatives = [
        'WETH', 'WBTC', 'WBETH', 'WSTETH', 'WEETH', 'STETH', 'RETH', 
        'CBETH', 'EETH', 'ETHX', 'SETH2', 'ANKR', 'SFRXETH', 'SWETH',
        'CBBTC', 'GTETH', 'FRXETH', 'OSETH'
      ];
      
      const excludedCoins = [...stablecoins, ...wrappedDerivatives];
      
      const filteredCoins = topCoins.filter(coin => {
        const symbol = coin.symbol.toUpperCase();
        return !excludedCoins.includes(symbol);
      });
      
      console.log(`🔍 Filtered out ${topCoins.length - filteredCoins.length} stablecoins/wrapped tokens`);

      // 3. Limit to maxCoins from filtered list
      const coinsToScan = filteredCoins.slice(0, maxCoins);
      
      console.log(`📊 Calculating indicators for ${coinsToScan.length} coins (RSI(14) + BB(20,2))...`);
      console.log(`   Using daily candles to match TradingView/exchanges format`);
      console.log(`   This may take a minute - fetching 60 days of daily data from CoinGecko...`);

      // 4. Calculate indicators for each coin (ONE AT A TIME to avoid rate limits)
      const analyzedCoins = [];
      const delayBetweenCoins = 4000; // 4 seconds between each coin (safer for CoinGecko free tier - 15 req/min max)
      
      console.log(`   Processing ${coinsToScan.length} coins one at a time (4s delay between each)...`);
      
      for (let i = 0; i < coinsToScan.length; i++) {
        const coin = coinsToScan[i];
        const progress = `[${i + 1}/${coinsToScan.length}]`;
        console.log(`   ${progress} Processing ${coin.symbol}...`);
        
        const indicators = await this.calculateIndicatorsForCoin(coin);
          
        if (!indicators) {
          // Skip if indicators couldn't be calculated (silently continue)
          if (i < coinsToScan.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenCoins));
          }
          continue;
        }

        // Extract indicator values
        const rsi = indicators.rsi;
        const bollinger = indicators.bollinger;
        const bbUpper = bollinger?.upper;
        const bbMiddle = bollinger?.middle;
        const bbLower = bollinger?.lower;
        const currentPrice = coin.price;

        // Count triggers (oversold conditions) based on UI settings
        let triggerCount = 0;
        const triggers = [];

        // RSI oversold trigger
        if (rsi !== undefined && rsi !== null && rsi < rsiThreshold) {
          triggerCount++;
          triggers.push(`RSI: ${rsi.toFixed(2)}`);
        }

        // Bollinger Bands triggers (only if enabled in UI)
        if (enableBollinger && bollinger) {
          // Price below lower band
          if (bbLower && currentPrice < bbLower) {
            triggerCount++;
            triggers.push(`BB: Below lower band (${((currentPrice - bbLower) / bbLower * 100).toFixed(2)}%)`);
          }
          // Price near lower band (within 1%)
          else if (bbLower && currentPrice >= bbLower && currentPrice < bbLower * 1.01) {
            triggerCount++;
            triggers.push(`BB: Near lower band`);
          }
        }

        // Price change trigger (if minPriceChange is set)
        const priceChangeAbs = Math.abs(coin.priceChange24h || 0);
        if (minPriceChange > 0 && priceChangeAbs >= minPriceChange) {
          triggerCount++;
          triggers.push(`Price change: ${priceChangeAbs.toFixed(2)}%`);
        }

        // Only include if meets minimum trigger threshold
        if (triggerCount >= minTriggers) {
          analyzedCoins.push({
            symbol: coin.symbol,
            name: coin.name,
            rank: coin.rank,
            price: currentPrice,
            priceChange24h: coin.priceChange24h,
            marketCap: coin.marketCap,
            indicators: {
              rsi,
              bollinger: {
                upper: bbUpper,
                middle: bbMiddle,
                lower: bbLower
              }
            },
            triggerCount,
            triggers,
            confidence: this.calculateConfidence(rsi, bbLower, currentPrice, triggerCount),
            analysis: {
              recommendation: rsi !== null && rsi !== undefined && rsi < rsiThreshold ? 'BUY' : 'HOLD',
              confidence: this.calculateConfidence(rsi, bbLower, currentPrice, triggerCount),
              reason: triggers.join(', ')
            }
          });
        }
        
        // Delay between coins to respect CoinGecko rate limits
        if (i < coinsToScan.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenCoins));
        }
      }

      // 5. Sort by most oversold (highest trigger count, lowest RSI)
      const sorted = analyzedCoins.sort((a, b) => {
        if (b.triggerCount !== a.triggerCount) {
          return b.triggerCount - a.triggerCount;
        }
        const rsiA = a.indicators.rsi || 100;
        const rsiB = b.indicators.rsi || 100;
        return rsiA - rsiB;
      });

      console.log(`✅ Bulk scan complete: ${sorted.length} coins with ${minTriggers}+ triggers`);
      if (sorted.length > 0) {
        console.log(`   Top 5: ${sorted.slice(0, 5).map(c => `${c.symbol} (RSI: ${c.indicators.rsi?.toFixed(1) || 'N/A'})`).join(', ')}`);
      }

      return sorted;
    } catch (error) {
      console.error('❌ Error in bulk coin scan:', error.message);
      return [];
    }
  }

  /**
   * Calculate confidence score based on indicators
   */
  calculateConfidence(rsi, bbLower, currentPrice, triggerCount) {
    let confidence = 0.4; // Base confidence

    // RSI contribution
    if (rsi !== undefined) {
      if (rsi < 20) confidence += 0.3;
      else if (rsi < 25) confidence += 0.25;
      else if (rsi < 30) confidence += 0.2;
      else if (rsi < 35) confidence += 0.1;
    }

    // Bollinger Bands contribution
    if (bbLower && currentPrice < bbLower) {
      const distance = ((bbLower - currentPrice) / bbLower) * 100;
      if (distance > 2) confidence += 0.2; // More than 2% below lower band
      else confidence += 0.15;
    }

    // Multiple triggers boost
    confidence += (triggerCount - 1) * 0.1;

    return Math.min(confidence, 0.95); // Cap at 95%
  }

  /**
   * Quick scan - returns only top N most oversold coins
   */
  async quickScan(topN = 10, rsiThreshold = 30) {
    const allOversold = await this.scanBulkCoinsForOversold({
      maxCoins: 25, // Reduced to 25 to avoid rate limits
      rsiThreshold,
      minTriggers: 2
    });

    return allOversold.slice(0, topN);
  }
}

module.exports = new BulkIndicatorService();

