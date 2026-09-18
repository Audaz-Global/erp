import { Router } from 'express';
import {
  createAirlineProfile,
  deleteAirlineProfile,
  importAtlantisAirlines,
  linkAirlineFee,
  listAirlineProfiles,
  resolveAirlineProfile,
  updateAirlineProfile
} from '../controllers/airlineProfileController';

const router = Router();
router.get('/', listAirlineProfiles);
router.get('/resolve', resolveAirlineProfile);
router.post('/', createAirlineProfile);
router.post('/import-atlantis', importAtlantisAirlines);
router.put('/:id', updateAirlineProfile);
router.delete('/:id', deleteAirlineProfile);
router.post('/:id/fees/:feeId', linkAirlineFee);

export default router;
