const pool = require('../connections/connections');

const getAlltransitions = async (req, res) => {
    try {
        const { page = 1, limit = 25, sortBy = 'created_at', sortOrder = 'desc', search, ...filters } = req.query;

        // Build the base SQL query
        let sql = `
            SELECT
                transitions.*,
                companies.company_name AS company,
                stores.store_name AS store,
                users.username AS username
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id  -- Fixed: Assume user_id, not username
        `;

        // Initialize conditions and parameters
        const conditions = [];
        const params = [];

        // Handle global search
        if (search) {
            conditions.push(`
                (transitions.tnx_id LIKE ? OR
                companies.company_name LIKE ? OR
                stores.store_name LIKE ? OR
                users.username LIKE ? OR
                transitions.supplier LIKE ? OR
                transitions.transition_type LIKE ? OR
                CAST(transitions.amount AS CHAR) LIKE ? OR
                CAST(transitions.balance_amount AS CHAR) LIKE ? OR
                transitions.created_at LIKE ?)
            `);
            const searchTerm = `%${search}%`;
            params.push(
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm
            );
        }

        // Handle filters
        if (filters.transition_id) {
            conditions.push(`transitions.tnx_id LIKE ?`);
            params.push(`%${filters.transition_id}%`);
        }
        if (filters.company_id) {
            conditions.push(`transitions.cid = ?`);
            params.push(filters.company_id);
        }
        if (filters.store_id) {
            conditions.push(`transitions.sid = ?`);
            params.push(filters.store_id);
        }
        if (filters['user.username']) {
            conditions.push(`users.username LIKE ?`);
            params.push(`%${filters['user.username']}%`);
        }
        if (filters['debit_details.pay_to']) {
            conditions.push(`transitions.supplier LIKE ?`);
            params.push(`%${filters['debit_details.pay_to']}%`);
        }
        if (filters.transition_type) {
            conditions.push(`transitions.transition_type = ?`);
            params.push(filters.transition_type);
        }
        if (filters.amount_min) {
            conditions.push(`transitions.amount >= ?`);
            params.push(parseFloat(filters.amount_min));
        }
        if (filters.amount_max) {
            conditions.push(`transitions.amount <= ?`);
            params.push(parseFloat(filters.amount_max));
        }
        if (filters.balance_amount_min) {
            conditions.push(`transitions.balance_amount >= ?`);
            params.push(parseFloat(filters.balance_amount_min));
        }
        if (filters.balance_amount_max) {
            conditions.push(`transitions.balance_amount <= ?`);
            params.push(parseFloat(filters.balance_amount_max));
        }
        if (filters.created_at_from) {
            conditions.push(`transitions.created_at >= ?`);
            params.push(filters.created_at_from);
        }
        if (filters.created_at_to) {
            conditions.push(`transitions.created_at <= ?`);
            params.push(filters.created_at_to);
        }

        // Append WHERE clause if there are conditions
        if (conditions.length > 0) {
            sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        // Handle sorting
        const sortableColumns = {
            companyName: 'companies.company_name',
            storeName: 'stores.store_name',
            amount: 'transitions.amount',
            balance_amount: 'transitions.balance_amount',
            created_at: 'transitions.created_at',
            'user.username': 'users.username',
            'debit_details.pay_to': "transitions.supplier",
            transition_type: 'transitions.transition_type',
            transition_id: 'transitions.tnx_id',
            default: 'transitions.created_at'
        };

        const sortField = sortableColumns[sortBy] || sortableColumns.default;
        sql += ` ORDER BY ${sortField} ${sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;

        // Handle pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);
        sql += ` LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);

        // Get total count for pagination
        let countSql = `
            SELECT COUNT(*) as total
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id  -- Fixed: Assume user_id
        `;
        if (conditions.length > 0) {
            countSql += ` WHERE ${conditions.join(' AND ')}`;
        }

        // Execute queries
        const [rows] = await pool.query(sql, params);
        const [countResult] = await pool.query(countSql, params.slice(0, params.length - 2)); // Exclude limit and offset

        // Format data to match frontend expectations
        const formattedData = rows.map(row => {
            const debitDetails = typeof row.debit_details === 'string' ? JSON.parse(row.debit_details) : row.debit_details;
            return {
                tnx_id: row.tnx_id,
                company: row.company,
                store: row.store,
                username: row.username,
                supplier: row.supplier || null,
                transition_type: row.transition_type,
                amount: parseFloat(row.amount) || 0,
                balance: parseFloat(row.balance) || 0,
                created_at: row.created_at
            };
        });

        // Set headers and send response
        res.set('x-total-count', countResult[0].total);
        res.status(200).json({
            message: 'Data fetched successfully',
            data: formattedData,
            total: countResult[0].total
        });
    } catch (err) {
        console.error('Error in getAlltransitions:', err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Internal server error', error: err.message });
        }
    }
};

const getCompanytransitions = async (req, res) => {
    const cid = req.params.cid;
    try {
        const { page = 1, limit = 25, sortBy = 'created_at', sortOrder = 'desc', search, ...filters } = req.query;

        // Validate company ID
        if (!cid || isNaN(parseInt(cid))) {
            return res.status(400).json({ message: 'Invalid company ID provided' });
        }

        // Build the base SQL query
        let sql = `
            SELECT
                transitions.*,
                companies.company_name AS company,
                stores.store_name AS store,
                users.username AS username
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id  -- Fixed: Assume user_id
            WHERE transitions.cid = ?
        `;
        const params = [parseInt(cid)];

        // Initialize conditions
        const conditions = [];

        // Handle global search
        if (search) {
            conditions.push(`
                (transitions.tnx_id LIKE ? OR
                companies.company_name LIKE ? OR
                stores.store_name LIKE ? OR
                users.username LIKE ? OR
                transitions.supplier LIKE ? OR
                transitions.transition_type LIKE ? OR
                CAST(transitions.amount AS CHAR) LIKE ? OR
                CAST(transitions.balance_amount AS CHAR) LIKE ? OR
                DATE_FORMAT(transitions.created_at, '%Y-%m-%d') LIKE ?)
            `);
            const searchTerm = `%${search}%`;
            params.push(
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm,
                searchTerm
            );
        }

        // Handle filters
        if (filters.transition_id) {
            conditions.push(`transitions.tnx_id LIKE ?`);
            params.push(`%${filters.transition_id}%`);
        }
        if (filters.store_id) {
            conditions.push(`transitions.sid = ?`);
            params.push(parseInt(filters.store_id));
        }
        if (filters['user.username']) {
            conditions.push(`users.username LIKE ?`);
            params.push(`%${filters['user.username']}%`);
        }
        if (filters['debit_details.pay_to']) {
            conditions.push(`transitions.supplier LIKE ?`);
            params.push(`%${filters['debit_details.pay_to']}%`);
        }
        if (filters.transition_type) {
            conditions.push(`transitions.transition_type = ?`);
            params.push(filters.transition_type);
        }
        if (filters.amount_min) {
            conditions.push(`transitions.amount >= ?`);
            params.push(parseFloat(filters.amount_min));
        }
        if (filters.amount_max) {
            conditions.push(`transitions.amount <= ?`);
            params.push(parseFloat(filters.amount_max));
        }
        if (filters.balance_amount_min) {
            conditions.push(`transitions.balance_amount >= ?`);
            params.push(parseFloat(filters.balance_amount_min));
        }
        if (filters.balance_amount_max) {
            conditions.push(`transitions.balance_amount <= ?`);
            params.push(parseFloat(filters.balance_amount_max));
        }
        if (filters.created_at_from) {
            conditions.push(`transitions.created_at >= ?`);
            params.push(filters.created_at_from);
        }
        if (filters.created_at_to) {
            conditions.push(`transitions.created_at <= ?`);
            params.push(filters.created_at_to);
        }

        // Append WHERE conditions
        if (conditions.length > 0) {
            sql += ` AND ${conditions.join(' AND ')}`;
        }

        // Handle sorting
        const sortableColumns = {
            companyName: 'companies.company_name',
            storeName: 'stores.store_name',
            amount: 'transitions.amount',
            balance_amount: 'transitions.balance_amount',
            created_at: 'transitions.created_at',
            'user.username': 'users.username',
            'debit_details.pay_to': "transitions.supplier",
            transition_type: 'transitions.transition_type',
            transition_id: 'transitions.tnx_id',
            default: 'transitions.created_at'
        };

        const sortField = sortableColumns[sortBy] || sortableColumns.default;
        sql += ` ORDER BY ${sortField} ${sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;

        // Handle pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);
        sql += ` LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);

        // Get total count for pagination
        let countSql = `
            SELECT COUNT(*) as total
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id  -- Fixed: Assume user_id
            WHERE transitions.cid = ?
        `;
        const countParams = [parseInt(cid)];
        if (conditions.length > 0) {
            countSql += ` AND ${conditions.join(' AND ')}`;
            countParams.push(...params.slice(1, params.length - 2)); // Exclude limit and offset
        }

        // Execute queries
        const [rows] = await pool.query(sql, params);
        const [countResult] = await pool.query(countSql, countParams);

        // Format data to match frontend expectations
        const formattedData = rows.map(row => {
            const debitDetails = typeof row.debit_details === 'string' ? JSON.parse(row.debit_details) : row.debit_details;
            return {
                tnx_id: row.tnx_id,
                company: row.company,
                store: row.store,
                username: row.username,
                supplier: row.supplier || null,
                transition_type: row.transition_type,
                amount: parseFloat(row.amount) || 0,
                balance: parseFloat(row.balance) || 0,
                created_at: row.created_at
            };
        });

        // Set headers and send response    
        res.set('x-total-count', countResult[0].total);
        res.status(200).json({
            message: 'Data fetched successfully',
            data: formattedData,
            total: countResult[0].total
        });
    } catch (err) {
        console.error('Error in getCompanytransitions:', err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Internal server error', error: err.message });
        }
    }
};


const getStoretransitions = async (req, res) => {
    const sid = req.params.sid;

    try {
        const { page = 1, limit = 25, sortBy = 'created_at', sortOrder = 'desc', search, ...filters } = req.query;

        // Split multiple store IDs
        const storeIds = sid.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        if (storeIds.length === 0) {
            return res.status(400).json({ message: 'Invalid store IDs provided' });
        }
        const placeholders = storeIds.map(() => '?').join(',');

        // Build the base SQL query
        let sql = `
            SELECT
                transitions.*,
                companies.company_name AS company,
                stores.store_name AS store,
                users.username AS username
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id  -- Fixed: Assume user_id, not username
            WHERE transitions.sid IN (${placeholders})
        `;
        let params = [...storeIds];

        // Initialize conditions
        const conditions = [];

        // Handle global search
        if (search) {
            conditions.push(`
                (transitions.tnx_id LIKE ? OR
                companies.company_name LIKE ? OR
                stores.store_name LIKE ? OR
                users.username LIKE ? OR
                transitions.debit_details->>'pay_to' LIKE ? OR
                transitions.transition_type LIKE ? OR
                CAST(transitions.amount AS CHAR) LIKE ? OR
                CAST(transitions.balance_amount AS CHAR) LIKE ? OR
                DATE_FORMAT(transitions.created_at, '%Y-%m-%d') LIKE ?)
            `);
            const searchTerm = `%${search}%`;
            params.push(
                searchTerm, searchTerm, searchTerm, searchTerm,
                searchTerm, searchTerm, searchTerm, searchTerm,
                searchTerm
            );
        }

        // Handle individual filters
        if (filters.transition_id) {
            conditions.push(`transitions.tnx_id LIKE ?`);
            params.push(`%${filters.transition_id}%`);
        }
        if (filters.company_id) {
            conditions.push(`transitions.cid = ?`);
            params.push(parseInt(filters.company_id));
        }
        if (filters['user.username']) {
            conditions.push(`users.username LIKE ?`);
            params.push(`%${filters['user.username']}%`);
        }
        if (filters['debit_details.pay_to']) {
            conditions.push(`transitions.debit_details->>'pay_to' LIKE ?`);
            params.push(`%${filters['debit_details.pay_to']}%`);
        }
        if (filters.transition_type) {
            conditions.push(`transitions.transition_type = ?`);
            params.push(filters.transition_type);
        }
        if (filters.amount_min) {
            conditions.push(`transitions.amount >= ?`);
            params.push(parseFloat(filters.amount_min));
        }
        if (filters.amount_max) {
            conditions.push(`transitions.amount <= ?`);
            params.push(parseFloat(filters.amount_max));
        }
        if (filters.balance_amount_min) {
            conditions.push(`transitions.balance_amount >= ?`);
            params.push(parseFloat(filters.balance_amount_min));
        }
        if (filters.balance_amount_max) {
            conditions.push(`transitions.balance_amount <= ?`);
            params.push(parseFloat(filters.balance_amount_max));
        }
        if (filters.created_at_from) {
            conditions.push(`transitions.created_at >= ?`);
            params.push(filters.created_at_from);
        }
        if (filters.created_at_to) {
            conditions.push(`transitions.created_at <= ?`);
            params.push(filters.created_at_to);
        }
        // Add support for store_id filter (optional, if table filter is needed)
        if (filters.store_id) {
            conditions.push(`transitions.sid = ?`);
            params.push(parseInt(filters.store_id));
        }

        // Append conditions
        if (conditions.length > 0) {
            sql += ` AND ${conditions.join(' AND ')}`;
        }

        // Define sortable columns
        const sortableColumns = {
            companyName: 'companies.company_name',
            storeName: 'stores.store_name',
            amount: 'transitions.amount',
            balance_amount: 'transitions.balance_amount',
            created_at: 'transitions.created_at',
            'user.username': 'users.username',
            'debit_details.pay_to': "transitions.debit_details->>'pay_to'",
            transition_type: 'transitions.transition_type',
            transition_id: 'transitions.tnx_id',
            default: 'transitions.created_at'
        };

        // Handle sorting
        const sortField = sortableColumns[sortBy] || sortableColumns.default;
        sql += ` ORDER BY ${sortField} ${sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;

        // Handle pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);
        sql += ` LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);


        // Count query
        let countSql = `
            SELECT COUNT(*) as total
            FROM transitions
            JOIN companies ON transitions.cid = companies.id
            JOIN stores ON transitions.sid = stores.id
            JOIN users ON transitions.username = users.id
            WHERE transitions.sid IN (${placeholders})
        `;
        let countParams = [...storeIds];
        if (conditions.length > 0) {
            countSql += ` AND ${conditions.join(' AND ')}`;
            countParams.push(...params.slice(storeIds.length, params.length - 2));
        }

        // Execute queries
        const [rows] = await pool.query(sql, params);
        const [countResult] = await pool.query(countSql, countParams);

        // Format data
        const formattedData = rows.map(row => {
            const debitDetails = typeof row.debit_details === 'string' ? JSON.parse(row.debit_details) : row.debit_details;
            return {
                tnx_id: row.tnx_id,
                company: row.company,
                store: row.store,
                username: row.username,
                supplier: row.supplier,
                transition_type: row.transition_type,
                amount: parseFloat(row.amount) || 0,
                balance: parseFloat(row.balance) || 0,
                created_at: row.created_at
            };
        });

        const total = countResult[0].total || 0;
        res.set('x-total-count', total);
        res.status(200).json({
            message: 'Data fetched successfully',
            data: formattedData,
            total
        });
    } catch (err) {
        console.error('Error in getStoretransitions:', err);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Internal server error', error: err.message });
        }
    }
};

module.exports = { getAlltransitions, getCompanytransitions, getStoretransitions };