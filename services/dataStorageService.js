const { MongoClient } = require('mongodb');

/**
 * Data Storage Service
 * Stores and retrieves AI evaluations and news articles linked to trades/coins
 * Enables AI to access historical context for better evaluations
 */

let mongoClient = null;
let mongoDb = null;
let useMongoDB = false;

/**
 * Initialize MongoDB connection
 */
async function initMongoDB() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log('⚠️ MONGODB_URI not set - data storage disabled');
    return false;
  }

  try {
    if (!mongoClient || !mongoDb) {
      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      useMongoDB = true;
      console.log('✅ MongoDB connected for data storage');
    }
    
    // Verify connection is still valid
    if (!mongoDb) {
      console.error('❌ MongoDB connection established but db is null');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    mongoDb = null;
    mongoClient = null;
    useMongoDB = false;
    return false;
  }
}

/**
 * Store AI evaluation
 * @param {Object} evaluation - Evaluation data
 * @param {string} evaluation.symbol - Coin symbol (e.g., 'BTC')
 * @param {string} evaluation.tradeId - Trade ID (if linked to a trade)
 * @param {string} evaluation.type - Type: 'trade_evaluation', 'coin_analysis', 'batch_analysis'
 * @param {Object} evaluation.data - Evaluation result data
 * @param {string} evaluation.model - AI model used
 * @param {Array} evaluation.context - Context data used (news, historical data, etc.)
 */
async function storeAIEvaluation(evaluation) {
  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) {
        console.log('⚠️ Cannot store AI evaluation - MongoDB not available');
        return false;
      }
    }

    if (!mongoDb) {
      console.log('⚠️ Cannot store AI evaluation - MongoDB connection not established');
      return false;
    }
    const collection = mongoDb.collection('aiEvaluations');
    
    // Limit context data to prevent MongoDB 16MB document size limit
    const MAX_NEWS_ARTICLES = 5; // Only store last 5 articles
    const MAX_CONTEXT_SIZE = 10000; // Max characters for context summary
    
    let limitedContext = {};
    if (evaluation.context) {
      // Limit news articles
      if (evaluation.context.news && Array.isArray(evaluation.context.news)) {
        limitedContext.news = evaluation.context.news
          .slice(0, MAX_NEWS_ARTICLES)
          .map(article => ({
            title: article.title?.substring(0, 200) || '',
            source: article.source || '',
            publishedAt: article.publishedAt || null
            // Don't store full content - too large
          }));
      }
      
      // Don't store full historical data - it's too large
      // Only store summary if needed
      if (evaluation.context.historicalData) {
        limitedContext.historicalData = {
          hasData: true,
          // Don't store actual arrays - they can be huge
          summary: 'Historical data available'
        };
      }
      
      // Limit total context size
      const contextString = JSON.stringify(limitedContext);
      if (contextString.length > MAX_CONTEXT_SIZE) {
        // Truncate further if still too large
        limitedContext = {
          news: limitedContext.news?.slice(0, 3) || [],
          historicalData: { hasData: true, summary: 'Data truncated due to size' }
        };
      }
    }
    
    const doc = {
      symbol: evaluation.symbol,
      tradeId: evaluation.tradeId || null,
      type: evaluation.type, // 'trade_evaluation', 'coin_analysis', 'batch_analysis'
      data: evaluation.data,
      model: evaluation.model || 'unknown',
      context: limitedContext, // Limited context to prevent size issues
      timestamp: new Date(),
      createdAt: new Date()
    };

    // Check document size before inserting (MongoDB limit is 16MB)
    const docSize = JSON.stringify(doc).length;
    if (docSize > 15 * 1024 * 1024) { // 15MB safety margin
      console.error(`⚠️ Document too large (${(docSize / 1024 / 1024).toFixed(2)}MB) - skipping storage for ${evaluation.symbol}`);
      // Store minimal version
      const minimalDoc = {
        symbol: evaluation.symbol,
        tradeId: evaluation.tradeId || null,
        type: evaluation.type,
        data: evaluation.data,
        model: evaluation.model || 'unknown',
        timestamp: new Date(),
        createdAt: new Date()
      };
      await collection.insertOne(minimalDoc);
      console.log(`💾 Stored minimal AI evaluation for ${evaluation.symbol}${evaluation.tradeId ? ` (trade: ${evaluation.tradeId})` : ''} (context removed due to size)`);
      return true;
    }

    await collection.insertOne(doc);
    console.log(`💾 Stored AI evaluation for ${evaluation.symbol}${evaluation.tradeId ? ` (trade: ${evaluation.tradeId})` : ''}`);
    return true;
  } catch (error) {
    console.error('❌ Error storing AI evaluation:', error);
    // If it's a size error, try storing minimal version
    if (error.message && error.message.includes('out of range')) {
      try {
        const collection = mongoDb.collection('aiEvaluations');
        const minimalDoc = {
          symbol: evaluation.symbol,
          tradeId: evaluation.tradeId || null,
          type: evaluation.type,
          data: evaluation.data,
          model: evaluation.model || 'unknown',
          timestamp: new Date(),
          createdAt: new Date()
        };
        await collection.insertOne(minimalDoc);
        console.log(`💾 Stored minimal AI evaluation for ${evaluation.symbol} (context removed due to size error)`);
        return true;
      } catch (retryError) {
        console.error('❌ Failed to store minimal evaluation:', retryError.message);
        return false;
      }
    }
    return false;
  }
}

/**
 * Store news article
 * @param {Object} news - News data
 * @param {string} news.symbol - Coin symbol (e.g., 'BTC')
 * @param {string} news.tradeId - Trade ID (if linked to a trade)
 * @param {string} news.title - Article title
 * @param {string} news.source - News source
 * @param {string} news.url - Article URL
 * @param {string} news.publishedAt - Publication date
 * @param {string} news.content - Article content/snippet
 */
async function storeNews(news) {
  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) {
        console.log('⚠️ Cannot store news - MongoDB not available');
        return false;
      }
    }

    if (!mongoDb) {
      console.log('⚠️ Cannot store news - MongoDB connection not established');
      return false;
    }
    const collection = mongoDb.collection('newsArticles');
    
    // Check if article already exists (by URL to avoid duplicates)
    const existing = await collection.findOne({ url: news.url });
    if (existing) {
      // Update existing article to add new links
      if (news.tradeId && !existing.tradeIds) {
        existing.tradeIds = [];
      }
      if (news.tradeId && existing.tradeIds && !existing.tradeIds.includes(news.tradeId)) {
        existing.tradeIds.push(news.tradeId);
        await collection.updateOne(
          { _id: existing._id },
          { $set: { tradeIds: existing.tradeIds, updatedAt: new Date() } }
        );
      }
      return true;
    }
    
    const doc = {
      symbol: news.symbol,
      tradeIds: news.tradeId ? [news.tradeId] : [],
      title: news.title,
      source: news.source,
      url: news.url,
      publishedAt: news.publishedAt ? new Date(news.publishedAt) : new Date(),
      content: news.content || '',
      storedAt: new Date(),
      createdAt: new Date()
    };

    await collection.insertOne(doc);
    console.log(`💾 Stored news article: ${news.title} for ${news.symbol}`);
    return true;
  } catch (error) {
    console.error('❌ Error storing news:', error);
    return false;
  }
}

/**
 * Store multiple news articles (batch)
 */
async function storeNewsBatch(newsArray) {
  if (!Array.isArray(newsArray) || newsArray.length === 0) {
    return;
  }

  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) return;
    }

    if (!mongoDb) {
      console.log('⚠️ Cannot store news batch - MongoDB connection not established');
      return;
    }
    
    // Double-check mongoDb is still valid
    if (!mongoDb || typeof mongoDb.collection !== 'function') {
      console.log('⚠️ MongoDB collection method not available, skipping news batch storage');
      return;
    }
    
    const collection = mongoDb.collection('newsArticles');
    const operations = [];

    for (const news of newsArray) {
      // Check if exists
      const existing = await collection.findOne({ url: news.url });
      if (existing) {
        // Update to add symbol/tradeId if not present
        const update = {};
        if (news.symbol && !existing.symbols) {
          update.symbols = [news.symbol];
        } else if (news.symbol && existing.symbols && !existing.symbols.includes(news.symbol)) {
          update.symbols = [...existing.symbols, news.symbol];
        }
        if (news.tradeId && existing.tradeIds && !existing.tradeIds.includes(news.tradeId)) {
          update.tradeIds = [...(existing.tradeIds || []), news.tradeId];
        }
        if (Object.keys(update).length > 0) {
          update.updatedAt = new Date();
          operations.push({
            updateOne: {
              filter: { _id: existing._id },
              update: { $set: update }
            }
          });
        }
      } else {
        // Insert new
        const doc = {
          symbol: news.symbol,
          symbols: news.symbol ? [news.symbol] : [],
          tradeIds: news.tradeId ? [news.tradeId] : [],
          title: news.title,
          source: news.source,
          url: news.url,
          publishedAt: news.publishedAt ? new Date(news.publishedAt) : new Date(),
          content: news.content || '',
          storedAt: new Date(),
          createdAt: new Date()
        };
        operations.push({ insertOne: { document: doc } });
      }
    }

    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: false });
      console.log(`💾 Stored ${operations.length} news articles`);
    }
  } catch (error) {
    console.error('❌ Error storing news batch:', error);
  }
}

/**
 * Retrieve all data related to a coin or trade for AI evaluation
 * @param {Object} options
 * @param {string} options.symbol - Coin symbol
 * @param {string} options.tradeId - Trade ID (optional)
 * @param {number} options.limit - Limit number of results (default: 50)
 * @param {number} options.days - Number of days to look back (default: 30)
 * @returns {Object} Object with evaluations and news
 */
async function retrieveRelatedData(options) {
  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) {
        return { evaluations: [], news: [] };
      }
    }

    const { symbol, tradeId, limit = 50, days = 30 } = options;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const results = {
      evaluations: [],
      news: []
    };

    // Retrieve AI evaluations
    if (!mongoDb) {
      console.log('⚠️ MongoDB not connected for retrieveRelatedData, returning empty data');
      return { evaluations: [], news: [] };
    }
    const evalCollection = mongoDb.collection('aiEvaluations');
    const evalQuery = {
      timestamp: { $gte: cutoffDate }
    };
    
    if (tradeId) {
      evalQuery.tradeId = tradeId;
    } else if (symbol) {
      evalQuery.symbol = symbol;
    }

    const evaluations = await evalCollection
      .find(evalQuery)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    results.evaluations = evaluations.map(evaluation => {
      const { _id, ...data } = evaluation;
      return data;
    });

    // Retrieve news articles
    const newsCollection = mongoDb.collection('newsArticles');
    const newsQuery = {
      storedAt: { $gte: cutoffDate }
    };

    if (tradeId) {
      newsQuery.tradeIds = tradeId;
    } else if (symbol) {
      newsQuery.$or = [
        { symbol: symbol },
        { symbols: symbol }
      ];
    }

    const news = await newsCollection
      .find(newsQuery)
      .sort({ publishedAt: -1 })
      .limit(limit)
      .toArray();

    results.news = news.map(article => {
      const { _id, ...data } = article;
      return data;
    });

    console.log(`📚 Retrieved ${results.evaluations.length} evaluations and ${results.news.length} news articles for ${symbol}${tradeId ? ` (trade: ${tradeId})` : ''}`);
    return results;
  } catch (error) {
    console.error('❌ Error retrieving related data:', error);
    return { evaluations: [], news: [] };
  }
}

/**
 * Link news to a trade
 */
async function linkNewsToTrade(newsUrl, tradeId) {
  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) return false;
    }

    if (!mongoDb) {
      return false;
    }
    const collection = mongoDb.collection('newsArticles');
    await collection.updateOne(
      { url: newsUrl },
      { 
        $addToSet: { tradeIds: tradeId },
        $set: { updatedAt: new Date() }
      }
    );
    return true;
  } catch (error) {
    console.error('❌ Error linking news to trade:', error);
    return false;
  }
}

/**
 * Get statistics about stored data
 */
async function getStorageStats() {
  try {
    if (!useMongoDB || !mongoDb) {
      const connected = await initMongoDB();
      if (!connected || !mongoDb) {
        return { evaluations: 0, news: 0 };
      }
    }

    if (!mongoDb) {
      return { evaluations: 0, news: 0 };
    }
    const evalCollection = mongoDb.collection('aiEvaluations');
    const newsCollection = mongoDb.collection('newsArticles');

    const [evalCount, newsCount] = await Promise.all([
      evalCollection.countDocuments(),
      newsCollection.countDocuments()
    ]);

    return {
      evaluations: evalCount,
      news: newsCount
    };
  } catch (error) {
    console.error('❌ Error getting storage stats:', error);
    return { evaluations: 0, news: 0 };
  }
}

module.exports = {
  storeAIEvaluation,
  storeNews,
  storeNewsBatch,
  retrieveRelatedData,
  linkNewsToTrade,
  getStorageStats,
  initMongoDB
};

