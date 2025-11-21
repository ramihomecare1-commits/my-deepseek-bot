// Manual test script to trigger orphan cleanup
const ProfessionalTradingBot = require('./bot/ProfessionalTradingBot');

async function testCleanup() {
    console.log('🧪 Testing orphan cleanup manually...');

    const bot = new ProfessionalTradingBot();
    await bot.initialize();

    console.log('\n🔄 Running cleanupOrphanedOrders()...');
    await bot.cleanupOrphanedOrders();

    console.log('\n✅ Test complete');
    process.exit(0);
}

testCleanup().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
