const express = require('express');
const router = express.Router();
const hodController = require('../controllers/hodController');

router.post('/', hodController.createHod);
router.get('/', hodController.getHod);
router.put('/:id', hodController.updateHod);
router.get('/:storeId', hodController.storeHods);
router.post('/multistore', hodController.multistoreHods);
router.get('/gethods/:departmentId/:storeId', hodController.getHodsbasedonDepartment);
router.post('/getemployeenameandid', hodController.getemployeenameandid);
router.get('/getcompanyhods/:companyId', hodController.getcompanyHods);
router.get('/store/:storeId', hodController.getStoreById);
router.post('/stores/multistore', hodController.getStoresByIds);

module.exports = router;