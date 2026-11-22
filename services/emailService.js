import { mailTransport } from '../config/mail.js';
import { env } from '../config/env.js';
export async function sendArchiveEmail(weekRange) {
  if (env.emailPass.startsWith('CHANGE_THIS')) { console.log('ℹ️ E-posta bildirimi yapılandırılmadığı için atlandı.'); return; }
  try { await mailTransport.sendMail({
    from: `"Arşiv" <${env.emailUser}>`, to: env.emailTo,
    subject: `🛡️ Hafta Mühürlendi: ${weekRange.start}`,
    text: `${weekRange.start} - ${weekRange.end} başarıyla arşivlendi.`
  }); } catch (err) { console.error('❌ E-posta gönderilemedi:', err.message); }
}
