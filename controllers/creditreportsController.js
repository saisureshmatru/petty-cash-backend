const pool = require('../connections/connections');

const getStores = async (req, res) => {
  try {
    const sql = 'SELECT * FROM stores';
    const [stores] = await pool.query(sql);
    res.status(200).send(stores);
  } catch (err) {
    console.log('Error at getStores in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const getCompanies = async (req, res) => {
  try {
    const sql = 'SELECT * FROM companies';
    const [companies] = await pool.query(sql);
    res.status(200).send(companies);
  } catch (err) {
    console.log('Error at getCompanies in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const getCompanyStores = async (req, res) => {
  const { companyId } = req.params;
  try {
    const sql = 'SELECT * FROM stores WHERE company_id = ?';
    const [stores] = await pool.query(sql, [companyId]);
    res.status(200).send(stores);
  } catch (err) {
    console.log('Error at getCompanyStores in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const getAllCreditReports = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search,
      transition_id,
      company_id,
      store_id,
      department,
      username,
      transition_type,
      cheque_date_from,
      cheque_date_to,
      cheque_number,
      bank_name,
      phonepe_id,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
    } = req.query;

    const sortableColumns = {
      transition_id: 'deposites.transition_id',
      companyName: 'companies.company_name',
      storeName: 'stores.store_name',
      department: 'departments.department',
      username: 'users.username',
      transition_type: 'deposites.transition_type',
      cheque_date: 'deposites.cheque_date',
      cheque_number: 'deposites.cheque_number',
      bank_name: 'deposites.bank_name',
      phonepe_id: 'deposites.phonepe_id',
      amount: 'deposites.amount',
      balance_amount: 'deposites.balance_amount',
      created_at: 'deposites.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    let sql = `
      SELECT deposites.*, users.username, stores.store_name AS storeName, companies.company_name AS companyName, departments.department AS department,
             COUNT(*) OVER () AS total_count
      FROM deposites 
      JOIN users ON users.id = deposites.depositor_id
      JOIN stores ON stores.id = deposites.store_id
      JOIN companies ON companies.id = users.cid
      LEFT JOIN departments ON departments.id = users.did
      WHERE 1=1
    `;
    const values = [];

    // Apply filters
    if (transition_id) {
      sql += ` AND deposites.transition_id LIKE ?`;
      values.push(`%${transition_id}%`);
    }
    if (company_id) {
      sql += ` AND companies.id = ?`;
      values.push(company_id);
    }
    if (store_id) {
      sql += ` AND stores.id = ?`;
      values.push(store_id);
    }
    if (department) {
      sql += ` AND departments.department LIKE ?`;
      values.push(`%${department}%`);
    }
    if (username) {
      sql += ` AND users.username = ?`;
      values.push(username);
    }
    if (transition_type) {
      sql += ` AND deposites.transition_type = ?`;
      values.push(transition_type);
    }
    if (cheque_date_from) {
      sql += ` AND deposites.cheque_date >= ?`;
      values.push(cheque_date_from);
    }
    if (cheque_date_to) {
      sql += ` AND deposites.cheque_date <= ?`;
      values.push(cheque_date_to);
    }
    if (cheque_number) {
      sql += ` AND deposites.cheque_number LIKE ?`;
      values.push(`%${cheque_number}%`);
    }
    if (bank_name) {
      sql += ` AND deposites.bank_name LIKE ?`;
      values.push(`%${bank_name}%`);
    }
    if (phonepe_id) {
      sql += ` AND deposites.phonepe_id LIKE ?`;
      values.push(`%${phonepe_id}%`);
    }
    if (amount_min) {
      sql += ` AND deposites.amount >= ?`;
      values.push(amount_min);
    }
    if (amount_max) {
      sql += ` AND deposites.amount <= ?`;
      values.push(amount_max);
    }
    if (balance_amount_min) {
      sql += ` AND deposites.balance_amount >= ?`;
      values.push(balance_amount_min);
    }
    if (balance_amount_max) {
      sql += ` AND deposites.balance_amount <= ?`;
      values.push(balance_amount_max);
    }
    if (created_at_from) {
      sql += ` AND deposites.created_at >= ?`;
      values.push(created_at_from);
    }
    if (created_at_to) {
      sql += ` AND deposites.created_at <= ?`;
      values.push(created_at_to);
    }
    if (search) {
      sql += `
        AND (
          deposites.transition_id LIKE ?
          OR companies.company_name LIKE ?
          OR stores.store_name LIKE ?
          OR departments.department LIKE ?
          OR users.username LIKE ?
          OR deposites.cheque_number LIKE ?
          OR deposites.bank_name LIKE ?
          OR deposites.phonepe_id LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      values.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Apply sorting
    sql += ` ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}`;

    // Apply pagination
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    values.push(parseInt(limit), offset);

    const [creditReports] = await pool.query(sql, values);
    const totalCount = creditReports.length > 0 ? creditReports[0].total_count : 0;


    // Expose the custom header for CORS
    res.set('Access-Control-Expose-Headers', 'x-total-count');
    res.set('x-total-count', totalCount);
    res.status(200).send(creditReports);
  } catch (err) {
    console.log('Error at getAllCreditReports in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};


const getStoresCreditReports = async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    const {
      page = 1,
      limit = 25,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search,
      transition_id,
      company_id,
      department,
      username,
      transition_type,
      cheque_date_from,
      cheque_date_to,
      cheque_number,
      bank_name,
      phonepe_id,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
      store_id,
    } = req.query;

    const sortableColumns = {
      transition_id: 'deposites.transition_id',
      companyName: 'companies.company_name',
      storeName: 'stores.store_name',
      department: 'departments.department',
      username: 'users.username',
      transition_type: 'deposites.transition_type',
      cheque_date: 'deposites.cheque_date',
      cheque_number: 'deposites.cheque_number',
      bank_name: 'deposites.bank_name',
      phonepe_id: 'deposites.phonepe_id',
      amount: 'deposites.amount',
      balance_amount: 'deposites.balance_amount',
      created_at: 'deposites.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    let sql = `
      SELECT deposites.*, 
             users.username, 
             stores.store_name AS storeName, 
             companies.company_name AS companyName, 
             departments.department AS department,
             COUNT(*) OVER() AS total_count
      FROM deposites 
      JOIN users ON users.id = deposites.depositor_id
      JOIN stores ON stores.id = deposites.store_id
      JOIN companies ON companies.id = users.cid
      LEFT JOIN departments ON departments.id = users.did
      WHERE stores.id IN (${placeholders})
    `;

    // ✅ Fix: values must match placeholders
    const values = [...storeIds];

    // Apply filters
    if (transition_id) {
      sql += ` AND deposites.transition_id LIKE ?`;
      values.push(`%${transition_id}%`);
    }
    if (company_id) {
      sql += ` AND companies.id = ?`;
      values.push(company_id);
    }
    if (department) {
      sql += ` AND departments.department LIKE ?`;
      values.push(`%${department}%`);
    }
    if (username) {
      sql += ` AND users.username = ?`;
      values.push(username);
    }
    if (transition_type) {
      sql += ` AND deposites.transition_type = ?`;
      values.push(transition_type);
    }
    if (cheque_date_from) {
      sql += ` AND deposites.cheque_date >= ?`;
      values.push(cheque_date_from);
    }
    if (cheque_date_to) {
      sql += ` AND deposites.cheque_date <= ?`;
      values.push(cheque_date_to);
    }
    if (cheque_number) {
      sql += ` AND deposites.cheque_number LIKE ?`;
      values.push(`%${cheque_number}%`);
    }
    if (bank_name) {
      sql += ` AND deposites.bank_name LIKE ?`;
      values.push(`%${bank_name}%`);
    }
    if (phonepe_id) {
      sql += ` AND deposites.phonepe_id LIKE ?`;
      values.push(`%${phonepe_id}%`);
    }
    if (amount_min) {
      sql += ` AND deposites.amount >= ?`;
      values.push(amount_min);
    }
    if (amount_max) {
      sql += ` AND deposites.amount <= ?`;
      values.push(amount_max);
    }
    if (balance_amount_min) {
      sql += ` AND deposites.balance_amount >= ?`;
      values.push(balance_amount_min);
    }
    if (balance_amount_max) {
      sql += ` AND deposites.balance_amount <= ?`;
      values.push(balance_amount_max);
    }
    if (created_at_from) {
      sql += ` AND deposites.created_at >= ?`;
      values.push(created_at_from);
    }
    if (created_at_to) {
      sql += ` AND deposites.created_at <= ?`;
      values.push(created_at_to);
    }
    if (store_id) {
      sql += ` AND stores.id = ?`;
      values.push(parseInt(store_id));
    }
    if (search) {
      sql += `
        AND (
          deposites.transition_id LIKE ?
          OR companies.company_name LIKE ?
          OR departments.department LIKE ?
          OR users.username LIKE ?
          OR deposites.cheque_number LIKE ?
          OR deposites.bank_name LIKE ?
          OR deposites.phonepe_id LIKE ?
          OR stores.store_name LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      values.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Sorting
    sql += ` ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}`;

    // Pagination
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    values.push(parseInt(limit), parseInt(offset));

    const [creditReports] = await pool.query(sql, values);
    const totalCount = creditReports.length > 0 ? creditReports[0].total_count : 0;

    res.set('x-total-count', totalCount);
    res.status(200).send(creditReports);
  } catch (err) {
    console.log('Error at getStoresCreditReports in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};


const getCompanyCreditReports = async (req, res) => {
  try {
    const companyId = req.params.companyId;
    const {
      page = 1,
      limit = 25,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search,
      transition_id,
      store_id,
      department,
      username,
      transition_type,
      cheque_date_from,
      cheque_date_to,
      cheque_number,
      bank_name,
      phonepe_id,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
    } = req.query;

    const sortableColumns = {
      transition_id: 'deposites.transition_id',
      companyName: 'companies.company_name',
      storeName: 'stores.store_name',
      department: 'departments.department',
      username: 'users.username',
      transition_type: 'deposites.transition_type',
      cheque_date: 'deposites.cheque_date',
      cheque_number: 'deposites.cheque_number',
      bank_name: 'deposites.bank_name',
      phonepe_id: 'deposites.phonepe_id',
      amount: 'deposites.amount',
      balance_amount: 'deposites.balance_amount',
      created_at: 'deposites.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    let sql = `
      SELECT deposites.*, users.username, stores.store_name AS storeName, companies.company_name AS companyName, departments.department AS department,
             COUNT(*) OVER () AS total_count
      FROM deposites 
      JOIN users ON users.id = deposites.depositor_id
      JOIN stores ON stores.id = deposites.store_id
      JOIN companies ON companies.id = users.cid
      LEFT JOIN departments ON departments.id = users.did
      WHERE companies.id = ?
    `;
    const values = [companyId];

    // Apply filters
    if (transition_id) {
      sql += ` AND deposites.transition_id LIKE ?`;
      values.push(`%${transition_id}%`);
    }
    if (store_id) {
      sql += ` AND stores.id = ?`;
      values.push(store_id);
    }
    if (department) {
      sql += ` AND departments.department LIKE ?`;
      values.push(`%${department}%`);
    }
    if (username) {
      sql += ` AND users.username = ?`;
      values.push(username);
    }
    if (transition_type) {
      sql += ` AND deposites.transition_type = ?`;
      values.push(transition_type);
    }
    if (cheque_date_from) {
      sql += ` AND deposites.cheque_date >= ?`;
      values.push(cheque_date_from);
    }
    if (cheque_date_to) {
      sql += ` AND deposites.cheque_date <= ?`;
      values.push(cheque_date_to);
    }
    if (cheque_number) {
      sql += ` AND deposites.cheque_number LIKE ?`;
      values.push(`%${cheque_number}%`);
    }
    if (bank_name) {
      sql += ` AND deposites.bank_name LIKE ?`;
      values.push(`%${bank_name}%`);
    }
    if (phonepe_id) {
      sql += ` AND deposites.phonepe_id LIKE ?`;
      values.push(`%${phonepe_id}%`);
    }
    if (amount_min) {
      sql += ` AND deposites.amount >= ?`;
      values.push(amount_min);
    }
    if (amount_max) {
      sql += ` AND deposites.amount <= ?`;
      values.push(amount_max);
    }
    if (balance_amount_min) {
      sql += ` AND deposites.balance_amount >= ?`;
      values.push(balance_amount_min);
    }
    if (balance_amount_max) {
      sql += ` AND deposites.balance_amount <= ?`;
      values.push(balance_amount_max);
    }
    if (created_at_from) {
      sql += ` AND deposites.created_at >= ?`;
      values.push(created_at_from);
    }
    if (created_at_to) {
      sql += ` AND deposites.created_at <= ?`;
      values.push(created_at_to);
    }
    if (search) {
      sql += `
        AND (
          deposites.transition_id LIKE ?
          OR stores.store_name LIKE ?
          OR departments.department LIKE ?
          OR users.username LIKE ?
          OR deposites.cheque_number LIKE ?
          OR deposites.bank_name LIKE ?
          OR deposites.phonepe_id LIKE ?
        )
      `;
      const searchTerm = `%${search}%`;
      values.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Apply sorting
    sql += ` ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}`;

    // Apply pagination
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    values.push(parseInt(limit), offset);

    const [creditReports] = await pool.query(sql, values);
    const totalCount = creditReports.length > 0 ? creditReports[0].total_count : 0;

    res.set('x-total-count', totalCount);
    res.status(200).send(creditReports);
  } catch (err) {
    console.log('Error at getCompanyCreditReports in creditReports: ' + err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

module.exports = { getStores, getCompanies, getCompanyStores, getAllCreditReports, getStoresCreditReports, getCompanyCreditReports }; 