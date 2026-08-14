import { Router } from 'express';
import { getTree, updateTree } from '../controllers/incotermTreeController';

const router = Router();

router.get('/:incoterm/:direction/:modal', getTree);
router.put('/:incoterm/:direction/:modal', updateTree);

export default router;
