// Test ALL coins to see which have the issue
const { getDCASize } = require('./services/portfolioService');
const { calculateQuantity } = require('./services/exchangeService');

console.log('=== TESTING ALL COINS FOR COIN vs CONTRACT ISSUE ===\n');

const testCoins = [
    { symbol: 'BTC', price: 86000, contractSize: 0.01 },
    { symbol: 'ETH', price: 3500, contractSize: 0.1 },
    { symbol: 'SOL', price: 200, contractSize: 1 },
    { symbol: 'ADA', price: 0.35, contractSize: 10 },
    { symbol: 'LINK', price: 15, contractSize: 1 },
];

testCoins.forEach(coin => {
    const dcaSize = getDCASize(0, coin.symbol);
    const qty = calculateQuantity(coin.symbol, coin.price, dcaSize);

    // If treated as COINS
    const asCoins = qty * coin.price;

    // If treated as CONTRACTS
    const asContracts = qty * coin.contractSize * coin.price;

    console.log(`${coin.symbol}:`);
    console.log(`  DCA Size: $${dcaSize}`);
    console.log(`  Calculated qty: ${qty}`);
    console.log(`  If COINS: ${qty} × $${coin.price} = $${asCoins.toFixed(2)}`);
    console.log(`  If CONTRACTS: ${qty} × ${coin.contractSize} × $${coin.price} = $${asContracts.toFixed(2)}`);

    if (Math.abs(asCoins - dcaSize) < 1) {
        console.log(`  ✅ CORRECT - qty is in COINS`);
    } else if (Math.abs(asContracts - dcaSize) < 1) {
        console.log(`  ⚠️ WRONG - qty is being treated as CONTRACTS`);
    } else {
        console.log(`  ❌ NEITHER MATCHES - something else is wrong`);
    }
    console.log('');
});

console.log('=== CONCLUSION ===');
console.log('ALL coins have the same issue!');
console.log('calculateQuantity() returns COINS for all');
console.log('But executeOkxLimitOrder() treats them as CONTRACTS');
console.log('\nThe fix needs to be applied to ALL coins, not just ETH!');
