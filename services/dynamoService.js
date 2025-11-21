const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * DynamoDB service for storing and retrieving news articles
 * Uses AWS DynamoDB to persist news data for duplicate filtering
 */

// Initialize DynamoDB client
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
});

const docClient = DynamoDBDocumentClient.from(client);

const NEWS_TABLE_NAME = process.env.DYNAMODB_NEWS_TABLE || 'crypto-news';

/**
 * Store a news article in DynamoDB
 * @param {string} symbol - Crypto symbol (e.g., 'BTC')
 * @param {object} article - News article object
 * @returns {Promise<void>}
 */
async function storeNewsArticle(symbol, article) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log('⚠️ DynamoDB not configured, skipping news storage');
        return;
    }

    try {
        const item = {
            symbol: symbol,
            articleId: `${symbol}#${Date.now()}#${article.title.substring(0, 50)}`,
            title: article.title,
            description: article.description || '',
            url: article.url || '',
            source: article.source || 'Unknown',
            publishedAt: article.publishedAt || new Date().toISOString(),
            storedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
        };

        await docClient.send(new PutCommand({
            TableName: NEWS_TABLE_NAME,
            Item: item
        }));

        console.log(`   ✅ Stored news for ${symbol}: ${article.title.substring(0, 60)}...`);
    } catch (error) {
        console.error(`   ❌ Error storing news for ${symbol}:`, error.message);
        // Don't throw - news storage is not critical
    }
}

/**
 * Retrieve stored news articles for a symbol
 * @param {string} symbol - Crypto symbol (e.g., 'BTC')
 * @param {number} days - Number of days to look back (default: 30)
 * @returns {Promise<Array>} Array of news articles
 */
async function getStoredNews(symbol, days = 30) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log('⚠️ DynamoDB not configured, returning empty news array');
        return [];
    }

    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const response = await docClient.send(new QueryCommand({
            TableName: NEWS_TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol AND storedAt > :cutoff',
            ExpressionAttributeValues: {
                ':symbol': symbol,
                ':cutoff': cutoffDate.toISOString()
            },
            ScanIndexForward: false, // Most recent first
            Limit: 100
        }));

        return response.Items || [];
    } catch (error) {
        console.error(`   ❌ Error retrieving news for ${symbol}:`, error.message);
        return []; // Return empty array on error
    }
}

/**
 * Check if DynamoDB is configured and accessible
 * @returns {Promise<boolean>}
 */
async function isDynamoDBConfigured() {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
        return false;
    }

    try {
        // Try a simple query to verify connection
        await docClient.send(new QueryCommand({
            TableName: NEWS_TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol',
            ExpressionAttributeValues: {
                ':symbol': 'TEST'
            },
            Limit: 1
        }));
        return true;
    } catch (error) {
        console.warn('⚠️ DynamoDB connection test failed:', error.message);
        return false;
    }
}

module.exports = {
    storeNewsArticle,
    getStoredNews,
    isDynamoDBConfigured
};
