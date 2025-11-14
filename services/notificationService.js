const axios = require('axios');
const config = require('../config/config');

async function sendTelegramNotification(opportunity, lastNotificationTime, stats, greedFearIndex, globalMetrics, options = {}) {
  const { force = false } = options;
  
  console.log('🔧 Telegram Notification Debug:');
  console.log(`   Enabled: ${config.TELEGRAM_ENABLED}`);
  console.log(`   Bot Token: ${config.TELEGRAM_BOT_TOKEN ? 'Set' : 'Missing'}`);
  console.log(`   Chat ID: ${config.TELEGRAM_CHAT_ID ? 'Set' : 'Missing'}`);
  
  if (!config.TELEGRAM_ENABLED) {
    console.log('⚠️ Telegram notifications disabled (missing credentials)');
    return false;
  }

  // PREVENT TEST COIN NOTIFICATIONS (unless forced)
  if (!force && (opportunity.symbol === 'TEST' || opportunity.name.includes('Test') || opportunity.usesMockData)) {
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
    // Escape Markdown special characters to prevent parsing errors
    const escapeMarkdown = (text) => {
      if (!text) return 'N/A';
      return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
    };

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

    // Escape user-generated content (AI reason and insights)
    const safeReason = escapeMarkdown(opportunity.reason);
    const safeInsights = opportunity.insights.map(insight => escapeMarkdown(insight));

    // Calculate risk/reward ratio
    let riskManagementText = '';
    if (opportunity.entryPrice && opportunity.takeProfit && opportunity.stopLoss) {
      const entry = Number(opportunity.entryPrice);
      const tp = Number(opportunity.takeProfit);
      const sl = Number(opportunity.stopLoss);
      const expectedGain = opportunity.expectedGainPercent || 0;
      
      const potentialGain = Math.abs(tp - entry);
      const potentialLoss = Math.abs(entry - sl);
      const riskRewardRatio = potentialLoss > 0 ? (potentialGain / potentialLoss).toFixed(2) : 'N/A';
      
      riskManagementText = `
💰 *RISK MANAGEMENT:*
• Entry Price: $${entry.toFixed(2)}
• Take Profit: $${tp.toFixed(2)}
• Stop Loss: $${sl.toFixed(2)}
${opportunity.addPosition ? `• Add Position (DCA): $${Number(opportunity.addPosition).toFixed(2)}` : ''}
• Expected Gain: ${expectedGain}%
• Risk/Reward: 1:${riskRewardRatio}
`;
    }

    // Add backtest results if available
    let backtestText = '';
    if (opportunity.backtest && opportunity.backtest.winRate !== undefined) {
      const bt = opportunity.backtest;
      backtestText = `
📈 *BACKTEST RESULTS (${bt.dataPoints || 0} data points):*
• Win Rate: ${bt.winRate.toFixed(1)}% (${bt.totalTrades || 0} trades)
• Avg Return: ${bt.avgReturn > 0 ? '+' : ''}${bt.avgReturn.toFixed(2)}%
• Profit Factor: ${bt.profitFactor.toFixed(2)}
• Max Drawdown: ${bt.maxDrawdown.toFixed(2)}%
${bt.totalTrades > 0 ? '✅ Strategy validated on historical data' : '⚠️ Limited backtest data'}
`;
    } else if (opportunity.backtest && opportunity.backtest.error) {
      backtestText = `
📈 *BACKTEST:* ⚠️ ${escapeMarkdown(opportunity.backtest.error)}
`;
    }

    const message = `${actionEmoji} *${opportunity.action} SIGNAL DETECTED*

*Coin:* ${opportunity.name} (${opportunity.symbol})
*Current Price:* ${opportunity.price}
*Confidence:* ${confidencePercent}%
*Data Source:* ${opportunity.dataSource || 'CoinGecko'}
*Market Sentiment:* ${sentiment}
${riskManagementText}
${backtestText}
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
${safeInsights.map((insight) => `→ ${insight}`).join('\n')}

📝 *Reason:* ${safeReason}

⏰ Detected: ${new Date(opportunity.timestamp).toLocaleString()}`;

    const telegramUrl = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    console.log(`📤 Sending to Telegram URL: ${telegramUrl.replace(config.TELEGRAM_BOT_TOKEN, 'HIDDEN')}`);

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
    if (error.response) {
      console.log(`   Response status: ${error.response.status}`);
      console.log(`   Response data:`, error.response.data);
    }
    return false;
  }
}

async function sendTestNotification(config) {
  console.log('🔧 Testing Telegram configuration...');
  console.log(`   Bot Token: ${config.TELEGRAM_BOT_TOKEN ? 'Set' : 'Missing'}`);
  console.log(`   Chat ID: ${config.TELEGRAM_CHAT_ID ? 'Set' : 'Missing'}`);
  
  if (!config.TELEGRAM_ENABLED) {
    const message = 'Telegram credentials not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.';
    console.log('❌ ' + message);
    return { 
      success: false, 
      message,
      required: {
        TELEGRAM_BOT_TOKEN: 'Your bot token from BotFather',
        TELEGRAM_CHAT_ID: 'Your personal chat ID or group ID'
      }
    };
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
      usesMockData: false,
      dataSource: 'test',
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

    console.log('📱 Attempting to send test notification...');
    const success = await sendTelegramNotification(
      testOpportunity, 
      lastNotificationTime, 
      stats, 
      greedFearIndex, 
      globalMetrics, 
      { force: true }
    );

    if (success) {
      const message = '✅ Test notification sent successfully! Check your Telegram.';
      console.log(message);
      return {
        success: true,
        message,
      };
    } else {
      const message = '❌ Failed to send test notification. Check console for details.';
      console.log(message);
      return {
        success: false,
        message,
      };
    }
  } catch (error) {
    const errorMessage = `❌ Error sending test: ${error.message}`;
    console.error(errorMessage);
    console.error('Full error:', error);
    
    return {
      success: false,
      message: errorMessage,
      errorDetails: {
        message: error.message,
        stack: error.stack
      }
    };
  }
}

module.exports = {
  sendTelegramNotification,
  sendTestNotification
};
