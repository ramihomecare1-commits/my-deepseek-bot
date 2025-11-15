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
        timeout: 10000, // Increased timeout to 10 seconds
        path: '/health',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        headers: {
          'User-Agent': 'KeepAlive-Service/1.0'
        }
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
          } else if (res.statusCode === 404) {
            // Try alternative health check endpoint
            console.log(`⚠️ /health returned 404, trying /api/health...`);
            this.pingAlternative();
          } else {
            console.log(`⚠️ Keep-alive ping returned status ${res.statusCode}`);
          }
        });
      });

      req.on('error', (err) => {
        // Only log non-connection errors
        if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
          console.log(`❌ Keep-alive ping failed: ${err.message}`);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        console.log('⏱️ Keep-alive ping timeout');
      });

      req.setTimeout(10000);
      req.end();
    } catch (error) {
      // Silently handle URL parsing errors
      if (error.message && !error.message.includes('Invalid URL')) {
        console.log(`❌ Keep-alive ping error: ${error.message}`);
      }
    }
  }

  /**
   * Ping alternative endpoint (/api/health)
   */
  async pingAlternative() {
    if (!this.url) {
      return;
    }

    try {
      const url = new URL(this.url);
      const client = url.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        timeout: 10000,
        path: '/api/health',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        headers: {
          'User-Agent': 'KeepAlive-Service/1.0'
        }
      };

      const req = client.request(options, (res) => {
        if (res.statusCode === 200) {
          const time = new Date().toLocaleTimeString();
          console.log(`💓 Keep-alive ping successful via /api/health (${time})`);
        }
      });

      req.on('error', () => {
        // Silently fail - main endpoint already failed
      });

      req.setTimeout(10000);
      req.end();
    } catch (error) {
      // Silently fail
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

