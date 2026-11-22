import rateLimit from 'express-rate-limit';
export const statusRateLimit = rateLimit({ windowMs: 60*1000, max:30, message:{ error:'Çok fazla istek gönderildi!' } });
