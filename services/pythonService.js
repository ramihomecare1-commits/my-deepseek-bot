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
    
    // Set up environment to find user-installed packages
    const env = { ...process.env };
    // Add user site-packages to PYTHONPATH if it exists
    const os = require('os');
    const userSitePackages = path.join(os.homedir(), '.local', 'lib', 'python3.*', 'site-packages');
    // Try to find actual Python user site-packages
    try {
      const { execSync } = require('child_process');
      const pythonUserSite = execSync('python3 -m site --user-site', { encoding: 'utf8', timeout: 5000 }).trim();
      if (pythonUserSite) {
        env.PYTHONPATH = (env.PYTHONPATH ? env.PYTHONPATH + ':' : '') + pythonUserSite;
      }
    } catch (e) {
      // Ignore if we can't determine user site-packages
    }
    
    // Check if Python is available
    const python = spawn('python3', [pythonScript], { env });
    
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
          const errorMsg = errorData.trim();
          console.log(`   Error: ${errorMsg}`);
          
          // Check if it's a missing module error
          if (errorMsg.includes('ModuleNotFoundError') || errorMsg.includes('No module named')) {
            console.log(`   💡 Python packages not installed on this system`);
            console.log(`   ✅ Bot will use JavaScript fallback (works perfectly!)`);
            console.log(`   📝 Note: Python is optional - your bot is fully functional without it`);
          }
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
      console.log('   ✅ Bot will use JavaScript fallback (works perfectly!)');
      console.log('   📝 Python is optional - your bot is fully functional without it');
      console.log('   💡 On Render free tier, Python packages may not install correctly');
      console.log('   🚀 Your bot works great with JavaScript analysis + DeepSeek R1 AI!');
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

