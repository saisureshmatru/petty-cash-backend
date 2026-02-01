const pool = require('../connections/connections');

const getBillStats = async (req, res) => {
  const { userId } = req.params;
  let connection;

  try {
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    connection = await pool.getConnection();

    const sql = `
      SELECT 
        COUNT(DISTINCT voucher_reference_number) AS totalBills,
        COUNT(DISTINCT CASE WHEN is_approved = 1 THEN voucher_reference_number END) AS approvedBills,
        COUNT(DISTINCT CASE WHEN is_approved = 0 AND is_cancelled = 0 THEN voucher_reference_number END) AS pendingBills,
        COUNT(DISTINCT CASE WHEN is_cancelled = 1 THEN voucher_reference_number END) AS cancelledBills,
        SUM(total_amount) AS totalAmount,
        SUM(CASE WHEN is_approved = 1 THEN total_amount ELSE 0 END) AS approvedAmount,
        SUM(CASE WHEN is_approved = 0 AND is_cancelled = 0 THEN total_amount ELSE 0 END) AS pendingAmount,
        SUM(CASE WHEN is_cancelled = 1 THEN total_amount ELSE 0 END) AS cancelledAmount
      FROM (
        SELECT 
          voucher_reference_number,
          is_approved,
          is_cancelled,
          SUM(total_amount) as total_amount
        FROM bills
        WHERE user_id = ?
        GROUP BY voucher_reference_number, is_approved, is_cancelled
      ) AS grouped_bills
    `;

    const [rows] = await connection.query(sql, [userId]);

    const {
      totalBills = 0,
      approvedBills = 0,
      pendingBills = 0,
      cancelledBills = 0,
      totalAmount = 0,
      approvedAmount = 0,
      pendingAmount = 0,
      cancelledAmount = 0,
    } = rows[0] || {};

    res.status(200).json({
      totalBills: Number(totalBills),
      approvedBills: Number(approvedBills),
      pendingBills: Number(pendingBills),
      cancelledBills: Number(cancelledBills),
      totalAmount: Number(totalAmount),
      approvedAmount: Number(approvedAmount),
      pendingAmount: Number(pendingAmount),
      cancelledAmount: Number(cancelledAmount),
    });
  } catch (err) {
    console.error('Error getting bill stats:', err);
    res.status(500).json({ error: 'Failed to retrieve bill statistics' });
  } finally {
    if (connection) connection.release();
  }
};

const getUserMonthlyExpenseChart = async (req, res) => {
  const { userId } = req.params;
  const { year } = req.query;

  try {
    const sql = `
      SELECT 
        MONTH(created_at) AS month, 
        SUM(total_amount) AS total 
      FROM bills 
      WHERE user_id = ? AND YEAR(created_at) = ?
      GROUP BY MONTH(created_at)
    `;

    const [rows] = await pool.query(sql, [userId, year]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lineChartData = monthNames.map((name, index) => {
      const found = rows.find(row => row.month === index + 1);
      return {
        name,
        value: found ? Number(found.total) : 0
      };
    });

    res.status(200).json(lineChartData);
  } catch (err) {
    console.error("Error generating monthly chart data:", err);
    res.status(500).json({ error: 'Failed to generate chart data' });
  }
};

const getApprovalStatusByMonth = async (req, res) => {
  const { userId } = req.params;
  const { year } = req.query;

  if (!userId || !year) {
    return res.status(400).json({ error: "userId and year are required" });
  }

  try {
    const sql = `
      SELECT 
        MONTH(created_at) AS month,

        COUNT(DISTINCT CASE 
          WHEN is_approved = 1 
          THEN voucher_reference_number 
        END) AS approved,

        COUNT(DISTINCT CASE 
          WHEN is_approved = 0 AND is_cancelled = 0 
          THEN voucher_reference_number 
        END) AS pending,

        COUNT(DISTINCT CASE 
          WHEN is_cancelled = 1 
          THEN voucher_reference_number 
        END) AS rejected

      FROM bills
      WHERE user_id = ?
        AND YEAR(created_at) = ?
      GROUP BY MONTH(created_at)
      ORDER BY MONTH(created_at)
    `;

    const [rows] = await pool.query(sql, [userId, year]);

    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const barChartData = monthNames.map((name, index) => {
      const found = rows.find(row => row.month === index + 1);

      return {
        name,
        approved: found ? Number(found.approved) : 0,
        pending: found ? Number(found.pending) : 0,
        rejected: found ? Number(found.rejected) : 0
      };
    });

    res.status(200).json(barChartData);
  } catch (err) {
    console.error("Error generating approval status data:", err);
    res.status(500).json({ error: "Failed to generate approval status data" });
  }
};



const getRecentBills = async (req, res) => {
  const { userId } = req.params;

  try {
    // Fetch recent bills for the user
    const sql = `
      SELECT * FROM bills 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `;
    const [rows] = await pool.query(sql, [userId]);

    // Group rows by voucher_reference_number
    const groupedBills = {};
    
    rows.forEach(row => {
      const voucherNumber = row.voucher_reference_number;
      
      if (!groupedBills[voucherNumber]) {
        groupedBills[voucherNumber] = {
          bills: [],
          totalAmount: 0,
          createdAt: row.created_at
        };
      }
      
      groupedBills[voucherNumber].bills.push(row);
      groupedBills[voucherNumber].totalAmount += parseFloat(row.total_amount) || 0;
      
      // Keep the earliest created_at for the group
      if (row.created_at < groupedBills[voucherNumber].createdAt) {
        groupedBills[voucherNumber].createdAt = row.created_at;
      }
    });

    // Transform the grouped data to match the frontend format
    const recentBills = Object.keys(groupedBills).map((voucherNumber, index) => {
      const group = groupedBills[voucherNumber];
      const bills = group.bills;
      
      // Get the first bill as reference
      const firstBill = bills[0];
      
      // Count additional suppliers (excluding the first one)
      const additionalSuppliersCount = bills.length - 1;
      
      // Format supplier name
      let payTo = firstBill.supplier_name || 'N/A';
      if (additionalSuppliersCount > 0) {
        payTo += ` +${additionalSuppliersCount} more`;
      }
      
      // Get status (all bills should have same status in a voucher, but handle discrepancies)
      const isAllApproved = bills.every(bill => bill.is_approved === 1);
      const isAllCancelled = bills.every(bill => bill.is_cancelled === 1);
      const isAllSelfClosed = bills.every(bill => bill.is_self_closed === 1);
      const isAnySentToAdmin = bills.some(bill => bill.sent_to_admin === 1);
      
      let status = 'Pending';
      if (isAllCancelled) {
        status = 'Rejected';
      } else if (isAllSelfClosed) {
        status = 'Self Closed';
      } else if (isAllApproved) {
        status = isAnySentToAdmin ? 'Sent to Finance' : 'Approved';
      }
      
      return {
        id: firstBill.id,
        voucherNumber: voucherNumber,
        voucherDate: group.createdAt.toISOString().split('T')[0], // Format as YYYY-MM-DD
        approvedBy: firstBill.instructed_by || '-',
        payTo: payTo,
        status: status,
        amount: group.totalAmount.toFixed(2),
        itemCount: bills.length,
        bills: bills // Keep original bills data if needed
      };
    });

    // Sort by most recent voucher date and limit to 10 groups
    const sortedBills = recentBills
      .sort((a, b) => new Date(b.voucherDate) - new Date(a.voucherDate))
      .slice(0, 10);

    res.status(200).json(sortedBills);
  } catch (err) {
    console.error("Error getting recent bills:", err);
    res.status(500).json({ error: 'Failed to retrieve recent bills' });
  }
};

module.exports = { getBillStats, getUserMonthlyExpenseChart, getApprovalStatusByMonth, getRecentBills };