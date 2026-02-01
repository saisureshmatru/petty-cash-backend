const express = require('express');
const router = express.Router();
const transitionsController = require('../controllers/transitionsController');

router.get('/', transitionsController.getAlltransitions);
router.get('/company/:cid', transitionsController.getCompanytransitions);
router.get('/store/:sid', transitionsController.getStoretransitions);

module.exports = router;
