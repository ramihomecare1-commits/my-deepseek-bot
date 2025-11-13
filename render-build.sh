#!/bin/bash
# Render build script for Python + TA-Lib support

echo "🔨 Starting build process..."

# Install Node.js dependencies
echo "📦 Installing Node.js packages..."
npm install || exit 1

# Check if Python is available
if command -v python3 &> /dev/null; then
    echo "✅ Python3 found: $(python3 --version)"
    
    # Check if pip is available
    if command -v pip3 &> /dev/null || command -v pip &> /dev/null; then
        echo "✅ pip found: $(pip3 --version 2>/dev/null || pip --version)"
        
        # Use pip3 or pip
        PIP_CMD="pip3"
        command -v pip3 &> /dev/null || PIP_CMD="pip"
        
        echo "🐍 Installing Python dependencies..."
        
        # Install from requirements.txt
        if [ -f "python/requirements.txt" ]; then
            echo "📋 Installing from python/requirements.txt..."
            $PIP_CMD install --user -r python/requirements.txt --no-cache-dir || {
                echo "⚠️ pip install from requirements.txt failed, trying individual packages..."
                
                # Try individual installs
                $PIP_CMD install --user "numpy>=1.24.0,<2.0.0" --no-cache-dir || echo "⚠️ numpy failed"
                $PIP_CMD install --user "pandas>=2.0.0,<3.0.0" --no-cache-dir || echo "⚠️ pandas failed"
                $PIP_CMD install --user "scipy>=1.11.0,<2.0.0" --no-cache-dir || echo "⚠️ scipy failed"
            }
        else
            echo "⚠️ python/requirements.txt not found"
        fi
        
        # Verify installations
        echo "🔍 Verifying Python packages..."
        python3 -c "import numpy; print(f'  ✅ numpy {numpy.__version__}')" 2>/dev/null || echo "  ⚠️ numpy not available"
        python3 -c "import pandas; print(f'  ✅ pandas {pandas.__version__}')" 2>/dev/null || echo "  ⚠️ pandas not available"
        python3 -c "import scipy; print(f'  ✅ scipy {scipy.__version__}')" 2>/dev/null || echo "  ⚠️ scipy not available"
        
        echo "✅ Python setup completed"
    else
        echo "⚠️ pip not found - cannot install Python packages"
    fi
else
    echo "⚠️ Python3 not found - skipping Python setup"
    echo "   Bot will use JavaScript fallback"
fi

echo "✅ Build completed successfully!"

