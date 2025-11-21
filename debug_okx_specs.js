// Quick script to fetch OKX instrument specifications
const https = require('https');

const symbols = ['ADA-USDT-SWAP', 'XRP-USDT-SWAP', 'BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];

async function getInstrumentSpecs(symbol) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.okx.com',
            path: `/api/v5/public/instruments?instType=SWAP&instId=${symbol}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.code === '0' && json.data && json.data[0]) {
                        const inst = json.data[0];
                        resolve({
                            symbol: inst.instId,
                            ctVal: inst.ctVal,        // Contract value (our contractSize)
                            lotSz: inst.lotSz,        // Lot size
                            minSz: inst.minSz,        // Minimum order size
                            ctMult: inst.ctMult,      // Contract multiplier
                            ctValCcy: inst.ctValCcy   // Contract value currency
                        });
                    } else {
                        reject(new Error(`Failed to get specs for ${symbol}: ${json.msg}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function main() {
    console.log('Fetching OKX instrument specifications...\n');

    for (const symbol of symbols) {
        try {
            const specs = await getInstrumentSpecs(symbol);
            console.log(`${specs.symbol}:`);
            console.log(`  Contract Value (ctVal): ${specs.ctVal} ${specs.ctValCcy}`);
            console.log(`  Lot Size (lotSz): ${specs.lotSz}`);
            console.log(`  Min Size (minSz): ${specs.minSz}`);
            console.log(`  Contract Mult (ctMult): ${specs.ctMult}`);
            console.log('');
        } catch (error) {
            console.error(`Error fetching ${symbol}:`, error.message);
        }
    }
}

main();
