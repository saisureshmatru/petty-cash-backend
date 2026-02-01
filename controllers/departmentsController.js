const db = require('../connections/connections');

// Get all departments
exports.getAllDepartments = async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM departments');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get a department by ID
exports.getDepartmentById = async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM departments WHERE id = ?', [req.params.id]);
    if (results.length === 0) return res.status(404).json({ message: 'Department not found' });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Create a department
exports.createDepartment = async (req, res) => {
  try {
    const { department, description } = req.body;
    if (!department) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    const [result] = await db.query(
      'INSERT INTO departments (department, description) VALUES (?, ?)',
      [department, description || '']
    );
    // Fetch the newly created department to return complete data
    const [newDepartment] = await db.query('SELECT * FROM departments WHERE id = ?', [result.insertId]);
    if (newDepartment.length === 0) {
      return res.status(500).json({ error: 'Failed to retrieve created department' });
    }
    res.status(201).json(newDepartment[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update a department
exports.updateDepartment = async (req, res) => {
  try {
    const { department, description } = req.body;
    if (!department) {
      return res.status(400).json({ error: 'Department name is required' });
    }
    const [result] = await db.query(
      'UPDATE departments SET department = ?, description = ? WHERE id = ?',
      [department, description || '', req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Department not found' });
    }
    // Fetch the updated department to return complete data
    const [updatedDepartment] = await db.query('SELECT * FROM departments WHERE id = ?', [req.params.id]);
    res.json(updatedDepartment[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete a department
exports.deleteDepartment = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Department not found' });
    res.json({ message: 'Department deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};