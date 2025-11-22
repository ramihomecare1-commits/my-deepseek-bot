/**
 * Trade Re-evaluation Manager
 * Prevents immediate closure of newly opened positions
 * Requires minimum hold time and price movement before re-evaluation
 */

class TradeReevaluationManager {
    /**
     * Check if a trade should be re-evaluated
     * @param {Object} trade - Trade object with createdAt, entryPrice, currentPrice
     * @returns {boolean} True if trade should be re-evaluated
     */
    static shouldReevaluateTrade(trade) {
        const MIN_HOLD_TIME_MINUTES = 60; // Don't re-evaluate for 1 hour
        const MIN_PRICE_MOVEMENT = 0.02; // 2% minimum price change

        const now = Date.now();
        const tradeAge = now - new Date(trade.createdAt).getTime();
        const minHoldTimeMs = MIN_HOLD_TIME_MINUTES * 60 * 1000;

        // Check minimum hold time
        if (tradeAge < minHoldTimeMs) {
            console.log(`⏳ Skipping re-evaluation for ${trade.symbol} - trade too new (${Math.round(tradeAge / 60000)}min old, need ${MIN_HOLD_TIME_MINUTES}min)`);
            return false;
        }

        // Check if price moved significantly
        if (trade.currentPrice && trade.entryPrice) {
            const priceChange = Math.abs((trade.currentPrice - trade.entryPrice) / trade.entryPrice);

            if (priceChange < MIN_PRICE_MOVEMENT) {
                console.log(`📊 Skipping re-evaluation for ${trade.symbol} - insufficient price movement (${(priceChange * 100).toFixed(2)}%, need ${MIN_PRICE_MOVEMENT * 100}%)`);
                return false;
            }

            console.log(`✅ Re-evaluating ${trade.symbol} - age: ${Math.round(tradeAge / 60000)}min, price change: ${(priceChange * 100).toFixed(2)}%`);
        }

        return true;
    }

    /**
     * Filter trades that are protected from re-evaluation
     * @param {Array} trades - Array of active trades
     * @returns {Object} {protectedTrades, evaluableTrades}
     */
    static filterProtectedTrades(trades) {
        const TRADE_PROTECTION_PERIOD = 30 * 60 * 1000; // 30 minutes minimum
        const now = Date.now();

        const protectedTrades = trades.filter(t =>
            (now - new Date(t.createdAt).getTime()) < TRADE_PROTECTION_PERIOD
        );

        const evaluableTrades = trades.filter(t =>
            (now - new Date(t.createdAt).getTime()) >= TRADE_PROTECTION_PERIOD
        );

        if (protectedTrades.length > 0) {
            console.log(`🛡️ ${protectedTrades.length} trades protected from re-evaluation (< 30min old)`);
        }

        return { protectedTrades, evaluableTrades };
    }
}

module.exports = {
    TradeReevaluationManager
};
