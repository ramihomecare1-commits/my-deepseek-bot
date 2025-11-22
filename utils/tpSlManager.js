const { placeOkxAlgoOrder, isExchangeTradingEnabled, getPreferredExchange, OKX_SYMBOL_MAP } = require('../services/exchangeService');

/**
 * TP/SL Manager - Handles placement of Take Profit and Stop Loss orders
 * Uses exchangeService functions directly instead of dependency injection
 */
class TP_SL_Manager {
    /**
     * Place TP/SL orders for a trade
     * @param {Object} trade - Trade object with TP/SL prices
     * @param {number} currentPrice - Current market price (optional, will fetch if not provided)
     * @returns {Promise<Object>} { tpOrder, slOrder }
     */
    static async placeTP_SL_Orders(trade, currentPrice = null) {
        try {
            // If currentPrice not provided, use entry price (TP/SL are based on entry price anyway)
            if (!currentPrice) {
                console.log(`📊 Using entry price for TP/SL placement: $${trade.entryPrice}`);
                currentPrice = trade.entryPrice;
            }

            // Validate we have all required prices
            if (!trade.takeProfit || !trade.stopLoss) {
                throw new Error(`Missing TP/SL prices: TP=${trade.takeProfit}, SL=${trade.stopLoss}`);
            }

            console.log(`🎯 Placing TP/SL for ${trade.symbol}:`);
            console.log(`   - Current: $${currentPrice}`);
            console.log(`   - TP: $${trade.takeProfit} (${((trade.takeProfit / currentPrice - 1) * 100).toFixed(2)}%)`);
            console.log(`   - SL: $${trade.stopLoss} (${((trade.stopLoss / currentPrice - 1) * 100).toFixed(2)}%)`);

            // Get exchange config
            const exchangeConfig = isExchangeTradingEnabled();
            if (!exchangeConfig.enabled) {
                throw new Error('Exchange trading not enabled');
            }

            const exchange = getPreferredExchange();
            if (!exchange) {
                throw new Error('No exchange configured');
            }

            const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];
            if (!okxSymbol) {
                throw new Error(`Symbol ${trade.symbol} not available on OKX`);
            }

            // Place Take Profit Order (Limit Order)
            const tpOrder = await this.placeTakeProfitOrder(trade, currentPrice, exchange, okxSymbol);
            console.log(`✅ Take Profit order placed: ${tpOrder.ordId}`);

            // Place Stop Loss Order (Stop Market Order)
            const slOrder = await this.placeStopLossOrder(trade, currentPrice, exchange, okxSymbol);
            console.log(`✅ Stop Loss order placed: ${slOrder.ordId}`);

            return { tpOrder, slOrder };

        } catch (error) {
            console.error(`❌ Failed to place TP/SL orders for ${trade.symbol}:`, error.message);
            throw error;
        }
    }

    static async placeTakeProfitOrder(trade, currentPrice, exchange, okxSymbol) {
        const tpBody = {
            instId: okxSymbol,
            tdMode: 'isolated',
            side: trade.action === 'BUY' ? 'sell' : 'buy',
            ordType: 'limit',
            px: trade.takeProfit.toFixed(6),
            sz: trade.quantity.toString(),
            posSide: trade.action === 'BUY' ? 'long' : 'short'
        };

        console.log(`📋 TP Order Body:`, JSON.stringify(tpBody));

        const result = await placeOkxAlgoOrder(
            tpBody,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
        );

        if (!result.success) {
            throw new Error(`TP order failed: ${result.error}`);
        }

        return result.data;
    }

    static async placeStopLossOrder(trade, currentPrice, exchange, okxSymbol) {
        const slBody = {
            instId: okxSymbol,
            tdMode: 'isolated',
            side: trade.action === 'BUY' ? 'sell' : 'buy',
            ordType: 'conditional',
            slTriggerPx: trade.stopLoss.toFixed(6),
            slOrdPx: '-1', // Market price when triggered
            sz: trade.quantity.toString(),
            posSide: trade.action === 'BUY' ? 'long' : 'short'
        };

        console.log(`📋 SL Order Body:`, JSON.stringify(slBody));

        const result = await placeOkxAlgoOrder(
            slBody,
            exchange.apiKey,
            exchange.apiSecret,
            exchange.passphrase,
            exchange.baseUrl
        );

        if (!result.success) {
            throw new Error(`SL order failed: ${result.error}`);
        }

        return result.data;
    }
}

/**
 * TP/SL Recovery - Handles retries and fallbacks for TP/SL placement
 */
class TP_SL_Recovery {
    /**
     * Retry TP/SL placement with fallback strategy
     * @param {Object} trade - Trade object
     * @param {number} maxRetries - Maximum retry attempts (default: 3)
     * @returns {Promise<Object>} Result with tpOrder, slOrder, and fallback flag
     */
    static async retryTP_SL_Placement(trade, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 TP/SL placement attempt ${attempt}/${maxRetries} for ${trade.symbol}`);

                // Use entry price for TP/SL (no need to fetch current price)
                const currentPrice = trade.entryPrice;

                const result = await TP_SL_Manager.placeTP_SL_Orders(trade, currentPrice);
                console.log(`✅ TP/SL placement successful on attempt ${attempt}`);
                return { ...result, fallback: false };

            } catch (error) {
                console.log(`❌ TP/SL attempt ${attempt} failed:`, error.message);

                if (attempt === maxRetries) {
                    console.log(`💡 Last attempt failed. Implementing fallback TP/SL strategy...`);
                    const fallbackResult = await this.placeFallbackTP_SL(trade);
                    return { ...fallbackResult, fallback: true };
                }

                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }

    /**
     * Fallback strategy: Use OKX's built-in TP/SL on position
     * @param {Object} trade - Trade object
     * @returns {Promise<Object>} Fallback result
     */
    static async placeFallbackTP_SL(trade) {
        try {
            console.log(`🔄 Using fallback TP/SL strategy for ${trade.symbol}`);

            const exchangeConfig = isExchangeTradingEnabled();
            if (!exchangeConfig.enabled) {
                throw new Error('Exchange trading not enabled');
            }

            const exchange = getPreferredExchange();
            const okxSymbol = OKX_SYMBOL_MAP[trade.symbol];

            // Use entry price for TP/SL (no need to fetch current price)
            const currentPrice = trade.entryPrice;

            // Try placing orders individually
            const tpOrder = await TP_SL_Manager.placeTakeProfitOrder(trade, currentPrice, exchange, okxSymbol);
            console.log(`✅ Fallback TP order placed: ${tpOrder.ordId}`);

            const slOrder = await TP_SL_Manager.placeStopLossOrder(trade, currentPrice, exchange, okxSymbol);
            console.log(`✅ Fallback SL order placed: ${slOrder.ordId}`);

            return { tpOrder, slOrder };

        } catch (fallbackError) {
            console.error(`❌ Fallback TP/SL also failed:`, fallbackError.message);
            console.log(`⚠️ Trade ${trade.symbol} will require manual TP/SL monitoring`);
            throw fallbackError;
        }
    }
}

module.exports = { TP_SL_Manager, TP_SL_Recovery };
