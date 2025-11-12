//
// -----------------------------------------------------------------------------
// |                     PROFESSIONAL TRADING BOT - SINGLE FILE                  |
// -----------------------------------------------------------------------------
//
// This file combines all the modular components into a single, deployable script.
//
// INSTRUCTIONS:
// 1. Save this file as `server.js` (or any name you prefer).
// 2. Make sure you have `package.json` and `.env` files in the same directory.
// 3. Run `npm install` to get the required packages.
// 4. Run `node server.js` to start the bot and the API server.
//

// -----------------------------------------------------------------------------
// | SECTION 1: EXTERNAL DEPENDENCIES
// -----------------------------------------------------------------------------
const express = require('express');
const axios = require('axios');
require('dotenv').config();

// -----------------------------------------------------------------------------
// | SECTION 2: CONFIGURATION (from /src/config/index.js)
// -----------------------------------------------------------------------------
const config = {
    port: process.env.PORT || 10000,
    apiDelay: Number(process.env.API_DELAY_MS || 1000),
    scanIntervals: {
        '10m': 10 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000,
    },
    notificationCooldownMs: 30 * 60 * 1000,
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    },
};


// -----------------------------------------------------------------------------
// | SECTION 3: CONSTANTS (from /src/constants/coins.js)
// -----------------------------------------------------------------------------
const getTop100Coins = () => [
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
  { symbol: 'XMR', name: 'Monero', id: 'monero', coinmarketcap_id: '328', coinpaprika_id: 'xmr-monero' },
  { symbol: 'ETC', name: 'Ethereum Classic', id: 'ethereum-classic', coinmarketcap_id: '1321', coinpaprika_id: 'etc-ethereum-classic' },
  { symbol: 'ALGO', name: 'Algorand', id: 'algorand', coinmarketcap_id: '4030', coinpaprika_id: 'algo-algorand' },
  { symbol: 'VET', name: 'VeChain', id: 'vechain', coinmarketcap_id: '3077', coinpaprika_id: 'vet-vechain' },
  { symbol: 'FIL', name: 'Filecoin', id: 'filecoin', coinmarketcap_id: '2280', coinpaprika_id: 'fil-filecoin' },
  { symbol: 'APT', name: 'Aptos', id: 'aptos', coinmarketcap_id: '21794', coinpaprika_id: 'apt-aptos' },
  { symbol: 'HBAR', name: 'Hedera', id: 'hedera-hashgraph', coinmarketcap_id: '4642', coinpaprika_id: 'hbar-hedera-hashgraph' },
  { symbol: 'NEAR', name: 'NEAR Protocol', id: 'near', coinmarketcap_id: '6535', coinpaprika_id: 'near-near-protocol' },
  { symbol: 'ICP', name: 'Internet Computer', id: 'internet-computer', coinmarketcap_id: '8916', coinpaprika_id: 'icp-internet-computer' },
  { symbol: 'ARB', name: 'Arbitrum', id: 'arbitrum', coinmarketcap_id: '11841', coinpaprika_id: 'arb-arbitrum' },
  { symbol: 'OP', name: 'Optimism', id: 'optimism', coinmarketcap_id: '11840', coinpaprika_id: 'op-optimism' },
  { symbol: 'INJ', name: 'Injective', id: 'injective-protocol', coinmarketcap_id: '7226', coinpaprika_id: 'inj-injective-protocol' },
  { symbol: 'STX', name: 'Stacks', id: 'blockstack', coinmarketcap_id: '4847', coinpaprika_id: 'stx-stacks' },
  { symbol: 'IMX', name: 'Immutable X', id: 'immutable-x', coinmarketcap_id: '10603', coinpaprika_id: 'imx-immutable-x' },
  { symbol: 'GRT', name: 'The Graph', id: 'the-graph', coinmarketcap_id: '6719', coinpaprika_id: 'grt-the-graph' },
  { symbol: 'AAVE', name: 'Aave', id: 'aave', coinmarketcap_id: '7278', coinpaprika_id: 'aave-aave' },
  { symbol: 'MKR', name: 'Maker', id: 'maker', coinmarketcap_id: '1518', coinpaprika_id: 'mkr-maker' },
  { symbol: 'SNX', name: 'Synthetix', id: 'synthetix-network-token', coinmarketcap_id: '2586', coinpaprika_id: 'snx-synthetix-network-token' },
  { symbol: 'RUNE', name: 'THORChain', id: 'thorchain', coinmarketcap_id: '4157', coinpaprika_id: 'rune-thorchain' },
  { symbol: 'FTM', name: 'Fantom', id: 'fantom', coinmarketcap_id: '3513', coinpaprika_id: 'ftm-fantom' },
  { symbol: 'SAND', name: 'The Sandbox', id: 'the-sandbox', coinmarketcap_id: '6210', coinpaprika_id: 'sand-the-sandbox' },
  { symbol: 'MANA', name: 'Decentraland', id: 'decentraland', coinmarketcap_id: '1966', coinpaprika_id: 'mana-decentraland' },
  { symbol: 'AXS', name: 'Axie Infinity', id: 'axie-infinity', coinmarketcap_id: '6783', coinpaprika_id: 'axs-axie-infinity' },
  { symbol: 'GALA', name: 'Gala', id: 'gala', coinmarketcap_id: '7080', coinpaprika_id: 'gala-gala' },
  { symbol: 'FLOW', name: 'Flow', id: 'flow', coinmarketcap_id: '4558', coinpaprika_id: 'flow-flow' },
  { symbol: 'CHZ', name: 'Chiliz', id: 'chiliz', coinmarketcap_id: '4066', coinpaprika_id: 'chz-chiliz' },
  { symbol: 'ENJ', name: 'Enjin Coin', id: 'enjincoin', coinmarketcap_id: '2130', coinpaprika_id: 'enj-enjin-coin' },
  { symbol: 'ZEC', name: 'Zcash', id: 'zcash', coinmarketcap_id: '1437', coinpaprika_id: 'zec-zcash' },
  { symbol: 'DASH', name: 'Dash', id: 'dash', coinmarketcap_id: '131', coinpaprika_id: 'dash-dash' },
  { symbol: 'EOS', name: 'EOS', id: 'eos', coinmarketcap_id: '1765', coinpaprika_id: 'eos-eos' },
  { symbol: 'XTZ', name: 'Tezos', id: 'tezos', coinmarketcap_id: '2011', coinpaprika_id: 'xtz-tezos' },
  { symbol: 'THETA', name: 'Theta Network', id: 'theta-token', coinmarketcap_id: '2416', coinpaprika_id: 'theta-theta-token' },
  { symbol: 'ZIL', name: 'Zilliqa', id: 'zilliqa', coinmarketcap_id: '2469', coinpaprika_id: 'zil-zilliqa' },
  { symbol: 'BAT', name: 'Basic Attention Token', id: 'basic-attention-token', coinmarketcap_id: '1697', coinpaprika_id: 'bat-basic-attention-token' },
  { symbol: 'COMP', name: 'Compound', id: 'compound-governance-token', coinmarketcap_id: '5692', coinpaprika_id: 'comp-compound' },
  { symbol: 'YFI', name: 'yearn.finance', id: 'yearn-finance', coinmarketcap_id: '5864', coinpaprika_id: 'yfi-yearn-finance' },
  { symbol: 'SUSHI', name: 'SushiSwap', id: 'sushi', coinmarketcap_id: '6758', coinpaprika_id: 'sushi-sushiswap' },
  { symbol: 'CRV', name: 'Curve DAO Token', id: 'curve-dao-token', coinmarketcap_id: '6538', coinpaprika_id: 'crv-curve-dao-token' },
  { symbol: '1INCH', name: '1inch', id: '1inch', coinmarketcap_id: '8104', coinpaprika_id: '1inch-1inch' },
  { symbol: 'LRC', name: 'Loopring', id: 'loopring', coinmarketcap_id: '1934', coinpaprika_id: 'lrc-loopring' },
  { symbol: 'ZRX', name: '0x', id: '0x', coinmarketcap_id: '1896', coinpaprika_id: 'zrx-0x' },
  { symbol: 'WAVES', name: 'Waves', id: 'waves', coinmarketcap_id: '1274', coinpaprika_id: 'waves-waves' },
  { symbol: 'ICX', name: 'ICON', id: 'icon', coinmarketcap_id: '2099', coinpaprika_id: 'icx-icon' },
  { symbol: 'ONT', name: 'Ontology', id: 'ontology', coinmarketcap_id: '2566', coinpaprika_id: 'ont-ontology' },
  { symbol: 'QTUM', name: 'Qtum', id: 'qtum', coinmarketcap_id: '1684', coinpaprika_id: 'qtum-qtum' },
  { symbol: 'RVN', name: 'Ravencoin', id: 'ravencoin', coinmarketcap_id: '2577', coinpaprika_id: 'rvn-ravencoin' },
  { symbol: 'DCR', name: 'Decred', id: 'decred', coinmarketcap_id: '1168', coinpaprika_id: 'dcr-decred' },
  { symbol: 'SC', name: 'Siacoin', id: 'siacoin', coinmarketcap_id: '1042', coinpaprika_id: 'sc-siacoin' },
  { symbol: 'DGB', name: 'DigiByte', id: 'digibyte', coinmarketcap_id: '109', coinpaprika_id: 'dgb-digibyte' },
  { symbol: 'HIVE', name: 'Hive', id: 'hive', coinmarketcap_id: '5370', coinpaprika_id: 'hive-hive' },
  { symbol: 'STEEM', name: 'Steem', id: 'steem', coinmarketcap_id: '1230', coinpaprika_id: 'steem-steem' },
  { symbol: 'LSK', name: 'Lisk', id: 'lisk', coinmarketcap_id: '1214', coinpaprika_id: 'lsk-lisk' },
  { symbol: 'NEM', name: 'NEM', id: 'nem', coinmarketcap_id: '873', coinpaprika_id: 'xem-nem' },
  { symbol: 'XEM', name: 'Symbol', id: 'symbol', coinmarketcap_id: '8677', coinpaprika_id: 'xym-symbol' },
  { symbol: 'BTS', name: 'BitShares', id: 'bitshares', coinmarketcap_id: '463', coinpaprika_id: 'bts-bitshares' },
  { symbol: 'IOTA', name: 'IOTA', id: 'iota', coinmarketcap_id: '1720', coinpaprika_id: 'miota-iota' },
  { symbol: 'NEO', name: 'Neo', id: 'neo', coinmarketcap_id: '1376', coinpaprika_id: 'neo-neo' },
  { symbol: 'KSM', name: 'Kusama', id: 'kusama', coinmarketcap_id: '5034', coinpaprika_id: 'ksm-kusama' },
  { symbol: 'CELO', name: 'Celo', id: 'celo', coinmarketcap_id: '5567', coinpaprika_id: 'celo-celo' },
  { symbol: 'AR', name: 'Arweave', id: 'arweave', coinmarketcap_id: '5632', coinpaprika_id: 'ar-arweave' },
  { symbol: 'EGLD', name: 'MultiversX', id: 'elrond-erd-2', coinmarketcap_id: '6892', coinpaprika_id: 'egld-elrond' },
  { symbol: 'ONE', name: 'Harmony', id: 'harmony', coinmarketcap_id: '3945', coinpaprika_id: 'one-harmony' },
  { symbol: 'ROSE', name: 'Oasis Network', id: 'oasis-network', coinmarketcap_id: '7653', coinpaprika_id: 'rose-oasis-network' },
  { symbol: 'KAVA', name: 'Kava', id: 'kava', coinmarketcap_id: '4846', coinpaprika_id: 'kava-kava' },
  { symbol: 'IOTX', name: 'IoTeX', id: 'iotex', coinmarketcap_id: '2777', coinpaprika_id: 'iotx-iotex' },
  { symbol: 'ZEN', name: 'Horizen', id: 'horizen', coinmarketcap_id: '1698', coinpaprika_id: 'zen-horizen' },
  { symbol: 'MINA', name: 'Mina', id: 'mina-protocol', coinmarketcap_id: '8646', coinpaprika_id: 'mina-mina-protocol' },
  { symbol: 'ANKR', name: 'Ankr', id: 'ankr', coinmarketcap_id: '3783', coinpaprika_id: 'ankr-ankr' },
  { symbol: 'RSR', name: 'Reserve Rights', id: 'reserve-rights-token', coinmarketcap_id: '3964', coinpaprika_id: 'rsr-reserve-rights' },
  { symbol: 'OMG', name: 'OMG Network', id: 'omisego', coinmarketcap_id: '1808', coinpaprika_id: 'omg-omisego' },
  { symbol: 'REN', name: 'Ren', id: 'republic-protocol', coinmarketcap_id: '2539', coinpaprika_id: 'ren-republic-protocol' },
  { symbol: 'BAND', name: 'Band Protocol', id: 'band-protocol', coinmarketcap_id: '4679', coinpaprika_id: 'band-band-protocol' },
  { symbol: 'OCEAN', name: 'Ocean Protocol', id: 'ocean-protocol', coinmarketcap_id: '3911', coinpaprika_id: 'ocean-ocean-protocol' },
  { symbol: 'STORJ', name: 'Storj', id: 'storj', coinmarketcap_id: '1772', coinpaprika_id: 'storj-storj' },
  { symbol: 'SKL', name: 'SKALE Network', id: 'skale', coinmarketcap_id: '5691', coinpaprika_id: 'skl-skale' },
  { symbol: 'CELR', name: 'Celer Network', id: 'celer-network', coinmarketcap_id: '3814', coinpaprika_id: 'celr-celer-network' },
];


// -----------------------------------------------------------------------------
// | SECTION 4: HELPERS & UTILITIES (from /src/utils/helpers.js)
// -----------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// -----------------------------------------------------------------------------
// | SECTION 5: API SERVICES (from /src/api/)
// -----------------------------------------------------------------------------

// --- CoinGecko API Service ---
const coinGeckoService = {
    apiClient: axios.create({
        baseURL: 'https://api.coingecko.com/api/v3',
        timeout: 10000,
        headers: { 'User-Agent': 'ProfessionalTradingBot/2.0' },
    }),

    async fetchPriceData(coinId) {
        try {
            const response = await this.apiClient.get('/simple/price', {
                params: {
                    ids: coinId,
                    vs_currencies: 'usd',
                    include_market_cap: true,
                    include_24hr_vol: true,
                    include_24hr_change: true,
                },
            });
            const data = response.data[coinId];
            if (!data) return null;
            return {
                price: data.usd,
                market_cap: data.usd_market_cap,
                volume_24h: data.usd_24h_vol,
                change_24h: data.usd_24h_change,
                source: 'coingecko'
            };
        } catch (error) {
            console.error(`[CoinGecko] Error fetching price for ${coinId}:`, error.message);
            return null;
        }
    },

    async fetchHistoricalData(coinId, days, interval = null) {
        try {
            const params = interval ? { vs_currency: 'usd', days, interval } : { vs_currency: 'usd', days };
            const response = await this.apiClient.get(`/coins/${coinId}/market_chart`, { params });

            if (response.data && Array.isArray(response.data.prices)) {
                return response.data.prices
                    .map(([timestamp, price]) => ({
                        timestamp: new Date(timestamp),
                        price: Number(price),
                    }))
                    .filter(item => Number.isFinite(item.price) && item.price > 0);
            }
            return [];
        } catch (error) {
            console.error(`[CoinGecko] Error fetching historical data for ${coinId}:`, error.message);
            return [];
        }
    }
};

// --- CoinPaprika API Service ---
const coinPaprikaService = {
    apiClient: axios.create({
        baseURL: 'https://api.coinpaprika.com/v1',
        timeout: 10000,
    }),

    async fetchTickerData(coinpaprikaId) {
        try {
            const response = await this.apiClient.get(`/tickers/${coinpaprikaId}`);
            const quote = response.data?.quotes?.USD;
            if (!quote) return null;

            return {
                price: quote.price,
                market_cap: quote.market_cap,
                volume_24h: quote.volume_24h,
                change_24h: quote.percent_change_24h,
                source: 'coinpaprika',
            };
        } catch (error) {
            console.error(`[CoinPaprika] Error fetching ticker for ${coinpaprikaId}:`, error.message);
            return null;
        }
    },

    async fetchGlobalMetrics() {
        try {
            const response = await this.apiClient.get('/global');
            return response.data;
        } catch (error) {
            console.error('[CoinPaprika] Error fetching global metrics:', error.message);
            return null;
        }
    }
};

// --- Alternative.me API Service (Fear & Greed) ---
const alternativeMeService = {
    apiClient: axios.create({
        baseURL: 'https://api.alternative.me',
        timeout: 10000,
    }),

    async fetchGreedFearIndex() {
        try {
            const response = await this.apiClient.get('/fng/', {
                params: { limit: 1, format: 'json' },
            });

            const entry = response.data?.data?.[0];
            if (entry) {
                return {
                    value: Number(entry.value),
                    classification: entry.value_classification,
                };
            }
            return { value: null };
        } catch (error) {
            console.error('[Alternative.me] Failed to fetch fear & greed index:', error.message);
            return { value: null };
        }
    }
};


// -----------------------------------------------------------------------------
// | SECTION 6: BOT LOGIC SERVICES (from /src/bot/)
// -----------------------------------------------------------------------------

// --- Analysis Service ---
const analysisService = {
    calculateRSI(prices, period = 14) {
        // In a real app, use a library like 'technicalindicators' for accuracy.
        // This is a simplified placeholder.
        if (prices.length < period) return 50; // Not enough data
        let gains = 0;
        let losses = 0;

        // Calculate initial average gain/loss
        for (let i = 1; i <= period; i++) {
            const diff = prices[i].price - prices[i - 1].price;
            if (diff >= 0) {
                gains += diff;
            } else {
                losses -= diff;
            }
        }
        
        let avgGain = gains / period;
        let avgLoss = losses / period;

        // Smooth the rest
        for (let i = period + 1; i < prices.length; i++) {
            const diff = prices[i].price - prices[i - 1].price;
            if (diff >= 0) {
                avgGain = (avgGain * (period - 1) + diff) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgLoss = (avgLoss * (period - 1) - diff) / period;
                avgGain = (avgGain * (period - 1)) / period;
            }
        }
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    },

    getTrend(prices) {
        if (prices.length < 2) return 'NEUTRAL';
        const startPrice = prices[0].price;
        const endPrice = prices[prices.length - 1].price;
        if (endPrice > startPrice * 1.02) return 'BULLISH';
        if (endPrice < startPrice * 0.98) return 'BEARISH';
        return 'NEUTRAL';
    },

    getMomentum(rsi) {
        if (rsi > 65) return 'STRONG_UP';
        if (rsi > 55) return 'UP';
        if (rsi < 35) return 'STRONG_DOWN';
        if (rsi < 45) return 'DOWN';
        return 'NEUTRAL';
    },

    async fetchHistoricalData(coin) {
        const [hourlyData, dailyData] = await Promise.all([
            coinGeckoService.fetchHistoricalData(coin.id, 7, 'hourly'),
            coinGeckoService.fetchHistoricalData(coin.id, 30, 'daily'),
        ]);

        if (hourlyData.length > 0 && dailyData.length > 0) {
            return { hourlyData, dailyData, usedMock: false };
        }

        console.warn(`⚠️ Could not fetch historical data for ${coin.symbol}. Analysis will be skipped.`);
        return { hourlyData: [], dailyData: [], usedMock: true };
    },

    async fetchEnhancedPriceData(coin) {
        let priceData = await coinGeckoService.fetchPriceData(coin.id);
        if (priceData) return priceData;

        priceData = await coinPaprikaService.fetchTickerData(coin.coinpaprika_id);
        if (priceData) return priceData;
        
        console.warn(`⚠️ Could not fetch price data for ${coin.symbol}.`);
        return { price: null, source: 'none', usesMockData: true };
    },

    async analyzeCoin(coin, globalMetrics) {
        const priceData = await this.fetchEnhancedPriceData(coin);
        const historicalData = await this.fetchHistoricalData(coin);

        if (historicalData.usedMock || priceData.usesMockData || !priceData.price) {
            return { action: 'HOLD', confidence: 0, usesMockData: true, symbol: coin.symbol };
        }

        const dailyRSI = this.calculateRSI(historicalData.dailyData);
        const hourlyRSI = this.calculateRSI(historicalData.hourlyData);
        const dailyTrend = this.getTrend(historicalData.dailyData);
        const hourlyTrend = this.getTrend(historicalData.hourlyData);
        const dailyMomentum = this.getMomentum(dailyRSI);

        let confidence = 0;
        let action = 'HOLD';
        const insights = [];
        let reason = 'Market conditions do not meet criteria for a strong signal.';

        // --- BUY Signal Logic ---
        if (dailyRSI < 35 && hourlyRSI < 40 && dailyTrend !== 'BEARISH') {
            action = 'BUY';
            confidence += 0.4;
            insights.push(`Daily RSI (${dailyRSI.toFixed(2)}) is approaching oversold territory.`);
            if (hourlyRSI < 30) confidence += 0.25;
            if (dailyTrend === 'BULLISH') confidence += 0.15;
            if (globalMetrics?.bitcoin_dominance_percentage < 50) confidence += 0.1;
            reason = `${coin.name} shows oversold signals on multiple timeframes with potential for a reversal.`;
        }

        // --- SELL Signal Logic ---
        if (dailyRSI > 68 && hourlyRSI > 65) {
            action = 'SELL';
            confidence += 0.5;
            insights.push(`Daily RSI (${dailyRSI.toFixed(2)}) indicates the asset may be overbought.`);
            if (dailyTrend === 'BEARISH') confidence += 0.2;
            if (hourlyTrend !== 'BULLISH') confidence += 0.1;
            reason = `Strong overbought signals suggest a potential price correction.`;
        }

        return {
            symbol: coin.symbol,
            name: coin.name,
            action,
            confidence: Math.min(confidence, 1.0),
            price: priceData.price,
            dataSource: priceData.source,
            usesMockData: false,
            insights,
            reason,
            timestamp: new Date(),
            indicators: {
                daily: { rsi: dailyRSI, trend: dailyTrend, momentum: dailyMomentum },
                hourly: { rsi: hourlyRSI, trend: hourlyTrend },
            },
        };
    }
};

// --- Notification Service ---
const notificationService = {
    lastNotificationTime: {},

    async sendTelegramNotification(opportunity, globalMetrics, greedFearIndex) {
        if (!config.telegram.enabled) {
            console.log('⚠️ Telegram notifications disabled.');
            return false;
        }

        const now = Date.now();
        if (this.lastNotificationTime[opportunity.symbol] && now - this.lastNotificationTime[opportunity.symbol] < config.notificationCooldownMs) {
            console.log(`⏳ Skipping notification for ${opportunity.symbol} (cooldown).`);
            return false;
        }

        try {
            const actionEmoji = opportunity.action === 'BUY' ? '🟢' : '🔴';
            const confidencePercent = (opportunity.confidence * 100).toFixed(0);
            const sentiment = greedFearIndex?.value != null ? `${greedFearIndex.value} (${greedFearIndex.classification})` : 'N/A';
            const indicators = opportunity.indicators;

            let globalMetricsText = '';
            if (globalMetrics) {
                globalMetricsText = `\n🌐 *Global Market Overview:*
• Mkt Cap: ${(globalMetrics.market_cap_usd / 1e12).toFixed(2)}T
• 24h Vol: ${(globalMetrics.volume_24h_usd / 1e9).toFixed(2)}B
• BTC Dom: ${globalMetrics.bitcoin_dominance_percentage}%`;
            }

            const message = `${actionEmoji} *${opportunity.action} SIGNAL*

*Coin:* ${opportunity.name} (${opportunity.symbol})
*Price:* $${opportunity.price.toLocaleString()}
*Confidence:* ${confidencePercent}%
*Sentiment (F&G):* ${sentiment}

*Daily RSI:* ${indicators.daily.rsi.toFixed(2)}
*Daily Trend:* ${indicators.daily.trend}
*Reason:* ${opportunity.reason}
${globalMetricsText}`;

            await axios.post(
                `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
                    chat_id: config.telegram.chatId,
                    text: message,
                    parse_mode: 'Markdown',
                }, { timeout: 10000 }
            );

            console.log(`✅ Telegram notification sent for ${opportunity.symbol}`);
            this.lastNotificationTime[opportunity.symbol] = now;
            return true;

        } catch (error) {
            console.error(`❌ Failed to send Telegram notification for ${opportunity.symbol}:`, error.response?.data?.description || error.message);
            return false;
        }
    },

    async sendTestNotification() {
        if (!config.telegram.enabled) {
            return { success: false, message: 'Telegram credentials not configured.' };
        }
        try {
            const testMessage = `✅ *Test Notification* ✅\n\nYour trading bot is connected and running correctly.`;
            await axios.post(
                `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
                    chat_id: config.telegram.chatId,
                    text: testMessage,
                    parse_mode: 'Markdown',
                }, { timeout: 10000 }
            );
            return { success: true, message: 'Test notification sent successfully!' };
        } catch (error) {
            return { success: false, message: `Failed to send test notification: ${error.response?.data?.description || error.message}` };
        }
    }
};


// -----------------------------------------------------------------------------
// | SECTION 7: THE MAIN TRADING BOT CLASS
// -----------------------------------------------------------------------------
class ProfessionalTradingBot {
    constructor() {
        this.isRunning = false;
        this.scanTimer = null;
        this.scanInProgress = false;
        this.trackedCoins = getTop100Coins();
        this.minConfidence = 0.65;
        this.liveAnalysis = [];

        this.stats = {
            totalScans: 0,
            totalOpportunities: 0,
            notificationsSent: 0,
            lastScanDuration: 0,
            lastSuccessfulScan: null,
            apiErrors: 0,
        };

        this.greedFearIndex = { value: null };
        this.globalMetrics = null;
        this.selectedIntervalKey = '1h';
        this.scanIntervalMs = config.scanIntervals[this.selectedIntervalKey];
    }

    startAutoScan() {
        if (this.isRunning) {
            console.log('🔄 Auto-scan is already running.');
            return { status: 'already_running' };
        }
        this.isRunning = true;
        console.log(`🚀 Starting automated scan with interval: ${this.selectedIntervalKey}`);
        this.performTechnicalScan(); // Run immediately
        this.scheduleNextScan();
        return { status: 'started' };
    }

    stopAutoScan() {
        this.isRunning = false;
        if (this.scanTimer) {
            clearTimeout(this.scanTimer);
            this.scanTimer = null;
        }
        console.log('🛑 Auto-scan stopped.');
        return { status: 'stopped' };
    }

    scheduleNextScan() {
        if (!this.isRunning) return;
        const delay = Math.max(this.scanIntervalMs - this.stats.lastScanDuration, 5000);
        this.scanTimer = setTimeout(() => this.performTechnicalScan().then(() => this.scheduleNextScan()), delay);
    }

    async performTechnicalScan() {
        if (this.scanInProgress) {
            console.log('⏳ Scan already in progress, skipping.');
            return;
        }
        const startTime = Date.now();
        this.scanInProgress = true;
        console.log(`\n🎯 SCAN STARTED: ${new Date().toLocaleString()}`);

        this.greedFearIndex = await alternativeMeService.fetchGreedFearIndex();
        this.globalMetrics = await coinPaprikaService.fetchGlobalMetrics();
        
        console.log(`📊 Scanning ${this.trackedCoins.length} coins... (F&G Index: ${this.greedFearIndex.value || 'N/A'})`);
        
        const opportunities = [];
        this.liveAnalysis = [];

        for (const coin of this.trackedCoins) {
            try {
                const analysis = await analysisService.analyzeCoin(coin, this.globalMetrics);
                this.liveAnalysis.push(analysis);
                
                if (analysis.confidence >= this.minConfidence && !analysis.usesMockData) {
                    opportunities.push(analysis);
                    console.log(`✅ Opportunity: ${coin.symbol} (${analysis.action}, Conf: ${(analysis.confidence * 100).toFixed(0)}%)`);
                }
            } catch (error) {
                console.error(`❌ Analysis failed for ${coin.symbol}:`, error.message);
                this.stats.apiErrors++;
            } finally {
                await sleep(config.apiDelay);
            }
        }

        opportunities.sort((a, b) => b.confidence - a.confidence);

        if (opportunities.length > 0) {
            console.log(`📱 Found ${opportunities.length} high-confidence opportunities. Sending notifications...`);
            for (const opp of opportunities) {
                const success = await notificationService.sendTelegramNotification(opp, this.globalMetrics, this.greedFearIndex);
                if (success) this.stats.notificationsSent++;
                await sleep(1500); // Stagger notifications to avoid rate limits
            }
        }

        this.stats.totalScans++;
        this.stats.totalOpportunities += opportunities.length;
        this.stats.lastScanDuration = Date.now() - startTime;
        this.stats.lastSuccessfulScan = new Date();
        this.scanInProgress = false;
        console.log(`\n📈 SCAN COMPLETE in ${(this.stats.lastScanDuration / 1000).toFixed(2)}s. Found ${opportunities.length} opportunities.`);
    }
}


// -----------------------------------------------------------------------------
// | SECTION 8: EXPRESS SERVER SETUP
// -----------------------------------------------------------------------------

// Instantiate the single bot instance
const tradingBot = new ProfessionalTradingBot();
const app = express();
app.use(express.json());

// --- API Routes ---
app.get('/', (req, res) => {
    res.send(`Trading Bot Server is running. Go to /status to see the bot's state.`);
});

app.get('/status', (req, res) => {
    res.json({
        isRunning: tradingBot.isRunning,
        scanInProgress: tradingBot.scanInProgress,
        scanInterval: tradingBot.selectedIntervalKey,
        stats: tradingBot.stats,
    });
});

app.get('/analysis', (req, res) => {
    res.json({
        lastScan: tradingBot.stats.lastSuccessfulScan,
        results: tradingBot.liveAnalysis,
    });
});

app.post('/start', (req, res) => {
    const result = tradingBot.startAutoScan();
    res.status(200).json({ message: 'Trading bot start command issued.', ...result });
});

app.post('/stop', (req, res) => {
    const result = tradingBot.stopAutoScan();
    res.status(200).json({ message: 'Trading bot stop command issued.', ...result });
});

app.post('/test-notification', async (req, res) => {
    const result = await notificationService.sendTestNotification();
    res.status(result.success ? 200 : 500).json(result);
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
    console.error('An unhandled error occurred:', err.stack);
    res.status(500).send('Something went wrong on the server!');
});


// -----------------------------------------------------------------------------
// | SECTION 9: SERVER INITIALIZATION
// -----------------------------------------------------------------------------
app.listen(config.port, () => {
    console.log(`📈 Trading Bot server listening on http://localhost:${config.port}`);
    
    if (process.env.AUTO_START_BOT === 'true') {
        console.log('🤖 Auto-starting bot as per .env configuration...');
        tradingBot.startAutoScan();
    }
});
