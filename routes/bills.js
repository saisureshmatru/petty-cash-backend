const express = require('express');
const router = express.Router();
const billsController = require('../controllers/billsController');

router.post('/', billsController.createBillBatch);
router.get('/', billsController.getAllBills);
router.get('/user/:id', billsController.getUserbills);
router.get('/store/:id', billsController.getStorebills);
router.put('/approve/:id', billsController.ApproveBill);
router.post('/send-to-admin', billsController.sendBillsToAdmin);
router.get('/tallybills', billsController.getAdminBills);
router.post('/send-to-tally', billsController.sendBillsToTally);
router.get('/company/:id', billsController.getCompanyBills);
router.get('/superadminallbills', billsController.getSuperadminBills); // Moved before /:id
router.get('/:id', billsController.getSinglebill); // Dynamic route last
router.put('/:id', billsController.updateBill);
router.put('/update-batch/:voucherRef', billsController.updateBatchForCancelledBills);
router.get('/voucher/:voucherRef', billsController.getBillsByVoucher);
router.post('/generateCancelOtp/:id', billsController.generateCancelOtp);
router.put('/cancel/:id', billsController.cancelBill);
router.get('/pdf/:id', billsController.getPdfbills);
router.get('/openandcloseingbalance/:pdfId', billsController.getOpenandClosingBalance);
router.put('/cancel-by-user/:id', billsController.CancelBillByUser);
router.get('/general-reports/store/:storeId', billsController.getStoresGeneralreports);
router.get('/general-reports/user/:userId', billsController.getUsersGeneralreports);
router.get('/general-reports/company/:cid', billsController.getCompanyGeneralreports);
router.get('/general-reports/superadmin', billsController.getSuperAdminGeneralreports);
router.post('/addbill', billsController.createNewBill);

module.exports = router;