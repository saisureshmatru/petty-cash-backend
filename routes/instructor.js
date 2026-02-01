const express = require('express');
const router = express.Router();
const instructorsController = require('../controllers/instructorsController');

router.post('/', instructorsController.createInstructor);
router.get('/', instructorsController.getInstructors);
router.put('/:id', instructorsController.updateInstructor);
router.get('/getCompanyInstructors/:companyId', instructorsController.CompanyInstructors);
router.post('/multistore', instructorsController.multiStoreInstructors);
router.post('/getemployeenameandid', instructorsController.getEmployeeNameAndId);
router.get('/getinstructors/:departmentIds/:storeIds', instructorsController.getInstructorebysidanddid)

module.exports = router;