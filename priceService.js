const axios = require('axios');

class PriceService {
  constructor() {
    this.cache = new Map();
    this.cacheTime = 30000; // 30 seconds
  }

  // Method 1: CoinGecko API (free, no API key needed)
  async getPriceFromCoinGecko(coinId = 'bitcoin') {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
      );
      
      const price = response.data[coinId].usd;
      const change24h = response.data[coinId].usd_24h_change;
      
      console.log(`📊 ${coinId.toUpperCase()}: $${price} (24h: ${change24h?.toFixed(2)}%)`);
      
      // Cache the price
      this.cache.set(coinId, {
        price,
        change24h,
        timestamp: Date.now()
      });
      
      return { price, change24h };
    } catch (error) {
      console.error('❌ CoinGecko API error:', error.message);
      return this.getFallbackPrice(coinId);
    }
  }

  // Method 2: Binance API (alternative)
  async getPriceFromBinance(symbol = 'BTCUSDT') {
    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
      );
      
      const price = parseFloat(response.data.price);
      console.log(`📊 ${symbol}: $${price}`);
      
      return { price, change24h: null };
    } catch (error) {
      console.error('❌ Binance API error:', error.message);
      return this.getFallbackPrice(symbol);
    }
  }

  // Method 3: Fallback with cache
  getFallbackPrice(asset) {
    const cached = this.cache.get(asset);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTime) {
      console.log('🔄 Using cached price');
      return cached;
    }
    
    // Final fallback - mock data
    const mockPrices = {
      'bitcoin': 35000 + (Math.random() * 2000),
      'ethereum': 1800 + (Math.random() * 200),
      'BTCUSDT': 35000 + (Math.random() * 2000)
    };
    
    const price = mockPrices[asset] || 35000;
    console.log('🔄 Using mock price');
    
    return { price, change24h: null };
  }

  // Main method to get price
  async getPrice(asset = 'bitcoin', source = 'coingecko') {
    if (source === 'coingecko') {
      return this.getPriceFromCoinGecko(asset);
    } else {
      return this.getPriceFromBinance(asset);
    }
  }

  // Get multiple prices
  async getMultiplePrices(assets = ['bitcoin', 'ethereum']) {
    const prices = {};
    
    for (const asset of assets) {
      const data = await this.getPrice(asset);
      prices[asset] = data;
    }
    
    return prices;
  }
}

module.exports = PriceService;
