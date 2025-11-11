const ccxt = require('ccxt');

class MarketData {
  constructor() {
    // Use a supported exchange for testing - Binance has good demo
    this.exchange = new ccxt.binance({
      'apiKey': process.env.PIONEX_API_KEY || 'demo',
      'secret': process.env.PIONEX_API_SECRET || 'demo',
      'sandbox': true, // Use testnet for safety
      'verbose': false
    });
    
    console.log('🔧 Exchange initialized:', this.exchange.name);
  }

  async getPrice(symbol = 'BTC/USDT') {
    try {
      console.log(`📊 Fetching price for ${symbol}...`);
      const ticker = await this.exchange.fetchTicker(symbol);
      console.log(`✅ Current ${symbol} price: $${ticker.last}`);
      return ticker.last;
    } catch (error) {
      console.error('❌ Price fetch error:', error.message);
      // Return mock price for testing
      return 35000 + (Math.random() * 1000);
    }
  }

  async getBalance() {
    try {
      const balance = await this.exchange.fetchBalance();
      const usdtBalance = balance.free.USDT || balance.total.USDT || 0;
      console.log('💰 Available USDT:', usdtBalance);
      return usdtBalance;
    } catch (error) {
      console.error('❌ Balance fetch error:', error.message);
      // Return mock balance for testing
      return 1000;
    }
  }
}

module.exports = MarketData;
