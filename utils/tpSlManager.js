const { okxAPI } = require('../services/exchangeService');

/**
 * TP/SL Manager
 * Handles placement of Take Profit and Stop Loss orders
 * Ensures currentPrice is available and validates inputs
 */
class TP_SL_Manager {
    /**
     * Place both TP and SL orders
     * @param {Object} trade - Trade object
     * @param {number} [currentPrice=null] - Current market price
     * @returns {Object} { tpOrder, slOrder }
     */
    static async placeTP_SL_Orders(trade, currentPrice = null) {
        try {
            // If currentPrice not provided, fetch it from OKX
            if (!currentPrice) {
                console.log(`📊 Fetching current price for ${trade.symbol} for TP/SL placement...`);
                const ticker = await okxAPI.getTicker(trade.symbol);
                currentPrice = parseFloat(ticker.data[0].last);
                console.log(`✅ Current price for ${trade.symbol}: $${currentPrice}`);
            }

            // Validate we have all required prices
            if (!trade.takeProfit || !trade.stopLoss) {
                throw new Error(`Missing TP/SL prices: TP=${trade.takeProfit}, SL=${trade.stopLoss}`);
            }

            console.log(`🎯 Placing TP/SL for ${trade.symbol}:`);
            console.log(`   - Current: $${currentPrice}`);
            console.log(`   - TP: $${trade.takeProfit} (${((trade.takeProfit / currentPrice - 1) * 100).toFixed(2)}%)`);
            console.log(`   - SL: $${trade.stopLoss} (${((trade.stopLoss / currentPrice - 1) * 100).toFixed(2)}%)`);

            // Place Take Profit Order (Limit Order)
            const tpOrder = await this.placeTakeProfitOrder(trade, currentPrice);
            console.log(`✅ Take Profit order placed: ${tpOrder.ordId}`);

            // Place Stop Loss Order (Stop Market Order)
            const slOrder = await this.placeStopLossOrder(trade, currentPrice);
            console.log(`✅ Stop Loss order placed: ${slOrder.ordId}`);

            return { tpOrder, slOrder };

        } catch (error) {
            console.error(`❌ Failed to place TP/SL orders for ${trade.symbol}:`, error.message);
            throw error;
        }
    }

    static async placeTakeProfitOrder(trade, currentPrice) {
        const tpBody = {
            instId: trade.symbol,
            tdMode: 'isolated',
            side: trade.action === 'BUY' ? 'sell' : 'buy', // Opposite side for TP
            ordType: 'limit', // Limit order for TP
            px: trade.takeProfit.toFixed(6), // TP price
            sz: trade.quantity.toString(), // Full position size
            posSide: trade.action === 'BUY' ? 'long' : 'short'
        };

        console.log(`📋 TP Order Body:`, JSON.stringify(tpBody));
        return await okxAPI.placeOrder(tpBody);
    }

    static async placeStopLossOrder(trade, currentPrice) {
        const slBody = {
            instId: trade.symbol,
            tdMode: 'isolated',
            side: trade.action === 'BUY' ? 'sell' : 'buy', // Opposite side for SL
            ordType: 'market', // Market order for SL
            slTriggerPx: trade.stopLoss.toFixed(6), // SL trigger price
            slOrdPx: '-1', // Market price when triggered
            sz: trade.quantity.toString(), // Full position size
            posSide: trade.action === 'BUY' ? 'long' : 'short'
        };

        console.log(`📋 SL Order Body:`, JSON.stringify(slBody));
        return await okxAPI.placeAlgoOrder(slBody);
    }
}

/**
 * TP/SL Recovery
 * Handles retries and fallback strategies for TP/SL placement
 */
class TP_SL_Recovery {
    static async retryTP_SL_Placement(trade, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 TP/SL placement attempt ${attempt}/${maxRetries} for ${trade.symbol}`);

                const ticker = await okxAPI.getTicker(trade.symbol);
                const currentPrice = parseFloat(ticker.data[0].last);

                const result = await TP_SL_Manager.placeTP_SL_Orders(trade, currentPrice);
                console.log(`✅ TP/SL placement successful on attempt ${attempt}`);
                return result;

            } catch (error) {
                console.log(`❌ TP/SL attempt ${attempt} failed:`, error.message);

                if (attempt === maxRetries) {
                    console.log(`💡 Last attempt failed. Implementing fallback TP/SL strategy...`);
                    await this.placeFallbackTP_SL(trade);
                    return { fallback: true };
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }

    static async placeFallbackTP_SL(trade) {
        // Fallback: Use OKX's built-in TP/SL if algo orders fail
        try {
            console.log(`🔄 Using fallback TP/SL strategy for ${trade.symbol}`);

            const fallbackOrder = {
                instId: trade.symbol,
                tdMode: 'isolated',
                side: trade.action === 'BUY' ? 'sell' : 'buy',
                ordType: 'conditional',
                sz: trade.quantity.toString(),
                posSide: trade.action === 'BUY' ? 'long' : 'short'
            };

            // Add TP condition
            if (trade.action === 'BUY') {
                fallbackOrder.tpTriggerPx = trade.takeProfit.toFixed(6);
                fallbackOrder.tpOrdPx = trade.takeProfit.toFixed(6);
            } else {
                fallbackOrder.tpTriggerPx = trade.takeProfit.toFixed(6);
                fallbackOrder.tpOrdPx = trade.takeProfit.toFixed(6);
            }

            // Add SL condition  
            if (trade.action === 'BUY') {
                fallbackOrder.slTriggerPx = trade.stopLoss.toFixed(6);
                fallbackOrder.slOrdPx = '-1'; // Market order
            } else {
                fallbackOrder.slTriggerPx = trade.stopLoss.toFixed(6);
                fallbackOrder.slOrdPx = '-1';
            }

            const result = await okxAPI.placeAlgoOrder(fallbackOrder);
            console.log(`✅ Fallback TP/SL order placed: ${result.ordId}`);
            return result;

        } catch (fallbackError) {
            console.error(`❌ Fallback TP/SL also failed:`, fallbackError.message);
            throw fallbackError;
        }
    }
}

module.exports = {
    TP_SL_Manager,
    TP_SL_Recovery
};
