const express = require('express');
const router = express.Router();
const storesController = require('../controllers/storesController');

router.get('/', storesController.getAllStores);
router.get('/:id', storesController.getStoreById);
router.get('/company/:company_id', storesController.getStoresByCompanyId);
router.post('/', storesController.createStore);
router.put('/:id', storesController.updateStore);
router.delete('/:id', storesController.deleteStore);
router.get('/getcompanymatchedstores/:company_id', storesController.getStoresByCompanyId);
router.get('/userId/:id', storesController.getStoreIdbyUserId)
router.get('/getInstructors/:id', storesController.getInstructorsByStoreId);
router.get('/getAdminStores/:companyId', storesController.getAdminStores);
router.post('/multistore', storesController.multiStore);
router.get('/contactNumber/:storeId', storesController.getContactNumberByStoreId);

module.exports = router;
