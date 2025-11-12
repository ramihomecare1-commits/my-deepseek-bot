router.post('/test-telegram', async (req, res) => {
  try {
    const { tradingBot } = req.app.locals;
    const config = require('../config/config');
    
    // Check if Telegram is configured
    if (!config.TELEGRAM_ENABLED) {
      return res.json({
        success: false,
        message: 'Telegram is not configured. Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables.',
        configStatus: {
          hasBotToken: Boolean(config.TELEGRAM_BOT_TOKEN),
          hasChatId: Boolean(config.TELEGRAM_CHAT_ID),
          bothConfigured: config.TELEGRAM_ENABLED
        }
      });
    }

    const result = await tradingBot.sendTestNotification();
    res.json(result);
  } catch (error) {
    console.error('Telegram test error:', error);
    res.status(500).json({
      success: false,
      message: `Error testing Telegram: ${error.message}`,
    });
  }
});

// Add a new endpoint to check Telegram configuration
router.get('/telegram-status', (req, res) => {
  const config = require('../config/config');
  res.json({
    telegramEnabled: config.TELEGRAM_ENABLED,
    hasBotToken: Boolean(config.TELEGRAM_BOT_TOKEN),
    hasChatId: Boolean(config.TELEGRAM_CHAT_ID),
    botTokenPreview: config.TELEGRAM_BOT_TOKEN ? 
      `${config.TELEGRAM_BOT_TOKEN.substring(0, 10)}...` : 'Not set',
    chatId: config.TELEGRAM_CHAT_ID || 'Not set'
  });
});
