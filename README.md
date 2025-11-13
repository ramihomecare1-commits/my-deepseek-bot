# 🤖 Professional Crypto Trading Scanner

An advanced cryptocurrency trading bot that performs technical analysis on the top 100 cryptocurrencies using multiple indicators and AI-powered insights.

## ✨ Features

- **Multi-Timeframe Analysis**: Analyzes 10m, 1h, 4h, 1d, and 1w timeframes
- **Technical Indicators**: 
  - RSI (Relative Strength Index)
  - Bollinger Bands
  - Support/Resistance Levels
  - Momentum Analysis
  - Trend Identification
- **AI-Powered Analysis**: Uses DeepSeek AI for enhanced trading signals
- **Telegram Notifications**: Real-time alerts for trading opportunities
- **News Integration**: CryptoPanic news feed integration
- **Web Dashboard**: Beautiful, modern UI for monitoring and control
- **Auto-Scanning**: Configurable intervals (10m, 1h, 4h, 1d, 1w)
- **Rate Limiting**: Built-in protection against API abuse
- **Error Handling**: Robust error handling and logging

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (or Node.js 16+ with node-fetch)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd my-deepseek-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
PORT=10000
API_KEY=your_openrouter_api_key_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
CRYPTOPANIC_API_KEY=your_cryptopanic_api_key_here
```

5. Start the server:
```bash
npm start
```

6. Open your browser to `http://localhost:10000`

## 📋 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 10000) |
| `API_KEY` | Recommended | OpenRouter API key for AI analysis |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat ID for notifications |
| `CRYPTOPANIC_API_KEY` | Optional | CryptoPanic API key for news features |
| `CG_DELAY_MS` | No | Delay between CoinGecko API calls in ms (default: 1000) |

## 🔑 Getting API Keys

### OpenRouter API Key (for AI Analysis)
1. Visit [OpenRouter.ai](https://openrouter.ai/)
2. Sign up for an account
3. Navigate to Keys section
4. Create a new API key
5. Add it to your `.env` file as `API_KEY`

### Telegram Bot Setup
1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow instructions
3. Copy the bot token to `TELEGRAM_BOT_TOKEN`
4. To get your chat ID:
   - Send a message to your bot
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your `chat.id` in the response
5. Add chat ID to `TELEGRAM_CHAT_ID`

### CryptoPanic API Key (Optional)
1. Visit [CryptoPanic API](https://cryptopanic.com/developers/api/)
2. Sign up and get your API key
3. Add it to `CRYPTOPANIC_API_KEY`

## 📡 API Endpoints

### Bot Control
- `POST /start-scan` - Start automated scanning
- `POST /stop-scan` - Stop automated scanning
- `POST /scan-now` - Perform immediate scan
- `POST /auto-scan-settings` - Configure scan interval
  ```json
  { "interval": "1h" }
  ```
  Options: `10m`, `1h`, `4h`, `1d`, `1w`

### Status & Data
- `GET /bot-status` - Get bot status and statistics
- `GET /scan-progress` - Get current scan progress
- `GET /live-analysis` - Get live analysis data
- `GET /scan-history` - Get scan history
- `GET /health` - Health check endpoint

### Testing
- `POST /test-telegram` - Test Telegram notification

### Web UI
- `GET /` - Web dashboard

## 🎯 Usage

### Starting a Scan

1. **Via Web UI**: 
   - Open `http://localhost:10000`
   - Click "Start Auto-Scan" or "Scan Now"

2. **Via API**:
```bash
curl -X POST http://localhost:10000/start-scan
```

### Configuring Scan Interval

```bash
curl -X POST http://localhost:10000/auto-scan-settings \
  -H "Content-Type: application/json" \
  -d '{"interval": "1h"}'
```

### Checking Status

```bash
curl http://localhost:10000/bot-status
```

## 🏗️ Architecture

The bot analyzes cryptocurrencies using:

1. **Data Collection**: Fetches historical price data from CoinGecko
2. **Technical Analysis**: Calculates RSI, Bollinger Bands, Support/Resistance, Momentum
3. **Multi-Timeframe Analysis**: Evaluates signals across 5 timeframes
4. **AI Enhancement**: Uses DeepSeek AI to evaluate technical signals
5. **Signal Generation**: Produces BUY/SELL/HOLD recommendations with confidence scores
6. **Notifications**: Sends alerts via Telegram when opportunities are detected

## 🔧 Configuration

### Minimum Confidence Threshold
Default: 0.65 (65%). Only signals with confidence >= this threshold trigger notifications.

### Tracked Coins
Currently tracks the top 100 cryptocurrencies by market cap. The list is defined in `getTop100Coins()` method.

### Rate Limiting
- API endpoints: 100 requests per minute per IP
- CoinGecko API: Configurable delay between calls (default: 1000ms)

## 📊 Technical Indicators

### RSI (Relative Strength Index)
- **Oversold**: RSI < 30 (potential buy signal)
- **Overbought**: RSI > 70 (potential sell signal)
- **Neutral**: 30-70

### Bollinger Bands
- **Lower Band**: Potential support level
- **Upper Band**: Potential resistance level
- **Position**: Indicates if price is near support/resistance

### Support/Resistance
- Calculated from recent price action
- Identifies key price levels

### Momentum
- Measures short-term price movement strength
- Categories: STRONG_UP, UP, NEUTRAL, DOWN, STRONG_DOWN

## 🛡️ Security

- Rate limiting on all API endpoints
- Input validation
- Error handling middleware
- Environment variable validation

## 🐛 Troubleshooting

### Bot not starting
- Check that all required environment variables are set
- Verify Node.js version (18+ recommended)
- Check console for error messages

### No notifications received
- Verify Telegram credentials are correct
- Test with `/test-telegram` endpoint
- Check that notifications are enabled in startup logs

### API rate limit errors
- Increase `CG_DELAY_MS` in `.env`
- Reduce number of tracked coins
- Check CoinGecko API status

### AI analysis not working
- Verify `API_KEY` is set correctly
- Check OpenRouter API status
- Bot will fall back to deterministic analysis if AI fails

## 📝 Development

### Project Structure
```
my-deepseek-bot/
├── server.js          # Main application file
├── package.json       # Dependencies
├── .env.example      # Environment variable template
├── README.md         # This file
└── .gitignore        # Git ignore rules
```

### Adding New Indicators
1. Add calculation method to `ProfessionalTradingBot` class
2. Integrate into `analyzeWithTechnicalIndicators` method
3. Update AI prompt to include new indicator
4. Update UI to display new indicator

## 📄 License

[Add your license here]

## 🤝 Contributing

[Add contribution guidelines here]

## ⚠️ Disclaimer

This bot is for educational and research purposes only. Cryptocurrency trading involves substantial risk. Always do your own research and never invest more than you can afford to lose. Past performance does not guarantee future results.

## 📞 Support

For issues and questions, please open an issue on the repository.

---

**Made with ❤️ for the crypto trading community**

