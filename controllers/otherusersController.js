const pool = require('../connections/connections');
const bcrypt = require('bcrypt');
const { welcomeemail } = require('../middleware/welcomeemail');

const createUser = async (req, res) => {
  const { username, email, contact_number, password, store_id, role_id, isActive } = req.body;

  // Input validation
  if (!username || !email || !contact_number || !password || !store_id || !role_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields (username, email, contact_number, password, store_id, role_id) are required'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
  }

  if (!/^\d{10}$/.test(contact_number)) {
    return res.status(400).json({
      success: false,
      message: 'Contact number must be 10 digits'
    });
  }

  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()]).{8,}$/.test(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be 8+ characters with uppercase, lowercase, number, and special character'
    });
  }

  try {
    const connection = await pool.getConnection();
    try {
      // Start transaction
      await connection.beginTransaction();

      // Check if email exists
      const [existingUser] = await connection.query(
        `SELECT * FROM users WHERE email = ?`,
        [email]
      );

      if (existingUser.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Email already exists. Please use a different email.'
        });
      }

      // Validate store_id and role_id
      const [store] = await connection.query(
        `SELECT id FROM stores WHERE id = ?`,
        [store_id]
      );
      const [role] = await connection.query(
        `SELECT id FROM roles WHERE id = ?`,
        [role_id]
      );

      if (store.length === 0 || role.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Invalid store_id or role_id'
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user
      const [result] = await connection.query(
        `INSERT INTO users (username, email, contact_number, password_hash, created_at) VALUES (?, ?, ?, ?, NOW())`,
        [username, email, contact_number, hashedPassword]
      );

      // Insert user details
      await connection.query(
        `INSERT INTO other_users (user_id, store_id, isactive, created_at) VALUES (?, ?, ?, NOW())`,
        [result.insertId, store_id, Number(isActive)]
      );

      // Assign role
      await connection.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        [result.insertId, role_id]
      );

      // Commit transaction
      await connection.commit();

      // Send welcome email (non-blocking)
      try {
        await welcomeemail(email, username, password);
      } catch (emailError) {
        console.error('Error sending welcome email:', emailError);
      }

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          id: result.insertId,
          username,
          email,
          contact_number,
          store_id,
          role_id,
          isactive: isActive,
          created_at: new Date().toISOString().split('T')[0]
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in createUser:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.sqlMessage || error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, email, contact_number, store_id, role_id, isActive } = req.body;

  // Input validation
  if (!username || !email || !contact_number || !store_id || !role_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields (username, email, contact_number, store_id, role_id) are required'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
  }

  if (!/^\d{10}$/.test(contact_number)) {
    return res.status(400).json({
      success: false,
      message: 'Contact number must be 10 digits'
    });
  }

  try {
    const connection = await pool.getConnection();
    try {
      // Start transaction
      await connection.beginTransaction();

      // Check if user exists
      const [existingUser] = await connection.query(
        `SELECT * FROM users WHERE id = ?`,
        [id]
      );

      if (existingUser.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if email is taken by another user
      const [emailCheck] = await connection.query(
        `SELECT * FROM users WHERE email = ? AND id != ?`,
        [email, id]
      );

      if (emailCheck.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Email already exists. Please use a different email.'
        });
      }

      // Validate store_id and role_id
      const [store] = await connection.query(
        `SELECT id FROM stores WHERE id = ?`,
        [store_id]
      );
      const [role] = await connection.query(
        `SELECT id FROM roles WHERE id = ?`,
        [role_id]
      );

      if (store.length === 0 || role.length === 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'Invalid store_id or role_id'
        });
      }

      // Update user
      await connection.query(
        `UPDATE users SET username = ?, email = ?, contact_number = ? WHERE id = ?`,
        [username, email, contact_number, id]
      );

      // Update user details
      await connection.query(
        `UPDATE other_users SET store_id = ?, isactive = ? WHERE user_id = ?`,
        [store_id, Number(isActive), id]
      );

      // Update role
      await connection.query(
        `UPDATE user_roles SET role_id = ? WHERE user_id = ?`,
        [role_id, id]
      );

      // Commit transaction
      await connection.commit();

      res.status(200).json({
        success: true,
        message: 'User updated successfully',
        data: {
          id,
          username,
          email,
          contact_number,
          store_id,
          role_id,
          isactive: isActive
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in updateUser:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.sqlMessage || error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const connection = await pool.getConnection();
    try {
      // Start transaction
      await connection.beginTransaction();

      // Check if user exists
      const [existingUser] = await connection.query(
        `SELECT * FROM users WHERE id = ?`,
        [id]
      );

      if (existingUser.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete from user_roles
      await connection.query(
        `DELETE FROM user_roles WHERE user_id = ?`,
        [id]
      );

      // Delete from other_users
      await connection.query(
        `DELETE FROM other_users WHERE user_id = ?`,
        [id]
      );

      // Delete from users
      await connection.query(
        `DELETE FROM users WHERE id = ?`,
        [id]
      );

      // Commit transaction
      await connection.commit();

      res.status(200).json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in deleteUser:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.sqlMessage || error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

const getAll = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          o.id AS user_id, o.isactive, o.created_at,
          user.id AS user_id, user.username, user.email, user.contact_number,
          s.id AS store_id, s.store_name, s.state AS store_state, s.city AS store_city,
          r.role_id AS role_id,
          r2.name AS role_name
        FROM other_users o
        LEFT JOIN users user ON user.id = o.user_id
        LEFT JOIN stores s ON s.id = o.store_id
        LEFT JOIN user_roles r ON r.user_id = user.id
        LEFT JOIN roles r2 ON r2.id = r.role_id
        ORDER BY o.created_at DESC
      `);

      const Users = rows.map(row => ({
        id: row.user_id,
        isactivate: row.isactive,
        created_at: row.created_at,
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
        },
        store: {
          id: row.store_id,
          name: row.store_name,
          state: row.store_state,
          city: row.store_city,
        },
        role: {
          id: row.role_id,
          name: row.role_name
        }
      }));

      res.status(200).json({ success: true, Users });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getAllUsers:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.sqlMessage || error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

module.exports = { createUser, updateUser, deleteUser, getAll };