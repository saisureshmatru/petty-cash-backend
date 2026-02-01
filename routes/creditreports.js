const express = require('express');
const router = express.Router();
const CreditReportsController = require('../controllers/creditreportsController');

router.get('/stores', CreditReportsController.getStores);
router.get('/companies', CreditReportsController.getCompanies);
router.get('/companies/:companyId/stores', CreditReportsController.getCompanyStores);
router.get('/all', CreditReportsController.getAllCreditReports);
router.get('/stores/:storeId', CreditReportsController.getStoresCreditReports);
router.get('/companies/:companyId', CreditReportsController.getCompanyCreditReports);

module.exports = router; 