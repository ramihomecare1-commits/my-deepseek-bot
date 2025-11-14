/**
 * News Service - Free Public APIs
 * Fetches cryptocurrency news from multiple free sources
 */

const axios = require('axios');

// Cache for news to avoid excessive API calls
const newsCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch news from CryptoCompare (FREE, no API key required for basic usage)
 */
async function fetchCryptoCompareNews(symbol, limit = 5) {
  try {
    const cacheKey = `cc_${symbol}_${limit}`;
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    // CryptoCompare News API (free tier)
    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
      params: {
        categories: 'BTC,ETH,CRYPTO', // General crypto news
        lang: 'EN',
        sortOrder: 'latest'
      },
      timeout: 15000, // Increased timeout for news API
    });

    if (response.data && response.data.Data && Array.isArray(response.data.Data)) {
      // Filter news relevant to the symbol
      const symbolUpper = symbol.toUpperCase();
      const relevantNews = response.data.Data
        .filter(article => {
          const title = (article.title || '').toUpperCase();
          const body = (article.body || '').toUpperCase();
          return title.includes(symbolUpper) || body.includes(symbolUpper);
        })
        .slice(0, limit)
        .map(article => ({
          title: article.title,
          url: article.url,
          source: article.source || 'CryptoCompare',
          publishedAt: new Date(article.published_on * 1000),
          summary: article.body?.substring(0, 200) + '...' || '',
          sentiment: 'neutral' // CryptoCompare doesn't provide sentiment
        }));

      const result = {
        source: 'cryptocompare',
        articles: relevantNews,
        total: relevantNews.length
      };

      newsCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }

    return { source: 'cryptocompare', articles: [], total: 0 };
  } catch (error) {
    // Silently fail for timeouts - don't spam logs
    if (!error.message.includes('timeout')) {
      console.log(`⚠️ CryptoCompare news fetch failed: ${error.message}`);
    }
    return { source: 'cryptocompare', articles: [], total: 0, error: error.message };
  }
}

/**
 * Fetch news from NewsAPI.org (FREE tier - requires API key but has generous free limits)
 * Falls back to CryptoCompare if no key
 */
async function fetchNewsAPI(symbol, limit = 5) {
  try {
    const apiKey = process.env.NEWSAPI_KEY || '';
    if (!apiKey) {
      // No API key, skip NewsAPI
      return { source: 'newsapi', articles: [], total: 0, error: 'No API key' };
    }

    const cacheKey = `newsapi_${symbol}_${limit}`;
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    // NewsAPI.org - search for crypto news
    const query = `${symbol} cryptocurrency OR ${symbol} crypto`;
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: limit,
        apiKey: apiKey
      },
      timeout: 15000, // Increased timeout for news API
    });

    if (response.data && response.data.articles && Array.isArray(response.data.articles)) {
      const articles = response.data.articles.map(article => ({
        title: article.title,
        url: article.url,
        source: article.source?.name || 'NewsAPI',
        publishedAt: new Date(article.publishedAt),
        summary: article.description || article.content?.substring(0, 200) + '...' || '',
        sentiment: 'neutral' // NewsAPI doesn't provide sentiment by default
      }));

      const result = {
        source: 'newsapi',
        articles: articles,
        total: articles.length
      };

      newsCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }

    return { source: 'newsapi', articles: [], total: 0 };
  } catch (error) {
    console.log(`⚠️ NewsAPI fetch failed: ${error.message}`);
    return { source: 'newsapi', articles: [], total: 0, error: error.message };
  }
}

/**
 * Fetch news from multiple sources and merge results
 * Priority: CryptoCompare (always free) → NewsAPI (if key available)
 */
async function fetchCryptoNews(symbol, limit = 5) {
  try {
    // Fetch from both sources in parallel
    const [ccNews, newsapiNews] = await Promise.all([
      fetchCryptoCompareNews(symbol, limit),
      fetchNewsAPI(symbol, limit)
    ]);

    // Merge articles, prioritizing CryptoCompare
    const allArticles = [
      ...(ccNews.articles || []),
      ...(newsapiNews.articles || [])
    ];

    // Remove duplicates based on title similarity
    const uniqueArticles = [];
    const seenTitles = new Set();
    
    for (const article of allArticles) {
      const titleKey = article.title.toLowerCase().substring(0, 50);
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        uniqueArticles.push(article);
      }
    }

    // Sort by date (newest first) and limit
    uniqueArticles.sort((a, b) => b.publishedAt - a.publishedAt);
    const limitedArticles = uniqueArticles.slice(0, limit);

    return {
      source: 'merged',
      articles: limitedArticles,
      total: limitedArticles.length,
      sources: {
        cryptocompare: ccNews.total || 0,
        newsapi: newsapiNews.total || 0
      }
    };
  } catch (error) {
    console.log(`⚠️ News fetch failed: ${error.message}`);
    return { source: 'error', articles: [], total: 0, error: error.message };
  }
}

/**
 * Get news summary for AI analysis
 * Returns a formatted string with recent news headlines
 */
async function getNewsSummaryForAI(symbol, limit = 5) {
  try {
    const news = await fetchCryptoNews(symbol, limit);
    
    if (!news.articles || news.articles.length === 0) {
      return `No recent news found for ${symbol}.`;
    }

    const summary = news.articles.map((article, index) => {
      const date = article.publishedAt.toLocaleDateString();
      return `${index + 1}. [${date}] ${article.title} (${article.source})`;
    }).join('\n');

    return `Recent News for ${symbol}:\n${summary}`;
  } catch (error) {
    return `News fetch error for ${symbol}: ${error.message}`;
  }
}

module.exports = {
  fetchCryptoNews,
  fetchCryptoCompareNews,
  fetchNewsAPI,
  getNewsSummaryForAI
};

