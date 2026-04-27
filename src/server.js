const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');
const { verifyAccessToken } = require('./utils/jwt');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Clean up expired tokens on startup
db.tokens.deleteExpired();

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api', uploadRoutes);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Online users tracking
const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // userId -> socket instance

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return next(new Error('Invalid token'));
  }

  const user = db.users.findById(decoded.userId);
  if (!user) {
    return next(new Error('User not found'));
  }

  socket.user = user;
  next();
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  const userId = socket.user.id;
  const username = socket.user.username;

  console.log(`User connected: ${username} (${userId})`);

  // Track online user
  onlineUsers.set(userId, socket.id);
  userSockets.set(userId, socket);
  db.users.updateLastSeen(userId);

  // Broadcast online status
  io.emit('user:online', { userId, username });

  // Join a conversation
  socket.on('conversation:join', (data) => {
    const { conversationId } = data;
    const conversation = db.conversations.getById(conversationId);
    
    if (!conversation) {
      return socket.emit('error', { message: 'Conversation not found' });
    }

    // Verify user is a participant
    const participants = db.db.prepare(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
    ).all(conversationId);
    
    const isParticipant = participants.some(p => p.user_id === userId);
    if (!isParticipant) {
      return socket.emit('error', { message: 'Access denied' });
    }

    socket.join(`conversation:${conversationId}`);
    socket.currentConversation = conversationId;

    // Load last 50 messages
    const messages = db.messages.getByConversation(conversationId, 50);
    socket.emit('conversation:history', { conversationId, messages });

    // Notify other participant
    socket.to(`conversation:${conversationId}`).emit('conversation:user_online', { userId, username, conversationId });
  });

  // Leave a conversation
  socket.on('conversation:leave', (data) => {
    const { conversationId } = data;
    socket.leave(`conversation:${conversationId}`);
    socket.to(`conversation:${conversationId}`).emit('conversation:user_left', { userId, username, conversationId });
  });

  // Send a message
  socket.on('message:send', (data) => {
    const { conversationId, content, type = 'text', fileUrl = null } = data;

    if (!content || content.trim().length === 0) {
      return socket.emit('error', { message: 'Message cannot be empty' });
    }

    if (content.length > 5000) {
      return socket.emit('error', { message: 'Message too long (max 5000 characters)' });
    }

    try {
      // Save to database
      const messageId = db.messages.create(conversationId, userId, content.trim(), type, fileUrl);
      
      const message = {
        id: messageId,
        conversation_id: conversationId,
        author_id: userId,
        author: username,
        content: content.trim(),
        type,
        file_url: fileUrl,
        created_at: new Date().toISOString()
      };

      // Broadcast to conversation participants
      io.to(`conversation:${conversationId}`).emit('message:new', message);
    } catch (err) {
      console.error('Message send error:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Typing indicator
  socket.on('typing:start', (data) => {
    const { conversationId } = data;
    socket.to(`conversation:${conversationId}`).emit('typing:update', { userId, username, conversationId, typing: true });
  });

  socket.on('typing:stop', (data) => {
    const { conversationId } = data;
    socket.to(`conversation:${conversationId}`).emit('typing:update', { userId, username, conversationId, typing: false });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${username} (${userId})`);
    onlineUsers.delete(userId);
    userSockets.delete(userId);

    // Delay before marking as offline (30 sec grace period)
    setTimeout(() => {
      if (!onlineUsers.has(userId)) {
        io.emit('user:offline', { userId, username });
      }
    }, 30000);
  });

  // Heartbeat
  socket.on('ping', () => {
    socket.emit('pong');
    db.users.updateLastSeen(userId);
  });
});

// Helper to get online users
function getOnlineUsers() {
  return Array.from(onlineUsers.entries()).map(([userId, socketId]) => ({
    userId,
    username: userSockets.get(userId)?.user?.username || 'Unknown'
  }));
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Messenger1 server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});

module.exports = { app, server, io, getOnlineUsers };
