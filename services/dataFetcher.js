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
// Priority: MEXC (direct) → Gate.io (direct) → Binance (with scraper) → CoinMarketCap
async function fetchEnhancedPriceData(coin, priceCache, stats, config) {
  let primaryData = null;
  let usedMock = false;

  // Try MEXC FIRST (FREE, no API key, direct API call - no scraper needed!)
  if (!primaryData && coin.symbol && EXCHANGE_SYMBOL_MAP[coin.symbol]) {
    try {
      const mexcData = await fetchMEXCPrice(coin.symbol);
      if (mexcData && mexcData.price) {
      primaryData = {
          price: mexcData.price,
          volume_24h: mexcData.volume_24h,
          change_24h: mexcData.change_24h,
          high_24h: mexcData.high_24h,
          low_24h: mexcData.low_24h,
          source: 'mexc'
      };
      priceCache.set(coin.id, { ...primaryData, timestamp: Date.now() });
        console.log(`✅ ${coin.symbol}: MEXC price: $${primaryData.price.toFixed(2)}`);
    }
  } catch (error) {
      // Silently skip - will try other sources
      console.log(`⚠️ ${coin.symbol}: MEXC price fetch failed - ${error.message}`);
    }
  }

  // Fallback to Gate.io (FREE, no API key, direct API call - no scraper needed!)
  if (!primaryData && coin.symbol && EXCHANGE_SYMBOL_MAP[coin.symbol]) {
    try {
      const gateData = await fetchGateIOPrice(coin.symbol);
      if (gateData && gateData.price) {
        primaryData = {
          price: gateData.price,
          volume_24h: gateData.volume_24h,
          change_24h: gateData.change_24h,
          high_24h: gateData.high_24h,
          low_24h: gateData.low_24h,
          source: 'gateio'
        };
        priceCache.set(coin.id, { ...primaryData, timestamp: Date.now() });
        console.log(`✅ ${coin.symbol}: Gate.io price: $${primaryData.price.toFixed(2)}`);
      }
    } catch (error) {
      // Silently skip - will try other sources
      console.log(`⚠️ ${coin.symbol}: Gate.io price fetch failed - ${error.message}`);
    }
  }

  // Fallback to Binance (with scraper if needed - uses scraper API to bypass geo-blocking)
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
// Symbol mapping for exchanges (all use SYMBOLUSDT format)
const EXCHANGE_SYMBOL_MAP = {
  'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'BNB': 'BNBUSDT', 'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT', 'DOGE': 'DOGEUSDT', 'ADA': 'ADAUSDT', 'AVAX': 'AVAXUSDT',
  'LINK': 'LINKUSDT', 'DOT': 'DOTUSDT', 'MATIC': 'MATICUSDT', 'LTC': 'LTCUSDT',
  'UNI': 'UNIUSDT', 'ATOM': 'ATOMUSDT', 'XLM': 'XLMUSDT', 'ETC': 'ETCUSDT',
  'XMR': 'XMRUSDT', 'ALGO': 'ALGOUSDT', 'FIL': 'FILUSDT', 'ICP': 'ICPUSDT',
  'VET': 'VETUSDT', 'EOS': 'EOSUSDT', 'XTZ': 'XTZUSDT', 'AAVE': 'AAVEUSDT',
  'MKR': 'MKRUSDT', 'GRT': 'GRTUSDT', 'THETA': 'THETAUSDT', 'RUNE': 'RUNEUSDT',
  'NEO': 'NEOUSDT', 'FTM': 'FTMUSDT'
};

// Keep BINANCE_SYMBOL_MAP for backward compatibility
const BINANCE_SYMBOL_MAP = EXCHANGE_SYMBOL_MAP;

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

// Fetch current price from MEXC (FREE, no API key, 2000 klines per request!)
async function fetchMEXCPrice(symbol) {
  try {
    const mexcSymbol = EXCHANGE_SYMBOL_MAP[symbol];
    if (!mexcSymbol) {
      throw new Error(`Symbol ${symbol} not available on MEXC`);
    }

    const response = await axios.get('https://api.mexc.com/api/v3/ticker/24hr', {
      params: { symbol: mexcSymbol },
      timeout: 10000,
    });

    if (response.data && response.data.lastPrice) {
      return {
        price: parseFloat(response.data.lastPrice),
        volume_24h: parseFloat(response.data.volume || 0),
        change_24h: parseFloat(response.data.priceChangePercent || 0),
        high_24h: parseFloat(response.data.highPrice || 0),
        low_24h: parseFloat(response.data.lowPrice || 0),
        source: 'mexc'
      };
    }
    throw new Error('Invalid MEXC ticker response');
  } catch (error) {
    throw new Error(`MEXC price fetch failed: ${error.message}`);
  }
}

// Fetch current price from Gate.io (FREE, no API key, 1000 klines per request!)
async function fetchGateIOPrice(symbol) {
  try {
    const gateSymbol = EXCHANGE_SYMBOL_MAP[symbol];
    if (!gateSymbol) {
      throw new Error(`Symbol ${symbol} not available on Gate.io`);
    }

    // Gate.io uses underscore format: BTC_USDT instead of BTCUSDT
    const gateCurrencyPair = gateSymbol.replace('USDT', '_USDT');

    const response = await axios.get('https://api.gateio.ws/api/v4/spot/tickers', {
      params: { currency_pair: gateCurrencyPair },
      timeout: 10000,
    });

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      const data = response.data[0];
      return {
        price: parseFloat(data.last || 0),
        volume_24h: parseFloat(data.quote_volume || 0),
        change_24h: parseFloat(data.change_percentage || 0),
        high_24h: parseFloat(data.high_24h || 0),
        low_24h: parseFloat(data.low_24h || 0),
        source: 'gateio'
      };
    }
    throw new Error('Invalid Gate.io ticker response');
  } catch (error) {
    throw new Error(`Gate.io price fetch failed: ${error.message}`);
  }
}

// Fetch klines from MEXC (FREE, up to 2000 klines per request!)
async function fetchMEXCKlines(symbol, interval, limit) {
  try {
    const mexcSymbol = EXCHANGE_SYMBOL_MAP[symbol];
    if (!mexcSymbol) {
      throw new Error(`Symbol ${symbol} not available on MEXC`);
    }

    // MEXC interval mapping - MEXC uses: 1m, 5m, 15m, 30m, 1H (capital H), 4H, 1D, 1W, 1M
    // Map intervals: if 1m requested, use 5m (more reliable), otherwise convert to MEXC format
    let mexcInterval = interval;
    if (interval === '1m') {
      mexcInterval = '5m'; // Use 5m instead of 1m (more reliable, less likely to hit limits)
    } else if (interval === '1h') {
      mexcInterval = '1H'; // MEXC uses capital H for hourly
    } else if (interval === '1d') {
      mexcInterval = '1D'; // MEXC uses capital D for daily
    }
    
    let mexcLimit = Math.min(limit, 2000);
    
    // Adjust limit based on interval
    if (mexcInterval === '5m') {
      // For 5m, max reasonable is ~288 (24 hours)
      mexcLimit = Math.min(mexcLimit, 288);
    } else if (mexcInterval === '1H') {
      // For 1H, max is 2000 (but we typically use less)
      mexcLimit = Math.min(mexcLimit, 2000);
    } else if (mexcInterval === '1D') {
      // For 1D, max is 2000
      mexcLimit = Math.min(mexcLimit, 2000);
    }
    
    const response = await axios.get('https://api.mexc.com/api/v3/klines', {
      params: { symbol: mexcSymbol, interval: mexcInterval, limit: mexcLimit },
      timeout: 15000,
    });

    if (response.data && Array.isArray(response.data)) {
      return response.data.map(([openTime, open, high, low, close]) => ({
        timestamp: new Date(openTime),
        price: parseFloat(close),
      })).filter(item => Number.isFinite(item.price) && item.price > 0);
    }
    throw new Error('Invalid MEXC response');
  } catch (error) {
    // Provide more detailed error info
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const errorData = error.response.data;
      throw new Error(`MEXC fetch failed: ${status} ${statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ''}`);
    }
    throw new Error(`MEXC fetch failed: ${error.message}`);
  }
}

// Fetch klines from Gate.io (FREE, up to 1000 klines per request!)
async function fetchGateIOKlines(symbol, interval, limit) {
  try {
    const gateSymbol = EXCHANGE_SYMBOL_MAP[symbol];
    if (!gateSymbol) {
      throw new Error(`Symbol ${symbol} not available on Gate.io`);
    }

    // Gate.io interval mapping - Gate.io uses: 10s, 1m, 5m, 15m, 30m, 1h, 4h, 8h, 1d, 7d
    // Map our intervals to Gate.io format
    let gateInterval = interval; // Use interval as-is (supports 5m, 1h, 1d)
    if (interval === '1m') {
      gateInterval = '5m'; // Use 5m instead of 1m (more reliable)
    } else if (interval === '1h') {
      gateInterval = '1h';
    } else if (interval === '1d') {
      gateInterval = '1d';
    }
    
    let gateLimit = Math.min(limit, 1000);
    
    // Adjust limit based on interval
    if (gateInterval === '5m') {
      // For 5m, max reasonable is ~288 (24 hours)
      gateLimit = Math.min(gateLimit, 288);
    } else if (gateInterval === '1h') {
      // For 1h, max is 1000
      gateLimit = Math.min(gateLimit, 1000);
    } else if (gateInterval === '1d') {
      // For 1d, max is 1000
      gateLimit = Math.min(gateLimit, 1000);
    }
    
    // Gate.io uses underscore format: BTC_USDT instead of BTCUSDT
    const gateCurrencyPair = gateSymbol.replace('USDT', '_USDT');

    const response = await axios.get('https://api.gateio.ws/api/v4/spot/candlesticks', {
      params: { 
        currency_pair: gateCurrencyPair, 
        interval: gateInterval, 
        limit: gateLimit 
      },
      timeout: 15000,
    });

    if (response.data && Array.isArray(response.data)) {
      // Gate.io returns: [timestamp, volume, close, high, low, open]
      return response.data.map(([timestamp, volume, close, high, low, open]) => ({
        timestamp: new Date(parseInt(timestamp) * 1000),
        price: parseFloat(close),
      })).filter(item => Number.isFinite(item.price) && item.price > 0);
    }
    throw new Error('Invalid Gate.io response');
  } catch (error) {
    // Provide more detailed error info
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const errorData = error.response.data;
      throw new Error(`Gate.io fetch failed: ${status} ${statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ''}`);
    }
    throw new Error(`Gate.io fetch failed: ${error.message}`);
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

// Historical data fetching with MEXC (direct) → Gate.io (direct) → Binance (with scraper) → CryptoCompare
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
    
    // 1. Try MEXC FIRST (FREE, direct API, 2000 klines per request, no scraper needed!)
    if (symbol && EXCHANGE_SYMBOL_MAP[symbol]) {
      try {
        let mexcInterval, mexcLimit;
        if (days === 1) {
          // Use 5m interval (MEXC will map 1m to 5m internally for better reliability)
          mexcInterval = '1m'; // Will be converted to 5m in fetchMEXCKlines
          mexcLimit = 288; // 24 hours of 5-minute data (24 * 60 / 5 = 288)
        } else if (days === 7) {
          mexcInterval = '1h';
          mexcLimit = 168; // 7 days of hourly
        } else {
          mexcInterval = '1d';
          mexcLimit = Math.min(days, 2000); // MEXC supports up to 2000 klines!
        }
        
        console.log(`📊 ${symbol}: Trying MEXC first (${mexcInterval}, direct API, limit: ${mexcLimit})...`);
        const data = await fetchMEXCKlines(symbol, mexcInterval, mexcLimit);
        if (data.length > 0) {
          console.log(`✅ ${symbol}: MEXC SUCCESS - ${data.length} data points`);
          currentPrice = currentPrice || data[data.length - 1].price;
          return data;
        }
      } catch (mexcError) {
        console.log(`⚠️ ${symbol}: MEXC failed - ${mexcError.message}`);
      }
    }

    // 2. Fallback to Gate.io (FREE, direct API, 1000 klines per request, no scraper needed!)
    if (symbol && EXCHANGE_SYMBOL_MAP[symbol]) {
      try {
        let gateInterval, gateLimit;
        if (days === 1) {
          // Use 5m interval (Gate.io will map 1m to 5m internally for better reliability)
          gateInterval = '1m'; // Will be converted to 5m in fetchGateIOKlines
          gateLimit = 288; // 24 hours of 5-minute data (24 * 60 / 5 = 288)
        } else if (days === 7) {
          gateInterval = '1h';
          gateLimit = 168; // 7 days of hourly
        } else {
          gateInterval = '1d';
          gateLimit = Math.min(days, 1000); // Gate.io supports up to 1000 klines
        }
        
        console.log(`📊 ${symbol}: Trying Gate.io (${gateInterval}, direct API, limit: ${gateLimit})...`);
        try {
          const data = await fetchGateIOKlines(symbol, gateInterval, gateLimit);
          if (data.length > 0) {
            console.log(`✅ ${symbol}: Gate.io SUCCESS - ${data.length} data points`);
            currentPrice = currentPrice || data[data.length - 1].price;
            return data;
          }
        } catch (gateError) {
          // If 5m fails for 1 day, try 1h as fallback
          if (days === 1 && gateInterval === '1m') {
            console.log(`📊 ${symbol}: Gate.io 5m failed, trying 1h interval...`);
            try {
              const data = await fetchGateIOKlines(symbol, '1h', 24); // 24 hours of hourly data
              if (data.length > 0) {
                console.log(`✅ ${symbol}: Gate.io SUCCESS (1h fallback) - ${data.length} data points`);
                currentPrice = currentPrice || data[data.length - 1].price;
                return data;
              }
            } catch (fallbackError) {
              console.log(`⚠️ ${symbol}: Gate.io failed - ${gateError.message} (fallback also failed: ${fallbackError.message})`);
            }
          } else {
            throw gateError; // Re-throw if not a 1-day/1m case
          }
        }
      } catch (gateError) {
        console.log(`⚠️ ${symbol}: Gate.io failed - ${gateError.message}`);
      }
    }

    // 3. Fallback to Binance (with scraper if needed - uses scraper API to bypass geo-blocking)
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
        
        console.log(`📊 ${symbol}: Trying Binance (${binanceInterval}, with scraper if needed)...`);
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

    // 4. Fallback to CryptoCompare (with API key)
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
    throw new Error('No data source available (Binance, MEXC, Gate.io, and CryptoCompare failed)');
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
 * Priority: MEXC (direct) → Gate.io (direct) → Binance (with scraper) → CryptoCompare
 * @param {Object} coin - Coin object with symbol, name, id
 * @returns {Promise<Array>} Array of price data points
 */
async function fetchLongTermHistoricalData(coin) {
  const symbol = coin?.symbol;
  const coinId = coin?.id || coin?.name?.toLowerCase();
  const days = 1825; // 5 years
  
  // 1. Try MEXC FIRST (excellent for long-term - 2000 klines per request = only 1 request for 5 years, direct API!)
  if (symbol && EXCHANGE_SYMBOL_MAP[symbol]) {
    try {
      console.log(`📊 ${symbol}: Fetching 5 years from MEXC (single request, direct API)...`);
      const data = await fetchMEXCKlines(symbol, '1d', 2000); // MEXC supports up to 2000!
      
      if (data.length >= 365) { // At least 1 year
        console.log(`✅ ${symbol}: MEXC long-term data - ${data.length} days (${(data.length / 365).toFixed(1)} years)`);
        return data;
      }
    } catch (error) {
      console.log(`⚠️ ${symbol}: MEXC long-term failed - ${error.message}`);
    }
  }

  // 2. Try Gate.io (good for long-term - 1000 klines per request = 2 requests for 5 years, direct API!)
  if (symbol && EXCHANGE_SYMBOL_MAP[symbol]) {
    try {
      console.log(`📊 ${symbol}: Fetching 5 years from Gate.io (2 requests, direct API)...`);
      const allData = [];
      const now = Date.now();
      const fiveYearsAgo = now - (days * 24 * 60 * 60 * 1000);
      
      // Gate.io max is 1000 candles per request
      // We need 2 requests to get 5 years (1825 days)
      for (let batch = 0; batch < 2; batch++) {
        const batchEnd = now - (batch * 1000 * 24 * 60 * 60 * 1000);
        const batchStart = Math.max(batchEnd - (1000 * 24 * 60 * 60 * 1000), fiveYearsAgo);
        
        try {
          // Gate.io uses underscore format: BTC_USDT instead of BTCUSDT
          const gateCurrencyPair = EXCHANGE_SYMBOL_MAP[symbol].replace('USDT', '_USDT');
          
          const response = await axios.get('https://api.gateio.ws/api/v4/spot/candlesticks', {
            params: {
              currency_pair: gateCurrencyPair,
              interval: '1d',
              limit: 1000,
              to: Math.floor(batchEnd / 1000),
              from: Math.floor(batchStart / 1000)
            },
            timeout: 15000,
          });
          
          if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            const batchData = response.data.map(([timestamp, volume, close]) => ({
              timestamp: new Date(parseInt(timestamp) * 1000),
              price: parseFloat(close),
            })).filter(item => Number.isFinite(item.price) && item.price > 0);
            
            allData.push(...batchData);
            
            // If we got less than 1000, we've reached the end
            if (response.data.length < 1000) break;
          }
          
          // Small delay between requests
          if (batch < 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (batchError) {
          if (batch === 0) throw batchError; // If first batch fails, throw error
          break; // Otherwise, use what we have
        }
      }
      
      // Sort by timestamp (oldest first)
      allData.sort((a, b) => a.timestamp - b.timestamp);
      
      if (allData.length >= 365) { // At least 1 year
        console.log(`✅ ${symbol}: Gate.io long-term data - ${allData.length} days (${(allData.length / 365).toFixed(1)} years)`);
        return allData;
      }
    } catch (error) {
      console.log(`⚠️ ${symbol}: Gate.io long-term failed - ${error.message}`);
    }
  }

  // 3. Fallback to Binance (with scraper if needed - uses scraper API to bypass geo-blocking)
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


  // 4. Try CryptoCompare (excellent for long-term data with API key)
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
