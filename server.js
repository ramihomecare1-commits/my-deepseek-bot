const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// Simple route
app.get('/', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date() });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'OK', time: new Date() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server successfully started on port ${PORT}`);
  console.log(`✅ Bound to 0.0.0.0:${PORT}`);
  console.log(`✅ Ready for Render port detection`);
});

module.exports = app;
