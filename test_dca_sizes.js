// Test DCA sizes for different coins
const { getDCASize } = require('./services/portfolioService');

// Test all coin DCA sizes
const testSymbols = ['BTC', 'ETH', 'SOL', 'ADA', 'LINK'];
console.log('=== DCA SIZE TEST ===');
testSymbols.forEach(symbol => {
    const size = getDCASize(0, symbol);
    console.log(`${symbol}: $${size}`);
});
console.log('====================');

// Test all 5 DCA tiers for BTC
console.log('\n=== BTC DCA TIERS ===');
for (let i = 0; i < 5; i++) {
    const size = getDCASize(i, 'BTC');
    console.log(`BTC DCA #${i + 1}: $${size}`);
}
console.log('=====================');

// Test all 5 DCA tiers for other coins
console.log('\n=== OTHER COINS DCA TIERS ===');
for (let i = 0; i < 5; i++) {
    const size = getDCASize(i, 'ETH');
    console.log(`ETH DCA #${i + 1}: $${size}`);
}
console.log('=============================');
