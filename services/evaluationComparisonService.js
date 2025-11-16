const axios = require('axios');
const config = require('../config/config');
const { retrieveRelatedData } = require('./dataStorageService');

/**
 * Evaluation Comparison Service
 * Uses Free Tier AI to compare new evaluations/news with stored ones
 * Only stores incremental updates to reduce storage and token usage
 */

/**
 * Compare new AI evaluation with stored evaluation using Free Tier AI
 * @param {Object} newEvaluation - New evaluation data
 * @param {string} symbol - Coin symbol
 * @returns {Object} Comparison result with only new information
 */
async function compareAndExtractNewInfo(newEvaluation, symbol) {
  try {
    // Check if deduplication is enabled
    if (!config.ENABLE_EVALUATION_DEDUPLICATION) {
      return {
        isNew: true,
        newData: newEvaluation,
        storageReduction: 0,
      };
    }

    // Get most recent stored evaluation
    const history = await retrieveRelatedData({ symbol, days: 7, limit: 1 });
    const lastStored = history?.evaluations?.[0];

    if (!lastStored || !lastStored.data) {
      // No previous evaluation: store full
      console.log(`💾 ${symbol}: No previous evaluation found, storing full data`);
      return {
        isNew: true,
        newData: newEvaluation,
        storageReduction: 0,
      };
    }

    // Use Free Tier AI to compare
    console.log(`🔍 ${symbol}: Comparing new evaluation with last stored using Free-tier AI...`);
    const comparison = await compareWithFreeTierAI(newEvaluation, lastStored.data, symbol);
    return comparison;
  } catch (err) {
    console.error(`⚠️ Error comparing evaluations for ${symbol}:`, err.message);
    // Fallback: store everything if comparison fails
    return {
      isNew: true,
      newData: newEvaluation,
      storageReduction: 0,
      error: err.message,
    };
  }
}

/**
 * Use Free Tier AI to compare two evaluations
 */
async function compareWithFreeTierAI(newEval, storedEval, symbol) {
  const apiKey = config.MONITORING_API_KEY;
  const model = config.MONITORING_MODEL || 'deepseek/deepseek-chat';

  if (!apiKey) {
    // No Free Tier key: store full
    return {
      isNew: true,
      newData: newEval,
      storageReduction: 0,
    };
  }

  const prompt = `Compare these two crypto trading evaluations for ${symbol} and extract ONLY new information.

**STORED EVALUATION (Previous):**
${JSON.stringify(storedEval, null, 2).substring(0, 1000)}

**NEW EVALUATION (Current):**
${JSON.stringify(newEval, null, 2).substring(0, 1000)}

**TASK:**
1. Identify what information in NEW is genuinely NEW or CHANGED vs STORED.
2. Identify what is essentially DUPLICATE.
3. Return STRICT JSON ONLY:

{
  "hasNewInfo": true|false,
  "newInfo": {
    // only fields that are new or changed (omit duplicates)
  },
  "duplicateFields": ["list", "of", "duplicate", "field", "names"],
  "similarityScore": 0-100,
  "summary": "short text summary"
}

Be strict: if more than ${config.EVALUATION_DEDUPLICATION_THRESHOLD || 50}% of content is duplicate, set "hasNewInfo": false.`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'Evaluation Deduplication',
        },
        timeout: 20000,
      }
    );

    const content = response.data.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const parsed = JSON.parse(jsonMatch[0]);
    const originalSize = JSON.stringify(newEval).length;
    const newInfoSize = JSON.stringify(parsed.newInfo || {}).length;
    const reduction =
      originalSize > 0
        ? Number(((originalSize - newInfoSize) / originalSize * 100).toFixed(1))
        : 0;

    if (!parsed.hasNewInfo) {
      console.log(`⏭️ ${symbol}: Skipping storage (~${reduction}% duplicate) - ${parsed.summary || 'No new info'}`);
      return {
        isNew: false,
        newData: storedEval,
        duplicateFields: parsed.duplicateFields || [],
        storageReduction: reduction,
        summary: parsed.summary,
      };
    }

    // Merge stored + new changes
    const merged = {
      ...storedEval,
      ...(parsed.newInfo || {}),
      _lastUpdate: new Date().toISOString(),
      _updateType: 'incremental',
    };

    console.log(`✅ ${symbol}: Storing incremental update (~${reduction}% reduction) - ${parsed.summary || 'New info detected'}`);
    return {
      isNew: true,
      newData: merged,
      duplicateFields: parsed.duplicateFields || [],
      storageReduction: reduction,
      summary: parsed.summary,
    };
  } catch (err) {
    console.error(`⚠️ Free Tier AI comparison failed for ${symbol}:`, err.message);
    // Fallback: store everything
    return {
      isNew: true,
      newData: newEval,
      storageReduction: 0,
      error: err.message,
    };
  }
}

/**
 * Compare new news articles with stored news using Free Tier AI
 */
async function compareAndExtractNewNews(newArticles, symbol) {
  try {
    if (!config.ENABLE_NEWS_DEDUPLICATION) {
      return {
        hasNewNews: true,
        newArticles,
        storageReduction: 0,
        originalCount: newArticles.length,
        newCount: newArticles.length,
        duplicateCount: 0,
      };
    }

    const history = await retrieveRelatedData({ symbol, days: 7, limit: 30 });
    const storedNews = history?.news || [];

    if (!storedNews.length) {
      console.log(`📰 ${symbol}: No stored news found, storing all ${newArticles.length} articles`);
      return {
        hasNewNews: true,
        newArticles,
        storageReduction: 0,
        originalCount: newArticles.length,
        newCount: newArticles.length,
        duplicateCount: 0,
      };
    }

    console.log(`🔍 ${symbol}: Comparing ${newArticles.length} new articles with ${storedNews.length} stored using Free-tier AI...`);

    const uniques = [];
    let duplicates = 0;

    for (const article of newArticles) {
      const comparison = await compareNewsWithFreeTierAI(article, storedNews, symbol);
      if (comparison.isNew) {
        uniques.push(article);
      } else {
        duplicates++;
      }
    }

    const originalSize = JSON.stringify(newArticles).length;
    const newSize = JSON.stringify(uniques).length;
    const reduction =
      originalSize > 0
        ? Number(((originalSize - newSize) / originalSize * 100).toFixed(1))
        : 0;

    console.log(`📰 ${symbol}: ${newArticles.length} articles → ${uniques.length} unique (skipped ${duplicates} duplicates, ~${reduction}% reduction)`);

    return {
      hasNewNews: uniques.length > 0,
      newArticles: uniques,
      storageReduction: reduction,
      originalCount: newArticles.length,
      newCount: uniques.length,
      duplicateCount: duplicates,
    };
  } catch (err) {
    console.error(`⚠️ Error comparing news for ${symbol}:`, err.message);
    return {
      hasNewNews: true,
      newArticles,
      storageReduction: 0,
      originalCount: newArticles.length,
      newCount: newArticles.length,
      duplicateCount: 0,
      error: err.message,
    };
  }
}

/**
 * Use Free Tier AI to determine if a news article has genuinely new info
 */
async function compareNewsWithFreeTierAI(newArticle, storedArticles, symbol) {
  const apiKey = config.MONITORING_API_KEY;
  const model = config.MONITORING_MODEL || 'deepseek/deepseek-chat';

  if (!apiKey) {
    return { isNew: true, storageReduction: 0 };
  }

  const recent = storedArticles.slice(0, 10).map(a => ({
    title: a.title,
    summary: a.content?.slice(0, 200) || '',
  }));

  const prompt = `Compare this NEW crypto news article for ${symbol} with STORED articles.

NEW ARTICLE:
Title: ${newArticle.title}
Summary: ${(newArticle.content || '').slice(0, 300)}

STORED ARTICLES:
${recent
  .map(
    (a, i) =>
      `${i + 1}. ${a.title}\n   ${a.summary}`
  )
  .join('\n')}

TASK:
Decide if NEW ARTICLE adds genuinely new information beyond STORED ARTICLES.
Return STRICT JSON ONLY:

{
  "isNew": true|false,
  "similarityScore": 0-100,
  "reasoning": "short text",
  "duplicateFields": ["title" or "summary" etc]
}

If similarityScore >= ${config.NEWS_DEDUPLICATION_THRESHOLD || 70}, set isNew=false.`;

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://my-deepseek-bot-1.onrender.com',
          'X-Title': 'News Deduplication',
        },
        timeout: 15000,
      }
    );

    const content = response.data.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isNew: parsed.isNew !== false && (parsed.similarityScore || 0) < (config.NEWS_DEDUPLICATION_THRESHOLD || 70),
      similarityScore: parsed.similarityScore || 0,
      duplicateFields: parsed.duplicateFields || [],
    };
  } catch (err) {
    // Silently fall back to storing - comparison is optional
    return { isNew: true, storageReduction: 0, error: err.message };
  }
}

module.exports = {
  compareAndExtractNewInfo,
  compareWithFreeTierAI,
  compareAndExtractNewNews,
  compareNewsWithFreeTierAI,
};

