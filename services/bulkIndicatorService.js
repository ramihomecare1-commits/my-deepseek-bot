const axios = require('axios');
const config = require('../config/config');

/**
 * Bulk Indicator Service using TAAPI.IO
 * Fetches RSI, Bollinger Bands, and other indicators for top 200 coins
 */
class BulkIndicatorService {
  constructor() {
    this.apiKey = process.env.TAAPI_API_KEY || config.TAAPI_API_KEY || '';
    this.baseUrl = 'https://api.taapi.io';
    this.exchange = 'binance'; // Default exchange
    this.interval = '1h'; // 1 hour candles
    
    if (!this.apiKey) {
      console.warn('⚠️ TAAPI_API_KEY not set - bulk indicator service will be disabled');
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
      // Use demo API (rate limited) or Pro API (with key)
      const baseUrl = coinGeckoKey 
        ? 'https://pro-api.coingecko.com/api/v3'
        : 'https://api.coingecko.com/api/v3';
      
      const params = {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 200,
        page: 1,
        sparkline: false
      };

      console.log(`📡 Fetching top 200 coins from CoinGecko (${coinGeckoKey ? 'Pro' : 'Free'} API)...`);
      
      // CoinGecko Pro API key goes in header, NOT in params
      const headers = {};
      if (coinGeckoKey) {
        headers['x-cg-pro-api-key'] = coinGeckoKey;
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
   * Convert CoinGecko symbol to Binance trading pair format
   * e.g., BTC -> BTC/USDT
   */
  convertToBinancePair(symbol) {
    // Handle special cases
    const symbolMap = {
      'BTC': 'BTC/USDT',
      'ETH': 'ETH/USDT',
      'BNB': 'BNB/USDT',
      'SOL': 'SOL/USDT',
      'XRP': 'XRP/USDT',
      'DOGE': 'DOGE/USDT',
      'ADA': 'ADA/USDT',
      'AVAX': 'AVAX/USDT',
      'LINK': 'LINK/USDT',
      'DOT': 'DOT/USDT'
    };

    if (symbolMap[symbol]) {
      return symbolMap[symbol];
    }

    // Default: add /USDT
    return `${symbol}/USDT`;
  }

  /**
   * Fetch bulk indicators from TAAPI.IO for multiple symbols
   * Returns indicators: RSI, Bollinger Bands, MACD, etc.
   */
  async fetchBulkIndicators(symbols, indicators = ['rsi', 'bbands2']) {
    if (!this.apiKey) {
      throw new Error('TAAPI_API_KEY not configured');
    }

    if (symbols.length === 0) {
      return [];
    }

    try {
      // TAAPI.IO bulk endpoint allows multiple symbols and indicators
      const symbolsStr = symbols.join(',');
      const indicatorsStr = indicators.join(',');

      const response = await axios.get(`${this.baseUrl}/bulk`, {
        params: {
          secret: this.apiKey,
          exchange: this.exchange,
          symbol: symbolsStr,
          interval: this.interval,
          indicators: indicatorsStr
        },
        timeout: 30000 // 30 second timeout for bulk requests
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error fetching bulk indicators from TAAPI.IO:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Scan top 200 coins for oversold opportunities
   * Returns coins sorted by most oversold (lowest RSI, below BB lower, etc.)
   */
  async scanBulkCoinsForOversold(options = {}) {
    const {
      maxCoins = 200,
      rsiThreshold = 30,
      minTriggers = 2, // Need at least 2 indicators to trigger
      enableBollinger = true, // Whether to check Bollinger Bands
      minPriceChange = 5, // Minimum price change % to consider
      requireVolume = false, // Whether to require volume spike
      volumeMultiplier = 2, // Volume multiplier threshold
      indicators = ['rsi', 'bbands2'] // RSI and Bollinger Bands
    } = options;

    if (!this.apiKey) {
      console.warn('⚠️ TAAPI_API_KEY not set - skipping bulk scan');
      return [];
    }

    try {
      console.log(`📊 Starting bulk scan for top ${maxCoins} coins...`);

      // 1. Get top 200 coins by market cap
      const topCoins = await this.getTop200Coins();
      if (topCoins.length === 0) {
        console.warn('⚠️ No coins fetched from CoinGecko');
        return [];
      }

      console.log(`✅ Fetched ${topCoins.length} coins from CoinGecko`);

      // 2. Convert to Binance pairs (TAAPI.IO format)
      const binancePairs = topCoins
        .slice(0, maxCoins)
        .map(coin => this.convertToBinancePair(coin.symbol));

      // 3. Determine which indicators to fetch based on settings
      const indicatorsToFetch = ['rsi']; // Always fetch RSI
      if (enableBollinger) {
        indicatorsToFetch.push('bbands2'); // Only fetch BB if enabled
      }

      console.log(`📡 Fetching indicators (${indicatorsToFetch.join(', ')}) for ${binancePairs.length} pairs from TAAPI.IO...`);

      // 4. Fetch bulk indicators (all at once - fast!)
      const indicatorsData = await this.fetchBulkIndicators(binancePairs, indicatorsToFetch);

      console.log(`✅ Received indicators for ${indicatorsData.length} pairs`);

      // 5. Process and filter coins
      const analyzedCoins = [];
      const indicatorsMap = new Map();

      // Group indicators by symbol for easy lookup
      indicatorsData.forEach(indicator => {
        const symbol = indicator.symbol.replace('/USDT', '');
        if (!indicatorsMap.has(symbol)) {
          indicatorsMap.set(symbol, {});
        }
        indicatorsMap.get(symbol)[indicator.indicator] = indicator;
      });

      // 6. Analyze each coin
      for (const coin of topCoins.slice(0, maxCoins)) {
        const coinIndicators = indicatorsMap.get(coin.symbol);
        if (!coinIndicators) continue;

        // Extract indicator values
        const rsi = coinIndicators.rsi?.value;
        const bbands = coinIndicators.bbands2;
        const bbUpper = bbands?.valueUpperBand;
        const bbMiddle = bbands?.valueMiddleBand;
        const bbLower = bbands?.valueLowerBand;
        const currentPrice = coin.price;

        // Count triggers (oversold conditions) based on UI settings
        let triggerCount = 0;
        const triggers = [];

        // RSI oversold trigger
        if (rsi !== undefined && rsi < rsiThreshold) {
          triggerCount++;
          triggers.push(`RSI: ${rsi.toFixed(2)}`);
        }

        // Bollinger Bands triggers (only if enabled in UI)
        if (enableBollinger) {
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
            confidence: this.calculateConfidence(rsi, bbLower, currentPrice, triggerCount)
          });
        }
      }

      // 7. Sort by most oversold (highest trigger count, lowest RSI)
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
      maxCoins: 200,
      rsiThreshold,
      minTriggers: 2
    });

    return allOversold.slice(0, topN);
  }
}

module.exports = new BulkIndicatorService();

