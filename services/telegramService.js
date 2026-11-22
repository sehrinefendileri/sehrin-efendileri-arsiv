import axios from 'axios';
import { env } from '../config/env.js';
export async function sendTelegramMessage(message) {
  if (env.telegramBotToken.startsWith('CHANGE_THIS') || env.telegramChatId.startsWith('CHANGE_THIS')) { console.log('ℹ️ Telegram bildirimleri yapılandırılmadığı için atlandı.'); return; }
  try { await axios.post(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, { chat_id: env.telegramChatId, text: message }, { timeout: 5000 }); }
  catch (err) { console.error('❌ Telegram mesaj hatası:', err.message); }
}
