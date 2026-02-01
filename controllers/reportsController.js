const pool = require('../connections/connections');

// Create a new report
const createReport = async (req, res) => {
    const { name, description, userId, filters, selected_columns } = req.body;

    try {
        if (!name || !userId) {
            return res.status(400).json({ message: 'Report name and userId are required' });
        }

        const sql = 'INSERT INTO myreports (name, description, userId, filters, selected_columns) VALUES (?, ?, ?, ?, ?)';
        const [result] = await pool.query(sql, [name, description, userId, JSON.stringify(filters || {}), JSON.stringify(selected_columns || [])]);

        res.status(200).json({ message: "Report created successfully", id: result.insertId });
    } catch (err) {
        console.error('Error while creating new report:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

// Get all reports by userId
const getMyreports = async (req, res) => {
    const { userId } = req.params;
    try {
        const sql = 'SELECT * FROM myreports WHERE userId = ?';
        const [rows] = await pool.query(sql, [userId]);
        res.status(200).send(rows);
    } catch (err) {
        console.error('Error while getting reports:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

// Update a report by reportId
const updateReport = async (req, res) => {
    const { reportId } = req.params;
    const { name, description, filters, selected_columns } = req.body;

    try {
        if (!name) {
            return res.status(400).json({ message: 'Name required' });
        }

        const sql = 'UPDATE myreports SET name = ?, description = ?, filters = ?, selected_columns = ? WHERE id = ?';
        const [result] = await pool.query(sql, [name, description, JSON.stringify(filters || {}), JSON.stringify(selected_columns || []), reportId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found' });
        }

        res.status(200).json({ message: 'Report updated successfully' });
    } catch (err) {
        console.error('Error while updating report:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

// Delete a report by reportId
const deleteReport = async (req, res) => {
    const { reportId } = req.params;

    try {
        const sql = 'DELETE FROM myreports WHERE id = ?';
        const [result] = await pool.query(sql, [reportId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found' });
        }

        res.status(200).json({ message: 'Report deleted successfully' });
    } catch (err) {
        console.error('Error while deleting report:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

// Update report filters and selected columns
const updateReportFilters = async (req, res) => {
    const { reportId } = req.params;
    const { filters, selected_columns } = req.body;
    // console.log('Updating report filters:', { reportId, filters, selected_columns });

    try {
        const sql = 'UPDATE myreports SET filters = ?, selected_columns = ? WHERE id = ?';
        const [result] = await pool.query(sql, [JSON.stringify(filters || {}), JSON.stringify(selected_columns || []), reportId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Report not found' });
        }

        res.status(200).json({ message: 'Report filters and columns updated successfully' });
    } catch (err) {
        console.error('Error while updating report filters:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

// Get report filters and selected columns
const getReportFilters = async (req, res) => {
    const { reportId } = req.params;

    try {
        const sql = 'SELECT filters, selected_columns FROM myreports WHERE id = ?';
        const [rows] = await pool.query(sql, [reportId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Report not found' });
        }

        res.status(200).json({
            filters: rows[0].filters ? JSON.parse(rows[0].filters) : {},
            selected_columns: rows[0].selected_columns ? JSON.parse(rows[0].selected_columns) : [],
        });
    } catch (err) {
        console.error('Error while getting report filters:', err);
        res.status(500).json({ message: err.message, error: 'Internal server error' });
    }
};

const getAllTransitions = async (req, res) => {
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
      'user.username': username,
      'debit_details.pay_to': pay_to,
      transition_type,
      type,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
    } = req.query;

    const sortableColumns = {
      transition_id: 'combined.transition_id',
      companyName: 'companies.company_name',
      storeName: 'stores.store_name',
      department: 'departments.department',
      'user.username': 'users.username',
      'debit_details.pay_to': 'combined.pay_to',
      transition_type: 'combined.transition_type',
      type: 'combined.type',
      amount: 'combined.amount',
      balance_amount: 'combined.balance_amount',
      created_at: 'combined.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    // Filters and query parameters
    const creditConditions = [];
    const debitConditions = [];
    const queryParams = [];

    // Apply filters
    if (transition_id) {
      creditConditions.push('d.transition_id LIKE ?');
      debitConditions.push('b.voucher_reference_number LIKE ?');
      queryParams.push(`%${transition_id}%`, `%${transition_id}%`);
    }
    if (company_id) {
      creditConditions.push('companies.id = ?');
      debitConditions.push('companies.id = ?');
      queryParams.push(company_id, company_id);
    }
    if (store_id) {
      creditConditions.push('d.store_id = ?');
      debitConditions.push('b.store_id = ?');
      queryParams.push(store_id, store_id);
    }
    if (department) {
      creditConditions.push('departments.department LIKE ?');
      debitConditions.push('departments.department LIKE ?');
      queryParams.push(`%${department}%`, `%${department}%`);
    }
    if (username) {
      creditConditions.push('users.username LIKE ?');
      debitConditions.push('users.username LIKE ?');
      queryParams.push(`%${username}%`, `%${username}%`);
    }
    if (pay_to) {
      debitConditions.push('b.supplier_name LIKE ?');
      queryParams.push(`%${pay_to}%`);
    }
    if (transition_type) {
      creditConditions.push('d.transition_type = ?');
      debitConditions.push('b.billtype = ?');
      queryParams.push(transition_type, transition_type);
    }
    if (type) {
      if (type === 'credit') {
        debitConditions.push('1 = 0'); // Exclude debit if only credit
      } else if (type === 'debit') {
        creditConditions.push('1 = 0'); // Exclude credit if only debit
      }
    }
    if (created_at_from) {
      creditConditions.push('d.created_at >= ?');
      debitConditions.push('b.approved_at >= ?');
      queryParams.push(created_at_from, created_at_from);
    }
    if (created_at_to) {
      creditConditions.push('d.created_at <= ?');
      debitConditions.push('b.approved_at <= ?');
      queryParams.push(created_at_to, created_at_to);
    }
    if (amount_min) {
      creditConditions.push('d.amount >= ?');
      debitConditions.push('b.total_amount >= ?');
      queryParams.push(amount_min, amount_min);
    }
    if (amount_max) {
      creditConditions.push('d.amount <= ?');
      debitConditions.push('b.total_amount <= ?');
      queryParams.push(amount_max, amount_max);
    }
    if (balance_amount_min) {
      creditConditions.push('d.balance_amount >= ?');
      debitConditions.push('b.updated_balance >= ?');
      queryParams.push(balance_amount_min, balance_amount_min);
    }
    if (balance_amount_max) {
      creditConditions.push('d.balance_amount <= ?');
      debitConditions.push('b.updated_balance <= ?');
      queryParams.push(balance_amount_max, balance_amount_max);
    }
    if (search) {
      creditConditions.push('(d.transition_id LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR companies.company_name LIKE ? OR stores.store_name LIKE ?)');
      debitConditions.push('(b.voucher_reference_number LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR companies.company_name LIKE ? OR stores.store_name LIKE ? OR b.supplier_name LIKE ?)');
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // WHERE clauses
    const creditWhere = creditConditions.length ? `WHERE ${creditConditions.join(' AND ')}` : '';
    const debitWhere = debitConditions.length ? `WHERE b.is_approved = 1 AND ${debitConditions.join(' AND ')}` : 'WHERE b.is_approved = 1';

    // SQL Query
    const query = `
      SELECT * FROM (
        SELECT 
          d.id AS id,
          d.transition_id,
          d.store_id,
          d.depositor_id AS user_id,
          d.transition_type,
          'credit' AS type,
          d.amount,
          d.balance_amount,
          d.created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          NULL AS voucher_reference_number,
          NULL AS billtype,
          NULL AS total_amount,
          NULL AS pay_to
        FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT 
          b.id AS id,
          b.voucher_reference_number AS transition_id,
          b.store_id,
          b.user_id,
          b.billtype AS transition_type,
          'debit' AS type,
          b.total_amount AS amount,
          b.updated_balance AS balance_amount,
          b.approved_at AS created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          b.voucher_reference_number,
          b.billtype,
          b.total_amount,
          b.supplier_name AS pay_to
        FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
      ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total_count FROM (
        SELECT d.id FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT b.id FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const [rows] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2)); // Exclude LIMIT and OFFSET for count

    const result = rows.map((row) => ({
      ...row,
      debit_details: row.type === 'debit' ? {
        voucher_reference_number: row.voucher_reference_number,
        total_amount: row.total_amount,
        pay_to: row.pay_to,
      } : null,
      store: { store_name: row.storeName },
      user: {
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
      },
    }));

    res.set('Access-Control-Expose-Headers', 'x-total-count');
    res.set('x-total-count', countResult[0].total_count);
    res.status(200).json(result);
  } catch (err) {
    console.error('Error at getAllTransitions:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

// Get transitions for a company (for Admin/SuperAdmin)
const getCompanyTransitions = async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      page = 1,
      limit = 25,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search,
      transition_id,
      store_id,
      department,
      'user.username': username,
      'debit_details.pay_to': pay_to,
      transition_type,
      type,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
    } = req.query;

    const sortableColumns = {
      transition_id: 'combined.transition_id',
      companyName: 'companies.company_name',
      storeName: 'stores.store_name',
      department: 'departments.department',
      'user.username': 'users.username',
      'debit_details.pay_to': 'combined.pay_to',
      transition_type: 'combined.transition_type',
      type: 'combined.type',
      amount: 'combined.amount',
      balance_amount: 'combined.balance_amount',
      created_at: 'combined.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    // Filters and query parameters
    const creditConditions = ['companies.id = ?'];
    const debitConditions = ['companies.id = ?'];
    const queryParams = [companyId, companyId];

    // Apply additional filters
    if (transition_id) {
      creditConditions.push('d.transition_id LIKE ?');
      debitConditions.push('b.voucher_reference_number LIKE ?');
      queryParams.push(`%${transition_id}%`, `%${transition_id}%`);
    }
    if (store_id) {
      creditConditions.push('d.store_id = ?');
      debitConditions.push('b.store_id = ?');
      queryParams.push(store_id, store_id);
    }
    if (department) {
      creditConditions.push('departments.department LIKE ?');
      debitConditions.push('departments.department LIKE ?');
      queryParams.push(`%${department}%`, `%${department}%`);
    }
    if (username) {
      creditConditions.push('users.username LIKE ?');
      debitConditions.push('users.username LIKE ?');
      queryParams.push(`%${username}%`, `%${username}%`);
    }
    if (pay_to) {
      debitConditions.push('b.supplier_name LIKE ?');
      queryParams.push(`%${pay_to}%`);
    }
    if (transition_type) {
      creditConditions.push('d.transition_type = ?');
      debitConditions.push('b.billtype = ?');
      queryParams.push(transition_type, transition_type);
    }
    if (type) {
      if (type === 'credit') {
        debitConditions.push('1 = 0'); // Exclude debit if only credit
      } else if (type === 'debit') {
        creditConditions.push('1 = 0'); // Exclude credit if only debit
      }
    }
    if (created_at_from) {
      creditConditions.push('d.created_at >= ?');
      debitConditions.push('b.approved_at >= ?');
      queryParams.push(created_at_from, created_at_from);
    }
    if (created_at_to) {
      creditConditions.push('d.created_at <= ?');
      debitConditions.push('b.approved_at <= ?');
      queryParams.push(created_at_to, created_at_to);
    }
    if (amount_min) {
      creditConditions.push('d.amount >= ?');
      debitConditions.push('b.total_amount >= ?');
      queryParams.push(amount_min, amount_min);
    }
    if (amount_max) {
      creditConditions.push('d.amount <= ?');
      debitConditions.push('b.total_amount <= ?');
      queryParams.push(amount_max, amount_max);
    }
    if (balance_amount_min) {
      creditConditions.push('d.balance_amount >= ?');
      debitConditions.push('b.updated_balance >= ?');
      queryParams.push(balance_amount_min, balance_amount_min);
    }
    if (balance_amount_max) {
      creditConditions.push('d.balance_amount <= ?');
      debitConditions.push('b.updated_balance <= ?');
      queryParams.push(balance_amount_max, balance_amount_max);
    }
    if (search) {
      creditConditions.push('(d.transition_id LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR stores.store_name LIKE ?)');
      debitConditions.push('(b.voucher_reference_number LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR stores.store_name LIKE ? OR b.supplier_name LIKE ?)');
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // WHERE clauses
    const creditWhere = `WHERE ${creditConditions.join(' AND ')}`;
    const debitWhere = `WHERE b.is_approved = 1 AND ${debitConditions.join(' AND ')}`;

    // SQL Query (similar to getAllTransitions)
    const query = `
      SELECT * FROM (
        SELECT 
          d.id AS id,
          d.transition_id,
          d.store_id,
          d.depositor_id AS user_id,
          d.transition_type,
          'credit' AS type,
          d.amount,
          d.balance_amount,
          d.created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          NULL AS voucher_reference_number,
          NULL AS billtype,
          NULL AS total_amount,
          NULL AS pay_to
        FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT 
          b.id AS id,
          b.voucher_reference_number AS transition_id,
          b.store_id,
          b.user_id,
          b.billtype AS transition_type,
          'debit' AS type,
          b.total_amount AS amount,
          b.updated_balance AS balance_amount,
          b.approved_at AS created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          b.voucher_reference_number,
          b.billtype,
          b.total_amount,
          b.supplier_name AS pay_to
        FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
      ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total_count FROM (
        SELECT d.id FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT b.id FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const [rows] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2)); // Exclude LIMIT and OFFSET

    const result = rows.map((row) => ({
      ...row,
      debit_details: row.type === 'debit' ? {
        voucher_reference_number: row.voucher_reference_number,
        total_amount: row.total_amount,
        pay_to: row.pay_to,
      } : null,
      store: { store_name: row.storeName },
      user: {
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
      },
    }));

    res.set('x-total-count', countResult[0].total_count);
    res.status(200).json(result);
  } catch (err) {
    console.error('Error at getCompanyTransitions:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};


// Get transitions for a store (for Cashier/selected store)
const getStoreTransitions = async (req, res) => {
  try {
    const { storeId } = req.params;
    // Convert comma-separated storeIds into array
    const storeIds = storeId.split(',').map(id => id.trim());

    const {
      page = 1,
      limit = 25,
      sortBy = 'created_at',
      sortOrder = 'desc',
      search,
      transition_id,
      department,
      'user.username': username,
      'debit_details.pay_to': pay_to,
      transition_type,
      type,
      amount_min,
      amount_max,
      balance_amount_min,
      balance_amount_max,
      created_at_from,
      created_at_to,
    } = req.query;

    const sortableColumns = {
      transition_id: 'combined.transition_id',
      storeName: 'stores.store_name',
      department: 'departments.department',
      'user.username': 'users.username',
      'debit_details.pay_to': 'combined.pay_to',
      transition_type: 'combined.transition_type',
      type: 'combined.type',
      amount: 'combined.amount',
      balance_amount: 'combined.balance_amount',
      created_at: 'combined.created_at',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    // Filters and query parameters
    const creditConditions = ['d.store_id IN (?)'];
    const debitConditions = ['b.store_id IN (?)'];
    const queryParams = [storeIds, storeIds];

    // Apply additional filters
    if (transition_id) {
      creditConditions.push('d.transition_id LIKE ?');
      debitConditions.push('b.voucher_reference_number LIKE ?');
      queryParams.push(`%${transition_id}%`, `%${transition_id}%`);
    }
    if (department) {
      creditConditions.push('departments.department LIKE ?');
      debitConditions.push('departments.department LIKE ?');
      queryParams.push(`%${department}%`, `%${department}%`);
    }
    if (username) {
      creditConditions.push('users.username LIKE ?');
      debitConditions.push('users.username LIKE ?');
      queryParams.push(`%${username}%`, `%${username}%`);
    }
    if (pay_to) {
      debitConditions.push('b.supplier_name LIKE ?');
      queryParams.push(`%${pay_to}%`);
    }
    if (transition_type) {
      creditConditions.push('d.transition_type = ?');
      debitConditions.push('b.billtype = ?');
      queryParams.push(transition_type, transition_type);
    }
    if (type) {
      if (type === 'credit') {
        debitConditions.push('1 = 0'); // Exclude debit if only credit
      } else if (type === 'debit') {
        creditConditions.push('1 = 0'); // Exclude credit if only debit
      }
    }
    if (created_at_from) {
      creditConditions.push('d.created_at >= ?');
      debitConditions.push('b.approved_at >= ?');
      queryParams.push(created_at_from, created_at_from);
    }
    if (created_at_to) {
      creditConditions.push('d.created_at <= ?');
      debitConditions.push('b.approved_at <= ?');
      queryParams.push(created_at_to, created_at_to);
    }
    if (amount_min) {
      creditConditions.push('d.amount >= ?');
      debitConditions.push('b.total_amount >= ?');
      queryParams.push(amount_min, amount_min);
    }
    if (amount_max) {
      creditConditions.push('d.amount <= ?');
      debitConditions.push('b.total_amount <= ?');
      queryParams.push(amount_max, amount_max);
    }
    if (balance_amount_min) {
      creditConditions.push('d.balance_amount >= ?');
      debitConditions.push('b.updated_balance >= ?');
      queryParams.push(balance_amount_min, balance_amount_min);
    }
    if (balance_amount_max) {
      creditConditions.push('d.balance_amount <= ?');
      debitConditions.push('b.updated_balance <= ?');
      queryParams.push(balance_amount_max, balance_amount_max);
    }
    if (search) {
      creditConditions.push('(d.transition_id LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR companies.company_name LIKE ?)');
      debitConditions.push('(b.voucher_reference_number LIKE ? OR users.username LIKE ? OR departments.department LIKE ? OR companies.company_name LIKE ? OR b.supplier_name LIKE ?)');
      const searchTerm = `%${search}%`;
      queryParams.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm, searchTerm
      );
    }

    // WHERE clauses
    const creditWhere = `WHERE ${creditConditions.join(' AND ')}`;
    const debitWhere = `WHERE b.is_approved = 1 AND ${debitConditions.join(' AND ')}`;

    // SQL Query
    const query = `
      SELECT * FROM (
        SELECT 
          d.id AS id,
          d.transition_id,
          d.store_id,
          d.depositor_id AS user_id,
          d.transition_type,
          'credit' AS type,
          d.amount,
          d.balance_amount,
          d.created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          NULL AS voucher_reference_number,
          NULL AS billtype,
          NULL AS total_amount,
          NULL AS pay_to
        FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT 
          b.id AS id,
          b.voucher_reference_number AS transition_id,
          b.store_id,
          b.user_id,
          b.billtype AS transition_type,
          'debit' AS type,
          b.total_amount AS amount,
          b.updated_balance AS balance_amount,
          b.approved_at AS created_at,
          stores.store_name AS storeName,
          companies.company_name AS companyName,
          departments.department AS department,
          users.username,
          users.email,
          users.contact_number,
          b.voucher_reference_number,
          b.billtype,
          b.total_amount,
          b.supplier_name AS pay_to
        FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
      ORDER BY ${sortableColumns[sortBy]} ${sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) AS total_count FROM (
        SELECT d.id FROM deposites d
        JOIN users ON d.depositor_id = users.id
        JOIN stores ON d.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${creditWhere}
        UNION ALL
        SELECT b.id FROM bills b
        JOIN users ON b.user_id = users.id
        JOIN stores ON b.store_id = stores.id
        JOIN companies ON users.cid = companies.id
        LEFT JOIN departments ON users.did = departments.id
        ${debitWhere}
      ) AS combined
    `;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const [rows] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2)); // remove LIMIT & OFFSET

    const result = rows.map((row) => ({
      ...row,
      debit_details: row.type === 'debit' ? {
        voucher_reference_number: row.voucher_reference_number,
        total_amount: row.total_amount,
        pay_to: row.pay_to,
      } : null,
      store: { store_name: row.storeName },
      user: {
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
      },
    }));

    res.set('x-total-count', countResult[0].total_count);
    res.status(200).json(result);
  } catch (err) {
    console.error('Error at getStoreTransitions:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

module.exports = {
  createReport,
  getMyreports,
  updateReport,
  deleteReport,
  updateReportFilters,
  getReportFilters,
  getAllTransitions,
  getCompanyTransitions,
  getStoreTransitions,
};