// routes/cashierdashboard.js
const express = require('express');
const router = express.Router();
const CashierDashboardController = require('../controllers/cashierdashboardController');

router.get('/stats/:storeId',            CashierDashboardController.getbillstats);
router.get('/montlyspend/:storeId',      CashierDashboardController.getStoreMonthlyExpenseChart);
router.get('/monthlycredits/:storeId',   CashierDashboardController.getStoreMonthlyCreditChart);
router.get('/approvalstatus/:storeId',   CashierDashboardController.getApprovalStatusByMonth);
router.get('/recentbills/:storeId',      CashierDashboardController.getRecentBills);
router.get('/natureexpenses/:storeId',   CashierDashboardController.getNatureExpensesByStore);

module.exports = router;