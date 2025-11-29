const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'crypto-news';

/**
 * Save filtered news items to DynamoDB
 */
async function saveFilteredNews(symbol, newsItems) {
    const timestamp = Math.floor(Date.now() / 1000);
    const expiresAt = timestamp + (7 * 24 * 60 * 60); // 7 days TTL

    for (const news of newsItems) {
        try {
            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    symbol,
                    timestamp,
                    title: news.title,
                    summary: news.summary,
                    url: news.url,
                    source: news.source,
                    sentiment: news.sentiment,
                    relevance: news.relevance,
                    hash: news.hash,
                    createdAt: timestamp,
                    expiresAt
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
    const oneDayAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'symbol = :symbol AND #ts > :oneDayAgo',
            ExpressionAttributeNames: { '#ts': 'timestamp' },
            ExpressionAttributeValues: {
                ':symbol': symbol,
                ':oneDayAgo': oneDayAgo
            },
            ProjectionExpression: 'hash'
        }));

        return result.Items?.map(item => item.hash) || [];
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
