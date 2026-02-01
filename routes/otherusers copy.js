const express = require('express');
const route = express.Router();
const OtherUserController = require('../controllers/otherusersController');

route.post('/', OtherUserController.createUser);
route.get('/', OtherUserController.getAll);
route.put('/:id', OtherUserController.updateUser);
route.delete('/:id', OtherUserController.deleteUser);

module.exports = route;