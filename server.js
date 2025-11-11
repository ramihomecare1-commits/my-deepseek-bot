// Replace the entire script section in your HTML with this:

<script>
    let autoRefresh = true;
    let analysisDialog = null;

    // Create analysis dialog
    function createAnalysisDialog() {
        if (analysisDialog) return;
        
        analysisDialog = document.createElement('div');
        analysisDialog.id = 'analysisDialog';
        analysisDialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 500px;
            background: white;
            border: 3px solid #007bff;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            z-index: 1000;
            display: none;
            max-height: 80vh;
            overflow-y: auto;
        `;
        
        analysisDialog.innerHTML = `
            <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #007bff;">🧠 DeepSeek AI Analysis</h3>
                <button onclick="closeAnalysisDialog()" style="background: #dc3545; border: none; color: white; padding: 5px 10px; border-radius: 3px; cursor: pointer;">✕</button>
            </div>
            <div id="currentAnalysis">
                <p>Waiting for analysis to start...</p>
            </div>
            <div style="margin-top: 15px; border-top: 1px solid #ddd; padding-top: 10px;">
                <h4>Recent Analysis:</h4>
                <div id="recentAnalysis" style="max-height: 200px; overflow-y: auto;"></div>
            </div>
        `;
        
        document.body.appendChild(analysisDialog);
    }

    function showAnalysisDialog() {
        if (!analysisDialog) createAnalysisDialog();
        analysisDialog.style.display = 'block';
        updateLiveAnalysis();
        // Auto-update every 2 seconds when dialog is open
        if (this.analysisUpdateInterval) clearInterval(this.analysisUpdateInterval);
        this.analysisUpdateInterval = setInterval(updateLiveAnalysis, 2000);
    }

    function closeAnalysisDialog() {
        if (analysisDialog) {
            analysisDialog.style.display = 'none';
            if (this.analysisUpdateInterval) {
                clearInterval(this.analysisUpdateInterval);
                this.analysisUpdateInterval = null;
            }
        }
    }

    async function updateLiveAnalysis() {
        try {
            const response = await fetch('/live-analysis');
            const data = await response.json();
            
            // Update current analysis
            const currentDiv = document.getElementById('currentAnalysis');
            if (data.currentlyAnalyzing) {
                const analysis = data.currentlyAnalyzing;
                currentDiv.innerHTML = `
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #007bff;">
                        <h4 style="margin: 0 0 10px 0;">🔍 Analyzing: ${analysis.symbol} - ${analysis.name}</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                            <div><strong>Stage:</strong> ${analysis.stage}</div>
                            <div><strong>Time:</strong> ${new Date(analysis.timestamp).toLocaleTimeString()}</div>
                        </div>
                        ${analysis.technicals ? `
                        <div style="background: #e9ecef; padding: 10px; border-radius: 3px; margin: 10px 0;">
                            <strong>Technical Indicators:</strong>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px;">
                                <div>RSI: ${analysis.technicals.rsi}</div>
                                <div>Bollinger: ${analysis.technicals.bollingerPosition}</div>
                                <div>Support: $${analysis.technicals.support}</div>
                                <div>Resistance: $${analysis.technicals.resistance}</div>
                                <div>Trend: ${analysis.technicals.trend}</div>
                            </div>
                        </div>
                        ` : ''}
                        ${analysis.result ? `
                        <div style="background: ${analysis.result.action === 'BUY' ? '#e8f5e8' : analysis.result.action === 'SELL' ? '#f8d7da' : '#fff3cd'}; 
                                    padding: 10px; border-radius: 3px; margin: 10px 0; border-left: 4px solid ${analysis.result.action === 'BUY' ? 'green' : analysis.result.action === 'SELL' ? 'red' : 'orange'};">
                            <strong>AI Decision:</strong> <span style="color: ${analysis.result.action === 'BUY' ? 'green' : analysis.result.action === 'SELL' ? 'red' : 'orange'}; font-weight: bold;">${analysis.result.action}</span>
                            <br><strong>Confidence:</strong> ${analysis.result.confidence}
                            <br><strong>Reason:</strong> ${analysis.result.reason}
                        </div>
                        ` : ''}
                        ${analysis.error ? `<div style="color: red; font-weight: bold;">❌ ${analysis.stage}</div>` : ''}
                    </div>
                `;
            } else {
                currentDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #6c757d;">
                        <h4>🔄 No Active Analysis</h4>
                        <p>The scanner is currently not analyzing any coins.</p>
                        <p>Start a scan to see live AI analysis.</p>
                    </div>
                `;
            }
            
            // Update recent analysis
            const recentDiv = document.getElementById('recentAnalysis');
            if (data.recentAnalysis && data.recentAnalysis.length > 0) {
                recentDiv.innerHTML = data.recentAnalysis.map(analysis => `
                    <div style="border-bottom: 1px solid #eee; padding: 5px 0; font-size: 0.9em;">
                        <strong>${analysis.symbol}</strong>: ${analysis.stage}
                        <br><small style="color: #666;">${new Date(analysis.timestamp).toLocaleTimeString()}</small>
                        ${analysis.result ? `<br><small style="color: ${analysis.result.action === 'BUY' ? 'green' : analysis.result.action === 'SELL' ? 'red' : 'orange'};">→ ${analysis.result.action} (${analysis.result.confidence})</small>` : ''}
                    </div>
                `).join('');
            } else {
                recentDiv.innerHTML = '<p style="color: #666; text-align: center;">No recent analysis</p>';
            }
            
        } catch (error) {
            console.log('Error updating live analysis:', error);
        }
    }

    async function startAutoScan() {
        try {
            const response = await fetch('/start-scan', { method: 'POST' });
            const result = await response.json();
            
            document.getElementById('statusText').innerHTML = \`<span style="color: lightgreen;">🔄 Auto-Scanning</span>\`;
            document.getElementById('statusText').parentElement.className = 'scan-info auto-scanning';
            document.getElementById('nextScan').textContent = 'Every 5 minutes';
            
            alert(\`Auto-scan started! Scanning \${result.coins} coins every \${result.interval}\`);
            
            // Load initial results
            manualScan();
            
        } catch (error) {
            alert('Error starting auto-scan');
        }
    }

    async function stopAutoScan() {
        try {
            const response = await fetch('/stop-scan', { method: 'POST' });
            const result = await response.json();
            
            document.getElementById('statusText').innerHTML = '<span style="color: lightcoral;">🛑 Stopped</span>';
            document.getElementById('statusText').parentElement.className = 'scan-info stopped';
            document.getElementById('nextScan').textContent = 'Manual mode';
            
            alert('Auto-scan stopped');
            
        } catch (error) {
            alert('Error stopping auto-scan');
        }
    }

    async function manualScan() {
        try {
            document.getElementById('results').innerHTML = '<p>🔍 Scanning 50 cryptocurrencies with technical analysis...</p>';
            
            // Show analysis dialog when scan starts
            showAnalysisDialog();
            
            const response = await fetch('/scan-now');
            const data = await response.json();
            
            if (data.opportunities.length === 0) {
                document.getElementById('results').innerHTML = \`
                    <div style="text-align: center; padding: 40px; color: #6c757d;">
                        <h3>📭 No High-Confidence Opportunities</h3>
                        <p>Scanned \${data.analyzedCoins} of \${data.totalCoins} coins</p>
                        <p><em>No technical setups meeting 65%+ confidence threshold</em></p>
                        <p>Next scan: \${new Date(data.nextScan).toLocaleTimeString()}</p>
                    </div>
                \`;
                return;
            }
            
            let opportunitiesHTML = \`
                <div style="margin-bottom: 20px;">
                    <h4>🎯 Found \${data.opportunitiesFound} Technical Opportunities</h4>
                    <p><em>Scan time: \${new Date(data.scanTime).toLocaleString()} | Next scan: \${new Date(data.nextScan).toLocaleTimeString()}</em></p>
                </div>
            \`;
            
            data.opportunities.forEach(opp => {
                const actionClass = opp.action.toLowerCase();
                
                opportunitiesHTML += \`
                    <div class="opportunity">
                        <div style="display: flex; justify-content: between; align-items: start;">
                            <div style="flex: 1;">
                                <h4 style="margin: 0;">
                                    <span class="\${actionClass}">\${opp.action}</span> 
                                    \${opp.symbol} - \${opp.name}
                                </h4>
                                <p><strong>Price:</strong> \${opp.price} • <strong>Confidence:</strong> \${(opp.confidence * 100).toFixed(0)}%</p>
                                <p><strong>Signal:</strong> \${opp.signal}</p>
                                <p><strong>Reason:</strong> \${opp.reason}</p>
                            </div>
                            <div style="flex: 1;">
                                <div class="technical-grid">
                                    <div class="technical-item"><strong>RSI:</strong> \${opp.technicals.rsi}</div>
                                    <div class="technical-item"><strong>Bollinger:</strong> \${opp.technicals.bollingerPosition}</div>
                                    <div class="technical-item"><strong>Trend:</strong> \${opp.technicals.trend}</div>
                                    <div class="technical-item"><strong>Support:</strong> \${opp.technicals.support}</div>
                                    <div class="technical-item"><strong>Resistance:</strong> \${opp.technicals.resistance}</div>
                                </div>
                            </div>
                        </div>
                        <div style="margin-top: 10px;">
                            <strong>Insights:</strong>
                            <ul>
                                \${opp.insights.map(insight => \`<li>\${insight}</li>\`).join('')}
                            </ul>
                        </div>
                        <div style="font-size: 0.8em; color: #666; margin-top: 5px;">
                            Analyzed: \${new Date(opp.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                \`;
            });
            
            document.getElementById('results').innerHTML = opportunitiesHTML;
            
        } catch (error) {
            document.getElementById('results').innerHTML = 
                '<p style="color: red;">Scan failed. Technical analysis may be rate limited.</p>';
        }
    }

    async function viewHistory() {
        try {
            const response = await fetch('/scan-history');
            const history = await response.json();
            alert(\`Last scan: \${history.length > 0 ? new Date(history[0].timestamp).toLocaleString() : 'No history'}\`);
        } catch (error) {
            alert('Error loading history');
        }
    }

    // Update the scanner controls to include analysis dialog button
    function updateScannerControls() {
        const controlsDiv = document.querySelector('.card h3').parentElement;
        if (!document.getElementById('viewAnalysisBtn')) {
            const analysisBtn = document.createElement('button');
            analysisBtn.id = 'viewAnalysisBtn';
            analysisBtn.innerHTML = '🧠 View Live Analysis';
            analysisBtn.onclick = showAnalysisDialog;
            analysisBtn.style.background = '#6f42c1';
            controlsDiv.insertBefore(analysisBtn, controlsDiv.querySelector('button:nth-child(3)'));
        }
    }

    // Auto-refresh results every 30 seconds when auto-scanning
    setInterval(() => {
        if (document.getElementById('statusText').textContent.includes('Auto-Scanning')) {
            manualScan();
        }
    }, 30000);

    // Initial load
    document.addEventListener('DOMContentLoaded', function() {
        updateScannerControls();
        manualScan();
        createAnalysisDialog();
    });
</script>
