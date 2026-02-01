// controllers/cashierdashboardController.js
const pool = require('../connections/connections');

/* --------------------------------------------------------------
   1. Bill Stats (total / approved / pending)
   -------------------------------------------------------------- */
const getbillstats = async (req, res) => {
  const { storeId } = req.params;
  let connection;

  try {
    // Support multiple store IDs (comma-separated)
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    // Voucher-level aggregation excluding self-closed rows
    const vouchersSql = `
      SELECT 
        voucher_reference_number,
        MAX(CASE WHEN is_cancelled = 1 THEN 1 ELSE 0 END) AS is_cancelled,
        MAX(CASE WHEN is_approved = 1 AND is_cancelled = 0 THEN 1 ELSE 0 END) AS is_approved,
        MAX(CASE WHEN sent_to_admin = 1 AND is_cancelled = 0 THEN 1 ELSE 0 END) AS sent_to_admin,
        MAX(CASE WHEN is_approved = 0 AND is_cancelled = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(total_amount) AS total_amount
      FROM bills
      WHERE store_id IN (${placeholders}) AND IFNULL(is_self_closed, 0) = 0
      GROUP BY voucher_reference_number
    `;

    const [voucherRows] = await connection.query(vouchersSql, storeIds);

    // Initialize stats
    const stats = {
      totalBills: 0,
      approvedBills: 0,
      pendingBills: 0,
      cancelledBills: 0,
      sentToAdminBills: 0,

      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      cancelledAmount: 0,
      sentToAdminAmount: 0
    };

    // Calculate stats
    voucherRows.forEach(row => {
      const amount = Number(row.total_amount) || 0;

      stats.totalBills++;          // each voucher counted once
      stats.totalAmount += amount; // sum of all non-self-closed rows per voucher

      if (row.is_cancelled === 1) {
        stats.cancelledBills++;
        stats.cancelledAmount += amount;

      } else if (row.is_approved === 1) {
        if (row.sent_to_admin === 1) {
          stats.sentToAdminBills++;
          stats.sentToAdminAmount += amount;
        } else {
          stats.approvedBills++;
          stats.approvedAmount += amount;
        }

      } else if (row.pending === 1){
        stats.pendingBills++;
        stats.pendingAmount += amount;
      }
    });

    return res.json(stats);

  } catch (error) {
    console.error('getbillstats error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve bill statistics'
    });
  } finally {
    if (connection) connection.release();
  }
};


/* --------------------------------------------------------------
   2. Monthly Expense (Line Chart)
   -------------------------------------------------------------- */
const getStoreMonthlyExpenseChart = async (req, res) => {
  const { storeId } = req.params;
  const { year } = req.query;
  let connection;

  try {
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    const sql = `
      SELECT 
        MONTH(created_at) AS month,
        SUM(total_amount) AS total
      FROM bills
      WHERE store_id IN (${placeholders})
        AND YEAR(created_at) = ?
        AND is_self_closed = 0
      GROUP BY MONTH(created_at)
      ORDER BY month
    `;

    const [rows] = await connection.query(sql, [...storeIds, year]);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data = monthNames.map((name, i) => {
      const r = rows.find(row => row.month === i + 1);
      // Format value to 2 decimal places
      const value = r ? Number(Number(r.total).toFixed(2)) : 0.00;
      return { name, value };
    });

    res.json(data);

  } catch (err) {
    console.error('getStoreMonthlyExpenseChart error:', err);
    res.status(500).json([]);
  } finally {
    if (connection) connection.release();
  }
};


/* --------------------------------------------------------------
   3. Monthly Credit (Line Chart) – from `deposites` table
   -------------------------------------------------------------- */
const getStoreMonthlyCreditChart = async (req, res) => {
  const { storeId } = req.params;
  const { year } = req.query;
  let connection;
  try {
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    const sql = `
      SELECT 
        MONTH(created_at) AS month,
        SUM(amount) AS total
      FROM deposites
      WHERE store_id IN (${placeholders})
        AND YEAR(created_at) = ?
      GROUP BY MONTH(created_at)
      ORDER BY month
    `;

    const [rows] = await connection.query(sql, [...storeIds, year]);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data = monthNames.map((name, i) => {
      const r = rows.find(row => row.month === i + 1);
      return { name, value: r ? Number(r.total) : 0 };
    });

    res.json(data);
  } catch (err) {
    console.error('getStoreMonthlyCreditChart error:', err);
    res.status(500).json([]);
  } finally {
    if (connection) connection.release();
  }
};

/* --------------------------------------------------------------
   4. Approval Status by Month (Bar Chart)
   -------------------------------------------------------------- */
const getApprovalStatusByMonth = async (req, res) => {
  const { storeId } = req.params;
  const { year } = req.query;
  let connection;

  try {
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    // Aggregate at voucher level first to get unique vouchers per month
    const sql = `
      SELECT 
        MONTH(created_at) AS month,
        SUM(CASE WHEN is_approved = 1 AND is_cancelled = 0 THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN is_approved = 0 AND is_cancelled = 0 THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN is_cancelled = 1 AND IFNULL(is_self_closed,0) = 0 THEN 1 ELSE 0 END) AS cancelled
      FROM (
        SELECT 
          voucher_reference_number,
          MIN(created_at) AS created_at,
          MAX(is_approved) AS is_approved,
          MAX(is_cancelled) AS is_cancelled,
          MAX(IFNULL(is_self_closed, 0)) AS is_self_closed
        FROM bills
        WHERE store_id IN (${placeholders})
          AND YEAR(created_at) = ?
        GROUP BY voucher_reference_number
      ) AS vouchers
      GROUP BY MONTH(created_at)
      ORDER BY month
    `;

    const [rows] = await connection.query(sql, [...storeIds, year]);

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const data = monthNames.map((name, i) => {
      const r = rows.find(row => row.month === i + 1);
      return {
        name,
        approved: r ? Number(r.approved) : 0,
        pending:  r ? Number(r.pending)  : 0,
        cancelled: r ? Number(r.cancelled) : 0,
      };
    })
    res.json(data);

  } catch (err) {
    console.error('getApprovalStatusByMonth error:', err);
    res.status(500).json([]);
  } finally {
    if (connection) connection.release();
  }
};

/* --------------------------------------------------------------
   5. Recent Bills (Table)
   -------------------------------------------------------------- */
const getRecentBills = async (req, res) => {
  const { storeId } = req.params;
  let connection;

  try {
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    // Get latest 10 unique vouchers with aggregation
    const sql = `
      SELECT *
      FROM (
        SELECT 
          voucher_reference_number,
          MIN(created_at) AS voucherDate,
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT supplier_name ORDER BY id), ',', 1) AS firstSupplier,
          COUNT(DISTINCT supplier_name) AS supplierCount,
          SUM(total_amount) AS totalAmount,
          MAX(is_approved) AS isApproved,
          MAX(is_cancelled) AS isCancelled,
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT billtype ORDER BY id), ',', 1) AS billType,
          SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT instructed_by ORDER BY id), ',', 1) AS instructedBy
        FROM bills
        WHERE store_id IN (${placeholders})
        AND is_self_closed = 0
        GROUP BY voucher_reference_number
        ORDER BY voucherDate DESC
        LIMIT 10
      ) AS recent_vouchers
    `;

    const [rows] = await connection.query(sql, storeIds);

    const recentBills = rows.map(r => ({
      voucherNumber: r.voucher_reference_number,
      voucherDate: r.voucherDate ? r.voucherDate.toISOString().split('T')[0] : null,
      approvedBy: r.instructedBy || '-',
      payTo: r.supplierCount > 1 ? `${r.firstSupplier} +${r.supplierCount - 1}` : r.firstSupplier,
      status: r.isApproved === 1 ? 'Approved' :r.isCancelled === 1 ? "Rejected" : 'Pending',
      amount: Number(r.totalAmount) || 0,
      billType: r.billType || '-',
    }));

    res.json(recentBills);

  } catch (err) {
    console.error('getRecentBills error:', err);
    res.status(500).json([]);
  } finally {
    if (connection) connection.release();
  }
};

/* --------------------------------------------------------------
   6. Nature of Expenses – Pie Chart (by month)
   -------------------------------------------------------------- */
const getNatureExpensesByStore = async (req, res) => {
  const { storeId } = req.params;
  const { month, year } = req.query;

  if (!storeId || !month || !year) {
    return res.status(400).json({ message: 'storeId, month and year are required' });
  }

  let connection;
  try {
    const storeIds = storeId.split(',').map(id => id.trim());
    const placeholders = storeIds.map(() => '?').join(',');

    connection = await pool.getConnection();

    const sql = `
      SELECT 
        nature_of_expense AS expense_name,
        COALESCE(SUM(total_amount), 0) AS total
      FROM bills
      WHERE store_id IN (${placeholders})
        AND MONTH(created_at) = ?
        AND YEAR(created_at)  = ?
        AND is_cancelled = 0
        AND nature_of_expense IS NOT NULL
        AND nature_of_expense != ''
        AND is_self_closed = 0
      GROUP BY nature_of_expense
      HAVING total > 0
      ORDER BY total DESC
    `;

    const [rows] = await connection.query(sql, [...storeIds, month, year]);

    const result = rows.map(r => ({
      expense_name: r.expense_name.trim(),
      total: Number(r.total) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('getNatureExpensesByStore error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (connection) connection.release();
  }
};

/* --------------------------------------------------------------
   EXPORT ALL FUNCTIONS
   -------------------------------------------------------------- */
module.exports = {
  getbillstats,
  getStoreMonthlyExpenseChart,
  getStoreMonthlyCreditChart,
  getApprovalStatusByMonth,
  getRecentBills,
  getNatureExpensesByStore,
};