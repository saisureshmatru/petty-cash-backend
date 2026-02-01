const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const jwt = require('jsonwebtoken');
const {authenticateToken} = require('../middleware/authMiddleware')

// Token verification middleware
const verifyToken = (req, res, next) => {
    // Try to get token from cookies first, then from Authorization header
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        console.log('No JWT token provided');
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET || "Hippocloud_wellcome", (err, decoded) => {
        if (err) {
            console.error('JWT verification failed:', err.message);
            return res.status(401).json({ message: 'Unauthorized: Invalid or Expired token' });
        }

        req.user = decoded;
        next();
    });
};

router.post('/', authController.login)
router.get('/protectedroute', verifyToken, authController.protectedroute)
router.get('/check', authController.checkAuth);
router.post('/logout', authController.logout);
router.get('/profile/:id',authenticateToken, authController.Profile)   
router.put('/profileupdate/:id', authenticateToken, authController.ProfileUpdate)
router.post('/otp',authController.sendotp)
router.post('/resetpassword', authController.resetpassword)
router.post('/createadmin', authController.createAdmin);
router.get('/getalladmins', authController.getAlladmins);
router.put('/updateadmin/:id', authController.updateAdmin);
router.delete('/deleteadmin/:id', authController.deleteAdmin);


module.exports = router;