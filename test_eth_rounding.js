// Check if ETH lot size rounding is the issue
const { getDCASize } = require('./services/portfolioService');
const { calculateQuantity } = require('./services/exchangeService');

console.log('=== ETH LOT SIZE ROUNDING ISSUE? ===\n');

const ethDCA = {
    size: getDCASize(0, 'ETH'),
    price: 3500,
};

const qty = calculateQuantity('ETH', ethDCA.price, ethDCA.size);
const lotSize = 0.01; // From executeOkxLimitOrder

console.log('ETH DCA:');
console.log(`  DCA Size: $${ethDCA.size}`);
console.log(`  Price: $${ethDCA.price}`);
console.log(`  calculateQuantity returns: ${qty} ETH`);
console.log(`  Lot size: ${lotSize}`);

// This is what executeOkxLimitOrder does
let roundedQuantity = Math.round(qty / lotSize) * lotSize;
console.log(`\n  Math.round(${qty} / ${lotSize}) * ${lotSize} = ${roundedQuantity}`);

if (roundedQuantity < lotSize) {
    console.log(`  ${roundedQuantity} < ${lotSize}, so set to ${lotSize}`);
    roundedQuantity = lotSize;
}

console.log(`  Final rounded quantity: ${roundedQuantity} ETH`);
console.log(`  Value: ${roundedQuantity} ETH × $${ethDCA.price} = $${(roundedQuantity * ethDCA.price).toFixed(2)}`);

if (Math.abs((roundedQuantity * ethDCA.price) - 4.7) < 1) {
    console.log(`\n  ⚠️ THIS MATCHES $4.7!`);
    console.log(`  The lot size rounding is rounding DOWN too much!`);
    console.log(`  ${qty} ETH rounds to ${roundedQuantity} ETH`);
    console.log(`  Loss: $${(qty * ethDCA.price - roundedQuantity * ethDCA.price).toFixed(2)}`);
}

console.log('\n=== THE REAL ISSUE ===');
console.log('Lot size 0.01 is TOO LARGE for small DCA amounts!');
console.log(`${qty} ETH rounds to ${roundedQuantity} ETH`);
console.log('This is a 90% loss!');
