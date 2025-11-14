const axios = require('axios');
const config = require('../config/config');

// Fetch global metrics from multiple APIs
async function fetchGlobalMetrics(globalMetrics, stats, coinmarketcapEnabled, coinmarketcapApiKey) {
  const now = Date.now();
  
  // CoinPaprika removed due to rate limiting issues

  // Fetch from CoinMarketCap (if API key available)
  if (coinmarketcapEnabled) {
    try {
      const cmcResponse = await axios.get('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest', {
        headers: {
          'X-CMC_PRO_API_KEY': coinmarketcapApiKey,
        },
        timeout: 10000,
      });
      if (cmcResponse.data && cmcResponse.data.data) {
        globalMetrics.coinmarketcap = cmcResponse.data.data;
        stats.coinmarketcapUsage++;
      }
    } catch (error) {
      console.log('⚠️ CoinMarketCap global metrics fetch failed:', error.message);
    }
  }

  globalMetrics.lastUpdated = now;
  return globalMetrics;
}

// Enhanced price data fetching with multiple APIs
// Priority: Binance (FREE, real-time exchange data) → CoinMarketCap
async function fetchEnhancedPriceData(coin, priceCache, stats, config) {
  let primaryData = null;
  let usedMock = false;

  // Try Binance FIRST (FREE, no API key, real-time exchange prices!)
  if (!primaryData && coin.symbol && BINANCE_SYMBOL_MAP[coin.symbol]) {
    try {
      const binanceData = await fetchBinancePrice(coin.symbol);
      if (binanceData && binanceData.price) {
        primaryData = {
          price: binanceData.price,
          volume_24h: binanceData.volume_24h,
          change_24h: binanceData.change_24h,
          high_24h: binanceData.high_24h,
          low_24h: binanceData.low_24h,
          source: 'binance'
        };
        priceCache.set(coin.id, { ...primaryData, timestamp: Date.now() });
        console.log(`✅ ${coin.symbol}: Binance price: $${primaryData.price.toFixed(2)}`);
      }
    } catch (error) {
      // Silently skip - will try other sources
      // Only log if it's not a geo-block (451) error
      if (!error.message.includes('geo-blocked')) {
        console.log(`⚠️ ${coin.symbol}: Binance price fetch failed - ${error.message}`);
      }
    }
  }

  // Fallback to CoinMarketCap (if API key available)
  if (!primaryData && config.COINMARKETCAP_ENABLED) {
    try {
      const cmcResponse = await axios.get(
        `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest`,
        {
          params: { id: coin.coinmarketcap_id },
          headers: {
            'X-CMC_PRO_API_KEY': config.COINMARKETCAP_API_KEY,
          },
          timeout: 10000,
        },
      );
      
      if (cmcResponse.data && cmcResponse.data.data && cmcResponse.data.data[coin.coinmarketcap_id]) {
        const cmcData = cmcResponse.data.data[coin.coinmarketcap_id];
        primaryData = {
          price: cmcData.quote.USD.price,
          market_cap: cmcData.quote.USD.market_cap,
          volume_24h: cmcData.quote.USD.volume_24h,
          change_24h: cmcData.quote.USD.percent_change_24h,
          source: 'coinmarketcap'
        };
        stats.coinmarketcapUsage++;
        priceCache.set(coin.id, { ...primaryData, timestamp: Date.now() });
        console.log(`✅ ${coin.symbol}: CoinMarketCap price: $${primaryData.price.toFixed(2)}`);
      }
    } catch (error) {
      console.log(`⚠️ ${coin.symbol}: CoinMarketCap price fetch failed - ${error.message}`);
    }
  }

  // CoinGecko and CoinPaprika removed due to rate limiting issues

  // Final fallback to cached data
  if (!primaryData) {
    const cached = priceCache.get(coin.id);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 min cache
      primaryData = { ...cached, source: 'cache' };
    } else {
      usedMock = true;
      primaryData = await generateMockPriceData(coin);
    }
  }

  return { data: primaryData, usedMock };
}

// Map coin symbols to Binance trading pairs
const BINANCE_SYMBOL_MAP = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'BNB': 'BNBUSDT', 'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT', 'DOGE': 'DOGEUSDT', 'ADA': 'ADAUSDT', 'AVAX': 'AVAXUSDT',
  'LINK': 'LINKUSDT', 'DOT': 'DOTUSDT', 'MATIC': 'MATICUSDT', 'LTC': 'LTCUSDT',
  'UNI': 'UNIUSDT', 'ATOM': 'ATOMUSDT', 'XLM': 'XLMUSDT', 'ETC': 'ETCUSDT',
  'XMR': 'XMRUSDT', 'ALGO': 'ALGOUSDT', 'FIL': 'FILUSDT', 'ICP': 'ICPUSDT',
  'VET': 'VETUSDT', 'EOS': 'EOSUSDT', 'XTZ': 'XTZUSDT', 'AAVE': 'AAVEUSDT',
  'MKR': 'MKRUSDT', 'GRT': 'GRTUSDT', 'THETA': 'THETAUSDT', 'RUNE': 'RUNEUSDT',
  'NEO': 'NEOUSDT', 'FTM': 'FTMUSDT'
};

// Fetch current price from Binance (FREE, no API key, real-time exchange data!)
async function fetchBinancePrice(symbol) {
  try {
    const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
    if (!binanceSymbol) {
      throw new Error(`Symbol ${symbol} not available on Binance`);
    }

    // Try with proxy if SCRAPER_API_KEY is set (bypasses geo-blocking)
    const scraperApiKey = process.env.SCRAPER_API_KEY || '';
    let url = 'https://api.binance.com/api/v3/ticker/24hr';
    let params = { symbol: binanceSymbol };
    
    if (scraperApiKey) {
      // Route through ScraperAPI to bypass geo-restrictions
      url = `http://api.scraperapi.com`;
      params = {
        api_key: scraperApiKey,
        url: `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`,
      };
    }

    const response = await axios.get(url, {
      params,
      timeout: 10000,
    });

    const data = scraperApiKey ? response.data : response.data;
    if (data && data.lastPrice) {
      return {
        price: parseFloat(data.lastPrice),
        volume_24h: parseFloat(data.volume || 0),
        change_24h: parseFloat(data.priceChangePercent || 0),
        high_24h: parseFloat(data.highPrice || 0),
        low_24h: parseFloat(data.lowPrice || 0),
        source: 'binance'
      };
    }
    throw new Error('Invalid Binance ticker response');
  } catch (error) {
    // Silently skip 451 errors (geo-blocking) - will try other sources
    if (error.response && error.response.status === 451) {
      throw new Error('Binance geo-blocked');
    }
    throw new Error(`Binance price fetch failed: ${error.message}`);
  }
}

// Fetch from Binance (FREE, no API key, best data!)
async function fetchBinanceKlines(symbol, interval, limit) {
  try {
    const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
    if (!binanceSymbol) {
      throw new Error(`Symbol ${symbol} not available on Binance`);
    }

    // Try with proxy if SCRAPER_API_KEY is set (bypasses geo-blocking)
    const scraperApiKey = process.env.SCRAPER_API_KEY || '';
    let url = 'https://api.binance.com/api/v3/klines';
    let params = { symbol: binanceSymbol, interval, limit };
    
    if (scraperApiKey) {
      // Route through ScraperAPI to bypass geo-restrictions
      url = `http://api.scraperapi.com`;
      params = {
        api_key: scraperApiKey,
        url: `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
      };
    }

    const response = await axios.get(url, {
      params,
      timeout: 15000,
    });

    const data = scraperApiKey ? response.data : response.data;
    if (data && Array.isArray(data)) {
      return data.map(([openTime, open, high, low, close]) => ({
        timestamp: new Date(openTime),
        price: parseFloat(close),
      })).filter(item => Number.isFinite(item.price) && item.price > 0);
    }
    throw new Error('Invalid Binance response');
  } catch (error) {
    throw new Error(`Binance fetch failed: ${error.message}`);
  }
}

// Fetch from CryptoCompare (backup with API key)
async function fetchCryptoCompare(symbol, limit, aggregate = 1) {
  try {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY || '';
    if (!apiKey) {
      throw new Error('CryptoCompare API key not configured');
    }

    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/histohour', {
      params: { fsym: symbol, tsym: 'USD', limit, aggregate },
      headers: { authorization: `Apikey ${apiKey}` },
      timeout: 10000,
    });

    if (response.data && response.data.Data && Array.isArray(response.data.Data.Data)) {
      return response.data.Data.Data.map(item => ({
        timestamp: new Date(item.time * 1000),
        price: item.close,
      })).filter(item => Number.isFinite(item.price) && item.price > 0);
    }
    throw new Error('Invalid CryptoCompare response');
  } catch (error) {
    throw new Error(`CryptoCompare fetch failed: ${error.message}`);
  }
}

// Historical data fetching with Binance → CryptoCompare
async function fetchHistoricalData(coinId, coin, stats, config) {
  let usedMock = false;
  let currentPrice = null;

  // Get current price first with enhanced method
  if (coin) {
    const priceResult = await fetchEnhancedPriceData(coin, new Map(), stats, config);
    currentPrice = priceResult.data.price;
    usedMock = priceResult.usedMock;
  }

  const fetchData = async (days, interval) => {
    const symbol = coin?.symbol;
    
    // 1. Try Binance FIRST (best free data!)
    if (symbol && BINANCE_SYMBOL_MAP[symbol]) {
      try {
        let binanceInterval, binanceLimit;
        if (days === 1) {
          binanceInterval = '1m';
          binanceLimit = 720; // 12 hours of minute data
        } else if (days === 7) {
          binanceInterval = '1h';
          binanceLimit = 168; // 7 days of hourly
        } else {
          binanceInterval = '1d';
          binanceLimit = Math.min(days, 365); // Daily data
        }
        
        console.log(`📊 ${symbol}: Trying Binance first (${binanceInterval})...`);
        const data = await fetchBinanceKlines(symbol, binanceInterval, binanceLimit);
        if (data.length > 0) {
          console.log(`✅ ${symbol}: Binance SUCCESS - ${data.length} data points`);
          currentPrice = currentPrice || data[data.length - 1].price;
          return data;
        }
      } catch (binanceError) {
        // Log all Binance errors to show attempts
        console.log(`⚠️ ${symbol}: Binance failed - ${binanceError.message}`);
      }
    }

    // 2. Fallback to CryptoCompare (with API key)
    if (symbol) {
      try {
        let limit, aggregate;
        if (days === 1) {
          limit = 720;
          aggregate = 1; // Minute data
        } else if (days === 7) {
          limit = 168;
          aggregate = 1; // Hourly
        } else {
          limit = days;
          aggregate = 24; // Daily
        }
        
        console.log(`📊 ${symbol}: Fetching ${days}d data from CryptoCompare...`);
        const data = await fetchCryptoCompare(symbol, limit, aggregate);
        if (data.length > 0) {
          console.log(`✅ ${symbol}: CryptoCompare returned ${data.length} data points`);
          currentPrice = currentPrice || data[data.length - 1].price;
          return data;
        }
      } catch (ccError) {
        console.log(`⚠️ ${symbol}: CryptoCompare failed - ${ccError.message}`);
      }
    }

    // CoinGecko and CoinPaprika removed due to rate limiting issues
    throw new Error('No data source available (Binance and CryptoCompare failed)');
  };

  try {
    const [minuteRaw, hourlyData, dailyData] = await Promise.all([
      fetchData(1, null),
      fetchData(7, 'hourly'),
      fetchData(30, 'daily'),
    ]);
    
    const minuteData = minuteRaw.slice(-720);
    
    // Validate we have real data
    if (minuteData.length === 0 || hourlyData.length === 0 || dailyData.length === 0) {
      throw new Error('No valid price data received');
    }

    return { minuteData, hourlyData, dailyData, usedMock, currentPrice };
  } catch (primaryError) {
    console.log(`⚠️ ${coinId}: Falling back to mock data (${primaryError.message})`);
    usedMock = true;
    const mockData = await generateRealisticMockData(coinId);
    return {
      minuteData: mockData.minuteData,
      hourlyData: mockData.hourlyData,
      dailyData: mockData.dailyData,
      usedMock,
      currentPrice: mockData.currentPrice,
    };
  }
}

/**
 * Fetch 5 years of historical daily data for backtesting
 * Priority: Binance → CryptoCompare
 * @param {Object} coin - Coin object with symbol, name, id
 * @returns {Promise<Array>} Array of price data points
 */
async function fetchLongTermHistoricalData(coin) {
  const symbol = coin?.symbol;
  const coinId = coin?.id || coin?.name?.toLowerCase();
  const days = 1825; // 5 years
  
  // 1. Try Binance (best for long-term daily data)
  if (symbol && BINANCE_SYMBOL_MAP[symbol]) {
    try {
      const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
      const scraperApiKey = process.env.SCRAPER_API_KEY || '';
      const allData = [];
      const now = Date.now();
      const fiveYearsAgo = now - (days * 24 * 60 * 60 * 1000);
      
      // Binance max is 1000 candles per request
      // We need multiple requests to get 5 years (1825 days)
      const batches = Math.ceil(days / 1000);
      
      for (let batch = 0; batch < batches; batch++) {
        const batchStart = now - ((batch + 1) * 1000 * 24 * 60 * 60 * 1000);
        const batchEnd = now - (batch * 1000 * 24 * 60 * 60 * 1000);
        
        // Don't go beyond 5 years
        const actualStart = Math.max(batchStart, fiveYearsAgo);
        
        try {
          let url = 'https://api.binance.com/api/v3/klines';
          let params = {
            symbol: binanceSymbol,
            interval: '1d',
            limit: 1000,
            endTime: batchEnd,
            startTime: actualStart
          };
          
          if (scraperApiKey) {
            url = `http://api.scraperapi.com`;
            params = {
              api_key: scraperApiKey,
              url: `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&limit=1000&endTime=${batchEnd}&startTime=${actualStart}`
            };
          }
          
          const response = await axios.get(url, { params, timeout: 15000 });
          const data = scraperApiKey ? response.data : response.data;
          
          if (data && Array.isArray(data) && data.length > 0) {
            const batchData = data.map(([openTime, open, high, low, close]) => ({
              timestamp: new Date(openTime),
              price: parseFloat(close),
            })).filter(item => Number.isFinite(item.price) && item.price > 0);
            
            allData.push(...batchData);
            
            // If we got less than 1000, we've reached the end
            if (data.length < 1000) break;
          }
          
          // Small delay between requests to avoid rate limits
          if (batch < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (batchError) {
          // Continue with what we have
          if (batch === 0) throw batchError; // If first batch fails, throw error
          break; // Otherwise, use what we have
        }
      }
      
      // Sort by timestamp (oldest first)
      allData.sort((a, b) => a.timestamp - b.timestamp);
      
      if (allData.length >= 365) { // At least 1 year
        console.log(`✅ ${symbol}: Binance long-term data - ${allData.length} days (${(allData.length / 365).toFixed(1)} years)`);
        return allData;
      }
    } catch (error) {
      if (!error.message.includes('geo-blocked')) {
        console.log(`⚠️ ${symbol}: Binance long-term failed - ${error.message}`);
      }
    }
  }

  // 2. Try CryptoCompare (excellent for long-term data with API key)
  if (symbol && process.env.CRYPTOCOMPARE_API_KEY) {
    try {
      // CryptoCompare can get daily data for long periods
      // For 5 years, we'll request daily data (aggregate=24 means daily)
      const limit = Math.min(days, 2000); // CryptoCompare limit
      const response = await axios.get('https://min-api.cryptocompare.com/data/v2/histoday', {
        params: { 
          fsym: symbol, 
          tsym: 'USD', 
          limit: limit,
          toTs: Math.floor(Date.now() / 1000) // Current timestamp
        },
        headers: { authorization: `Apikey ${process.env.CRYPTOCOMPARE_API_KEY}` },
        timeout: 15000,
      });

      if (response.data && response.data.Data && Array.isArray(response.data.Data.Data)) {
        const data = response.data.Data.Data.map(item => ({
          timestamp: new Date(item.time * 1000),
          price: item.close,
        })).filter(item => Number.isFinite(item.price) && item.price > 0);
        
        if (data.length >= 365) {
          console.log(`✅ ${symbol}: CryptoCompare long-term data - ${data.length} days`);
          return data;
        }
      }
    } catch (error) {
      console.log(`⚠️ ${symbol}: CryptoCompare long-term failed - ${error.message}`);
    }
  }

  // CoinGecko removed due to rate limiting issues

  // Fallback: Return empty array (backtest will handle gracefully)
  console.log(`⚠️ ${symbol}: Could not fetch 5 years of data, will use available data`);
  return [];
}

// Fetch coin news
async function fetchCoinNews(symbol, name, newsCache, config) {
  if (!config.NEWS_ENABLED) return [];
  const cacheKey = `${symbol}`.toUpperCase();
  const cached = newsCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < 15 * 60 * 1000) {
    return cached.items;
  }
  try {
    const response = await axios.get('https://cryptopanic.com/api/v1/posts/', {
      params: {
        auth_token: config.CRYPTOPANIC_API_KEY,
        public: true,
        currencies: symbol ? symbol.toUpperCase() : undefined,
      },
      timeout: 10000,
    });
    if (response.data && Array.isArray(response.data.results)) {
      const items = response.data.results
        .filter((article) => article.title && article.url)
        .slice(0, 3)
        .map((article) => ({
          title: article.title,
          description: article.summary || article.body || '',
          url: article.url,
          publishedAt: article.published_at || article.created_at,
          source: article.source?.title || article.source?.domain || 'CryptoPanic',
        }));
      newsCache.set(cacheKey, { items, timestamp: now });
      return items;
    }
  } catch (error) {
    console.log(`⚠️ News fetch failed for ${symbol}:`, error.message);
  }
  return [];
}

// Fear & Greed Index
async function ensureGreedFearIndex(greedFearIndex) {
  const now = Date.now();
  if (greedFearIndex.timestamp && now - greedFearIndex.timestamp < 15 * 60 * 1000) {
    return greedFearIndex;
  }
  try {
    const response = await axios.get('https://api.alternative.me/fng/', {
      params: { limit: 1, format: 'json' },
      timeout: 10000,
    });
    if (response.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      const entry = response.data.data[0];
      greedFearIndex = {
        value: Number(entry.value),
        classification: entry.value_classification,
        timestamp: new Date(Number(entry.timestamp) * 1000),
      };
    }
  } catch (error) {
    console.log('⚠️ Failed to fetch fear & greed index:', error.message);
  }
  return greedFearIndex;
}

// Mock data generators
async function generateMockPriceData(coin) {
  const basePrice = 100 + Math.random() * 1000;
  const change24h = (Math.random() - 0.5) * 20;
  
  return {
    price: basePrice,
    market_cap: basePrice * (1000000 + Math.random() * 9000000),
    volume_24h: basePrice * (100000 + Math.random() * 900000),
    change_24h: change24h,
    source: 'mock'
  };
}

async function generateRealisticMockData(coinId) {
  try {
    // CoinGecko removed - use default base price
    let basePrice = 100;

    const daily = [];
    const hourly = [];
    const minute = [];

    const now = new Date();

    const generate = (points, granularityMinutes, list) => {
      let previousPrice = basePrice;
      for (let i = points - 1; i >= 0; i -= 1) {
        const timestamp = new Date(now);
        timestamp.setMinutes(timestamp.getMinutes() - i * granularityMinutes);
        const volatility = 0.01 + Math.random() * 0.03;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const price = Math.max(previousPrice * (1 + change), 0.0001);
        list.push({ timestamp, price });
        previousPrice = price;
      }
    };

    generate(7, 24 * 60, daily);
    generate(24, 60, hourly);

    const generateMinute = (points, list) => {
      let previousPrice = basePrice;
      for (let i = points - 1; i >= 0; i -= 1) {
        const timestamp = new Date(now);
        timestamp.setMinutes(timestamp.getMinutes() - i);
        const volatility = 0.005 + Math.random() * 0.015;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const price = Math.max(previousPrice * (1 + change), 0.0001);
        list.push({ timestamp, price });
        previousPrice = price;
      }
    };

    generateMinute(720, minute);

    return { 
      minuteData: minute, 
      hourlyData: hourly, 
      dailyData: daily, 
      currentPrice: basePrice 
    };
  } catch (mockError) {
    return generateBasicMockData();
  }
}

function generateBasicMockData() {
  const now = new Date();
  const basePrice = 100 + Math.random() * 1000;

  const daily = [];
  const hourly = [];
  const minute = [];

  const generate = (points, granularityMinutes, list) => {
    let previousPrice = basePrice;
    for (let i = points - 1; i >= 0; i -= 1) {
      const timestamp = new Date(now);
      timestamp.setMinutes(timestamp.getMinutes() - i * granularityMinutes);
      const volatility = 0.05;
      const change = (Math.random() - 0.5) * 2 * volatility;
      const price = Math.max(previousPrice * (1 + change), 0.0001);
      list.push({ timestamp, price });
      previousPrice = price;
    }
  };

  generate(7, 24 * 60, daily);
  generate(24, 60, hourly);

  const generateMinute = (points) => {
    let previousPrice = basePrice;
    for (let i = points - 1; i >= 0; i -= 1) {
      const timestamp = new Date(now);
      timestamp.setMinutes(timestamp.getMinutes() - i);
      const volatility = 0.008;
      const change = (Math.random() - 0.5) * 2 * volatility;
      const price = Math.max(previousPrice * (1 + change), 0.0001);
      minute.push({ timestamp, price });
      previousPrice = price;
    }
  };

  generateMinute(720);

  return { 
    minuteData: minute, 
    hourlyData: hourly, 
    dailyData: daily, 
    currentPrice: basePrice 
  };
}

module.exports = {
  fetchGlobalMetrics,
  fetchEnhancedPriceData,
  fetchHistoricalData,
  fetchLongTermHistoricalData,
  fetchCoinNews,
  ensureGreedFearIndex,
  generateMockPriceData,
  generateRealisticMockData
};
