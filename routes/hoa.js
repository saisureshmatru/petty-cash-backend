const express = require('express');
const router = express.Router();
const hoaController = require('../controllers/hoaController');

router.post('/', hoaController.createHeadOfAccount);
router.get('/', hoaController.getAllHeadOfAccounts);
router.put('/:id', hoaController.updateHeadOfAccount);
router.delete('/:id', hoaController.deleteHeadOfAccount);
router.get('/:nature', hoaController.getHeadOfAccountByNature);

module.exports = router;