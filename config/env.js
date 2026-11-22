import dotenv from 'dotenv';
dotenv.config();

const required = ['SUPABASE_URL','SUPABASE_KEY','X_API_KEY','EMAIL_PASS','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Eksik ortam değişkenleri: ${missing.join(', ')}`);

export const env = {
  port: Number(process.env.PORT || 10000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  apiKey: process.env.X_API_KEY,
  panelUrl: process.env.PANEL_URL || 'https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  emailPass: process.env.EMAIL_PASS,
  emailUser: process.env.EMAIL_USER || 'leventistemi@hotmail.com',
  emailTo: process.env.EMAIL_TO || 'leventistemi@hotmail.com'
};
