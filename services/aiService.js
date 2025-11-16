const axios = require('axios');
const config = require('../config/config');
const { retrieveRelatedData } = require('./dataStorageService');

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
      timeout: 30000,
    });

    console.log(`🛰️ OpenRouter response status: ${response.status}`);
    if (!response.data) throw new Error('AI API failed');
    return parseTechnicalAIResponse(response.data.choices[0].message.content, technicalData);
  } catch (error) {
    if (error.response) {
      console.log(`⚠️ AI API error: ${error.response.status} ${error.response.statusText}`);
      console.log('Details:', JSON.stringify(error.response.data).slice(0, 500));
    } else {
      console.log('⚠️ AI analysis failed:', error.message);
    }
    console.log('↩️ Falling back to deterministic analysis');
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
  const frame4h = frames['4h'] || {};
  const frame1d = frames['1d'] || {};
  const frame1w = frames['1w'] || {};

  // Focused on swing/position trading:
  // Only use RSI + Bollinger Bands from 4H, Daily, and Weekly timeframes.
  const rsi4h = typeof frame4h.rsi === 'number' ? frame4h.rsi : Number(frame4h.rsi) || 50;
  const bb4h = frame4h.bollingerPosition || 'MIDDLE';
  const trend4h = frame4h.trend || 'SIDEWAYS';

  const dailyRsi = Number(frame1d.rsi) || 50;
  const dailyBB = frame1d.bollingerPosition || 'MIDDLE';
  const dailyTrend = frame1d.trend || 'SIDEWAYS';

  const weeklyTrend = frame1w.trend || 'SIDEWAYS';
  const weeklyBB = frame1w.bollingerPosition || 'MIDDLE';
  const weeklyRsi = typeof frame1w.rsi === 'number' ? frame1w.rsi : Number(frame1w.rsi) || dailyRsi;

  // Core long-term conditions using only 4H / 1D / 1W
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
  } else if (dailyRsi < 35 && dailyTrend === 'BULLISH' && trend4h === 'BULLISH') {
    action = 'BUY';
    confidence = 0.7;
    reason = 'Daily oversold in the context of aligned 4H and daily bullish trends';
    insights = ['Trend alignment positive (4H & 1D)', 'Watch for pullback entries', 'Stop below recent swing low'];
  } else if (rsi4h < 30 && trend4h === 'BULLISH' && weeklyTrend !== 'BEARISH') {
    action = 'BUY';
    confidence = 0.65;
    reason = '4H oversold within a broader bullish structure (swing entry focus)';
    insights = ['Swing entry opportunity on 4H', 'Confirm with higher timeframe structure', 'Use wider stop for position trade'];
  } else if (
    weeklyTrend === 'BULLISH' &&
    frame1d.trend === 'BULLISH' &&
    frame4h.trend === 'BULLISH'
  ) {
    action = 'BUY';
    confidence = 0.62;
    reason = 'Weekly, daily, and 4H trends aligned to the upside';
    insights = ['Momentum building across higher timeframes', 'Look for pullback entries on 4H', 'Maintain disciplined stop below key support'];
  } else if (
    (weeklyRsi > 70 && (weeklyBB === 'UPPER' || weeklyTrend === 'BULLISH')) ||
    (dailyRsi > 70 && dailyBB === 'UPPER' && weeklyTrend !== 'STRONGLY_BULLISH')
  ) {
    action = 'SELL';
    confidence = 0.6;
    reason = 'Overbought conditions on higher timeframes (daily/weekly) with Bollinger resistance';
    insights = ['Take profit or tighten stops', 'High timeframe exhaustion risk', 'Reduce position size if extended'];
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

// Batch AI analysis - sends coins in smaller batches to reduce API calls and avoid truncation
async function getBatchAIAnalysis(allCoinsData, globalMetrics, options = {}) {
  if (!allCoinsData || allCoinsData.length === 0) {
    return {};
  }

  // Retrieve historical data for all coins (async, don't block)
  const historicalDataPromises = allCoinsData.map(coin => 
    retrieveRelatedData({ symbol: coin.symbol, days: 30, limit: 10 })
      .catch(err => {
        console.error(`⚠️ Failed to retrieve historical data for ${coin.symbol}:`, err.message);
        return { evaluations: [], news: [] };
      })
  );
  
  const historicalDataArray = await Promise.all(historicalDataPromises);
  
  // Attach historical data to coins
  allCoinsData.forEach((coin, idx) => {
    coin.historicalData = historicalDataArray[idx] || { evaluations: [], news: [] };
  });

  // Retry logic for rate limits
  const maxRetries = 3;
  let lastError = null;

  // Process in smaller batches to avoid hitting model token limits
  // Default: 10 coins per AI call (can be overridden via options.batchSize)
  const batchSize = options.batchSize || 10;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const combinedResults = {};

      for (let i = 0; i < allCoinsData.length; i += batchSize) {
        const batch = allCoinsData.slice(i, i + batchSize);
        const batchIndex = Math.floor(i / batchSize) + 1;

        const prompt = createBatchAnalysisPrompt(batch, globalMetrics, options);

        console.log(`🤖 AI API attempt ${attempt}/${maxRetries} - batch ${batchIndex} (${batch.length} coins)...`);
        // Calculate tokens needed: R1 reasoning model needs more tokens (internal thinking + JSON output)
        // ~500 tokens per coin to account for reasoning overhead
        const estimatedTokens = Math.min(batch.length * 500, 16000);
        console.log(`📊 Requesting ${estimatedTokens} max tokens for ${batch.length} coins (R1 reasoning model)`);
      
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: config.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: estimatedTokens, // Dynamic based on coin count
        temperature: 0.1,
      }, {
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Technical Analysis Bot',
        },
        timeout: 45000,
      });

        console.log(`✅ OpenRouter batch status: ${response.status} (batch ${batchIndex})`);
      if (!response.data) throw new Error('AI API failed - no response data');
      if (!response.data.choices || !response.data.choices[0]) {
        throw new Error('AI API failed - no choices in response');
      }
      if (!response.data.choices[0].message || !response.data.choices[0].message.content) {
          console.log('⚠️ AI response has no content (batch', batchIndex, ')');
        console.log('📄 Full response structure:', JSON.stringify(response.data, null, 2).substring(0, 2000));
        throw new Error('AI API failed - empty response content');
      }
      
      const content = response.data.choices[0].message.content;
      if (!content || content.trim().length === 0) {
          console.log('⚠️ AI response content is empty (batch', batchIndex, ')');
        console.log('📄 Full response:', JSON.stringify(response.data, null, 2).substring(0, 2000));
        throw new Error('AI API failed - response content is empty');
      }
      
      const finishReason = response.data.choices[0].finish_reason;
      if (finishReason === 'length') {
          console.log('⚠️ AI response was truncated (hit token limit). Response may be incomplete for batch', batchIndex);
      }
      
        const parsed = parseBatchAIResponse(content, batch);
        console.log(`✅ Successfully parsed batch AI response for ${Object.keys(parsed).length} coins (batch ${batchIndex})`);

        Object.assign(combinedResults, parsed);
      }

      return combinedResults;
      
    } catch (error) {
      lastError = error;
      
      if (error.response) {
        const status = error.response.status;
        console.log(`⚠️ Batch AI error (attempt ${attempt}/${maxRetries}): ${status} ${error.response.statusText}`);
        console.log('Details:', JSON.stringify(error.response.data).slice(0, 500));
        
        // Handle rate limiting (429)
        if (status === 429 && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.log(`⏳ Rate limited. Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry
        }
        
        // For other errors, don't retry
        if (status !== 429) {
          break;
        }
      } else {
        console.log(`⚠️ Batch AI analysis failed (attempt ${attempt}/${maxRetries}):`, error.message);
        break; // Network errors - don't retry
      }
    }
  }
  
  // All retries failed
  console.log('❌ All AI API attempts failed. Falling back to deterministic analysis.');
  if (lastError?.response?.status === 429) {
    console.log('💡 TIP: Free AI models have strict rate limits. Consider using a paid model:');
    console.log('   Set AI_MODEL=deepseek/deepseek-chat (~$0.14 per million tokens)');
  }
  console.log('↩️ Using fallback analysis...');
  return generateBatchAnalysis(allCoinsData);
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
    
    // Include current news if available
    let newsText = '';
    if (coin.news && coin.news.articles && coin.news.articles.length > 0) {
      const recentNews = coin.news.articles.slice(0, 3).map(n => `  - ${n.title} (${n.source})`).join('\n');
      newsText = `\n   Recent News:\n${recentNews}`;
    } else {
      newsText = '\n   Recent News: No significant news found';
    }
    
    // Include historical context
    let historicalText = '';
    const historical = coin.historicalData || { evaluations: [], news: [] };
    
    if (historical.evaluations && historical.evaluations.length > 0) {
      const recentEvals = historical.evaluations.slice(0, 3).map(evaluation => {
        const date = new Date(evaluation.timestamp).toLocaleDateString();
        return `  - [${date}] ${evaluation.data.action || 'HOLD'} (${(evaluation.data.confidence * 100).toFixed(0)}%) - ${evaluation.data.reason || 'No reason'}`;
      }).join('\n');
      historicalText += `\n   Historical Evaluations:\n${recentEvals}`;
    }
    
    if (historical.news && historical.news.length > 0) {
      const historicalNews = historical.news.slice(0, 2).map(n => {
        const date = new Date(n.publishedAt).toLocaleDateString();
        return `  - [${date}] ${n.title} (${n.source})`;
      }).join('\n');
      historicalText += `\n   Historical News:\n${historicalNews}`;
    }
    
    if (!historicalText) {
      historicalText = '\n   Historical Context: No previous evaluations or news found';
    }
    
    return `${idx + 1}. ${coin.symbol} (${coin.name}) - Price: $${coin.currentPrice}
   Daily: RSI ${frame1d.rsi || 'N/A'}, Trend ${frame1d.trend || 'N/A'}, BB ${frame1d.bollingerPosition || 'N/A'}
   Hourly: RSI ${frame1h.rsi || 'N/A'}, Trend ${frame1h.trend || 'N/A'}, Momentum ${frame1h.momentum || 'N/A'}${newsText}${historicalText}`;
  }).join('\n\n');

  return `BATCH CRYPTO TECHNICAL ANALYSIS REQUEST:

${globalMetricsText}Analyze ${allCoinsData.length} cryptocurrencies and provide trading signals with RISK MANAGEMENT.

COINS TO ANALYZE:
${coinsSummary}

IMPORTANT: Consider technical indicators, recent news, AND historical context when making recommendations.
- Review previous evaluations to see if patterns are consistent or changing
- Historical news can provide context for current price movements
- News can significantly impact price movements - factor this into your analysis
- If previous evaluations were wrong, learn from those mistakes

For each coin, provide:
1. Action: BUY, SELL, or HOLD
2. Confidence: 0.0 to 1.0
3. Brief reason (1 sentence) - mention if news influenced the decision
4. Top 2-3 insights (include news impact if relevant)
5. RISK MANAGEMENT LEVELS:
   - entryPrice: Best entry price
   - takeProfit: Target profit level
   - stopLoss: Stop loss level
   - addPosition: DCA/Average down level (below entry for BUY, above for SELL)
   - expectedGainPercent: Expected gain % (positive number)

Calculate levels based on support/resistance and volatility.
For BUY: stopLoss < entryPrice < takeProfit
For SELL: takeProfit < entryPrice < stopLoss

Respond with JSON array:
[
  {
    "symbol": "BTC",
    "action": "BUY|SELL|HOLD",
    "confidence": 0.75,
    "reason": "...",
    "insights": ["...", "..."],
    "entryPrice": 50000,
    "takeProfit": 55000,
    "stopLoss": 48000,
    "addPosition": 49000,
    "expectedGainPercent": 10
  },
  ...
]`;
}

function parseBatchAIResponse(aiResponse, allCoinsData) {
  try {
    // Check if response is empty
    if (!aiResponse || aiResponse.trim().length === 0) {
      console.log('⚠️ AI response is empty, using fallback analysis');
      return generateBatchAnalysis(allCoinsData);
    }
    
    console.log(`📝 AI Response preview: ${aiResponse.substring(0, 500)}...`);
    console.log(`📏 AI Response length: ${aiResponse.length} chars`);
    
    // Try to extract JSON array
    let jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    
    if (!jsonMatch) {
      console.log('⚠️ No JSON array found in response, trying to find partial JSON...');
      // Sometimes the response is just the array without markdown
      if (aiResponse.trim().startsWith('[')) {
        jsonMatch = [aiResponse.trim()];
      }
    }
    
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      
      // Try to fix common JSON issues
      // 1. Remove trailing commas before ] or }
      jsonStr = jsonStr.replace(/,(\s*[\]}])/g, '$1');
      
      // 2. If JSON is incomplete, try to extract complete objects first
      const openBrackets = (jsonStr.match(/\[/g) || []).length;
      const closeBrackets = (jsonStr.match(/\]/g) || []).length;
      const openBraces = (jsonStr.match(/\{/g) || []).length;
      const closeBraces = (jsonStr.match(/\}/g) || []).length;
      
      let parsed;
      
      // First, try to parse as-is
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        // If parsing fails, try to fix incomplete JSON
        if (openBrackets > closeBrackets || openBraces > closeBraces) {
          console.log(`⚠️ Incomplete JSON detected (${openBrackets} [ vs ${closeBrackets} ], ${openBraces} { vs ${closeBraces} }). Attempting to fix...`);
          
          // Try to extract complete objects manually (more reliable than fixing brackets)
          const objects = [];
          
          // Find all object start positions (look for "symbol" key)
          const symbolPattern = /"symbol"\s*:\s*"([^"]+)"/g;
          const objectStarts = [];
          let symbolMatch;
          
          while ((symbolMatch = symbolPattern.exec(jsonStr)) !== null) {
            // Find the opening brace before this symbol
            let startIndex = symbolMatch.index;
            while (startIndex > 0 && jsonStr[startIndex] !== '{') {
              startIndex--;
            }
            if (jsonStr[startIndex] === '{') {
              objectStarts.push({ start: startIndex, symbol: symbolMatch[1] });
            }
          }
          
          // For each object start, try to extract the complete object
          for (const objInfo of objectStarts) {
            try {
              let braceCount = 0;
              let inString = false;
              let escapeNext = false;
              let objStr = '';
              
              // Extract the complete object by tracking braces
              for (let i = objInfo.start; i < jsonStr.length; i++) {
                const char = jsonStr[i];
                objStr += char;
                
                if (escapeNext) {
                  escapeNext = false;
                  continue;
                }
                
                if (char === '\\') {
                  escapeNext = true;
                  continue;
                }
                
                if (char === '"') {
                  inString = !inString;
                  continue;
                }
                
                if (!inString) {
                  if (char === '{') braceCount++;
                  if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                      // Found complete object
                      break;
                    }
                  }
                }
              }
              
              // If object is incomplete, try to close it
              if (braceCount > 0) {
                for (let i = 0; i < braceCount; i++) {
                  objStr += '}';
                }
              }
              
              const obj = JSON.parse(objStr);
              if (obj.symbol) {
                objects.push(obj);
              }
            } catch (e) {
              // Skip invalid objects, continue with next
            }
          }
          
          // If we extracted objects, use them
          if (objects.length > 0) {
            console.log(`✅ Extracted ${objects.length} valid objects from incomplete JSON`);
            parsed = objects;
          } else {
            // Last resort: try to fix by adding closing brackets
            console.log(`⚠️ Could not extract objects, trying to fix brackets...`);
            let fixedJson = jsonStr;
            for (let i = 0; i < (openBraces - closeBraces); i++) {
              fixedJson += '}';
            }
            for (let i = 0; i < (openBrackets - closeBrackets); i++) {
              fixedJson += ']';
            }
            try {
              parsed = JSON.parse(fixedJson);
              console.log(`✅ Fixed JSON by adding closing brackets`);
            } catch (e) {
              console.log(`⚠️ JSON parse failed even after fixing: ${e.message}`);
              console.log(`📄 Problematic JSON (first 1000 chars): ${jsonStr.substring(0, 1000)}`);
              throw parseError;
            }
          }
        } else {
          console.log(`⚠️ JSON parse failed: ${parseError.message}`);
          console.log(`📄 Problematic JSON (first 1000 chars): ${jsonStr.substring(0, 1000)}`);
          throw parseError;
        }
      }
      
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
      
      console.log(`✅ Successfully parsed ${Object.keys(results).length} AI evaluations`);
      
      // Fill in missing coins with HOLD
      const missingCoins = [];
      allCoinsData.forEach((coin) => {
        if (!results[coin.symbol]) {
          missingCoins.push(coin.symbol);
          results[coin.symbol] = {
            action: 'HOLD',
            confidence: 0.3,
            reason: 'No AI evaluation provided (incomplete response)',
            insights: ['AI response incomplete - using technical analysis'],
            signal: 'HOLD | Pending',
            aiEvaluated: false,
          };
        }
      });
      
      if (missingCoins.length > 0) {
        console.log(`⚠️ ${missingCoins.length} coins missing from AI response: ${missingCoins.join(', ')}. Using fallback analysis.`);
      }
      
      return results;
    }
    throw new Error('Invalid AI response format - no JSON array found');
  } catch (error) {
    console.log('❌ Failed to parse batch AI response:', error.message);
    console.log('📄 Raw response (first 2000 chars):', aiResponse.substring(0, 2000));
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
