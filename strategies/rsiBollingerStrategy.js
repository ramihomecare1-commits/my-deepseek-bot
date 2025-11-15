/**
 * RSI + Bollinger Bands Strategy
 * Classic oversold/overbought strategy
 */

const BaseStrategy = require('./baseStrategy');
const { calculateATRStopLoss, calculateATRTakeProfit } = require('../utils/tradeMath');

class RSIBollingerStrategy extends BaseStrategy {
  constructor() {
    super(
      'RSI + Bollinger Bands',
      'Identifies oversold conditions using RSI and Bollinger Bands'
    );
    
    this.config = {
      rsiOversold: 30,
      rsiOverbought: 70,
      minConfidence: 0.65,
      atrMultiplierSL: 2,
      atrMultiplierTP: 3
    };
  }

  /**
   * Analyze market data and generate signal
   * @param {Object} data - Market data
   * @returns {Object} Trade signal
   */
  async analyze(data) {
    const { frames, currentPrice, symbol, atr } = data;
    
    if (!frames || !frames['1h']) {
      return { signal: 'NONE', confidence: 0 };
    }

    const frame = frames['1h'];
    const rsi = frame.rsi;
    const bollingerPosition = frame.bollingerPosition;

    let confidence = 0;
    let signal = 'NONE';
    let reasons = [];

    // RSI oversold + below lower Bollinger = BUY
    if (rsi < this.config.rsiOversold) {
      confidence += 0.3;
      reasons.push(`RSI oversold (${rsi.toFixed(2)})`);
      signal = 'BUY';
    }

    // Below lower Bollinger band
    if (bollingerPosition === 'below_lower') {
      confidence += 0.25;
      reasons.push('Price below lower Bollinger Band');
      signal = 'BUY';
    }

    // Trend reversal
    if (frame.trend === 'up' && signal === 'BUY') {
      confidence += 0.15;
      reasons.push('Uptrend confirmed');
    }

    // Momentum confirmation
    if (frame.momentum === 'up' && signal === 'BUY') {
      confidence += 0.1;
      reasons.push('Positive momentum');
    }

    // Support level nearby
    if (frame.support && currentPrice <= frame.support * 1.02) {
      confidence += 0.1;
      reasons.push('Near support level');
    }

    // Volume confirmation (if available)
    if (frame.volume && frame.volume > frame.avgVolume * 1.2) {
      confidence += 0.1;
      reasons.push('High volume');
    }

    return {
      signal: signal,
      confidence: Math.min(confidence, 1.0),
      reasons: reasons,
      entry: currentPrice,
      stopLoss: this.calculateStopLoss({ confidence }, data),
      takeProfit: this.calculateTakeProfit({ confidence }, data),
      strategy: this.name
    };
  }

  /**
   * Calculate stop loss using ATR
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Stop loss price
   */
  calculateStopLoss(signal, data) {
    const { currentPrice, atr, frames } = data;
    
    if (atr && atr > 0) {
      return calculateATRStopLoss(currentPrice, atr, this.config.atrMultiplierSL, true);
    }
    
    // Fallback: Use support level or 5% stop
    const frame = frames?.['1h'] || {};
    if (frame.support) {
      return frame.support * 0.98; // 2% below support
    }
    
    return currentPrice * 0.95; // 5% stop
  }

  /**
   * Calculate take profit using ATR
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Take profit price
   */
  calculateTakeProfit(signal, data) {
    const { currentPrice, atr, frames } = data;
    
    if (atr && atr > 0) {
      return calculateATRTakeProfit(currentPrice, atr, this.config.atrMultiplierTP, true);
    }
    
    // Fallback: Use resistance level or 10% profit
    const frame = frames?.['1h'] || {};
    if (frame.resistance) {
      return frame.resistance * 0.98; // Target just below resistance
    }
    
    return currentPrice * 1.10; // 10% profit target
  }

  /**
   * Validate signal
   * @param {Object} signal - Trade signal
   * @returns {boolean} Is valid
   */
  validate(signal) {
    return signal.signal === 'BUY' && signal.confidence >= this.config.minConfidence;
  }
}

module.exports = RSIBollingerStrategy;

