const express = require('express');
const router = express.Router();
const AdminDashBoardController = require('../controllers/admindashboardController');

router.get('/stats', AdminDashBoardController.getsuperAdminstatCounts);
router.get('/stats/:cid', AdminDashBoardController.getAdminstatCounts);
router.get('/getdepositesandcredits', AdminDashBoardController.getspendsandcredits);
router.get('/getstorenames', AdminDashBoardController.getStorenames);
router.get('/getstoredetails/:storeId', AdminDashBoardController.getStoreDetails);
router.get('/getrecentbills', AdminDashBoardController.getRecentBills);
router.get('/getrecentbills/:cid', AdminDashBoardController.getAdminRecentBills);
router.get('/getstoresoverview', AdminDashBoardController.getStoresOverview);
router.get('/getstoresoverview/:cid', AdminDashBoardController.getAdminStoresOverview);

// NEW ROUTE
router.get('/natureexpenses/:storeId', AdminDashBoardController.getNatureExpensesByStore);

module.exports = router;