// Simple diagnostic matching your friend's suggestion
const { getDCASize } = require('./services/portfolioService');
const { calculateQuantity } = require('./services/exchangeService');

console.log('=== ETH DCA DIAGNOSTIC (matching friend suggestion) ===\n');

const ethDCA = {
    size: getDCASize(0, 'ETH'),
    price: 3500, // Example ETH price
};

console.log('DCA Size:', ethDCA.size, 'USD');
console.log('DCA Price:', ethDCA.price, 'USD');

const rawETH = ethDCA.size / ethDCA.price;
console.log('Raw ETH amount:', rawETH, 'ETH');

const finalQty = calculateQuantity('ETH', ethDCA.price, ethDCA.size);
console.log('Final calculated quantity:', finalQty);

console.log('\n=== WHAT DOES THIS MEAN? ===');
console.log('If finalQty is in COINS:');
console.log('  ', finalQty, 'ETH ×', ethDCA.price, '= $' + (finalQty * ethDCA.price).toFixed(2));

console.log('\nIf finalQty is in CONTRACTS (0.1 ETH each):');
console.log('  ', finalQty, 'contracts × 0.1 ETH/contract =', (finalQty * 0.1).toFixed(4), 'ETH');
console.log('  ', (finalQty * 0.1).toFixed(4), 'ETH ×', ethDCA.price, '= $' + (finalQty * 0.1 * ethDCA.price).toFixed(2));

console.log('\n=== RESULT ===');
if (Math.abs((finalQty * 0.1 * ethDCA.price) - 4.7) < 1) {
    console.log('⚠️ MATCHES $4.7 ISSUE - calculateQuantity returns COINS but code treats as CONTRACTS!');
} else if (Math.abs((finalQty * ethDCA.price) - ethDCA.size) < 1) {
    console.log('✅ calculateQuantity returns COINS correctly');
}

console.log('\n=== HARDCODED LOT SIZES IN executeOkxLimitOrder ===');
const lotSizeMap = {
    'BTC-USDT-SWAP': 0.01,
    'ETH-USDT-SWAP': 0.01,
    'SOL-USDT-SWAP': 0.1,
    'ADA-USDT-SWAP': 0.1,
};

console.log('ETH lot size:', lotSizeMap['ETH-USDT-SWAP']);
console.log('\nNote: This is LOT SIZE, not CONTRACT SIZE!');
console.log('Contract size for ETH should be 0.1 ETH per contract');
