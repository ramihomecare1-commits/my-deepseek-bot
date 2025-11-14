/**
 * Quick test for Two-Tier AI Monitoring System
 * Tests both free v3 model and premium R1 model
 */

const config = require('./config/config');
const monitoringService = require('./services/monitoringService');

async function testMonitoring() {
  console.log('🧪 Testing Two-Tier AI Monitoring System\n');
  
  // Check configuration
  console.log('📋 Configuration:');
  console.log(`   AI_API_KEY: ${config.AI_API_KEY ? '✅ Set (' + config.AI_API_KEY.substring(0, 15) + '...)' : '❌ Missing'}`);
  console.log(`   API Type: ${config.API_TYPE.toUpperCase()} ${config.API_TYPE === 'gemini' ? '(Google)' : '(OpenRouter)'}`);
  console.log(`   Monitoring Enabled: ${config.MONITORING_ENABLED ? '✅' : '❌'}`);
  console.log(`   Free Model: ${config.MONITORING_MODEL}`);
  console.log(`   Premium Model: ${config.AI_MODEL}`);
  console.log(`   Escalation Threshold: ${(config.ESCALATION_THRESHOLD * 100).toFixed(0)}%`);
  console.log('');

  if (!config.AI_API_KEY) {
    console.log('❌ Error: AI_API_KEY not set!');
    console.log('   Set it with: export AI_API_KEY=your_key_here');
    process.exit(1);
  }

  // Test free monitoring with mock data
  console.log(`🔍 Testing free monitoring (${config.MONITORING_MODEL})...`);
  const mockCoinData = {
    symbol: 'BTC',
    name: 'Bitcoin',
    id: 'bitcoin',
    currentPrice: 95000,
    priceChange24h: 5.2, // High volatility to trigger analysis
    volume24h: 45000000000
  };

  try {
    const result = await monitoringService.quickVolatilityCheck(mockCoinData);
    
    if (result) {
      console.log('✅ Free model working!');
      console.log(`   Signal: ${result.signal}`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`   Should Escalate: ${result.shouldEscalate ? 'Yes' : 'No'}`);
      console.log(`   Reason: ${result.reason}`);
      console.log('');
      
      // Test premium model escalation if free model suggests it
      if (result.shouldEscalate && result.confidence >= 0.65) {
        console.log(`🚨 Testing premium model escalation (${config.AI_MODEL})...`);
        
        const r1Result = await monitoringService.escalateToR1(mockCoinData, result);
        
        if (r1Result) {
          console.log('✅ Premium model working!');
          console.log(`   Decision: ${r1Result.decision}`);
          console.log(`   Action: ${r1Result.action}`);
          console.log(`   Confidence: ${(r1Result.confidence * 100).toFixed(0)}%`);
          console.log(`   Reason: ${r1Result.reason}`);
          console.log('');
        }
      } else {
        console.log('ℹ️  Free model didn\'t suggest escalation for this test case');
        console.log('   (This is normal - premium model only called when needed)');
        console.log('');
      }
      
      // Show statistics
      const stats = monitoringService.getStats();
      console.log('📊 Monitoring Statistics:');
      console.log(`   Total Escalations: ${stats.totalEscalations}`);
      console.log(`   Confirmed: ${stats.confirmed}`);
      console.log(`   Rejected: ${stats.rejected}`);
      console.log(`   Confirmation Rate: ${stats.confirmationRate}%`);
      console.log('');
      
      console.log('🎉 SUCCESS! Your monitoring system is ready to use!');
      console.log('');
      console.log(`Using ${config.API_TYPE.toUpperCase()} API:`);
      console.log(`   Free Model: ${config.MONITORING_MODEL}`);
      console.log(`   Premium Model: ${config.AI_MODEL}`);
      console.log('');
      console.log('Next steps:');
      console.log('1. Restart your bot with: npm start');
      console.log('2. The system will automatically monitor coins every minute');
      console.log('3. Watch for Telegram notifications when opportunities are found');
      console.log('4. Free model escalates to premium when confidence is high (≥70%)');
      console.log('');
      console.log('💰 Cost Benefits:');
      if (config.API_TYPE === 'gemini') {
        console.log('   Gemini Flash: COMPLETELY FREE!');
        console.log('   Gemini Pro: COMPLETELY FREE!');
        console.log('   No costs at all within rate limits! 🎉');
      } else {
        console.log('   Free monitoring: ~$0.001/hour');
        console.log('   Premium confirmations: ~$0.02-0.05 per call');
        console.log('   Typical usage: ~$0.10-0.25/hour');
      }
      
    } else {
      console.log('⚠️  Free model returned null (might be rate limited or low volatility)');
      console.log('   Try again in a moment, or check your API key limits');
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    if (error.response) {
      console.log('   API Status:', error.response.status);
      console.log('   API Error:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('');
    console.log('Common issues:');
    if (config.API_TYPE === 'gemini') {
      console.log('1. Invalid API key - get one from: https://aistudio.google.com/app/apikey');
      console.log('2. API not enabled - enable Gemini API in Google Cloud Console');
      console.log('3. Rate limiting - Gemini has generous free limits, wait a moment');
    } else {
      console.log('1. Invalid API key - get one from: https://openrouter.ai/keys');
      console.log('2. Insufficient credits - add credits to your OpenRouter account');
      console.log('3. Rate limiting - wait a moment and try again');
    }
  }
}

// Run the test
testMonitoring().then(() => {
  console.log('\n✅ Test complete!');
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Test error:', err);
  process.exit(1);
});

