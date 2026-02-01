const { welcomeemail } = require('../middleware/welcomeemail');
const pool = require('../connections/connections');
const bcrypt = require('bcrypt');

const createCashier = async (req, res) => {
  const username = req.body.user.username;
  const email = req.body.user.email;
  const contact_number = req.body.user.contact_number;
  const password = req.body.user.password;
  const { company_id, store_id, role_id, cancel_approver_name, cancel_approver_contact } = req.body;
  const isactivate = 1;

  try {
    const connection = await pool.getConnection();
    try {
      // Check if email already exists
      const [existingUser] = await connection.query(
        `SELECT * FROM users WHERE email = ?`,
        [email]
      );
      
      if (existingUser.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists. Please use a different email.'
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user
      const [result] = await connection.query(
        `INSERT INTO users (username, email, contact_number, password_hash) VALUES (?, ?, ?, ?)`,
        [username, email, contact_number, hashedPassword]
      );

      // Insert cashier details
      await connection.query(
        `INSERT INTO cashier (user_id, company_id, store_id, cancel_approver_name, cancel_approver_contact, isactivate) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, company_id, store_id, cancel_approver_name, cancel_approver_contact, isactivate]
      );

      // Assign role
      await connection.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [result.insertId, role_id]
      );

      await welcomeemail(email, username, password);

      res.status(201).json({
        success: true,
        message: 'Cashier created and email sent successfully',
        id: result.insertId,
      });

    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in createCashier:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    const statusCode = error.code === 'ER_NO_SUCH_TABLE' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.sqlMessage || error.message,
      details: process.env.NODE_ENV === 'development' ? {
        code: error.code,
        sqlState: error.sqlState
      } : undefined
    });
  }
};

const getAllCashiers = async (req, res) => {
  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          c.id AS cashier_id, c.isactivate,
          user.id AS user_id, user.username, user.email, user.contact_number,
          comp.id AS company_id, comp.company_name, comp.state AS company_state, comp.city AS company_city, comp.contact_number AS company_contact_number,
          s.id AS store_id, s.store_name, s.state AS store_state, s.city AS store_city
        FROM cashier c
        LEFT JOIN users user ON user.id = c.user_id
        LEFT JOIN companies comp ON comp.id = c.company_id
        LEFT JOIN stores s ON s.id = c.store_id
        ORDER BY c.created_at DESC
      `);

      const cashiers = rows.map(row => ({
        id: row.cashier_id,
        isactivate: row.isactivate,
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
        },
        company: {
          id: row.company_id,
          name: row.company_name,
          state: row.company_state,
          city: row.company_city,
          contact_number: row.company_contact_number,
        },
        store: {
          id: row.store_id,
          name: row.store_name,
          state: row.store_state,
          city: row.store_city,
        }
      }));

      res.status(200).json({ success: true, cashiers });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getAllCashiers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};


const UpdateCashier = async (req, res) => {
  const { id } = req.params;
  const username = req.body.user.username;
  const email = req.body.user.email;
  const contact_number = req.body.user.contact_number;
  const { company_id, store_id, cancel_approver_name, cancel_approver_contact, isactivate } = req.body;

  try {
    const connection = await pool.getConnection();
    try {
      // 1. Get the user_id linked to this cashier
      const [cashierRows] = await connection.query(
        `SELECT * FROM cashier WHERE id = ?`,
        [id]
      );

      if (cashierRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Cashier not found' });
      }

      const user_id = cashierRows[0].user_id;

      // 2. Update the users table
      const [userResult] = await connection.query(
        `UPDATE users SET username = ?, email = ?, contact_number = ? WHERE id = ?`,
        [username, email, contact_number, user_id]
      );

      // 3. Update the cashier table
      const [cashierResult] = await connection.query(
        `UPDATE cashier SET company_id = ?, store_id = ?, cancel_approver_name = ?, cancel_approver_contact = ?, isactivate = ? WHERE id = ?`,
        [company_id, store_id, cancel_approver_name, cancel_approver_contact, isactivate, id]
      );

      res.status(200).json({ success: true, message: 'Cashier updated successfully' });

    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in UpdateCashier:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    res.status(500).json({ success: false, error: error.message });
  }
};


const deleteCashier = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Get connection from pool
    const connection = await pool.getConnection();

    try {
      // 2. Execute delete query
      const [result] = await connection.query(
        `DELETE FROM cashier WHERE id = ?`,
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Cashier not found' });
      }

      res.status(200).json({ success: true, message: 'Cashier deleted successfully' });
    } finally {
      // 3. Always release the connection
      connection.release();
    }
  } catch (error) {
    console.error('Error in deleteCashier:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};


const getstorebasedcashiers = async (req, res) => {
  const id = req.params.id;

  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          c.id AS cashier_id, c.isactivate,
          user.id AS user_id, user.username, user.email, user.contact_number,
          s.id AS store_id, s.store_name
        FROM cashier c
        LEFT JOIN users user ON user.id = c.user_id
        LEFT JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ? AND c.isactivate = ?
        ORDER BY c.created_at DESC
      `, [id, 1]);

      const cashiers = rows.map(row => ({
        id: row.cashier_id,
        isactivate: row.isactivate,
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
        },
        store: {
          id: row.store_id,
          name: row.store_name,
        }
      }));

      res.status(200).json({ success: true, cashiers });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getstorebasedcashiers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};


const getstoreAllCashiers = async (req, res) => {
  const id = req.params.id;

  try {
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(`
        SELECT 
          c.id AS cashier_id, c.isactivate,
          user.id AS user_id, user.username, user.email, user.contact_number,
          comp.id AS company_id, comp.company_name, comp.state AS company_state, comp.city AS company_city, comp.contact_number AS company_contact_number,
          s.id AS store_id, s.store_name
        FROM cashier c
        LEFT JOIN users user ON user.id = c.user_id
        LEFT JOIN companies comp ON comp.id = c.company_id
        LEFT JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ?
        ORDER BY c.created_at DESC
      `, [id]);

      const cashiers = rows.map(row => ({
        id: row.cashier_id,
        isactivate: row.isactivate,
        user: {
          id: row.user_id,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
        },
        company: {
          id: row.company_id,
          name: row.company_name,
          state: row.company_state,
          city: row.company_city,
          contact_number: row.company_contact_number,
        },
        store: {
          id: row.store_id,
          name: row.store_name,
        }
      }));

      res.status(200).json({ success: true, cashiers });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error in getstorebasedcashiers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};




module.exports = { createCashier, getAllCashiers, UpdateCashier, deleteCashier, getstorebasedcashiers, getstoreAllCashiers };