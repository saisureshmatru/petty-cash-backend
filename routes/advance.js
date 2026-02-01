
const express = require('express');
const router = express.Router();
const {
    getAllAdvances,
    getAdvanceById,
    getAdvancesByCid,
    createAdvance,
    updateAdvance,
    deleteAdvance
} = require('../controllers/advancesController');

// GET /api/advance                → All advances (admin only if needed)
router.get('/', getAllAdvances);

// GET /api/advance/5              → By ID
router.get('/:id', getAdvanceById);

// GET /api/advance/cid/101        → All advances for cid=101 (USED IN FRONTEND)
router.get('/cid/:cid', getAdvancesByCid);

// POST /api/advance               → Create new
router.post('/', createAdvance);

// PUT /api/advance/5              → Update
router.put('/:id', updateAdvance);

// DELETE /api/advance/5           → Delete
router.delete('/:id', deleteAdvance);

module.exports = router;