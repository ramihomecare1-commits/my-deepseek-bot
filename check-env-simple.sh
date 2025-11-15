#!/bin/bash

echo "🔍 Environment Variable Check"
echo ""

# Check GEMINI_API_KEY
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ GEMINI_API_KEY: NOT SET"
else
    echo "✅ GEMINI_API_KEY: Set (${GEMINI_API_KEY:0:15}...)"
    echo "   Length: ${#GEMINI_API_KEY} characters"
    if [[ $GEMINI_API_KEY == AIza* ]]; then
        echo "   ✅ Valid Gemini key format"
    else
        echo "   ⚠️  Doesn't start with 'AIza' - might not be a Gemini key"
    fi
fi

echo ""

# Check OPENROUTER_API_KEY
if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "❌ OPENROUTER_API_KEY: NOT SET"
else
    echo "✅ OPENROUTER_API_KEY: Set (${OPENROUTER_API_KEY:0:20}...)"
    echo "   Length: ${#OPENROUTER_API_KEY} characters"
    if [[ $OPENROUTER_API_KEY == sk-or-v1-* ]]; then
        echo "   ✅ Valid OpenRouter key format"
    else
        echo "   ⚠️  Doesn't start with 'sk-or-v1-' - might not be an OpenRouter key"
    fi
fi

echo ""
echo "📊 Summary:"

if [ -n "$GEMINI_API_KEY" ] && [ -n "$OPENROUTER_API_KEY" ]; then
    echo "   🔥 HYBRID MODE: Will be ENABLED"
    echo "   Free Tier: Gemini Flash (FREE)"
    echo "   Premium Tier: DeepSeek R1"
elif [ -n "$GEMINI_API_KEY" ]; then
    echo "   ⚠️  Gemini-only mode (no hybrid)"
    echo "   Free Tier: Gemini Flash"
    echo "   Premium Tier: Gemini Pro"
elif [ -n "$OPENROUTER_API_KEY" ]; then
    echo "   ⚠️  OpenRouter-only mode (NOT FREE)"
    echo "   Free Tier: DeepSeek Chat (costs money)"
    echo "   Premium Tier: DeepSeek R1"
else
    echo "   ❌ NO API KEYS FOUND"
    echo ""
    echo "   To set them:"
    echo "   export GEMINI_API_KEY=AIza-your-key"
    echo "   export OPENROUTER_API_KEY=sk-or-v1-your-key"
fi

echo ""
echo "💡 To make permanent, add to ~/.zshrc:"
echo "   echo 'export GEMINI_API_KEY=...' >> ~/.zshrc"
echo "   echo 'export OPENROUTER_API_KEY=...' >> ~/.zshrc"
echo "   source ~/.zshrc"

