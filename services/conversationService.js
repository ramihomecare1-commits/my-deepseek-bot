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
const { retrieveRelatedData } = require('./dataStorageService');

const CONVO_TABLE = TABLES.AI_CONVERSATIONS;

// Limited list of symbols we explicitly support for quick context.
// This keeps logic simple and avoids surprises.
const SUPPORTED_SYMBOLS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX',
  'LINK', 'DOT', 'MATIC', 'LTC', 'UNI', 'ATOM', 'XLM', 'ETC',
  'FIL', 'HBAR', 'APT', 'ARB', 'OP', 'SUI', 'TON', 'SHIB'
];

/**
 * Try to extract relevant coin symbols from free‑form user text.
 * Very simple heuristic: look for known tickers in UPPERCASE.
 */
function extractSymbolsFromText(text) {
  if (!text) return [];
  const upper = text.toUpperCase();
  const found = new Set();

  for (const symbol of SUPPORTED_SYMBOLS) {
    if (upper.includes(symbol)) {
      found.add(symbol);
    }
  }

  return Array.from(found);
}

/**
 * Fetch a very simple, real‑time price snapshot from Binance (no dependency on the rest of the bot).
 * This is intentionally minimal to keep Telegram replies fast and focused.
 */
async function fetchSimpleBinancePrice(symbol) {
  try {
    const pair = `${symbol}USDT`;
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
      params: { symbol: pair },
      timeout: 8000
    });

    const data = response.data;
    if (!data || !data.lastPrice) {
      throw new Error('Invalid Binance ticker response');
    }

    return {
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent || 0),
      high24h: parseFloat(data.highPrice || 0),
      low24h: parseFloat(data.lowPrice || 0)
    };
  } catch (error) {
    console.error(`⚠️ fetchSimpleBinancePrice(${symbol}) failed:`, error.message);
    return null;
  }
}

/**
 * Build a short, token‑efficient context summary for the AI
 * using:
 * - Latest real‑time price (Binance)
 * - Recent stored AI evaluations & news from DynamoDB
 */
async function buildContextSummary(symbols) {
  if (!symbols || symbols.length === 0) return '';

  const lines = [];

  for (const symbol of symbols) {
    // 1) Real‑time price
    const priceData = await fetchSimpleBinancePrice(symbol);

    // 2) Historical evaluations + news (last 7 days, limited)
    const related = await retrieveRelatedData({
      symbol,
      days: 7,
      limit: 10
    }).catch((err) => {
      console.error(`⚠️ retrieveRelatedData error for ${symbol}:`, err.message);
      return { evaluations: [], news: [] };
    });

    const latestEval = (related.evaluations || [])[0];
    const latestNews = (related.news || []).slice(0, 3);

    lines.push(`SYMBOL: ${symbol}`);

    if (priceData) {
      lines.push(
        `- Real-time price: $${priceData.price.toFixed(2)} (24h: ${priceData.change24h.toFixed(
          2
        )}%, High: $${priceData.high24h.toFixed(2)}, Low: $${priceData.low24h.toFixed(2)})`
      );
    } else {
      lines.push(`- Real-time price: unavailable (Binance request failed)`);
    }

    if (latestEval && latestEval.data) {
      const d = latestEval.data;
      const action = d.action || d.recommendation || 'N/A';
      const confidence =
        typeof d.confidence === 'number'
          ? `${(d.confidence * 100).toFixed(0)}%`
          : d.confidence || 'N/A';
      lines.push(`- Last stored AI eval: ${action} (${confidence})`);
      if (d.reason) {
        lines.push(`  Reason: ${String(d.reason).substring(0, 160)}`);
      }
    } else {
      lines.push(`- Last stored AI eval: none in the last 7 days`);
    }

    if (latestNews.length > 0) {
      lines.push(`- Recent news (last ${latestNews.length}):`);
      latestNews.forEach((n) => {
        lines.push(
          `  • (${n.source || 'news'}) ${String(n.title || '').substring(0, 140)}`
        );
      });
    } else {
      lines.push(`- Recent news: none stored in the last 7 days`);
    }

    lines.push(''); // blank line between symbols
  }

  return lines.join('\n');
}

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

    // Try to infer which symbols the user is talking about (BTC, ETH, etc.)
    const symbols = extractSymbolsFromText(text);
    const contextSummary = await buildContextSummary(symbols);

    const systemPrompt = `
You are the PREMIUM crypto trading assistant for a single power user.
- You ALWAYS use the latest context provided (real‑time price + stored AI evaluations + news) when giving answers.
- If context shows a big difference between stored evaluation price and current market price, call it out explicitly.
- Discuss trades, entries, stop losses and risk in a practical way.
- Remember user preferences, risk tolerance, timeframes and style from previous messages.
- If user expresses a preference ("I prefer spot only", "max 2% risk", "no meme coins"), treat it as a long‑term preference.
- Keep answers concise but actionable, with clear levels when relevant.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(contextSummary
        ? [
            {
              role: 'system',
              content: `LATEST MARKET CONTEXT (from Binance + stored data):\n${contextSummary}`
            }
          ]
        : []),
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


