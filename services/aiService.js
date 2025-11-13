const axios = require('axios');
const config = require('../config/config');

async function getAITechnicalAnalysis(technicalData, options = {}) {
  try {
    const prompt = createTechnicalAnalysisPrompt(technicalData, options);

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: config.AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.1,
    }, {
      headers: {
        Authorization: `Bearer ${config.AI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
        'X-Title': 'Technical Analysis Bot',
      },
    });

    if (!response.data) throw new Error('AI API failed');
    return parseTechnicalAIResponse(response.data.choices[0].message.content, technicalData);
  } catch (error) {
    console.log('⚠️ AI analysis failed, using deterministic fallback:', error.message);
    return generateTechnicalAnalysis(technicalData);
  }
}

function createTechnicalAnalysisPrompt(technicalData, options = {}) {
  const frames = technicalData.frames || {};
  const frameToText = (key, label) => {
    const frame = frames[key] || {};
    const rsi = frame.rsi || 'N/A';
    const trend = frame.trend || 'N/A';
    const momentum = frame.momentum || 'N/A';
    const bollinger = frame.bollingerPosition || 'N/A';
    const support =
      frame.support != null && Number.isFinite(frame.support)
        ? frame.support.toFixed(2)
        : frame.support || 'N/A';
    const resistance =
      frame.resistance != null && Number.isFinite(frame.resistance)
        ? frame.resistance.toFixed(2)
        : frame.resistance || 'N/A';
    return `${label}:
- RSI: ${rsi} ${getRSILevel(Number(rsi))}
- Bollinger: ${bollinger}
- Trend: ${trend}
- Momentum: ${momentum}
- Support: ${support}
- Resistance: ${resistance}`;
  };
  const newsLines = (technicalData.news || [])
    .map((news) => `- (${news.source}) ${news.title}`)
    .join('\n') || '- No significant headlines in the last few hours';
  const patternText = options.pattern
    ? `Preferred pattern: ${options.pattern}`
    : 'Preferred pattern: balanced';
  const indicatorPrefs = options.indicators
    ? Object.entries(options.indicators)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key.toUpperCase())
        .join(', ')
    : 'All indicators';
  
  // Add global metrics to prompt
  let globalMetricsText = '';
  if (technicalData.globalMetrics) {
    const gm = technicalData.globalMetrics;
    if (gm.coinpaprika) {
      globalMetricsText = `GLOBAL MARKET CONTEXT:
- Total Market Cap: $${(gm.coinpaprika.market_cap_usd / 1e12).toFixed(2)}T
- 24h Volume: $${(gm.coinpaprika.volume_24h_usd / 1e9).toFixed(2)}B  
- BTC Dominance: ${gm.coinpaprika.bitcoin_dominance_percentage}%
- Total Cryptocurrencies: ${gm.coinpaprika.cryptocurrencies_number}

`;
    }
  }

  return `PROFESSIONAL TECHNICAL ANALYSIS REQUEST:

${globalMetricsText}CRYPTO: ${technicalData.symbol} - ${technicalData.name}
CURRENT PRICE: ${technicalData.currentPrice}
DATA SOURCE: ${technicalData.dataSource || 'CoinGecko'}

${frameToText('10m', '10 Minute')}

${frameToText('1h', '1 Hour')}

${frameToText('4h', '4 Hour')}

${frameToText('1d', '1 Day')}

${frameToText('1w', '1 Week')}

${patternText}
Indicators selected: ${indicatorPrefs}

RECENT NEWS:
${newsLines}

Respond with JSON:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0.75,
  "reason": "...",
  "insights": ["...", "...", "..."]
}`;
}

function getRSILevel(rsi) {
  if (rsi > 70) return '(Overbought)';
  if (rsi < 30) return '(Oversold)';
  return '(Neutral)';
}

function parseTechnicalAIResponse(aiResponse, technicalData) {
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        action: parsed.action || 'HOLD',
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.1), 0.95),
        reason: parsed.reason || 'Technical analysis completed',
        insights: parsed.insights || ['Analysis provided'],
        signal: `${parsed.action} | Technical Analysis`,
      };
    }
    throw new Error('Invalid AI response format');
  } catch (error) {
    return generateTechnicalAnalysis(technicalData);
  }
}

function generateTechnicalAnalysis(technicalData) {
  let action = 'HOLD';
  let confidence = 0.3;
  let reason = 'No clear technical setup';
  let insights = ['Wait for clearer signals', 'Monitor key levels', 'Low conviction'];

  const frames = technicalData.frames || {};
  const frame10m = frames['10m'] || {};
  const frame1h = frames['1h'] || {};
  const frame4h = frames['4h'] || {};
  const frame1d = frames['1d'] || {};
  const frame1w = frames['1w'] || {};

  const dailyRsi = Number(frame1d.rsi) || 50;
  const dailyBB = frame1d.bollingerPosition || 'MIDDLE';
  const dailyTrend = frame1d.trend || 'SIDEWAYS';

  const hourlyRsi = Number(frame1h.rsi) || 50;
  const hourlyTrend = frame1h.trend || 'SIDEWAYS';

  const momentum10m = frame10m.momentum || 'NEUTRAL';
  const weeklyTrend = frame1w.trend || 'SIDEWAYS';

  if (dailyRsi < 30 && dailyBB === 'LOWER' && dailyTrend === 'BEARISH') {
    action = 'BUY';
    confidence = 0.75;
    reason = 'Daily oversold with Bollinger support and potential bearish exhaustion';
    insights = [
      'Strong mean-reversion potential',
      'Risk: Trend continuation',
      `Weekly trend backdrop: ${weeklyTrend}`,
    ];
  } else if (dailyRsi > 70 && dailyBB === 'UPPER' && dailyTrend === 'BULLISH') {
    action = 'SELL';
    confidence = 0.75;
    reason = 'Daily overbought at Bollinger resistance';
    insights = [
      'Profit-taking opportunity',
      'Risk: Trend continuation',
      `Weekly trend backdrop: ${weeklyTrend}`,
    ];
  } else if (dailyRsi < 35 && dailyTrend === 'BULLISH' && hourlyTrend === 'BULLISH') {
    action = 'BUY';
    confidence = 0.7;
    reason = 'Both timeframes bullish with daily oversold signal';
    insights = ['Trend alignment positive', 'Watch for confirmation', 'Stop below recent low'];
  } else if (hourlyRsi < 30 && hourlyTrend === 'BULLISH') {
    action = 'BUY';
    confidence = 0.65;
    reason = 'Hourly oversold in bullish hourly trend';
    insights = ['Short-term mean reversion opportunity', 'Confirm with volume', 'Tight stop loss'];
  } else if (momentum10m === 'STRONG_DOWN' && dailyTrend === 'BEARISH') {
    action = 'SELL';
    confidence = 0.6;
    reason = 'Short-term momentum and daily trend both bearish';
    insights = ['Potential continuation move', 'Watch for support breaks', 'Consider partial position sizing'];
  } else if (
    frame1w.trend === 'BULLISH' &&
    frame1d.trend === 'BULLISH' &&
    frame4h.trend === 'BULLISH'
  ) {
    action = 'BUY';
    confidence = 0.62;
    reason = 'Weekly, daily, and 4H trends aligned to the upside';
    insights = ['Momentum building across timeframes', 'Look for pullback entries', 'Maintain disciplined stop'];
  }

  if (technicalData.news && technicalData.news.length > 0) {
    insights = [...insights, `News to watch: ${technicalData.news[0].title}`];
  }

  return {
    action,
    confidence,
    reason,
    insights,
    signal: `${action} | Multi-Timeframe Analysis`,
  };
}

// Batch AI analysis - sends all coins at once to reduce API calls
async function getBatchAIAnalysis(allCoinsData, globalMetrics, options = {}) {
  if (!allCoinsData || allCoinsData.length === 0) {
    return {};
  }

  try {
    const prompt = createBatchAnalysisPrompt(allCoinsData, globalMetrics, options);

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: config.AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000, // More tokens for batch analysis
      temperature: 0.1,
    }, {
      headers: {
        Authorization: `Bearer ${config.AI_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
        'X-Title': 'Technical Analysis Bot',
      },
    });

    if (!response.data) throw new Error('AI API failed');
    return parseBatchAIResponse(response.data.choices[0].message.content, allCoinsData);
  } catch (error) {
    console.log('⚠️ Batch AI analysis failed, using deterministic fallback:', error.message);
    return generateBatchAnalysis(allCoinsData);
  }
}

function createBatchAnalysisPrompt(allCoinsData, globalMetrics, options = {}) {
  let globalMetricsText = '';
  if (globalMetrics && globalMetrics.coinpaprika) {
    const gm = globalMetrics.coinpaprika;
    globalMetricsText = `GLOBAL MARKET CONTEXT:
- Total Market Cap: $${(gm.market_cap_usd / 1e12).toFixed(2)}T
- 24h Volume: $${(gm.volume_24h_usd / 1e9).toFixed(2)}B  
- BTC Dominance: ${gm.bitcoin_dominance_percentage}%
- Total Cryptocurrencies: ${gm.cryptocurrencies_number}

`;
  }

  const coinsSummary = allCoinsData.map((coin, idx) => {
    const frames = coin.frames || {};
    const frame1d = frames['1d'] || {};
    const frame1h = frames['1h'] || {};
    
    return `${idx + 1}. ${coin.symbol} (${coin.name}) - Price: $${coin.currentPrice}
   Daily: RSI ${frame1d.rsi || 'N/A'}, Trend ${frame1d.trend || 'N/A'}, BB ${frame1d.bollingerPosition || 'N/A'}
   Hourly: RSI ${frame1h.rsi || 'N/A'}, Trend ${frame1h.trend || 'N/A'}, Momentum ${frame1h.momentum || 'N/A'}`;
  }).join('\n\n');

  return `BATCH CRYPTO TECHNICAL ANALYSIS REQUEST:

${globalMetricsText}Analyze ${allCoinsData.length} cryptocurrencies and provide trading signals.

COINS TO ANALYZE:
${coinsSummary}

For each coin, provide:
1. Action: BUY, SELL, or HOLD
2. Confidence: 0.0 to 1.0
3. Brief reason (1 sentence)
4. Top 2-3 insights

Respond with JSON array:
[
  {
    "symbol": "BTC",
    "action": "BUY|SELL|HOLD",
    "confidence": 0.75,
    "reason": "...",
    "insights": ["...", "..."]
  },
  ...
]`;
}

function parseBatchAIResponse(aiResponse, allCoinsData) {
  try {
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const results = {};
      
      parsed.forEach((item) => {
        if (item.symbol) {
          results[item.symbol] = {
            action: item.action || 'HOLD',
            confidence: Math.min(Math.max(item.confidence || 0.5, 0.1), 0.95),
            reason: item.reason || 'AI analysis completed',
            insights: item.insights || ['Analysis provided'],
            signal: `${item.action} | AI Batch Analysis`,
            aiEvaluated: true,
          };
        }
      });
      
      // Fill in missing coins with HOLD
      allCoinsData.forEach((coin) => {
        if (!results[coin.symbol]) {
          results[coin.symbol] = {
            action: 'HOLD',
            confidence: 0.3,
            reason: 'No AI evaluation provided',
            insights: ['Waiting for analysis'],
            signal: 'HOLD | Pending',
            aiEvaluated: false,
          };
        }
      });
      
      return results;
    }
    throw new Error('Invalid AI response format');
  } catch (error) {
    console.log('⚠️ Failed to parse batch AI response:', error.message);
    return generateBatchAnalysis(allCoinsData);
  }
}

function generateBatchAnalysis(allCoinsData) {
  const results = {};
  allCoinsData.forEach((coin) => {
    results[coin.symbol] = generateTechnicalAnalysis(coin);
  });
  return results;
}

module.exports = {
  getAITechnicalAnalysis,
  getBatchAIAnalysis,
  createTechnicalAnalysisPrompt,
  parseTechnicalAIResponse,
  generateTechnicalAnalysis
};
