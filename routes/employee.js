const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const EmployeeController = require('../controllers/employeeController');

router.post('/', EmployeeController.AddEmployee);
router.get('/', EmployeeController.getAllEmployees);
router.get('/store/:id', EmployeeController.getStorebasedEmployees);
router.put('/:id', EmployeeController.UpdateEmployee);
router.delete('/:id', EmployeeController.deleteEmployee);
router.get('/:eid', EmployeeController.getemployeeById);
router.get('/company/:companyId', EmployeeController.getCompanyEmployees);

// New route for bulk import
router.post('/import', upload.single('file'), EmployeeController.importEmployees);

module.exports = router;