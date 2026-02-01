const pool = require('../connections/connections');

const getsuperAdminstatCounts = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query(`
      SELECT 
        -- Company & Store counts
        (SELECT COUNT(*) FROM companies) AS companies_count,
        (SELECT COUNT(*) FROM stores) AS stores_count,

        -- Total available cash across all stores
        (
          SELECT COALESCE(SUM(sa.available_cash), 0)
          FROM stores_amount sa
        ) AS stores_amount,

        -- Bills sent to admin
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills 
         WHERE sent_to_admin = 1) AS bills_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills 
         WHERE sent_to_admin = 1) AS bills_amount,

        -- Bills sent to tally
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills 
         WHERE sent_to_tally = 1) AS sent_to_tally_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills 
         WHERE sent_to_tally = 1) AS sent_to_tally_amount,

        -- Pending to send to tally
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills 
         WHERE sent_to_admin = 1 AND sent_to_tally = 0) AS pending_to_send_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills 
         WHERE sent_to_admin = 1 AND sent_to_tally = 0) AS pending_to_send_amount,

        -- Cancelled bills
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills 
         WHERE is_cancelled = 1) AS cancelled_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills 
         WHERE is_cancelled = 1) AS cancelled_amount,

        -- Pending approval (not sent to admin)
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills 
         WHERE sent_to_admin = 0) AS pending_approval_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills 
         WHERE sent_to_admin = 0) AS pending_approval_amount,

        -- Total bills (for percentages / analytics)
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills) AS total_bills_count,
        (SELECT COALESCE(SUM(total_amount), 0) 
         FROM bills) AS total_bills_amount
    `);

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching super admin stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};


const getAdminstatCounts = async (req, res) => {
  const cid = req.params.cid;
  let connection;
  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query(
      `
      SELECT 
        -- Company and store counts
        (SELECT COUNT(*) FROM companies WHERE id = ?) AS companies_count,
        (SELECT COUNT(*) FROM stores WHERE company_id = ?) AS stores_count,
        
        -- Sum of available cash for all stores of this company
        (
          SELECT COALESCE(SUM(sa.available_cash), 0) 
          FROM stores_amount sa 
          WHERE sa.store_id IN (
            SELECT id FROM stores WHERE company_id = ?
          )
        ) AS stores_amount,
        
        -- Bills sent to admin (count and amount)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE sent_to_admin = 1 AND cid = ?) AS bills_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE sent_to_admin = 1 AND cid = ?) AS bills_amount,
        
        -- Bills sent to tally (count and amount)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE sent_to_tally = 1 AND cid = ?) AS sent_to_tally_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE sent_to_tally = 1 AND cid = ?) AS sent_to_tally_amount,
        
        -- Pending to send (count and amount)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE sent_to_tally = 0 AND sent_to_admin = 1 AND cid = ?) AS pending_to_send_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE sent_to_tally = 0 AND sent_to_admin = 1 AND cid = ?) AS pending_to_send_amount,
        
        -- Cancelled bills (count and amount)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE is_cancelled = 1 AND cid = ?) AS cancelled_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE is_cancelled = 1 AND cid = ?) AS cancelled_amount,
        
        -- Pending approval bills (assuming sent_to_admin = 0 means pending)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE sent_to_admin = 0 AND cid = ?) AS pending_approval_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE sent_to_admin = 0 AND cid = ?) AS pending_approval_amount,
        
        -- All bills total (for percentage calculations)
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills WHERE cid = ?) AS total_bills_count,
        (SELECT COALESCE(SUM(total_amount), 0) FROM bills WHERE cid = ?) AS total_bills_amount
      `,
      [
        cid, cid,                       // companies_count, stores_count
        cid,                            // stores_amount (store_id subquery)
        cid, cid,                       // bills_count, bills_amount
        cid, cid,                       // sent_to_tally_count, sent_to_tally_amount
        cid, cid,                       // pending_to_send_count, pending_to_send_amount
        cid, cid,                       // cancelled_count, cancelled_amount
        cid, cid,                       // pending_approval_count, pending_approval_amount
        cid, cid                        // total_bills_count, total_bills_amount
      ]
    );
  
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (connection) connection.release();
  }
};

const getspendsandcredits = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT
        (SELECT SUM(total_amount) FROM bills WHERE is_cancelled = 0) AS total_spends,
        (SELECT SUM(amount) FROM deposites) AS total_credits
    `);
    res.status(200).json(rows[0]);
  } catch (err) {
    console.log('Error in getspendsandcredits query:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

const getStorenames = async (req, res) => {
  try {
    const [result] = await pool.query('SELECT * FROM stores');
    res.status(200).send(result);
  } catch (err) {
    console.log('Error in getStorenames query:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const getStoresOverview = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query(`
      SELECT 
        s.id,
        s.store_name,
        s.state,
        s.city,

        -- Counts based on unique vouchers
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills b WHERE b.store_id = s.id) AS total_bills,
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 1 AND is_cancelled = 0) AS approved_bills,
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 0 AND is_cancelled = 0) AS pending_bills,
        (SELECT COUNT(DISTINCT voucher_reference_number) FROM bills b WHERE b.store_id = s.id AND b.is_cancelled = 1 AND is_self_closed = 0) AS cancelled_bills,

        -- Amounts summed across all rows (not unique vouchers)
        (SELECT SUM(total_amount) FROM bills b WHERE b.store_id = s.id) AS total_spends,
        (SELECT SUM(total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 1 AND is_cancelled = 0) AS total_approved_spend,
        (SELECT SUM(total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 0 AND is_cancelled = 0) AS total_pending_spend,
        (SELECT SUM(total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_cancelled = 1 AND is_self_closed = 0) AS total_cancelled_spend,

        (SELECT SUM(amount) FROM deposites d WHERE d.store_id = s.id) AS total_credits,
        (SELECT sa.available_cash FROM stores_amount sa WHERE sa.store_id = s.id) AS available_cash

      FROM stores s
    `);

    const formattedRows = rows.map(row => ({
      id: row.id,
      store_name: row.store_name,
      state: row.state,
      city: row.city,

      total_bills: Number(row.total_bills) || 0,
      approved_bills: Number(row.approved_bills) || 0,
      pending_bills: Number(row.pending_bills) || 0,
      cancelled_bills: Number(row.cancelled_bills) || 0,

      total_spends: Number(row.total_spends) || 0,
      total_approved_spend: Number(row.total_approved_spend) || 0,
      total_pending_spend: Number(row.total_pending_spend) || 0,
      total_cancelled_spend: Number(row.total_cancelled_spend) || 0,

      total_credits: Number(row.total_credits) || 0,
      available_cash: Number(row.available_cash) || 0
    }));

    res.status(200).json(formattedRows);
  } catch (err) {
    console.error('Error in getStoresOverview query:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

const getAdminStoresOverview = async (req, res) => {
  const { cid } = req.params;
  if (!cid) {
    return res.status(400).json({ message: 'Company ID (cid) is required' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(
      `
      SELECT 
        s.id,
        s.store_name,
        s.state,
        s.city,

        -- Counts using unique voucher_reference_number
        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills b WHERE b.store_id = s.id AND b.is_self_closed = 0) AS total_bills,

        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills b WHERE b.store_id = s.id AND b.is_approved = 1 AND is_cancelled = 0) AS approved_bills,

        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills b WHERE b.store_id = s.id AND b.is_approved = 0 AND is_cancelled = 0) AS pending_bills,

        (SELECT COUNT(DISTINCT voucher_reference_number) 
         FROM bills b WHERE b.store_id = s.id AND b.is_cancelled = 1 AND is_self_closed = 0) AS cancelled_bills,

        -- Amounts summed across all rows
        (SELECT SUM(b.total_amount) FROM bills b WHERE b.store_id = s.id AND is_self_closed = 0) AS total_spends,
        (SELECT SUM(b.total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 1 AND is_cancelled = 0) AS total_approved_spend,
        (SELECT SUM(b.total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_approved = 0 AND is_cancelled = 0) AS total_pending_spend,
        (SELECT SUM(b.total_amount) FROM bills b WHERE b.store_id = s.id AND b.is_cancelled = 1 AND is_self_closed = 0) AS total_cancelled_spend,

        (SELECT SUM(d.amount) FROM deposites d WHERE d.store_id = s.id) AS total_credits,
        (SELECT sa.available_cash FROM stores_amount sa WHERE sa.store_id = s.id) AS available_cash

      FROM stores s
      WHERE s.company_id = ?
      `,
      [cid]
    );

    const formattedRows = rows.map(row => ({
      id: row.id,
      store_name: row.store_name,
      state: row.state,
      city: row.city,
      total_bills: Number(row.total_bills) || 0,
      approved_bills: Number(row.approved_bills) || 0,
      pending_bills: Number(row.pending_bills) || 0,
      cancelled_bills: Number(row.cancelled_bills) || 0,
      total_spends: Number(Number(row.total_spends || 0).toFixed(2)),
      total_approved_spend: Number(Number(row.total_approved_spend || 0).toFixed(2)),
      total_pending_spend: Number(Number(row.total_pending_spend || 0).toFixed(2)),
      total_cancelled_spend: Number(Number(row.total_cancelled_spend || 0).toFixed(2)),
      total_credits: Number(Number(row.total_credits || 0).toFixed(2)),
      available_cash: Number(Number(row.available_cash || 0).toFixed(2)),
    }));

    res.status(200).json(formattedRows);
  } catch (err) {
    console.error('Error in getAdminStoresOverview query:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    if (connection) connection.release();
  }
};


const getStoreDetails = async (req, res) => {
  const { storeId } = req.params;
  const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

  try {
    const [store] = await pool.query('SELECT * FROM stores WHERE id = ?', [storeId]);
    if (store.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const { id, store_name: name } = store[0];

    const [cashiers] = await pool.query(
      'SELECT user_id FROM cashier WHERE store_id = ? AND isactivate = 1',
      [storeId]
    );
    const activeUserIds = cashiers.map(c => c.user_id);

    if (activeUserIds.length === 0) {
      return res.status(404).json({ message: 'No active cashiers found for this store' });
    }

    const [userRows] = await pool.query(
      `SELECT username FROM users WHERE id IN (${activeUserIds.map(() => '?').join(',')})`,
      activeUserIds
    );

    const cashiersList = userRows.map(user => user.username);

    // Get total spend with 2 decimal places
    const [[{ totalSpend }]] = await pool.query(
      'SELECT ROUND(SUM(total_amount), 2) AS totalSpend FROM bills WHERE store_id = ? AND is_self_closed = 0',
      [storeId]
    );

    // Get credits with 2 decimal places
    const [[{ Credits }]] = await pool.query(
      'SELECT ROUND(SUM(amount), 2) AS Credits FROM deposites WHERE store_id = ?',
      [storeId]
    );

    // Get cash with 2 decimal places
    const [[{ cash }]] = await pool.query(
      'SELECT ROUND(available_cash, 2) AS cash FROM stores_amount WHERE store_id = ?',
      [storeId]
    );

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Get monthly spend with 2 decimal places
    const [spendRows] = await pool.query(
      `SELECT MONTH(created_at) AS month, ROUND(SUM(total_amount), 2) AS total 
       FROM bills 
       WHERE store_id = ? AND YEAR(created_at) = ? AND is_self_closed = 0
       GROUP BY MONTH(created_at)`,
      [storeId, year]
    );

    const monthlyDebitsChart = monthNames.map((name, index) => {
      const row = spendRows.find(r => r.month === index + 1);
      return { name, value: row ? parseFloat(row.total) : 0.00 };
    });

    // Get monthly credits with 2 decimal places
    const [creditRows] = await pool.query(
      `SELECT MONTH(created_at) AS month, ROUND(SUM(amount), 2) AS total 
       FROM deposites 
       WHERE store_id = ? AND YEAR(created_at) = ?
       GROUP BY MONTH(created_at)`,
      [storeId, year]
    );

    const monthlyCreditsChart = monthNames.map((name, index) => {
      const row = creditRows.find(r => r.month === index + 1);
      return { name, value: row ? parseFloat(row.total) : 0.00 };
    });

    const StoreData = {
      id,
      name,
      cashier: cashiersList,
      availableCash: parseFloat(cash) || 0.00,
      totalSpend: parseFloat(totalSpend) || 0.00,
      totalCredit: parseFloat(Credits) || 0.00,
      monthlycreditschart: monthlyCreditsChart,
      monthlydebitschart: monthlyDebitsChart
    };

    res.status(200).json(StoreData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const getRecentBills = async (req, res) => {
  try {
    const sql = `
      SELECT 
        b.id,
        b.voucher_reference_number,
        b.created_at,
        b.supplier_name,
        b.sent_to_tally,
        b.total_amount,
        s.store_name AS store
      FROM bills b
      LEFT JOIN stores s ON b.cost_code = s.store_id
      WHERE b.sent_to_admin = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(sql, [1]);

    const recentBills = rows.map(row => ({
      id: row.id,
      voucherNumber: row.voucher_reference_number,
      voucherDate: row.created_at.toISOString().split('T')[0],
      storeName: row.store || '-',
      payTo: row.supplier_name,
      status: row.sent_to_tally === 1 ? 'Approved' : 'Pending',
      amount: row.total_amount
    }));

    res.status(200).json(recentBills);
  } catch (err) {
    console.error("Error getting recent bills:", err);
    res.status(500).json({ error: 'Failed to retrieve recent bills' });
  }
};

const getAdminRecentBills = async (req, res) => {
  const { cid } = req.params;
  if (!cid) {
    return res.status(400).json({ message: 'Company ID (cid) is required' });
  }
  try {
    const sql = `
      SELECT 
        b.id,
        b.voucher_reference_number,
        b.created_at,
        b.supplier_name,
        b.sent_to_tally,
        b.total_amount,
        s.store_name AS store_name
      FROM bills b
      LEFT JOIN stores s ON b.cost_code = s.store_id
      WHERE b.cid = ? AND b.sent_to_admin = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(sql, [cid, 1]);

    const recentBills = rows.map(row => ({
      id: row.id,
      voucherNumber: row.voucher_reference_number,
      voucherDate: row.created_at
        ? row.created_at.toISOString().split('T')[0]
        : null,
      storeName: row.store_name || '-',
      payTo: row.supplier_name,
      status: row.sent_to_tally === 1 ? 'Approved' : 'Pending',
      amount: row.total_amount,
    }));

    res.status(200).json(recentBills);
  } catch (err) {
    console.error('Error getting recent bills:', err);
    res.status(500).json({ error: 'Failed to retrieve recent bills' });
  }
};

// NEW: Nature of Expenses by Store
const getNatureExpensesByStore = async (req, res) => {
  const { storeId } = req.params;
  const { month, year } = req.query; // e.g., month="03", year="2024"

  // Validate required params
  if (!storeId || !month) {
    return res.status(400).json({ message: 'storeId and month are required' });
  }

  // Optional year: default to current year if not provided
  const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
  if (isNaN(selectedYear) || selectedYear < 2000 || selectedYear > 2100) {
    return res.status(400).json({ message: 'Invalid year' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(
      `
      SELECT 
        b.nature_of_expense AS expense_name,
        COALESCE(SUM(CAST(b.total_amount AS DECIMAL(15,2))), 0) AS total
      FROM bills b
      WHERE b.store_id = ?
        AND MONTH(b.created_at) = ?
        AND YEAR(b.created_at) = ?
        AND b.is_cancelled = 0
        AND b.nature_of_expense IS NOT NULL
        AND b.nature_of_expense != ''
      GROUP BY b.nature_of_expense
      HAVING total > 0
      ORDER BY total DESC
      `,
      [storeId, month, selectedYear]
    );

    const result = rows.map(row => ({
      expense_name: row.expense_name.trim(),
      total: Number(row.total) || 0,
    }));
    res.status(200).json(result);
  } catch (err) {
    console.error('getNatureExpensesByStore ERROR:', {
      message: err.message,
      sql: err.sql,
      storeId,
      month,
      year: selectedYear
    });
    res.status(500).json({ 
      message: 'Failed to fetch nature of expenses',
      error: err.message 
    });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = { 
  getsuperAdminstatCounts,
  getAdminstatCounts,
  getspendsandcredits, 
  getStorenames,
  getStoresOverview, 
  getAdminStoresOverview,
  getStoreDetails, 
  getRecentBills, 
  getAdminRecentBills,
  getNatureExpensesByStore
};