const express = require('express');
const router = express.Router();
const ReportsController = require('../controllers/reportsController');

router.post('/createreport', ReportsController.createReport);
router.get('/myreports/:userId', ReportsController.getMyreports);
router.delete('/deletereport/:reportId', ReportsController.deleteReport);
router.put('/updatereport/:reportId', ReportsController.updateReport);
router.put('/updatereportfilters/:reportId', ReportsController.updateReportFilters);
router.get('/reportfilters/:reportId', ReportsController.getReportFilters);
router.get('/transitions/all', ReportsController.getAllTransitions);
router.get('/transitions/companies/:companyId', ReportsController.getCompanyTransitions);
router.get('/transitions/:storeId', ReportsController.getStoreTransitions);

module.exports = router;