/**
 * Unified API Service
 * Centralized API call handling with retry logic and rate limiting
 */

const axios = require('axios');

/**
 * API Service Configuration
 */
const API_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  TIMEOUT: 10000, // 10 seconds
  RATE_LIMIT_DELAY: 3000 // 3 seconds between calls
};

/**
 * Last API call timestamp tracker
 */
const lastApiCalls = new Map();

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Retry attempt number
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
}

/**
 * Make API call with retry logic and rate limiting
 * @param {Object} options - Axios request options
 * @param {Object} config - Additional configuration
 * @returns {Promise} API response
 */
async function makeApiCall(options, config = {}) {
  const {
    maxRetries = API_CONFIG.MAX_RETRIES,
    timeout = API_CONFIG.TIMEOUT,
    rateLimitKey = 'default',
    rateLimitDelay = API_CONFIG.RATE_LIMIT_DELAY,
    onRetry = null
  } = config;

  // Rate limiting
  if (lastApiCalls.has(rateLimitKey)) {
    const lastCall = lastApiCalls.get(rateLimitKey);
    const timeSinceLastCall = Date.now() - lastCall;
    if (timeSinceLastCall < rateLimitDelay) {
      await sleep(rateLimitDelay - timeSinceLastCall);
    }
  }

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Update last call timestamp
      lastApiCalls.set(rateLimitKey, Date.now());

      // Make the API call
      const response = await axios({
        ...options,
        timeout: timeout
      });

      return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === maxRetries - 1;

      if (!isRetryable || isLastAttempt) {
        return {
          success: false,
          error: error.message,
          status: error.response?.status,
          data: error.response?.data,
          isTimeout: error.code === 'ECONNABORTED',
          isNetworkError: error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED'
        };
      }

      // Calculate backoff delay
      const backoffDelay = calculateBackoffDelay(attempt);
      
      if (onRetry) {
        onRetry(attempt + 1, maxRetries, backoffDelay, error);
      }

      await sleep(backoffDelay);
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    status: lastError?.response?.status
  };
}

/**
 * Check if error is retryable
 * @param {Error} error - Error object
 * @returns {boolean} Is retryable
 */
function isRetryableError(error) {
  // Network errors are retryable
  if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return true;
  }

  // HTTP status codes that are retryable
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (error.response && retryableStatusCodes.includes(error.response.status)) {
    return true;
  }

  return false;
}

/**
 * Make GET request with retry logic
 * @param {string} url - API URL
 * @param {Object} config - Request configuration
 * @returns {Promise} API response
 */
async function get(url, config = {}) {
  return makeApiCall({
    method: 'GET',
    url: url,
    ...config
  }, config);
}

/**
 * Make POST request with retry logic
 * @param {string} url - API URL
 * @param {Object} data - Request data
 * @param {Object} config - Request configuration
 * @returns {Promise} API response
 */
async function post(url, data, config = {}) {
  return makeApiCall({
    method: 'POST',
    url: url,
    data: data,
    ...config
  }, config);
}

/**
 * Batch multiple API calls with rate limiting
 * @param {Array} calls - Array of API call configurations
 * @param {Object} options - Batch options
 * @returns {Promise<Array>} Array of responses
 */
async function batchCalls(calls, options = {}) {
  const {
    batchSize = 5,
    delayBetweenBatches = 1000,
    continueOnError = true
  } = options;

  const results = [];
  
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    
    const batchPromises = batch.map(call => 
      makeApiCall(call.options, call.config || {})
        .catch(error => ({
          success: false,
          error: error.message
        }))
    );

    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          error: result.reason?.message || 'Unknown error'
        });
      }
    }

    // Delay between batches (except for last batch)
    if (i + batchSize < calls.length) {
      await sleep(delayBetweenBatches);
    }
  }

  return results;
}

/**
 * Clear rate limit cache for a specific key
 * @param {string} rateLimitKey - Rate limit key to clear
 */
function clearRateLimit(rateLimitKey) {
  lastApiCalls.delete(rateLimitKey);
}

/**
 * Clear all rate limits
 */
function clearAllRateLimits() {
  lastApiCalls.clear();
}

module.exports = {
  makeApiCall,
  get,
  post,
  batchCalls,
  clearRateLimit,
  clearAllRateLimits,
  API_CONFIG,
  sleep
};

