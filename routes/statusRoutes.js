import { Router } from 'express';
import { getStatus } from '../controllers/statusController.js';
import { statusRateLimit } from '../middleware/rateLimitMiddleware.js';
const router = Router();
router.get('/', statusRateLimit, getStatus);
export default router;
