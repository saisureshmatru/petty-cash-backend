const connection = require('../connections/connections');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const axios = require('axios')

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Find user by email
    const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = users[0];

    if (user.isactive === 0) return res.status(403).json({ error: 'Account Inactive' });

    // 2. Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    // 3. Get user roles and permissions
    const [roles] = await connection.query(`
      SELECT r.id, r.name, r.self_only, 
             GROUP_CONCAT(
               CONCAT(
                 '{"module":"', pm.name, '","action":"', pa.name, '"}'
               ) SEPARATOR ','
             ) AS permissions
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permission_modules pm ON rp.module_id = pm.id
      LEFT JOIN permission_actions pa ON rp.action_id = pa.id
      WHERE ur.user_id = ?
      GROUP BY r.id
    `, [user.id]);

    // Parse the permissions string
    const parsedRoles = {};
    roles.forEach(role => {
      parsedRoles[role.name] = {
        id: role.id,
        selfOnly: role.self_only,
        permissions: role.permissions ? JSON.parse(`[${role.permissions}]`) : []
      };
    });

    // 4. Get user store IDs
    const [storeRows] = await connection.query(
      'SELECT store_id FROM user_stores WHERE user_id = ?',
      [user.id]
    );
    const store_ids = storeRows.map(row => row.store_id);

    // 5. Generate JWT token with store_ids
    const token = jwt.sign(
      {
        userId: user.id,
        eid: user.eid,
        name: user.username,
        roles: parsedRoles,
        cid: user.cid,
        did: user.did,
        hod_id: user.hod_id,
        sid: store_ids // Add store_ids to the token payload
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 6. Set the token in a cookie
    res.cookie('token', token, {
      httpOnly: true,       // Prevent JS access
      secure: false,        // Set to true in production with HTTPS
      sameSite: 'Lax',      // Prevent CSRF in most cases
      maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days in milliseconds
    });

    // 7. Send response with user details and store_ids
    res.json({
      token,
      user: {
        id: user.id,
        name: user.username,
        eid: user.eid,
        email: user.email,
        store_ids: store_ids // Include store_ids in the response
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};


// Protected Route Controller
const protectedroute = (req, res) => {
    res.json({ id: req.user.userId, username: req.user.name, email: req.user.email });
};

const checkAuth = (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ authenticated: false });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ authenticated: true, user: decoded });
  } catch (err) {
    res.json({ authenticated: false });
  }
}

const logout = (req, res) => {
   const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });}
  res.clearCookie('token', { httpOnly: true, sameSite: 'Lax' });
  res.json({ message: 'Logged out successfully' });
}

const Profile = async (req, res) => {
  try {
    const id = req.params.id;
    const sql = `SELECT 
                 users.*,
                 departments.department AS department_name,
                 hod.hod_name AS hod_name
                 FROM users
                 LEFT JOIN departments ON users.did = departments.id
                 LEFT JOIN hod ON users.hod_id = hod.id
                 WHERE users.id = ?`;
    const [rows] = await connection.execute(sql, [id]);
    if (rows.length === 0) return res.status(404).send('User not found');
    res.json(rows[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).send('Internal server error');
  }
};

const ProfileUpdate = async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    // Check for email or contact_number duplicates (if updating them)
    if (updates.email || updates.contact_number) {
      const conditions = [];
      const values = [];

      if (updates.email) {
        conditions.push('email = ?');
        values.push(updates.email);
      }

      if (updates.contact_number) {
        conditions.push('contact_number = ?');
        values.push(updates.contact_number);
      }

      // Check if another user already has the same email or contact_number
      const [existingUsers] = await connection.query(
        `SELECT * FROM users WHERE (${conditions.join(' OR ')}) AND id != ?`,
        [...values, id]
      );

      if (existingUsers.length > 0) {
        const existingUser = existingUsers[0];
        if (existingUser.email === updates.email) {
          return res.status(400).json({ error: "Email is already in use" });
        }
        if (existingUser.contact_number === updates.contact_number) {
          return res.status(400).json({ error: "Contact number is already in use" });
        }
      }
    }

    // Password update logic
    if (updates.newPassword) {
      // First check if currentPassword is provided
      if (!updates.currentPassword) {
        return res.status(400).json({ error: "Current password is required" });
      }

      const [users] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
      const user = users[0];

      if (!user) return res.status(404).json({ error: "User not found" });
      
      // Check if user has a password (might be null for some users)
      if (!user.password_hash) {
        return res.status(400).json({ error: "No password set for this user" });
      }

      const isMatch = await bcrypt.compare(updates.currentPassword, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      if (updates.newPassword.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const hashedPassword = await bcrypt.hash(updates.newPassword, 10);
      await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, id]);

      return res.json({
        message: "Password updated successfully",
        updatedUser: {
          id: user.id,
          username: user.username,
          email: user.email,
          contact_number: user.contact_number
        }
      });
    }

    // Regular profile updates
    if (Object.keys(updates).length > 0) {
      const fields = [];
      const values = [];

      for (let key in updates) {
        // Skip password fields as they're handled separately
        if (key === 'newPassword' || key === 'currentPassword') continue;
        
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }

      // Only proceed with update if there are fields to update
      if (fields.length > 0) {
        values.push(id);
        const updateQuery = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        await connection.query(updateQuery, values);
      }
    }

    // Fetch updated user details
    const [updatedUsers] = await connection.query(
      'SELECT id, username, email, contact_number FROM users WHERE id = ?',
      [id]
    );

    res.json({
      message: "Profile updated successfully",
      updatedUser: updatedUsers[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};



const sendotp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // 1. Find the user by email
    const [userRows] = await connection.query('SELECT * FROM `users` WHERE email = ?', [email]);

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userRows[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate 6-digit OTP
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
 // OTP expires in 5 minutes

    // 2. Insert OTP into the database
    await connection.query(
      'INSERT INTO `otp`(`userid`, `email`, `otp`, `expireat`) VALUES (?, ?, ?, ?)',
      [user.id, user.email, otp, expiresAt]
    );

// 3. Send email via Brevo API
    const apiKey = process.env.BREVO_API_KEY;
    const url = 'https://api.brevo.com/v3/smtp/email';

    const emailData = {
      sender: {
        name: 'Vaibhav Bill Tracker',
        email: 'hippocloudtechnologies@gmail.com',
      },
      to: [{ email: user.email }],
      subject: 'Your OTP for Password Reset',
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://iili.io/F6bl1Tl.png" alt="Hippo365" style="max-width: 150px;">
          </div>
          <p style="font-size: 16px; color: #333;">Dear User,</p>
          <p style="font-size: 14px; color: #555;">You have requested to reset your password. Please use the OTP below to proceed:</p>
          <h2 style="text-align: center; color: #007bff;">${otp}</h2>
          <p style="font-size: 14px; color: #555;">This OTP is valid for the next 5 minutes.</p>
          <p style="font-size: 14px; color: #555;">If you did not make this request, please ignore this email.</p>
          <p style="font-size: 14px; color: #555;">Thank you,</p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="https://hippo365.hippoclouds.com" style="font-size: 14px; color: #007bff; text-decoration: none;">Visit our website</a>
          </div>
        </div>
      `,
    };

    await axios.post(url, emailData, {
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
    });

    return res.status(200).json({ message: "OTP sent successfully" });

  } catch (error) {
    console.error('Error in sendotp:', error.response?.data || error.message || error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message || error });
  }
};


const resetpassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Email, OTP, and new password are required" });
    }

    // 1️⃣ Find the OTP in the otp table
    const [otpRows] = await connection.query(
      'SELECT * FROM `otp` WHERE otp = ? AND email = ?',
      [otp, email]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const otpRecord = otpRows[0];

    // 2️⃣ Check if the OTP has expired
    const currentTime = Date.now();
    const expireAt = parseInt(otpRecord.expireat);

    if (currentTime > expireAt) {
      // Delete the expired OTP
      await connection.query('DELETE FROM `otp` WHERE email = ?', [email]);
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    // 3️⃣ Hash the new password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);

    // 4️⃣ Update the user's password in the users table
    await connection.query(
      'UPDATE `users` SET `password_hash` = ? WHERE email = ?',
      [hashedPassword, email]
    );

    // 5️⃣ Delete the OTP after successful password reset
    await connection.query('DELETE FROM `otp` WHERE email = ?', [email]);

    return res.status(200).json({ message: "Password reset successfully" });

  } catch (error) {
    console.error("Error in resetpassword:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message || error });
  }
};


const createAdmin = async (req, res) => {
  try { 
    const {eid, username, email, contact_number, password, role } = req.body;
    if (!username || !email || !contact_number || !password || !role) {
      return res.status(400).json({ error: "All fields are required" });
    }
    // Check if the email or contact number already exists
    const [existingUsers] = await connection.query(
      'SELECT * FROM users WHERE email = ? OR contact_number = ?',
      [email, contact_number]
    );
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: "Email or contact number already exists" });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Insert the new user into the database
    const [result] = await connection.query(
      'INSERT INTO users (eid, username, email, contact_number, password_hash) VALUES (?, ?, ?, ?, ?)',
      [eid, username, email, contact_number, hashedPassword]
    );
    const userId = result.insertId;
    // Assign the role to the user
    await connection.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, role]
    );
    res.status(201).json({ message: "Admin created successfully", userId });
  }
  catch (error) {
    console.error("Error creating admin:", error);
    res.status(500).json({ message: "Internal server error", error: error.message || error });
  }
}

const getAlladmins = async (req, res) => {
  try{
    const [userIds] = await connection.query('SELECT user_id FROM user_roles WHERE role_id = 1');
    if (userIds.length === 0) {
      return res.status(404).json({ message: "No admins found" });
    }
    const ids = userIds.map(row => row.user_id);
    const [admins] = await connection.query('SELECT id, eid, username, email, contact_number FROM users WHERE id IN (?)', [ids]);
    if (admins.length === 0) {
      return res.status(404).json({ message: "No admins found" });
    }
    res.status(200).json(admins);
  }
  catch (error) {
    console.error("Error fetching admins:", error);
    res.status(500).json({ message: "Internal server error", error: error.message || error });
  }
};

const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {eid, username, email, contact_number } = req.body;

    // Check if the admin exists
    const [adminRows] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    if (adminRows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Update the admin details
    await connection.query(
      'UPDATE users SET eid = ?, username = ?, email = ?, contact_number = ? WHERE id = ?',
      [eid, username, email, contact_number, id]
    );

    // Update the role if provided
    // if (role) {
    //   await connection.query(
    //     'UPDATE user_roles SET role_id = ? WHERE user_id = ?',
    //     [role, id]
    //   );
    // }

    res.status(200).json({ message: "Admin updated successfully" });
  } catch (error) {
    console.error("Error updating admin:", error);
    res.status(500).json({ message: "Internal server error", error: error.message || error });
  }
};

const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if the admin exists
    const [adminRows] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    if (adminRows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Delete the admin from user_roles and users tables
    await connection.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
    await connection.query('DELETE FROM users WHERE id = ?', [id]);

    res.status(200).json({ message: "Admin deleted successfully" });
  } catch (error) {
    console.error("Error deleting admin:", error);
    res.status(500).json({ message: "Internal server error", error: error.message || error });
  }
};



module.exports = {login, protectedroute,logout, checkAuth, Profile, ProfileUpdate, sendotp, resetpassword, createAdmin, getAlladmins, updateAdmin, deleteAdmin};