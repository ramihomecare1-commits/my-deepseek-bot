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

/**
 * Simple Neural Network for Trade Prediction
 * A lightweight feedforward neural network implementation
 */
class SimpleNeuralNetwork {
  constructor(inputSize, hiddenSize, outputSize) {
    // Initialize weights randomly
    this.weights1 = this.randomMatrix(inputSize, hiddenSize);
    this.weights2 = this.randomMatrix(hiddenSize, outputSize);
    this.bias1 = this.randomMatrix(1, hiddenSize);
    this.bias2 = this.randomMatrix(1, outputSize);
    this.learningRate = 0.01;
  }

  randomMatrix(rows, cols) {
    return Array(rows).fill(0).map(() => 
      Array(cols).fill(0).map(() => (Math.random() - 0.5) * 2)
    );
  }

  sigmoid(x) {
    return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
  }

  sigmoidDerivative(x) {
    const s = this.sigmoid(x);
    return s * (1 - s);
  }

  forward(input) {
    // Input to hidden
    const hidden = this.weights1.map((row, i) => {
      const sum = row.reduce((acc, w, j) => acc + w * input[j], 0) + this.bias1[0][i];
      return this.sigmoid(sum);
    });

    // Hidden to output
    const output = this.weights2[0].map((w, i) => {
      const sum = hidden.reduce((acc, h, j) => acc + this.weights2[j][i] * h, 0) + this.bias2[0][i];
      return this.sigmoid(sum);
    });

    return { hidden, output };
  }

  train(inputs, targets, epochs = 100) {
    for (let epoch = 0; epoch < epochs; epoch++) {
      inputs.forEach((input, idx) => {
        const { hidden, output } = this.forward(input);
        const target = targets[idx];

        // Calculate output error
        const outputError = output.map((o, i) => target[i] - o);
        const outputDelta = outputError.map((e, i) => e * this.sigmoidDerivative(output[i]));

        // Calculate hidden error
        const hiddenError = this.weights2.map((row, i) => 
          row.reduce((sum, w, j) => sum + w * outputDelta[j], 0)
        );
        const hiddenDelta = hiddenError.map((e, i) => e * this.sigmoidDerivative(hidden[i]));

        // Update weights
        this.weights2.forEach((row, i) => {
          row.forEach((w, j) => {
            this.weights2[i][j] += this.learningRate * outputDelta[j] * hidden[i];
          });
        });

        this.weights1.forEach((row, i) => {
          row.forEach((w, j) => {
            this.weights1[i][j] += this.learningRate * hiddenDelta[i] * input[j];
          });
        });

        // Update biases
        this.bias2[0].forEach((b, i) => {
          this.bias2[0][i] += this.learningRate * outputDelta[i];
        });

        this.bias1[0].forEach((b, i) => {
          this.bias1[0][i] += this.learningRate * hiddenDelta[i];
        });
      });
    }
  }

  predict(input) {
    const { output } = this.forward(input);
    return output;
  }
}

/**
 * Train neural network on historical trades
 * @param {Array} trades - Historical trades with features
 * @returns {Object} Trained model and metrics
 */
function trainNeuralNetwork(trades) {
  if (!trades || trades.length < 20) {
    return {
      success: false,
      message: 'Need at least 20 trades to train neural network'
    };
  }

  try {
    // Extract features and targets
    const features = [];
    const targets = [];

    trades.forEach(trade => {
      // Feature vector: [rsi, bollingerPosition, trend, momentum, confidence]
      const feature = [
        trade.rsi ? trade.rsi / 100 : 0.5,
        trade.bollingerPosition === 'LOWER' ? 0.2 : trade.bollingerPosition === 'UPPER' ? 0.8 : 0.5,
        trade.trend === 'BULLISH' ? 1 : trade.trend === 'BEARISH' ? -1 : 0,
        trade.momentum === 'STRONG_UP' ? 1 : trade.momentum === 'STRONG_DOWN' ? -1 : 0,
        trade.confidence || 0.65
      ];

      // Target: [win probability, profit probability]
      const pnl = trade.finalPnl || trade.pnl || 0;
      const isWin = pnl > 0 ? 1 : 0;
      const profitPercent = Math.min(1, Math.max(0, (pnl / 100) + 0.5)); // Normalize to 0-1

      features.push(feature);
      targets.push([isWin, profitPercent]);
    });

    // Train neural network
    const nn = new SimpleNeuralNetwork(5, 8, 2); // 5 inputs, 8 hidden, 2 outputs
    nn.train(features, targets, 50); // 50 epochs

    // Test on training data
    let correct = 0;
    let totalError = 0;
    features.forEach((feature, idx) => {
      const prediction = nn.predict(feature);
      const target = targets[idx];
      const predictedWin = prediction[0] > 0.5 ? 1 : 0;
      if (predictedWin === target[0]) correct++;
      totalError += Math.abs(prediction[0] - target[0]);
    });

    const accuracy = (correct / features.length) * 100;
    const avgError = totalError / features.length;

    return {
      success: true,
      model: nn,
      metrics: {
        accuracy: Math.round(accuracy * 100) / 100,
        avgError: Math.round(avgError * 100) / 100,
        trainingSamples: features.length
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Predict trade outcome using neural network
 * @param {Object} model - Trained neural network model
 * @param {Object} features - Trade features
 * @returns {Object} Prediction with confidence
 */
function predictWithNeuralNetwork(model, features) {
  if (!model || !model.predict) {
    return {
      success: false,
      error: 'Invalid model'
    };
  }

  try {
    const featureVector = [
      features.rsi ? features.rsi / 100 : 0.5,
      features.bollingerPosition === 'LOWER' ? 0.2 : features.bollingerPosition === 'UPPER' ? 0.8 : 0.5,
      features.trend === 'BULLISH' ? 1 : features.trend === 'BEARISH' ? -1 : 0,
      features.momentum === 'STRONG_UP' ? 1 : features.momentum === 'STRONG_DOWN' ? -1 : 0,
      features.confidence || 0.65
    ];

    const prediction = model.predict(featureVector);
    const winProbability = prediction[0];
    const profitProbability = prediction[1];

    return {
      success: true,
      winProbability: Math.round(winProbability * 100) / 100,
      profitProbability: Math.round(profitProbability * 100) / 100,
      prediction: winProbability > 0.6 ? 'WIN' : winProbability < 0.4 ? 'LOSS' : 'NEUTRAL',
      confidence: Math.abs(winProbability - 0.5) * 2
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Ensemble prediction combining multiple ML methods
 * @param {Object} features - Trade features
 * @param {Object} models - Trained models (neural network, etc.)
 * @returns {Object} Ensemble prediction
 */
function ensemblePredict(features, models = {}) {
  const predictions = [];

  // Simple scoring model
  const simplePred = predictTradeOutcome(features);
  if (simplePred) {
    predictions.push({
      method: 'scoring',
      winProbability: simplePred.probability,
      confidence: simplePred.confidence
    });
  }

  // Neural network prediction
  if (models.neuralNetwork) {
    const nnPred = predictWithNeuralNetwork(models.neuralNetwork, features);
    if (nnPred.success) {
      predictions.push({
        method: 'neural_network',
        winProbability: nnPred.winProbability,
        confidence: nnPred.confidence
      });
    }
  }

  // Average predictions
  if (predictions.length > 0) {
    const avgWinProb = predictions.reduce((sum, p) => sum + p.winProbability, 0) / predictions.length;
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

    return {
      success: true,
      winProbability: Math.round(avgWinProb * 100) / 100,
      confidence: Math.round(avgConfidence * 100) / 100,
      prediction: avgWinProb > 0.6 ? 'WIN' : avgWinProb < 0.4 ? 'LOSS' : 'NEUTRAL',
      methods: predictions.length,
      individualPredictions: predictions
    };
  }

  return {
    success: false,
    error: 'No models available'
  };
}

module.exports = {
  calculateFeatureImportance,
  calculateAdaptiveThreshold,
  predictTradeOutcome,
  learnFromTrades,
  trainNeuralNetwork,
  predictWithNeuralNetwork,
  ensemblePredict,
  SimpleNeuralNetwork
};

