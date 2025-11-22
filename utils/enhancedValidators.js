/**
 * Enhanced Validators for Position Sizing and DCA Placement
 * Prevents tiny positions and ensures DCA is correctly positioned
 */

/**
 * Position Size Validator
 * Prevents tiny positions ($3) and validates size is within expected range
 */
class PositionSizeValidator {
    /**
     * Validate position size meets minimum and is within expected range
     * @param {string} symbol - Trading symbol
     * @param {number} calculatedSizeUSD - Actual calculated position size in USD
     * @param {number} expectedSizeUSD - Expected position size in USD
     * @throws {Error} If position size is invalid
     */
    static validatePositionSize(symbol, calculatedSizeUSD, expectedSizeUSD) {
        const minSizeUSD = 10; // Minimum $10 position
        const tolerance = 0.3; // 30% tolerance

        if (calculatedSizeUSD < minSizeUSD) {
            throw new Error(`Position size $${calculatedSizeUSD.toFixed(2)} below minimum $${minSizeUSD} for ${symbol}`);
        }

        const ratio = calculatedSizeUSD / expectedSizeUSD;
        if (ratio < (1 - tolerance) || ratio > (1 + tolerance)) {
            throw new Error(`Position size $${calculatedSizeUSD.toFixed(2)} outside expected range $${(expectedSizeUSD * (1 - tolerance)).toFixed(2)}-$${(expectedSizeUSD * (1 + tolerance)).toFixed(2)} for ${symbol}`);
        }

        console.log(`✅ Position size validated: $${calculatedSizeUSD.toFixed(2)} (expected: $${expectedSizeUSD.toFixed(2)})`);
        return true;
    }
}

/**
 * DCA Validator
 * Ensures DCA price is correctly positioned relative to entry and stop loss
 * Adds 1% safety margin from SL to prevent violations
 */
class DCAValidator {
    /**
     * Validate and adjust DCA placement with safety margins
     * @param {number} entryPrice - Entry price
     * @param {number} dcaPrice - Proposed DCA price
     * @param {number} stopLoss - Stop loss price
     * @param {string} action - 'BUY' or 'SELL'
     * @returns {number} Validated or adjusted DCA price
     * @throws {Error} If DCA placement is invalid
     */
    static validateDCAPlacement(entryPrice, dcaPrice, stopLoss, action) {
        const safetyMarginPercent = 0.01; // 1% safety margin from SL

        if (action === 'BUY') {
            // For BUY: DCA must be between SL and Entry (SL < DCA < Entry)
            if (dcaPrice >= entryPrice) {
                throw new Error(`DCA price ${dcaPrice.toFixed(6)} must be BELOW entry ${entryPrice.toFixed(6)} for BUY position`);
            }
            if (dcaPrice <= stopLoss) {
                throw new Error(`DCA price ${dcaPrice.toFixed(6)} must be ABOVE stop loss ${stopLoss.toFixed(6)} for BUY position`);
            }

            // Check safety margin from SL
            const minDistanceFromSL = stopLoss * safetyMarginPercent;
            if (dcaPrice - stopLoss < minDistanceFromSL) {
                const newDCA = stopLoss + minDistanceFromSL;
                console.log(`⚠️ DCA too close to SL, adjusting from ${dcaPrice.toFixed(6)} to ${newDCA.toFixed(6)}`);
                return newDCA;
            }
        } else { // SELL
            // For SELL: DCA must be between Entry and SL (Entry < DCA < SL)
            if (dcaPrice <= entryPrice) {
                throw new Error(`DCA price ${dcaPrice.toFixed(6)} must be ABOVE entry ${entryPrice.toFixed(6)} for SELL position`);
            }
            if (dcaPrice >= stopLoss) {
                throw new Error(`DCA price ${dcaPrice.toFixed(6)} must be BELOW stop loss ${stopLoss.toFixed(6)} for SELL position`);
            }

            // Check safety margin from SL
            const minDistanceFromSL = stopLoss * safetyMarginPercent;
            if (stopLoss - dcaPrice < minDistanceFromSL) {
                const newDCA = stopLoss - minDistanceFromSL;
                console.log(`⚠️ DCA too close to SL, adjusting from ${dcaPrice.toFixed(6)} to ${newDCA.toFixed(6)}`);
                return newDCA;
            }
        }

        console.log(`✅ DCA placement validated: ${dcaPrice.toFixed(6)} (${action})`);
        return dcaPrice;
    }
}

module.exports = {
    PositionSizeValidator,
    DCAValidator
};
