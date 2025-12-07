const axios = require('axios');

/**
 * AI Alert Summary Service
 * Generates enhanced summaries for critical pattern alerts using DeepSeek V3
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Generate AI summary for critical alerts
 * @param {Array} criticalAlerts - Array of critical alert objects
 * @returns {Promise<string>} AI-generated summary
 */
async function generateCriticalAlertSummary(criticalAlerts) {
    if (!criticalAlerts || criticalAlerts.length === 0) {
        console.log('⚠️  No critical alerts to summarize');
        return null;
    }

    console.log(`🤖 Generating AI summary for ${criticalAlerts.length} critical alert(s)...`);

    try {
        // Get previous report for context
        const { getLastScans } = require('../models/scanHistory');
        const previousScans = getLastScans(2); // Get last 2 scans
        let previousContext = '';

        if (previousScans && previousScans.length > 1) {
            const lastScan = previousScans[0];
            if (lastScan.aiSummary) {
                const timeSinceLastScan = Math.round((Date.now() - new Date(lastScan.timestamp).getTime()) / (1000 * 60 * 60)); // hours
                previousContext = `\n\nPREVIOUS REPORT CONTEXT (${timeSinceLastScan}h ago):\n${lastScan.aiSummary.substring(0, 500)}...\n\nIMPORTANT: Reference your previous analysis. Note what has changed, what remains the same, and update your recommendations accordingly. Don't repeat the same advice if nothing has changed - instead say "Maintaining previous recommendation" or "Update: [what changed]".\n`;
            }
        }

        // Format alerts for AI prompt
        const alertsText = criticalAlerts.map(alert => {
            const alertList = alert.alerts
                .filter(a => a.severity === 'critical')
                .map(a => {
                    let details = `[${a.timeframe}] ${a.message}`;
                    if (a.confidence) details += ` (Confidence: ${a.confidence.toFixed(1)})`;

                    // Add volume information if available
                    if (a.volumeConfirmed) {
                        details += ` | Volume: ✓`;
                        if (a.volumeRatio) {
                            details += ` ${a.volumeRatio.toFixed(1)}x`;
                        }
                    } else if (a.volumeRatio) {
                        details += ` | Volume: ${a.volumeRatio.toFixed(1)}x`;
                    }

                    // Add market structure context
                    if (a.marketStructure) {
                        const { trend, strength, aligned } = a.marketStructure;
                        if (trend !== 'ranging') {
                            const alignmentSymbol = aligned ? '✓' : '✗';
                            details += ` | Structure: ${trend.toUpperCase()} ${alignmentSymbol} (${strength}/10)`;
                        }
                    }

                    // Add confluence information
                    if (a.confluence && a.confluence.hasConfluence) {
                        details += ` | Confluence: ${a.confluence.direction.toUpperCase()} ✓✓`;
                    }

                    return details;
                })
                .join('\n  ');

            // Add current price for context
            const priceInfo = alert.currentPrice ? ` (Current Price: $${alert.currentPrice.toFixed(2)})` : '';
            return `${alert.symbol}${priceInfo}:\n  ${alertList}`;
        }).join('\n\n');

        console.log('📝 Alert data formatted for AI prompt');

        // Get current date for accurate forecasts
        const today = new Date();
        const currentDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
        const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const prompt = `You are an expert crypto trading analyst with deep market insight. Analyze these critical pattern alerts and provide actionable intelligence.

TODAY'S DATE: ${currentDate}
FORECAST PERIOD: Next 7 days (until ${weekFromNow})
${previousContext}
CRITICAL ALERTS:
${alertsText}

IMPORTANT CONTEXT:
- Each coin shows its CURRENT PRICE in parentheses - always reference these, NOT the stop levels
- "Stop:" levels are INVALIDATION points where the pattern fails - these are NOT price targets
- Use realistic price targets based on pattern structure, not invalidation levels
- All forecasts must use dates relative to today (e.g., "by Dec 12" not generic dates)
- **TIMEFRAME CONFLICTS:** When daily and weekly patterns disagree, LOWER confidence and note the conflict
  * Example: Daily bullish + Weekly bearish = MEDIUM confidence (not High)
  * Always mention timeframe conflicts in risk assessment
- **RSI CONTEXT:** 
  * Daily RSI < 30 = oversold (bullish for bounce)
  * Weekly RSI < 40 = oversold (bullish for reversal)
  * If BOTH oversold = HIGH confidence for reversal
  * If only daily oversold = MEDIUM confidence (short-term bounce only)

Provide a comprehensive analysis with:

1. **Market Context** (2-3 sentences)
   - Overall market state and sentiment
   - Key trends across major assets
   - Reference current prices (not stops)

2. **Top 3 Actionable Insights**
   - Specific entry/exit recommendations with CURRENT prices
   - Risk/reward ratios
   - Realistic timeframes (hours/days from today)
   - Use pattern structure for targets, not invalidation levels

3. **Weekly Forecast** (Most Important)
   - Based on current patterns, volume trends, and market structure
   - Expected price movements for next 7 days (until ${weekFromNow})
   - Key levels to watch (support/resistance from patterns)
   - Potential breakout/breakdown scenarios with DATES
   - Volume expectations and signals
   
   For each major coin, provide:
   - Bullish scenario: "If [COIN] holds $X, target $Y by [specific date]"
   - Bearish scenario: "If [COIN] breaks $X, expect $Y by [specific date]"
   - Probability assessment (High/Medium/Low confidence)
   - Use realistic targets based on pattern measurements

4. **Risk Assessment**
   - Pattern Invalidation Levels: Explain these are technical pattern failure points (the "Stop:" prices), not necessarily your recommended trade stops
   - Recommended Trade Stops: Provide realistic stop-loss levels based on current price context (typically 3-5% from entry)
   - **Timeframe Conflicts:** Flag any coins where daily and weekly signals disagree (e.g., "BTC: Daily bullish but weekly bearish - trade with caution")
   - Warning signs to watch (volume, momentum, key level breaks)
   - Position sizing recommendations (% of portfolio per trade)

**WRITING STYLE:**
- Use simple, clear language (avoid jargon like "confluence", "invalidation", "retracement")
- Instead of "confluence" say "multiple signals agree"
- Instead of "invalidation level" say "stop loss" or "pattern fails if price goes below"
- Instead of "retracement" say "pullback"
- Write like you're explaining to a friend, not a textbook
- Be direct and conversational

Keep response under 600 words (was 500). Be specific with prices and dates (use ${currentDate} as reference). Focus on the most important patterns and forecasts.`;

        const response = await axios.post(
            OPENROUTER_API_URL,
            {
                model: 'anthropic/claude-3.5-sonnet',  // Switched to Claude 3.5 Sonnet for better quality
                max_tokens: 800,  // Increased from default to prevent truncation
                provider: {
                    order: ['Anthropic'],  // Force Anthropic provider only
                    allow_fallbacks: false  // Disable fallbacks to free models
                },
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/ramihomecare1-commits/my-deepseek-bot',
                    'X-Title': 'Pattern Scanner AI Summary'
                }
            }
        );

        const aiSummary = response.data.choices[0].message.content.trim();
        console.log('✅ AI summary generated successfully');
        return formatAISummary(aiSummary);

    } catch (error) {
        console.error('❌ Error generating AI summary:');
        console.error('  Message:', error.message);
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Data:', JSON.stringify(error.response.data, null, 2));
        }
        console.error('  Falling back to basic alert format');
        return null;
    }
}

/**
 * Format AI summary for Telegram
 * @param {string} summary - Raw AI summary
 * @returns {string} Formatted summary
 */
function formatAISummary(summary) {
    let formatted = summary;

    // Remove markdown headers (###) for Telegram
    formatted = formatted.replace(/###\s*/g, '');

    // Replace markdown bold (**text**) with nothing (Telegram doesn't support it well)
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '$1');

    // Add proper section breaks with emojis
    formatted = formatted
        .replace(/Market Context:?/gi, '\n📊 Market Context:')
        .replace(/Top.*Insights:?/gi, '\n\n🎯 Top Insights:')
        .replace(/Actionable Insights:?/gi, '\n\n🎯 Actionable Insights:')
        .replace(/Risk Assessment:?/gi, '\n\n⚠️ Risk Assessment:');

    // Clean up extra newlines
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    return formatted.trim();
}

module.exports = {
    generateCriticalAlertSummary
};
