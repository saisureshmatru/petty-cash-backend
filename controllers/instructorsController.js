const pool = require('../connections/connections');

const createInstructor = async (req, res) => {
  const { company_id, store_ids, department_ids, name, contact_number, eid } = req.body;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Validate inputs
    if (
      !company_id ||
      !store_ids || !Array.isArray(store_ids) || store_ids.length === 0 ||
      !department_ids || !Array.isArray(department_ids) || department_ids.length === 0 ||
      !name || !contact_number || !eid
    ) {
      return res.status(400).json({
        message: 'All fields (company_id, store_ids, department_ids, name, contact_number, eid) are required'
      });
    }

    if (!/^\d{10}$/.test(contact_number)) {
      return res.status(400).json({ message: 'Contact number must be exactly 10 digits' });
    }

    // Validate company
    const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (company.length === 0) {
      return res.status(400).json({ message: 'Invalid company ID' });
    }

    // Validate stores
    const storePlaceholders = store_ids.map(() => '?').join(',');
    const [stores] = await conn.query(
      `SELECT id, store_name, company_id 
       FROM stores 
       WHERE id IN (${storePlaceholders}) AND company_id = ?`,
      [...store_ids, company_id]
    );
    if (stores.length !== store_ids.length) {
      return res.status(400).json({
        message: 'One or more store IDs are invalid or do not belong to the specified company'
      });
    }

    // Validate departments
    const deptPlaceholders = department_ids.map(() => '?').join(',');
    const [departments] = await conn.query(
      `SELECT id, department 
       FROM departments 
       WHERE id IN (${deptPlaceholders})`,
      [...department_ids]
    );
    if (departments.length !== department_ids.length) {
      return res.status(400).json({ message: 'One or more department IDs are invalid' });
    }

    // Validate employee
    const empStorePlaceholders = store_ids.map(() => '?').join(',');
    const empDeptPlaceholders = department_ids.map(() => '?').join(',');
    const [employee] = await conn.query(
      `SELECT u.id, u.eid 
       FROM users u 
       JOIN user_stores us ON u.id = us.user_id 
       WHERE u.eid = ? 
       AND us.store_id IN (${empStorePlaceholders}) 
       AND u.did IN (${empDeptPlaceholders})`,
      [eid, ...store_ids, ...department_ids]
    );
    if (employee.length === 0) {
      return res.status(400).json({
        message: 'Invalid employee ID for the selected stores and departments'
      });
    }

    // Check for existing instructors
    const exDeptPlaceholders = department_ids.map(() => '?').join(',');
    const exStorePlaceholders = store_ids.map(() => '?').join(',');
    const [existingInstructors] = await conn.query(
      `SELECT id 
       FROM instructors 
       WHERE eid = ? 
       AND department_id IN (${exDeptPlaceholders}) 
       AND store_id IN (${exStorePlaceholders})`,
      [eid, ...department_ids, ...store_ids]
    );
    if (existingInstructors.length > 0) {
      return res.status(400).json({
        message: 'This employee is already assigned as an instructor for one or more of the selected departments and stores'
      });
    }

    // Insert instructor records
    const insertedInstructors = [];
    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const sql = `INSERT INTO instructors 
          (cid, store_id, department_id, name, contact_number, eid, isactive) 
          VALUES (?, ?, ?, ?, ?, ?, 1)`;
        const [result] = await conn.query(sql, [
          company_id, store_id, department_id, name, contact_number, eid
        ]);

        const [newInstructor] = await conn.query(
          `SELECT i.*, s.store_name, s.company_id, d.department, c.company_name
           FROM instructors i 
           LEFT JOIN stores s ON s.id = i.store_id 
           LEFT JOIN departments d ON d.id = i.department_id
           LEFT JOIN companies c ON c.id = i.cid
           WHERE i.id = ?`,
          [result.insertId]
        );
        insertedInstructors.push(newInstructor[0]);
      }
    }

    // Update users table
    await conn.query('UPDATE users SET isinstructor = 1 WHERE eid = ?', [eid]);

    await conn.commit();

    res.status(200).json({
      message: 'Instructors added successfully',
      instructors: insertedInstructors
    });

  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      if (err.message.includes('contact_number')) {
        return res.status(400).json({ message: 'Contact number already exists' });
      } else if (err.message.includes('eid')) {
        return res.status(400).json({ message: 'Employee ID already assigned as instructor' });
      }
    }
    console.error('Error inserting Instructor:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    if (conn) conn.release();
  }
};


const getInstructors = async (req, res) => {
  try {
    const sql = `
      SELECT i.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM instructors i
      LEFT JOIN stores s ON s.id = i.store_id
      LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN companies c ON c.id = i.cid
      ORDER BY i.created_at DESC
    `;
    const [result] = await pool.query(sql);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No instructors found', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching instructors:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const updateInstructor = async (req, res) => {
  const { id } = req.params;
  const { company_id, store_ids, department_ids, name, contact_number, is_active, eid } = req.body;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Validate inputs
    if (
      !company_id ||
      !store_ids || !Array.isArray(store_ids) || store_ids.length === 0 ||
      !department_ids || !Array.isArray(department_ids) || department_ids.length === 0 ||
      !name || !contact_number || is_active === undefined || !eid
    ) {
      return res.status(400).json({
        message:
          'All fields (company_id, store_ids, department_ids, name, contact_number, is_active, eid) are required',
      });
    }

    if (!/^\d{10}$/.test(contact_number)) {
      return res.status(400).json({ message: 'Contact number must be exactly 10 digits' });
    }

    // Validate company
    const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (company.length === 0) {
      return res.status(400).json({ message: 'Invalid company ID' });
    }

    // Validate stores
    const storePlaceholders = store_ids.map(() => '?').join(',');
    const [stores] = await conn.query(
      `SELECT id, company_id 
       FROM stores 
       WHERE id IN (${storePlaceholders}) AND company_id = ?`,
      [...store_ids, company_id]
    );
    if (stores.length !== store_ids.length) {
      return res.status(400).json({
        message: 'One or more store IDs are invalid or do not belong to the specified company',
      });
    }

    // Validate departments
    const deptPlaceholders = department_ids.map(() => '?').join(',');
    const [departments] = await conn.query(
      `SELECT id FROM departments WHERE id IN (${deptPlaceholders})`,
      [...department_ids]
    );
    if (departments.length !== department_ids.length) {
      return res.status(400).json({ message: 'One or more department IDs are invalid' });
    }

    // Validate employee (similar to createInstructor)
    const empStorePlaceholders = store_ids.map(() => '?').join(',');
    const empDeptPlaceholders = department_ids.map(() => '?').join(',');
    const [employee] = await conn.query(
      `SELECT u.id, u.eid 
       FROM users u
       JOIN user_stores us ON u.id = us.user_id
       WHERE u.eid = ?
       AND us.store_id IN (${empStorePlaceholders})
       AND u.did IN (${empDeptPlaceholders})`,
      [eid, ...store_ids, ...department_ids]
    );
    if (employee.length === 0) {
      return res.status(400).json({
        message: 'Invalid employee ID for the selected stores and departments',
      });
    }

    // Delete existing instructor records for this ID
    await conn.query('DELETE FROM instructors WHERE id = ?', [id]);

    // Insert new instructor records for each store-department combination
    const insertedInstructors = [];
    for (const store_id of store_ids) {
      for (const department_id of department_ids) {
        const sql = `INSERT INTO instructors 
          (id, cid, store_id, department_id, name, contact_number, eid, isactive) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await conn.query(sql, [
          id, company_id, store_id, department_id, name, contact_number, eid, is_active ? 1 : 0
        ]);

        const [updatedInstructor] = await conn.query(
          `SELECT i.*, s.store_name, s.company_id, d.department, c.company_name 
           FROM instructors i
           LEFT JOIN stores s ON s.id = i.store_id 
           LEFT JOIN departments d ON d.id = i.department_id 
           LEFT JOIN companies c ON c.id = i.cid
           WHERE i.id = ? AND i.store_id = ? AND i.department_id = ?`,
          [id, store_id, department_id]
        );
        insertedInstructors.push(updatedInstructor[0]);
      }
    }

    // Update users table to set isinstructor based on is_active
    await conn.query('UPDATE users SET isinstructor = ? WHERE eid = ?', [is_active ? 1 : 0, eid]);

    // Commit transaction
    await conn.commit();

    res.status(200).json({
      message: 'Instructor updated successfully',
      instructors: insertedInstructors,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY' && err.message.includes('contact_number')) {
      return res.status(400).json({ message: 'Contact number already exists' });
    }
    console.error('Error updating Instructor:', err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  } finally {
    if (conn) conn.release();
  }
};


const multiStoreInstructors = async (req, res) => {
  const { storeIds } = req.body;
  try {
    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      return res.status(400).json({ message: 'Store IDs array is required' });
    }
    const sql = `
      SELECT i.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM instructors i
      LEFT JOIN stores s ON s.id = i.store_id
      LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN companies c ON c.id = i.cid
      WHERE i.store_id IN (?)
      ORDER BY i.created_at DESC
    `;
    const [result] = await pool.query(sql, [storeIds]);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No instructors found for these stores', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching instructors:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const getEmployeeNameAndId = async (req, res) => {
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
  }};

const CompanyInstructors = async (req, res) => {
  const { companyId } = req.params;
  try {
    if (!companyId) {
      return res.status(400).json({ message: 'Company ID is required' });
    }
    const sql = `
      SELECT i.*, s.id AS store_id, s.store_name, s.company_id, d.id AS department_id, d.department, c.company_name, c.id AS company_id
      FROM instructors i
      LEFT JOIN stores s ON s.id = i.store_id
      LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN companies c ON c.id = i.cid
      WHERE i.cid = ?
      ORDER BY i.created_at DESC
    `;
    const [result] = await pool.query(sql, [companyId]);

    if (result.length === 0) {
      return res.status(200).json({ message: 'No instructors found for this company', data: [] });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching instructors:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

const getInstructorebysidanddid = async (req, res) => {
  try {
    let { departmentIds, storeIds } = req.params;

    if (!departmentIds || !storeIds) {
      return res.status(400).json({ message: 'Department IDs and Store IDs are required' });
    }

    // Convert comma-separated strings to arrays
    const departmentIdArray = departmentIds.split(',').map(id => id.trim());
    const storeIdArray = storeIds.split(',').map(id => id.trim());

    const sql = `
      SELECT name 
      FROM instructors 
      WHERE department_id IN (?) 
      AND store_id IN (?)
      AND isactive = 1
    `;

    const [result] = await pool.query(sql, [departmentIdArray, storeIdArray]);

    if (!result || result.length === 0) {
      return res.status(200).json({ message: 'No employees found for the given departments and stores', data: [] });
    }

    // 🔑 Convert to array of names
    const names = result.map(row => row.name);

    return res.status(200).json(names);

  } catch (err) {
    console.error('Error fetching employee data:', err);
    return res.status(500).json({
      message: 'Internal server error while fetching employee data',
      error: err.message,
    });
  }
};



module.exports = {
  getInstructors,
  createInstructor,
  updateInstructor,
  multiStoreInstructors,
  getEmployeeNameAndId,
  CompanyInstructors,
  getInstructorebysidanddid
};