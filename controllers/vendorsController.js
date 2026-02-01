const db = require('../connections/connections');
const xlsx = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); 

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `vendor-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

const createVendor = async (req, res) => {
  try {
    const { vendor_name, gst_number } = req.body;

    // Check if vendor already exists
    const [existingVendor] = await db.query(
      'SELECT * FROM vendors WHERE vendor_name = ?',
      [vendor_name]
    );

    if (existingVendor.length > 0) {
      return res.status(202).send('Vendor already exists 😊');
    }

    // Insert new vendor (gst_number can be null)
    await db.query(
      'INSERT INTO vendors (vendor_name, gst_number) VALUES (?, ?)',
      [vendor_name, gst_number || null]
    );

    res.status(200).send('New vendor added');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal server error');
  }
};

const getAllVendors = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vendors');
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err });
  }
};

const getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [rows] = await db.query(
      'SELECT * FROM vendors WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err });
  }
};

const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendor_name, gst_number } = req.body;

    // Check if vendor exists
    const [existingVendor] = await db.query(
      'SELECT * FROM vendors WHERE id = ?',
      [id]
    );

    if (existingVendor.length === 0) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Check if new vendor name already exists (excluding current vendor)
    if (vendor_name && vendor_name !== existingVendor[0].vendor_name) {
      const [nameCheck] = await db.query(
        'SELECT * FROM vendors WHERE vendor_name = ? AND id != ?',
        [vendor_name, id]
      );

      if (nameCheck.length > 0) {
        return res.status(400).json({ message: 'Vendor name already exists' });
      }
    }

    // Update vendor
    await db.query(
      'UPDATE vendors SET vendor_name = ?, gst_number = ? WHERE id = ?',
      [vendor_name || existingVendor[0].vendor_name, gst_number || null, id]
    );

    res.status(200).json({ message: 'Vendor updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err });
  }
};

const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if vendor exists
    const [existingVendor] = await db.query(
      'SELECT * FROM vendors WHERE id = ?',
      [id]
    );

    if (existingVendor.length === 0) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    // Delete vendor
    await db.query(
      'DELETE FROM vendors WHERE id = ?',
      [id]
    );

    res.status(200).json({ message: 'Vendor deleted successfully' });
  } catch (err) {
    console.error(err);
    
    // Handle foreign key constraint errors
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ 
        message: 'Cannot delete vendor. It is being used in other records.' 
      });
    }
    
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const bulkUploadVendors = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ message: 'Excel file is empty' });
    }

    const results = {
      success: 0,
      failed: 0,
      duplicates: 0,
      errors: []
    };

    // Process each row
    for (const row of data) {
      try {
        const vendor_name = row.vendor_name || row['Vendor Name'] || row['VENDOR_NAME'];
        const gst_number = row.gst_number || row['GST Number'] || row['GST_NUMBER'] || null;

        if (!vendor_name) {
          results.failed++;
          results.errors.push({ row, error: 'Vendor name is required' });
          continue;
        }

        // Check if vendor already exists
        const [existingVendor] = await db.query(
          'SELECT * FROM vendors WHERE vendor_name = ?',
          [vendor_name]
        );

        if (existingVendor.length > 0) {
          results.duplicates++;
          results.errors.push({ row, error: 'Vendor already exists' });
          continue;
        }

        // Insert new vendor (gst_number can be null)
        await db.query(
          'INSERT INTO vendors (vendor_name, gst_number) VALUES (?, ?)',
          [vendor_name, gst_number]
        );

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ row, error: error.message });
      }
    }

    res.status(200).json({
      message: 'Bulk upload completed',
      results: results
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err.message });
  }
};

const searchVendors = async (req, res) => {
  try {
    const { vendor_name, page = 1, limit = 10 } = req.query;
    console.log("Vendor Name :",vendor_name);
    
    
    if (!vendor_name || vendor_name.trim() === '') {
      return res.status(400).json({ message: 'Vendor name is required for search' });
    }

    const searchTerm = `%${vendor_name.trim()}%`;
    const offset = (page - 1) * limit;

    // Get total count for pagination
    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM vendors WHERE vendor_name LIKE ?',
      [searchTerm]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Get paginated results
    const [rows] = await db.query(
      'SELECT * FROM vendors WHERE vendor_name LIKE ? ORDER BY vendor_name LIMIT ? OFFSET ?',
      [searchTerm, parseInt(limit), offset]
    );

    res.status(200).json({
      data: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit),
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err });
  }
};

const getAllVendorsWithSearch = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;
    let query = 'SELECT * FROM vendors';
    let countQuery = 'SELECT COUNT(*) as total FROM vendors';
    let queryParams = [];
    let countParams = [];

    if (search && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      query += ' WHERE vendor_name LIKE ?';
      countQuery += ' WHERE vendor_name LIKE ?';
      queryParams.push(searchTerm);
      countParams.push(searchTerm);
    }

    query += ' ORDER BY vendor_name';

    // Add pagination
    const offset = (page - 1) * limit;
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(parseInt(limit), offset);

    // Get total count
    const [countResult] = await db.query(countQuery, countParams);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Get paginated results
    const [rows] = await db.query(query, queryParams);

    res.status(200).json({
      data: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit),
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error', error: err });
  }
};

module.exports = {
  createVendor,
  getAllVendors,
  getVendorById,
  updateVendor,
  deleteVendor,
  bulkUploadVendors,
  searchVendors,
  getAllVendorsWithSearch,
  upload
};