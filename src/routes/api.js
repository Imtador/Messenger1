const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const db = require('../db');

// All routes require authentication
router.use(authMiddleware);

// GET /api/users - Get all users (for starting new conversations)
router.get('/users', (req, res) => {
  try {
    const users = db.users.findAll();
    // Remove current user from list
    const filtered = users.filter(u => u.id !== req.user.id);
    res.json({ users: filtered });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations - Get user's conversations
router.get('/conversations', (req, res) => {
  try {
    const conversations = db.conversations.getUserConversations(req.user.id);
    res.json({ conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations - Start or find existing conversation with a user
router.post('/conversations', (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot start conversation with yourself' });
    }

    const otherUser = db.users.findById(userId);
    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if conversation already exists
    let conversationId = db.conversations.findExisting(req.user.id, userId);

    if (!conversationId) {
      // Create new conversation
      conversationId = db.conversations.create();
      db.conversations.addParticipant(conversationId, req.user.id);
      db.conversations.addParticipant(conversationId, userId);
    }

    const conversation = db.conversations.getById(conversationId);
    res.json({ 
      conversation: {
        id: conversation.id,
        other_user_id: userId,
        other_username: otherUser.username
      }
    });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations/:id/messages - Get messages for a conversation
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const conversationId = parseInt(req.params.id);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const conversation = db.conversations.getById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify user is a participant
    const participants = db.db.prepare(
      'SELECT user_id FROM conversation_participants WHERE conversation_id = ?'
    ).all(conversationId);
    
    const isParticipant = participants.some(p => p.user_id === req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = db.messages.getByConversation(conversationId, limit);
    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
