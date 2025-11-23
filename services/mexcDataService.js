/**
 * MEXC Data Service
 * Fetches historical candlestick data from MEXC exchange
 * MEXC supports up to 2000 candles for futures (1000 for spot)
 */

const axios = require('axios');

const MEXC_BASE_URL = 'https://api.mexc.com';

/**
 * Fetch historical candles from MEXC
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval ('1d', '1w', '1h', etc.)
 * @param {number} limit - Number of candles (max 1000 for spot, 2000 for futures)
 * @returns {Promise<Array>} Array of normalized candles
 */
async function fetchMexcCandles(symbol, interval = '1d', limit = 1000) {
    try {
        // MEXC Spot API endpoint
        const endpoint = '/api/v3/klines';
        const url = `${MEXC_BASE_URL}${endpoint}`;

        console.log(`📊 Fetching ${limit} ${interval} candles for ${symbol} from MEXC...`);

        const response = await axios.get(url, {
            params: {
                symbol: symbol,
                interval: interval,
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
        console.error(`❌ Error fetching MEXC candles: ${error.message}`);
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
    const batchSize = 1000;
    const batches = Math.ceil(totalCandles / batchSize);
    const allCandles = [];

    console.log(`📊 Fetching ${totalCandles} candles in ${batches} batches...`);

    for (let i = 0; i < batches; i++) {
        const candles = await fetchMexcCandles(symbol, interval, batchSize);

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
