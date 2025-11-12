const axios = require('axios');
const config = require('../config/config');

async function sendTelegramNotification(opportunity, lastNotificationTime, stats, greedFearIndex, globalMetrics, options = {}) {
  const { force = false } = options;
  if (!config.TELEGRAM_ENABLED) {
    console.log('⚠️ Telegram notifications disabled (missing credentials)');
    return false;
  }

  // PREVENT TEST COIN NOTIFICATIONS
  if (opportunity.symbol === 'TEST' || opportunity.name.includes('Test') || opportunity.usesMockData) {
    console.log(`⏭️ Skipping notification for test/mock data: ${opportunity.symbol}`);
    return false;
  }

  const coinKey = opportunity.symbol;
  const now = Date.now();

  if (
    !force &&
    lastNotificationTime[coinKey] &&
    now - lastNotificationTime[coinKey] < config.NOTIFICATION_COOLDOWN_MS
  ) {
    console.log(`⏳ Skipping notification for ${coinKey} (cooldown active)`);
    return false;
  }

  try {
    const actionEmoji =
      opportunity.action === 'BUY'
        ? '🟢'
        : opportunity.action === 'SELL'
          ? '🔴'
          : '🟡';
    const confidencePercent = (opportunity.confidence * 100).toFixed(0);

    const indicators = opportunity.indicators;
    const frames = indicators.frames || {};
    const frame10m = frames['10m'] || {};
    const frame4h = frames['4h'] || {};
    const frame1w = frames['1w'] || {};
    const sentiment =
      greedFearIndex && greedFearIndex.value != null
        ? `${greedFearIndex.value} (${greedFearIndex.classification})`
        : 'N/A';

    // Add global metrics to notification
    let globalMetricsText = '';
    if (globalMetrics.coinpaprika) {
      globalMetricsText = `
🌐 *Global Market Overview:*
• Total Market Cap: $${(globalMetrics.coinpaprika.market_cap_usd / 1e12).toFixed(2)}T
• 24h Volume: $${(globalMetrics.coinpaprika.volume_24h_usd / 1e9).toFixed(2)}B
• BTC Dominance: ${globalMetrics.coinpaprika.bitcoin_dominance_percentage}%
• Total Cryptos: ${globalMetrics.coinpaprika.cryptocurrencies_number.toLocaleString()}
`;
    }

    const message = `${actionEmoji} *${opportunity.action} SIGNAL DETECTED*

*Coin:* ${opportunity.name} (${opportunity.symbol})
*Price:* ${opportunity.price}
*Confidence:* ${confidencePercent}%
*Data Source:* ${opportunity.dataSource || 'CoinGecko'}
*Market Sentiment:* ${sentiment}

📊 *Technical Snapshot:*
• Daily RSI: ${indicators.daily.rsi}
• Hourly RSI: ${indicators.hourly.rsi}
• 10m RSI: ${frame10m.rsi || 'N/A'}
• Daily Bollinger: ${indicators.daily.bollingerPosition}
• Hourly Bollinger: ${indicators.hourly.bollingerPosition}
• 4H Bollinger: ${frame4h.bollingerPosition || 'N/A'}
• Daily Trend: ${indicators.daily.trend}
• Hourly Trend: ${indicators.hourly.trend}
• 4H Trend: ${frame4h.trend || 'N/A'}
• Weekly Trend: ${frame1w.trend || 'N/A'}
• Momentum (10m): ${frame10m.momentum || indicators.momentum}
${globalMetricsText}
💡 *Key Insights:*
${opportunity.insights.map((insight) => `→ ${insight}`).join('\n')}

📝 *Reason:* ${opportunity.reason}

⏰ Detected: ${new Date(opportunity.timestamp).toLocaleString()}`;

    const telegramUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const response = await axios.post(
      telegramUrl,
      {
        chat_id: config.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      },
      {
        timeout: 10000,
      },
    );

    if (response.data.ok) {
      console.log(`✅ Telegram notification sent for ${opportunity.symbol}`);
      lastNotificationTime[coinKey] = now;
      stats.notificationsSent += 1;
      return true;
    }

    console.log(`❌ Telegram API error: ${response.data.description}`);
    return false;
  } catch (error) {
    console.log(`❌ Failed to send Telegram notification: ${error.message}`);
    return false;
  }
}

async function sendTestNotification(config) {
  if (!config.TELEGRAM_ENABLED) {
    return { success: false, message: 'Telegram credentials not configured' };
  }

  try {
    const testOpportunity = {
      symbol: 'TEST',
      name: 'Test Coin',
      action: 'BUY',
      price: '$1,234.56',
      confidence: 0.85,
      reason: 'This is a test notification to verify Telegram integration is working correctly.',
      insights: [
        '✅ Telegram integration test successful',
        '✅ Bot is properly configured',
        '✅ Notifications will be sent for trading opportunities',
      ],
      timestamp: new Date(),
      indicators: {
        momentum: 'UP',
        daily: {
          rsi: '45.2',
          bollingerPosition: 'MIDDLE',
          trend: 'BULLISH',
          support: '$1,200.00',
          resistance: '$1,300.00',
        },
        hourly: {
          rsi: '50.1',
          bollingerPosition: 'MIDDLE',
          trend: 'BULLISH',
        },
      },
    };

    const lastNotificationTime = {};
    const stats = { notificationsSent: 0 };
    const greedFearIndex = { value: 55, classification: 'Neutral' };
    const globalMetrics = {};

    const success = await sendTelegramNotification(testOpportunity, lastNotificationTime, stats, greedFearIndex, globalMetrics, { force: true });

    if (success) {
      return {
        success: true,
        message: '✅ Test notification sent successfully! Check your Telegram.',
      };
    }

    return {
      success: false,
      message: '❌ Failed to send test notification. Check console for details.',
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ Error sending test: ${error.message}`,
    };
  }
}

module.exports = {
  sendTelegramNotification,
  sendTestNotification
};
