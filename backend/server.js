require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/teltel';

app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'media_downloads')));

const schedulerService = require('./services/schedulerService');

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    schedulerService.initializeScheduler();
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

// Routes
// app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/telegram', require('./routes/telegramRoutes'));
app.use('/api/scheduler', require('./routes/schedulerRoutes'));

app.get('/', (req, res) => {
  res.send('TelTel API Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
