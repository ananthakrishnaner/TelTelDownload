require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = require('./socket').init(server);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/teltel';

app.use(cors());
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'media_downloads')));

const schedulerService = require('./services/schedulerService');
const sessionManager = require('./services/sessionManager');

// Database Connection
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Connected');
    schedulerService.initializeScheduler();
    // Try to bring up the Telegram session at boot. If credentials are
    // missing, the manager stays in `disconnected`; the UI will surface
    // a "Sign in to Telegram" pill and the user can complete the flow.
    try { await sessionManager.connect(); } catch (e) { console.warn('Telegram session not ready at boot:', e.message); }
  })
  .catch(err => console.error('MongoDB Connection Error:', err));

// Broadcast session state changes over Socket.IO so the frontend can
// update the session pill without polling.
sessionManager.on('state', (state) => {
  try { io.emit('telegram:status', state); } catch (e) { /* ignore */ }
});

// Routes
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/telegram', require('./routes/telegramRoutes'));
app.use('/api/scheduler', require('./routes/schedulerRoutes'));
app.use('/api/media', require('./routes/mediaRoutes'));
app.use('/api/system', require('./routes/systemRoutes'));
app.use('/api', require('./routes/healthRoutes'));

app.get('/', (req, res) => {
  res.send('TelTel API Running');
});

io.on('connection', (socket) => {
  // Send current session state immediately on connect so the client pill
  // is correct from the first paint.
  socket.emit('telegram:status', sessionManager.getState());
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
