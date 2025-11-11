class TechnicalAnalysis {
  constructor() {
    this.priceHistory = [];
    this.maxHistory = 100;
  }

  // Add new price to history
  addPrice(price) {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.maxHistory) {
      this.priceHistory.shift(); // Remove oldest
    }
  }

  // Simple Moving Average
  calculateSMA(period = 10) {
    if (this.priceHistory.length < period) {
      return null;
    }
    
    const recentPrices = this.priceHistory.slice(-period);
    const sum = recentPrices.reduce((a, b) => a + b, 0);
    return sum / period;
  }

  // Exponential Moving Average
  calculateEMA(period = 10) {
    if (this.priceHistory.length < period) {
      return null;
    }
    
    const multiplier = 2 / (period + 1);
    let ema = this.priceHistory[0];
    
    for (let i = 1; i < this.priceHistory.length; i++) {
      ema = (this.priceHistory[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  // RSI (Relative Strength Index)
  calculateRSI(period = 14) {
    if (this.priceHistory.length < period + 1) {
      return null;
    }
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = this.priceHistory[i] - this.priceHistory[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // Generate trading signal based on multiple indicators
  generateSignal(currentPrice) {
    this.addPrice(currentPrice);
    
    const smaShort = this.calculateSMA(5);
    const smaLong = this.calculateSMA(20);
    const rsi = this.calculateRSI(14);
    
    if (!smaShort || !smaLong || !rsi) {
      return 'HOLD'; // Not enough data
    }
    
    let signal = 'HOLD';
    let confidence = 0;
    
    // SMA Crossover strategy
    if (smaShort > smaLong) {
      signal = 'BUY';
      confidence += 0.4;
    } else {
      signal = 'SELL'; 
      confidence += 0.4;
    }
    
    // RSI strategy
    if (rsi < 30) {
      signal = 'BUY';
      confidence += 0.3;
    } else if (rsi > 70) {
      signal = 'SELL';
      confidence += 0.3;
    }
    
    // Price momentum
    const priceChange = ((currentPrice - this.priceHistory[this.priceHistory.length - 2]) / this.priceHistory[this.priceHistory.length - 2]) * 100;
    if (priceChange > 2) {
      signal = 'SELL';
      confidence += 0.3;
    } else if (priceChange < -2) {
      signal = 'BUY';
      confidence += 0.3;
    }
    
    return {
      signal,
      confidence: Math.min(confidence, 1),
      indicators: {
        smaShort,
        smaLong,
        rsi,
        priceChange: priceChange.toFixed(2) + '%'
      }
    };
  }
}

module.exports = TechnicalAnalysis;
