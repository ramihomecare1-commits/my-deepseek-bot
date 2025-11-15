/**
 * Sentiment Analysis Service
 * Analyzes news sentiment to improve trade decisions
 */

/**
 * Keywords for sentiment analysis
 */
const SENTIMENT_KEYWORDS = {
  bullish: [
    'bullish', 'surge', 'rally', 'moon', 'breakout', 'breakthrough',
    'adoption', 'partnership', 'milestone', 'growth', 'upgrade',
    'institutional', 'investment', 'buy', 'accumulate', 'long',
    'positive', 'optimistic', 'gains', 'profit', 'uptrend',
    'support', 'higher', 'increase', 'rise', 'soar', 'boom'
  ],
  bearish: [
    'bearish', 'crash', 'dump', 'plunge', 'drop', 'collapse',
    'regulation', 'ban', 'lawsuit', 'hack', 'exploit', 'scam',
    'fraud', 'sell', 'short', 'negative', 'pessimistic', 'loss',
    'decline', 'fall', 'downtrend', 'resistance', 'lower',
    'decrease', 'weak', 'vulnerable', 'risk', 'concern'
  ],
  neutral: [
    'analysis', 'report', 'data', 'update', 'announcement',
    'conference', 'interview', 'statement', 'release', 'overview'
  ]
};

/**
 * Analyze sentiment of a single text
 * @param {string} text - Text to analyze
 * @returns {Object} Sentiment analysis result
 */
function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return {
      score: 0,
      label: 'neutral',
      confidence: 0
    };
  }

  const lowerText = text.toLowerCase();
  
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  // Count keyword occurrences
  for (const keyword of SENTIMENT_KEYWORDS.bullish) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      bullishCount += matches.length;
    }
  }

  for (const keyword of SENTIMENT_KEYWORDS.bearish) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      bearishCount += matches.length;
    }
  }

  for (const keyword of SENTIMENT_KEYWORDS.neutral) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      neutralCount += matches.length;
    }
  }

  // Calculate sentiment score (-1 to 1)
  const totalKeywords = bullishCount + bearishCount + neutralCount;
  if (totalKeywords === 0) {
    return {
      score: 0,
      label: 'neutral',
      confidence: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0
    };
  }

  // Sentiment score: bullish = positive, bearish = negative
  const score = (bullishCount - bearishCount) / totalKeywords;
  
  // Determine label
  let label = 'neutral';
  if (score > 0.15) {
    label = 'bullish';
  } else if (score < -0.15) {
    label = 'bearish';
  }

  // Confidence based on keyword density
  const confidence = Math.min(totalKeywords / 10, 1.0); // Max at 10 keywords

  return {
    score: Number(score.toFixed(2)),
    label: label,
    confidence: Number(confidence.toFixed(2)),
    bullishCount: bullishCount,
    bearishCount: bearishCount,
    neutralCount: neutralCount
  };
}

/**
 * Analyze sentiment of news articles
 * @param {Array} articles - Array of news articles
 * @returns {Object} Aggregate sentiment analysis
 */
function analyzeNewsSentiment(articles) {
  if (!articles || articles.length === 0) {
    return {
      score: 0,
      label: 'neutral',
      confidence: 0,
      articlesAnalyzed: 0
    };
  }

  let totalScore = 0;
  let totalConfidence = 0;
  let bullishArticles = 0;
  let bearishArticles = 0;
  let neutralArticles = 0;

  // Analyze each article
  const sentiments = articles.map(article => {
    const text = `${article.title || ''} ${article.description || ''}`;
    return analyzeSentiment(text);
  });

  // Aggregate results
  for (const sentiment of sentiments) {
    totalScore += sentiment.score;
    totalConfidence += sentiment.confidence;

    if (sentiment.label === 'bullish') {
      bullishArticles++;
    } else if (sentiment.label === 'bearish') {
      bearishArticles++;
    } else {
      neutralArticles++;
    }
  }

  const avgScore = totalScore / articles.length;
  const avgConfidence = totalConfidence / articles.length;

  // Determine overall label
  let label = 'neutral';
  if (avgScore > 0.1) {
    label = 'bullish';
  } else if (avgScore < -0.1) {
    label = 'bearish';
  }

  return {
    score: Number(avgScore.toFixed(2)),
    label: label,
    confidence: Number(avgConfidence.toFixed(2)),
    articlesAnalyzed: articles.length,
    bullishArticles: bullishArticles,
    bearishArticles: bearishArticles,
    neutralArticles: neutralArticles,
    sentiments: sentiments.slice(0, 5) // Include first 5 individual sentiments
  };
}

/**
 * Get sentiment impact on trade decision
 * @param {Object} sentiment - Sentiment analysis result
 * @param {string} tradeDirection - 'long' or 'short'
 * @returns {Object} Impact assessment
 */
function getSentimentImpact(sentiment, tradeDirection = 'long') {
  if (!sentiment || sentiment.confidence < 0.3) {
    return {
      impact: 'none',
      adjustment: 0,
      message: 'Insufficient sentiment data'
    };
  }

  const isLong = tradeDirection === 'long';
  const score = sentiment.score;

  // For long trades
  if (isLong) {
    if (score > 0.3 && sentiment.label === 'bullish') {
      return {
        impact: 'positive',
        adjustment: 0.1, // Increase confidence by 10%
        message: 'Strong bullish sentiment supports long position'
      };
    } else if (score < -0.3 && sentiment.label === 'bearish') {
      return {
        impact: 'negative',
        adjustment: -0.15, // Decrease confidence by 15%
        message: 'Bearish sentiment contradicts long position - CAUTION'
      };
    }
  }
  // For short trades
  else {
    if (score < -0.3 && sentiment.label === 'bearish') {
      return {
        impact: 'positive',
        adjustment: 0.1,
        message: 'Strong bearish sentiment supports short position'
      };
    } else if (score > 0.3 && sentiment.label === 'bullish') {
      return {
        impact: 'negative',
        adjustment: -0.15,
        message: 'Bullish sentiment contradicts short position - CAUTION'
      };
    }
  }

  return {
    impact: 'neutral',
    adjustment: 0,
    message: 'Sentiment is neutral or weak'
  };
}

/**
 * Integrate sentiment into trade confidence
 * @param {number} technicalConfidence - Technical analysis confidence (0-1)
 * @param {Object} sentiment - Sentiment analysis result
 * @param {string} tradeDirection - 'long' or 'short'
 * @returns {Object} Adjusted confidence
 */
function integratesentiment(technicalConfidence, sentiment, tradeDirection = 'long') {
  const impact = getSentimentImpact(sentiment, tradeDirection);
  
  const adjustedConfidence = Math.max(0, Math.min(1, technicalConfidence + impact.adjustment));
  
  return {
    originalConfidence: technicalConfidence,
    sentimentScore: sentiment.score,
    sentimentLabel: sentiment.label,
    sentimentConfidence: sentiment.confidence,
    impact: impact.impact,
    adjustment: impact.adjustment,
    adjustedConfidence: Number(adjustedConfidence.toFixed(2)),
    message: impact.message
  };
}

module.exports = {
  analyzeSentiment,
  analyzeNewsSentiment,
  getSentimentImpact,
  integrateSentiment: integratesentiment,
  SENTIMENT_KEYWORDS
};

