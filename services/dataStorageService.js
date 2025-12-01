const { docClient, TABLES, PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand, BatchWriteCommand } = require('../config/awsConfig');
const config = require('../config/config');

/**
 * Data Storage Service
 * Stores and retrieves AI evaluations and news articles linked to trades/coins
 * Enables AI to access historical context for better evaluations
 * Now using AWS DynamoDB instead of MongoDB
 * 
 * NEW: Uses Free-tier AI to deduplicate evaluations and news before storing
 */

// Lazy load comparison service to avoid circular dependencies
let comparisonService = null;
function getComparisonService() {
  if (!comparisonService) {
    comparisonService = require('./evaluationComparisonService');
  }
  return comparisonService;
}

let useDynamoDB = false;
let dynamoInitPromise = null;
let dynamoInitInProgress = false;

/**
 * Initialize DynamoDB connection
 * Uses a promise guard to prevent multiple simultaneous initialization attempts
 */
async function initDynamoDB() {
  const hasCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  if (!hasCredentials) {
    console.log('⚠️ AWS credentials not set - data storage disabled');
    return false;
  }

  // If already initialized, return immediately
  if (useDynamoDB) {
    return true;
  }

  // If initialization is already in progress, wait for it
  if (dynamoInitInProgress && dynamoInitPromise) {
    try {
      return await dynamoInitPromise;
    } catch (error) {
      dynamoInitPromise = null;
      dynamoInitInProgress = false;
    }
  }

  // Start new initialization
  dynamoInitInProgress = true;
  dynamoInitPromise = (async () => {
    try {
      // Double-check after acquiring lock
      if (useDynamoDB) {
        return true;
      }

      // Test connection by doing a simple operation (list tables would require extra permissions)
      // For now, just mark as initialized if credentials exist
      useDynamoDB = true;
      console.log('✅ DynamoDB initialized for data storage');
      return true;
    } catch (error) {
      console.error('❌ DynamoDB initialization failed:', error.message);
      useDynamoDB = false;
      return false;
    } finally {
      dynamoInitInProgress = false;
      dynamoInitPromise = null;
    }
  })();

  return await dynamoInitPromise;
}

/**
 * Convert Date objects to timestamps recursively
 */
function convertDatesToTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.getTime();
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => convertDatesToTimestamps(item));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertDatesToTimestamps(value);
    }
    return converted;
  }

  // Return primitives as-is
  return obj;
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
    // Check connection status first (fast path)
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) {
        return false;
      }
    }

    const timestamp = evaluation.timestamp ? new Date(evaluation.timestamp).getTime() : Date.now();

    // NEW: Deduplicate evaluation data using Free Tier AI (optional)
    let dataToStore = evaluation.data;
    if (config.ENABLE_EVALUATION_DEDUPLICATION && evaluation.symbol) {
      try {
        const { compareAndExtractNewInfo } = getComparisonService();
        const comparison = await compareAndExtractNewInfo(evaluation.data, evaluation.symbol);

        if (!comparison.isNew) {
          // Evaluation is duplicate, skip storage
          return true; // Return success but don't actually store
        }

        dataToStore = comparison.newData || evaluation.data;
      } catch (dedupeError) {
        console.error(`⚠️ Evaluation deduplication failed for ${evaluation.symbol}:`, dedupeError.message);
        // Continue with original data on error
      }
    }

    // Limit context data to prevent large items (DynamoDB item limit is 400KB)
    const MAX_NEWS_ARTICLES = 5;
    const MAX_CONTEXT_SIZE = 10000;

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
          }));
      }

      // Don't store full historical data - it's too large
      if (evaluation.context.historicalData) {
        limitedContext.historicalData = {
          hasData: true,
          summary: 'Historical data available'
        };
      }

      // Limit total context size
      const contextString = JSON.stringify(limitedContext);
      if (contextString.length > MAX_CONTEXT_SIZE) {
        limitedContext = {
          news: limitedContext.news?.slice(0, 3) || [],
          historicalData: { hasData: true, summary: 'Data truncated due to size' }
        };
      }
    }

    // Convert all Date objects to timestamps before storing
    const item = {
      symbol: evaluation.symbol,
      timestamp: timestamp,
      tradeId: evaluation.tradeId || null,
      type: evaluation.type,
      data: convertDatesToTimestamps(dataToStore), // Use deduplicated data
      model: evaluation.model || 'unknown',
      context: convertDatesToTimestamps(limitedContext),
      createdAt: timestamp
    };

    // Check item size before inserting (DynamoDB limit is 400KB)
    const itemSize = JSON.stringify(item).length;
    if (itemSize > 350 * 1024) { // 350KB safety margin
      console.error(`⚠️ Item too large (${(itemSize / 1024).toFixed(2)}KB) - storing minimal version for ${evaluation.symbol}`);
      const minimalItem = {
        symbol: evaluation.symbol,
        timestamp: timestamp,
        tradeId: evaluation.tradeId || null,
        type: evaluation.type,
        data: convertDatesToTimestamps(evaluation.data),
        model: evaluation.model || 'unknown',
        createdAt: timestamp
      };
      await docClient.send(new PutCommand({
        TableName: TABLES.AI_EVALUATIONS,
        Item: minimalItem
      }));
      console.log(`💾 Stored minimal AI evaluation for ${evaluation.symbol}${evaluation.tradeId ? ` (trade: ${evaluation.tradeId})` : ''} (context removed due to size)`);
      return true;
    }

    await docClient.send(new PutCommand({
      TableName: TABLES.AI_EVALUATIONS,
      Item: item
    }));

    console.log(`💾 Stored AI evaluation for ${evaluation.symbol}${evaluation.tradeId ? ` (trade: ${evaluation.tradeId})` : ''}`);
    return true;
  } catch (error) {
    console.error('❌ Error storing AI evaluation:', error);
    // If it's a size error, try storing minimal version
    if (error.message && (error.message.includes('size') || error.message.includes('400'))) {
      try {
        const timestamp = evaluation.timestamp ? new Date(evaluation.timestamp).getTime() : Date.now();
        const minimalItem = {
          symbol: evaluation.symbol,
          timestamp: timestamp,
          tradeId: evaluation.tradeId || null,
          type: evaluation.type,
          data: evaluation.data,
          model: evaluation.model || 'unknown',
          createdAt: timestamp
        };
        await docClient.put({
          TableName: TABLES.AI_EVALUATIONS,
          Item: minimalItem
        });
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
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) {
        console.log('⚠️ Cannot store news - DynamoDB not available');
        return false;
      }
    }

    const publishedAt = news.publishedAt ? new Date(news.publishedAt).getTime() : Date.now();

    // Check if article already exists
    try {
      const existing = await docClient.send(new GetCommand({
        TableName: TABLES.NEWS_ARTICLES,
        Key: { url: news.url }
      }));

      if (existing.Item) {
        // Update existing article to add new links
        const tradeIds = existing.Item.tradeIds || [];
        if (news.tradeId && !tradeIds.includes(news.tradeId)) {
          tradeIds.push(news.tradeId);
          await docClient.send(new UpdateCommand({
            TableName: TABLES.NEWS_ARTICLES,
            Key: { url: news.url },
            UpdateExpression: 'SET tradeIds = :tradeIds, updatedAt = :now',
            ExpressionAttributeValues: {
              ':tradeIds': tradeIds,
              ':now': Date.now()
            }
          }));
        }
        return true;
      }
    } catch (getError) {
      // If get fails, continue to insert
    }

    const item = {
      url: news.url,
      symbol: news.symbol,
      tradeIds: news.tradeId ? [news.tradeId] : [],
      title: news.title,
      source: news.source,
      publishedAt: publishedAt,
      content: news.content || '',
      storedAt: Date.now(),
      createdAt: Date.now()
    };

    await docClient.send(new PutCommand({
      TableName: TABLES.NEWS_ARTICLES,
      Item: item
    }));

    console.log(`💾 Stored news article: ${news.title} for ${news.symbol}`);
    return true;
  } catch (error) {
    console.error('❌ Error storing news:', error);
    return false;
  }
}

/**
 * Store multiple news articles (batch)
 * NEW: Deduplicates news using Free-tier AI before storing
 */
async function storeNewsBatch(newsArray) {
  if (!Array.isArray(newsArray) || newsArray.length === 0) {
    return;
  }

  try {
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) return;
    }

    // Group by symbol for deduplication
    const groupedBySymbol = {};
    for (const news of newsArray) {
      const symbol = news.symbol || 'GENERAL';
      if (!groupedBySymbol[symbol]) {
        groupedBySymbol[symbol] = [];
      }
      groupedBySymbol[symbol].push(news);
    }

    let totalStored = 0;
    let totalSkipped = 0;

    // Process each symbol
    for (const [symbol, articles] of Object.entries(groupedBySymbol)) {
      let finalArticles = articles;

      // DISABLED: Free AI deduplication (now using simple date+title matching in newsStorageService)
      // if (config.ENABLE_NEWS_DEDUPLICATION) {
      //   try {
      //     const { compareAndExtractNewNews } = getComparisonService();
      //     const comparison = await compareAndExtractNewNews(articles, symbol);
      //     finalArticles = comparison.newArticles || [];
      //     totalSkipped += comparison.duplicateCount || 0;
      //   } catch (dedupeError) {
      //     console.error(`⚠️ News deduplication failed for ${symbol}:`, dedupeError.message);
      //     // Continue with original articles on error
      //   }
      // }

      // DynamoDB batch write (max 25 items per batch)
      const batches = [];
      for (let i = 0; i < finalArticles.length; i += 25) {
        batches.push(finalArticles.slice(i, i + 25));
      }

      for (const batch of batches) {
        const putRequests = batch.map(news => ({
          PutRequest: {
            Item: {
              url: news.url,
              symbol: news.symbol,
              symbols: news.symbol ? [news.symbol] : [],
              tradeIds: news.tradeId ? [news.tradeId] : [],
              title: news.title,
              source: news.source,
              publishedAt: news.publishedAt ? new Date(news.publishedAt).getTime() : Date.now(),
              content: news.content || '',
              storedAt: Date.now(),
              createdAt: Date.now()
            }
          }
        }));

        if (putRequests.length > 0) {
          await docClient.send(new BatchWriteCommand({
            RequestItems: {
              [TABLES.NEWS_ARTICLES]: putRequests
            }
          }));
          totalStored += putRequests.length;
        }
      }
    }

    console.log(`💾 Stored ${totalStored} news articles (skipped ${totalSkipped} duplicates)`);
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
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) {
        return { evaluations: [], news: [] };
      }
    }

    const { symbol, tradeId, limit = 50, days = 30 } = options;
    const cutoffTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);

    const results = {
      evaluations: [],
      news: []
    };

    // Retrieve AI evaluations
    if (symbol) {
      try {
        const evalResult = await docClient.send(new QueryCommand({
          TableName: TABLES.AI_EVALUATIONS,
          KeyConditionExpression: 'symbol = :symbol AND #ts >= :cutoff',
          ExpressionAttributeNames: {
            '#ts': 'timestamp'
          },
          ExpressionAttributeValues: {
            ':symbol': symbol,
            ':cutoff': cutoffTimestamp
          },
          Limit: limit,
          ScanIndexForward: false // Sort descending
        }));
        results.evaluations = evalResult.Items || [];
      } catch (error) {
        console.error('❌ Error querying evaluations:', error);
      }
    }

    // Retrieve news articles
    if (symbol) {
      try {
        const newsResult = await docClient.send(new QueryCommand({
          TableName: TABLES.NEWS_ARTICLES,
          IndexName: 'symbol-timestamp-index',
          KeyConditionExpression: 'symbol = :symbol AND publishedAt >= :cutoff',
          ExpressionAttributeValues: {
            ':symbol': symbol,
            ':cutoff': cutoffTimestamp
          },
          Limit: limit,
          ScanIndexForward: false
        }));
        results.news = newsResult.Items || [];
      } catch (error) {
        console.error('❌ Error querying news:', error);
      }
    }

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
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) return false;
    }

    // Get existing item first
    const existing = await docClient.send(new GetCommand({
      TableName: TABLES.NEWS_ARTICLES,
      Key: { url: newsUrl }
    }));

    if (existing.Item) {
      const tradeIds = existing.Item.tradeIds || [];
      if (!tradeIds.includes(tradeId)) {
        tradeIds.push(tradeId);
        await docClient.send(new UpdateCommand({
          TableName: TABLES.NEWS_ARTICLES,
          Key: { url: newsUrl },
          UpdateExpression: 'SET tradeIds = :tradeIds, updatedAt = :now',
          ExpressionAttributeValues: {
            ':tradeIds': tradeIds,
            ':now': Date.now()
          }
        }));
      }
    }

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
    if (!useDynamoDB) {
      const connected = await initDynamoDB();
      if (!connected) {
        return { evaluations: 0, news: 0 };
      }
    }

    // Note: DynamoDB scan with COUNT is expensive for large tables
    // For production, consider using CloudWatch metrics or maintaining a counter
    const [evalResult, newsResult] = await Promise.all([
      docClient.send(new ScanCommand({
        TableName: TABLES.AI_EVALUATIONS,
        Select: 'COUNT'
      })).catch(() => ({ Count: 0 })),
      docClient.send(new ScanCommand({
        TableName: TABLES.NEWS_ARTICLES,
        Select: 'COUNT'
      })).catch(() => ({ Count: 0 }))
    ]);

    return {
      evaluations: evalResult.Count || 0,
      news: newsResult.Count || 0
    };
  } catch (error) {
    console.error('❌ Error getting storage stats:', error);
    return { evaluations: 0, news: 0 };
  }
}

/**
 * Get historical win rate for a coin
 * @param {string} symbol - Coin symbol
 * @param {Array} closedTrades - Array of closed trades (from portfolioService)
 * @returns {number} Win rate (0-1) or null if insufficient data
 */
function getHistoricalWinRate(symbol, closedTrades = []) {
  if (!closedTrades || closedTrades.length === 0) {
    return null;
  }

  // Filter trades for this symbol
  const symbolTrades = closedTrades.filter(t =>
    t.symbol === symbol &&
    t.status === 'CLOSED' &&
    typeof t.profitLoss !== 'undefined'
  );

  if (symbolTrades.length < 5) {
    // Need at least 5 trades for reliable win rate
    return null;
  }

  const winningTrades = symbolTrades.filter(t => (t.profitLoss || 0) > 0);
  const winRate = winningTrades.length / symbolTrades.length;

  return winRate;
}

/**
 * Calculate average win and loss for a coin
 * @param {string} symbol - Coin symbol
 * @param {Array} closedTrades - Array of closed trades
 * @returns {Object} { avgWin, avgLoss, winRate } or null if insufficient data
 */
function getCoinPerformanceMetrics(symbol, closedTrades = []) {
  if (!closedTrades || closedTrades.length === 0) {
    return null;
  }

  const symbolTrades = closedTrades.filter(t =>
    t.symbol === symbol &&
    t.status === 'CLOSED' &&
    typeof t.profitLoss !== 'undefined'
  );

  if (symbolTrades.length < 5) {
    return null;
  }

  const wins = symbolTrades.filter(t => (t.profitLoss || 0) > 0);
  const losses = symbolTrades.filter(t => (t.profitLoss || 0) <= 0);

  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + (t.profitLoss || 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, t) => sum + (t.profitLoss || 0), 0) / losses.length)
    : 0;
  const winRate = wins.length / symbolTrades.length;

  return {
    avgWin,
    avgLoss,
    winRate,
    totalTrades: symbolTrades.length
  };
}

module.exports = {
  storeAIEvaluation,
  storeNews,
  storeNewsBatch,
  retrieveRelatedData,
  linkNewsToTrade,
  getStorageStats,
  initDynamoDB,
  getHistoricalWinRate,
  getCoinPerformanceMetrics
};
