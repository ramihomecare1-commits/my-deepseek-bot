const { fetchCryptoNews } = require('../services/newsService');
const { storeNewsArticle, getStoredNews } = require('../services/dynamoService');

/**
 * Background job that fetches and filters news using free AI
 * Runs independently of the main bot scan cycle to save premium AI costs
 */
class NewsFilterJob {
    constructor() {
        this.isRunning = false;
        this.interval = (process.env.NEWS_FILTER_INTERVAL_MINUTES || 30) * 60 * 1000;
        this.trackedCoins = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT'];
        this.timer = null;
    }

    async start() {
        if (this.isRunning) {
            console.log('⚠️ News filter job already running');
            return;
        }

        // Check if feature is enabled
        if (process.env.NEWS_FILTER_ENABLED !== 'true') {
            console.log('ℹ️ News filter job disabled (NEWS_FILTER_ENABLED=false)');
            return;
        }

        this.isRunning = true;
        console.log('🔄 Starting background news filter job...');
        console.log(`   Interval: ${this.interval / 60000} minutes`);
        console.log(`   Coins: ${this.trackedCoins.join(', ')}`);

        // Run immediately on start
        await this.filterNews();

        // Then run on interval
        this.timer = setInterval(() => {
            this.filterNews().catch(err => {
                console.error('❌ News filter job error:', err.message);
            });
        }, this.interval);
    }

    async filterNews() {
        console.log('\n🔍 [News Filter Job] Starting news fetch and filter...');
        const startTime = Date.now();
        let totalUnique = 0;
        let totalDuplicates = 0;

        for (const symbol of this.trackedCoins) {
            try {
                // Fetch latest news
                const newArticles = await fetchCryptoNews(symbol, 5);

                if (!newArticles || newArticles.length === 0) {
                    console.log(`   📰 ${symbol}: No new articles found`);
                    continue;
                }

                // Get stored news for comparison
                const storedNews = await getStoredNews(symbol, 30);

                if (storedNews.length === 0) {
                    // No stored news, save all
                    for (const article of newArticles) {
                        await storeNewsArticle(symbol, article);
                    }
                    console.log(`   ✅ ${symbol}: Stored ${newArticles.length} articles (first run)`);
                    totalUnique += newArticles.length;
                    continue;
                }

                // Filter duplicates using FREE AI
                const uniqueArticles = await this.filterDuplicatesWithFreeAI(
                    symbol,
                    newArticles,
                    storedNews
                );

                // Store unique articles
                for (const article of uniqueArticles) {
                    await storeNewsArticle(symbol, article);
                }

                const duplicateCount = newArticles.length - uniqueArticles.length;
                totalUnique += uniqueArticles.length;
                totalDuplicates += duplicateCount;

                console.log(`   ✅ ${symbol}: ${uniqueArticles.length} unique, ${duplicateCount} duplicates filtered`);

            } catch (error) {
                console.error(`   ❌ ${symbol}: Error filtering news:`, error.message);
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [News Filter Job] Completed in ${duration}s - ${totalUnique} unique, ${totalDuplicates} duplicates\n`);
    }

    async filterDuplicatesWithFreeAI(symbol, newArticles, storedNews) {
        // Import free AI function
        const { callFreeAI } = require('../services/aiService');

        const prompt = `Compare these ${newArticles.length} new ${symbol} news articles with ${storedNews.length} stored articles.
Return ONLY the indices (0-based) of NEW articles that are NOT duplicates.

NEW ARTICLES:
${newArticles.map((a, i) => `[${i}] ${a.title} - ${a.description?.substring(0, 100) || 'No description'}`).join('\n')}

STORED ARTICLES:
${storedNews.map(a => `${a.title} - ${a.description?.substring(0, 100) || 'No description'}`).join('\n')}

Return ONLY a JSON array of indices, nothing else. Example: [0,2,4]`;

        try {
            const response = await callFreeAI(prompt);

            // Extract JSON array from response
            const jsonMatch = response.match(/\[[\d,\s]+\]/);
            if (!jsonMatch) {
                console.warn(`   ⚠️ ${symbol}: Free AI response not in expected format, keeping all`);
                return newArticles;
            }

            const indices = JSON.parse(jsonMatch[0]);
            const uniqueArticles = indices.map(i => newArticles[i]).filter(Boolean);

            return uniqueArticles.length > 0 ? uniqueArticles : newArticles;

        } catch (error) {
            console.error(`   ⚠️ ${symbol}: Free AI filtering failed, keeping all:`, error.message);
            return newArticles; // Fallback: keep all if AI fails
        }
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
        console.log('🛑 News filter job stopped');
    }
}

module.exports = new NewsFilterJob();
