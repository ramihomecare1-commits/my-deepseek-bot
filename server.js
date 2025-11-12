/* eslint-disable no-console */
// Minimal server entry point
require('dotenv').config();

// Ensure fetch exists (Node 18+/polyfill)
if (!global.fetch) {
  global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

const app = require('./app');

// Server is already started in app.js, this file is just for compatibility
console.log('🚀 Server started from app.js');

// Export for testing purposes
module.exports = app;
