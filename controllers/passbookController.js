const pool = require('../connections/connections');

const AddCash = async (req, res) => {
  const {
    store_id,
    depositor_id,
    transition_type,
    cheque_date,
    cheque_number,
    bank_name,
    phone_id,
    amount,
    cid
  } = req.body;

  let connection;

  try {
    // ================= VALIDATION =================
    if (!cid || !store_id || !depositor_id || !transition_type || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ================= FETCH STORE =================
    const [storeRows] = await connection.query(
      "SELECT id, store_id FROM stores WHERE id = ?",
      [store_id]
    );

    if (storeRows.length === 0) {
      throw new Error("Store not found");
    }

    const cost_code = storeRows[0].store_id;

    // ================= VALIDATE USER STORE =================
    const [userStoreRows] = await connection.query(
      "SELECT user_id FROM user_stores WHERE user_id = ? AND store_id = ?",
      [depositor_id, store_id]
    );

    if (userStoreRows.length === 0) {
      throw new Error("Depositor is not associated with this store");
    }

    // ================= UPDATE STORE BALANCE =================
    let updated_balance = numericAmount;

    const [storeAmountRows] = await connection.query(
      "SELECT available_cash FROM stores_amount WHERE store_id = ?",
      [store_id]
    );

    if (storeAmountRows.length > 0) {
      const currentCash = parseFloat(storeAmountRows[0].available_cash);
      updated_balance = currentCash + numericAmount;

      await connection.query(
        "UPDATE stores_amount SET available_cash = ?, updated_at = NOW() WHERE store_id = ?",
        [updated_balance, store_id]
      );
    } else {
      await connection.query(
        "INSERT INTO stores_amount (store_id, available_cash, updated_at) VALUES (?, ?, NOW())",
        [store_id, updated_balance]
      );
    }

    // ================= TRANSITION ID GENERATION =================
    const year = new Date().getFullYear();
    const prefix = `${cost_code}-CR-${year}-`;

    const [lastRows] = await connection.query(
      `
      SELECT transition_id
      FROM deposites
      WHERE store_id = ?
        AND transition_id LIKE ?
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [store_id, `${prefix}%`]
    );

    let sequence = 1;

    if (lastRows.length > 0) {
      const lastId = lastRows[0].transition_id;
      const lastSeq = parseInt(lastId.split("-").pop(), 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }

    const latest_transitionId = `${prefix}${sequence
      .toString()
      .padStart(3, "0")}`;

    // ================= INSERT INTO DEPOSITES =================
    const [depositResult] = await connection.query(
      `
      INSERT INTO deposites (
        transition_id, cid, store_id, depositor_id, transition_type,
        cheque_date, cheque_number, bank_name, phonepe_id,
        amount, balance_amount, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [
        latest_transitionId,
        cid,
        store_id,
        depositor_id,
        transition_type,
        cheque_date || null,
        cheque_number || null,
        bank_name || null,
        phone_id || null,
        numericAmount,
        updated_balance
      ]
    );

    if (depositResult.affectedRows === 0) {
      throw new Error("Deposit insertion failed");
    }

    // ================= INSERT INTO TRANSITIONS =================
    const [transitionResult] = await connection.query(
      `
      INSERT INTO transitions
      (cid, sid, did, tnx_id, username, supplier, gst, transition_type, amount, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cid,
        store_id,
        0,
        latest_transitionId,
        depositor_id.toString(), // replace with username later
        transition_type,
        "--",
        "Credit",
        numericAmount,
        updated_balance
      ]
    );

    if (transitionResult.affectedRows === 0) {
      throw new Error("Transition insertion failed");
    }

    await connection.commit();

    res.status(200).json({
      message: "Amount added successfully",
      transition_id: latest_transitionId,
      balance: updated_balance
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("AddCash Error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      res.status(400).json({ message: "Duplicate transition ID detected" });
    } else {
      res.status(500).json({ message: err.message || "Internal Server Error" });
    }
  } finally {
    if (connection) connection.release();
  }
};


const getStoreTransitions = async (req, res) => {
  try {
    const storeId = parseInt(req.params.id);
    if (isNaN(storeId)) {
      return res.status(400).json({ message: 'Invalid store ID' });
    }

    // Validate store_id exists
    const [storeRows] = await pool.query('SELECT id FROM stores WHERE id = ?', [storeId]);
    if (storeRows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const query = `
      SELECT 
        d.id AS deposit_id,
        d.transition_id,
        d.store_id,
        d.depositor_id,
        d.transition_type,
        d.cheque_date,
        d.cheque_number,
        d.bank_name,
        d.phonepe_id,
        d.amount,
        d.balance_amount,
        d.created_at,
        d.updated_at,
        s.store_name,
        s.state,
        s.city,  
        u.username,
        u.email,
        u.contact_number
      FROM deposites d
      INNER JOIN stores s ON d.store_id = s.id
      INNER JOIN users u ON d.depositor_id = u.id
      INNER JOIN user_stores us ON u.id = us.user_id AND us.store_id = d.store_id
      WHERE d.store_id = ?
      ORDER BY d.created_at DESC
    `;

    const [rows] = await pool.query(query, [storeId]);

    const result = rows.map(row => ({
      deposit: {
        id: row.deposit_id,
        transition_id: row.transition_id,
        store_id: row.store_id,
        depositor_id: row.depositor_id,
        transition_type: row.transition_type,
        cheque_date: row.cheque_date,
        cheque_number: row.cheque_number,
        bank_name: row.bank_name,
        phonepe_id: row.phonepe_id,
        amount: row.amount,
        balance_amount: row.balance_amount,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      store: {
        store_name: row.store_name,
        state: row.state,
        city: row.city
      },
      user: {
        username: row.username,
        email: row.email,
        contact_number: row.contact_number
      }
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getStoreTransitions:', error);
    res.status(500).json({
      message: 'Error fetching store transitions',
      error: error.message || 'Internal server error'
    });
  }
};

const getStoreamount = async (req, res) => {
  try {
    const storeId = parseInt(req.params.id);
    if (isNaN(storeId)) {
      return res.status(400).json({ message: 'Invalid store ID' });
    }

    const [rows] = await pool.query(
      'SELECT available_cash, updated_at FROM stores_amount WHERE store_id = ?',
      [storeId]
    );

    if (rows.length === 0) {
      return res.status(200).json({ available_cash: 0, updated_at: null });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Get Store Amount Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getRecentBills = async (req, res) => {
  const { storeId } = req.params;

  try {
    const storeIdNum = parseInt(storeId);
    if (isNaN(storeIdNum)) {
      return res.status(400).json({ message: 'Invalid store ID' });
    }

    // Validate store_id exists
    const [storeRows] = await pool.query('SELECT id FROM stores WHERE id = ?', [storeIdNum]);
    if (storeRows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const sql = `
      SELECT 
        b.*,
        u.username
      FROM bills b
      INNER JOIN users u ON b.user_id = u.id
      INNER JOIN user_stores us ON u.id = us.user_id AND us.store_id = b.store_id
      WHERE b.store_id = ? AND b.is_approved = 1
      ORDER BY b.created_at DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(sql, [storeIdNum]);

    if (rows.length === 0) {
      return res.status(200).json({ message: 'No records found', data: [] });
    }

    const recentBills = rows.map(row => ({
      id: row.id,
      voucherNumber: row.voucher_reference_number,
      voucherDate: row.created_at ? row.created_at.toISOString().split('T')[0] : null,
      approvedBy: row.instructed_by || '-',
      payTo: row.supplier_name,
      status: row.is_approved === 1 ? 'Approved' : 'Pending',
      amount: row.total_amount,
      employeeName: row.username || '-'
    }));

    res.status(200).json(recentBills);
  } catch (err) {
    console.error('Error getting recent bills:', err);
    res.status(500).json({ error: 'Failed to retrieve recent bills' });
  }
};

const getTransitions = async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId);
    if (isNaN(storeId)) {
      return res.status(400).json({ message: 'Invalid store ID' });
    }

    // Validate store_id exists
    const [storeRows] = await pool.query('SELECT id FROM stores WHERE id = ?', [storeId]);
    if (storeRows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const query = `SELECT
                transitions.*,
                companies.company_name AS company,
                stores.store_name AS store,
                users.username AS username
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id
            WHERE transitions.sid = ?
      ORDER BY updated_at DESC
            LIMIT 10
    `;

    const [rows] = await pool.query(query, [storeId]);

    const result = rows.map(row => ({
      type: row.transition_type,
      id: row.id,
      store_id: row.sid,
      transition_id: row.tnx_id,
      transition_type: 'dummy',
      user_id: '1',
      amount: row.amount,
      balance_amount: row.balance,
      created_at: row.created_at,
      supplier_name: row.supplier,
      store: {
        store_name: row.store
      },
      user: {
        username: row.username,
        email: 'email',
        contact_number: 34454435
      }
    }));

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getTransitions:', error);
    res.status(500).json({
      message: 'Error fetching store transitions',
      error: error.message || 'Internal server error'
    });
  }
};

module.exports = { AddCash, getStoreTransitions, getStoreamount, getRecentBills, getTransitions };