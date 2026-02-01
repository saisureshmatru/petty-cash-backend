const express = require('express');
const router = express.Router();
const rolesController = require('../controllers/rolesController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.route('/')
  .post(rolesController.createRole)
  .get(authenticateToken,rolesController.getRoles);

router.route('/:id')
   .put(rolesController.updateRole)
   .delete(rolesController.deleteRole)



module.exports = router;
