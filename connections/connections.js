require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
  host: process.env.host,
  user: process.env.user,
  password: process.env.password,
  database: process.env.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
};

const pool = mysql.createPool(config);

// Optional: test connection (async function)
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected');
    connection.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  }
})();

module.exports = pool;
