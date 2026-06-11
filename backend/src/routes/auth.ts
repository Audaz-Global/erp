import { Router } from 'express';
import { login, register, me } from '../controllers/authController';
import { authenticate, authorizeAdmin } from '../middlewares/auth';

const router = Router();

// Public routes
router.post('/login', login);
// In a real scenario, register might be admin-only, but keeping it public for setup
router.post('/register', register); 

// Protected routes
router.get('/me', authenticate, me);

export default router;
