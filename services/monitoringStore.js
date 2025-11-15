// Shared monitoring activity store
// This module is imported by both the API routes and the bot
// to ensure they use the same in-memory data

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
    console.log(`   Activity entry:`, JSON.stringify(activityEntry));
    
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

function getMonitoringData() {
  return {
    activity: monitoringStore.activities,
    isActive: monitoringStore.isActive
  };
}

module.exports = {
  addMonitoringActivity,
  setMonitoringActive,
  getMonitoringData,
  monitoringStore // Export the store itself for direct access if needed
};
