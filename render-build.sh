#!/bin/bash
# Render build script for Python + TA-Lib support

set -e  # Exit on error

echo "🔨 Starting build process..."

# Install Node.js dependencies
echo "📦 Installing Node.js packages..."
npm install

# Check if Python is available
if command -v python3 &> /dev/null; then
    echo "✅ Python3 found: $(python3 --version)"
    
    # Try to install TA-Lib dependencies
    echo "🐍 Installing Python dependencies..."
    
    # Install numpy first (required by TA-Lib)
    pip3 install numpy --no-cache-dir || echo "⚠️ numpy install failed, continuing..."
    
    # Install pandas
    pip3 install pandas --no-cache-dir || echo "⚠️ pandas install failed, continuing..."
    
    # Install scipy
    pip3 install scipy --no-cache-dir || echo "⚠️ scipy install failed, continuing..."
    
    # Try to install TA-Lib (may fail without C library)
    echo "🔧 Attempting to install TA-Lib..."
    pip3 install TA-Lib --no-cache-dir 2>/dev/null && echo "✅ TA-Lib installed successfully!" || {
        echo "⚠️ TA-Lib installation failed (requires ta-lib C library)"
        echo "   Bot will use JavaScript fallback - still works great!"
        echo "   To enable TA-Lib, see PYTHON_SETUP.md"
    }
    
    echo "✅ Python setup completed"
else
    echo "⚠️ Python3 not found - skipping Python setup"
    echo "   Bot will use JavaScript fallback"
fi

echo "✅ Build completed successfully!"

