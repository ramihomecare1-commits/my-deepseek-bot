// Deep dive: Why do BTC and ADA work but ETH doesn't?
const { getDCASize } = require('./services/portfolioService');
const { calculateQuantity } = require('./services/exchangeService');

console.log('=== WHY DO SOME COINS WORK? ===\n');

// Check what executeOkxLimitOrder does with the quantity
console.log('From executeOkxLimitOrder code (line 814-841):');
console.log('It has a lotSizeMap with lot sizes:');
const lotSizeMap = {
    'BTC-USDT-SWAP': 0.01,
    'ETH-USDT-SWAP': 0.01,
    'SOL-USDT-SWAP': 0.1,
    'ADA-USDT-SWAP': 0.1,
    'LINK-USDT-SWAP': 0.1,
};

console.log(JSON.stringify(lotSizeMap, null, 2));

console.log('\nIt rounds: roundedQuantity = Math.round(quantity / lotSize) * lotSize');
console.log('\nLet\'s see what happens to each coin:\n');

const testCoins = [
    { symbol: 'BTC', price: 86000, contractSize: 0.01, lotSize: 0.01 },
    { symbol: 'ETH', price: 3500, contractSize: 0.1, lotSize: 0.01 },
    { symbol: 'ADA', price: 0.35, contractSize: 10, lotSize: 0.1 },
];

testCoins.forEach(coin => {
    const dcaSize = getDCASize(0, coin.symbol);
    const qty = calculateQuantity(coin.symbol, coin.price, dcaSize);

    const okxSymbol = `${coin.symbol}-USDT-SWAP`;
    const lotSize = lotSizeMap[okxSymbol];

    // This is what executeOkxLimitOrder does
    let roundedQuantity = Math.round(qty / lotSize) * lotSize;
    if (roundedQuantity < lotSize) {
        roundedQuantity = lotSize;
    }

    console.log(`${coin.symbol}:`);
    console.log(`  DCA Size: $${dcaSize}`);
    console.log(`  calculateQuantity returns: ${qty} (COINS)`);
    console.log(`  Lot size: ${lotSize}`);
    console.log(`  After rounding: ${roundedQuantity}`);
    console.log(`  Sent to OKX as sz: ${roundedQuantity}`);

    // What does OKX interpret this as?
    console.log(`\n  If OKX treats sz as CONTRACTS:`);
    const ethValue = roundedQuantity * coin.contractSize;
    const usdValue = ethValue * coin.price;
    console.log(`    ${roundedQuantity} contracts × ${coin.contractSize} = ${ethValue} ${coin.symbol}`);
    console.log(`    ${ethValue} ${coin.symbol} × $${coin.price} = $${usdValue.toFixed(2)}`);

    if (Math.abs(usdValue - dcaSize) < 5) {
        console.log(`    ✅ MATCHES! OKX must be treating sz as CONTRACTS`);
    } else {
        console.log(`    ❌ DOESN'T MATCH - Expected $${dcaSize}, got $${usdValue.toFixed(2)}`);
    }
    console.log('');
});

console.log('=== CONCLUSION ===');
console.log('The key is: What does OKX expect in the "sz" field?');
console.log('If OKX expects CONTRACTS, then we need to convert coins → contracts!');
