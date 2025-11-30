const axios = require('axios');
const config = require('../config/config');

/**
 * Filter and deduplicate news using Free AI
 */
async function filterNewsWithAI(symbol, rawNews, existingHashes) {
    if (!rawNews || rawNews.length === 0) {
        return [];
    }

    // Get API key with fallback
    const apiKey = config.FREE_TIER_API_KEY ||
        process.env.FREE_TIER_API_KEY ||
        config.OPENROUTER_API_KEY ||
        process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.warn(`⚠️ No Free AI API key configured for ${symbol}, skipping filtering`);
        return [];
    }

    const prompt = `You are a crypto news analyst. Filter and analyze these ${rawNews.length} news articles for ${symbol}.

EXISTING NEWS HASHES (avoid duplicates):
${existingHashes.length > 0 ? existingHashes.join(', ') : 'None'}

RAW NEWS:
${rawNews.map((n, i) => `${i + 1}. ${n.title}\n   ${n.body || n.news || n.summary || ''}`).join('\n\n')}

TASK:
1. Remove duplicates (check title similarity + existing hashes)
2. Remove irrelevant news (not about ${symbol} price/tech/adoption)
3. For each relevant article, provide:
   - title (original title)
   - summary (1 concise sentence)
   - sentiment (bullish/bearish/neutral)
   - relevance (1-10, where 10 is highly relevant)
   - hash (first 8 chars of MD5-like hash of title)

Return ONLY valid JSON array (no markdown, no explanation):
[
  {
    "title": "...",
    "summary": "...",
    "url": "...",
    "source": "...",
    "sentiment": "bullish",
    "relevance": 9,
    "hash": "abc12345"
  }
]

Return top 10 most relevant, non-duplicate articles. If no relevant news, return empty array [].`;

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'meta-llama/llama-3.2-3b-instruct:free',
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/ramihomecare1-commits/my-deepseek-bot',
                'X-Title': 'DeepSeek Trading Bot'
            },
            timeout: 30000
        });

        const content = response.data.choices[0].message.content;

        // Extract JSON from response (handle markdown code blocks and malformed JSON)
        // Try multiple extraction methods
        let jsonMatch = content.match(/\[[\s\S]*?\]/); // Non-greedy match

        if (!jsonMatch) {
            // Try to find JSON between code blocks
            const codeBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (codeBlockMatch) {
                jsonMatch = [codeBlockMatch[1]];
            }
        }

        if (!jsonMatch) {
            console.warn(`Free AI returned no valid JSON for ${symbol}`);
            return [];
        }

        let filtered = [];
        try {
            // Try to parse the JSON as-is first
            filtered = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            // If parsing fails, try to clean up common issues
            console.warn(`Free AI JSON parse error for ${symbol}, attempting cleanup...`);

            try {
                let cleanedJson = jsonMatch[0]
                    .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                    .replace(/'/g, '"') // Replace single quotes with double quotes
                    .replace(/(\w+):/g, '"$1":') // Add quotes to unquoted keys
                    .replace(/\n/g, ' ') // Remove newlines
                    .replace(/\r/g, '') // Remove carriage returns
                    .trim();

                // Remove any text after the closing bracket
                const closingBracketIndex = cleanedJson.lastIndexOf(']');
                if (closingBracketIndex !== -1) {
                    cleanedJson = cleanedJson.substring(0, closingBracketIndex + 1);
                }

                filtered = JSON.parse(cleanedJson);
            } catch (cleanupError) {
                console.error(`Free AI JSON cleanup failed for ${symbol}:`, cleanupError.message);
                console.error(`Problematic JSON snippet:`, jsonMatch[0].substring(0, 200));
                return []; // Give up, return empty array
            }
        }

        // Validate that we got an array
        if (!Array.isArray(filtered)) {
            console.warn(`Free AI returned non-array for ${symbol}`);
            return [];
        }

        // Add missing fields from raw news if needed
        return filtered.map(item => ({
            ...item,
            url: item.url || rawNews.find(n => n.title === item.title)?.url || '',
            source: item.source || rawNews.find(n => n.title === item.title)?.source?.title || 'Unknown'
        }));
    } catch (error) {
        if (error.response?.status === 401) {
            console.error(`❌ Free AI authentication failed for ${symbol}: Invalid API key`);
        } else if (error.response?.status === 429) {
            console.warn(`⚠️ Free AI rate limited for ${symbol}, skipping filtering`);
        } else {
            console.error(`Free AI filtering failed for ${symbol}:`, error.message);
        }
        return [];
    }
}

module.exports = { filterNewsWithAI };
