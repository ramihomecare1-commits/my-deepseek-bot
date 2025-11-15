/**
 * AI Hybrid Strategy
 * Combines technical indicators with AI analysis
 */

const BaseStrategy = require('./baseStrategy');
const { getAITechnicalAnalysis } = require('../services/aiService');
const { analyzeNewsSentiment, integrateSentiment } = require('../services/sentimentService');

class AIHybridStrategy extends BaseStrategy {
  constructor() {
    super(
      'AI Hybrid',
      'Combines technical analysis with AI evaluation and news sentiment'
    );
    
    this.config = {
      minTechnicalConfidence: 0.6,
      minAIConfidence: 0.65,
      useSentiment: true,
      minSentimentConfidence: 0.3
    };
  }

  /**
   * Analyze market data with AI
   * @param {Object} data - Market data
   * @returns {Object} Trade signal
   */
  async analyze(data) {
    const { frames, currentPrice, symbol, news, globalMetrics } = data;
    
    if (!frames) {
      return { signal: 'NONE', confidence: 0 };
    }

    // Step 1: Get AI analysis
    let aiAnalysis = null;
    try {
      aiAnalysis = await getAITechnicalAnalysis({
        symbol: symbol,
        currentPrice: currentPrice,
        frames: frames,
        globalMetrics: globalMetrics,
        news: news?.articles || []
      });
    } catch (error) {
      console.error(`⚠️ AI analysis failed for ${symbol}:`, error.message);
    }

    if (!aiAnalysis || !aiAnalysis.action) {
      return { signal: 'NONE', confidence: 0 };
    }

    let confidence = aiAnalysis.confidence || 0;
    let reasons = [aiAnalysis.reason || 'AI recommendation'];

    // Step 2: News sentiment analysis (if enabled)
    if (this.config.useSentiment && news && news.articles && news.articles.length > 0) {
      const sentiment = analyzeNewsSentiment(news.articles);
      
      if (sentiment.confidence >= this.config.minSentimentConfidence) {
        const sentimentIntegration = integrateSentiment(
          confidence,
          sentiment,
          aiAnalysis.action === 'BUY' ? 'long' : 'short'
        );
        
        confidence = sentimentIntegration.adjustedConfidence;
        reasons.push(`Sentiment: ${sentiment.label} (${sentiment.score})`);
      }
    }

    // Step 3: Convert AI action to signal
    const signal = aiAnalysis.action === 'BUY' ? 'BUY' : 
                   aiAnalysis.action === 'SELL' ? 'SELL' : 'NONE';

    return {
      signal: signal,
      confidence: confidence,
      reasons: reasons,
      entry: currentPrice,
      stopLoss: this.calculateStopLoss({ signal, confidence }, data),
      takeProfit: this.calculateTakeProfit({ signal, confidence }, data),
      strategy: this.name,
      aiAnalysis: aiAnalysis
    };
  }

  /**
   * Calculate stop loss from AI recommendation
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Stop loss price
   */
  calculateStopLoss(signal, data) {
    const { currentPrice, frames } = data;
    
    // Use support level if available
    const frame = frames?.['1h'] || {};
    if (frame.support) {
      return frame.support * 0.98;
    }
    
    // Default: 5% stop
    return currentPrice * 0.95;
  }

  /**
   * Calculate take profit from AI recommendation
   * @param {Object} signal - Trade signal
   * @param {Object} data - Market data
   * @returns {number} Take profit price
   */
  calculateTakeProfit(signal, data) {
    const { currentPrice, frames } = data;
    
    // Use resistance level if available
    const frame = frames?.['1h'] || {};
    if (frame.resistance) {
      return frame.resistance * 0.98;
    }
    
    // Default: Scale TP based on confidence
    const tpMultiplier = 1.08 + (signal.confidence * 0.05); // 8-13% based on confidence
    return currentPrice * tpMultiplier;
  }

  /**
   * Validate AI signal
   * @param {Object} signal - Trade signal
   * @returns {boolean} Is valid
   */
  validate(signal) {
    return (signal.signal === 'BUY' || signal.signal === 'SELL') && 
           signal.confidence >= this.config.minAIConfidence;
  }
}

module.exports = AIHybridStrategy;

