// Test the EXACT flow that initial DCA uses
const { calculateQuantity } = require('./services/exchangeService');
const { getDCASize, getPortfolio } = require('./services/portfolioService');

console.log('=== SIMULATING INITIAL DCA FOR ETH ===\n');

// Simulate ETH trade
const symbol = 'ETH';
const dcaPrice = 3500; // Example ETH price
const dcaCount = 0;

// Step 1: Get DCA size
const dcaSizeUSD = getDCASize(dcaCount, symbol);
const portfolio = getPortfolio();
const portfolioValue = portfolio.currentBalance || portfolio.initialCapital || 5000;

console.log(`💰 DCA #${dcaCount + 1} sizing: $${dcaSizeUSD.toFixed(2)} (${((dcaSizeUSD / portfolioValue) * 100).toFixed(2)}% of portfolio)`);

// Step 2: Calculate quantity (this is what the code does)
const dcaQuantity = calculateQuantity(symbol, dcaPrice, dcaSizeUSD);

console.log(`✅ Calculated DCA quantity: ${dcaQuantity} for $${dcaSizeUSD} at $${dcaPrice.toFixed(2)}`);

// Step 3: Show what this equals in USD
const actualUSD = dcaQuantity * dcaPrice;
console.log(`\n📊 Verification:`);
console.log(`   Quantity: ${dcaQuantity} ETH`);
console.log(`   Price: $${dcaPrice}`);
console.log(`   Total USD: $${actualUSD.toFixed(2)}`);

console.log(`\n=== RESULT ===`);
if (Math.abs(actualUSD - dcaSizeUSD) > 1) {
    console.log(`❌ MISMATCH!`);
    console.log(`   Expected: $${dcaSizeUSD}`);
    console.log(`   Got: $${actualUSD.toFixed(2)}`);
    console.log(`   Difference: $${Math.abs(actualUSD - dcaSizeUSD).toFixed(2)}`);
} else {
    console.log(`✅ Correct! $${actualUSD.toFixed(2)} ≈ $${dcaSizeUSD}`);
}

// The issue might be that this quantity is in COINS but OKX needs CONTRACTS
// Let's check what happens if we accidentally use this as contracts
console.log(`\n=== IF USED AS CONTRACTS (WRONG) ===`);
// ETH contract size is 0.1 ETH per contract
const ethContractSize = 0.1;
const coinsIfUsedAsContracts = dcaQuantity * ethContractSize;
const usdIfUsedAsContracts = coinsIfUsedAsContracts * dcaPrice;
console.log(`   ${dcaQuantity} contracts × ${ethContractSize} ETH/contract = ${coinsIfUsedAsContracts} ETH`);
console.log(`   ${coinsIfUsedAsContracts} ETH × $${dcaPrice} = $${usdIfUsedAsContracts.toFixed(2)}`);

if (Math.abs(usdIfUsedAsContracts - 4.7) < 1) {
    console.log(`   ⚠️ THIS MATCHES YOUR $4.7 ISSUE!`);
}
