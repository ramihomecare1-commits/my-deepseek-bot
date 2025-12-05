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

        const prompt = `You are an expert crypto trading analyst with deep market insight. Analyze these critical pattern alerts and provide actionable intelligence.

CRITICAL ALERTS:
${alertsText}

IMPORTANT: Each coin shows its CURRENT PRICE in parentheses. Always reference current prices in your analysis, NOT the invalidation/stop levels.

Provide a comprehensive analysis with:

1. **Market Context** (2-3 sentences)
   - Overall market state and sentiment
   - Key trends across major assets
   - Mention current prices

2. **Top 3 Actionable Insights**
   - Specific entry/exit recommendations with current prices
   - Risk/reward ratios
   - Timeframe for each trade

3. **Weekly Forecast** (NEW - Most Important)
   - Based on current patterns, volume trends, and market structure:
     * Expected price movements for next 7 days
     * Key levels to watch (support/resistance)
     * Potential breakout/breakdown scenarios
     * Volume expectations and what they signal
   - For each major coin, provide:
     * Bullish scenario: "If BTC holds $X, target $Y by [date]"
     * Bearish scenario: "If BTC breaks $X, expect $Y by [date]"
     * Probability assessment (High/Medium/Low confidence)

4. **Risk Assessment**
   - Key invalidation levels
   - Warning signs to watch
   - Position sizing recommendations

Keep response under 500 words. Be specific with prices and dates. Focus on the most important patterns and forecasts.`;

        const response = await axios.post(
            OPENROUTER_API_URL,
            {
                model: 'deepseek/deepseek-r1',  // Upgraded to R1 reasoning model
                messages: [
                    {
                        role: 'user',
                        content: prompt
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
