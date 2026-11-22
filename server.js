import './config/env.js';
import app from './app.js';
import { env } from './config/env.js';
import { sendTelegramMessage } from './services/telegramService.js';
import { startMonitoring } from './services/monitoringService.js';
import { startMonitoringJob } from './jobs/monitoringJob.js';

startMonitoringJob();
app.listen(env.port, async () => {
  console.log('🚀 SERVER LIVE');
  await sendTelegramMessage(`🚀 ŞEHRİN EFENDİLERİ ARŞİV BOTU AKTİF\n\nSaat:\n${new Date().toLocaleString('tr-TR')}`);
  setTimeout(() => void startMonitoring(),5000);
});
