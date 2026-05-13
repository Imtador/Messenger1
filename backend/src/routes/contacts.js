const express = require('express');
const db = require('../config/database');
const { validationRules, validate } = require('../middleware/validator');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/contacts/search?q=query
router.get('/search', authenticate, validationRules.searchUsers, validate, async (req, res) => {
  try {
    const { q } = req.query;

    const result = await db.query(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE (username ILIKE $1 OR display_name ILIKE $1)
         AND id != $2
       LIMIT 20`,
      [`%${q}%`, req.user.userId]
    );

    res.json({
      success: true,
      data: result.rows.map(user => ({
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      })),
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/contacts
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.status, u.id, u.username, u.display_name, u.avatar_url
       FROM contacts c
       JOIN users u ON c.contact_user_id = u.id
       WHERE c.user_id = $1
       ORDER BY u.username`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: result.rows.map(contact => ({
        userId: contact.id,
        username: contact.username,
        displayName: contact.display_name,
        avatarUrl: contact.avatar_url,
        status: contact.status,
      })),
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/contacts/request
router.post('/request', authenticate, validationRules.contactRequest, validate, async (req, res) => {
  try {
    const { userId } = req.body;

    // Check if contact already exists
    const existing = await db.query(
      'SELECT * FROM contacts WHERE user_id = $1 AND contact_user_id = $2',
      [req.user.userId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Contact request already exists',
      });
    }

    // Create contact request
    await db.query(
      `INSERT INTO contacts (user_id, contact_user_id, status)
       VALUES ($1, $2, 'pending')`,
      [req.user.userId, userId]
    );

    res.status(201).json({
      success: true,
      message: 'Contact request sent',
    });
  } catch (error) {
    console.error('Send contact request error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PUT /api/contacts/:contactId/status
router.put('/:contactId/status', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;
    const { status } = req.body;

    if (!['accepted', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status',
      });
    }

    const result = await db.query(
      `UPDATE contacts
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND contact_user_id = $3
       RETURNING *`,
      [status, req.user.userId, contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.json({
      success: true,
      data: { status },
    });
  } catch (error) {
    console.error('Update contact status error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// DELETE /api/contacts/:contactId
router.delete('/:contactId', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;

    const result = await db.query(
      'DELETE FROM contacts WHERE user_id = $1 AND contact_user_id = $2 RETURNING *',
      [req.user.userId, contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.json({
      success: true,
      message: 'Contact removed',
    });
  } catch (error) {
    console.error('Remove contact error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

module.exports = router;
