/**
 * Alert Management API Routes
 */

const express = require('express');
const router = express.Router();
const { loadAlertSettings, saveAlertSettings, loadAlertHistory } = require('../models/alertSettings');
const { sendTestAlert } = require('../services/alertNotificationService');

/**
 * GET /api/alerts/settings
 * Get current alert settings
 */
router.get('/settings', (req, res) => {
    try {
        const settings = loadAlertSettings();
        res.json({
            success: true,
            settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alerts/settings
 * Update alert settings
 */
router.post('/settings', (req, res) => {
    try {
        const settings = req.body;
        saveAlertSettings(settings);

        res.json({
            success: true,
            message: 'Alert settings updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/alerts/history
 * Get alert history (last 100)
 */
router.get('/history', (req, res) => {
    try {
        const history = loadAlertHistory();
        res.json({
            success: true,
            count: history.length,
            alerts: history
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/alerts/test
 * Send test alert
 */
router.post('/test', async (req, res) => {
    try {
        const sent = await sendTestAlert();

        res.json({
            success: true,
            sent,
            message: sent ? 'Test alert sent successfully' : 'Test alert logged (Telegram not configured)'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
