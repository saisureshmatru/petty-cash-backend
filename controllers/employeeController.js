const { welcomeemail } = require('../middleware/welcomeemail');
const pool = require('../connections/connections');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');

// Helper function for adding a single employee (extracted from AddEmployee)
const addEmployeeHelper = async (conn, {
  eid, username, email, contact_number, password, role_ids, company_id, store_ids, department_id,
  hod_id, isActive, isHod, isInstructor, hod_store_ids = [], hod_department_ids = [],
  instructor_store_ids = [], instructor_department_ids = []
}) => {
  // Input validation (same as original)
  if (!eid || !username || !email || !password || !role_ids || !Array.isArray(role_ids) || role_ids.length === 0 || !company_id || !store_ids || !Array.isArray(store_ids) || store_ids.length === 0 || !department_id) {
    throw new Error('All required fields must be provided');
  }

  if (isHod) {
    if (!Array.isArray(hod_store_ids) || hod_store_ids.length === 0 || !Array.isArray(hod_department_ids) || hod_department_ids.length === 0) {
      throw new Error('hod_store_ids and hod_department_ids must be non-empty when isHod is true');
    }
  }
  if (isInstructor) {
    if (!Array.isArray(instructor_store_ids) || instructor_store_ids.length === 0 || !Array.isArray(instructor_department_ids) || instructor_department_ids.length === 0) {
      throw new Error('instructor_store_ids and instructor_department_ids must be non-empty when isInstructor is true');
    }
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  if (contact_number && !contact_number.match(/^\d{10}$/)) {
    throw new Error('Contact number must be 10 digits');
  }

  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@#$%!^&*]{8,}$/;
  if (!passwordRegex.test(password)) {
    throw new Error('Password must be at least 8 characters long and contain at least one letter and one number');
  }

  const isactive = isActive ? 1 : 0;
  const is_hod = isHod ? 1 : 0;
  const is_instructor = isInstructor ? 1 : 0;

  // Validate foreign keys (same as original)
  const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
  if (company.length === 0) {
    throw new Error('Invalid company_id');
  }

  for (const store_id of store_ids) {
    const [store] = await conn.query('SELECT id, company_id FROM stores WHERE id = ?', [store_id]);
    if (store.length === 0 || store[0].company_id !== company_id) {
      throw new Error(`Invalid store_id: ${store_id} or store does not belong to the specified company`);
    }
  }

  const [department] = await conn.query('SELECT id FROM departments WHERE id = ?', [department_id]);
  if (department.length === 0) {
    throw new Error('Invalid department_id');
  }

  if (is_hod) {
    for (const store_id of hod_store_ids) {
      const [hodStore] = await conn.query('SELECT id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
      if (hodStore.length === 0) {
        throw new Error(`Invalid hod_store_id: ${store_id}`);
      }
    }
    for (const dept_id of hod_department_ids) {
      const [hodDept] = await conn.query('SELECT id FROM departments WHERE id = ?', [dept_id]);
      if (hodDept.length === 0) {
        throw new Error(`Invalid hod_department_id: ${dept_id}`);
      }
    }
  }

  if (is_instructor) {
    for (const store_id of instructor_store_ids) {
      const [insStore] = await conn.query('SELECT id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
      if (insStore.length === 0) {
        throw new Error(`Invalid instructor_store_id: ${store_id}`);
      }
    }
    for (const dept_id of instructor_department_ids) {
      const [insDept] = await conn.query('SELECT id FROM departments WHERE id = ?', [dept_id]);
      if (insDept.length === 0) {
        throw new Error(`Invalid instructor_department_id: ${dept_id}`);
      }
    }
  }

  const [existingUser] = await conn.query(
    `SELECT * FROM users WHERE eid = ? OR email = ?`,
    [eid, email]
  );
  if (existingUser.length > 0) {
    throw new Error('Employee ID or email already exists');
  }

  let finalHodId = hod_id;
  if (is_hod) {
    if (hod_id) {
      throw new Error('hod_id should not be provided when isHod is true');
    }
    finalHodId = null;
    for (const store_id of hod_store_ids) {
      for (const dept_id of hod_department_ids) {
        const [hodResult] = await conn.query(
          'INSERT INTO hod (cid, store_id, department_id, hod_name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, 1)',
          [company_id, store_id, dept_id, username, contact_number || null, eid]
        );
        if (dept_id === department_id && store_ids.includes(store_id)) {
          finalHodId = hodResult.insertId;
        }
      }
    }
    if (!finalHodId) {
      throw new Error('No matching HOD record found for the employee\'s department and store');
    }
  } else if (hod_id) {
    const [hod] = await conn.query('SELECT id FROM hod WHERE id = ? AND isactive = 1', [hod_id]);
    if (hod.length === 0) {
      throw new Error('Invalid hod_id or HOD is inactive');
    }
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const [result] = await conn.query(
    `INSERT INTO users (eid, username, email, contact_number, password_hash, cid, did, hod_id, ishod, isinstructor, isactive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eid, username, email, contact_number || '', hashedPassword, company_id, department_id, finalHodId, is_hod, is_instructor, isactive]
  );

  const userId = result.insertId;

  for (const store_id of store_ids) {
    await conn.query(
      'INSERT INTO user_stores (user_id, store_id) VALUES (?, ?)',
      [userId, store_id]
    );
  }

  let isCashier = false;
  for (const role_id of role_ids) {
    const [role] = await conn.query('SELECT name FROM roles WHERE id = ?', [role_id]);
    if (role.length === 0) {
      throw new Error(`Invalid role_id: ${role_id}`);
    }
    const roleName = role[0].name.toLowerCase();
    if (roleName.includes('cashier')) {
      isCashier = true;
    }
    await conn.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, role_id]
    );
  }

  if (isCashier) {
    for (const store_id of store_ids) {
      await conn.query(
        'INSERT INTO cashier (user_id, company_id, store_id, isactivate) VALUES (?, ?, ?, ?)',
        [userId, company_id, store_id, isactive]
      );
    }
  }

  if (is_instructor) {
    for (const store_id of instructor_store_ids) {
      for (const dept_id of instructor_department_ids) {
        await conn.query(
          'INSERT INTO instructors (cid, store_id, department_id, name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [company_id, store_id, dept_id, username, contact_number || '', eid, isactive]
        );
      }
    }
  }

  return { userId, eid, username, email, password };  // Return for email sending
};

// Original AddEmployee (now uses helper)
const AddEmployee = async (req, res) => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const { userId, eid, username, email, password } = await addEmployeeHelper(conn, req.body);
    await conn.commit();

    try {
      await welcomeemail(email, username, password);
    } catch (emailError) {
      console.warn('Failed to send welcome email:', emailError.message);
    }

    res.status(201).json({ success: true, message: 'Employee created successfully', data: { id: userId, eid } });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ success: false, error: error.message });
  } finally {
    conn.release();
  }
};

// New importEmployees function
const importEmployees = async (req, res) => {
  let conn; // Initialize conn as undefined
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No Excel file uploaded' });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (data.length < 2) {
      return res.status(400).json({ success: false, error: 'Excel file is empty or has no data rows' });
    }

    const headers = data[0].map(h => h.trim().toLowerCase());
    const requiredHeaders = ['eid', 'username', 'email', 'password', 'role_ids', 'company_id', 'store_ids', 'department_id'];
    for (const reqHeader of requiredHeaders) {
      if (!headers.includes(reqHeader)) {
        return res.status(400).json({ success: false, error: `Missing required column: ${reqHeader}` });
      }
    }

    // Initialize database connection
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const rowErrors = [];
    const successfulImports = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowData = {};
      headers.forEach((header, idx) => {
        rowData[header] = row[idx] !== undefined ? row[idx].toString().trim() : '';
      });

      try {
        const payload = {
          eid: rowData.eid,
          username: rowData.username,
          email: rowData.email,
          contact_number: rowData.contact_number || undefined,
          password: rowData.password,
          role_ids: rowData.role_ids ? rowData.role_ids.split(',').map(id => parseInt(id.trim())) : [],
          company_id: parseInt(rowData.company_id),
          store_ids: rowData.store_ids ? rowData.store_ids.split(',').map(id => parseInt(id.trim())) : [],
          department_id: parseInt(rowData.department_id),
          hod_id: rowData.hod_id ? parseInt(rowData.hod_id) : undefined,
          isActive: ['1', 'true', 'yes'].includes(rowData.isactive.toLowerCase()),
          isHod: ['1', 'true', 'yes'].includes(rowData.ishod.toLowerCase()),
          isInstructor: ['1', 'true', 'yes'].includes(rowData.isinstructor.toLowerCase()),
          hod_store_ids: rowData.hod_store_ids ? rowData.hod_store_ids.split(',').map(id => parseInt(id.trim())) : [],
          hod_department_ids: rowData.hod_department_ids ? rowData.hod_department_ids.split(',').map(id => parseInt(id.trim())) : [],
          instructor_store_ids: rowData.instructor_store_ids ? rowData.instructor_store_ids.split(',').map(id => parseInt(id.trim())) : [],
          instructor_department_ids: rowData.instructor_department_ids ? rowData.instructor_department_ids.split(',').map(id => parseInt(id.trim())) : [],
        };

        const { userId, eid, username, email, password } = await addEmployeeHelper(conn, payload);
        successfulImports.push({ row: i + 1, eid });

        // Send welcome email (async, non-blocking)
        welcomeemail(email, username, password).catch(emailError => console.warn(`Failed email for ${eid}:`, emailError.message));
      } catch (err) {
        rowErrors.push({ row: i + 1, error: err.message });
      }
    }

    if (rowErrors.length > 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Import failed with errors', errors: rowErrors });
    }

    await conn.commit();
    res.status(200).json({ success: true, message: 'All employees imported successfully', imported: successfulImports.length, details: successfulImports });
  } catch (error) {
    if (conn) await conn.rollback();
    res.status(500).json({ success: false, error: error.message || 'Failed to import employees' });
  } finally {
    if (conn) conn.release();
  }
};

// UpdateEmployee
const UpdateEmployee = async (req, res) => {
  const { id } = req.params;
  const {
    eid,
    username,
    email,
    contact_number,
    company_id,
    store_ids,
    department_id,
    hod_id,
    role_ids,
    isActive,
    isHod,
    isInstructor,
    hod_store_ids = [],
    hod_department_ids = [],
    instructor_store_ids = [],
    instructor_department_ids = []
  } = req.body;

  // Input validation
  if (!eid || !username || !email || !company_id || !store_ids || !Array.isArray(store_ids) || store_ids.length === 0 || !department_id || !role_ids || !Array.isArray(role_ids) || role_ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'All required fields (eid, username, email, company_id, store_ids (array), department_id, role_ids (array)) must be provided'
    });
  }

  // New validation for HOD and Instructor
  if (isHod) {
    if (!Array.isArray(hod_store_ids) || hod_store_ids.length === 0 || !Array.isArray(hod_department_ids) || hod_department_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'hod_store_ids and hod_department_ids arrays must be provided and non-empty when isHod is true' });
    }
  }
  if (isInstructor) {
    if (!Array.isArray(instructor_store_ids) || instructor_store_ids.length === 0 || !Array.isArray(instructor_department_ids) || instructor_department_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'instructor_store_ids and instructor_department_ids arrays must be provided and non-empty when isInstructor is true' });
    }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }

  // Validate contact number if provided
  if (contact_number && !contact_number.match(/^\d{10}$/)) {
    return res.status(400).json({ success: false, message: 'Contact number must be 10 digits' });
  }

  const isactive = isActive === true ? 1 : 0;
  const is_hod = isHod === true ? 1 : 0;
  const is_instructor = isInstructor === true ? 1 : 0;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    // Validate foreign keys
    const [company] = await conn.query('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (company.length === 0) {
      throw new Error('Invalid company_id');
    }

    for (const store_id of store_ids) {
      const [store] = await conn.query('SELECT id, company_id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
      if (store.length === 0) {
        throw new Error(`Invalid store_id: ${store_id} or store does not belong to the specified company`);
      }
    }

    const [department] = await conn.query('SELECT id FROM departments WHERE id = ?', [department_id]);
    if (department.length === 0) {
      throw new Error('Invalid department_id');
    }

    // Validate HOD stores and departments if isHod
    if (is_hod) {
      for (const store_id of hod_store_ids) {
        const [hodStore] = await conn.query('SELECT id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
        if (hodStore.length === 0) {
          throw new Error(`Invalid hod_store_id: ${store_id}`);
        }
      }
      for (const dept_id of hod_department_ids) {
        const [hodDept] = await conn.query('SELECT id FROM departments WHERE id = ?', [dept_id]);
        if (hodDept.length === 0) {
          throw new Error(`Invalid hod_department_id: ${dept_id}`);
        }
      }
    }

    // Validate Instructor stores and departments if isInstructor
    if (is_instructor) {
      for (const store_id of instructor_store_ids) {
        const [insStore] = await conn.query('SELECT id FROM stores WHERE id = ? AND company_id = ?', [store_id, company_id]);
        if (insStore.length === 0) {
          throw new Error(`Invalid instructor_store_id: ${store_id}`);
        }
      }
      for (const dept_id of instructor_department_ids) {
        const [insDept] = await conn.query('SELECT id FROM departments WHERE id = ?', [dept_id]);
        if (insDept.length === 0) {
          throw new Error(`Invalid instructor_department_id: ${dept_id}`);
        }
      }
    }

    // Check if user exists
    const [userRows] = await conn.query('SELECT id, hod_id, eid FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      throw new Error('Employee not found');
    }

    // Check for existing eid or email (excluding current user)
    const [existingUser] = await conn.query(
      `SELECT id FROM users WHERE (eid = ? OR email = ?) AND id != ?`,
      [eid, email, id]
    );
    if (existingUser.length > 0) {
      throw new Error('Employee ID or email already exists');
    }

    // Handle HOD logic
    let finalHodId = hod_id;
    if (is_hod) {
      // When isHod is true, hod_id should not be provided
      if (hod_id) {
        throw new Error('hod_id should not be provided when isHod is true');
      }
      // Deactivate existing HOD records for this eid
      await conn.query('UPDATE hod SET isactive = 0 WHERE eid = ?', [eid]);
      finalHodId = null;
      // Insert new HOD records
      for (const store_id of hod_store_ids) {
        for (const dept_id of hod_department_ids) {
          const [hodResult] = await conn.query(
            'INSERT INTO hod (cid, store_id, department_id, hod_name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [company_id, store_id, dept_id, username, contact_number || null, eid]
          );
          // If the department_id matches the user's department_id and store_id is in store_ids, use this hod_id
          if (dept_id === department_id && store_ids.includes(store_id)) {
            finalHodId = hodResult.insertId;
          }
        }
      }
      if (!finalHodId) {
        throw new Error('No matching HOD record found for the employee\'s department and store');
      }
    } else {
      // Deactivate all HOD records for this eid
      await conn.query('UPDATE hod SET isactive = 0 WHERE eid = ?', [eid]);
      if (hod_id) {
        const [hod] = await conn.query('SELECT id FROM hod WHERE id = ? AND isactive = 1', [hod_id]);
        if (hod.length === 0) {
          throw new Error('Invalid hod_id or HOD is inactive');
        }
        finalHodId = hod_id;
      } else {
        finalHodId = null;
      }
    }

    // Update users table
    await conn.query(
      `UPDATE users SET eid = ?, username = ?, email = ?, contact_number = ?, cid = ?, did = ?, hod_id = ?, ishod = ?, isinstructor = ?, isactive = ?
       WHERE id = ?`,
      [eid, username, email, contact_number || null, company_id, department_id, finalHodId, is_hod, is_instructor, isactive, id]
    );

    // Update user_stores
    await conn.query('DELETE FROM user_stores WHERE user_id = ?', [id]);
    for (const store_id of store_ids) {
      await conn.query(
        'INSERT INTO user_stores (user_id, store_id) VALUES (?, ?)',
        [id, store_id]
      );
    }

    // Update roles
    await conn.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
    let isCashier = false;
    for (const role_id of role_ids) {
      const [role] = await conn.query('SELECT name FROM roles WHERE id = ?', [role_id]);
      if (role.length === 0) {
        throw new Error(`Invalid role_id: ${role_id}`);
      }
      const roleName = role[0].name.toLowerCase();
      if (roleName.includes('cashier')) {
        isCashier = true;
      }
      await conn.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [id, role_id]
      );
    }

    // Handle cashier table
    await conn.query('DELETE FROM cashier WHERE user_id = ?', [id]);
    if (isCashier) {
      for (const store_id of store_ids) {
        await conn.query(
          'INSERT INTO cashier (user_id, company_id, store_id, isactivate) VALUES (?, ?, ?, ?)',
          [id, company_id, store_id, isactive]
        );
      }
    }

    // Handle instructors
    await conn.query('UPDATE instructors SET isactive = 0 WHERE eid = ?', [eid]);
    if (is_instructor) {
      // Insert new multiple instructor records
      for (const store_id of instructor_store_ids) {
        for (const dept_id of instructor_department_ids) {
          await conn.query(
            'INSERT INTO instructors (cid, store_id, department_id, name, contact_number, eid, isactive) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [company_id, store_id, dept_id, username, contact_number || null, eid, isactive]
          );
        }
      }
    }

    // Commit transaction
    await conn.commit();

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      data: {
        id,
        eid,
        username,
        email,
        contact_number,
        company_id,
        store_ids,
        department_id,
        hod_id: finalHodId,
        role_ids,
        isactive,
        isHod: is_hod,
        isInstructor: is_instructor,
        isCashier,
        hod_store_ids,
        hod_department_ids,
        instructor_store_ids,
        instructor_department_ids
      }
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error in UpdateEmployee:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_DUP_ENTRY' ? 400 : (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR' ? 400 : 500);
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to update employee',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  } finally {
    conn.release();
  }
};

// getAllEmployees
const getAllEmployees = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          u.id,
          u.eid,
          u.username,
          u.email,
          u.contact_number,
          u.isactive,
          u.ishod,
          u.isinstructor,
          u.created_at,
          c.id AS company_id,
          c.company_name,
          d.id AS department_id,
          d.department AS department_name,
          u.hod_id,
          h.hod_name AS hod_name,
          GROUP_CONCAT(DISTINCT s.id) AS store_ids,
          GROUP_CONCAT(DISTINCT s.store_name) AS store_names,
          GROUP_CONCAT(DISTINCT r.id) AS role_ids,
          GROUP_CONCAT(DISTINCT r.name) AS role_names
        FROM users u
        LEFT JOIN companies c ON c.id = u.cid
        LEFT JOIN user_stores us ON us.user_id = u.id
        LEFT JOIN stores s ON s.id = us.store_id
        LEFT JOIN departments d ON d.id = u.did
        LEFT JOIN hod h ON h.id = u.hod_id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `);

      const Employees = rows.map(row => ({
        id: row.id,
        eid: row.eid,
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
        isactive: !!row.isactive,
        isHod: !!row.ishod,
        isInstructor: !!row.isinstructor,
        created_at: row.created_at,
        company: {
          id: row.company_id,
          name: row.company_name || null,
        },
        stores: row.store_ids ? row.store_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.store_names.split(',')[index]
        })) : [],
        department: {
          id: row.department_id,
          name: row.department_name || null,
        },
        hod: {
          id: row.hod_id || null,
          name: row.hod_name || 'No HOD Assigned',
        },
        roles: row.role_ids ? row.role_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.role_names.split(',')[index]
        })) : []
      }));

      res.status(200).json({
        success: true,
        message: 'Employees retrieved successfully',
        data: Employees
      });

    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getAllEmployees:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to retrieve employees',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

// getCompanyEmployees
const getCompanyEmployees = async (req, res) => {
  const { companyId } = req.params;
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          u.id,
          u.eid,
          u.username,
          u.email,
          u.contact_number,
          u.isactive,
          u.ishod,
          u.isinstructor,
          u.created_at,
          c.id AS company_id,
          c.company_name,
          d.id AS department_id,
          d.department AS department_name,
          u.hod_id,
          h.hod_name AS hod_name,
          GROUP_CONCAT(DISTINCT s.id) AS store_ids,
          GROUP_CONCAT(DISTINCT s.store_name) AS store_names,
          GROUP_CONCAT(DISTINCT r.id) AS role_ids,
          GROUP_CONCAT(DISTINCT r.name) AS role_names
        FROM users u
        LEFT JOIN companies c ON c.id = u.cid
        LEFT JOIN user_stores us ON us.user_id = u.id
        LEFT JOIN stores s ON s.id = us.store_id
        LEFT JOIN departments d ON d.id = u.did
        LEFT JOIN hod h ON h.id = u.hod_id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.cid = ?
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `, [companyId]);

      const Employees = rows.map(row => ({
        id: row.id,
        eid: row.eid,
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
        isactive: !!row.isactive,
        isHod: !!row.ishod,
        isInstructor: !!row.isinstructor,
        created_at: row.created_at,
        company: {
          id: row.company_id,
          name: row.company_name || null,
        },
        stores: row.store_ids ? row.store_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.store_names.split(',')[index]
        })) : [],
        department: {
          id: row.department_id,
          name: row.department_name || null,
        },
        hod: {
          id: row.hod_id || null,
          name: row.hod_name || 'No HOD Assigned',
        },
        roles: row.role_ids ? row.role_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.role_names.split(',')[index]
        })) : []
      }));

      res.status(200).json({
        success: true,
        message: 'Employees retrieved successfully',
        data: Employees
      });

    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getCompanyEmployees:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to retrieve employees',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

// getStorebasedEmployees
const getStorebasedEmployees = async (req, res) => {
  const id = req.params.id;
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          u.id,
          u.eid,
          u.username,
          u.email,
          u.contact_number,
          u.isactive,
          u.ishod,
          u.isinstructor,
          u.created_at,
          c.id AS company_id,
          c.company_name,
          d.id AS department_id,
          d.department AS department_name,
          u.hod_id,
          h.hod_name AS hod_name,
          GROUP_CONCAT(DISTINCT s.id) AS store_ids,
          GROUP_CONCAT(DISTINCT s.store_name) AS store_names,
          GROUP_CONCAT(DISTINCT r.id) AS role_ids,
          GROUP_CONCAT(DISTINCT r.name) AS role_names
        FROM users u
        LEFT JOIN companies c ON c.id = u.cid
        LEFT JOIN user_stores us ON us.user_id = u.id
        LEFT JOIN stores s ON s.id = us.store_id
        LEFT JOIN departments d ON d.id = u.did
        LEFT JOIN hod h ON h.id = u.hod_id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE EXISTS (
          SELECT 1 FROM user_stores us2 WHERE us2.user_id = u.id AND us2.store_id = ?
        )
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `, [id]);

      const Employees = rows.map(row => ({
        id: row.id,
        eid: row.eid,
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
        isactive: !!row.isactive,
        isHod: !!row.ishod,
        isInstructor: !!row.isinstructor,
        created_at: row.created_at,
        company: {
          id: row.company_id,
          name: row.company_name || null,
        },
        stores: row.store_ids ? row.store_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.store_names.split(',')[index]
        })) : [],
        department: {
          id: row.department_id,
          name: row.department_name || null,
        },
        hod: {
          id: row.hod_id || null,
          name: row.hod_name || 'No HOD Assigned',
        },
        roles: row.role_ids ? row.role_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.role_names.split(',')[index]
        })) : []
      }));

      res.status(200).json({ 
        success: true, 
        message: 'Store employees retrieved successfully',
        Employees 
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getStorebasedEmployees:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to retrieve store employees' 
    });
  }
};

// deleteEmployee
const deleteEmployee = async (req, res) => {
  const { id } = req.params;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [userRows] = await conn.query('SELECT eid FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      throw new Error('Employee not found');
    }

    const eid = userRows[0].eid;

    // Deactivate HOD records
    await conn.query('UPDATE hod SET isactive = 0 WHERE eid = ?', [eid]);

    // Deactivate Instructor records
    await conn.query('UPDATE instructors SET isactive = 0 WHERE eid = ?', [eid]);

    // Delete associations
    await conn.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
    await conn.query('DELETE FROM user_stores WHERE user_id = ?', [id]);
    await conn.query('DELETE FROM cashier WHERE user_id = ?', [id]);

    // Delete user
    await conn.query('DELETE FROM users WHERE id = ?', [id]);

    await conn.commit();

    res.status(200).json({
      success: true,
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error in deleteEmployee:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_FIELD_ERROR' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to delete employee',
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  } finally {
    conn.release();
  }
};

// getemployeeById
const getemployeeById = async (req, res) => {
  const { eid } = req.params;
  if (!eid) return res.status(400).json({ success: false, error: 'Employee ID (eid) is required' });

  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          u.id,
          u.eid,
          u.username,
          u.email,
          u.contact_number,
          u.isactive,
          u.ishod,
          u.isinstructor,
          u.created_at,
          c.id AS company_id,
          c.company_name,
          d.id AS department_id,
          d.department AS department_name,
          u.hod_id,
          h.hod_name AS hod_name,
          GROUP_CONCAT(DISTINCT s.id) AS store_ids,
          GROUP_CONCAT(DISTINCT s.store_name) AS store_names,
          GROUP_CONCAT(DISTINCT r.id) AS role_ids,
          GROUP_CONCAT(DISTINCT r.name) AS role_names,
          (SELECT GROUP_CONCAT(DISTINCT hs.store_id) FROM hod hs WHERE hs.eid = u.eid AND hs.isactive = 1) AS hod_store_ids,
          (SELECT GROUP_CONCAT(DISTINCT hd.department_id) FROM hod hd WHERE hd.eid = u.eid AND hd.isactive = 1) AS hod_department_ids,
          (SELECT GROUP_CONCAT(DISTINCT ins.store_id) FROM instructors ins WHERE ins.eid = u.eid AND ins.isactive = 1) AS instructor_store_ids,
          (SELECT GROUP_CONCAT(DISTINCT ind.department_id) FROM instructors ind WHERE ind.eid = u.eid AND ind.isactive = 1) AS instructor_department_ids
        FROM users u
        LEFT JOIN companies c ON c.id = u.cid
        LEFT JOIN user_stores us ON us.user_id = u.id
        LEFT JOIN stores s ON s.id = us.store_id
        LEFT JOIN departments d ON d.id = u.did
        LEFT JOIN hod h ON h.id = u.hod_id
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.eid = ?
        GROUP BY u.id
      `, [eid]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Employee not found with this ID' });
      }

      const row = rows[0];
      const employee = {
        id: row.id,
        eid: row.eid,
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
        isactive: !!row.isactive,
        isHod: !!row.ishod,
        isInstructor: !!row.isinstructor,
        created_at: row.created_at,
        company: {
          id: row.company_id,
          name: row.company_name || null,
        },
        stores: row.store_ids ? row.store_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.store_names.split(',')[index]
        })) : [],
        department: {
          id: row.department_id,
          name: row.department_name || null,
        },
        hod: {
          id: row.hod_id || null,
          name: row.hod_name || 'No HOD Assigned',
        },
        roles: row.role_ids ? row.role_ids.split(',').map((id, index) => ({
          id: parseInt(id),
          name: row.role_names.split(',')[index]
        })) : [],
        hod_store_ids: row.hod_store_ids ? row.hod_store_ids.split(',').map(id => parseInt(id)) : [],
        hod_department_ids: row.hod_department_ids ? row.hod_department_ids.split(',').map(id => parseInt(id)) : [],
        instructor_store_ids: row.instructor_store_ids ? row.instructor_store_ids.split(',').map(id => parseInt(id)) : [],
        instructor_department_ids: row.instructor_department_ids ? row.instructor_department_ids.split(',').map(id => parseInt(id)) : []
      };

      res.status(200).json({
        success: true,
        message: 'Employee retrieved successfully',
        data: employee
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getEmployeeById:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to retrieve employee' 
    });
  }
};

module.exports = { AddEmployee, UpdateEmployee, getAllEmployees, getCompanyEmployees, getStorebasedEmployees, getemployeeById, deleteEmployee, importEmployees };