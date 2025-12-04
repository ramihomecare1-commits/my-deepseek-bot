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

        const prompt = `You are a crypto trading analyst. Analyze these critical pattern alerts and provide a concise market summary.

CRITICAL ALERTS:
${alertsText}

Provide:
1. Market Context (2-3 sentences about overall market state)
2. Top 3 Actionable Insights (specific trading recommendations)
3. Risk Assessment (key invalidation levels and warnings)

Keep response under 400 words. Be specific and actionable. Focus on the most important patterns.`;

        const response = await axios.post(
            OPENROUTER_API_URL,
            {
                model: 'deepseek/deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
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
