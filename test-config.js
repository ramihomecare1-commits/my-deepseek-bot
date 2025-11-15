#!/usr/bin/env node

/**
 * Quick test to see what config.js detects
 */

console.log('🧪 Testing config.js detection...\n');

// Load config
const config = require('./config/config');

console.log('\n📊 Config Results:');
console.log(`   GEMINI_API_KEY in env: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`   OPENROUTER_API_KEY in env: ${process.env.OPENROUTER_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log('');
console.log(`   config.MONITORING_API_KEY: ${config.MONITORING_API_KEY ? '✅ Set (' + config.MONITORING_API_KEY.substring(0, 15) + '...)' : '❌ Not set'}`);
console.log(`   config.PREMIUM_API_KEY: ${config.PREMIUM_API_KEY ? '✅ Set (' + config.PREMIUM_API_KEY.substring(0, 15) + '...)' : '❌ Not set'}`);
console.log(`   config.USE_HYBRID_MODE: ${config.USE_HYBRID_MODE}`);
console.log(`   config.MONITORING_MODEL: ${config.MONITORING_MODEL}`);
console.log(`   config.MONITORING_API_TYPE: ${config.MONITORING_API_TYPE}`);
console.log(`   config.AI_MODEL: ${config.AI_MODEL}`);
console.log(`   config.PREMIUM_API_TYPE: ${config.PREMIUM_API_TYPE}`);
console.log(`   config.MONITORING_ENABLED: ${config.MONITORING_ENABLED}`);

