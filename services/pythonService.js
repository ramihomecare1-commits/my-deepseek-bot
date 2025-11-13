const { spawn } = require('child_process');
const path = require('path');

/**
 * Call Python advanced analysis service
 * @param {Object} data - Price data with arrays: prices, highs, lows, volumes
 * @returns {Promise<Object>} Advanced technical indicators
 */
async function getAdvancedAnalysis(data) {
  return new Promise((resolve, reject) => {
    // Use simple_analysis.py (works without TA-Lib)
    // For full TA-Lib support, switch to 'advanced_analysis.py'
    const pythonScript = path.join(__dirname, '..', 'python', 'simple_analysis.py');
    
    // Check if Python is available
    const python = spawn('python3', [pythonScript]);
    
    let resultData = '';
    let errorData = '';
    
    // Send data to Python via stdin
    python.stdin.write(JSON.stringify(data));
    python.stdin.end();
    
    // Collect stdout
    python.stdout.on('data', (chunk) => {
      resultData += chunk.toString();
    });
    
    // Collect stderr
    python.stderr.on('data', (chunk) => {
      errorData += chunk.toString();
    });
    
    // Handle completion
    python.on('close', (code) => {
      if (code !== 0) {
        console.log(`⚠️ Python analysis failed (exit code ${code})`);
        if (errorData) {
          console.log(`   Error: ${errorData}`);
        }
        // Return fallback instead of rejecting
        resolve({
          success: false,
          error: `Python exit code ${code}`,
          useFallback: true
        });
        return;
      }
      
      try {
        const result = JSON.parse(resultData);
        if (result.success) {
          console.log(`✅ Python analysis completed successfully`);
        } else {
          console.log(`⚠️ Python returned error: ${result.error}`);
        }
        resolve(result);
      } catch (parseError) {
        console.log(`⚠️ Failed to parse Python output: ${parseError.message}`);
        resolve({
          success: false,
          error: 'JSON parse error',
          useFallback: true
        });
      }
    });
    
    // Handle errors
    python.on('error', (err) => {
      console.log(`⚠️ Failed to start Python process: ${err.message}`);
      console.log(`   Make sure Python 3 and required packages are installed`);
      resolve({
        success: false,
        error: err.message,
        useFallback: true
      });
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      python.kill();
      resolve({
        success: false,
        error: 'Python analysis timeout',
        useFallback: true
      });
    }, 30000);
  });
}

/**
 * Test if Python environment is set up correctly
 */
async function testPythonSetup() {
  console.log('🐍 Testing Python setup...');
  
  const testData = {
    prices: Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10),
    highs: Array.from({ length: 50 }, (_, i) => 105 + Math.sin(i / 5) * 10),
    lows: Array.from({ length: 50 }, (_, i) => 95 + Math.sin(i / 5) * 10),
    volumes: Array.from({ length: 50 }, () => 1000000)
  };
  
  try {
    const result = await getAdvancedAnalysis(testData);
    
    if (result.success) {
      console.log('✅ Python analysis is working!');
      console.log(`   Available indicators: RSI, MACD, Bollinger, ADX, Stochastic, ATR, etc.`);
      return true;
    } else {
      console.log('⚠️ Python analysis not available:', result.error);
      console.log('   Bot will use JavaScript fallback (still works great!)');
      return false;
    }
  } catch (error) {
    console.log('⚠️ Python test failed:', error.message);
    return false;
  }
}

module.exports = {
  getAdvancedAnalysis,
  testPythonSetup
};

