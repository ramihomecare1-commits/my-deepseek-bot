const https = require('https');
const http = require('http');

/**
 * Keep-Alive Service
 * Prevents Render free tier from sleeping by pinging the health endpoint
 * Render sleeps after 15 minutes of inactivity, so we ping every 10 minutes
 */
class KeepAliveService {
  constructor() {
    this.url = null;
    this.interval = 10 * 60 * 1000; // 10 minutes (Render sleeps after 15 min)
    this.timer = null;
    this.isRunning = false;
  }

  /**
   * Start the keep-alive service
   * Automatically detects Render URL from environment variables
   */
  start() {
    // Don't start if already running
    if (this.isRunning) {
      console.log('⚠️ Keep-alive service already running');
      return;
    }

    // Try to get URL from various environment variables
    this.url = 
      process.env.RENDER_EXTERNAL_URL || 
      process.env.RENDER_URL || 
      process.env.KEEP_ALIVE_URL ||
      null;

    // If no URL set, try to construct from PORT (for local testing)
    if (!this.url) {
      const port = process.env.PORT || 10000;
      this.url = `http://localhost:${port}`;
      console.log(`⚠️ Keep-alive using localhost (set RENDER_EXTERNAL_URL for production)`);
    }

    console.log(`🔄 Keep-alive service started`);
    console.log(`   URL: ${this.url}`);
    console.log(`   Interval: ${this.interval / 60000} minutes (prevents Render sleep)`);
    
    // Ping immediately
    this.ping();
    
    // Then ping every 10 minutes
    this.timer = setInterval(() => {
      this.ping();
    }, this.interval);

    this.isRunning = true;
  }

  /**
   * Stop the keep-alive service
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      console.log('🛑 Keep-alive service stopped');
    }
  }

  /**
   * Ping the health endpoint to keep the service awake
   */
  async ping() {
    if (!this.url) {
      return;
    }

    try {
      const url = new URL(this.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        timeout: 5000,
        path: url.pathname + '/health' || '/health',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80)
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            const time = new Date().toLocaleTimeString();
            console.log(`💓 Keep-alive ping successful (${time})`);
          } else {
            console.log(`⚠️ Keep-alive ping returned status ${res.statusCode}`);
          }
        });
      });

      req.on('error', (err) => {
        // Don't spam logs on errors (might be network issues)
        // Only log if it's a persistent problem
        if (err.code !== 'ECONNREFUSED') {
          console.log(`❌ Keep-alive ping failed: ${err.message}`);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        console.log('⏱️ Keep-alive ping timeout');
      });

      req.setTimeout(5000);
      req.end();
    } catch (error) {
      // Silently handle URL parsing errors
      if (error.message && !error.message.includes('Invalid URL')) {
        console.log(`❌ Keep-alive ping error: ${error.message}`);
      }
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      url: this.url,
      interval: this.interval / 60000 + ' minutes'
    };
  }
}

module.exports = new KeepAliveService();

