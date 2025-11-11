const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: '✅ Server is working!', 
    timestamp: new Date(),
    status: 'OK'
  });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'OK', time: new Date() });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'trading-bot',
    port: PORT,
    time: new Date()
  });
});

// Start server - THIS IS CRITICAL
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SERVER STARTED SUCCESSFULLY`);
  console.log(`✅ Port: ${PORT}`);
  console.log(`✅ Bound to: 0.0.0.0`);
  console.log(`✅ Ready for incoming requests`);
  console.log(`✅ Render should detect this port now`);
});

// Handle errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

module.exports = app;
