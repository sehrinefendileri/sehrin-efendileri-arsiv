import { env } from '../config/env.js';
export function authMiddleware(req,res,next) {
  if (req.path === '/status' || req.method === 'GET') return next();
  if (req.headers['x-api-key'] === env.apiKey) return next();
  return res.status(403).json({ error: 'Erişim Reddedildi.' });
}
