#!/usr/bin/env node

/**
 * Quick script to check your environment variables
 * Run: node check-env.js
 */

console.log('🔍 Environment Variable Check\n');

const keys = [
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY', 
  'AI_API_KEY',
  'API_KEY',
];

console.log('Looking for API keys in environment:\n');

let foundKeys = [];
let missingKeys = [];

keys.forEach(key => {
  const value = process.env[key];
  if (value) {
    console.log(`✅ ${key}`);
    console.log(`   Value: ${value.substring(0, 20)}...`);
    console.log(`   Length: ${value.length} characters`);
    console.log('');
    foundKeys.push(key);
  } else {
    console.log(`❌ ${key} - NOT SET`);
    console.log('');
    missingKeys.push(key);
  }
});

console.log('📊 Summary:');
console.log(`   Found: ${foundKeys.length} key(s)`);
console.log(`   Missing: ${missingKeys.length} key(s)`);
console.log('');

// Determine what mode will be activated
const hasGemini = process.env.GEMINI_API_KEY;
const hasOpenRouter = process.env.OPENROUTER_API_KEY;

if (hasGemini && hasOpenRouter) {
  console.log('🔥 HYBRID MODE will be activated!');
  console.log('   Free Tier: Gemini Flash');
  console.log('   Premium Tier: DeepSeek R1');
} else if (hasGemini && !hasOpenRouter) {
  console.log('⚠️  Gemini-only mode (no hybrid)');
  console.log('   Free Tier: Gemini Flash');
  console.log('   Premium Tier: Gemini Pro');
  console.log('');
  console.log('💡 To enable HYBRID mode:');
  console.log('   export OPENROUTER_API_KEY=sk-or-v1-your-key');
} else if (!hasGemini && hasOpenRouter) {
  console.log('⚠️  OpenRouter-only mode (no hybrid, NOT FREE)');
  console.log('   Free Tier: DeepSeek Chat (costs money)');
  console.log('   Premium Tier: DeepSeek R1');
  console.log('');
  console.log('💡 To enable FREE monitoring with HYBRID mode:');
  console.log('   export GEMINI_API_KEY=AIza-your-key');
} else {
  console.log('❌ NO API KEYS FOUND!');
  console.log('');
  console.log('📝 To set up HYBRID mode (recommended):');
  console.log('');
  console.log('1. Get Gemini API key (FREE):');
  console.log('   https://aistudio.google.com/app/apikey');
  console.log('');
  console.log('2. Get OpenRouter API key:');
  console.log('   https://openrouter.ai/keys');
  console.log('');
  console.log('3. Export both:');
  console.log('   export GEMINI_API_KEY=AIza-your-gemini-key');
  console.log('   export OPENROUTER_API_KEY=sk-or-v1-your-openrouter-key');
  console.log('');
  console.log('4. Restart your bot');
}

console.log('');
console.log('🔧 Current shell: ' + (process.env.SHELL || 'unknown'));
console.log('');
console.log('💡 Tip: To make keys permanent, add to ~/.zshrc or ~/.bashrc');

