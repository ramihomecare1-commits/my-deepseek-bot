// Test calculateQuantity to see what it returns
const { calculateQuantity } = require('./services/exchangeService');
const { getDCASize } = require('./services/portfolioService');

console.log('=== CALCULATE QUANTITY TEST ===');

// Test ETH
const ethPrice = 3500; // Example ETH price
const ethDcaSize = getDCASize(0, 'ETH'); // Should be $50

console.log(`ETH Price: $${ethPrice}`);
console.log(`ETH DCA Size: $${ethDcaSize}`);

const ethQuantity = calculateQuantity('ETH', ethPrice, ethDcaSize);
console.log(`ETH Quantity (coins): ${ethQuantity}`);
console.log(`ETH Quantity (USD): $${(ethQuantity * ethPrice).toFixed(2)}`);

console.log('\n=== EXPECTED ===');
console.log(`Should be: ${ethDcaSize / ethPrice} ETH = $${ethDcaSize}`);

console.log('\n=== ACTUAL ===');
console.log(`Got: ${ethQuantity} ETH = $${(ethQuantity * ethPrice).toFixed(2)}`);

console.log('\n=== PROBLEM? ===');
if (Math.abs((ethQuantity * ethPrice) - ethDcaSize) > 1) {
    console.log('❌ MISMATCH! calculateQuantity is returning wrong value');
    console.log(`Expected $${ethDcaSize}, got $${(ethQuantity * ethPrice).toFixed(2)}`);
} else {
    console.log('✅ Looks correct');
}
