const express = require('express');
const router = express.Router();
const noeController = require('../controllers/noeController');


router.post('/', noeController.createNatureOfExpensive);
router.get('/',noeController.getAllNatureOfExpensives);
router.put('/:id', noeController.updateNatureOfExpense);
router.delete('/:id', noeController.deleteNatureOfExpense);
router.get('/search', noeController.searchNatureOfExpense);
module.exports = router;