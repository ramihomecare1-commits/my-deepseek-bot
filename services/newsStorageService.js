const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { TABLES } = require('../config/awsConfig');

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = TABLES.NEWS_ARTICLES; // Use existing 'newsArticles' table

/**
 * Calculate similarity between two strings (0-1, where 1 is identical)
 * Uses simple character-based comparison
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1;

    // Simple word-based similarity
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

/**
 * Enhanced date + title similarity deduplication (no AI required)
 * Filters out articles that are within 24 hours AND have similar titles (>70% match)
 * @param {Array} newArticles - New articles to check
 * @param {Array} existingArticles - Already stored articles
 * @returns {Array} Filtered unique articles
 */
function filterDuplicatesByDate(newArticles, existingArticles) {
    if (!existingArticles || existingArticles.length === 0) {
        return newArticles;
    }

    const uniqueArticles = [];
    const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
    const TITLE_SIMILARITY_THRESHOLD = 0.7; // 70% similar = duplicate

    for (const newArticle of newArticles) {
        let isDuplicate = false;
        const newDate = new Date(newArticle.publishedAt || newArticle.timestamp || Date.now());
        const newTitle = newArticle.title || '';

        for (const existing of existingArticles) {
            const existingDate = new Date(existing.publishedAt ? existing.publishedAt * 1000 : existing.timestamp);
            const timeDiff = Math.abs(newDate - existingDate);

            // Check if within 24 hours
            if (timeDiff < DUPLICATE_WINDOW_MS) {
                // Within time window - now check title similarity
                const similarity = calculateSimilarity(newTitle, existing.title || '');

                if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
                    // Same time window + similar title = duplicate
                    isDuplicate = true;
                    break;
                }
                // Different titles within 24h = keep both (different news events)
            }
        }

        if (!isDuplicate) {
            uniqueArticles.push(newArticle);
        }
    }

    return uniqueArticles;
}

/**
 * Save filtered news items to DynamoDB (existing newsArticles table)
 * ACTUAL Schema: symbol (PK), url (SK), title, description, source, publishedAt (Number - Unix timestamp), ttl
 * GSI: symbol-timestamp-index uses publishedAt as sort key (must be Number)
 */
async function saveFilteredNews(symbol, newsItems) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log('⚠️ DynamoDB not configured, skipping news storage');
        return;
    }

    const storedAt = new Date().toISOString();
    const publishedAtTimestamp = Math.floor(Date.now() / 1000); // Unix timestamp (Number)
    if (!articles || articles.length === 0) return;

    try {
        // Get existing articles for date-based deduplication
        // Fetch more than just the limit for deduplication purposes
        const existingArticles = await getLatestNews(symbol, 30);

        // Simple date-based deduplication (no AI)
        const uniqueArticles = filterDuplicatesByDate(articles, existingArticles);

        if (uniqueArticles.length === 0) {
            console.log(`📰 ${symbol}: All ${articles.length} articles are duplicates (within 24h of existing)`);
            return;
        }

        const duplicateCount = articles.length - uniqueArticles.length;
        if (duplicateCount > 0) {
            console.log(`📰 ${symbol}: ${articles.length} articles → ${uniqueArticles.length} unique (skipped ${duplicateCount} within 24h)`);
        }

        // Prepare items for BatchWriteCommand
        const putRequests = uniqueArticles.map(article => {
            // Ensure publishedAt is a number (Unix timestamp) for GSI
            let publishedAtTimestamp;
            if (article.publishedAt) {
                const date = new Date(article.publishedAt);
                publishedAtTimestamp = Math.floor(date.getTime() / 1000);
            } else {
                publishedAtTimestamp = Math.floor(Date.now() / 1000);
            }

            // Ensure URL is present for SK
            if (!article.url || article.url.trim() === '') {
                console.warn(`Skipping article for ${symbol} due to missing URL: ${article.title}`);
                return null; // Skip this item
            }

            return {
                PutRequest: {
                    Item: {
                        symbol: symbol, // PK
                        url: article.url, // SK
                        title: article.title || 'Untitled',
                        description: article.summary || article.description || '',
                        source: article.source?.title || article.source || 'Unknown',
                        sentiment: article.sentiment || 'neutral',
                        relevance: article.relevanceScore || 0.5, // Renamed from 'relevance' to 'relevanceScore'
                        newsHash: article.hash, // Assuming 'hash' is available in the incoming article
                        publishedAt: publishedAtTimestamp, // Number (Unix timestamp) for GSI
                        storedAt: new Date().toISOString(), // String (ISO) for display
                        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
                    }
                }
            };
        }).filter(Boolean); // Remove nulls from skipped items

        if (putRequests.length === 0) {
            console.log(`📰 ${symbol}: No valid articles to save after URL check.`);
            return;
        }

        const params = {
            RequestItems: {
                [TABLE_NAME]: putRequests
            }
        };

        await docClient.send(new BatchWriteCommand(params));
        console.log(`💾 Stored ${putRequests.length} news articles for ${symbol}`);
    } catch (error) {
        console.error(`Error saving news for ${symbol}:`, error.message);
    }
}

/**
 * Get existing news hashes to avoid duplicates
 * Uses GSI: symbol-timestamp-index (symbol + publishedAt)
 */
async function getExistingNewsHashes(symbol) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        return [];
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const oneDayAgoTimestamp = Math.floor(oneDayAgo.getTime() / 1000);

    try {
        // Use GSI to query by symbol and filter by publishedAt
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'symbol-timestamp-index', // Use the GSI
            KeyConditionExpression: 'symbol = :symbol AND publishedAt > :oneDayAgo',
            ExpressionAttributeValues: {
                ':symbol': symbol,
                ':oneDayAgo': oneDayAgoTimestamp
            },
            ProjectionExpression: 'newsHash'
        }));

        return result.Items?.map(item => item.newsHash).filter(Boolean) || [];
    } catch (error) {
        // If query fails, just return empty array
        if (error.message.includes('Requested resource not found')) {
            console.log(`⚠️ newsArticles table not found, skipping duplicate check for ${symbol}`);
        } else {
            console.error(`Error fetching existing hashes for ${symbol}:`, error.message);
        }
        return [];
    }
}

/**
 * Get latest filtered news for a coin
 * Uses GSI: symbol-timestamp-index (symbol + publishedAt)
 */
async function getLatestNews(symbol, limit = 3) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        return [];
    }

    try {
        // Use GSI to query by symbol, sorted by publishedAt
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'symbol-timestamp-index', // Use the GSI
            KeyConditionExpression: 'symbol = :symbol',
            ExpressionAttributeValues: { ':symbol': symbol },
            ScanIndexForward: false, // Descending order (newest first)
            Limit: limit
        }));

        return result.Items || [];
    } catch (error) {
        // Handle various error cases gracefully
        if (error.message.includes('Requested resource not found')) {
            console.log(`⚠️ newsArticles table not found for ${symbol}, returning empty news`);
        } else {
            console.error(`Error fetching latest news for ${symbol}:`, error.message);
        }
        return [];
    }
}

module.exports = {
    saveFilteredNews,
    getExistingNewsHashes,
    getLatestNews
};
