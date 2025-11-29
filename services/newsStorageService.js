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
 * ACTUAL Schema: symbol (PK), url (SK), title, description, source, publishedAt, ttl
 */
async function saveFilteredNews(symbol, newsItems) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        console.log('⚠️ DynamoDB not configured, skipping news storage');
        return;
    }

    const storedAt = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL

    for (const news of newsItems) {
        try {
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    symbol,
                    url: news.url, // Sort key
                    title: news.title,
                    description: news.summary || '',
                    source: news.source,
                    sentiment: news.sentiment,
                    relevance: news.relevance,
                    newsHash: news.hash, // Renamed from 'hash' to avoid reserved keyword
                    publishedAt: storedAt,
                    storedAt: storedAt,
                    ttl
                }
            }));
        } catch (error) {
            console.error(`Error saving news for ${symbol}:`, error.message);
        }
    }
}

/**
 * Get existing news hashes to avoid duplicates
 * Table schema: symbol (PK), url (SK)
 */
async function getExistingNewsHashes(symbol) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        return [];
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol',
            ExpressionAttributeNames: {
                '#nh': 'newsHash' // Avoid 'hash' reserved keyword
            },
            ExpressionAttributeValues: {
                ':symbol': symbol
            },
            ProjectionExpression: '#nh, storedAt'
        }));

        // Filter by date in code since storedAt is not a key
        const recentItems = result.Items?.filter(item => {
            if (!item.storedAt) return false;
            const itemDate = new Date(item.storedAt);
            return itemDate > oneDayAgo;
        }) || [];

        return recentItems.map(item => item.newsHash).filter(Boolean);
    } catch (error) {
        // Table might not exist or no data - silently return empty array
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
 * Table schema: symbol (PK), url (SK)
 */
async function getLatestNews(symbol, limit = 3) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
        return [];
    }

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol',
            ExpressionAttributeValues: { ':symbol': symbol },
            ScanIndexForward: false, // Descending order (newest first)
            Limit: limit
        }));

        return result.Items || [];
    } catch (error) {
        // Table might not exist - silently return empty array
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
