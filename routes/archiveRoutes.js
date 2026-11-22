import { Router } from 'express';
import {
  getArchiveWeeks,
  getArchiveWeek,
  getChampions
} from '../controllers/archiveController.js';

const router = Router();

router.get('/weeks', getArchiveWeeks);
router.get('/week/:weekStart', getArchiveWeek);
router.get('/champions', getChampions);

export default router;