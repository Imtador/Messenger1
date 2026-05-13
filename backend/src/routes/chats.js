const express = require('express');
const db = require('../config/database');
const { validationRules, validate } = require('../middleware/validator');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/chats - Create or get existing chat
router.post('/', authenticate, validationRules.createChat, validate, async (req, res) => {
  try {
    const { type, name, memberIds } = req.body;

    if (type === 'direct') {
      // For direct chats, check if chat already exists
      if (!memberIds || memberIds.length !== 1) {
        return res.status(400).json({
          success: false,
          error: 'Direct chat requires exactly one member',
        });
      }

      const existingChat = await db.query(
        `SELECT c.id FROM chats c
         JOIN chat_members cm1 ON c.id = cm1.chat_id
         JOIN chat_members cm2 ON c.id = cm2.chat_id
         WHERE c.chat_type = 'direct'
           AND cm1.user_id = $1
           AND cm2.user_id = $2`,
        [req.user.userId, memberIds[0]]
      );

      if (existingChat.rows.length > 0) {
        // Return existing chat
        const chatId = existingChat.rows[0].id;
        
        const chatData = await db.query(
          `SELECT c.*, cm.last_read_message_id, cm.role
           FROM chats c
           JOIN chat_members cm ON c.id = cm.chat_id
           WHERE c.id = $1 AND cm.user_id = $2`,
          [chatId, req.user.userId]
        );

        return res.json({
          success: true,
          data: {
            id: chatData.rows[0].id,
            type: chatData.rows[0].chat_type,
            lastReadMessageId: chatData.rows[0].last_read_message_id,
            role: chatData.rows[0].role,
            createdAt: chatData.rows[0].created_at,
          },
        });
      }

      // Create new direct chat
      const chatResult = await db.query(
        `INSERT INTO chats (chat_type) VALUES ('direct') RETURNING *`
      );

      const chatId = chatResult.rows[0].id;

      // Add both users as members
      await db.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
        [chatId, req.user.userId, memberIds[0]]
      );

      res.status(201).json({
        success: true,
        data: {
          id: chatId,
          type: 'direct',
          createdAt: chatResult.rows[0].created_at,
        },
      });
    } else if (type === 'group') {
      if (!name || !memberIds || memberIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Group chat requires name and members',
        });
      }

      // Create group chat
      const chatResult = await db.query(
        `INSERT INTO chats (chat_type, name, created_by)
         VALUES ('group', $1, $2) RETURNING *`,
        [name, req.user.userId]
      );

      const chatId = chatResult.rows[0].id;

      // Add creator as owner
      await db.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [chatId, req.user.userId]
      );

      // Add other members
      if (memberIds.length > 0) {
        const memberValues = memberIds.map((mid, idx) => 
          `($1, $${idx + 2}, 'member')`
        ).join(', ');
        
        await db.query(
          `INSERT INTO chat_members (chat_id, user_id, role) VALUES ${memberValues}`,
          [chatId, ...memberIds]
        );
      }

      res.status(201).json({
        success: true,
        data: {
          id: chatId,
          type: 'group',
          name,
          createdAt: chatResult.rows[0].created_at,
        },
      });
    }
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/chats - List all chats with preview
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
         c.id,
         c.chat_type,
         c.name,
         c.avatar_url,
         c.created_at,
         cm.role,
         cm.last_read_message_id,
         m.content_encrypted,
         m.created_at as last_message_at,
         u.username as last_sender_username,
         (SELECT COUNT(*) FROM messages msg 
          WHERE msg.chat_id = c.id 
            AND msg.created_at > COALESCE(cm.last_read_message_id, '1970-01-01')
            AND msg.sender_id != $1) as unread_count
       FROM chats c
       JOIN chat_members cm ON c.id = cm.chat_id
       LEFT JOIN LATERAL (
         SELECT content_encrypted, created_at, sender_id
         FROM messages
         WHERE chat_id = c.id
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE cm.user_id = $1
       ORDER BY last_message_at DESC NULLS LAST`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: result.rows.map(chat => ({
        id: chat.id,
        type: chat.chat_type,
        name: chat.name,
        avatarUrl: chat.avatar_url,
        role: chat.role,
        lastReadMessageId: chat.last_read_message_id,
        lastMessageEncrypted: chat.content_encrypted,
        lastMessageAt: chat.last_message_at,
        lastSenderUsername: chat.last_sender_username,
        unreadCount: parseInt(chat.unread_count) || 0,
        createdAt: chat.created_at,
      })),
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/chats/:chatId/messages - Get messages with pagination
router.get('/:chatId/messages', authenticate, validationRules.getMessages, validate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, cursor } = req.query;

    // Verify user is a member of the chat
    const membership = await db.query(
      'SELECT * FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.userId]
    );

    if (membership.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    let query = `
      SELECT 
        m.id,
        m.chat_id,
        m.sender_id,
        m.content_encrypted,
        m.content_iv,
        m.content_tag,
        m.message_type,
        m.reply_to,
        m.is_edited,
        m.is_deleted,
        m.created_at,
        u.username as sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1
    `;

    const params = [chatId];

    if (cursor) {
      query += ' AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)';
      params.push(cursor);
    }

    query += ' ORDER BY m.created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: {
        messages: result.rows.map(msg => ({
          id: msg.id,
          chatId: msg.chat_id,
          senderId: msg.sender_id,
          senderUsername: msg.sender_username,
          contentEncrypted: msg.content_encrypted,
          contentIv: msg.content_iv,
          contentTag: msg.content_tag,
          messageType: msg.message_type,
          replyTo: msg.reply_to,
          isEdited: msg.is_edited,
          isDeleted: msg.is_deleted,
          createdAt: msg.created_at,
        })),
        nextCursor: result.rows.length > 0 ? result.rows[result.rows.length - 1].id : null,
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
