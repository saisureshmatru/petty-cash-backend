const express = require('express');
const router = express.Router();
const vendorsController = require('../controllers/vendorsController');

// Existing routes
router.post('/create', vendorsController.createVendor);
router.get('/', vendorsController.getAllVendors);



// Bulk upload and search routes
router.post('/bulk-upload', vendorsController.upload.single('file'), vendorsController.bulkUploadVendors);
router.get('/search', vendorsController.searchVendors);
router.get('/all-with-search', vendorsController.getAllVendorsWithSearch);

// New routes for CRUD operations
router.get('/:id', vendorsController.getVendorById);
router.put('/:id', vendorsController.updateVendor);
router.delete('/:id', vendorsController.deleteVendor);

module.exports = router;