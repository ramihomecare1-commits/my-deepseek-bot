const MarketData = require('./marketData');

class TradingBot {
  constructor() {
    this.marketData = new MarketData();
    this.isRunning = false;
    this.tradingPair = 'BTC/USDT';
  }

  async executeTrade(action, amount) {
    try {
      if (action === 'BUY') {
        console.log(`🟢 BUY signal: ${amount} ${this.tradingPair}`);
        // ACTUAL BUY CODE (commented for safety)
        // const order = await this.exchange.createMarketBuyOrder(this.tradingPair, amount);
        // console.log('✅ Buy order placed:', order);
      } else if (action === 'SELL') {
        console.log(`🔴 SELL signal: ${amount} ${this.tradingPair}`);
        // ACTUAL SELL CODE (commented for safety)
        // const order = await this.exchange.createMarketSellOrder(this.tradingPair, amount);
        // console.log('✅ Sell order placed:', order);
      }
      
      return { success: true, action, amount };
    } catch (error) {
      console.error('❌ Trade execution error:', error.message);
      return { success: false, error: error.message };
    }
  }

  async analyzeMarket() {
    const price = await this.marketData.getPrice(this.tradingPair);
    const balance = await this.marketData.getBalance();
    
    if (!price) {
      return { action: 'HOLD', reason: 'Price data unavailable' };
    }

    // SIMPLE STRATEGY: Demo logic - replace with real strategy
    const randomSignal = Math.random();
    if (randomSignal > 0.6 && balance > 10) {
      return { action: 'BUY', amount: 0.001, price, balance };
    } else if (randomSignal < 0.4) {
      return { action: 'SELL', amount: 0.001, price, balance };
    } else {
      return { action: 'HOLD', price, balance };
    }
  }

  async runSingleCheck() {
    console.log('🤖 Running market analysis...');
    const analysis = await this.analyzeMarket();
    console.log('📈 Analysis result:', analysis);
    
    if (analysis.action !== 'HOLD') {
      await this.executeTrade(analysis.action, analysis.amount);
    }
    
    return analysis;
  }

  startBot() {
    if (this.isRunning) {
      console.log('⚠️ Bot is already running');
      return;
    }
    
    this.isRunning = true;
    console.log('🚀 Trading bot started!');
    
    // Run every 2 minutes for testing
    this.interval = setInterval(() => {
      this.runSingleCheck();
    }, 2 * 60 * 1000); // 2 minutes
  }

  stopBot() {
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
    }
    console.log('🛑 Trading bot stopped');
  }
}

module.exports = TradingBot;
