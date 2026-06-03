const jwt = require('jsonwebtoken');
const logActivity = require('../utils/logger');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

exports.login = (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });
    logActivity('Admin Login Success', { username });
    res.json({ token });
  } else {
    logActivity('Admin Login Failed', { username, attempt: password }, 'warning');
    res.status(401).json({ error: 'Invalid credentials' });
  }
};

exports.verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ success: false, message: 'Unauthorized' });
    req.user = decoded;
    next();
  });
};
