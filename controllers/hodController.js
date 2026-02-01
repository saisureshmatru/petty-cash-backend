const pool = require('../connections/connections');

const createHod = async (req, res) => {
  const { company_id, store_ids, department_ids, hod_name, contact_number, eid } = req.body;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Validate inputs
    if (!company_id || !store_ids || !store_ids.length || !department_ids || !department_ids.length || !hod_name || !contact_number || !eid) {
      return res.status(400).json({ message: 'All fields (company_id, store_ids, department_ids, hod_name, contact_number, eid) are required' });
    }
    if (!/^\d{10}$/.test(contact_number)) {
      return res.status(400).json({ message: 'Contact number must be exactly 10 digits' });
    }

    // Validate foreign keys and duplicates
    const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (company.length === 0) {
      return res.status(400).json({ message: 'Invalid company ID' });
    }

    for (const store_id of store_ids) {
      const [store] = await conn.query('SELECT id, store_name, company_id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
      if (store.length === 0) {
        return res.status(400).json({ message: `Invalid store ID ${store_id} or store does not belong to the specified company` });
      }
    }

    for (const department_id of department_ids) {
      const [department] = await conn.query('SELECT id, department FROM departments WHERE id = ?', [department_id]);
      if (department.length === 0) {
        return res.status(400).json({ message: `Invalid department ID ${department_id}` });
      }
    }

    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const [employee] = await conn.query(
          'SELECT u.id, u.eid FROM users u JOIN user_stores us ON u.id = us.user_id WHERE u.eid = ? AND us.store_id = ? AND u.did = ?',
          [eid, store_id, department_id]
        );
        if (employee.length === 0) {
          return res.status(400).json({ message: `Invalid employee ID for store ${store_id} and department ${department_id}` });
        }

        // Check for duplicate HOD
        const [existingHod] = await conn.query(
          'SELECT id FROM hod WHERE cid = ? AND store_id = ? AND department_id = ? AND hod_name = ? AND contact_number = ?',
          [company_id, store_id, department_id, hod_name, contact_number]
        );
        if (existingHod.length > 0) {
          return res.status(400).json({ message: `HOD with name ${hod_name} and contact number ${contact_number} already exists for company ${company_id}, store ${store_id}, and department ${department_id}` });
        }
      }
    }

    const newHods = [];
    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const sql = 'INSERT INTO hod (cid, store_id, department_id, hod_name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, 1)';
        const [result] = await conn.query(sql, [company_id, store_id, department_id, hod_name, contact_number, eid]);

        await conn.query('UPDATE users SET ishod = 1 WHERE eid = ?', [eid]);

        const [newHod] = await conn.query(
          `SELECT h.*, s.store_name, s.company_id, d.department, c.company_name
           FROM hod h 
           LEFT JOIN stores s ON s.id = h.store_id 
           LEFT JOIN departments d ON d.id = h.department_id
           LEFT JOIN companies c ON c.id = h.cid
           WHERE h.id = ?`,
          [result.insertId]
        );
        newHods.push(newHod[0]);
      }
    }

    await conn.commit();
    res.status(200).json({
      message: 'HOD(s) added successfully',
      hods: newHods
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY' && err.message.includes('contact_number')) {
      return res.status(400).json({ message: 'Contact number already exists' });
    }
    console.error('Error inserting HOD:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    conn.release();
  }
};

const getHod = async (req, res) => {
  try {
    const sql = `
      SELECT h.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM hod h
      LEFT JOIN stores s ON s.id = h.store_id
      LEFT JOIN departments d ON d.id = h.department_id
      LEFT JOIN companies c ON c.id = h.cid
      ORDER BY h.created_at DESC
    `;
    const [result] = await pool.query(sql);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No HODs found', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching HODs:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const updateHod = async (req, res) => {
  const { id } = req.params;
  const { company_id, store_ids, department_ids, hod_name, contact_number, is_active, eid } = req.body;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Validate inputs
    if (!company_id || !store_ids || !store_ids.length || !department_ids || !department_ids.length || !hod_name || !contact_number || is_active === undefined || !eid) {
      return res.status(400).json({ message: 'All fields (company_id, store_ids, department_ids, hod_name, contact_number, is_active, eid) are required' });
    }
    if (!/^\d{10}$/.test(contact_number)) {
      return res.status(400).json({ message: 'Contact number must be exactly 10 digits' });
    }

    // Validate foreign keys and duplicates
    const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (company.length === 0) {
      return res.status(400).json({ message: 'Invalid company ID' });
    }

    for (const store_id of store_ids) {
      const [store] = await conn.query('SELECT id, company_id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
      if (store.length === 0) {
        return res.status(400).json({ message: `Invalid store ID ${store_id} or store does not belong to the specified company` });
      }
    }

    for (const department_id of department_ids) {
      const [department] = await conn.query('SELECT id FROM departments WHERE id = ?', [department_id]);
      if (department.length === 0) {
        return res.status(400).json({ message: `Invalid department ID ${department_id}` });
      }
    }

    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const [employee] = await conn.query(
          'SELECT u.id, u.eid FROM users u JOIN user_stores us ON u.id = us.user_id WHERE u.eid = ? AND us.store_id = ? AND u.did = ?',
          [eid, store_id, department_id]
        );
        if (employee.length === 0) {
          return res.status(400).json({ message: `Invalid employee ID for store ${store_id} and department ${department_id}` });
        }

        // Check for duplicate HOD (excluding current HOD)
        const [existingHod] = await conn.query(
          'SELECT id FROM hod WHERE cid = ? AND store_id = ? AND department_id = ? AND hod_name = ? AND contact_number = ? AND id != ?',
          [company_id, store_id, department_id, hod_name, contact_number, id]
        );
        if (existingHod.length > 0) {
          return res.status(400).json({ message: `HOD with name ${hod_name} and contact number ${contact_number} already exists for company ${company_id}, store ${store_id}, and department ${department_id}` });
        }
      }
    }

    // Delete existing HOD records for this ID
    await conn.query('DELETE FROM hod WHERE id = ?', [id]);

    // Insert new HOD records for each store_id and department_id combination
    const updatedHods = [];
    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const sql = 'INSERT INTO hod (id, cid, store_id, department_id, hod_name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        await conn.query(sql, [id, company_id, store_id, department_id, hod_name, contact_number, eid, is_active]);

        await conn.query('UPDATE users SET ishod = ? WHERE eid = ?', [is_active ? 1 : 0, eid]);

        const [updatedHod] = await conn.query(
          `SELECT h.*, s.store_name, s.company_id, d.department, c.company_name 
           FROM hod h 
           LEFT JOIN stores s ON s.id = h.store_id 
           LEFT JOIN departments d ON d.id = h.department_id 
           LEFT JOIN companies c ON c.id = h.cid
           WHERE h.id = ? AND h.store_id = ? AND h.department_id = ?`,
          [id, store_id, department_id]
        );
        updatedHods.push(updatedHod[0]);
      }
    }

    await conn.commit();
    res.status(200).json({
      message: 'HOD updated successfully',
      hods: updatedHods
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY' && err.message.includes('contact_number')) {
      return res.status(400).json({ message: 'Contact number already exists' });
    }
    console.error('Error updating HOD:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    conn.release();
  }
};

const storeHods = async (req, res) => {
  const { storeId } = req.params;
  try {
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' });
    }
    const sql = `
      SELECT h.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM hod h
      LEFT JOIN stores s ON s.id = h.store_id
      LEFT JOIN departments d ON d.id = h.department_id
      LEFT JOIN companies c ON c.id = h.cid
      WHERE h.store_id = ?
      ORDER BY h.created_at DESC
    `;
    const [result] = await pool.query(sql, [storeId]);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No HODs found for this store', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching HODs:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const multistoreHods = async (req, res) => {
  const { storeIds } = req.body;
  try {
    if (!storeIds || !storeIds.length) {
      return res.status(400).json({ message: 'Store IDs are required' });
    }
    const sql = `
      SELECT h.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM hod h
      LEFT JOIN stores s ON s.id = h.store_id
      LEFT JOIN departments d ON d.id = h.department_id
      LEFT JOIN companies c ON c.id = h.cid
      WHERE h.store_id IN (?)
      ORDER BY h.created_at DESC
    `;
    const [result] = await pool.query(sql, [storeIds]);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No HODs found for these stores', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching HODs:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const getcompanyHods = async (req, res) => {
  const { companyId } = req.params;
  try {
    if (!companyId) {
      return res.status(400).json({ message: 'Company ID is required' });
    }
    const sql = `
      SELECT h.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM hod h
      LEFT JOIN stores s ON s.id = h.store_id
      LEFT JOIN departments d ON d.id = h.department_id
      LEFT JOIN companies c ON c.id = h.cid
      WHERE h.cid = ?
      ORDER BY h.created_at DESC
    `;
    const [result] = await pool.query(sql, [companyId]);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No HODs found for this company', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching HODs:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const getHodsbasedonDepartment = async (req, res) => {
  const { departmentId, storeId } = req.params;
  try {
    if (!departmentId || !storeId) {
      return res.status(400).json({ message: 'Department ID and Store ID are required' });
    }
    const sql = 'SELECT * FROM hod WHERE isactive = 1 AND department_id = ? AND store_id = ?';
    const [result] = await pool.query(sql, [departmentId, storeId]);
    res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching HODs by department:', err);
    res.status(500).json({
      message: 'Internal server error',
      error: err.message,
    });
  }
};

const getemployeenameandid = async (req, res) => {
  const { departmentIds, storeIds } = req.body;
  try {
    if (!departmentIds || !departmentIds.length || !storeIds || !storeIds.length) {
      return res.status(400).json({ message: 'Department IDs and Store IDs are required' });
    }
    const sql = `
      SELECT u.id, u.eid, u.username, u.contact_number 
      FROM users u
      JOIN user_stores us ON u.id = us.user_id
      WHERE u.did IN (?) AND us.store_id IN (?)
    `;
    const [result] = await pool.query(sql, [departmentIds, storeIds]);
    if (!result || result.length === 0) {
      return res.status(200).json({ message: 'No employees found for the given departments and stores', data: [] });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching employee data:', err);
    return res.status(500).json({
      message: 'Internal server error while fetching employee data',
      error: err.message,
    });
  }
};

const getStoreById = async (req, res) => {
  const { storeId } = req.params;
  try {
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID is required' });
    }
    const [result] = await pool.query('SELECT id, store_name, company_id FROM stores WHERE id = ?', [storeId]);
    if (result.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }
    res.status(200).json(result[0]);
  } catch (error) {
    console.error('Error fetching store:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const getStoresByIds = async (req, res) => {
  const { storeIds } = req.body;
  try {
    if (!storeIds || !storeIds.length) {
      return res.status(400).json({ message: 'Store IDs are required' });
    }
    const [result] = await pool.query('SELECT id, store_name, company_id FROM stores WHERE id IN (?)', [storeIds]);
    if (result.length === 0) {
      return res.status(404).json({ message: 'No stores found' });
    }
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching stores:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

module.exports = {
  getHod,
  createHod,
  updateHod,
  storeHods,
  multistoreHods,
  getcompanyHods,
  getHodsbasedonDepartment,
  getemployeenameandid,
  getStoreById,
  getStoresByIds
};