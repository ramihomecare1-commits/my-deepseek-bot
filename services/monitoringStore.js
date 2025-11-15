/**
 * Shared monitoring state store
 * This module ensures all parts of the app use the same monitoring data instance
 */

const monitoringStore = {
  activities: [],
  isActive: false,
  MAX_ENTRIES: 50
};

function addMonitoringActivity(activity) {
  try {
    if (!activity || !activity.symbol) {
      console.log(`⚠️ Invalid monitoring activity data:`, activity);
      return;
    }
    
    const activityEntry = {
      ...activity,
      timestamp: new Date().toISOString()
    };
    monitoringStore.activities.push(activityEntry);
    
    console.log(`📊 Added monitoring activity: ${activity.symbol} - ${activity.volatility} volatility, ${activity.priceChange}%`);
    console.log(`   Total activities: ${monitoringStore.activities.length}`);
    console.log(`   Store instance ID:`, monitoringStore.activities.slice(-1)[0]?.timestamp);
    
    if (monitoringStore.activities.length > monitoringStore.MAX_ENTRIES) {
      monitoringStore.activities = monitoringStore.activities.slice(-monitoringStore.MAX_ENTRIES);
      console.log(`   Trimmed to ${monitoringStore.MAX_ENTRIES} entries`);
    }
  } catch (error) {
    console.log(`⚠️ Error adding monitoring activity:`, error.message, error.stack);
  }
}

function setMonitoringActive(active) {
  monitoringStore.isActive = active;
  console.log(`📊 Monitoring active status set to: ${active}`);
}

function getMonitoringStore() {
  return monitoringStore;
}

module.exports = {
  addMonitoringActivity,
  setMonitoringActive,
  getMonitoringStore
};

