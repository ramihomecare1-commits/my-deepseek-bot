const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand, GetCommand, UpdateCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

// AWS Configuration
const awsConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  } : undefined
};

// Create DynamoDB client
const dynamoClient = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false
  },
  unmarshallOptions: {
    wrapNumbers: false
  }
});

module.exports = {
  docClient,
  ScanCommand,
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  BatchWriteCommand,
  TABLES: {
    AI_EVALUATIONS: 'aiEvaluations',
    NEWS_ARTICLES: 'newsArticles',
    ACTIVE_TRADES: 'activeTrades',
    CLOSED_TRADES: 'closedTrades'
  }
};

