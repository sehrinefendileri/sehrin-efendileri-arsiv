import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
router.get('/', (req,res) => res.sendFile(path.resolve(here,'../public/index.html')));
export default router;
