const express = require('express');
const { hashPassword } = require('../utils/password');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwt');
const db = require('../config/database');
const { validationRules, validate } = require('../middleware/validator');

const router = express.Router();

// POST /api/auth/register
router.post('/register', validationRules.register, validate, async (req, res) => {
  try {
    const { username, email, password, publicKey, displayName } = req.body;

    // Check if username or email already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Username or email already exists',
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const result = await db.query(
      `INSERT INTO users (username, email, password_hash, display_name, public_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, display_name, created_at`,
      [username, email, passwordHash, displayName || username, publicKey]
    );

    const user = result.rows[0];

    // Generate tokens
    const accessToken = generateAccessToken({ userId: user.id, username: user.username });
    const refreshToken = generateRefreshToken({ userId: user.id });

    // Store refresh token hash
    const crypto = require('crypto');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshTokenHash]
    );

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/auth/login
router.post('/login', validationRules.login, validate, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await require('../utils/password').verifyPassword(
      user.password_hash,
      password
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ userId: user.id, username: user.username });
    const refreshToken = generateRefreshToken({ userId: user.id });

    // Store refresh token hash
    const crypto = require('crypto');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, refreshTokenHash]
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.display_name,
          publicKey: user.public_key,
          encryptedPrivateKey: user.encrypted_private_key,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/auth/refresh
router.post('/refresh', validationRules.refreshToken, validate, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = require('../utils/jwt').verifyToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
      });
    }

    // Check if token exists and is not revoked
    const crypto = require('crypto');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const tokenResult = await db.query(
      'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked = FALSE AND expires_at > NOW()',
      [refreshTokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token',
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken({ 
      userId: decoded.userId, 
      username: decoded.username 
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, display_name, avatar_url, public_key, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        publicKey: user.public_key,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PUT /api/auth/profile
router.put('/profile', 
  require('../middleware/auth').authenticate,
  validationRules.updateUser,
  validate,
  async (req, res) => {
    try {
      const { displayName, avatarUrl } = req.body;
      const updates = [];
      const values = [];
      let paramCount = 1;

      if (displayName !== undefined) {
        updates.push(`display_name = $${paramCount++}`);
        values.push(displayName);
      }

      if (avatarUrl !== undefined) {
        updates.push(`avatar_url = $${paramCount++}`);
        values.push(avatarUrl);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No fields to update',
        });
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(req.user.userId);

      const result = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
         RETURNING id, username, email, display_name, avatar_url`,
        values
      );

      res.json({
        success: true,
        data: {
          id: result.rows[0].id,
          username: result.rows[0].username,
          email: result.rows[0].email,
          displayName: result.rows[0].display_name,
          avatarUrl: result.rows[0].avatar_url,
        },
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

module.exports = router;
