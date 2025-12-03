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
        return null;
    }

    try {
        // Format alerts for AI prompt
        const alertsText = criticalAlerts.map(alert => {
            const alertList = alert.alerts
                .filter(a => a.severity === 'critical')
                .map(a => {
                    let details = `[${a.timeframe}] ${a.message}`;
                    if (a.confidence) details += ` (Confidence: ${a.confidence.toFixed(1)})`;
                    return details;
                })
                .join('\n  ');

            return `${alert.symbol}:\n  ${alertList}`;
        }).join('\n\n');

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
        return formatAISummary(aiSummary);

    } catch (error) {
        console.error('Error generating AI summary:', error.message);
        return null;
    }
}

/**
 * Format AI summary for Telegram
 * @param {string} summary - Raw AI summary
 * @returns {string} Formatted summary
 */
function formatAISummary(summary) {
    // Add emoji headers if not present
    let formatted = summary;

    // Ensure proper formatting
    if (!formatted.includes('📊')) {
        formatted = `📊 ${formatted}`;
    }

    // Add section breaks for readability
    formatted = formatted
        .replace(/Market Context:/gi, '\n📊 Market Context:')
        .replace(/Top.*Insights:/gi, '\n🎯 Top Insights:')
        .replace(/Risk Assessment:/gi, '\n⚠️ Risk Assessment:')
        .replace(/Actionable Insights:/gi, '\n🎯 Actionable Insights:');

    return formatted.trim();
}

module.exports = {
    generateCriticalAlertSummary
};
