const cron = require('node-cron');
const { getTop100Coins } = require('../utils/helpers');
const { fetchCryptoPanicNews } = require('../services/newsService');
const { filterNewsWithAI } = require('../services/freeAIService');
const { saveFilteredNews, getExistingNewsHashes } = require('../services/newsStorageService');

/**
 * Free AI News Filtering Job
 * Runs every 12 hours to fetch, filter, and store crypto news
 */
function startNewsFilterJob() {
    console.log('📰 News Filter Job: Scheduling to run every 12 hours (00:00 and 12:00 UTC)');

    // Run every 12 hours at 00:00 and 12:00 UTC
    cron.schedule('0 */12 * * *', async () => {
        console.log('🗞️ Starting Free AI news filtering job...');
        const startTime = Date.now();

        const coins = getTop100Coins().map(c => c.symbol);
        let totalFiltered = 0;
        let totalProcessed = 0;

        for (const symbol of coins) {
            try {
                console.log(`   📡 Fetching news for ${symbol}...`);

                // 1. Fetch news from CryptoPanic API
                const rawNews = await fetchCryptoPanicNews(symbol, { limit: 50 });

                if (!rawNews || rawNews.length === 0) {
                    console.log(`   ⏭️  ${symbol}: No news available`);
                    continue;
                }

                // 2. Get existing news hashes to avoid duplicates
                const existingHashes = await getExistingNewsHashes(symbol);

                // 3. Filter with Free AI
                console.log(`   🤖 Filtering ${rawNews.length} news items for ${symbol}...`);
                const filteredNews = await filterNewsWithAI(symbol, rawNews, existingHashes);

                // 4. Save to DynamoDB
                if (filteredNews.length > 0) {
                    await saveFilteredNews(symbol, filteredNews);
                    console.log(`   ✅ ${symbol}: Filtered ${rawNews.length} → ${filteredNews.length} news items`);
                    totalFiltered += filteredNews.length;
                } else {
                    console.log(`   ⏭️  ${symbol}: No relevant news after filtering`);
                }

                totalProcessed++;

                // Rate limiting: wait 2 seconds between coins
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.error(`   ❌ ${symbol}: News filtering failed:`, error.message);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Free AI news filtering job completed in ${duration}s`);
        console.log(`   📊 Processed ${totalProcessed}/${coins.length} coins, saved ${totalFiltered} news items`);
    });

    // Run immediately on startup with first 5 coins (testing)
    console.log('🚀 Running initial news filter job (testing with 5 coins)...');
    setTimeout(async () => {
        try {
            const coins = getTop100Coins().map(c => c.symbol).slice(0, 5);
            console.log(`🗞️ Initial news filter (${coins.length} coins)...`);

            for (const symbol of coins) {
                try {
                    const rawNews = await fetchCryptoPanicNews(symbol, { limit: 20 });
                    if (rawNews && rawNews.length > 0) {
                        const existingHashes = await getExistingNewsHashes(symbol);
                        const filteredNews = await filterNewsWithAI(symbol, rawNews, existingHashes);
                        if (filteredNews.length > 0) {
                            await saveFilteredNews(symbol, filteredNews);
                            console.log(`   ✅ ${symbol}: ${filteredNews.length} news items saved`);
                        }
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`   ❌ ${symbol}:`, error.message);
                }
            }
            console.log('✅ Initial news filter completed');
        } catch (error) {
            console.error('❌ Initial news filter failed:', error.message);
        }
    }, 5000); // Wait 5 seconds after startup
}

module.exports = { startNewsFilterJob };
