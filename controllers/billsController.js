const pool = require('../connections/connections');
const querystring = require('querystring');
const axios = require('axios');
const { fileURLToPath } = require('url');

// Complete Backend: createBill (modified for batch/multi-item)

const createBillBatch = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      billtype,
      user_id,
      cid,
      did,
      store_id,
      cost_code,
      voucher_date,
      narration,
      items
    } = req.body;

    const CompanySql = 'SELECT company_name FROM companies WHERE id = ?';
  const [companyRows] = await connection.query(CompanySql, [cid]);
  const company = companyRows[0]?.company_name || null;

  const departmentSql = 'SELECT department FROM departments WHERE id = ?';
  const [rows] = await connection.query(departmentSql, [did]);
  const department = rows[0]?.department || null;
    // ---------------- COMMON VALIDATION ----------------
    if (
      !billtype ||
      !user_id ||
      !cost_code ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      throw new Error("Missing required fields");
    }

    const validBillTypes = ["gst", "non gst", "advance"];
    if (!validBillTypes.includes(billtype)) {
      throw new Error("Invalid billtype");
    }

    // ---------------- SAFE YEAR EXTRACTION ----------------
    const parsedDate = new Date(voucher_date);
    const currentYear = isNaN(parsedDate.getTime())
      ? new Date().getFullYear()
      : parsedDate.getFullYear();

    let voucherNumber = "";

    // ---------------- GST / NON-GST VOUCHER ----------------
    if (billtype !== "advance") {
      const [lastVoucher] = await connection.query(
        `
        SELECT voucher_reference_number
        FROM bills
        WHERE billtype != 'advance'
          AND cost_code = ?
          AND voucher_reference_number REGEXP ?
        ORDER BY CAST(SUBSTRING_INDEX(voucher_reference_number, '-', -1) AS UNSIGNED) DESC
        LIMIT 1
        `,
        [cost_code, `^${cost_code}-${currentYear}-[0-9]+$`]
      );

      voucherNumber = `${cost_code}-${currentYear}-001`;

      if (lastVoucher.length > 0) {
        const lastNum = parseInt(
          lastVoucher[0].voucher_reference_number.split("-").pop(),
          10
        );
        voucherNumber = `${cost_code}-${currentYear}-${String(lastNum + 1).padStart(3, "0")}`;
      }
    }

    // ---------------- ADVANCE VOUCHER ----------------
    if (billtype === "advance") {
      if (!store_id) {
        throw new Error("Store ID is required for advance bills");
      }

      const [lastAdvanceVoucher] = await connection.query(
        `
        SELECT voucher_reference_number
        FROM bills
        WHERE billtype = 'advance'
          AND cost_code = ?
          AND store_id = ?
          AND voucher_reference_number REGEXP ?
        ORDER BY CAST(SUBSTRING_INDEX(voucher_reference_number, '-', -1) AS UNSIGNED) DESC
        LIMIT 1
        `,
        [cost_code, store_id, `^${cost_code}-ADV-${currentYear}-[0-9]+$`]
      );

      voucherNumber = `${cost_code}-ADV-${currentYear}-001`;

      if (lastAdvanceVoucher.length > 0) {
        const lastNum = parseInt(
          lastAdvanceVoucher[0].voucher_reference_number.split("-").pop(),
          10
        );
        voucherNumber = `${cost_code}-ADV-${currentYear}-${String(lastNum + 1).padStart(3, "0")}`;
      }
    }

    // ---------------- INSERT ITEMS ----------------
    for (const item of items) {
      const {
        supplier_name,
        nature_of_expense,
        head_of_accounts,
        instructed_by,
        amount,
        remarks,
        invoice_date,
        invoice_reference_number,
        supplier_gst,
        taxable_amount,
        igst_percent,
        cgst_percent,
        sgst_percent,
        igst,
        cgst,
        sgst,
        rounding_off
      } = item;

      if (!supplier_name || !nature_of_expense || !head_of_accounts || !instructed_by || !amount) {
        throw new Error("Missing item fields");
      }

      if (isNaN(amount) || parseFloat(amount) <= 0) {
        throw new Error("Invalid amount");
      }

      // ---------------- GST VALIDATION ----------------
      if (billtype === "gst") {
        if (
          !supplier_gst ||
          !taxable_amount ||
          !invoice_date ||
          !invoice_reference_number
        ) {
          throw new Error("Missing GST fields");
        }

        const hasIgst = igst_percent > 0 && igst >= 0;
        const hasCgstSgst = cgst_percent > 0 && sgst_percent > 0;

        if (!hasIgst && !hasCgstSgst) {
          throw new Error("Invalid GST structure");
        }
      }

      // ---------------- ADVANCE VALIDATION ----------------
      if (billtype === "advance") {
        if (
          invoice_date ||
          invoice_reference_number ||
          supplier_gst ||
          taxable_amount ||
          igst_percent ||
          cgst_percent ||
          sgst_percent ||
          igst ||
          cgst ||
          sgst ||
          rounding_off
        ) {
          throw new Error("Advance bills must not contain GST or invoice details");
        }
      }

      const sql = `
        INSERT INTO bills (
          billtype, user_id, cid, did, store_id,
          cost_code, voucher_date, voucher_reference_number,
          invoice_date, invoice_reference_number,
          supplier_name, supplier_gst,
          nature_of_expense, head_of_accounts, instructed_by,
          taxable_amount, cgst_percent, sgst_percent, igst_percent,
          cgst, sgst, igst, rounding_off,
          total_amount, narration,
          approved_by, is_cancelled,
          sent_to_admin, sent_to_tally, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        billtype,
        user_id,
        cid || null,
        did || null,
        store_id || null,
        cost_code,
        voucher_date || new Date(),
        voucherNumber,
        billtype === "advance" ? null : invoice_date || null,
        billtype === "advance" ? null : invoice_reference_number || null,
        supplier_name,
        billtype === "gst" ? supplier_gst : null,
        nature_of_expense,
        head_of_accounts,
        instructed_by,
        billtype === "gst" ? taxable_amount : null,
        billtype === "gst" ? cgst_percent || null : null,
        billtype === "gst" ? sgst_percent || null : null,
        billtype === "gst" ? igst_percent || null : null,
        billtype === "gst" ? cgst || null : null,
        billtype === "gst" ? sgst || null : null,
        billtype === "gst" ? igst || null : null,
        billtype === "gst" ? rounding_off || null : null,
        parseFloat(amount).toFixed(2),
        narration || null,
        null,
        false,
        false,
        false,
        remarks || null
      ];

      await connection.execute(sql, values);
    }

    await connection.commit();

    res.status(201).json({
      message: "Voucher created successfully",
      voucher_reference_number: voucherNumber,
      billtype,
      total_amount: items.reduce((s, i) => s + parseFloat(i.amount), 0).toFixed(2),
      department,
      company
    });

  } catch (err) {
    await connection.rollback();
    console.error("Create Bill Batch Error:", err);

    res.status(
      err.message.includes("Missing") || err.message.includes("Invalid") ? 400 : 500
    ).json({ message: err.message });

  } finally {
    connection.release();
  }
};


// In your router, add: app.post('/api/bills/batch', createBillBatch);

const getAllBills = async (req, res) => {
  try {
    const sql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.username,
        users.email,
        users.contact_number
      FROM bills
      JOIN users ON bills.user_id = users.id
      ORDER BY bills.id DESC
    `;
    const [rows] = await pool.query(sql);

    // Nest user details into a `user` object
    const formattedRows = rows.map(row => {
      const { user_id, username, email, contact_number, ...bill } = row;
      return {
        ...bill,
        user: {
          id: user_id,
          username,
          email,
          contact_number
        }
      };
    });

    res.status(200).json(formattedRows);
  } catch (err) {
    console.error('Get All Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const getUserbills = async (req, res) => {
  const userId = req.params.id;

  const {
    page = 1,
    limit = 25,
    sortBy = 'created_at',
    order = 'desc',
    search,
    ...filters
  } = req.query;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 25;
  const offset = (pageNum - 1) * limitNum;

  try {
    /* ================= MAIN QUERY ================= */
    let distinctSql = `
      SELECT
        bills.voucher_reference_number,
        MIN(bills.created_at) AS created_at,
        MAX(bills.is_approved) AS is_approved,
        MAX(bills.sent_to_admin) AS sent_to_admin,
        MAX(bills.is_cancelled) AS is_cancelled,
        MAX(bills.is_self_closed) AS is_self_closed,
        MIN(bills.billtype) AS billtype,
        SUM(bills.total_amount) AS total_amount,
        COUNT(bills.id) AS bill_count,
        MIN(bills.id) AS first_bill_id,
        MIN(bills.instructed_by) AS instructed_by,
        MIN(bills.narration) AS narration,

        MIN(users.id) AS user_id,
        MIN(users.username) AS username,
        MIN(departments.department) AS department,
        MIN(companies.company_name) AS company,
        MIN(stores.store_name) AS store
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE bills.user_id = ?
    `;

    const distinctParams = [userId];

    /* ================= SEARCH ================= */
    if (search) {
      const term = `%${search}%`;
      distinctSql += `
        AND (
          bills.voucher_reference_number LIKE ?
          OR bills.cost_code LIKE ?
          OR bills.narration LIKE ?
          OR bills.supplier_name LIKE ?
          OR users.username LIKE ?
        )
      `;
      distinctParams.push(term, term, term, term, term);
    }

    /* ================= DATE FILTER ================= */
    if (filters.created_at) {
      const [start, end] = filters.created_at.split('|').map(v => v.trim());

      if (start) {
        distinctSql += ` AND bills.created_at >= ?`;
        distinctParams.push(start);
      }

      if (end) {
        const d = new Date(end);
        d.setDate(d.getDate() + 1);
        const exclusive = d.toISOString().split('T')[0];
        distinctSql += ` AND bills.created_at < ?`;
        distinctParams.push(exclusive);
      }
    }

    /* ================= BILL TYPE ================= */
    if (filters.billtype) {
      distinctSql += ` AND bills.billtype = ?`;
      distinctParams.push(filters.billtype);
    }

    /* ================= GROUP BY ================= */
    distinctSql += ` GROUP BY bills.voucher_reference_number`;

    /* ================= HAVING FILTERS ================= */
const having = [];
const havingParams = [];

const isApproved = filters.is_approved !== undefined ? Number(filters.is_approved) : undefined;
const sentToAdmin = filters.sent_to_admin !== undefined ? Number(filters.sent_to_admin) : undefined;
const isCancelled = filters.is_cancelled !== undefined ? Number(filters.is_cancelled) : undefined;
const isSelfClosed = filters.is_self_closed !== undefined ? Number(filters.is_self_closed) : undefined;

/* Explicit filters */
if (isApproved === 0 || isApproved === 1) {
  having.push(`MAX(bills.is_approved) = ?`);
  havingParams.push(isApproved);
}

if (sentToAdmin === 0 || sentToAdmin === 1) {
  having.push(`MAX(bills.sent_to_admin) = ?`);
  havingParams.push(sentToAdmin);
}

if (isSelfClosed === 0 || isSelfClosed === 1) {
  having.push(`MAX(bills.is_self_closed) = ?`);
  havingParams.push(isSelfClosed);
}

/* ===== BUSINESS RULE =====
   If bill is approved → it must NOT be cancelled
*/
if (isApproved === 1 && isCancelled === undefined) {
  having.push(`MAX(bills.is_cancelled) = 0`);
}

/* Explicit cancelled filter overrides rule */
if (isCancelled === 0 || isCancelled === 1) {
  having.push(`MAX(bills.is_cancelled) = ?`);
  havingParams.push(isCancelled);
}

if (having.length) {
  distinctSql += ` HAVING ${having.join(' AND ')}`;
  distinctParams.push(...havingParams);
}


    /* ================= SORTING ================= */
    const sortableColumns = {
      created_at: 'MIN(bills.created_at)',
      voucher_reference_number: 'bills.voucher_reference_number',
      total_amount: 'SUM(bills.total_amount)',
      bill_count: 'COUNT(bills.id)'
    };

    const sortColumn = sortableColumns[sortBy] || sortableColumns.created_at;
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    distinctSql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    /* ================= PAGINATION ================= */
    distinctSql += ` LIMIT ? OFFSET ?`;
    distinctParams.push(limitNum, offset);

    /* ================= EXECUTE MAIN QUERY ================= */
    const [distinctRows] = await pool.query(distinctSql, distinctParams);

    /* ================= COUNT QUERY (HAVING SAFE) ================= */
    let countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT bills.voucher_reference_number
        FROM bills
        JOIN users ON bills.user_id = users.id
        WHERE bills.user_id = ?
    `;

    const countParams = [userId];

    if (search) {
      const term = `%${search}%`;
      countSql += `
        AND (
          bills.voucher_reference_number LIKE ?
          OR bills.cost_code LIKE ?
          OR bills.narration LIKE ?
          OR bills.supplier_name LIKE ?
          OR users.username LIKE ?
        )
      `;
      countParams.push(term, term, term, term, term);
    }

    if (filters.created_at) {
      const [start, end] = filters.created_at.split('|').map(v => v.trim());

      if (start) {
        countSql += ` AND bills.created_at >= ?`;
        countParams.push(start);
      }

      if (end) {
        const d = new Date(end);
        d.setDate(d.getDate() + 1);
        const exclusive = d.toISOString().split('T')[0];
        countSql += ` AND bills.created_at < ?`;
        countParams.push(exclusive);
      }
    }

    if (filters.billtype) {
      countSql += ` AND bills.billtype = ?`;
      countParams.push(filters.billtype);
    }

    countSql += ` GROUP BY bills.voucher_reference_number`;

    if (having.length) {
      countSql += ` HAVING ${having.join(' AND ')}`;
      countParams.push(...havingParams);
    }

    countSql += `) t`;

    const [[{ total }]] = await pool.query(countSql, countParams);

    if (!distinctRows.length) {
      return res.status(200).json({ bills: [], totalCount: 0 });
    }

    /* ================= DETAILS QUERY ================= */
    const voucherNumbers = distinctRows.map(v => v.voucher_reference_number);

    const [detailRows] = await pool.query(
      `
      SELECT bills.*, users.username,
             departments.department, companies.company_name, stores.store_name
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE bills.voucher_reference_number IN (?)
      ORDER BY bills.voucher_reference_number, bills.created_at
      `,
      [voucherNumbers]
    );

    const grouped = {};
    console.log(grouped , "grouped " );
    detailRows.forEach(row => {
      if (!grouped[row.voucher_reference_number]) {
        grouped[row.voucher_reference_number] = [];
      }
      grouped[row.voucher_reference_number].push(row);
    });

    /* ================= RESPONSE ================= */
    const result = distinctRows.map(v => ({
      id: v.first_bill_id,
      voucher_reference_number: v.voucher_reference_number,
      created_at: v.created_at,
      is_approved: v.is_approved,
      sent_to_admin: v.sent_to_admin,
      is_cancelled: v.is_cancelled,
      is_self_closed: v.is_self_closed,
      billtype: v.billtype,
      total_amount: v.total_amount,
      narration: v.narration,
      instructed_by: v.instructed_by,
      count: v.bill_count,
      subBills: grouped[v.voucher_reference_number] || [],
      user: {
        id: v.user_id,
        username: v.username || 'Unknown',
        department: v.department || 'N/A',
        company: v.company || 'N/A',
        store: v.store || 'N/A'
      }
    }));

    res.status(200).json({
      bills: result,
      totalCount: total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};


const getStorebills = async (req, res) => {
  const storeId = req.params.id;
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  const storeIds = storeId.split(',').map(id => id.trim());
  const placeholders = storeIds.map(() => '?').join(',');
  
  try {
    // First, get distinct voucher numbers with their main details for pagination
    let distinctSql = `
      SELECT DISTINCT 
        bills.voucher_reference_number,
        MIN(bills.created_at) as created_at,
        MAX(bills.is_approved) as is_approved,
        MIN(bills.billtype) as billtype,
        MIN(users.username) as username,
        MIN(users.eid) as eid,
        SUM(bills.total_amount) as total_amount,
        COUNT(bills.id) as bill_count,
        MIN(bills.id) as first_bill_id,
        MAX(bills.sent_to_admin) as sent_to_admin,
        -- Use MAX() for is_cancelled to check if ANY bill in the voucher is cancelled
        MAX(bills.is_cancelled) as is_cancelled,
        -- Use MAX() for is_self_closed to check if ANY bill in the voucher is self-closed
        MAX(bills.is_self_closed) as is_self_closed,
        MIN(bills.instructed_by) as instructed_by,
        MIN(bills.narration) as narration,
        MIN(approved_users.username) as approved_by_username,
        MIN(cancelled_user.username) as cancelled_by_username,
        MIN(departments.department) as department,
        MIN(companies.company_name) as company,
        MIN(stores.store_name) as store,
        MIN(bills.pdf_id) as pdf_id
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_user ON bills.cancelled_by = cancelled_user.id
      LEFT JOIN employees ON users.id = employees.user_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE bills.store_id IN (${placeholders})
    `;

    let countSql = `
      SELECT COUNT(DISTINCT bills.voucher_reference_number) as total
      FROM bills
      JOIN users ON bills.user_id = users.id
      WHERE bills.store_id IN (${placeholders})
    `;

    const distinctParams = [...storeIds];
    const countParams = [...storeIds];

    // Search for distinct query
    if (search) {
      distinctSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_user.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_user.username LIKE ? OR
        stores.store_name LIKE ? OR
        companies.company_name LIKE ? OR
        departments.department LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      distinctParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Apply filters for distinct query
    const filterableColumns = {
      'is_approved': 'bills.is_approved',
      'pdf_id': 'bills.pdf_id',
      'sent_to_admin': 'bills.sent_to_admin',
      'billtype': 'bills.billtype',
      'voucher_reference_number': 'bills.voucher_reference_number',
      'created_at': 'bills.created_at',
      'total_amount': 'bills.total_amount',
      'narration': 'bills.narration',
      'approved_by.username': 'approved_users.username',
      'cancelled_by.username': 'cancelled_user.username',
      'user.username': 'users.username',
      'user.eid' : 'users.eid',
      'user.department': 'departments.department',
      'user.store': 'stores.store_name',
      'user.company': 'companies.company_name',
      'supplier_name': 'bills.supplier_name',
      'instructed_by': 'bills.instructed_by',
      'is_cancelled': 'bills.is_cancelled',
      'is_self_closed': 'bills.is_self_closed'  // Added is_self_closed to filterable columns
    };

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === undefined || value === '' || value === '||') continue;

      if (['created_at'].includes(key)) {
        const [startDate, endDate] = value.split('|').map(d => d.trim());

        if (startDate) {
          distinctSql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          distinctParams.push(startDate);
          countParams.push(startDate);
        }

        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          const exclusiveEndDate = endDateObj.toISOString().split('T')[0];

          distinctSql += ` AND ${filterableColumns[key]} < ?`;
          countSql += ` AND ${filterableColumns[key]} < ?`;
          distinctParams.push(exclusiveEndDate);
          countParams.push(exclusiveEndDate);
        }
      }
      else if (['total_amount'].includes(key)) {
        const [min, max] = value.split('-').map(v => v.trim() === '' ? undefined : parseFloat(v));
        if (min !== undefined) {
          distinctSql += ` AND bills.total_amount >= ?`;
          countSql += ` AND bills.total_amount >= ?`;
          distinctParams.push(min);
          countParams.push(min);
        }
        if (max !== undefined) {
          distinctSql += ` AND bills.total_amount <= ?`;
          countSql += ` AND bills.total_amount <= ?`;
          distinctParams.push(max);
          countParams.push(max);
        }
      }
      else if (['is_approved', 'sent_to_admin', 'is_cancelled', 'is_self_closed'].includes(key)) {
        const intValue = parseInt(value);
        if (!isNaN(intValue) && (intValue === 0 || intValue === 1)) {
          // For the distinct query, we need to check ALL bills in the voucher
          // If filtering for is_cancelled: 0, we need vouchers where NO bills are cancelled
          // If filtering for is_cancelled: 1, we need vouchers where AT LEAST ONE bill is cancelled
          if (intValue === 0) {
            // For value 0, we need to ensure NO bills have this flag set to 1
            distinctSql += ` AND NOT EXISTS (
              SELECT 1 FROM bills AS b2 
              WHERE b2.voucher_reference_number = bills.voucher_reference_number 
              AND b2.${key} = 1
            )`;
            countSql += ` AND NOT EXISTS (
              SELECT 1 FROM bills AS b2 
              WHERE b2.voucher_reference_number = bills.voucher_reference_number 
              AND b2.${key} = 1
            )`;
          } else {
            // For value 1, we need to ensure AT LEAST ONE bill has this flag set to 1
            distinctSql += ` AND EXISTS (
              SELECT 1 FROM bills AS b2 
              WHERE b2.voucher_reference_number = bills.voucher_reference_number 
              AND b2.${key} = 1
            )`;
            countSql += ` AND EXISTS (
              SELECT 1 FROM bills AS b2 
              WHERE b2.voucher_reference_number = bills.voucher_reference_number 
              AND b2.${key} = 1
            )`;
          }
        }
      }
      else if (key === 'billtype') {
        const normalizedValue = value.toLowerCase();
        distinctSql += ` AND LOWER(bills.billtype) = ?`;
        countSql += ` AND LOWER(bills.billtype) = ?`;
        distinctParams.push(normalizedValue);
        countParams.push(normalizedValue);
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
      'sent_to_admin': 'sent_to_admin',
      'billtype': 'billtype',
      'user.username': 'username',
      'user.eid' : 'eid',
      'user.department': 'department',
      'user.store': 'store',
      'user.company': 'company',
      'approved_by.username': 'approved_by_username',
      'is_cancelled': 'is_cancelled',
      'is_self_closed': 'is_self_closed'
    };

    const sortColumn = sortableColumns[sortBy] || 'created_at';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    distinctSql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    // Pagination for distinct results
    const offset = (page - 1) * limit;
    distinctSql += ` LIMIT ? OFFSET ?`;
    distinctParams.push(parseInt(limit), offset);

    // Execute distinct query for pagination
    const [distinctRows] = await pool.query(distinctSql, distinctParams);
    const [countResult] = await pool.query(countSql, countParams);

    // If no distinct rows found, return empty
    if (distinctRows.length === 0) {
      return res.status(200).json({
        bills: [],
        totalCount: 0
      });
    }

    // Get all bills for the distinct voucher numbers to show details
    const voucherNumbers = distinctRows.map(row => row.voucher_reference_number);
    
    let detailSql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.eid,
        users.username,
        users.email,
        users.contact_number,
        approved_users.username AS approved_by_username,
        cancelled_user.username AS cancelled_by_username,
        employees.department_id AS department_id,
        departments.department AS department,
        companies.company_name AS company,
        stores.store_name AS store
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_user ON bills.cancelled_by = cancelled_user.id
      LEFT JOIN employees ON users.id = employees.user_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
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
          id: row.user_id,
          username: row.username || 'Unknown' ,
          eid: row.eid || 'N/A',
          email: row.email || 'N/A',
          contact_number: row.contact_number || 'N/A',
          department: row.department || 'N/A',
          company: row.company || 'N/A',
          store: row.store || 'N/A'
        },
        approved_by: row.approved_by ? {
          id: row.approved_by,
          username: row.approved_by_username || 'N/A'
        } : null,
        cancelled_by: row.cancelled_by ? {
          id: row.cancelled_by,
          username: row.cancelled_by_username || 'N/A'
        } : null
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
        billtype: distinctRow.billtype,
        total_amount: distinctRow.total_amount,
        narration: distinctRow.narration,
        instructed_by: distinctRow.instructed_by,
        sent_to_admin: distinctRow.sent_to_admin,
        is_cancelled: distinctRow.is_cancelled,
        is_self_closed: distinctRow.is_self_closed,
        pdf_id: distinctRow.pdf_id,
        count: distinctRow.bill_count,
        subBills: billsForVoucher,
        user: firstBill.user || {
          id: distinctRow.user_id,
          username: distinctRow.username || firstBill.user?.username || 'Unknown',
          department: distinctRow.department || firstBill.user?.department || 'N/A',
          company: distinctRow.company || firstBill.user?.company || 'N/A',
          store: distinctRow.store || firstBill.user?.store || 'N/A',
          eid: distinctRow.eid || firstBill.user?.eid || 'N/A'
        },
        approved_by: firstBill.approved_by,
        cancelled_by: firstBill.cancelled_by
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total
    });

  } catch (err) {
    console.error('Get Store Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
}

const ApproveBill = async (req, res) => {
  const billId = req.params.id;
  const { approved_by, amount, storeId } = req.body;

  try {
    // Step 1: Get current balance from stores_amount
    const [depositRows] = await pool.query(
      'SELECT available_cash FROM stores_amount WHERE store_id = ?',
      [storeId]
    );

    if (depositRows.length === 0) {
      return res.status(404).json({ message: 'Store not found in stores_amount' });
    }

    const currentBalance = parseFloat(depositRows[0].available_cash);
    const numericAmount = parseFloat(amount);

    // Step 2: Check if balance is sufficient
    if (currentBalance < numericAmount) {
      return res.status(400).json({ message: 'Insufficient funds to approve this bill' });
    }

    // Step 3: Deduct amount
    const newBalance = currentBalance - numericAmount;

    await pool.query(
      'UPDATE stores_amount SET available_cash = ? WHERE store_id = ?',
      [newBalance, storeId]
    );

    // Step 4: Generate current date & time in DD-MM-YYYY HH:mm:ss format
    const now = new Date();
    const formattedDateTime = now
      .toLocaleString('en-GB', { hour12: false })
      .replace(',', ''); // "23/10/2025 15:43:20"

    // Step 5: Approve the bill
    const [result] = await pool.query(
      'UPDATE bills SET approved_by = ?, is_approved = 1, approved_at = ?, updated_balance = ? WHERE voucher_reference_number	 = ?',
      [approved_by, formattedDateTime, newBalance, billId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    // Fetch updated bill row
    const [rows] = await pool.query('SELECT * FROM bills WHERE voucher_reference_number	 = ?', [billId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Bill not found after update' });
    }
    const updatedRow = rows[0];
    const rowslength = rows.length;

    // Insert into transitions
    const transitionsQuery = `
      INSERT INTO transitions
      (cid, sid, did, tnx_id, username, supplier, gst, transition_type, amount, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [insertResult] = await pool.query(transitionsQuery, [
      updatedRow.cid,
      updatedRow.store_id,
      updatedRow.did,
      updatedRow.voucher_reference_number,
      updatedRow.user_id,
      `${updatedRow.supplier_name}+${rowslength - 1}`,
      updatedRow.supplier_gst,
      'Debit',
      parseFloat(numericAmount),
      parseFloat(updatedRow.updated_balance)
    ]);

    if (insertResult.affectedRows === 0) {
      return res.status(500).json({ message: 'Entry not inserted in transitions' });
    }

    res.status(200).json({ message: 'Bill approved successfully' });

  } catch (err) {
    console.error('Approve Bill Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

const getSinglebill = async (req, res) => {
  const billId = req.params.id;
  try {
    // First, get the specific bill to find its voucher reference number
    const findSql = `
      SELECT voucher_reference_number 
      FROM bills 
      WHERE id = ?
    `;
    const [findRows] = await pool.query(findSql, [billId]);
    
    if (findRows.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    
    const voucherRef = findRows[0].voucher_reference_number;
    
    // Now fetch all bills with the same voucher reference number
    const sql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.username,
        users.email,
        users.contact_number
      FROM bills
      JOIN users ON bills.user_id = users.id
      WHERE bills.voucher_reference_number = ?
      ORDER BY bills.id ASC
    `;
    const [rows] = await pool.query(sql, [voucherRef]);

    // Nest user details into a `user` object
    const formattedRows = rows.map(row => {
      const { user_id, username, email, contact_number, ...bill } = row;
      return {
        ...bill,
        user: {
          id: user_id,
          username,
          email,
          contact_number
        }
      };
    });

    res.status(200).json(formattedRows);
  } catch (err) {
    console.error('Get All Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// Batch update for cancelled bills - sends all bills at once
const updateBatchForCancelledBills = async (req, res) => {
  const voucherRef = req.params.voucherRef;
  
  try {
    if (!req.body.bills || !Array.isArray(req.body.bills) || req.body.bills.length === 0) {
      return res.status(400).json({ 
        message: 'Bills array is required in request body' 
      });
    }

    const bills = req.body.bills;
    
    // Validate all bills have required fields
    for (const bill of bills) {
      const requiredFields = [
        'billtype', 'cost_code', 'voucher_date', 'supplier_name', 'amount'
      ];

      const missingFields = requiredFields.filter(field => !bill[field] && bill[field] !== 0);

      if (bill.billtype === 'gst') {
        const gstRequired = ['supplier_gst', 'taxable_amount'];
        missingFields.push(...gstRequired.filter(field => !bill[field] && bill[field] !== 0));
      }

      if (missingFields.length > 0) {
        return res.status(400).json({
          message: `Missing required fields for bill ${bill.id || 'unknown'}`,
          missingFields,
          billId: bill.id
        });
      }
    }

    // Get the original voucher to check if it's cancelled and get its details
    const [originalVoucher] = await pool.query(
      'SELECT user_id, is_cancelled, voucher_reference_number FROM bills WHERE voucher_reference_number = ? LIMIT 1',
      [voucherRef]
    );

    if (originalVoucher.length === 0) {
      return res.status(404).json({ 
        message: 'Original voucher not found' 
      });
    }

    const { user_id, is_cancelled } = originalVoucher[0];

    if (!is_cancelled) {
      return res.status(400).json({ 
        message: 'Batch update is only allowed for cancelled vouchers' 
      });
    }

    // Extract base voucher and determine next suffix
    const baseVoucher = voucherRef.split('/')[0];
    const [existingBills] = await pool.query(
      `SELECT voucher_reference_number FROM bills 
       WHERE voucher_reference_number LIKE ?`,
      [`${baseVoucher}%`]
    );

    // Determine next suffix number
    let nextSuffix = 1;
    if (existingBills.length > 0) {
      const suffixNumbers = existingBills
        .map(b => {
          const match = b.voucher_reference_number.match(/\/(\d+)$/);
          return match ? parseInt(match[1]) : 0;
        })
        .filter(n => !isNaN(n));

      if (suffixNumbers.length > 0) {
        nextSuffix = Math.max(...suffixNumbers) + 1;
      }
    }

    // Create new voucher number
    const newVoucherNumber = `${baseVoucher}/${nextSuffix}`;

    // Mark all old bills in the voucher as closed
    await pool.query(
      'UPDATE bills SET is_bill_closed = 1 WHERE voucher_reference_number = ?',
      [voucherRef]
    );

    // Prepare to insert all new bills
    const insertedBills = [];
    
    for (const bill of bills) {
      const {
        billtype, cid, store_id, did, cost_code, voucher_date,
        invoice_date, invoice_reference_number, supplier_name, supplier_gst,
        nature_of_expense, head_of_accounts, instructed_by, taxable_amount,
        cgst_percent, sgst_percent, igst_percent, cgst, sgst, igst,
        rounding_off, amount, narration
      } = bill;

      const sql = `
        INSERT INTO bills (
          billtype, user_id, cid, store_id, did, cost_code, voucher_date, voucher_reference_number,
          invoice_date, invoice_reference_number, supplier_name, supplier_gst,
          nature_of_expense, head_of_accounts, instructed_by, taxable_amount, cgst_percent,
          sgst_percent, igst_percent, cgst, sgst, igst, rounding_off, total_amount,
          narration, approved_by, is_cancelled, sent_to_admin, sent_to_tally
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        billtype,
        user_id,
        cid || null,
        store_id || null,
        did || null,
        cost_code,
        voucher_date,
        newVoucherNumber,
        invoice_date || null,
        invoice_reference_number || null,
        supplier_name,
        supplier_gst || null,
        nature_of_expense || null,
        head_of_accounts || null,
        instructed_by || null,
        taxable_amount || null,
        cgst_percent || null,
        sgst_percent || null,
        igst_percent || null,
        cgst || null,
        sgst || null,
        igst || null,
        rounding_off || null,
        amount,
        narration || null,
        null,   // approved_by
        false,  // is_cancelled
        false,  // sent_to_admin
        false   // sent_to_tally
      ];

      const [result] = await pool.execute(sql, values);
      
      // Get the inserted bill
      const [insertedBill] = await pool.query(
        'SELECT * FROM bills WHERE id = ?',
        [result.insertId]
      );
      
      insertedBills.push(insertedBill[0]);
    }

    return res.status(201).json({
      message: 'Cancelled voucher duplicated successfully with all bills',
      new_voucher_reference_number: newVoucherNumber,
      bills: insertedBills,
      count: insertedBills.length
    });

  } catch (err) {
    console.error('Batch Update Error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Duplicate entry detected' });
    }
    res.status(500).json({ 
      message: 'Internal Server Error', 
      error: err.message 
    });
  }
};

// Update single bill - modified to handle both cancelled and active bills
const updateBill = async (req, res) => {
  const billId = req.params.id;

  try {
    const requiredFields = [
      'billtype', 'cost_code', 'voucher_date', 'supplier_name'
    ];

    const missingFields = requiredFields.filter(field => !req.body[field] && req.body[field] !== 0);

    if (req.body.billtype === 'gst') {
      const gstRequired = ['supplier_gst', 'taxable_amount'];
      missingFields.push(...gstRequired.filter(field => !req.body[field] && req.body[field] !== 0));
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Missing required fields',
        missingFields
      });
    }

    // Get current bill status and voucher details
    const [checkStatus] = await pool.query(
      'SELECT user_id, is_cancelled, voucher_reference_number FROM bills WHERE id = ?',
      [billId]
    );

    if (checkStatus.length === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const { user_id, is_cancelled, voucher_reference_number } = checkStatus[0];

    // ✅ CASE 1: Bill is cancelled → Create a new one with incremented suffix
    if (is_cancelled) {
      // Mark old bill as closed
      await pool.query('UPDATE bills SET is_bill_closed = 1 WHERE id = ?', [billId]);

      // Extract root voucher base (remove any existing /suffix)
      const baseVoucher = voucher_reference_number.split('/')[0];

      // Find all bills that share this base
      const [existingBills] = await pool.query(
        `SELECT voucher_reference_number FROM bills 
         WHERE voucher_reference_number LIKE ?`,
        [`${baseVoucher}%`]
      );

      // Determine next suffix number
      let nextSuffix = 1;
      if (existingBills.length > 0) {
        const suffixNumbers = existingBills
          .map(b => {
            const match = b.voucher_reference_number.match(/\/(\d+)$/);
            return match ? parseInt(match[1]) : 0;
          })
          .filter(n => !isNaN(n));

        if (suffixNumbers.length > 0) {
          nextSuffix = Math.max(...suffixNumbers) + 1;
        }
      }

      // Final voucher format: BASE + / + next number
      const newVoucherNumber = `${baseVoucher}/${nextSuffix}`;

      // Prepare SQL for new bill insertion
      const sql = `
        INSERT INTO bills (
          billtype, user_id, cid, store_id, did, cost_code, voucher_date, voucher_reference_number,
          invoice_date, invoice_reference_number, supplier_name, supplier_gst,
          nature_of_expense, head_of_accounts, instructed_by, taxable_amount, cgst_percent,
          sgst_percent, igst_percent, cgst, sgst, igst, rounding_off, total_amount,
          narration, approved_by, is_cancelled, sent_to_admin, sent_to_tally
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const {
        billtype, cid, store_id, did, cost_code, voucher_date,
        invoice_date, invoice_reference_number, supplier_name, supplier_gst,
        nature_of_expense, head_of_accounts, instructed_by, taxable_amount,
        cgst_percent, sgst_percent, igst_percent, cgst, sgst, igst,
        rounding_off, amount, narration
      } = req.body;

      const values = [
        billtype,
        user_id,
        cid || null,
        store_id || null,
        did || null,
        cost_code,
        voucher_date,
        newVoucherNumber,
        invoice_date,
        invoice_reference_number,
        supplier_name,
        supplier_gst || null,
        nature_of_expense,
        head_of_accounts,
        instructed_by,
        taxable_amount || null,
        cgst_percent || null,
        sgst_percent || null,
        igst_percent || null,
        cgst || null,
        sgst || null,
        igst || null,
        rounding_off || null,
        amount,
        narration || null,
        null,   // approved_by
        false,  // is_cancelled
        false,  // sent_to_admin
        false   // sent_to_tally
      ];

      await pool.execute(sql, values);

      return res.status(201).json({
        message: 'Cancelled bill duplicated successfully',
        new_voucher_reference_number: newVoucherNumber
      });
    }

    // ✅ CASE 2: Bill is not cancelled → Update existing bill
    else {
      const sql = `
        UPDATE bills SET
          billtype = ?, store_id = ?, cost_code = ?, voucher_date = ?,
          invoice_date = ?, invoice_reference_number = ?, supplier_name = ?, supplier_gst = ?,
          nature_of_expense = ?, head_of_accounts = ?, instructed_by = ?, taxable_amount = ?,
          cgst_percent = ?, sgst_percent = ?, igst_percent = ?, cgst = ?, sgst = ?, igst = ?,
          rounding_off = ?, total_amount = ?, narration = ?
        WHERE id = ?
      `;

      const {
        billtype, store_id, cost_code, voucher_date,
        invoice_date, invoice_reference_number, supplier_name, supplier_gst,
        nature_of_expense, head_of_accounts, instructed_by, taxable_amount,
        cgst_percent, sgst_percent, igst_percent, cgst, sgst, igst,
        rounding_off, amount, narration
      } = req.body;

      const values = [
        billtype || null,
        store_id || null,
        cost_code || null,
        voucher_date || null,
        invoice_date || null,
        invoice_reference_number || null,
        supplier_name || null,
        supplier_gst || null,
        nature_of_expense || null,
        head_of_accounts || null,
        instructed_by || null,
        taxable_amount || null,
        cgst_percent || null,
        sgst_percent || null,
        igst_percent || null,
        cgst || null,
        sgst || null,
        igst || null,
        rounding_off || null,
        amount || null,
        narration || null,
        billId
      ];

      const [result] = await pool.execute(sql, values);

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Bill not found' });
      }

      const [updatedBill] = await pool.query(
        'SELECT voucher_reference_number FROM bills WHERE id = ?',
        [billId]
      );

      return res.status(200).json({
        message: 'Bill updated successfully',
        voucher_reference_number: updatedBill[0].voucher_reference_number
      });
    }
  } catch (err) {
    console.error('Update Bill Error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Duplicate entry detected' });
    }
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

// Get all bills with same voucher reference
const getBillsByVoucher = async (req, res) => {
  const voucherRef = req.params.voucherRef;
  
  try {
    const [bills] = await pool.query(
      'SELECT * FROM bills WHERE voucher_reference_number = ? ORDER BY id',
      [voucherRef]
    );

    if (bills.length === 0) {
      return res.status(404).json({ 
        message: 'No bills found for this voucher reference' 
      });
    }

    res.status(200).json(bills);
  } catch (err) {
    console.error('Get Bills by Voucher Error:', err);
    res.status(500).json({ 
      message: 'Internal Server Error', 
      error: err.message 
    });
  }
};


const generateCancelOtp = async (req, res) => {
  const { id } = req.params;
  const { OperatorName, Cashier_name, amount, contactNumber } = req.body;

  if (!OperatorName || !Cashier_name || !amount || !contactNumber) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {

    // 1. Verify bill exists & is approved
    const [rows] = await pool.query(
      'SELECT * FROM bills WHERE voucher_reference_number	 = ? AND is_approved = 1',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Approved bill not found' });
    }
    const bill = rows[0];

    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_verifications (bill_id, otp_code, expires_at)
       VALUES (?, ?, ?)`,
      [id, otp, expiresAt]
    );

    const message = `Vaibhav Jewellers:-
Cancellation Petty Cash Voucher OTP: ${otp},
generated by: ${OperatorName},
Cashier name: ${Cashier_name},
and Voucher amount: Rs.${amount}`;

    // ✅ Properly formatted SMS API request
    const params = {
      username: process.env.SMS_USERNAME, 
      password: process.env.SMS_PASSWORD,  
      from: process.env.SMS_SENDER_ID,      
      to: contactNumber,
      msg: message,
      type: 1,
      template_id: '1407176174191143808',
    };

    const url = `http://www.smsstriker.com/API/sms.php?${querystring.stringify(params)}`;
    const response = await axios.get(url);
    res.status(200).json({ message: 'OTP sent successfully', otp });
  } catch (err) {
    console.error('OTP generation error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

const cancelBill = async (req, res) => {
  const billId = req.params.id;
  const { otp, store_id, amount, cancelledBy, reason_for_reject } = req.body;

  if (!otp || !store_id || !amount) {
    return res.status(400).json({ message: 'OTP, store_id and amount required' });
  }

  try {
    // 1️⃣ Verify OTP
    const [otpRows] = await pool.query(
      `SELECT * FROM otp_verifications 
       WHERE bill_id = ? AND otp_code = ? AND is_used = 0 
       AND expires_at > NOW() 
       ORDER BY id DESC LIMIT 1`,
      [billId, otp]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const otpRecord = otpRows[0];

    // 2️⃣ Mark OTP as used
    await pool.query(`UPDATE otp_verifications SET is_used = 1 WHERE id = ?`, [otpRecord.id]);

    // 3️⃣ Refund logic
    const [depositRows] = await pool.query(
      'SELECT available_cash FROM stores_amount WHERE store_id = ?',
      [store_id]
    );

    if (depositRows.length === 0) {
      return res.status(404).json({ message: 'Store not found in stores_amount' });
    }

    const currentBalance = parseFloat(depositRows[0].available_cash);
    const numericAmount = parseFloat(amount);
    const newBalance = currentBalance + numericAmount;

    await pool.query(
      'UPDATE stores_amount SET available_cash = ? WHERE store_id = ?',
      [newBalance, store_id]
    );

    // 🕒 Current date & time
    const cancelledAt = new Date();

    // 4️⃣ Update the bill as cancelled
    const [result] = await pool.query(
      `UPDATE bills 
       SET is_approved = 0, 
           approved_at = NULL, 
           approved_by = NULL, 
           is_cancelled = 1, 
           cancelled_by = ?, 
           reason_for_reject = ?, 
           cancelled_at = ?, 
           updated_balance = NULL
       WHERE voucher_reference_number = ?`,
      [cancelledBy, reason_for_reject, cancelledAt, billId] // ✅ Fixed parameter order
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    // 5️⃣ Log transition (Refund/Cancelled)
    const [billRows] = await pool.query('SELECT * FROM bills WHERE voucher_reference_number = ?', [billId]);
    const updatedBill = billRows[0];
    const rowslength = billRows.length;

    await pool.query(
      `INSERT INTO transitions
       (cid, sid, did, tnx_id, username, supplier, gst, transition_type, amount, balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        updatedBill.cid,
        updatedBill.store_id,
        updatedBill.did,
        updatedBill.voucher_reference_number,
        updatedBill.user_id,
        `${updatedBill.supplier_name}+${rowslength - 1}`,
        updatedBill.supplier_gst,
        'Refund/Cancelled',
        parseFloat(numericAmount),
        parseFloat(newBalance),
      ]
    );

    res.json({ message: 'Bill cancelled successfully' });
  } catch (err) {
    console.error('Cancel Bill (OTP) Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};


const sendBillsToAdmin = async (req, res) => {
  const { billIds } = req.body;

  try {
    // Step 1: Validate input (must be array of strings)
    if (!Array.isArray(billIds) || billIds.length === 0) {
      return res.status(400).json({ message: 'Invalid or empty billIds array' });
    }

    // Step 2: Clean & validate voucher numbers as STRINGS
    const cleanBillIds = billIds
      .map(id => String(id).trim())
      .filter(id => id.length > 0);

    if (cleanBillIds.length !== billIds.length) {
      return res.status(400).json({
        message: 'All bill IDs must be valid non-empty strings'
      });
    }

    // Step 3: Verify bills are approved & not already sent
    const [bills] = await pool.query(
      `SELECT voucher_reference_number, is_approved, sent_to_admin 
       FROM bills 
       WHERE voucher_reference_number IN (?)`,
      [cleanBillIds]
    );

    if (bills.length === 0) {
      return res.status(404).json({ message: 'No bills found for the provided voucher numbers' });
    }

    const invalidBills = bills.filter(
      bill => bill.is_approved !== 1 || bill.sent_to_admin === 1
    );

    if (invalidBills.length > 0) {
      return res.status(400).json({
        message: 'Some bills are either not approved or already sent to admin',
        invalidBills: invalidBills.map(bill => bill.voucher_reference_number)
      });
    }

    // ✅ Step 4: Generate timestamp & 6-DIGIT UNIQUE PDF NUMBER ONLY
    const now = new Date();

    const formattedDateTime = now
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    // ✅ 6-digit unique number using timestamp + random
    const timestampPart = now.getTime().toString().slice(-4); // last 4 digits of time
    const randomPart = Math.floor(10 + Math.random() * 90);   // 2 random digits

    const sixDigitNumber = `${timestampPart}${randomPart}`.slice(0, 6);
    const pdfId = `FRI${sixDigitNumber}`;  // ✅ Example: FRI001122

    // ✅ Step 5: Update ALL matching voucher numbers
    const [result] = await pool.query(
      `UPDATE bills 
       SET sent_to_admin = 1, 
           sent_to_admin_at = ?, 
           pdf_id = ? 
       WHERE voucher_reference_number IN (?)`,
      [formattedDateTime, pdfId, cleanBillIds]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'No bills updated' });
    }

    // ✅ Final Success Response
    res.status(200).json({
      message: `${result.affectedRows} bills successfully marked as sent to admin`,
      sent_to_admin_at: formattedDateTime,
      pdf_id: pdfId
    });

  } catch (error) {
    console.error('Error sending bills to admin:', error);
    res.status(500).json({
      message: 'Internal Server Error',
      error: error.message
    });
  }
};


const getAdminBills = async (req, res) => {
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  try {
    const params = [];
    const countParams = [];

    // Base SQL query
    let sql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.username,
        users.eid,
        users.email,
        users.contact_number,
        approved_users.username AS approved_by_username,
        cancelled_user.username AS cancelled_by_username
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_user ON bills.cancelled_by = cancelled_user.id
      WHERE bills.is_self_closed != 1
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_user ON bills.cancelled_by = cancelled_user.id
      WHERE bills.sent_to_admin = 1
    `;

    // Search
    if (search) {
      sql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_user.username LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_user.username LIKE ?
      )`;

      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Filterable columns
    const filterableColumns = {
      is_approved: 'bills.is_approved',
      sent_to_tally: 'bills.sent_to_tally',
      is_cancelled: 'bills.is_cancelled',
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
      'approved_by.username': 'approved_users.username',
      'cancelled_by.username': 'cancelled_user.username',
      'user.username': 'users.username',
      'users.eid' : 'users.eid'
    };

    // Handle filters
    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === undefined || value === '' || value === '||') continue;

      // DATE RANGE FILTERS: voucher_date, created_at
      if (['voucher_date', 'created_at'].includes(key)) {
        const [startDate, endDate] = value.split('|').map(d => d.trim());

        if (startDate) {
          sql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          params.push(startDate);
          countParams.push(startDate);
        }

        if (endDate) {
          // Add one day and use < (exclusive upper bound)
          const endDateObj = new Date(endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          const exclusiveEndDate = endDateObj.toISOString().split('T')[0]; // YYYY-MM-DD

          sql += ` AND ${filterableColumns[key]} < ?`;
          countSql += ` AND ${filterableColumns[key]} < ?`;
          params.push(exclusiveEndDate);
          countParams.push(exclusiveEndDate);
        }
      }
      // NUMBER RANGE FILTERS
      else if (
        ['total_amount', 'taxable_amount', 'cgst_percent', 'sgst_percent', 'igst_percent', 'cgst', 'sgst', 'igst'].includes(key)
      ) {
        const [min, max] = value.split('-').map(v => v.trim() === '' ? undefined : parseFloat(v));
        if (min !== undefined) {
          sql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          params.push(min);
          countParams.push(min);
        }
        if (max !== undefined) {
          sql += ` AND ${filterableColumns[key]} <= ?`;
          countSql += ` AND ${filterableColumns[key]} <= ?`;
          params.push(max);
          countParams.push(max);
        }
      }
      // BOOLEAN FILTERS (0/1)
      else if (['is_approved', 'sent_to_tally', 'is_cancelled'].includes(key)) {
        const intValue = parseInt(value);
        if (!isNaN(intValue) && (intValue === 0 || intValue === 1)) {
          sql += ` AND ${filterableColumns[key]} = ?`;
          countSql += ` AND ${filterableColumns[key]} = ?`;
          params.push(intValue);
          countParams.push(intValue);
        }
      }
      // TEXT FILTERS
      else {
        sql += ` AND ${filterableColumns[key]} LIKE ?`;
        countSql += ` AND ${filterableColumns[key]} LIKE ?`;
        params.push(`%${value}%`);
        countParams.push(`%${value}%`);
      }
    }

    // Sortable columns
    const sortableColumns = {
      created_at: 'bills.created_at',
      is_approved: 'bills.is_approved',
      sent_to_tally: 'bills.sent_to_tally',
      is_cancelled: 'bills.is_cancelled',
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
      'users.eid': 'users.eid',
      'approved_by.username': 'approved_users.username',
      'cancelled_by.username': 'cancelled_user.username'
    };

    // Sorting
    const sortColumn = sortableColumns[sortBy] || 'bills.created_at';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    // Pagination
    const offset = (page - 1) * limit;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    // Execute queries
    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    if (!rows || !Array.isArray(rows)) throw new Error('Query returned invalid rows');
    if (!countResult || !countResult[0] || typeof countResult[0].total !== 'number')
      throw new Error('Count query returned invalid result');

    // Format response
    const formattedRows = rows.map(row => {
      const { user_id, username, eid, email, contact_number, approved_by_username, cancelled_by_username, ...bill } = row;

      // Format invoice_date if exists
      const formattedInvoiceDate = bill.invoice_date
        ? new Date(bill.invoice_date).toISOString().split('T')[0]
        : null;

      return {
        ...bill,
        invoice_date: formattedInvoiceDate,
        user: {
          id: user_id,
          username: username || 'Unknown',
          email: email || 'N/A',
          contact_number: contact_number || 'N/A',
          eid: eid || 'N/A'
        },
        approved_by: row.approved_by
          ? { id: row.approved_by, username: approved_by_username || 'N/A' }
          : null,
        cancelled_by: row.cancelled_by
          ? { id: row.cancelled_by, username: cancelled_by_username || 'N/A' }
          : null
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total
    });

  } catch (err) {
    console.error('Get Admin Bills Error:', err.message, err.stack);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};


const sendBillsToTally = async (req, res) => {
  const { billIds } = req.body;

  try {
    // Step 1: Validate input
    if (!Array.isArray(billIds) || billIds.length === 0) {
      return res.status(400).json({ message: "Invalid or empty billIds array" });
    }

    // Step 2: Validate billIds are non-empty strings
    const cleanedBillIds = billIds
      .map(id => (typeof id === "string" ? id.trim() : ""))
      .filter(id => id.length > 0);

    if (cleanedBillIds.length !== billIds.length) {
      return res.status(400).json({ message: "All bill IDs must be valid non-empty strings" });
    }

    // Step 3: Fetch bills
    const [bills] = await pool.query(
      "SELECT id, sent_to_admin, sent_to_tally FROM bills WHERE voucher_reference_number IN (?)",
      [cleanedBillIds]
    );

    // Step 4: Check invalid bills
    const invalidBills = bills.filter(
      bill => bill.sent_to_admin === 0 || bill.sent_to_tally === 1
    );

    if (invalidBills.length > 0) {
      return res.status(400).json({
        message: "Some bills are either not sent to admin or already sent to Tally",
        invalidBills: invalidBills.map(bill => bill.id)
      });
    }

    // Step 5: Update sent_to_tally flag
    const [result] = await pool.query(
      "UPDATE bills SET sent_to_tally = 1 WHERE voucher_reference_number IN (?)",
      [cleanedBillIds]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "No bills found for the provided bill IDs" });
    }

    res.status(200).json({
      message: `${result.affectedRows} bills successfully marked as sent to tally`,
    });

  } catch (error) {
    console.error("Error sending bills to tally:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Backend Code: Node.js Functions
const getCompanyBills = async (req, res) => {
  const companyId = req.params.id;
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  try {
    // First, get distinct voucher numbers with their main details for pagination
    let distinctSql = `
      SELECT DISTINCT 
        bills.voucher_reference_number,
        MIN(bills.created_at) as created_at,
        MAX(bills.is_approved) as is_approved,
        MAX(bills.sent_to_admin) as sent_to_admin,
        MIN(bills.billtype) as billtype,
        MIN(users.username) as username,
        MIN(users.eid) as eid,
        SUM(bills.total_amount) as total_amount,
        COUNT(bills.id) as bill_count,
        MIN(bills.id) as first_bill_id,
        MAX(bills.is_cancelled) as is_cancelled,
        MAX(bills.is_self_closed) as is_self_closed,
        MIN(bills.instructed_by) as instructed_by,
        MIN(bills.narration) as narration,
        MIN(bills.supplier_name) as supplier_name,
        MIN(approved_users.username) as approved_by_username,
        MIN(departments.department) as department,
        MIN(companies.company_name) as company,
        MIN(stores.store_name) as store,
        MIN(bills.pdf_id) as pdf_id
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE bills.cid = ? AND bills.is_self_closed != 1
    `;

    let countSql = `
  SELECT COUNT(DISTINCT bills.voucher_reference_number) as total
  FROM bills
  JOIN users ON bills.user_id = users.id
  LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
  LEFT JOIN departments ON users.did = departments.id
  LEFT JOIN companies ON users.cid = companies.id
  LEFT JOIN stores ON bills.store_id = stores.id
  WHERE bills.cid = ? AND bills.is_self_closed != 1
`;


    const distinctParams = [companyId];
    const countParams = [companyId];

    // Search for distinct query
    if (search) {
      distinctSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        bills.supplier_name LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        companies.company_name LIKE ? OR
        stores.store_name LIKE ? OR
        departments.department LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        bills.supplier_name LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        companies.company_name LIKE ? OR
        stores.store_name LIKE ? OR
        departments.department LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      distinctParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Apply filters for distinct query
    const filterableColumns = {
      'is_approved': 'bills.is_approved',
      'pdf_id': 'bills.pdf_id',
      'sent_to_admin': 'bills.sent_to_admin',
      'is_cancelled': 'bills.is_cancelled',
      'is_self_closed': 'bills.is_self_closed',
      'billtype': 'bills.billtype',
      'voucher_reference_number': 'bills.voucher_reference_number',
      'created_at': 'bills.created_at',
      'total_amount': 'bills.total_amount',
      'narration': 'bills.narration',
      'supplier_name': 'bills.supplier_name',
      'instructed_by': 'bills.instructed_by',
      'invoice_date': 'bills.invoice_date',
      'approved_by.username': 'approved_users.username',
      'user.username': 'users.username',
      'user.eid': 'users.eid',
      'user.company': 'companies.company_name',
      'user.store': 'stores.store_name',
      'user.department': 'departments.department'
    };

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === undefined || value === '' || value === '||') continue;

      if (['created_at', 'invoice_date'].includes(key)) {
        const [startDate, endDate] = value.split('|').map(d => d.trim());

        if (startDate) {
          distinctSql += ` AND ${filterableColumns[key]} >= ?`;
          countSql += ` AND ${filterableColumns[key]} >= ?`;
          distinctParams.push(startDate);
          countParams.push(startDate);
        }

        if (endDate) {
          const endDateObj = new Date(endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          const exclusiveEndDate = endDateObj.toISOString().split('T')[0];

          distinctSql += ` AND ${filterableColumns[key]} < ?`;
          countSql += ` AND ${filterableColumns[key]} < ?`;
          distinctParams.push(exclusiveEndDate);
          countParams.push(exclusiveEndDate);
        }
      }
      else if (['total_amount'].includes(key)) {
        const [min, max] = value.split('-').map(v => v.trim() === '' ? undefined : parseFloat(v));
        if (min !== undefined) {
          distinctSql += ` AND bills.total_amount >= ?`;
          countSql += ` AND bills.total_amount >= ?`;
          distinctParams.push(min);
          countParams.push(min);
        }
        if (max !== undefined) {
          distinctSql += ` AND bills.total_amount <= ?`;
          countSql += ` AND bills.total_amount <= ?`;
          distinctParams.push(max);
          countParams.push(max);
        }
      }
      else if (['is_approved', 'sent_to_admin', 'is_cancelled', 'is_self_closed'].includes(key)) {
        const intValue = parseInt(value);
        if (!isNaN(intValue) && (intValue === 0 || intValue === 1)) {
          distinctSql += ` AND ${filterableColumns[key]} = ?`;
          countSql += ` AND ${filterableColumns[key]} = ?`;
          distinctParams.push(intValue);
          countParams.push(intValue);
        }
      }
      else if (key === 'billtype') {
        const normalizedValue = value.toLowerCase();
        distinctSql += ` AND LOWER(bills.billtype) = ?`;
        countSql += ` AND LOWER(bills.billtype) = ?`;
        distinctParams.push(normalizedValue);
        countParams.push(normalizedValue);
      }
      else if (key === 'pdf_id') {
        distinctSql += ` AND ${filterableColumns[key]} = ?`;
        countSql += ` AND ${filterableColumns[key]} = ?`;
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
      'sent_to_admin': 'sent_to_admin',
      'billtype': 'billtype',
      'user.username': 'username',
      'user.eid': 'eid',
      'user.department': 'department',
      'user.store': 'store',
      'user.company': 'company',
      'supplier_name': 'supplier_name',
      'approved_by.username': 'approved_by_username'
    };

    const sortColumn = sortableColumns[sortBy] || 'created_at';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    distinctSql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    // Pagination for distinct results
    const offset = (page - 1) * limit;
    distinctSql += ` LIMIT ? OFFSET ?`;
    distinctParams.push(parseInt(limit), offset);

    // Execute distinct query for pagination
    const [distinctRows] = await pool.query(distinctSql, distinctParams);
    const [countResult] = await pool.query(countSql, countParams);

    // If no distinct rows found, return empty
    if (distinctRows.length === 0) {
      return res.status(200).json({
        bills: [],
        totalCount: 0
      });
    }

    // Get all bills for the distinct voucher numbers to show details
    const voucherNumbers = distinctRows.map(row => row.voucher_reference_number);
    
    let detailSql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.eid,
        users.username,
        users.email,
        users.contact_number,
        cancelled_user.username AS cancelled_by,
        approved_users.username AS approved_by_username,
        departments.department AS department,
        companies.company_name AS company,
        stores.store_name AS store
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_user ON bills.cancelled_by = cancelled_user.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE bills.voucher_reference_number IN (?)
      AND bills.is_self_closed != 1
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
          id: row.user_id,
          eid: row.eid || 'N/A',
          username: row.username || 'Unknown',
          email: row.email || 'N/A',
          contact_number: row.contact_number || 'N/A',
          department: row.department || 'N/A',
          company: row.company || 'N/A',
          store: row.store || 'N/A'
        },
        cancelBill: {
          cancelled_by: row.cancelled_by || null
        },
        approved_by: row.approved_by ? {
          id: row.approved_by,
          username: row.approved_by_username || 'N/A'
        } : null
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
        sent_to_admin: distinctRow.sent_to_admin,
        billtype: distinctRow.billtype,
        total_amount: distinctRow.total_amount,
        pdf_id: distinctRow.pdf_id,
        narration: distinctRow.narration,
        instructed_by: distinctRow.instructed_by,
        supplier_name: distinctRow.supplier_name,
        is_cancelled: distinctRow.is_cancelled,
        is_self_closed: distinctRow.is_self_closed,
        count: distinctRow.bill_count,
        subBills: billsForVoucher,
        user: firstBill.user ||    {
          eid: distinctRow.eid || firstBill.user?.eid || 'N/A',
          username: distinctRow.username || firstBill.user?.username || 'Unknown',
          department: distinctRow.department || firstBill.user?.department || 'N/A',
          company: distinctRow.company || firstBill.user?.company || 'N/A',
          store: distinctRow.store || firstBill.user?.store || 'N/A'       
        },
        approved_by: firstBill.approved_by
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total
    });

  } catch (err) {
    console.error('Get Company Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};


const getSuperadminBills = async (req, res) => {  
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc', search, ...filters } = req.query;
  
  try {
    // First, get distinct voucher numbers with their main details for pagination
    let distinctSql = `
      SELECT DISTINCT 
        bills.voucher_reference_number,
        MIN(bills.created_at) as created_at,
        MAX(bills.is_approved) as is_approved,
        MAX(bills.sent_to_admin) as sent_to_admin,
        MAX(bills.is_cancelled) as is_cancelled,
        MAX(bills.is_bill_closed) as is_bill_closed,
        MIN(bills.billtype) as billtype,
        MIN(users.username) as username,
        MIN(users.eid) as eid,
        SUM(bills.total_amount) as total_amount,
        COUNT(bills.id) as bill_count,
        MIN(bills.id) as first_bill_id,
        MIN(bills.instructed_by) as instructed_by,
        MIN(bills.narration) as narration,
        MIN(bills.supplier_name) as supplier_name,
        MIN(bills.cost_code) as cost_code,
        MIN(approved_users.username) as approved_by_username,
        MIN(cancelled_users.username) as cancelled_by_username,
        MIN(departments.department) as department,
        MIN(companies.company_name) as company,
        MIN(stores.store_name) as store,
        MIN(bills.reason_for_reject) as reason_for_reject,
        MIN(bills.pdf_id) as pdf_id
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_users ON bills.cancelled_by = cancelled_users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE 1=1
    `;

    let countSql = `
      SELECT COUNT(DISTINCT bills.voucher_reference_number) as total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_users ON bills.cancelled_by = cancelled_users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
      WHERE 1=1
    `;

    const distinctParams = [];
    const countParams = [];

    // --- Search for distinct query ---
    if (search) {
      distinctSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_users.username LIKE ? OR
        companies.company_name LIKE ? OR
        stores.store_name LIKE ? OR
        departments.department LIKE ? OR
        bills.pdf_id LIKE ? OR
        bills.supplier_name LIKE ?
      )`;
      countSql += ` AND (
        bills.voucher_reference_number LIKE ? OR
        bills.cost_code LIKE ? OR
        bills.narration LIKE ? OR
        users.username LIKE ? OR
        users.eid LIKE ? OR
        approved_users.username LIKE ? OR
        cancelled_users.username LIKE ? OR
        companies.company_name LIKE ? OR
        stores.store_name LIKE ? OR
        departments.department LIKE ? OR
        bills.pdf_id LIKE ? OR
        bills.supplier_name LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      distinctParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Helper function to validate dates
    const isValidDate = (d) => {
      if (!d) return false;
      const date = new Date(d);
      return !isNaN(date.getTime());
    };

    // Arrays to store HAVING conditions separately
    const havingConditions = [];
    const havingParams = [];

    // --- Apply filters dynamically for distinct query ---
    for (const [key, value] of Object.entries(filters)) {
      // Skip if value is empty or undefined
      if (value === undefined || value === "" || value === null) continue;
      
      // Handle payment_status filter (special case for frontend)
      // These need to go in HAVING clause because they use aggregate functions
      if (key === "payment_status") {
        switch(value) {
          case "rejected":
            havingConditions.push(`MAX(bills.is_cancelled) = 1`);
            break;
          case "self_closed":
            havingConditions.push(`MAX(bills.is_bill_closed) = 1`);
            break;
          case "sent_to_finance":
            havingConditions.push(`MAX(bills.sent_to_admin) = 1`);
            break;
          case "approved":
            havingConditions.push(`MAX(bills.is_approved) = 1`);
            havingConditions.push(`MAX(bills.is_cancelled) = 0`);
            break;
          case "pending":
            havingConditions.push(`MAX(bills.is_approved) = 0`);
            havingConditions.push(`MAX(bills.is_cancelled) = 0`);
            havingConditions.push(`MAX(bills.is_bill_closed) = 0`);
            havingConditions.push(`MAX(bills.sent_to_admin) = 0`);
            break;
        }
        continue;
      }

      // Handle billtype filter - exact match (goes in WHERE clause)
      if (key === "billtype") {
        distinctSql += ` AND LOWER(bills.billtype) = LOWER(?)`;
        countSql += ` AND LOWER(bills.billtype) = LOWER(?)`;
        distinctParams.push(value);
        countParams.push(value);
        continue;
      }

      // Handle date filters (created_at, invoice_date) - WHERE clause
      if (key === "created_at" || key === "invoice_date") {
        // Check if value contains | separator
        if (!value.includes("|")) {
          return res.status(400).json({ message: `Invalid date range format for ${key}. Expected format: fromDate|toDate` });
        }

        const [startDate, endDate] = value.split("|");

        // Validate dates
        if (startDate && startDate !== "" && !isValidDate(startDate)) {
          return res.status(400).json({ message: `Invalid start date for ${key}: ${startDate}` });
        }
        
        if (endDate && endDate !== "" && !isValidDate(endDate)) {
          return res.status(400).json({ message: `Invalid end date for ${key}: ${endDate}` });
        }

        if (startDate && endDate && startDate !== "" && endDate !== "") {
          if (startDate === endDate) {
            // For same day, use DATE() function
            distinctSql += ` AND DATE(bills.${key}) = ?`;
            countSql += ` AND DATE(bills.${key}) = ?`;
            distinctParams.push(startDate);
            countParams.push(startDate);
          } else {
            // For date range
            distinctSql += ` AND DATE(bills.${key}) >= ? AND DATE(bills.${key}) <= ?`;
            countSql += ` AND DATE(bills.${key}) >= ? AND DATE(bills.${key}) <= ?`;
            distinctParams.push(startDate, endDate);
            countParams.push(startDate, endDate);
          }
        } else if (startDate && startDate !== "") {
          // Only start date provided
          distinctSql += ` AND DATE(bills.${key}) >= ?`;
          countSql += ` AND DATE(bills.${key}) >= ?`;
          distinctParams.push(startDate);
          countParams.push(startDate);
        } else if (endDate && endDate !== "") {
          // Only end date provided
          distinctSql += ` AND DATE(bills.${key}) <= ?`;
          countSql += ` AND DATE(bills.${key}) <= ?`;
          distinctParams.push(endDate);
          countParams.push(endDate);
        }

        continue;
      }

      // Handle total_amount filter - goes in HAVING clause because it uses SUM()
      if (key === "total_amount") {
        // Check if value contains - separator for range
        if (value.includes("-")) {
          const [minStr, maxStr] = value.split("-");
          const min = minStr !== "" ? parseFloat(minStr) : NaN;
          const max = maxStr !== "" ? parseFloat(maxStr) : NaN;

          if (!isNaN(min)) {
            havingConditions.push(`SUM(bills.total_amount) >= ?`);
            havingParams.push(min);
          }
          if (!isNaN(max)) {
            havingConditions.push(`SUM(bills.total_amount) <= ?`);
            havingParams.push(max);
          }
        } else {
          // Single value (exact match)
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            havingConditions.push(`SUM(bills.total_amount) = ?`);
            havingParams.push(numValue);
          }
        }
        continue;
      }

      // Handle boolean filters - WHERE clause (not aggregate)
      if (["is_approved", "sent_to_admin", "is_cancelled", "is_bill_closed"].includes(key)) {
        const parsed = value === "1" || value === "true" ? 1 : value === "0" || value === "false" ? 0 : null;

        if (parsed === null)
          return res.status(400).json({ message: `Invalid value for ${key}` });

        distinctSql += ` AND bills.${key} = ?`;
        countSql += ` AND bills.${key} = ?`;
        distinctParams.push(parsed);
        countParams.push(parsed);

        continue;
      }

      // Handle employee username filter (accept both "username" and "user.username") - WHERE clause
      if (key === "username" || key === "user.username") {
        distinctSql += ` AND users.username LIKE ?`;
        countSql += ` AND users.username LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // Handle employee eid filter (accept both "eid" and "user.eid") - WHERE clause
      if (key === "eid" || key === "user.eid") {
        distinctSql += ` AND users.eid LIKE ?`;
        countSql += ` AND users.eid LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // Handle approved_by username filter - WHERE clause
      if (key === "approved_by_username" || key === "approved_by.username") {
        distinctSql += ` AND approved_users.username LIKE ?`;
        countSql += ` AND approved_users.username LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // Handle company filter - WHERE clause
      if (key === "company" || key === "user.company") {
        distinctSql += ` AND companies.company_name LIKE ?`;
        countSql += ` AND companies.company_name LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // Handle store filter - WHERE clause
      if (key === "store" || key === "user.store") {
        distinctSql += ` AND stores.store_name LIKE ?`;
        countSql += ` AND stores.store_name LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // Handle department filter - WHERE clause
      if (key === "department" || key === "user.department") {
        distinctSql += ` AND departments.department LIKE ?`;
        countSql += ` AND departments.department LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }

      // For other text filters from bills table (LIKE pattern) - WHERE clause
      const billsTextColumns = [
        "cost_code", "voucher_reference_number", "narration", "supplier_name", 
        "instructed_by", "invoice_reference_number", "nature_of_expense", 
        "head_of_accounts", "reason_for_reject", "pdf_id"
      ];
      
      if (billsTextColumns.includes(key)) {
        distinctSql += ` AND bills.${key} LIKE ?`;
        countSql += ` AND bills.${key} LIKE ?`;
        distinctParams.push(`%${value}%`);
        countParams.push(`%${value}%`);
        continue;
      }
    }

    // Group by voucher reference number
    distinctSql += ` GROUP BY bills.voucher_reference_number`;

    // Add HAVING clause if there are conditions that use aggregate functions
    if (havingConditions.length > 0) {
      distinctSql += ` HAVING ${havingConditions.join(' AND ')}`;
      // Add HAVING params to distinctParams
      havingParams.forEach(param => distinctParams.push(param));
    }

    // --- Sorting for distinct query ---
    const sortableColumns = {
      'sl_no': 'first_bill_id',
      'created_at': 'created_at',
      'voucher_reference_number': 'bills.voucher_reference_number',
      'total_amount': 'total_amount',
      'bill_count': 'bill_count',
      'is_approved': 'is_approved',
      'sent_to_admin': 'sent_to_admin',
      'is_cancelled': 'is_cancelled',
      'is_bill_closed': 'is_bill_closed',
      'billtype': 'billtype',
      'cost_code':'cost_code',
      'user.eid': 'eid',
      'eid': 'eid',
      'user.username': 'username',
      'username': 'username',
      'user.department': 'department',
      'department': 'department',
      'user.store': 'store',
      'store': 'store',
      'user.company': 'company',
      'company': 'company',
      'supplier_name': 'supplier_name',
      'instructed_by': 'instructed_by',
      'approved_by.username': 'approved_by_username',
      'approved_by_username': 'approved_by_username',
      'cancelled_by.username': 'cancelled_by_username',
      'cancelled_by_username': 'cancelled_by_username',
      'pdf_id': 'pdf_id'
    };

    const sortColumn = sortableColumns[sortBy] || 'created_at';
    const sortOrder = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    distinctSql += ` ORDER BY ${sortColumn} ${sortOrder}`;

    // --- Pagination for distinct results ---
    const offset = (page - 1) * limit;
    distinctSql += ` LIMIT ? OFFSET ?`;
    distinctParams.push(parseInt(limit), offset);

    // IMPORTANT: For count query, we need to handle it differently
    // We'll use a subquery approach for the count
    if (havingConditions.length > 0) {
      // Rewrite countSql to use the same logic with subquery
      countSql = `
        SELECT COUNT(*) as total FROM (
          SELECT bills.voucher_reference_number
          FROM bills
          JOIN users ON bills.user_id = users.id
          LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
          LEFT JOIN users AS cancelled_users ON bills.cancelled_by = cancelled_users.id
          LEFT JOIN departments ON users.did = departments.id
          LEFT JOIN companies ON users.cid = companies.id
          LEFT JOIN stores ON bills.store_id = stores.id
          WHERE 1=1
          ${countSql.includes('WHERE 1=1 AND') ? countSql.split('WHERE 1=1')[1] : ''}
          GROUP BY bills.voucher_reference_number
          HAVING ${havingConditions.join(' AND ')}
        ) as distinct_vouchers
      `;
      // Rebuild countParams to include HAVING params
      const newCountParams = [...countParams, ...havingParams];
      countParams.length = 0; // Clear array
      newCountParams.forEach(param => countParams.push(param));
    }

    // --- Execute distinct query for pagination ---
    const [distinctRows] = await pool.query(distinctSql, distinctParams);
    const [countResult] = await pool.query(countSql, countParams);

    // If no distinct rows found, return empty
    if (distinctRows.length === 0) {
      return res.status(200).json({
        bills: [],
        totalCount: 0
      });
    }

    // Get all bills for the distinct voucher numbers to show details
    const voucherNumbers = distinctRows.map(row => row.voucher_reference_number);
    
    let detailSql = `
      SELECT 
        bills.*,
        users.id AS user_id,
        users.eid,
        users.username,
        users.email,
        users.contact_number,
        approved_users.username AS approved_by_username,
        cancelled_users.username AS cancelled_by_username,
        users.did AS department_id,
        departments.department AS department,
        companies.company_name AS company,
        stores.store_name AS store
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN users AS cancelled_users ON bills.cancelled_by = cancelled_users.id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      LEFT JOIN stores ON bills.store_id = stores.id
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
      
      const formattedInvoiceDate = row.invoice_date ? new Date(row.invoice_date).toISOString().split('T')[0] : null;
      const formattedCancelledAt = row.cancelled_at ? new Date(row.cancelled_at).toISOString().split('T')[0] : null;

      groupedBills[voucherNumber].push({
        ...row,
        invoice_date: formattedInvoiceDate,
        cancelled_at: formattedCancelledAt,
        user: {
          id: row.user_id,
          eid: row.eid,
          username: row.username || 'Unknown',
          email: row.email || 'N/A',
          contact_number: row.contact_number || 'N/A',
          department: row.department || 'N/A',
          company: row.company || 'N/A',
          store: row.store || 'N/A'
        },
        approved_by: row.approved_by ? {
          id: row.approved_by,
          username: row.approved_by_username || 'N/A'
        } : null,
        cancelled_by: row.cancelled_by ? {
          id: row.cancelled_by,
          username: row.cancelled_by_username || 'N/A'
        } : null
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
        sent_to_admin: distinctRow.sent_to_admin,
        is_cancelled: distinctRow.is_cancelled,
        is_bill_closed: distinctRow.is_bill_closed,
        billtype: distinctRow.billtype,
        total_amount: distinctRow.total_amount,
        narration: distinctRow.narration,
        instructed_by: distinctRow.instructed_by,
        supplier_name: distinctRow.supplier_name,
        cost_code: distinctRow.cost_code,
        reason_for_reject: distinctRow.reason_for_reject,
        pdf_id: distinctRow.pdf_id,
        count: distinctRow.bill_count,
        subBills: billsForVoucher,
        user: {
          eid: distinctRow.eid || firstBill.user?.eid || 'N/A',
          username: distinctRow.username || firstBill.user?.username || 'Unknown',
          email: firstBill.user?.email || 'N/A',
          contact_number: firstBill.user?.contact_number || 'N/A',
          department: distinctRow.department || firstBill.user?.department || 'N/A',
          company: distinctRow.company || firstBill.user?.company || 'N/A',
          store: distinctRow.store || firstBill.user?.store || 'N/A'
        },
        approved_by: firstBill.approved_by,
        cancelled_by: firstBill.cancelled_by
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total || 0
    });
  } catch (err) {
    console.error('Get Superadmin Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

const getPdfbills = async (req, res) => {
  const pdfIdsParam = req.params.id; // can be "PDF123,PDF456"
  const { page = 1, limit = 25, sortBy = 'created_at', order = 'desc' } = req.query;

  try {
    // Step 1: Handle multiple pdf IDs like "PDF123,PDF456"
    const pdfIds = pdfIdsParam.split(',').map(id => id.trim());
    const placeholders = pdfIds.map(() => '?').join(',');

    // Step 2: Pagination setup
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Step 3: Main query (clean and valid)
    const sql = `
      SELECT 
        bills.invoice_date,
        bills.supplier_name,
        bills.supplier_gst,
        bills.total_amount,
        bills.head_of_accounts,
        bills.narration,
        bills.sent_to_admin_at,
        bills.created_at,
        bills.cost_code,
        bills.pdf_id,
        bills.sent_to_admin_at,
        approved_users.username AS approved_by_username,
        users.username,
        users.eid
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      WHERE bills.pdf_id IN (${placeholders})
      ORDER BY bills.${sortBy} ${order.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const params = [...pdfIds, parseInt(limit), offset];
    const [rows] = await pool.query(sql, params);

    // Step 4: Get total count for pagination
    const countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      WHERE pdf_id IN (${placeholders})
    `;
    const [countResult] = await pool.query(countSql, pdfIds);

    // Step 5: Format date fields
    const formattedRows = rows.map(row => ({
      ...row,
      invoice_date: row.invoice_date
        ? new Date(row.invoice_date).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })
        : null,
      created_at: row.created_at
        ? new Date(row.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })
        : null,
      sent_to_admin_at: row.sent_to_admin_at
        ? new Date(row.sent_to_admin_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })
        : null
    }));

    // Step 6: Send response
    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0]?.total || 0,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (err) {
    console.error('Get PDF Bills Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};

const getOpenandClosingBalance = async (req, res) => {
  const { pdfId } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT store_id, total_amount, approved_at, updated_balance FROM bills WHERE pdf_id = ? ORDER BY approved_at DESC',
      [pdfId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'PDF ID not found' });
    }

    // Identify latest and oldest
    const latest = rows[0];
    const oldest = rows[rows.length - 1];

    // Convert amounts
    const oldestTotal = parseFloat(oldest.total_amount) || 0;
    const oldestBalance = parseFloat(oldest.updated_balance) || 0;
    const latestBalance = parseFloat(latest.updated_balance) || 0;

    // Balances
    const openingBalance = oldestTotal + oldestBalance;
    const closingBalance = latestBalance;

    // Convert "23/10/2025 15:47:10" → "2025-10-23 15:47:10"
    const convertToMysqlTimestamp = (str) => {
      if (!str) return null;
      const [datePart, timePart] = str.split(' ');
      const [day, month, year] = datePart.split('/');
      return `${year}-${month}-${day} ${timePart}`;
    };

    const fromDate = convertToMysqlTimestamp(oldest.approved_at);
    const toDate = convertToMysqlTimestamp(latest.approved_at);

    // Fetch deposits within range
    const [depositRows] = await pool.query(
      'SELECT SUM(amount) AS total_deposits FROM deposites WHERE store_id = ? AND created_at BETWEEN ? AND ?',
      [oldest.store_id, fromDate, toDate]
    );

    const totalDeposits = parseFloat(depositRows[0]?.total_deposits) || 0;

    res.status(200).json({
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      from_date: oldest.approved_at,
      to_date: latest.approved_at,
      total_deposits: totalDeposits
    });

  } catch (err) {
    console.error('Get Open and Closing Balance Error:', err);
    res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
};


const CancelBillByUser = async (req, res) => {
  const { voucherNumber, userId } = req.body;
  const id = req.params.id;

  try {
    // ✅ Step 1: Verify bill exists and belongs to user
    const [bills] = await pool.query(
      `SELECT id FROM bills 
       WHERE voucher_reference_number = ? 
       AND is_cancelled = 0`,
      [voucherNumber]
    );

    if (bills.length === 0) {
      return res.status(404).json({
        message: 'Voucher number not found, already cancelled, or not authorized'
      });
    }

    // ✅ Step 2: Cancel ALL matching bills for that user
    const [result] = await pool.query(
      `UPDATE bills 
       SET is_cancelled = 1, cancelled_by = ?, is_bill_closed = 1, is_self_closed = 1 
       WHERE voucher_reference_number = ?`,
      [userId,voucherNumber]
    );

    res.status(200).json({
      message: `${result.affectedRows} bill(s) cancelled successfully`
    });

  } catch (err) {
    console.error('Cancel Bill By User Error:', err);
    res.status(500).json({
      message: 'Internal Server Error',
      error: err.message
    });
  }
};

const getStoresGeneralreports = async (req, res) => {
  const storeId = req.params.storeId;
  const { page = 1, limit = 25, sortBy = "created_at", order = "desc", search, ...filters } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (isNaN(pageNum) || pageNum < 1)
    return res.status(400).json({ message: "Page must be a positive integer" });

  if (isNaN(limitNum) || limitNum < 1)
    return res.status(400).json({ message: "Limit must be a positive integer" });

  if (!["asc", "desc"].includes(order.toLowerCase()))
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });

  try {
    const params = [];
    const countParams = [];

    let sql = `
      SELECT 
        bills.*,
        users.eid,
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
      WHERE bills.store_id = ?
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.store_id = ?
    `;

    params.push(storeId);
    countParams.push(storeId);

    /* 🔍 Search */
    if (search) {
      const searchTerm = `%${search}%`;
      const searchCondition = `
        AND (
          bills.voucher_reference_number LIKE ? OR
          bills.cost_code LIKE ? OR
          bills.pdf_id LIKE ? OR
          bills.supplier_name LIKE ? OR
          bills.nature_of_expense LIKE ? OR
          users.username LIKE ? OR
          users.eid LIKE ? OR
          approved_users.username LIKE ? OR
          stores.store_name LIKE ? OR
          companies.company_name LIKE ? OR
          departments.department LIKE ?
        )
      `;
      sql += searchCondition;
      countSql += searchCondition;

      params.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
      countParams.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
    }

    /* 🧾 Filters (unchanged logic) */
    const isValidDate = d => d && !isNaN(new Date(d).getTime());

    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;

      if (key === "payment_status") {
        if (value === "rejected") sql += ` AND bills.is_cancelled = 1`;
        if (value === "self_closed") sql += ` AND bills.is_self_closed = 1`;
        if (value === "sent_to_finance") sql += ` AND bills.sent_to_admin = 1`;
        if (value === "approved") sql += ` AND bills.is_approved = 1 AND bills.is_cancelled = 0`;
        if (value === "pending")
          sql += ` AND bills.is_approved = 0 AND bills.is_cancelled = 0 AND bills.is_self_closed = 0 AND bills.sent_to_admin = 0`;
        continue;
      }

      if (key === "billtype") {
        sql += ` AND bills.billtype = ?`;
        countSql += ` AND bills.billtype = ?`;
        params.push(value);
        countParams.push(value);
        continue;
      }

      if (["created_at", "invoice_date", "sent_to_admin_at"].includes(key)) {
        if (!value.includes("|"))
          return res.status(400).json({ message: "Invalid date range format" });

        const [from, to] = value.split("|");

        if (from && !isValidDate(from)) return res.status(400).json({ message: "Invalid start date" });
        if (to && !isValidDate(to)) return res.status(400).json({ message: "Invalid end date" });

        if (from) {
          sql += ` AND DATE(bills.${key}) >= ?`;
          countSql += ` AND DATE(bills.${key}) >= ?`;
          params.push(from);
          countParams.push(from);
        }
        if (to) {
          sql += ` AND DATE(bills.${key}) <= ?`;
          countSql += ` AND DATE(bills.${key}) <= ?`;
          params.push(to);
          countParams.push(to);
        }
        continue;
      }

      sql += ` AND bills.${key} LIKE ?`;
      countSql += ` AND bills.${key} LIKE ?`;
      params.push(`%${value}%`);
      countParams.push(`%${value}%`);
    }

    /* 🔃 Sorting */
    const offset = (pageNum - 1) * limitNum;
    sql += ` ORDER BY bills.created_at ${order.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    /* ▶ Execute */
    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    /* 🧾 Build Narration Dynamically */
    const formattedRows = rows.map(row => {
      const invoiceDate = row.invoice_date
        ? new Date(row.invoice_date).toISOString().split("T")[0]
        : null;

      let narration = `Being cash paid to ${row.supplier_name || "N/A"} towards ${row.nature_of_expense || "N/A"}`;

      if (invoiceDate) narration += ` on ${invoiceDate}`;
      if (row.invoice_reference_number) narration += ` with invoice no. ${row.invoice_reference_number}`;
      if (row.instructed_by) narration += `. Referred by ${row.instructed_by}`;

      return {
        ...row,
        narration, // ✅ overridden here
        invoice_date: invoiceDate,
        user: {
          id: row.user_id ?? null,
          eid: row.eid ?? "N/A",
          username: row.username ?? "Unknown",
          email: row.email ?? "N/A",
          contact_number: row.contact_number ?? "N/A",
          department: row.department ?? "N/A",
          company: row.company ?? "N/A",
          store: row.store_name ?? "N/A",
        },
        approved_by: row.approved_by
          ? { id: row.approved_by, username: row.approved_by_username ?? "N/A" }
          : null,
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(countResult[0].total / limitNum),
      limit: limitNum,
      message: formattedRows.length === 0 ? "No bills found" : undefined,
    });

  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
};


const getUsersGeneralreports = async (req, res) => {
  const userId = req.params.userId;
  const { page = 1, limit = 25, sortBy = "created_at", order = "desc", search, ...filters } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (isNaN(pageNum) || pageNum < 1)
    return res.status(400).json({ message: "Page must be a positive integer" });

  if (isNaN(limitNum) || limitNum < 1)
    return res.status(400).json({ message: "Limit must be a positive integer" });

  if (!["asc", "desc"].includes(order.toLowerCase()))
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });

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
      WHERE bills.user_id = ?
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.user_id = ?
    `;

    params.push(userId);
    countParams.push(userId);

    /* 🔍 Search */
    if (search) {
      const searchTerm = `%${search}%`;
      const searchCondition = `
        AND (
          bills.voucher_reference_number LIKE ? OR
          bills.cost_code LIKE ? OR
          bills.supplier_name LIKE ? OR
          bills.nature_of_expense LIKE ? OR
          users.username LIKE ? OR
          approved_users.username LIKE ? OR
          stores.store_name LIKE ? OR
          companies.company_name LIKE ?
        )
      `;
      sql += searchCondition;
      countSql += searchCondition;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    /* 🎯 Filters */
    const filterableColumns = {
      payment_status: "payment_status",
      billtype: "bills.billtype",
      cost_code: "bills.cost_code",
      voucher_reference_number: "bills.voucher_reference_number",
      voucher_date: "bills.voucher_date",
      created_at: "bills.created_at",
      total_amount: "bills.total_amount",
      taxable_amount: "bills.taxable_amount",
      cgst_percent: "bills.cgst_percent",
      sgst_percent: "bills.sgst_percent",
      igst_percent: "bills.igst_percent",
      cgst: "bills.cgst",
      sgst: "bills.sgst",
      igst: "bills.igst",
      supplier_name: "bills.supplier_name",
      instructed_by: "bills.instructed_by",
      invoice_date: "bills.invoice_date",
      invoice_reference_number: "bills.invoice_reference_number",
      rounding_off: "bills.rounding_off",
      nature_of_expense: "bills.nature_of_expense",
      head_of_accounts: "bills.head_of_accounts",
      "user.company": "companies.company_name",
      "user.store": "stores.store_name",
      "user.department": "departments.department",
    };

    const isValidDate = d => d && !isNaN(new Date(d).getTime());

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === "") continue;

      if (key === "payment_status") {
        if (value === "rejected") sql += ` AND bills.is_cancelled = 1`;
        if (value === "self_closed") sql += ` AND bills.is_self_closed = 1`;
        if (value === "sent_to_finance") sql += ` AND bills.sent_to_admin = 1`;
        if (value === "approved") sql += ` AND bills.is_approved = 1 AND bills.is_cancelled = 0`;
        if (value === "pending")
          sql += ` AND bills.is_approved = 0 AND bills.is_cancelled = 0 AND bills.is_self_closed = 0 AND bills.sent_to_admin = 0`;
        continue;
      }

      if (key === "billtype") {
        sql += ` AND ${filterableColumns[key]} = ?`;
        params.push(value);
        countSql += ` AND ${filterableColumns[key]} = ?`;
        countParams.push(value);
        continue;
      }

      if (["created_at", "invoice_date", "voucher_date"].includes(key)) {
        if (!value.includes("|"))
          return res.status(400).json({ message: `Invalid date format for ${key}` });

        const [from, to] = value.split("|");

        if (from && !isValidDate(from)) return res.status(400).json({ message: `Invalid start date` });
        if (to && !isValidDate(to)) return res.status(400).json({ message: `Invalid end date` });

        if (from) {
          sql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          params.push(from);
          countParams.push(from);
        }
        if (to) {
          sql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          params.push(to);
          countParams.push(to);
        }
        continue;
      }

      sql += ` AND ${filterableColumns[key]} LIKE ?`;
      countSql += ` AND ${filterableColumns[key]} LIKE ?`;
      params.push(`%${value}%`);
      countParams.push(`%${value}%`);
    }

    /* 🔃 Sorting */
    if (!filterableColumns[sortBy])
      return res.status(400).json({ message: `Invalid sortBy: ${sortBy}` });

    sql += ` ORDER BY ${filterableColumns[sortBy]} ${order.toUpperCase()}`;

    /* 📄 Pagination */
    const offset = (pageNum - 1) * limitNum;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    /* ▶ Execute */
    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    /* 🧾 Build narration here */
    const formattedRows = rows.map(row => {
      const invoiceDate = row.invoice_date
        ? new Date(row.invoice_date).toISOString().split("T")[0]
        : null;

      let narration = `Being cash paid to ${row.supplier_name || "N/A"} towards ${row.nature_of_expense || "N/A"}`;

      if (invoiceDate) narration += ` on ${invoiceDate}`;
      if (row.invoice_reference_number) narration += ` with invoice no. ${row.invoice_reference_number}`;
      if (row.instructed_by) narration += `. Referred by ${row.instructed_by}`;

      return {
        ...row,
        narration, // ✅ dynamically built
        invoice_date: invoiceDate,
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
          department: row.department,
          company: row.company,
          store: row.store_name,
        },
        approved_by: row.approved_by
          ? { id: row.approved_by, username: row.approved_by_username }
          : null,
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
    console.error("Database Error:", err);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
};


const getCompanyGeneralreports = async (req, res) => {
  const CompanyId = req.params.cid;
  const { page = 1, limit = 25, sortBy = "created_at", order = "desc", search, ...filters } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (isNaN(pageNum) || pageNum < 1)
    return res.status(400).json({ message: "Page must be a positive integer" });

  if (isNaN(limitNum) || limitNum < 1)
    return res.status(400).json({ message: "Limit must be a positive integer" });

  if (!["asc", "desc"].includes(order.toLowerCase()))
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });

  try {
    const params = [];
    const countParams = [];

    let sql = `
      SELECT 
        bills.*,
        users.eid,
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
      WHERE bills.cid = ?
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE bills.cid = ?
    `;

    params.push(CompanyId);
    countParams.push(CompanyId);

    /* 🔍 Search */
    if (search) {
      const searchTerm = `%${search}%`;
      const searchCondition = `
        AND (
          bills.voucher_reference_number LIKE ? OR
          bills.cost_code LIKE ? OR
          bills.pdf_id LIKE ? OR
          bills.supplier_name LIKE ? OR
          bills.nature_of_expense LIKE ? OR
          users.username LIKE ? OR
          users.eid LIKE ? OR
          approved_users.username LIKE ? OR
          stores.store_name LIKE ? OR
          companies.company_name LIKE ? OR
          departments.department LIKE ?
        )
      `;
      sql += searchCondition;
      countSql += searchCondition;

      params.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
      countParams.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
    }

    /* 🎯 Filters */
    const filterableColumns = {
      payment_status: "payment_status",
      billtype: "bills.billtype",
      pdf_id: "bills.pdf_id",
      cost_code: "bills.cost_code",
      voucher_reference_number: "bills.voucher_reference_number",
      voucher_date: "bills.voucher_date",
      created_at: "bills.created_at",
      total_amount: "bills.total_amount",
      taxable_amount: "bills.taxable_amount",
      cgst_percent: "bills.cgst_percent",
      sgst_percent: "bills.sgst_percent",
      igst_percent: "bills.igst_percent",
      cgst: "bills.cgst",
      sgst: "bills.sgst",
      igst: "bills.igst",
      supplier_name: "bills.supplier_name",
      instructed_by: "bills.instructed_by",
      sent_to_admin_at: "bills.sent_to_admin_at",
      invoice_date: "bills.invoice_date",
      invoice_reference_number: "bills.invoice_reference_number",
      rounding_off: "bills.rounding_off",
      nature_of_expense: "bills.nature_of_expense",
      head_of_accounts: "bills.head_of_accounts",
      eid: "users.eid",
      username: "users.username",
      "user.company": "companies.company_name",
      store: "stores.store_name",
      department: "departments.department",
    };

    const isValidDate = d => d && !isNaN(new Date(d).getTime());

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === "") continue;

      if (key === "payment_status") {
        if (value === "rejected") sql += ` AND bills.is_cancelled = 1`;
        if (value === "self_closed") sql += ` AND bills.is_self_closed = 1`;
        if (value === "sent_to_finance") sql += ` AND bills.sent_to_admin = 1`;
        if (value === "approved") sql += ` AND bills.is_approved = 1 AND bills.is_cancelled = 0`;
        if (value === "pending")
          sql += ` AND bills.is_approved = 0 AND bills.is_cancelled = 0 AND bills.is_self_closed = 0 AND bills.sent_to_admin = 0`;
        continue;
      }

      if (["created_at", "invoice_date", "sent_to_admin_at"].includes(key)) {
        if (!value.includes("|")) return res.status(400).json({ message: "Invalid date range format" });
        const [from, to] = value.split("|");

        if (from && !isValidDate(from)) return res.status(400).json({ message: "Invalid start date" });
        if (to && !isValidDate(to)) return res.status(400).json({ message: "Invalid end date" });

        if (from) {
          sql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          params.push(from);
          countParams.push(from);
        }
        if (to) {
          sql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          params.push(to);
          countParams.push(to);
        }
        continue;
      }

      sql += ` AND ${filterableColumns[key]} LIKE ?`;
      countSql += ` AND ${filterableColumns[key]} LIKE ?`;
      params.push(`%${value}%`);
      countParams.push(`%${value}%`);
    }

    /* 🔃 Sorting */
    if (!filterableColumns[sortBy])
      return res.status(400).json({ message: `Invalid sortBy: ${sortBy}` });

    sql += ` ORDER BY ${filterableColumns[sortBy]} ${order.toUpperCase()}`;

    /* 📄 Pagination */
    const offset = (pageNum - 1) * limitNum;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    /* ▶ Execute */
    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    /* 🧾 Build narration dynamically */
    const formattedRows = rows.map(row => {
      const invoiceDate = row.invoice_date
        ? new Date(row.invoice_date).toISOString().split("T")[0]
        : null;

      let narration = `Being cash paid to ${row.supplier_name || "N/A"} towards ${row.nature_of_expense || "N/A"}`;

      if (invoiceDate) narration += ` on ${invoiceDate}`;
      if (row.invoice_reference_number) narration += ` with invoice no. ${row.invoice_reference_number}`;
      if (row.instructed_by) narration += `. Referred by ${row.instructed_by}`;

      return {
        ...row,
        narration, // ✅ overridden narration
        invoice_date: invoiceDate,
        user: {
          id: row.user_id ?? null,
          eid: row.eid ?? "N/A",
          username: row.username ?? "Unknown",
          email: row.email ?? "N/A",
          contact_number: row.contact_number ?? "N/A",
          department: row.department ?? "N/A",
          company: row.company ?? "N/A",
          store: row.store_name ?? "N/A",
        },
        approved_by: row.approved_by
          ? { id: row.approved_by, username: row.approved_by_username ?? "N/A" }
          : null,
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(countResult[0].total / limitNum),
      limit: limitNum,
      message: formattedRows.length === 0 ? "No bills found" : undefined,
    });

  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
};


const getSuperAdminGeneralreports = async (req, res) => {
  const { page = 1, limit = 25, sortBy = "created_at", order = "desc", search, ...filters } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (isNaN(pageNum) || pageNum < 1)
    return res.status(400).json({ message: "Page must be a positive integer" });

  if (isNaN(limitNum) || limitNum < 1)
    return res.status(400).json({ message: "Limit must be a positive integer" });

  if (!["asc", "desc"].includes(order.toLowerCase()))
    return res.status(400).json({ message: 'Order must be "asc" or "desc"' });

  try {
    const params = [];
    const countParams = [];

    let sql = `
      SELECT 
        bills.*,
        users.eid,
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
      WHERE 1=1
    `;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM bills
      JOIN users ON bills.user_id = users.id
      LEFT JOIN users AS approved_users ON bills.approved_by = approved_users.id
      LEFT JOIN stores ON bills.cost_code = stores.store_id
      LEFT JOIN departments ON users.did = departments.id
      LEFT JOIN companies ON users.cid = companies.id
      WHERE 1=1
    `;

    /* 🔍 Search */
    if (search) {
      const searchTerm = `%${search}%`;
      const searchCondition = `
        AND (
          bills.voucher_reference_number LIKE ? OR
          bills.pdf_id LIKE ? OR
          bills.cost_code LIKE ? OR
          bills.supplier_name LIKE ? OR
          bills.nature_of_expense LIKE ? OR
          users.username LIKE ? OR
          users.eid LIKE ? OR
          approved_users.username LIKE ? OR
          stores.store_name LIKE ? OR
          companies.company_name LIKE ? OR
          departments.department LIKE ?
        )
      `;
      sql += searchCondition;
      countSql += searchCondition;

      params.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
      countParams.push(
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm, searchTerm,
        searchTerm, searchTerm, searchTerm
      );
    }

    /* 🎯 Filters */
    const filterableColumns = {
      payment_status: "payment_status",
      billtype: "bills.billtype",
      pdf_id: "bills.pdf_id",
      cost_code: "bills.cost_code",
      voucher_reference_number: "bills.voucher_reference_number",
      voucher_date: "bills.voucher_date",
      created_at: "bills.created_at",
      sent_to_admin_at: "bills.sent_to_admin_at",
      total_amount: "bills.total_amount",
      taxable_amount: "bills.taxable_amount",
      cgst_percent: "bills.cgst_percent",
      sgst_percent: "bills.sgst_percent",
      igst_percent: "bills.igst_percent",
      cgst: "bills.cgst",
      sgst: "bills.sgst",
      igst: "bills.igst",
      supplier_name: "bills.supplier_name",
      instructed_by: "bills.instructed_by",
      invoice_date: "bills.invoice_date",
      invoice_reference_number: "bills.invoice_reference_number",
      rounding_off: "bills.rounding_off",
      nature_of_expense: "bills.nature_of_expense",
      head_of_accounts: "bills.head_of_accounts",
      eid: "users.eid",
      username: "users.username",
      company: "companies.company_name",
      store: "stores.store_name",
      department: "departments.department",
    };

    const isValidDate = d => d && !isNaN(new Date(d).getTime());

    for (const [key, value] of Object.entries(filters)) {
      if (!filterableColumns[key] || value === "") continue;

      if (key === "payment_status") {
        if (value === "rejected") sql += ` AND bills.is_cancelled = 1`;
        if (value === "self_closed") sql += ` AND bills.is_self_closed = 1`;
        if (value === "sent_to_finance") sql += ` AND bills.sent_to_admin = 1`;
        if (value === "approved") sql += ` AND bills.is_approved = 1 AND bills.is_cancelled = 0`;
        if (value === "pending")
          sql += ` AND bills.is_approved = 0 AND bills.is_cancelled = 0 AND bills.is_self_closed = 0 AND bills.sent_to_admin = 0`;
        continue;
      }

      if (["created_at", "invoice_date", "sent_to_admin_at"].includes(key)) {
        if (!value.includes("|")) return res.status(400).json({ message: "Invalid date range format" });
        const [from, to] = value.split("|");

        if (from && !isValidDate(from)) return res.status(400).json({ message: "Invalid start date" });
        if (to && !isValidDate(to)) return res.status(400).json({ message: "Invalid end date" });

        if (from) {
          sql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) >= ?`;
          params.push(from);
          countParams.push(from);
        }
        if (to) {
          sql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          countSql += ` AND DATE(${filterableColumns[key]}) <= ?`;
          params.push(to);
          countParams.push(to);
        }
        continue;
      }

      sql += ` AND ${filterableColumns[key]} LIKE ?`;
      countSql += ` AND ${filterableColumns[key]} LIKE ?`;
      params.push(`%${value}%`);
      countParams.push(`%${value}%`);
    }

    /* 🔃 Sorting */
    if (!filterableColumns[sortBy])
      return res.status(400).json({ message: `Invalid sortBy parameter: ${sortBy}` });

    sql += ` ORDER BY ${filterableColumns[sortBy]} ${order.toUpperCase()}`;

    /* 📄 Pagination */
    const offset = (pageNum - 1) * limitNum;
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    /* ▶ Execute */
    const [rows] = await pool.query(sql, params);
    const [countResult] = await pool.query(countSql, countParams);

    /* 🧾 Build narration dynamically */
    const formattedRows = rows.map(row => {
      const invoiceDate = row.invoice_date
        ? new Date(row.invoice_date).toISOString().split("T")[0]
        : null;

      let narration = `Being cash paid to ${row.supplier_name || "N/A"} towards ${row.nature_of_expense || "N/A"}`;

      if (invoiceDate) narration += ` on ${invoiceDate}`;
      if (row.invoice_reference_number) narration += ` with invoice no. ${row.invoice_reference_number}`;
      if (row.instructed_by) narration += `. Referred by ${row.instructed_by}`;

      return {
        ...row,
        narration, // ✅ overridden
        invoice_date: invoiceDate,
        user: {
          id: row.user_id ?? null,
          eid: row.eid ?? "N/A",
          username: row.username ?? "Unknown",
          email: row.email ?? "N/A",
          contact_number: row.contact_number ?? "N/A",
          department: row.department ?? "N/A",
          company: row.company ?? "N/A",
          store: row.store_name ?? "N/A",
        },
        approved_by: row.approved_by
          ? { id: row.approved_by, username: row.approved_by_username ?? "N/A" }
          : null,
      };
    });

    res.status(200).json({
      bills: formattedRows,
      totalCount: countResult[0].total,
      currentPage: pageNum,
      totalPages: Math.ceil(countResult[0].total / limitNum),
      limit: limitNum,
      message: formattedRows.length === 0 ? "No bills found" : undefined,
    });

  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
  }
};


const createNewBill = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      billtype,
      user_id,
      cid,
      did,
      store_id,
      cost_code,
      voucher_date,
      narration,
      items,
      voucher_reference_number
    } = req.body;

    // Common validation
    if (!billtype || !user_id || !cost_code || !voucher_date || !items || !voucher_reference_number || !Array.isArray(items) || items.length === 0) {
      throw new Error('Missing required fields: billtype, user_id, cost_code, voucher_date, voucher refernce number ,or items array');
    }

    const validBillTypes = ['gst', 'non gst', 'advance'];
    if (!validBillTypes.includes(billtype)) {
      throw new Error('Invalid billtype. Must be "gst", "non gst", or "advance"');
    }


    let voucherNumber = req.body.voucher_reference_number;
    

    // Process each item
    for (const item of items) {
      const {
        supplier_name,
        nature_of_expense,
        head_of_accounts,
        instructed_by,
        amount,
        remarks,
        invoice_date,
        invoice_reference_number,
        supplier_gst,
        taxable_amount,
        igst_percent,
        cgst_percent,
        sgst_percent,
        igst,
        cgst,
        sgst,
        rounding_off
      } = item;

      // Common required fields for all types
      if (!supplier_name || !nature_of_expense || !head_of_accounts || !instructed_by || !amount) {
        throw new Error('Each item must have: supplier_name, nature_of_expense, head_of_accounts, instructed_by, amount');
      }

      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error('Amount must be a valid positive number');
      }

      // GST-specific validation
      if (billtype === 'gst') {
        if (!supplier_gst || !taxable_amount || !invoice_date || !invoice_reference_number) {
          throw new Error('GST bills require: supplier_gst, taxable_amount, invoice_date, invoice_reference_number');
        }

        if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(supplier_gst)) {
          throw new Error('Invalid GSTIN format');
        }

        const hasIgst = igst_percent > 0 && igst >= 0;
        const hasCgstSgst = cgst_percent > 0 && sgst_percent > 0 && cgst >= 0 && sgst >= 0;

        if (!hasIgst && !hasCgstSgst) {
          throw new Error('GST bill must have either IGST or CGST+SGST with amounts');
        }
      }

      // Advance-specific: no invoice or GST fields allowed
      if (billtype === 'advance') {
        if (invoice_date || invoice_reference_number || supplier_gst || taxable_amount ||
            igst_percent || cgst_percent || sgst_percent || igst || cgst || sgst || rounding_off) {
          throw new Error('Advance bills cannot include invoice or GST-related fields');
        }
      }

      // Insert bill row
      const sql = `
        INSERT INTO bills (
          billtype, user_id, cid, store_id, did, cost_code, voucher_date, voucher_reference_number,
          invoice_date, invoice_reference_number, supplier_name, supplier_gst,
          nature_of_expense, head_of_accounts, instructed_by,
          taxable_amount, cgst_percent, sgst_percent, igst_percent,
          cgst, sgst, igst, rounding_off, total_amount,
          narration, approved_by, is_cancelled, sent_to_admin, sent_to_tally, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        billtype === 'non gst' ? 'non gst' : billtype,
        user_id,
        cid || null,
        store_id || null,
        did || null,
        cost_code,
        voucher_date,
        voucherNumber,
        billtype === 'advance' ? null : invoice_date || null,
        billtype === 'advance' ? null : invoice_reference_number || null,
        supplier_name,
        billtype === 'gst' ? supplier_gst : null,
        nature_of_expense,
        head_of_accounts,
        instructed_by,
        billtype === 'gst' ? taxable_amount : null,
        billtype === 'gst' ? cgst_percent || null : null,
        billtype === 'gst' ? sgst_percent || null : null,
        billtype === 'gst' ? igst_percent || null : null,
        billtype === 'gst' ? cgst || null : null,
        billtype === 'gst' ? sgst || null : null,
        billtype === 'gst' ? igst || null : null,
        billtype === 'gst' ? rounding_off || null : null,
        parseFloat(amount).toFixed(2),
        narration || null,
        null, // approved_by
        false,
        false,
        false,
        remarks || null
      ];

      await connection.execute(sql, values);
    }

    // Fetch company and department names
    const [userRows] = await connection.query('SELECT cid, did FROM users WHERE id = ?', [user_id]);
    if (userRows.length === 0) throw new Error('User not found');

    const { cid: companyId, did: departmentId } = userRows[0];

    const [deptRows] = await connection.query('SELECT department FROM departments WHERE id = ?', [departmentId]);
    const department = deptRows[0]?.department || 'Unknown Department';

    const [compRows] = await connection.query('SELECT company_name FROM companies WHERE id = ?', [companyId]);
    const company = compRows[0]?.company_name || 'Unknown Company';

    await connection.commit();

    res.status(201).json({
      message: 'Voucher created successfully',
      voucher_reference_number: voucherNumber,
      company,
      department,
      billtype,
      total_amount: items.reduce((sum, i) => sum + parseFloat(i.amount), 0).toFixed(2)
    });

  } catch (err) {
    await connection.rollback();
    console.error('Create Bill Batch Error:', err);
    res.status(err.message.includes('Missing') || err.message.includes('Invalid') ? 400 : 500).json({
      message: err.message || 'Internal Server Error'
    });
  } finally {
    connection.release();
  }
};


module.exports = { createBillBatch, getAllBills, getUserbills, getStorebills,
                   ApproveBill, getSinglebill, updateBill, cancelBill,
                   sendBillsToAdmin, getAdminBills, sendBillsToTally,
                   getCompanyBills, getSuperadminBills, getPdfbills,
                   getOpenandClosingBalance, generateCancelOtp,
                   CancelBillByUser, getStoresGeneralreports, getUsersGeneralreports,
                   getCompanyGeneralreports , createNewBill, getBillsByVoucher, updateBatchForCancelledBills,
                   getSuperAdminGeneralreports};  