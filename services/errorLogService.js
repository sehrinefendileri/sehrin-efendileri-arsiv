import { supabase } from '../config/database.js';
import { sendTelegramMessage } from './telegramService.js';
export async function logErrorToDb(module, err) {
  console.error(`❌ [${module}]:`, err?.message || err);
  try { await supabase.from('error_logs').insert({ module, message: err?.message || String(err), stack: err?.stack || null }); }
  catch (dbErr) { console.error('Hata loglanırken DB hatası oluştu:', dbErr.message); }
  await sendTelegramMessage(`🚨 ŞEHRİN EFENDİLERİ ARŞİV HATASI\n\nMODÜL:\n${module}\n\nHATA:\n${err?.message || err}\n\nSAAT:\n${new Date().toLocaleString('tr-TR')}`);
}
