/**
 * MEXC Data Service
 * Fetches historical candlestick data from MEXC exchange
 * MEXC supports up to 2000 candles for futures (1000 for spot)
 */

const axios = require('axios');

const MEXC_BASE_URL = 'https://api.mexc.com';

/**
 * Normalize interval format for MEXC API compatibility
 * MEXC requires specific interval formats:
 * - Weekly: 1W (uppercase)
 * - Daily: 1d (lowercase)
 * - Minutes: 1m, 5m, 15m, 30m (lowercase)
 * - Hours: 4h, 8h (lowercase, limited options)
 * @param {string} interval - User-friendly interval (e.g., '1w', '1d', '1h')
 * @returns {string} MEXC-compatible interval
 */
function normalizeMexcInterval(interval) {
    const intervalMap = {
        // Weekly - must be uppercase
        '1w': '1W',
        '1week': '1W',

        // Daily - lowercase
        '1d': '1d',
        '1day': '1d',

        // Hours - only specific values supported
        '1h': '4h',  // MEXC doesn't support 1h, use 4h instead
        '2h': '4h',  // MEXC doesn't support 2h, use 4h instead
        '4h': '4h',
        '6h': '8h',  // MEXC doesn't support 6h, use 8h instead
        '8h': '8h',
        '12h': '8h', // MEXC doesn't support 12h, use 8h instead

        // Minutes - lowercase
        '1m': '1m',
        '5m': '5m',
        '15m': '15m',
        '30m': '30m'
    };

    const normalized = intervalMap[interval.toLowerCase()] || interval;

    if (normalized !== interval) {
        console.log(`📊 Normalized interval: ${interval} → ${normalized}`);
    }

    return normalized;
}

/**
 * Fetch historical candles from MEXC
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval ('1d', '1w', '1h', etc.)
 * @param {number} limit - Number of candles (max 1000 for spot, 2000 for futures)
 * @returns {Promise<Array>} Array of normalized candles
 */
async function fetchMexcCandles(symbol, interval = '1d', limit = 1000) {
    try {
        // Normalize interval to MEXC-compatible format
        const normalizedInterval = normalizeMexcInterval(interval);

        // MEXC Spot API endpoint
        const endpoint = '/api/v3/klines';
        const url = `${MEXC_BASE_URL}${endpoint}`;

        console.log(`📊 Fetching ${limit} ${normalizedInterval} candles for ${symbol} from MEXC...`);

        const response = await axios.get(url, {
            params: {
                symbol: symbol,
                interval: normalizedInterval,
                limit: Math.min(limit, 1000) // MEXC spot max is 1000
            },
            timeout: 15000
        });

        if (response.data && Array.isArray(response.data)) {
            const normalized = normalizeMexcCandles(response.data);
            console.log(`✅ Fetched ${normalized.length} candles from MEXC`);
            return normalized;
        }

        console.log(`⚠️ No data returned from MEXC`);
        return [];

    } catch (error) {
        console.error(`❌ Error fetching MEXC candles for ${symbol} (${interval}):`, error.message);
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Error: ${JSON.stringify(error.response.data)}`);
        }
        return [];
    }
}

/**
 * Normalize MEXC candle format to standard format
 * MEXC format: [timestamp, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
 * @param {Array} rawCandles - Raw MEXC candle data
 * @returns {Array} Normalized candles
 */
function normalizeMexcCandles(rawCandles) {
    return rawCandles.map(candle => ({
        timestamp: parseInt(candle[0]),
        time: new Date(parseInt(candle[0])),
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
        closeTime: parseInt(candle[6]),
        quoteVolume: parseFloat(candle[7]),
        trades: parseInt(candle[8]),
        takerBuyBaseVolume: parseFloat(candle[9]),
        takerBuyQuoteVolume: parseFloat(candle[10])
    }));
}

/**
 * Fetch multiple batches to get up to 2000 candles
 * Makes multiple requests with different time ranges
 * @param {string} symbol - Trading pair
 * @param {string} interval - Candle interval
 * @param {number} totalCandles - Total candles desired (up to 2000)
 * @returns {Promise<Array>} Combined candles
 */
async function fetchMexcCandlesBatch(symbol, interval, totalCandles = 2000) {
    // Normalize interval first
    const normalizedInterval = normalizeMexcInterval(interval);

    const batchSize = 1000;
    const batches = Math.ceil(totalCandles / batchSize);
    const allCandles = [];

    console.log(`📊 Fetching ${totalCandles} ${normalizedInterval} candles in ${batches} batches...`);

    for (let i = 0; i < batches; i++) {
        const candles = await fetchMexcCandles(symbol, normalizedInterval, batchSize);

        if (candles.length === 0) break;

        allCandles.push(...candles);

        // If we got less than batch size, we've reached the end
        if (candles.length < batchSize) break;

        // Wait between requests to avoid rate limits
        if (i < batches - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    console.log(`✅ Total candles fetched: ${allCandles.length}`);
    return allCandles.slice(-totalCandles); // Return most recent N candles
}

module.exports = {
    fetchMexcCandles,
    fetchMexcCandlesBatch,
    normalizeMexcCandles
};
