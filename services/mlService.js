/**
 * Machine Learning Service
 * Provides ML-based enhancements: adaptive thresholds, feature importance, pattern recognition
 */

/**
 * Calculate feature importance based on historical trade performance
 * @param {Array} trades - Array of closed trades with features
 * @returns {Object} Feature importance scores
 */
function calculateFeatureImportance(trades) {
  if (!trades || trades.length < 10) {
    return {
      success: false,
      message: 'Insufficient trade data for feature importance analysis'
    };
  }
  
  // Features to analyze
  const features = {
    rsi: [],
    bollinger: [],
    trend: [],
    momentum: [],
    confidence: [],
    pattern: []
  };
  
  // Collect feature values and outcomes
  trades.forEach(trade => {
    if (trade.insights) {
      const insights = Array.isArray(trade.insights) ? trade.insights : [trade.insights];
      const pnl = trade.finalPnl || trade.pnl || 0;
      const isWin = pnl > 0;
      
      insights.forEach(insight => {
        if (typeof insight === 'string') {
          if (insight.includes('RSI')) {
            const rsiMatch = insight.match(/RSI[:\s]+(\d+\.?\d*)/i);
            if (rsiMatch) {
              features.rsi.push({ value: parseFloat(rsiMatch[1]), outcome: isWin ? 1 : 0 });
            }
          }
          if (insight.includes('Bollinger')) {
            features.bollinger.push({ value: insight.includes('lower') ? 0.2 : insight.includes('upper') ? 0.8 : 0.5, outcome: isWin ? 1 : 0 });
          }
          if (insight.includes('trend') || insight.includes('BULLISH') || insight.includes('BEARISH')) {
            features.trend.push({ value: insight.includes('BULLISH') ? 1 : insight.includes('BEARISH') ? -1 : 0, outcome: isWin ? 1 : 0 });
          }
        }
      });
      
      if (trade.confidence) {
        features.confidence.push({ value: trade.confidence, outcome: isWin ? 1 : 0 });
      }
    }
  });
  
  // Calculate correlation/importance
  const importance = {};
  
  Object.keys(features).forEach(feature => {
    const data = features[feature];
    if (data.length < 5) {
      importance[feature] = 0;
      return;
    }
    
    // Simple correlation: how often feature appears in winning trades
    const winsWithFeature = data.filter(d => d.outcome === 1).length;
    const totalWithFeature = data.length;
    const winRate = totalWithFeature > 0 ? winsWithFeature / totalWithFeature : 0;
    
    // Weight by frequency
    const frequency = totalWithFeature / trades.length;
    importance[feature] = Math.round((winRate * frequency) * 100) / 100;
  });
  
  // Sort by importance
  const sorted = Object.entries(importance)
    .sort((a, b) => b[1] - a[1])
    .map(([feature, score]) => ({ feature, score }));
  
  return {
    success: true,
    importance: importance,
    sorted,
    topFeatures: sorted.slice(0, 3).map(s => s.feature)
  };
}

/**
 * Adaptive confidence threshold based on recent performance
 * @param {Array} recentTrades - Recent closed trades (last 20-50)
 * @param {number} baseThreshold - Base confidence threshold (default: 0.65)
 * @returns {number} Adjusted threshold
 */
function calculateAdaptiveThreshold(recentTrades, baseThreshold = 0.65) {
  if (!recentTrades || recentTrades.length < 5) {
    return baseThreshold;
  }
  
  // Calculate recent win rate
  const recentWins = recentTrades.filter(t => (t.finalPnl || t.pnl || 0) > 0).length;
  const recentWinRate = recentWins / recentTrades.length;
  
  // Adjust threshold based on performance
  // If win rate is high, we can lower threshold (more opportunities)
  // If win rate is low, raise threshold (be more selective)
  let adjustment = 0;
  
  if (recentWinRate > 0.6) {
    // High win rate - can be more aggressive
    adjustment = -0.05;
  } else if (recentWinRate < 0.4) {
    // Low win rate - be more conservative
    adjustment = 0.10;
  } else if (recentWinRate < 0.5) {
    // Below 50% - slightly more conservative
    adjustment = 0.05;
  }
  
  const newThreshold = Math.max(0.50, Math.min(0.90, baseThreshold + adjustment));
  
  return Math.round(newThreshold * 100) / 100;
}

/**
 * Predict trade outcome based on features (simple logistic regression approximation)
 * @param {Object} features - Trade features
 * @returns {Object} Prediction with confidence
 */
function predictTradeOutcome(features) {
  // Simple scoring model based on feature weights
  // In production, this would use a trained ML model
  
  let score = 0.5; // Base probability
  
  // RSI contribution
  if (features.rsi !== undefined) {
    if (features.rsi < 30) score += 0.15; // Oversold = bullish
    else if (features.rsi > 70) score -= 0.15; // Overbought = bearish
  }
  
  // Trend contribution
  if (features.trend === 'BULLISH') score += 0.10;
  else if (features.trend === 'BEARISH') score -= 0.10;
  
  // Bollinger position
  if (features.bollingerPosition !== undefined) {
    if (features.bollingerPosition < 0.2) score += 0.10; // Lower band = buy signal
    else if (features.bollingerPosition > 0.8) score -= 0.10; // Upper band = sell signal
  }
  
  // Confidence contribution
  if (features.confidence) {
    score += (features.confidence - 0.5) * 0.2;
  }
  
  // Pattern contribution
  if (features.pattern) {
    if (features.pattern.includes('BULLISH') || features.pattern.includes('SUPPORT')) {
      score += 0.05;
    }
  }
  
  // Normalize to 0-1
  score = Math.max(0, Math.min(1, score));
  
  return {
    probability: Math.round(score * 100) / 100,
    prediction: score > 0.55 ? 'WIN' : score < 0.45 ? 'LOSS' : 'NEUTRAL',
    confidence: Math.abs(score - 0.5) * 2 // How far from neutral
  };
}

/**
 * Learn from trade outcomes and update model
 * @param {Array} trades - Closed trades with outcomes
 * @returns {Object} Updated model parameters
 */
function learnFromTrades(trades) {
  if (!trades || trades.length < 10) {
    return {
      success: false,
      message: 'Need at least 10 trades to learn'
    };
  }
  
  const featureImportance = calculateFeatureImportance(trades);
  const adaptiveThreshold = calculateAdaptiveThreshold(trades.slice(-30));
  
  // Calculate optimal parameters
  const winningTrades = trades.filter(t => (t.finalPnl || t.pnl || 0) > 0);
  const losingTrades = trades.filter(t => (t.finalPnl || t.pnl || 0) < 0);
  
  const avgWinConfidence = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + (t.confidence || 0.65), 0) / winningTrades.length
    : 0.65;
  
  const avgLossConfidence = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + (t.confidence || 0.65), 0) / losingTrades.length
    : 0.65;
  
  return {
    success: true,
    featureImportance,
    adaptiveThreshold,
    recommendations: {
      optimalConfidence: Math.max(avgWinConfidence, adaptiveThreshold),
      avoidBelowConfidence: avgLossConfidence,
      topFeatures: featureImportance.topFeatures || []
    },
    stats: {
      totalTrades: trades.length,
      winRate: (winningTrades.length / trades.length) * 100,
      avgWinConfidence: Math.round(avgWinConfidence * 100) / 100,
      avgLossConfidence: Math.round(avgLossConfidence * 100) / 100
    }
  };
}

module.exports = {
  calculateFeatureImportance,
  calculateAdaptiveThreshold,
  predictTradeOutcome,
  learnFromTrades
};

