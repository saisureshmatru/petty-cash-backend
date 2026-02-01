const connection = require('../connections/connections');

const createRole = async (req, res) => {
  const { name, permissions, selfOnly } = req.body;
  
  // Start a transaction since we're making multiple related database operations
  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    // 1. First insert the role
    const [roleResult] = await conn.query(
      'INSERT INTO roles (name, self_only) VALUES (?, ?)',
      [name, selfOnly]
    );
    
    const roleId = roleResult.insertId;

    // 2. Process each permission module and action
    for (const [moduleName, actions] of Object.entries(permissions)) {
      // Get module ID
      const [moduleRows] = await conn.query(
        'SELECT id FROM permission_modules WHERE name = ?',
        [moduleName]
      );
      
      if (moduleRows.length === 0) {
        throw new Error(`Permission module '${moduleName}' not found`);
      }
      
      const moduleId = moduleRows[0].id;

      // For each action in the module
      for (const actionName of actions) {
        // Get action ID
        const [actionRows] = await conn.query(
          'SELECT id FROM permission_actions WHERE name = ?',
          [actionName]
        );
        
        if (actionRows.length === 0) {
          throw new Error(`Permission action '${actionName}' not found`);
        }
        
        const actionId = actionRows[0].id;

        // Insert the role_permission relationship
        await conn.query(
          'INSERT INTO role_permissions (role_id, module_id, action_id) VALUES (?, ?, ?)',
          [roleId, moduleId, actionId]
        );
      }
    }

    // Commit the transaction
    await conn.commit();
    
    // Return the created role with its ID
    res.status(201).json({
      id: roleId,
      name,
      permissions,
      selfOnly
    });

  } catch (error) {
    // Rollback on error
    await conn.rollback();
    
    console.error('Error creating role:', error);
    res.status(400).json({
      error: error.message || 'Failed to create role'
    });
  } finally {
    // Release the connection back to the pool
    conn.release();
  }
};



const getRoles = async (req, res) => {
  try {
    const conn = await connection.getConnection();

    // 1. Get all roles
    const [roles] = await conn.query('SELECT * FROM roles');

    // 2. Get all role_permissions joined with modules and actions
    const [permissions] = await conn.query(`
      SELECT 
        rp.role_id,
        pm.name AS moduleName,
        pa.name AS actionName
      FROM role_permissions rp
      JOIN permission_modules pm ON rp.module_id = pm.id
      JOIN permission_actions pa ON rp.action_id = pa.id
    `);

    // 3. Map permissions to roles
    const roleMap = {};

    for (const role of roles) {
      roleMap[role.id] = {
        id: role.id,
        name: role.name,
        selfOnly: role.self_only,
        permissions: {}  // Will be populated
      };
    }

    for (const perm of permissions) {
      const role = roleMap[perm.role_id];
      if (!role) continue;

      if (!role.permissions[perm.moduleName]) {
        role.permissions[perm.moduleName] = [];
      }

      role.permissions[perm.moduleName].push(perm.actionName);
    }

    // Convert to array
    const result = Object.values(roleMap);

    conn.release();

    res.status(200).json(result);

  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({
      error: 'Failed to fetch roles and permissions'
    });
  }
};


const updateRole = async (req, res) => {
  const { name, permissions, selfOnly } = req.body;
  const { id: roleId } = req.params;

  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    // 1. Update the role
    await conn.query(
      'UPDATE roles SET name = ?, self_only = ? WHERE id = ?',
      [name, selfOnly, roleId]
    );

    // 2. Delete old role_permissions
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

    // 3. Re-insert updated role_permissions
    for (const [moduleName, actions] of Object.entries(permissions)) {
      const [moduleRows] = await conn.query(
        'SELECT id FROM permission_modules WHERE name = ?',
        [moduleName]
      );

      if (moduleRows.length === 0) {
        throw new Error(`Permission module '${moduleName}' not found`);
      }

      const moduleId = moduleRows[0].id;

      for (const actionName of actions) {
        const [actionRows] = await conn.query(
          'SELECT id FROM permission_actions WHERE name = ?',
          [actionName]
        );

        if (actionRows.length === 0) {
          throw new Error(`Permission action '${actionName}' not found`);
        }

        const actionId = actionRows[0].id;

        await conn.query(
          'INSERT INTO role_permissions (role_id, module_id, action_id) VALUES (?, ?, ?)',
          [roleId, moduleId, actionId]
        );
      }
    }

    await conn.commit();

    res.status(200).json({
      id: roleId,
      name,
      permissions,
      selfOnly,
      message: 'Role updated successfully'
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error updating role:', error);
    res.status(400).json({
      error: error.message || 'Failed to update role'
    });
  } finally {
    conn.release();
  }
};


const deleteRole = async (req, res) => {
  const { id: roleId } = req.params;

  const conn = await connection.getConnection();
  await conn.beginTransaction();

  try {
    // 1. Delete role_permissions for this role
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

    // 2. Delete the role itself
    const [result] = await conn.query('DELETE FROM roles WHERE id = ?', [roleId]);

    if (result.affectedRows === 0) {
      throw new Error('Role not found');
    }

    await conn.commit();

    res.status(200).json({ message: 'Role deleted successfully' });

  } catch (error) {
    await conn.rollback();
    console.error('Error deleting role:', error);
    res.status(400).json({
      error: error.message || 'Failed to delete role'
    });
  } finally {
    conn.release();
  }
};



module.exports = { createRole, getRoles, updateRole, deleteRole };