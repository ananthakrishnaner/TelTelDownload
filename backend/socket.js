let io;
module.exports = {
  init: (httpServer) => {
    io = require('socket.io')(httpServer, {
      cors: {
        origin: '*', // Allow all for simplicity, Nginx proxies it anyway
        methods: ['GET', 'POST']
      }
    });
    return io;
  },
  getIO: () => {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
  }
};
