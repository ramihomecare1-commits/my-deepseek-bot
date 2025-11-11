const ccxt = require('ccxt');

class MarketData {
  constructor() {
    this.exchange = new ccxt.pionex({
      'apiKey': process.env.PIONEX_API_KEY,
      'secret': process.env.PIONEX_API_SECRET,
      'sandbox': false, // Set to true if using demo
      'verbose': false
    });
  }

  async getPrice(symbol = 'BTC/USDT') {
    try {
      console.log(`📊 Fetching price for ${symbol}...`);
      const ticker = await this.exchange.fetchTicker(symbol);
      console.log(`✅ Current ${symbol} price: $${ticker.last}`);
      return ticker.last;
    } catch (error) {
      console.error('❌ Price fetch error:', error.message);
      return null;
    }
  }

  async getBalance() {
    try {
      const balance = await this.exchange.fetchBalance();
      console.log('💰 Available USDT:', balance.free.USDT || 0);
      return balance.free.USDT || 0;
    } catch (error) {
      console.error('❌ Balance fetch error:', error.message);
      return 0;
    }
  }
}

module.exports = MarketData;
