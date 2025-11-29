const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { TABLES } = require('../config/awsConfig');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = TABLES.NEWS_ARTICLES; // Use existing 'newsArticles' table

/**
 * Save filtered news items to DynamoDB (existing newsArticles table)
 */
async function saveFilteredNews(symbol, newsItems) {
    const timestamp = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL

    for (const news of newsItems) {
        try {
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    symbol,
                    articleId: `${symbol}#${Date.now()}#${news.title.substring(0, 50)}`,
                    title: news.title,
                    description: news.summary || '',
                    url: news.url,
                    source: news.source,
                    sentiment: news.sentiment,
                    relevance: news.relevance,
                    hash: news.hash,
                    publishedAt: timestamp,
                    storedAt: timestamp,
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
 */
async function getExistingNewsHashes(symbol) {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol AND storedAt > :oneDayAgo',
            ExpressionAttributeNames: {
                '#h': 'hash' // 'hash' is a reserved keyword in DynamoDB
            },
            ExpressionAttributeValues: {
                ':symbol': symbol,
                ':oneDayAgo': oneDayAgo.toISOString()
            },
            ProjectionExpression: '#h'
        }));

        return result.Items?.map(item => item.hash).filter(Boolean) || [];
    } catch (error) {
        console.error(`Error fetching existing hashes for ${symbol}:`, error.message);
        return [];
    }
}

/**
 * Get latest filtered news for a coin
 */
async function getLatestNews(symbol, limit = 3) {
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
        console.error(`Error fetching latest news for ${symbol}:`, error.message);
        return [];
    }
}

module.exports = {
    saveFilteredNews,
    getExistingNewsHashes,
    getLatestNews
};
