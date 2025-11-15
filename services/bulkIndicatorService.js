const axios = require('axios');
const config = require('../config/config');

/**
 * Bulk Indicator Service - Calculates RSI and Bollinger Bands from CoinGecko data
 * No external indicator API needed - completely free for all 200 coins!
 */
class BulkIndicatorService {
  constructor() {
    // No longer need TAAPI.IO - we calculate indicators ourselves!
    this.rsiPeriod = 14; // Standard RSI period
    this.bbPeriod = 20; // Standard Bollinger Bands period
    this.bbStdDev = 2; // Standard deviation multiplier for Bollinger Bands
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
   * Returns array of prices (last 30 days, hourly)
   */
  async fetchHistoricalPrices(coinId, days = 30) {
    const coinGeckoKey = process.env.COINGECKO_API_KEY || config.COINGECKO_API_KEY;
    const baseUrl = 'https://api.coingecko.com/api/v3';
    
    try {
      const headers = {};
      if (coinGeckoKey) {
        headers['x-cg-demo-api-key'] = coinGeckoKey;
      }

      // Fetch market chart data (hourly candles for last N days)
      const response = await axios.get(
        `${baseUrl}/coins/${coinId}/market_chart`,
        {
          params: {
            vs_currency: 'usd',
            days: days,
            interval: 'hourly' // Hourly data for better RSI/BB calculation
          },
          timeout: 10000,
          headers
        }
      );

      // Extract prices from the response
      // Response format: { prices: [[timestamp, price], ...] }
      if (response.data && response.data.prices) {
        return response.data.prices.map(entry => entry[1]); // Extract just the prices
      }

      return [];
    } catch (error) {
      console.error(`⚠️ Error fetching historical prices for ${coinId}:`, error.message);
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
    // Special mappings for common coins
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
      'XMR': 'monero'
    };

    if (symbolToId[symbol]) {
      return symbolToId[symbol];
    }

    // Default: use lowercase symbol (works for most coins)
    return symbol.toLowerCase();
  }

  /**
   * Calculate indicators for a coin from historical price data
   * Returns { rsi, bollinger: { upper, middle, lower } }
   */
  async calculateIndicatorsForCoin(coin) {
    try {
      // Get CoinGecko ID
      const coinId = this.getCoinGeckoId(coin.symbol, coin.name);
      
      // Fetch historical prices (last 30 days, hourly)
      const prices = await this.fetchHistoricalPrices(coinId, 30);
      
      if (prices.length < this.bbPeriod) {
        // Not enough data for indicators
        return null;
      }

      // Calculate RSI
      const rsi = this.calculateRSI(prices, this.rsiPeriod);

      // Calculate Bollinger Bands
      const bollinger = this.calculateBollingerBands(prices, this.bbPeriod, this.bbStdDev);

      return {
        rsi,
        bollinger
      };
    } catch (error) {
      console.error(`⚠️ Error calculating indicators for ${coin.symbol}:`, error.message);
      return null;
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

    try {
      console.log(`📊 Starting bulk scan for top ${maxCoins} coins...`);

      // 1. Get top 200 coins by market cap
      const topCoins = await this.getTop200Coins();
      if (topCoins.length === 0) {
        console.warn('⚠️ No coins fetched from CoinGecko');
        return [];
      }

      console.log(`✅ Fetched ${topCoins.length} coins from CoinGecko`);

      // 2. Filter to TAAPI.IO supported symbols (free plan only supports 5 symbols)
      // Free plan: BTC/USDT, ETH/USDT, XRP/USDT, LTC/USDT, XMR/USDT
      // Paid plans: All Binance symbols
      const supportedSymbols = ['BTC', 'ETH', 'XRP', 'LTC', 'XMR'];
      const filteredCoins = topCoins
        .slice(0, maxCoins)
        .filter(coin => supportedSymbols.includes(coin.symbol));
      
      if (filteredCoins.length === 0) {
        console.warn('⚠️ No supported symbols found in top coins (free plan supports: BTC, ETH, XRP, LTC, XMR)');
        console.warn('   💡 Upgrade TAAPI.IO plan to scan all 200 coins');
        return [];
      }
      
      console.log(`📊 Filtered to ${filteredCoins.length} supported symbols (${filteredCoins.map(c => c.symbol).join(', ')})`);
      
      // 3. Convert to Binance pairs (TAAPI.IO format)
      const binancePairs = filteredCoins.map(coin => this.convertToBinancePair(coin.symbol));

      // 3. Determine which indicators to fetch based on settings
      const indicatorsToFetch = ['rsi']; // Always fetch RSI
      if (enableBollinger) {
        indicatorsToFetch.push('bbands2'); // Only fetch BB if enabled
      }

      console.log(`📡 Fetching indicators (${indicatorsToFetch.join(', ')}) for ${binancePairs.length} pairs from TAAPI.IO...`);

      // 4. Fetch bulk indicators (all at once - fast!)
      const indicatorsData = await this.fetchBulkIndicators(binancePairs, indicatorsToFetch);

      console.log(`✅ Received indicators for ${indicatorsData.length} requests`);

      // 5. Process and filter coins
      const analyzedCoins = [];
      const indicatorsMap = new Map();

      // Group indicators by symbol for easy lookup
      // TAAPI.IO bulk returns array of results with id, indicator, value, etc.
      if (Array.isArray(indicatorsData)) {
        indicatorsData.forEach(result => {
          // Parse the id format: "BTC/USDT_rsi" -> symbol: "BTC", indicator: "rsi"
          const parts = result.id ? result.id.split('_') : [];
          if (parts.length >= 2) {
            const symbol = parts[0].replace('/USDT', '');
            const indicator = parts[1];
            if (!indicatorsMap.has(symbol)) {
              indicatorsMap.set(symbol, {});
            }
            indicatorsMap.get(symbol)[indicator] = result;
          }
        });
      }

      // 6. Analyze each filtered coin
      for (const coin of filteredCoins) {
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
              confidence: this.calculateConfidence(rsi, bbLower, currentPrice, triggerCount),
              analysis: {
                recommendation: rsi < rsiThreshold ? 'BUY' : 'HOLD',
                confidence: this.calculateConfidence(rsi, bbLower, currentPrice, triggerCount),
                reason: triggers.join(', ')
              }
            });
          }
        }
        
        // Small delay between batches to respect CoinGecko rate limits
        if (i + batchSize < coinsToScan.length) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
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

