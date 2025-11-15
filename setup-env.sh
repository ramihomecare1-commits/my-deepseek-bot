#!/bin/bash

# Setup script to add API keys to .env file

ENV_FILE=".env"

echo "🔧 Setting up .env file for Two-Tier AI Monitoring"
echo ""

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating .env file..."
    touch "$ENV_FILE"
fi

# Check if GEMINI_API_KEY already exists
if grep -q "^GEMINI_API_KEY=" "$ENV_FILE"; then
    echo "✅ GEMINI_API_KEY already in .env"
else
    echo "" >> "$ENV_FILE"
    echo "# Gemini API Key (FREE - for monitoring)" >> "$ENV_FILE"
    echo "GEMINI_API_KEY=" >> "$ENV_FILE"
    echo "Added GEMINI_API_KEY placeholder to .env"
fi

# Check if OPENROUTER_API_KEY already exists
if grep -q "^OPENROUTER_API_KEY=" "$ENV_FILE"; then
    echo "✅ OPENROUTER_API_KEY already in .env"
else
    echo "" >> "$ENV_FILE"
    echo "# OpenRouter API Key (for premium DeepSeek R1)" >> "$ENV_FILE"
    echo "OPENROUTER_API_KEY=" >> "$ENV_FILE"
    echo "Added OPENROUTER_API_KEY placeholder to .env"
fi

echo ""
echo "📝 Next steps:"
echo "1. Open .env file and add your actual API keys:"
echo "   GEMINI_API_KEY=AIza_your_actual_key"
echo "   OPENROUTER_API_KEY=sk-or-v1-your_actual_key"
echo ""
echo "2. Restart your bot: npm start"
echo ""
echo "💡 Get your keys:"
echo "   Gemini: https://aistudio.google.com/app/apikey"
echo "   OpenRouter: https://openrouter.ai/keys"

