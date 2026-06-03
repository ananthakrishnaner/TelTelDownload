const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.post('/login', adminController.login);

// Example protected route wrapper (we can apply this middleware to other routes later)
// router.use(adminController.verifyToken);

module.exports = router;
