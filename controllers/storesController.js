const db = require('../connections/connections');

// Get all stores
const getAllStores = async (req, res) => {
  const sql = `
    SELECT 
      s.*,
      c.id AS company_id,
      c.company_name,
      sa.available_cash,
      GROUP_CONCAT(DISTINCT CASE WHEN ca.isactivate = 1 THEN u.username ELSE NULL END) AS cashier_usernames,
      GROUP_CONCAT(DISTINCT i.name) AS instructors
    FROM stores s
    JOIN companies c ON s.company_id = c.id
    LEFT JOIN cashier ca ON ca.store_id = s.id
    LEFT JOIN users u ON ca.user_id = u.id
    LEFT JOIN stores_amount sa ON sa.store_id = s.id
    LEFT JOIN instructors i ON i.store_id = s.id
    GROUP BY s.id, c.id, c.company_name, sa.available_cash
  `;

  try {
    const [results] = await db.query(sql);

    const storesWithCompanyAndCashiers = results.map(row => {
      const { company_id, company_name, cashier_usernames, available_cash, instructors, ...storeData } = row;
      return {
        ...storeData,
        available_cash,
        company: {
          id: company_id,
          company_name
        },
        cashier_usernames: cashier_usernames && cashier_usernames.trim() !== '' 
          ? cashier_usernames.split(',') 
          : [],
        instructors: instructors && instructors.trim() !== '' 
          ? instructors.split(',') 
          : []
      };
    });

    res.json(storesWithCompanyAndCashiers);
  } catch (err) {
    console.error('Error in getAllStores:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// Get store by ID
const getStoreById = async (req, res) => {
  const { id } = req.params;
  const sid = parseInt(id);

  try {
    // 1. Validate store existence
    const [storeRows] = await db.query(
      'SELECT id, store_id, store_name AS name, contact_number, state, city, company_id FROM stores WHERE id = ?',
      [sid]
    );

    if (storeRows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const store = storeRows[0];

    // 2. Get company information
    const [companyRows] = await db.query(
      'SELECT id AS company_id, company_name FROM companies WHERE id = ?',
      [store.company_id]
    );

    if (companyRows.length === 0) {
      return res.status(404).json({ message: 'Company not found for this store' });
    }

    const company = companyRows[0];

    // 3. Find all active cashiers associated with the store via user_stores and cashier tables
    const [userStoreRows] = await db.query(
      'SELECT user_id FROM user_stores WHERE store_id = ?',
      [sid]
    );

    let userInfo = [];
    if (userStoreRows.length > 0) {
      const userIds = userStoreRows.map(row => row.user_id);

      // Fetch active users who are cashiers
      const [cashierRows] = await db.query(
        `SELECT u.id, u.username, u.contact_number
         FROM users u
         JOIN cashier c ON u.id = c.user_id
         WHERE u.id IN (?) AND u.isactive = 1 AND c.isactivate = 1 AND c.store_id = ?`,
        [userIds, id]
      );

      userInfo = cashierRows.map(user => ({
        user_id: user.id,
        username: user.username,
        contact_number: user.contact_number || ''
      }));
    }

    // 6. Final response
    res.json({
      store_id: store.store_id,
      store: {
        id: store.id,
        store_id: store.store_id,
        name: store.name,
        contact_number: store.contact_number,
        state: store.state,
        city: store.city
      },
      company: {
        id: company.company_id,
        company_name: company.company_name
      },
      users: userInfo
    });

  } catch (err) {
    console.error('Error in getStoreById:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// Create store
const createStore = async (req, res) => {
  const { store_id, store_name, contact_number, state, city, company_id } = req.body;
  const insertStoreSql = 'INSERT INTO stores (store_id, store_name, contact_number, state, city, company_id) VALUES (?, ?, ?, ?, ?, ?)';

  try {
    const [storeResult] = await db.query(insertStoreSql, [store_id, store_name, contact_number, state, city, company_id]);
    const storeId = storeResult.insertId;

    res.status(201).json({
      message: 'Store created successfully!',
      storeId: storeId
    });
  } catch (err) {
    console.error('Error in createStore:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        message: `Store with name '${store_name}' already exists.`,
        errorCode: err.code
      });
    }
    res.status(500).json({ message: 'An error occurred while creating the store.', error: err.message });
  }
};

// Update store
const updateStore = async (req, res) => {
  const { id } = req.params;
  const { store_name, contact_number, state, city, company_id } = req.body;
  const sql = 'UPDATE stores SET store_name = ?, contact_number = ?, state = ?, city = ?, company_id = ? WHERE id = ?';

  try {
    const [result] = await db.query(sql, [store_name, contact_number, state, city, company_id, id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Store not found' });

    res.json({ message: 'Store updated successfully' });
  } catch (err) {
    console.error('Error in updateStore:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: `Store with name '${store_name}' already exists.` });
    }
    res.status(500).json({ error: err.message });
  }
};

// Delete store
const deleteStore = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM instructors WHERE store_id = ?', [id]);
    const [result] = await db.query('DELETE FROM stores WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Store not found' });

    res.json({ message: 'Store and related instructors deleted successfully' });
  } catch (err) {
    console.error('Error in deleteStore:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get stores by company ID
const getStoresByCompanyId = async (req, res) => {
  const company_id = req.params.company_id;
  const sql = `
    SELECT 
      stores.*,
      companies.id AS company_id,
      companies.company_name
    FROM stores
    JOIN companies ON stores.company_id = companies.id
    WHERE stores.company_id = ?
  `;
  try {
    const [results] = await db.query(sql, [company_id]);

    const storesWithCompany = results.map(row => {
      const { company_id, company_name, store_name, ...storeData } = row;
      return {
        ...storeData,
        name: store_name,   // rename store_name → name
        company: {
          id: company_id,
          company_name
        }
      };
    });

    res.json(storesWithCompany);
  } catch (err) {
    console.error('Error in getStoresByCompanyId:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get store ID by user ID
const getStoreIdbyUserId = async (req, res) => {
  try {
    const userId = req.params.id;

    const [userStoreRows] = await db.query(
      'SELECT store_id FROM user_stores WHERE user_id = ?',
      [userId]
    );

    if (userStoreRows.length > 0) {
      const storeId = userStoreRows[0].store_id; // Return first store for compatibility
      const [storeRows] = await db.query('SELECT * FROM stores WHERE id = ?', [storeId]);
      if (storeRows.length > 0) {
        return res.status(200).json(storeRows[0]);
      }
    }

    return res.status(404).json({ message: 'Store not matched with user ID' });
  } catch (err) {
    console.error('Error in getStoreIdbyUserId:', err);
    res.status(500).json({ error: 'Internal server error while getting the store details' });
  }
};

// Get instructors by store ID
const getInstructorsByStoreId = async (req, res) => {
  const storeId = req.params.id;
  const sql = 'SELECT name FROM instructors WHERE store_id = ? AND isactive = 1';
  try {
    const [rows] = await db.query(sql, [storeId]);
    res.status(200).json(rows.map(row => row.name));
  } catch (err) {
    console.error('Error fetching instructors:', err);
    res.status(500).json({ error: 'Internal server error while fetching instructors' });
  }
};

// Get admin stores
const getAdminStores = async (req, res) => {
  const { companyId } = req.params;
  const sql = `
    SELECT 
      s.*,
      c.id AS company_id,
      c.company_name,
      sa.available_cash,
      GROUP_CONCAT(DISTINCT CASE WHEN ca.isactivate = 1 THEN u.username ELSE NULL END) AS cashier_usernames,
      GROUP_CONCAT(DISTINCT i.name) AS instructors
    FROM stores s
    JOIN companies c ON s.company_id = c.id
    LEFT JOIN cashier ca ON ca.store_id = s.id
    LEFT JOIN users u ON ca.user_id = u.id
    LEFT JOIN stores_amount sa ON sa.store_id = s.id
    LEFT JOIN instructors i ON i.store_id = s.id
    WHERE s.company_id = ?
    GROUP BY s.id, c.id, c.company_name, sa.available_cash
  `;

  try {
    const [results] = await db.query(sql, [companyId]);

    const storesWithCompanyAndCashiers = results.map(row => {
      const { company_id, company_name, cashier_usernames, available_cash, instructors, ...storeData } = row;
      return {
        ...storeData,
        available_cash,
        company: {
          id: company_id,
          company_name
        },
        cashier_usernames: cashier_usernames && cashier_usernames.trim() !== '' 
          ? cashier_usernames.split(',') 
          : [],
        instructors: instructors && instructors.trim() !== '' 
          ? instructors.split(',') 
          : []
      };
    });

    res.json(storesWithCompanyAndCashiers);
  } catch (err) {
    console.error('Error in getAdminStores:', err);
    res.status(500).json({ error: err.message });
  }
};

const multiStore = async(req, res) => {
  const { storeIds } = req.body;
  try {
    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      return res.status(400).json({ message: 'Store IDs array is required' });
    }
    const [stores] = await db.query('SELECT id, store_name, company_id FROM stores WHERE id IN (?)', [storeIds]);
    res.status(200).json(stores);
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
}

const getContactNumberByStoreId = async (req,res) => {
  const { storeId } = req.params;
  try {
    const [rows] = await db.query('SELECT contact_number FROM stores WHERE id = ?', [storeId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    } 
    res.status(200).json({ contact_number: rows[0].contact_number });
  } catch (err) {
    console.error('Error fetching contact number:', err);
    res.status(500).json({ error: 'Internal server error while fetching contact number' });
  }
 };

module.exports = {
  getAllStores,
  getStoreById,
  createStore,
  updateStore,
  deleteStore,
  getStoresByCompanyId,
  getStoreIdbyUserId,
  getInstructorsByStoreId,
  getAdminStores,
  multiStore,
  getContactNumberByStoreId
};