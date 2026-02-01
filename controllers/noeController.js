const db = require('../connections/connections');

// Create
const createNatureOfExpensive = async (req, res) => {
  const { nature, headAccount } = req.body;
  const sql = 'INSERT INTO nature_of_expense (name, hoa_id) VALUES (?, ?)';

  try {
    const [result] = await db.query(sql, [nature, headAccount]);
    res.status(200).json({
      message: 'Nature of Expense added successfully.',
      id: result.insertId
    });
  } catch (err) {
    console.log(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Nature of Expense name already exists.' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Read All
const getAllNatureOfExpensives = async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT 
        noe.id,
        noe.name AS expense_name,
        noe.hoa_id,
        hoa.name AS hoa_name,
        noe.created_at,
        noe.updated_at
      FROM nature_of_expense AS noe
      JOIN head_of_accounts AS hoa ON noe.hoa_id = hoa.id
    `);

    res.status(200).send(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
};

// Update
const updateNatureOfExpense = async (req, res) => {
  const { id } = req.params;
  const { nature, headAccount } = req.body;

  const sql = 'UPDATE nature_of_expense SET name = ?, hoa_id = ?, updated_at = NOW() WHERE id = ?';

  try {
    const [result] = await db.query(sql, [nature, headAccount, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Nature of Expense not found.' });
    }

    res.status(200).json({ message: 'Nature of Expense updated successfully.' });
  } catch (err) {
    console.log(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Nature of Expense name already exists.' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Delete
const deleteNatureOfExpense = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM nature_of_expense WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Nature of Expense not found.' });
    }

    res.status(200).json({ message: 'Nature of Expense deleted successfully.' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: err.message });
  }
};

const searchNatureOfExpense = async (req, res) => {
  try {
    const { expense_name } = req.query;
    if (!expense_name?.trim()) return res.json({ data: [] });

    const like = `%${expense_name.trim()}%`;

    const [rows] = await db.query(
      `SELECT 
         noe.id,
         noe.name      AS expense_name,
         hoa.name      AS hoa_name,
         noe.hoa_id
       FROM nature_of_expense AS noe
       JOIN head_of_accounts AS hoa ON noe.hoa_id = hoa.id
       WHERE noe.name LIKE ?
       ORDER BY noe.name
       LIMIT 30`,
      [like]
    );

    res.json({ data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Search failed' });
  }
};

module.exports = {
  createNatureOfExpensive,
  getAllNatureOfExpensives,
  updateNatureOfExpense,
  deleteNatureOfExpense,
  searchNatureOfExpense
};
