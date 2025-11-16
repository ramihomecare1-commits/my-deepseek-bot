/* eslint-disable no-console */
const axios = require('axios');
const config = require('../config/config');
const {
  docClient,
  TABLES,
  QueryCommand,
  PutCommand
} = require('../config/awsConfig');
const { sendTelegramMessage } = require('./notificationService');

const CONVO_TABLE = TABLES.AI_CONVERSATIONS;

/**
 * Load recent conversation history for a Telegram chat.
 * We keep it short (last 20 messages) to control token usage.
 */
async function loadConversationHistory(chatId, limit = 20) {
  if (!chatId) return [];

  try {
    const params = {
      TableName: CONVO_TABLE,
      KeyConditionExpression: 'chatId = :c',
      ExpressionAttributeValues: {
        ':c': chatId
      },
      ScanIndexForward: true,
      Limit: limit
    };

    const result = await docClient.send(new QueryCommand(params));
    const items = result.Items || [];

    return items.map((item) => ({
      role: item.role,
      content: item.content
    }));
  } catch (error) {
    console.error('⚠️ loadConversationHistory error:', error.message);
    return [];
  }
}

/**
 * Persist one chat message into DynamoDB for long‑term memory.
 */
async function saveMessage(chatId, role, content) {
  if (!chatId || !role || !content) return;

  try {
    const now = Date.now();
    const item = {
      chatId,
      timestamp: now,
      role,
      content,
      type: 'telegram_chat'
    };

    await docClient.send(
      new PutCommand({
        TableName: CONVO_TABLE,
        Item: item
      })
    );
  } catch (error) {
    console.error('⚠️ saveMessage error:', error.message);
  }
}

/**
 * Call Premium AI (OpenRouter / DeepSeek R1 or configured premium model)
 * with full chat-style messages array.
 */
async function callPremiumAI(messages) {
  // Use the same premium key / model as the main bot
  const apiKey = config.PREMIUM_API_KEY || config.AI_API_KEY;

  if (!apiKey) {
    throw new Error('No premium AI API key configured');
  }

  const model = config.AI_MODEL || 'deepseek/deepseek-r1';

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 800
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://my-deepseek-bot-telegram',
    'X-Title': 'Premium Telegram Trading Assistant'
  };

  console.log('🤖 [Telegram Chat] Calling Premium AI...', {
    model,
    apiKeyPrefix: apiKey.substring(0, 12) + '...'
  });

  const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
    headers,
    timeout: 45000
  });

  if (!response.data || !response.data.choices || !response.data.choices[0]) {
    throw new Error('Invalid AI response format');
  }

  const content = response.data.choices[0].message.content || '';
  console.log(
    `✅ [Telegram Chat] Premium AI responded (len=${content.length} chars)`
  );

  return content;
}

/**
 * Handle a free‑form user message coming from Telegram.
 * - Loads last messages (memory)
 * - Calls Premium AI
 * - Stores user + assistant messages
 * - Replies via Telegram
 */
async function handleUserMessage(chatId, text) {
  try {
    const history = await loadConversationHistory(chatId);

    const systemPrompt = `
You are the PREMIUM crypto trading assistant for a single power user.
- Discuss trades, entries, stop losses and risk in a practical way.
- Remember user preferences, risk tolerance, timeframes and style from previous messages.
- If user expresses a preference (\"I prefer spot only\", \"max 2% risk\", \"no meme coins\"), treat it as a long‑term preference.
- Keep answers concise but actionable, with clear levels when relevant.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text }
    ];

    const aiContent = await callPremiumAI(messages);
    const replyText = aiContent || 'Sorry, I could not generate a response.';

    // Persist both sides of the conversation
    await saveMessage(chatId, 'user', text);
    await saveMessage(chatId, 'assistant', replyText);

    // Telegram has length limits; be safe and trim
    const safeReply = replyText.substring(0, 3500);

    await sendTelegramMessage(safeReply);
  } catch (error) {
    console.error('❌ handleUserMessage error:', error.message);
    await sendTelegramMessage('⚠️ Error talking to premium AI. Please try again later.');
  }
}

async function sendWelcomeMessage(chatId) {
  const msg = `
👋 <b>Premium AI Trading Assistant</b>

You can:
- Ask about specific coins, entries, TP/SL ideas
- Discuss risk, timeframe and strategy
- Tell me your preferences (e.g. \"I prefer spot only\", \"no leverage\", \"swing trades only\")

I will remember your preferences over time and adapt my answers.

Just type your question to start.
`.trim();

  await sendTelegramMessage(msg);
}

async function resetConversation(chatId) {
  // We keep this simple: logical reset (ignore old messages going forward).
  // A full reset (DynamoDB delete) can be added later if needed.
  await sendTelegramMessage('🧹 I will ignore previous chat history from now on. You can start fresh with your preferences.');
}

module.exports = {
  handleUserMessage,
  sendWelcomeMessage,
  resetConversation
};


