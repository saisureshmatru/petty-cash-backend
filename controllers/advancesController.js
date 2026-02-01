const db = require('../connections/connections');  

// GET all advances (optional – for admin)
const getAllAdvances = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM advance ORDER BY id DESC');
    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error in getAllAdvances:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// GET single advance by ID
const getAdvanceById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM advance WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }
    res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error in getAdvanceById:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// GET all advances by cid  ← THIS IS USED BY YOUR FRONTEND
const getAdvancesByCid = async (req, res) => {
  try {
    const cid = parseInt(req.params.cid);
    if (!cid || isNaN(cid)) {
      return res.status(400).json({ success: false, message: 'Valid CID is required' });
    }

    const [rows] = await db.query(
      'SELECT id, cid, reason, description, created_at, updated_at FROM advance WHERE cid = ? ORDER BY created_at DESC',
      [cid]
    );

    res.status(200).json({
      success: true,
      count: rows.length,
      data: rows               // ← Frontend uses reason.data.data
    });
  } catch (error) {
    console.error('Error in getAdvancesByCid:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch advance rules', error: error.message });
  }
};

// CREATE new advance
const createAdvance = async (req, res) => {
  try {
    const { cid, reason, description } = req.body;

    if (!cid || !reason?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'cid and reason are required'
      });
    }

    const [result] = await db.query(
      'INSERT INTO advance (cid, reason, description) VALUES (?, ?, ?)',
      [cid, reason.trim(), description.trim()]
    );

    res.status(201).json({
      success: true,
      message: 'Advance rule created successfully',
      data: { id: result.insertId, cid, reason: reason.trim(), description: description.trim() }
    });
  } catch (error) {
    console.error('Error in createAdvance:', error);
    res.status(500).json({ success: false, message: 'Failed to create advance rule', error: error.message });
  }
};

// UPDATE advance
const updateAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const { cid, reason, description } = req.body;

    // Check if record exists
    const [existing] = await db.query('SELECT * FROM advance WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    if (!reason?.trim() || !description?.trim()) {
      return res.status(400).json({ success: false, message: 'Reason and description are required' });
    }

    await db.query(
      'UPDATE advance SET cid = ?, reason = ?, description = ? WHERE id = ?',
      [cid || existing[0].cid, reason.trim(), description.trim(), id]
    );

    res.status(200).json({
      success: true,
      message: 'Advance rule updated successfully'
    });
  } catch (error) {
    console.error('Error in updateAdvance:', error);
    res.status(500).json({ success: false, message: 'Failed to update advance rule', error: error.message });
  }
};

// DELETE advance
const deleteAdvance = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT * FROM advance WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    await db.query('DELETE FROM advance WHERE id = ?', [id]);

    res.status(200).json({
      success: true,
      message: 'Advance rule deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteAdvance:', error);
    res.status(500).json({ success: false, message: 'Failed to delete advance rule', error: error.message });
  }
};

module.exports = {
  getAllAdvances,
  getAdvanceById,
  getAdvancesByCid,
  createAdvance,
  updateAdvance,
  deleteAdvance
};