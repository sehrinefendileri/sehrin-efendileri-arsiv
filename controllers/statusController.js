import { getMonitoringStatus } from '../services/monitoringService.js';
export function getStatus(req,res) { res.json({ ok:true, ...getMonitoringStatus(), time:new Date() }); }
