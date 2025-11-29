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

        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn(`Free AI returned no valid JSON for ${symbol}`);
            return [];
        }

        const filtered = JSON.parse(jsonMatch[0]);

        // Add missing fields from raw news if needed
        return filtered.map(item => ({
            ...item,
            url: item.url || rawNews.find(n => n.title === item.title)?.url || '',
            source: item.source || rawNews.find(n => n.title === item.title)?.source?.title || 'Unknown'
        }));
    } catch (error) {
        if (error.response?.status === 401) {
            console.error(`❌ Free AI authentication failed for ${symbol}: Invalid API key`);
        } else {
            console.error(`Free AI filtering failed for ${symbol}:`, error.message);
        }
        return [];
    }
}

module.exports = { filterNewsWithAI };
```
