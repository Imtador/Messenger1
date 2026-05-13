const { Server } = require('socket.io');
const jwt = require('../utils/jwt');
const db = require('../config/database');
const redis = require('../config/redis');

let io;

function initializeWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Middleware for authentication
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const decoded = jwt.verifyToken(token);
    if (!decoded) {
      return next(new Error('Invalid token'));
    }

    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  });

  io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.userId} (${socket.username})`);

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Update online status in Redis
    await redis.set(`online:${socket.userId}`, JSON.stringify({
      socketId: socket.id,
      timestamp: Date.now(),
    }), { EX: 60 });

    // Get user's chats and join chat rooms
    const chats = await db.query(
      'SELECT chat_id FROM chat_members WHERE user_id = $1',
      [socket.userId]
    );

    for (const chat of chats.rows) {
      socket.join(`chat:${chat.chat_id}`);
    }

    // Notify contacts of online status
    socket.to(`user:${socket.userId}`).emit('user:online', { userId: socket.userId });

    // Handle sending messages
    socket.on('message:send', async (data, callback) => {
      try {
        const { chatId, contentEncrypted, contentIv, contentTag, messageType = 'text', replyTo } = data;

        // Verify user is a member of the chat
        const membership = await db.query(
          'SELECT * FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, socket.userId]
        );

        if (membership.rows.length === 0) {
          return callback?.({ success: false, error: 'Access denied' });
        }

        // Save message to database
        const result = await db.query(
          `INSERT INTO messages 
           (chat_id, sender_id, content_encrypted, content_iv, content_tag, message_type, reply_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [chatId, socket.userId, contentEncrypted, contentIv, contentTag, messageType, replyTo || null]
        );

        const message = result.rows[0];

        // Broadcast to chat room
        io.to(`chat:${chatId}`).emit('message:new', {
          id: message.id,
          chatId: message.chat_id,
          senderId: message.sender_id,
          senderUsername: socket.username,
          contentEncrypted: message.content_encrypted,
          contentIv: message.content_iv,
          contentTag: message.content_tag,
          messageType: message.message_type,
          replyTo: message.reply_to,
          createdAt: message.created_at,
        });

        // Store offline messages in Redis for delivery tracking
        await redis.lpush(`offline:${chatId}`, JSON.stringify(message));
        await redis.expire(`offline:${chatId}`, 86400); // 24 hours

        callback?.({ success: true, messageId: message.id });
      } catch (error) {
        console.error('Send message error:', error);
        callback?.({ success: false, error: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing:start', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('typing:update', {
        userId: socket.userId,
        username: socket.username,
        chatId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('typing:update', {
        userId: socket.userId,
        username: socket.username,
        chatId,
        isTyping: false,
      });
    });

    // Handle read receipts
    socket.on('message:read', async (data) => {
      try {
        const { chatId, messageId } = data;

        await db.query(
          `UPDATE chat_members 
           SET last_read_message_id = $1 
           WHERE chat_id = $2 AND user_id = $3`,
          [messageId, chatId, socket.userId]
        );

        socket.to(`chat:${chatId}`).emit('receipt:read', {
          userId: socket.userId,
          chatId,
          messageId,
        });

        callback?.({ success: true });
      } catch (error) {
        console.error('Read receipt error:', error);
        callback?.({ success: false, error: 'Failed to update read status' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.userId}`);
      
      // Remove from Redis
      await redis.del(`online:${socket.userId}`);
      
      // Notify contacts
      socket.to(`user:${socket.userId}`).emit('user:offline', { userId: socket.userId });
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('WebSocket not initialized');
  }
  return io;
}

module.exports = {
  initializeWebSocket,
  getIO,
};
