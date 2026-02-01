const db = require('../connections/connections');

// Get All Companies
exports.getAllCompanies = async (req, res) => {
  try {
    const sql = `
      SELECT 
        companies.id, 
        companies.company_name, 
        companies.description,
        companies.state,
        companies.city,
        companies.contact_number,
        companies.created_at, 
        companies.updated_at, 
        COUNT(stores.id) AS store_count
      FROM companies
      LEFT JOIN stores ON companies.id = stores.company_id
      GROUP BY companies.id, companies.company_name, companies.created_at, companies.updated_at
      ORDER BY companies.id
    `;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred while fetching companies.', error: err.message });
  }
};


// Get Company by ID
exports.getCompanyById = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('SELECT * FROM companies WHERE id = ?', [id]);

    if (result.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred while fetching the company.', error: err.message });
  }
};

// Create Company
exports.createCompany = async (req, res) => {
  const { company_name, description, state, city, contact_number } = req.body;

  const sql = 'INSERT INTO companies (company_name, description, state, city, contact_number) VALUES (?, ?, ?, ?, ?)';

  try {
    const [result] = await db.query(sql, [company_name, description, state, city, contact_number]);

    res.status(200).json({
      message: 'Company created successfully!',
      companyId: result.insertId
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        message: `Company with name '${company_name}' already exists.`,
        errorCode: err.code
      });
    }
    console.error(err);
    res.status(500).json({ message: 'An error occurred while creating the company.', error: err.message });
  }
};

// Update Company
exports.updateCompany = async (req, res) => {
  const { id } = req.params;
  const { company_name, description, state, city, contact_number } = req.body;

  const sql = 'UPDATE companies SET company_name = ?, description = ?, state = ?, city = ?, contact_number = ? WHERE id = ?';

  try {
    const [result] = await db.query(sql, [company_name, description, state, city, contact_number, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({ message: 'Company updated successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: `Company name '${company_name}' already exists.` });
    }
    console.error(err);
    res.status(500).json({ message: 'An error occurred while updating the company.', error: err.message });
  }
};

// Delete Company
exports.deleteCompany = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query('DELETE FROM companies WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred while deleting the company.', error: err.message });
  }
};
