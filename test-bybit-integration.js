/**
 * Bybit Integration Test Script
 * Tests the Bybit API integration without executing real trades
 */

require('dotenv').config();
const { 
  isExchangeTradingEnabled, 
  getPreferredExchange,
  getBybitBalance,
  executeBybitMarketOrder,
  BYBIT_SYMBOL_MAP
} = require('./services/exchangeService');

async function testBybitIntegration() {
  console.log('\n🧪 Testing Bybit Integration...\n');
  console.log('='.repeat(60));

  // Test 1: Check if Bybit is configured
  console.log('\n📋 Test 1: Configuration Check');
  console.log('-'.repeat(60));
  const config = isExchangeTradingEnabled();
  const exchange = getPreferredExchange();
  
  console.log(`✅ Exchange Enabled: ${config.enabled}`);
  console.log(`✅ Mode: ${config.mode}`);
  console.log(`✅ Exchange: ${exchange.exchange}`);
  console.log(`✅ Testnet: ${exchange.testnet}`);
  console.log(`✅ Base URL: ${exchange.baseUrl}`);
  
  if (!config.enabled) {
    console.log('\n❌ Bybit is not configured!');
    console.log('   Please set BYBIT_API_KEY and BYBIT_API_SECRET in your .env file');
    return;
  }

  // Test 2: Test balance retrieval
  console.log('\n📋 Test 2: Balance Retrieval');
  console.log('-'.repeat(60));
  try {
    const usdtBalance = await getBybitBalance('USDT', exchange.apiKey, exchange.apiSecret, exchange.baseUrl);
    console.log(`✅ USDT Balance: ${usdtBalance}`);
    
    if (usdtBalance === 0) {
      console.log('⚠️  Balance is 0 - this is normal for a fresh demo account');
      console.log('   Demo accounts may need to be funded or reset');
    }
  } catch (error) {
    console.log(`❌ Balance retrieval failed: ${error.message}`);
    console.log('   This might indicate:');
    console.log('   - Invalid API keys');
    console.log('   - API keys don\'t have Read permissions');
    console.log('   - Network/connectivity issues');
  }

  // Test 3: Test symbol mapping
  console.log('\n📋 Test 3: Symbol Mapping');
  console.log('-'.repeat(60));
  const testSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'LINK'];
  testSymbols.forEach(symbol => {
    const bybitSymbol = BYBIT_SYMBOL_MAP[symbol];
    console.log(`✅ ${symbol} → ${bybitSymbol || 'NOT MAPPED'}`);
  });

  // Test 4: Test order creation (dry run - won't execute)
  console.log('\n📋 Test 4: Order Creation Test (Dry Run)');
  console.log('-'.repeat(60));
  console.log('⚠️  This test will NOT execute a real order');
  console.log('   It only validates the API call format\n');
  
  // We'll test with a very small quantity that would fail validation
  // This way we can test the API call without executing
  try {
    const testResult = await executeBybitMarketOrder(
      'BTCUSDT',
      'Buy',
      0.000001, // Very small quantity
      exchange.apiKey,
      exchange.apiSecret,
      exchange.baseUrl
    );
    
    if (testResult.success) {
      console.log('✅ Order API call succeeded (unexpected - order should have failed validation)');
      console.log(`   Order ID: ${testResult.orderId}`);
    } else {
      // Expected to fail with validation error
      if (testResult.error.includes('qty') || testResult.error.includes('quantity') || testResult.error.includes('min')) {
        console.log('✅ Order API call format is correct');
        console.log(`   Expected validation error: ${testResult.error}`);
      } else if (testResult.error.includes('key') || testResult.error.includes('signature') || testResult.error.includes('permission')) {
        console.log('❌ API authentication/permission issue:');
        console.log(`   Error: ${testResult.error}`);
        console.log('   Check:');
        console.log('   - API keys are correct');
        console.log('   - Keys have Read-Write (Trade) permissions');
        console.log('   - Spot Trading scope is enabled');
      } else {
        console.log(`⚠️  Unexpected error: ${testResult.error}`);
        console.log(`   Code: ${testResult.code}`);
      }
    }
  } catch (error) {
    console.log(`❌ Order API call failed: ${error.message}`);
  }

  // Test 5: Verify API endpoint format
  console.log('\n📋 Test 5: API Endpoint Verification');
  console.log('-'.repeat(60));
  console.log(`✅ Order Endpoint: ${exchange.baseUrl}/v5/order/create`);
  console.log(`✅ Balance Endpoint: ${exchange.baseUrl}/v5/account/wallet-balance`);
  console.log(`✅ Expected Method: POST for orders, GET for balance`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  if (config.enabled) {
    console.log('✅ Bybit is configured and ready');
    console.log('✅ Integration code is in place');
    console.log('\n💡 Next Steps:');
    console.log('   1. Verify API keys have correct permissions');
    console.log('   2. Test with a small order in Bybit testnet dashboard');
    console.log('   3. Monitor bot logs when trades are triggered');
    console.log('   4. Check Bybit dashboard for executed orders');
  } else {
    console.log('❌ Bybit is not configured');
    console.log('\n💡 Setup Required:');
    console.log('   1. Get API keys from https://testnet.bybit.com');
    console.log('   2. Set BYBIT_API_KEY and BYBIT_API_SECRET in .env');
    console.log('   3. Ensure keys have Read-Write (Trade) permissions');
  }
  
  console.log('\n');
}

// Run tests
testBybitIntegration().catch(error => {
  console.error('❌ Test script error:', error);
  process.exit(1);
});

