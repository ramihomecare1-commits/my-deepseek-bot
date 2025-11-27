// Test script to fetch and display OKX contract specifications
require('dotenv').config();
const { fetchOkxContractSpecs } = require('./services/exchangeService');

const symbols = [
    'BTC-USDT-SWAP',
    'ETH-USDT-SWAP',
    'ADA-USDT-SWAP',
    'AVAX-USDT-SWAP',
    'SOL-USDT-SWAP'
];

async function testContractSpecs() {
    console.log('🧪 Testing OKX Contract Specs Fetching\n');

    const specs = await fetchOkxContractSpecs(symbols);

    console.log('\n📊 Results:');
    console.log('='.repeat(80));

    for (const [symbol, data] of specs.entries()) {
        console.log(`\n${symbol}:`);
        console.log(`  Contract Value (ctVal): ${data.ctVal} (1 contract = ${data.ctVal} coins)`);
        console.log(`  Minimum Size (minSz): ${data.minSz} contracts`);
        console.log(`  Lot Size (lotSz): ${data.lotSz} contracts`);
        console.log(`  Contract Multiplier: ${data.ctMult}`);
        console.log(`  Value Currency: ${data.ctValCcy}`);

        // Calculate example order
        const usdAmount = symbol.includes('BTC') ? 100 : 50;
        const examplePrice = symbol.includes('BTC') ? 84000 :
            symbol.includes('ETH') ? 2800 :
                symbol.includes('ADA') ? 0.50 :
                    symbol.includes('AVAX') ? 35 : 100;

        const coinQuantity = usdAmount / examplePrice;
        const contracts = coinQuantity / data.ctVal;

        console.log(`  Example: $${usdAmount} @ $${examplePrice} = ${coinQuantity.toFixed(6)} coins = ${contracts.toFixed(4)} contracts`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Test complete!\n');
}

testContractSpecs().catch(console.error);
