/**
 * Strategy Manager
 * Manages and executes multiple trading strategies
 */

const RSIBollingerStrategy = require('./rsiBollingerStrategy');
const AIHybridStrategy = require('./aiHybridStrategy');

class StrategyManager {
  constructor() {
    this.strategies = new Map();
    this.activeStrategy = null;
    
    // Register available strategies
    this.registerStrategy('rsi_bollinger', new RSIBollingerStrategy());
    this.registerStrategy('ai_hybrid', new AIHybridStrategy());
    
    // Set default strategy
    this.setActiveStrategy('ai_hybrid');
  }

  /**
   * Register a new strategy
   * @param {string} id - Strategy ID
   * @param {BaseStrategy} strategy - Strategy instance
   */
  registerStrategy(id, strategy) {
    this.strategies.set(id, strategy);
  }

  /**
   * Get strategy by ID
   * @param {string} id - Strategy ID
   * @returns {BaseStrategy} Strategy instance
   */
  getStrategy(id) {
    return this.strategies.get(id);
  }

  /**
   * Set active strategy
   * @param {string} id - Strategy ID
   * @returns {boolean} Success
   */
  setActiveStrategy(id) {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      console.error(`❌ Strategy not found: ${id}`);
      return false;
    }
    
    this.activeStrategy = strategy;
    console.log(`✅ Active strategy set to: ${strategy.name}`);
    return true;
  }

  /**
   * Get active strategy
   * @returns {BaseStrategy} Active strategy
   */
  getActiveStrategy() {
    return this.activeStrategy;
  }

  /**
   * Analyze market data with active strategy
   * @param {Object} data - Market data
   * @returns {Promise<Object>} Trade signal
   */
  async analyze(data) {
    if (!this.activeStrategy || !this.activeStrategy.enabled) {
      return {
        signal: 'NONE',
        confidence: 0,
        reasons: ['No active strategy']
      };
    }

    return await this.activeStrategy.analyze(data);
  }

  /**
   * Analyze with specific strategy
   * @param {string} strategyId - Strategy ID
   * @param {Object} data - Market data
   * @returns {Promise<Object>} Trade signal
   */
  async analyzeWithStrategy(strategyId, data) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy || !strategy.enabled) {
      return {
        signal: 'NONE',
        confidence: 0,
        reasons: [`Strategy ${strategyId} not available or disabled`]
      };
    }

    return await strategy.analyze(data);
  }

  /**
   * Analyze with all strategies and combine results
   * @param {Object} data - Market data
   * @returns {Promise<Object>} Combined signal
   */
  async analyzeWithAllStrategies(data) {
    const results = [];
    
    for (const [id, strategy] of this.strategies) {
      if (!strategy.enabled) continue;
      
      try {
        const signal = await strategy.analyze(data);
        if (signal.signal !== 'NONE') {
          results.push({
            strategyId: id,
            strategyName: strategy.name,
            ...signal
          });
        }
      } catch (error) {
        console.error(`❌ Strategy ${id} failed:`, error.message);
      }
    }

    // Combine results
    if (results.length === 0) {
      return {
        signal: 'NONE',
        confidence: 0,
        reasons: ['No signals from any strategy']
      };
    }

    // Use highest confidence signal
    const best = results.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    return {
      ...best,
      allSignals: results,
      consensusCount: results.filter(r => r.signal === best.signal).length,
      totalStrategies: results.length
    };
  }

  /**
   * Get list of all strategies
   * @returns {Array} Strategy list
   */
  listStrategies() {
    const list = [];
    for (const [id, strategy] of this.strategies) {
      list.push({
        id: id,
        name: strategy.name,
        description: strategy.description,
        enabled: strategy.enabled,
        isActive: strategy === this.activeStrategy
      });
    }
    return list;
  }

  /**
   * Enable/disable a strategy
   * @param {string} id - Strategy ID
   * @param {boolean} enabled - Enable flag
   * @returns {boolean} Success
   */
  setStrategyEnabled(id, enabled) {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      return false;
    }
    
    strategy.setEnabled(enabled);
    console.log(`${enabled ? '✅ Enabled' : '⛔ Disabled'} strategy: ${strategy.name}`);
    return true;
  }
}

// Singleton instance
const strategyManager = new StrategyManager();

module.exports = strategyManager;

