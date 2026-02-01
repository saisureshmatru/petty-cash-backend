const express = require('express');
const router = express.Router();
const passbookController = require('../controllers/passbookController');

router.post('/', passbookController.AddCash);
router.get('/:id', passbookController.getStoreTransitions)
router.get('/getavailablecash/:id', passbookController.getStoreamount)
router.get('/recentbills/:storeId', passbookController.getRecentBills);
router.get('/transitions/:storeId', passbookController.getTransitions);

module.exports = router;