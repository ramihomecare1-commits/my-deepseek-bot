#!/bin/bash

# GitHub Push Helper Script
# This script helps you push your code to GitHub

set -e

echo "🚀 GitHub Push Helper"
echo "===================="
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install it first."
    exit 1
fi

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "📦 Initializing git repository..."
    git init
    echo "✅ Git repository initialized"
    echo ""
fi

# Show current status
echo "📊 Current status:"
git status
echo ""

# Ask if user wants to proceed
read -p "Do you want to add all files and commit? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled."
    exit 0
fi

# Add all files
echo "📝 Adding files..."
git add .
echo "✅ Files added"
echo ""

# Commit
read -p "Enter commit message (or press Enter for default): " commit_msg
if [ -z "$commit_msg" ]; then
    commit_msg="Update: Add enhancements and improvements"
fi

echo "💾 Committing changes..."
git commit -m "$commit_msg"
echo "✅ Changes committed"
echo ""

# Check for remote
if ! git remote | grep -q "^origin$"; then
    echo "🔗 No remote repository configured."
    echo ""
    read -p "Enter your GitHub repository URL (e.g., https://github.com/username/repo.git): " repo_url
    
    if [ -z "$repo_url" ]; then
        echo "⚠️  No repository URL provided. Skipping remote setup."
        echo "You can add it later with: git remote add origin <url>"
    else
        git remote add origin "$repo_url"
        echo "✅ Remote repository added"
        echo ""
    fi
else
    echo "✅ Remote repository already configured:"
    git remote -v
    echo ""
fi

# Ask about pushing
if git remote | grep -q "^origin$"; then
    read -p "Do you want to push to GitHub now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Determine default branch
        current_branch=$(git branch --show-current 2>/dev/null || echo "main")
        
        echo "🚀 Pushing to GitHub..."
        if git push -u origin "$current_branch" 2>/dev/null; then
            echo "✅ Successfully pushed to GitHub!"
        else
            echo "⚠️  Push failed. You may need to:"
            echo "   1. Authenticate with GitHub (see GITHUB_SETUP.md)"
            echo "   2. Check your repository URL"
            echo "   3. Make sure the branch name is correct (main or master)"
        fi
    else
        echo "ℹ️  You can push later with: git push -u origin main"
    fi
else
    echo "ℹ️  Add a remote repository first, then push with: git push -u origin main"
fi

echo ""
echo "✨ Done!"

