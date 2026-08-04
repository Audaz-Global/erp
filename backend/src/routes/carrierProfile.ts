import {Router} from 'express';
import {createCarrierProfile,deleteCarrierFieldRule,deleteCarrierProfile,listCarrierProfiles,resolveCarrierProfile,saveCarrierFieldRule,seedMaersk,updateCarrierProfile} from '../controllers/carrierProfileController';
const router=Router();
router.get('/',listCarrierProfiles);router.get('/resolve',resolveCarrierProfile);router.post('/',createCarrierProfile);router.post('/seed-maersk',seedMaersk);router.put('/:id',updateCarrierProfile);router.delete('/:id',deleteCarrierProfile);router.post('/:id/rules',saveCarrierFieldRule);router.delete('/:id/rules/:ruleId',deleteCarrierFieldRule);
export default router;
