const express = require('express');
const cookieParser = require('cookie-parser'); // <--- Add this
const app = express();
app.use(cookieParser());
const server = require('http').createServer(app);
const PORT = 8000;
const bodyparser = require('body-parser');
app.use(bodyparser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));   
const bcrypt = require('bcrypt');
const cors = require('cors');
app.use(cors({
    origin: ['http://localhost:3000', ,"http://192.168.0.150:3000"],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] // Add this line
}));
const connection = require('./connections/connections')
const {authenticateToken} = require('./middleware/authMiddleware');
const pool = require('./connections/connections')

// POST /api/users - Create user and assign role
app.post('/api/users', async (req, res) => {
  const { username, email, contact_number, password, role_id } = req.body;

  // 1. Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    // 2. Insert user
    const [userResult] = await connection.query(
      'INSERT INTO users (username, email, contact_number, password_hash) VALUES (?, ?, ?, ?)',
      [username, email, contact_number, passwordHash]
    );

    // 3. Assign role
    await connection.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userResult.insertId, role_id]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});



app.use('/api/roles',require('./routes/roles'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', authenticateToken ,require('./routes/companies'));
app.use('/api/stores', authenticateToken, require('./routes/stores'));
app.use('/api/departments', authenticateToken, require('./routes/department'));
app.use('/api/cashiers', authenticateToken, require('./routes/cashier'));
app.use('/api/passbook', authenticateToken, require('./routes/passbook'));
app.use('/api/employee', authenticateToken, require('./routes/employee'));
app.use('/api/hoa', authenticateToken, require('./routes/hoa'));
app.use('/api/noe', authenticateToken, require('./routes/noe'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/vendors', authenticateToken, require('./routes/vendors'));
app.use('/api/employeedashboard', authenticateToken, require('./routes/employeeDashboard'));
app.use('/api/cashierdashboard', authenticateToken, require('./routes/cashierdashboard'));
app.use('/api/admindashboard', authenticateToken, require('./routes/admindashboard'));
app.use('/api/reports', authenticateToken, require('./routes/reports'));
app.use('/api/creditreports', authenticateToken, require('./routes/creditreports'));
app.use('/api/hods', authenticateToken, require('./routes/hod'));
app.use('/api/otherusers', authenticateToken, require('./routes/otherusers'));
app.use('/api/instructors', authenticateToken, require('./routes/instructor'));
app.use('/api/transitions', authenticateToken, require('./routes/transitions'));
app.use('/api/advance', authenticateToken, require('./routes/advance'));


app.get('/api/adminTallybills/:cid', authenticateToken, async (req, res) => {
  // Manual validation of query parameters
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  const { cid } = req.params;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({ message: 'Page must be a positive integer' });
  }
  if (isNaN(limitNum) || limitNum < 1) {
    return res.status(400).json({ message: 'Limit must be a positive integer' });
  }
  if (!['asc', 'desc'].includes(order.toLowerCase())) {
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });
  }

  try {
    // First, get distinct voucher numbers with their main details for pagination
    let distinctSql = `
      SELECT DISTINCT 
        bills.voucher_reference_number,
        MIN(bills.created_at) as created_at,
        MAX(bills.is_approved) as is_approved,
        MAX(bills.sent_to_tally) as sent_to_tally,
        MAX(bills.sent_to_admin) as sent_to_admin,
        MIN(bills.billtype) as billtype,
        MIN(users.username) as username,
        SUM(bills.total_amount) as total_amount,
        COUNT(bills.id) as bill_count,
        MIN(bills.id) as first_bill_id,
        MIN(bills.instructed_by) as instructed_by,
        MIN(bills.narration) as narration,
        MIN(bills.supplier_name) as supplier_name,
        MIN(bills.cost_code) as cost_code,
        MIN(approved_users.username) as approved_by_username,
        MIN(stores.store_name) as store_name,
        MIN(departments.department) as department,
        MIN(companies.company_name) as company,
        MIN(bills.pdf_id) as pdf_id
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.sent_to_admin = 1 AND bills.cid = ?
    `;
    
      let countSql = `
  SELECT COUNT(DISTINCT bills.voucher_reference_number) as total
  FROM bills
  JOIN users ON bills.user_id = users.id
  LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
  LEFT JOIN stores ON bills.cost_code = stores.store_id
  LEFT JOIN departments ON users.did = departments.id
  LEFT JOIN companies ON users.cid = companies.id
  WHERE bills.sent_to_admin = 1 AND bills.cid = ?
`; 
    const distinctParams = [cid];
    const countParams = [cid];

    // Search for distinct query
    if (search) {
      distinctSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        approved_users.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ? OR
        bills.supplier_name LIKE ? OR
        bills.invoice_reference_number LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        approved_users.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ? OR
        bills.supplier_name LIKE ? OR
        bills.invoice_reference_number LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      distinctParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Filterable columns for distinct query
    const filterableColumns = {
      'is_approved': 'bills.is_approved',
      'pdf_id': 'bills.pdf_id',
      'sent_to_tally': 'bills.sent_to_tally',
      'billtype': 'bills.billtype',
      'voucher_reference_number': 'bills.voucher_reference_number',
      'created_at': 'bills.created_at',
      'total_amount': 'bills.total_amount',
      'narration': 'bills.narration',
      'supplier_name': 'bills.supplier_name',
      'instructed_by': 'bills.instructed_by',
      'invoice_date': 'bills.invoice_date',
      'invoice_reference_number': 'bills.invoice_reference_number',
      'cost_code': 'bills.cost_code',
      'approved_by.username': 'approved_users.username',
      'user.username': 'users.username',
      'user.company': 'companies.company_name',
      'user.store': 'stores.store_name',
      'user.department': 'departments.department'
    };

    const isValidDate = (dateStr) => !isNaN(Date.parse(dateStr));

    // Apply filters for distinct query
    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === undefined || value === '' || value === '||') continue;

      // Date range filters
      if (['created_at', 'invoice_date'].includes(key)) {
        if (!value.includes('|')) {
          return res.status(400).json({ message: `Invalid date range format for ${key}` });
        }
        const [startDate, endDate] = value.split('|');
        
        if (startDate && !isValidDate(startDate) || endDate && !isValidDate(endDate)) {
          return res.status(400).json({ message: `Invalid date format for ${key}` });
        }
        
        if (startDate) {
          distinctSql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          distinctParams.push(startDate);
          countParams.push(startDate);
        }
        if (endDate) {
          distinctSql += ` AND ${filterableColumns[key]} < DATE_ADD(?, INTERVAL 1 DAY)`;
          countSql += ` AND ${filterableColumns[key]} < DATE_ADD(?, INTERVAL 1 DAY)`;
          distinctParams.push(endDate);
          countParams.push(endDate);
        }
      }
      // Number range filters
      else if (['total_amount'].includes(key)) {
        const [min, max] = value.split('-').map(v => v === '' ? undefined : parseFloat(v));
        if (min !== undefined && !isNaN(min)) {
          distinctSql += ` AND bills.total_amount >= ?`;
          countSql += ` AND bills.total_amount >= ?`;
          distinctParams.push(min);
          countParams.push(min);
        }
        if (max !== undefined && !isNaN(max)) {
          distinctSql += ` AND bills.total_amount <= ?`;
          countSql += ` AND bills.total_amount <= ?`;
          distinctParams.push(max);
          countParams.push(max);
        }
      }
      // Boolean filters
      else if (['is_approved', 'sent_to_tally'].includes(key)) {
        const parsedValue = value === '1' || value === 'true' ? 1 : value === '0' || value === 'false' ? 0 : null;
        if (parsedValue === null) {
          return res.status(400).json({ message: `Invalid value for ${key}` });
        }
        distinctSql += ` AND ${filterableColumns[key]} = ?`;
        countSql += ` AND ${filterableColumns[key]} = ?`;
        distinctParams.push(parsedValue);
        countParams.push(parsedValue);
      }
      // Bill type filter
      else if (key === 'billtype') {
        distinctSql += ` AND ${filterableColumns[key]} = ?`;
        countSql += ` AND ${filterableColumns[key]} = ?`;
        distinctParams.push(value);
        countParams.push(value);
      }
      else if (key === 'pdf_id') {
        distinctSql += ` AND ${filterableColumns[key]} LIKE ?`;
        countSql += ` AND ${filterableColumns[key]} LIKE ?`;
        distinctParams.push(value);
        countParams.push(value);
      }
      else {
        distinctSql += ` AND ${filterableColumns[key]} LIKE ?`;
        countSql += ` AND ${filterableColumns[key]} LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
      }
    }

    // Group by voucher reference number
    distinctSql += ` GROUP BY bills.voucher_reference_number`;

    // Sorting for distinct query
    const sortableColumns = {
      'created_at': 'created_at',
      'voucher_reference_number': 'bills.voucher_reference_number',
      'total_amount': 'total_amount',
      'bill_count': 'bill_count',
      'is_approved': 'is_approved',
      'sent_to_tally': 'sent_to_tally',
      'billtype': 'billtype',
      'user.username': 'username',
      'user.department': 'department',
      'user.store': 'store_name',
      'user.company': 'company',
      'supplier_name': 'supplier_name',
      'instructed_by': 'instructed_by',
      'cost_code': 'cost_code',
      'approved_by.username': 'approved_by_username'
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    const sortColumn = sortableColumns[sortBy];
    distinctSql += ` ORDER BY ${sortColumn} ${order.toUpperCase()}`;

    // Pagination for distinct results
    const offset = (pageNum - 1) * limitNum;
    distinctSql += ` LIMIT ? OFFSET ?`;
    distinctParams.push(limitNum, offset);

    // Execute distinct query for pagination
    const [distinctRows] = await pool.query(distinctSql, distinctParams);
    const [countResult] = await pool.query(countSql, countParams);

    // If no distinct rows found, return empty
    if (distinctRows.length === 0) {
      return res.status(200).json({
        bills: [],
        totalCount: 0,
        currentPage: pageNum,
        totalPages: 0,
        limit: limitNum,
        message: 'No bills found'
      });
    }

    // Get all bills for the distinct voucher numbers to show details
    const voucherNumbers = distinctRows.map(row => row.voucher_reference_number);
    
    let detailSql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.username,
        users.email,
        users.contact_number,
        approved_users.username AS approved_by_username,
        stores.store_name,
        departments.department AS department,
        companies.company_name AS company
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.voucher_reference_number IN (?)
      ORDER BY bills.voucher_reference_number, bills.created_at
    `;

    const [detailRows] = await pool.query(detailSql, [voucherNumbers]);

    // Group detail rows by voucher reference number
    const groupedBills = {};
    detailRows.forEach(row => {
      const voucherNumber = row.voucher_reference_number;
      if (!groupedBills[voucherNumber]) {
        groupedBills[voucherNumber] = [];
      }
      
      const formattedInvoiceDate = row.invoice_date
        ? new Date(row.invoice_date).toISOString().split('T')[0]
        : null;

      groupedBills[voucherNumber].push({
        ...row,
        invoice_date: formattedInvoiceDate,
        user: {
          id: row.user_id ?? null,
          username: row.username ?? 'Unknown',
          email: row.email ?? 'N/A',
          contact_number: row.contact_number ?? 'N/A',
          department: row.department ?? 'N/A',
          company: row.company ?? 'N/A',
          store: row.store_name ?? 'N/A',
        },
        approved_by: row.approved_by ? {
          id: row.approved_by,
          username: row.approved_by_username ?? 'N/A',
        } : null,
        store_name: row.store_name ?? 'N/A',
      });
    });

    // Format response with grouped structure
    const formattedRows = distinctRows.map(distinctRow => {
      const voucherNumber = distinctRow.voucher_reference_number;
      const billsForVoucher = groupedBills[voucherNumber] || [];
      
      // Find the first bill for main details
      const firstBill = billsForVoucher[0] || {};
      
      return {
        id: distinctRow.first_bill_id,
        voucher_reference_number: voucherNumber,
        created_at: distinctRow.created_at,
        is_approved: distinctRow.is_approved,
        sent_to_tally: distinctRow.sent_to_tally,
        sent_to_admin: distinctRow.sent_to_admin,
        billtype: distinctRow.billtype,
        total_amount: distinctRow.total_amount,
        narration: distinctRow.narration,
        instructed_by: distinctRow.instructed_by,
        supplier_name: distinctRow.supplier_name,
        cost_code: distinctRow.cost_code,
        count: distinctRow.bill_count,
        pdf_id: distinctRow.pdf_id,
        subBills: billsForVoucher,
        user: {
          username: distinctRow.username ?? firstBill.user?.username ?? 'Unknown',
          email: firstBill.user?.email ?? 'N/A',
          contact_number: firstBill.user?.contact_number ?? 'N/A',
          department: distinctRow.department ?? firstBill.user?.department ?? 'N/A',
          company: distinctRow.company ?? firstBill.user?.company ?? 'N/A',
          store: distinctRow.store_name ?? firstBill.user?.store ?? 'N/A'
        },
        approved_by: firstBill.approved_by,
        store_name: distinctRow.store_name ?? firstBill.store_name ?? 'N/A'
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(countResult[0].total / limitNum),
      limit: limitNum,
    });

  } catch (err) {
    console.error('Database Error:', err.message, err.stack);
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'Database table not found' });
    }
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});

app.get('/api/superAdminTallybills', authenticateToken, async (req, res) => {
  // Manual validation of query parameters
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({ message: 'Page must be a positive integer' });
  }
  if (isNaN(limitNum) || limitNum < 1) {
    return res.status(400).json({ message: 'Limit must be a positive integer' });
  }
  if (!['asc', 'desc'].includes(order.toLowerCase())) {
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });
  }


  try {
    const params = [];
    const countParams = [];
    let sql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.username,
        users.email,
        users.contact_number,
        approved_users.username AS approved_by_username,
        stores.store_name,
        departments.department AS department,
        companies.company_name AS company
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.sent_to_admin = 1
    `;
    let countSql = `
      SELECT COUNT(*) as total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.sent_to_admin = 1
    `;

    if (search) {
      const searchTerm = `%${search}%`;
      sql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        approved_users.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        approved_users.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ?
      )`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const filterableColumns = {
      is_approved: 'bills.is_approved',
      sent_to_tally: 'bills.sent_to_tally',
      billtype: 'bills.billtype',
      cost_code: 'bills.cost_code',
      voucher_reference_number: 'bills.voucher_reference_number',
      voucher_date: 'bills.voucher_date',
      created_at: 'bills.created_at',
      total_amount: 'bills.total_amount',
      taxable_amount: 'bills.taxable_amount',
      cgst_percent: 'bills.cgst_percent',
      sgst_percent: 'bills.sgst_percent',
      igst_percent: 'bills.igst_percent',
      cgst: 'bills.cgst',
      sgst: 'bills.sgst',
      igst: 'bills.igst',
      narration: 'bills.narration',
      'user.username': 'users.username',
      'approved_by.username': 'approved_users.username',
      supplier_name: 'bills.supplier_name',
      instructed_by: 'bills.instructed_by',
      invoice_date: 'bills.invoice_date',
      invoice_reference_number: 'bills.invoice_reference_number',
      rounding_off: 'bills.rounding_off',
      nature_of_expense: 'bills.nature_of_expense',
      head_of_accounts: 'bills.head_of_accounts',
      'user.company': 'companies.company_name',
      'user.store': 'stores.store_name',
      'user.department': 'departments.department',
    };

    const isValidDate = (dateStr) => !isNaN(Date.parse(dateStr));

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === undefined || value === '') continue;

      if (key === 'voucher_date' || key === 'created_at' || key === 'invoice_date') {
        if (!value.includes('|')) {
          return res.status(400).json({ message: `Invalid date range format for ${key}` });
        }
        const [startDate, endDate] = value.split('|');
        if (startDate && !isValidDate(startDate) || endDate && !isValidDate(endDate)) {
          return res.status(400).json({ message: `Invalid date format for ${key}` });
        }
        if (startDate && endDate) {
          if (startDate === endDate) {
            sql += ` AND DATE(${filterableColumns[key]}) = ?`;
            countSql += ` AND DATE(${filterableColumns[key]}) = ?`;
            params.push(startDate);
            countParams.push(startDate);
          } else {
            if (startDate) {
              sql += ` AND ${filterableColumns[key]} >= ?`;
              countSql += ` AND ${filterableColumns[key]} >= ?`;
              params.push(startDate);
              countParams.push(startDate);
            }
            if (endDate) {
              sql += ` AND ${filterableColumns[key]} < DATE_ADD(?, INTERVAL 1 DAY)`;
              countSql += ` AND ${filterableColumns[key]} < DATE_ADD(?, INTERVAL 1 DAY)`;
              params.push(endDate);
              countParams.push(endDate);
            }
          }
        }
      } else if (['total_amount', 'taxable_amount', 'cgst_percent', 'sgst_percent', 'igst_percent', 'cgst', 'sgst', 'igst'].includes(key)) {
        const [min, max] = value.split('-').map(v => v === '' ? undefined : parseFloat(v));
        if (min !== undefined && !isNaN(min)) {
          sql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          params.push(min);
          countParams.push(min);
        }
        if (max !== undefined && !isNaN(max)) {
          sql += ` AND ${filterableColumns[key]} <= ?`;
          countSql += ` AND ${filterableColumns[key]} <= ?`;
          params.push(max);
          countParams.push(max);
        }
      } else if (key === 'billtype') {
        sql += ` AND ${filterableColumns[key]} = ?`;
        countSql += ` AND ${filterableColumns[key]} = ?`;
        params.push(value);
        countParams.push(value);
      } else if (key === 'is_approved' || key === 'sent_to_tally') {
        const parsedValue = value === '1' || value === 'true' ? 1 : value === '0' || value === 'false' ? 0 : null;
        if (parsedValue === null) {
          return res.status(400).json({ message: `Invalid value for ${key}` });
        }
        sql += ` AND ${filterableColumns[key]} = ?`;
        countSql += ` AND ${filterableColumns[key]} = ?`;
        params.push(parsedValue);
        countParams.push(parsedValue);
      } else {
        sql += ` AND ${filterableColumns[key]} LIKE ?`;
        countSql += ` AND ${filterableColumns[key]} LIKE ?`;
        params.push(`%${value}%`);
        countParams.push(`%${value}%`);
      }
    }

    const sortableColumns = {
      created_at: 'bills.created_at',
      is_approved: 'bills.is_approved',
      sent_to_tally: 'bills.sent_to_tally',
      billtype: 'bills.billtype',
      cost_code: 'bills.cost_code',
      voucher_reference_number: 'bills.voucher_reference_number',
      voucher_date: 'bills.voucher_date',
      total_amount: 'bills.total_amount',
      taxable_amount: 'bills.taxable_amount',
      cgst_percent: 'bills.cgst_percent',
      sgst_percent: 'bills.sgst_percent',
      igst_percent: 'bills.igst_percent',
      cgst: 'bills.cgst',
      sgst: 'bills.sgst',
      igst: 'bills.igst',
      narration: 'bills.narration',
      'user.username': 'users.username',
      'approved_by.username': 'approved_users.username',
      supplier_name: 'bills.supplier_name',
      instructed_by: 'bills.instructed_by',
      invoice_date: 'bills.invoice_date',
      invoice_reference_number: 'bills.invoice_reference_number',
      rounding_off: 'bills.rounding_off',
      nature_of_expense: 'bills.nature_of_expense',
      head_of_accounts: 'bills.head_of_accounts',
      'user.company': 'companies.company_name',
      'user.store': 'stores.store_name',
      'user.department': 'departments.department',
    };

    if (!sortableColumns[sortBy]) {
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });
    }

    sql += ` ORDER BY ${sortableColumns[sortBy]} ${order.toUpperCase()}`;
    const offset = (pageNum - 1) * limitNum;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);


    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    if (!rows || !Array.isArray(rows)) {
      throw new Error('Query returned invalid rows');
    }
    if (!countResult || !countResult[0] || typeof countResult[0].total !== 'number') {
      throw new Error('Count query returned invalid result');
    }

    const formattedRows = rows.map(row => {
      const { user_id, username, email, contact_number, approved_by_username, store_name, department, company, ...bill } = row;

      const formattedInvoiceDate = bill.invoice_date
        ? new Date(bill.invoice_date).toISOString().split('T')[0]
        : null;

      return {
        ...bill,
        invoice_date: formattedInvoiceDate,
        user: {
          id: user_id ?? null,
          username: username ?? 'Unknown',
          email: email ?? 'N/A',
          contact_number: contact_number ?? 'N/A',
          department: department ?? 'N/A',
          company: company ?? 'N/A',
          store: store_name ?? 'N/A',
        },
        approved_by: row.approved_by ? {
          id: row.approved_by,
          username: approved_by_username ?? 'N/A',
        } : null,
        store_name: store_name ?? 'N/A',
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(countResult[0].total / limitNum),
      limit: limitNum,
      message: formattedRows.length === 0 ? 'No bills found' : undefined,
    });
  } catch (err) {
    console.error('Database Error:', err.message, err.stack);
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ message: 'Database table not found' });
    }
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});


server.listen(PORT,()=>{
    console.log(`Server Running In ${PORT}`);
})