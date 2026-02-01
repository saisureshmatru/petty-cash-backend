const express = require('express');
const router = express.Router();
const cashierController = require('../controllers/cashierController');


router.post('/', cashierController.createCashier);
router.get('/', cashierController.getAllCashiers);
router.put('/:id', cashierController.UpdateCashier);
router.delete('/:id', cashierController.deleteCashier);
router.get('/store/:id', cashierController.getstorebasedcashiers)
router.get('/store_allstatus/:id', cashierController.getstoreAllCashiers)

module.exports = router;