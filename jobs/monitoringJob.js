import cron from 'node-cron';
import { startMonitoring, getMonitoringStatus } from '../services/monitoringService.js';
export function startMonitoringJob() {
  cron.schedule('*/3 * * * *', () => { const s=getMonitoringStatus(); if (!s.running && !s.archiving) void startMonitoring(); });
}
