const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// AWS Configuration
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
};

// Create DynamoDB client
const dynamoClient = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(dynamoClient);

module.exports = {
  docClient,
  TABLES: {
    AI_EVALUATIONS: 'aiEvaluations',
    NEWS_ARTICLES: 'newsArticles',
    ACTIVE_TRADES: 'activeTrades',
    CLOSED_TRADES: 'closedTrades'
  }
};

