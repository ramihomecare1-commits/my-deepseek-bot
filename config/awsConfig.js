const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  PutCommand,
  GetCommand,
  UpdateCommand,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

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
    // Stores coin/trade AI evaluations
    AI_EVALUATIONS: 'aiEvaluations',
    // Stores news articles
    NEWS_ARTICLES: 'newsArticles',
    // Stores open / active trades
    ACTIVE_TRADES: 'activeTrades',
    // Stores closed trades / history
    CLOSED_TRADES: 'closedTrades',
    // NEW: Stores long‑term chat history with Telegram (per chatId)
    // Recommended DynamoDB schema:
    //   Partition key: chatId (String)
    //   Sort key: timestamp (Number)
    AI_CONVERSATIONS: 'aiConversations'
  }
};

