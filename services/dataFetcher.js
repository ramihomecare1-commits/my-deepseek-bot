const axios = require('axios');
const config = require('../config/config');

// Fetch global metrics from multiple APIs
async function fetchGlobalMetrics(globalMetrics, stats, coinmarketcapEnabled, coinmarketcapApiKey) {
  const now = Date.now();
  
  // Fetch from CoinPaprika (free, no API key needed)
  try {
    const paprikaResponse = await axios.get('https://api.coinpaprika.com/v1/global', {
      timeout: 10000,
    });
    if (paprikaResponse.data) {
      globalMetrics.coinpaprika = {
        market_cap_usd: paprikaResponse.data.market_cap_usd,
        volume_24h_usd: paprikaResponse.data.volume_24h_usd,
        bitcoin_dominance_percentage: paprikaResponse.data.bitcoin_dominance_percentage,
        cryptocurrencies_number: paprikaResponse.data.cryptocurrencies_number,
        last_updated: paprikaResponse.data.last_updated
      };
      stats.coinpaprikaUsage++;
    }
  } catch (error) {
    console.log('⚠️ CoinPaprika global metrics fetch failed:', error.message);
  }

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
// Priority: CoinMarketCap (authenticated, higher limits) → CoinGecko → CoinPaprika
async function fetchEnhancedPriceData(coin, priceCache, stats, config) {
  let primaryData = null;
  let usedMock = false;

  // Try CoinMarketCap FIRST (if API key available)
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

  // Fallback to CoinGecko
  if (!primaryData) {
    try {
      const priceResponse = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price`,
        {
          params: { 
            ids: coin.id, 
            vs_currencies: 'usd', 
            include_market_cap: true, 
            include_24hr_vol: true, 
            include_24hr_change: true 
          },
          timeout: 10000,
        },
      );
      
      if (priceResponse.data && priceResponse.data[coin.id]) {
        primaryData = {
          price: priceResponse.data[coin.id].usd,
          market_cap: priceResponse.data[coin.id].usd_market_cap,
          volume_24h: priceResponse.data[coin.id].usd_24h_vol,
          change_24h: priceResponse.data[coin.id].usd_24h_change,
          source: 'coingecko'
        };
        priceCache.set(coin.id, { ...primaryData, timestamp: Date.now() });
      }
    } catch (error) {
      console.log(`⚠️ ${coin.symbol}: CoinGecko price fetch failed`);
    }
  }

  // Fallback to CoinPaprika
  if (!primaryData && config.COINPAPRIKA_ENABLED) {
    try {
      const paprikaResponse = await axios.get(
        `https://api.coinpaprika.com/v1/tickers/${coin.coinpaprika_id}`,
        { timeout: 10000 }
      );
      
      if (paprikaResponse.data) {
        primaryData = {
          price: paprikaResponse.data.quotes.USD.price,
          market_cap: paprikaResponse.data.quotes.USD.market_cap,
          volume_24h: paprikaResponse.data.quotes.USD.volume_24h,
          change_24h: paprikaResponse.data.quotes.USD.percent_change_24h,
          source: 'coinpaprika'
        };
        stats.coinpaprikaUsage++;
      }
    } catch (error) {
      console.log(`⚠️ ${coin.symbol}: CoinPaprika price fetch failed`);
    }
  }

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

// Fetch from Binance (FREE, no API key, best data!)
async function fetchBinanceKlines(symbol, interval, limit) {
  try {
    const binanceSymbol = BINANCE_SYMBOL_MAP[symbol];
    if (!binanceSymbol) {
      throw new Error(`Symbol ${symbol} not available on Binance`);
    }

    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: { symbol: binanceSymbol, interval, limit },
      timeout: 10000,
    });

    if (response.data && Array.isArray(response.data)) {
      return response.data.map(([openTime, open, high, low, close]) => ({
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

// Historical data fetching with Binance → CryptoCompare → CoinGecko → CoinPaprika
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
    
    // 1. Try CryptoCompare FIRST (with API key - more reliable for Render)
    if (symbol) {
      try {
        let limit, aggregate;
        if (days === 1) {
          limit = 720;
          aggregate = 1; // Minute data (need histominute endpoint)
        } else if (days === 7) {
          limit = 168;
          aggregate = 1; // Hourly
        } else {
          limit = days;
          aggregate = 24; // Daily (aggregate hours)
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

    // 2. Try Binance (backup - may be blocked in some regions)
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
        
        console.log(`📊 ${symbol}: Trying Binance (${binanceInterval})...`);
        const data = await fetchBinanceKlines(symbol, binanceInterval, binanceLimit);
        if (data.length > 0) {
          console.log(`✅ ${symbol}: Binance returned ${data.length} data points`);
          currentPrice = currentPrice || data[data.length - 1].price;
          return data;
        }
      } catch (binanceError) {
        // Silently skip 451 errors (geo-blocking)
        if (!binanceError.message.includes('451')) {
          console.log(`⚠️ ${symbol}: Binance failed - ${binanceError.message}`);
        }
      }
    }

    // 3. Fallback to CoinGecko
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`,
        {
          params: interval
            ? { vs_currency: 'usd', days, interval }
            : { vs_currency: 'usd', days },
          timeout: 15000,
          headers: { 'User-Agent': 'ProfessionalTradingBot/2.0' },
        },
      );

      if (response.data && Array.isArray(response.data.prices)) {
        const prices = response.data.prices
          .map(([timestamp, price]) => ({
            timestamp: new Date(timestamp),
            price: typeof price === 'number' ? price : Number(price),
          }))
          .filter((item) => Number.isFinite(item.price) && item.price > 0);

        if (prices.length > 0) {
          currentPrice = currentPrice || prices[prices.length - 1].price;
        }
        
        return prices;
      }

      throw new Error('Invalid API response structure');
    } catch (error) {
      // 4. Final fallback to CoinPaprika
      if (coin && config.COINPAPRIKA_ENABLED) {
        try {
          const paprikaResponse = await axios.get(
            `https://api.coinpaprika.com/v1/coins/${coin.coinpaprika_id}/ohlcv/historical`,
            {
              params: {
                start: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                end: new Date().toISOString().split('T')[0],
                limit: days
              },
              timeout: 15000,
            },
          );
          
          if (paprikaResponse.data && Array.isArray(paprikaResponse.data)) {
            const prices = paprikaResponse.data
              .map((item) => ({
                timestamp: new Date(item.time_close),
                price: item.close,
              }))
              .filter((item) => Number.isFinite(item.price) && item.price > 0);

            stats.coinpaprikaUsage++;
            return prices;
          }
        } catch (paprikaError) {
          console.log(`⚠️ ${coinId}: CoinPaprika historical data also failed`);
        }
      }
      throw error;
    }
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
    const currentPriceResponse = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      {
        params: { ids: coinId, vs_currencies: 'usd' },
        timeout: 10000,
      },
    );

    let basePrice = 100;
    if (currentPriceResponse.data && currentPriceResponse.data[coinId]) {
      basePrice = currentPriceResponse.data[coinId].usd;
    }

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
  fetchCoinNews,
  ensureGreedFearIndex,
  generateMockPriceData,
  generateRealisticMockData
};
