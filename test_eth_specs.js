// Test to fetch LIVE OKX contract specs for ETH
const { fetchOkxContractSpecs, getPreferredExchange } = require('./services/exchangeService');

async function testETHSpecs() {
    const exchange = getPreferredExchange();

    console.log('=== FETCHING LIVE OKX SPECS FOR ETH ===');

    const specs = await fetchOkxContractSpecs(['ETH-USDT-SWAP'], exchange.baseUrl);
    const ethSpec = specs.get('ETH-USDT-SWAP');

    if (ethSpec) {
        console.log('ETH-USDT-SWAP Specs:');
        console.log('  Contract Value (ctVal):', ethSpec.ctVal, 'ETH per contract');
        console.log('  Minimum Size (minSz):', ethSpec.minSz, 'contracts');
        console.log('  Lot Size (lotSz):', ethSpec.lotSz, 'contracts');
        console.log('  Contract Multiplier (ctMult):', ethSpec.ctMult);

        console.log('\n=== CALCULATION TEST ===');
        const dcaSize = 50; // $50
        const ethPrice = 3500; // $3500

        console.log(`DCA Size: $${dcaSize}`);
        console.log(`ETH Price: $${ethPrice}`);

        const coinQty = dcaSize / ethPrice;
        console.log(`Coin Quantity: ${coinQty} ETH`);

        const contracts = coinQty / ethSpec.ctVal;
        console.log(`Contract Quantity: ${contracts} contracts`);

        const rounded = Math.floor(contracts / ethSpec.lotSz) * ethSpec.lotSz;
        console.log(`Rounded to lot size: ${rounded} contracts`);

        const finalETH = rounded * ethSpec.ctVal;
        const finalUSD = finalETH * ethPrice;
        console.log(`Final: ${finalETH} ETH = $${finalUSD.toFixed(2)}`);

        if (Math.abs(finalUSD - 4.7) < 1) {
            console.log('\n⚠️ THIS MATCHES THE $4.7 ISSUE!');
        }
    } else {
        console.log('❌ Could not fetch ETH specs');
    }
}

testETHSpecs().catch(console.error);
