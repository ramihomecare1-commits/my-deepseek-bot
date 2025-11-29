const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
    const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL

    let savedCount = 0;
    let skippedCount = 0;

    for (const news of newsItems) {
        // Skip items without URL (url is the sort key and cannot be empty)
        if (!news.url || news.url.trim() === '') {
            skippedCount++;
            continue;
        }

        try {
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    symbol,
                    url: news.url, // Sort key (required, cannot be empty)
                    title: news.title || 'Untitled',
                    description: news.summary || '',
                    source: news.source || 'Unknown',
                    sentiment: news.sentiment,
                    relevance: news.relevance,
                    newsHash: news.hash, // Renamed from 'hash' to avoid reserved keyword
                    publishedAt: publishedAtTimestamp, // Number (Unix timestamp) for GSI
                    storedAt: storedAt, // String (ISO) for display
                    ttl
                }
            }));
            savedCount++;
        } catch (error) {
            console.error(`Error saving news for ${symbol}:`, error.message);
        }
    }

    if (skippedCount > 0) {
        console.log(`⚠️ ${symbol}: Skipped ${skippedCount} news items without URLs`);
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
