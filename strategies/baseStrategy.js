/**
 * Base Strategy Class
 * Foundation for all trading strategies
 */

class BaseStrategy {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.enabled = true;
  }

  /**
   * Analyze market conditions and generate trade signal
   * @param {Object} data - Market data (price, indicators, news, etc.)
   * @returns {Object} Trade signal
   */
  async analyze(data) {
    throw new Error('analyze() must be implemented by strategy');
  }

  /**
   * Calculate entry price
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Entry price
   */
  calculateEntry(signal, data) {
    return data.currentPrice || 0;
  }

  /**
   * Calculate stop loss
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Stop loss price
   */
  calculateStopLoss(signal, data) {
    throw new Error('calculateStopLoss() must be implemented by strategy');
  }

  /**
   * Calculate take profit
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Take profit price
   */
  calculateTakeProfit(signal, data) {
    throw new Error('calculateTakeProfit() must be implemented by strategy');
  }

  /**
   * Validate signal meets strategy criteria
   * @param {Object} signal - Trade signal
   * @returns {boolean} Is valid
   */
  validate(signal) {
    return signal && signal.confidence && signal.confidence >= 0.5;
  }

  /**
   * Get strategy configuration
   * @returns {Object} Configuration
   */
  getConfig() {
    return {
      name: this.name,
      description: this.description,
      enabled: this.enabled
    };
  }

  /**
   * Enable or disable strategy
   * @param {boolean} enabled - Enable flag
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

module.exports = BaseStrategy;

