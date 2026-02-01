const express = require('express');
const router = express.Router();
const EmployeeDashboardController = require('../controllers/employeedashboardController');

router.get('/stats/:userId', EmployeeDashboardController.getBillStats);
router.get('/montlyspend/:userId', EmployeeDashboardController.getUserMonthlyExpenseChart);
router.get('/approvalstatus/:userId', EmployeeDashboardController.getApprovalStatusByMonth);
router.get('/recentbills/:userId', EmployeeDashboardController.getRecentBills)

module.exports = router;