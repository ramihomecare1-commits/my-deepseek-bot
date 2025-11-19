#!/usr/bin/env node

/**
 * Test OKX Account Mode Verification
 * Run: node test-account-mode.js
 */

const { getPreferredExchange, verifyOkxAccountMode } = require('./services/exchangeService');

async function testAccountMode() {
  console.log('🔍 Testing OKX Account Mode Verification...\n');
  
  const exchange = getPreferredExchange();
  
  if (exchange.exchange !== 'OKX') {
    console.log('❌ OKX is not configured');
    console.log('💡 Please set OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE in your environment variables');
    process.exit(1);
  }
  
  console.log('📋 Configuration:');
  console.log(`   Exchange: ${exchange.exchange}`);
  console.log(`   Base URL: ${exchange.baseUrl}`);
  console.log(`   Testnet: ${exchange.testnet ? 'Yes' : 'No'}\n`);
  
  try {
    const result = await verifyOkxAccountMode(
      exchange.apiKey,
      exchange.apiSecret,
      exchange.passphrase,
      exchange.baseUrl
    );
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 VERIFICATION RESULTS');
    console.log('='.repeat(60));
    
    if (result.success) {
      console.log(`\n📋 Detected Account Mode: ${result.accountMode}`);
      console.log(`\n📊 Derivatives Support: ${result.supportsDerivatives ? '✅ YES' : '❌ NO'}`);
      console.log(`📊 SWAP Instruments: ${result.canAccessSwapInstruments ? `✅ YES (${result.swapInstrumentsCount} available)` : '❌ NO'}`);
      
      console.log(`\n💰 Balance Fields:`);
      console.log(`   - notionalUsdForSwap: ${result.balanceFields.hasNotionalUsdForSwap ? '✅' : '❌'}`);
      console.log(`   - isoEq: ${result.balanceFields.hasIsoEq ? '✅' : '❌'}`);
      console.log(`   - details: ${result.balanceFields.hasDetails ? '✅' : '❌'}`);
      console.log(`   - adjEq: ${result.balanceFields.hasAdjEq ? '✅' : '❌'}`);
      console.log(`   - Total Equity: ${result.balanceFields.totalEq} USD`);
      
      if (result.instrumentsError) {
        console.log(`\n⚠️ Instruments API Error: ${result.instrumentsError}`);
      }
      
      console.log(`\n💡 ${result.recommendation}`);
      
      if (!result.supportsDerivatives) {
        console.log(`\n📝 To fix this:`);
        console.log(`   1. Go to https://www.okx.com`);
        console.log(`   2. Log in to your DEMO account`);
        console.log(`   3. Navigate to: Trade → Futures → Settings`);
        console.log(`   4. Find "Trading Mode" option`);
        console.log(`   5. Select "Futures mode" or "Multi-currency margin mode"`);
        console.log(`   6. Click "Switch" to confirm`);
        console.log(`   7. Wait a few seconds, then test again`);
      }
    } else {
      console.log(`\n❌ Verification Failed:`);
      console.log(`   Error: ${result.error}`);
      console.log(`\n💡 ${result.recommendation}`);
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Exit with appropriate code
    process.exit(result.success && result.supportsDerivatives ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testAccountMode();




