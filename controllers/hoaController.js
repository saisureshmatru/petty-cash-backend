const db = require('../connections/connections');

// Create
const createHeadOfAccount = async (req, res) => {
  const { name, description } = req.body;

  try {
    const [existing] = await db.query('SELECT * FROM head_of_accounts WHERE name = ?', [name]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Head of Account name already exists.' });
    }

    const [result] = await db.query(
      'INSERT INTO head_of_accounts (name, description) VALUES (?, ?)',
      [name, description]
    );
    res.status(200).json({ message: 'Head of Account created.', id: result.insertId });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};


// Read
const getAllHeadOfAccounts = async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM head_of_accounts');
    res.status(200).send(results);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

// Update
const updateHeadOfAccount = async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    // Check if another record with the same name exists
    const [existing] = await db.query(
      'SELECT * FROM head_of_accounts WHERE name = ? AND id != ?',
      [name, id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Head of Account name already exists.' });
    }

    const sql = 'UPDATE head_of_accounts SET name = ?, description = ? WHERE id = ?';
    const [result] = await db.query(sql, [name, description, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Head of Account not found.' });
    }

    res.status(200).json({ message: 'Head of Account updated successfully.' });
  } catch (err) {
    console.log(err);
    // In case of duplicate entry from database constraint
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Head of Account name already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
};


// Delete
const deleteHeadOfAccount = async (req, res) => {
  const { id } = req.params;
  const sql = 'DELETE FROM head_of_accounts WHERE id = ?';

  try {
    const [result] = await db.query(sql, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Head of Account not found.' });
    }
    res.status(200).json({ message: 'Head of Account deleted successfully.' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

const getHeadOfAccountByNature = async (req, res) => {
  const { nature } = req.params;

  try {
    const words = nature.split(' ').map(w => w.trim()).filter(Boolean);

    if (words.length === 0) {
      return res.status(400).json({ message: 'Invalid input' });
    }

    const likeConditions = words.map(() => 'ne.name LIKE ?').join(' OR ');
    const likeValues = words.map(word => `%${word}%`);

    const sql = `
      SELECT 
        ne.id AS nature_id,
        ne.name AS nature_name,
        ne.hoa_id,
        ha.id AS head_id,
        ha.name AS head_name,
        ha.description
      FROM nature_of_expense ne
      JOIN head_of_accounts ha ON ne.hoa_id = ha.id
      WHERE ${likeConditions}
      LIMIT 1
    `;

    const [results] = await db.query(sql, likeValues);

    if (results.length === 0) {
      return res.status(404).json({ message: 'No matching Head of Account found.' });
    }

    // Structure response as single object with embedded head_of_account
    const result = results[0];

    res.status(200).json({
      nature_of_expense: {
        id: result.nature_id,
        name: result.nature_name,
        hoa_id: result.hoa_id
      },
      head_of_account: {
        id: result.head_id,
        name: result.head_name,
        description: result.description
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


module.exports = {
  createHeadOfAccount,
  getAllHeadOfAccounts,
  updateHeadOfAccount,
  deleteHeadOfAccount,
  getHeadOfAccountByNature
};
