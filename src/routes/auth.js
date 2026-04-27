const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');

// Validation helpers
function validateUsername(username) {
  return typeof username === 'string' && username.length >= 3 && username.length <= 30 && /^[a-zA-Z0-9_]+$/.test(username);
}

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3-30 characters (alphanumeric and underscore only)' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be 6-128 characters' });
    }

    // Check uniqueness
    const existingUser = db.users.findByUsername(username) || db.users.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const userId = db.users.create(username, email, password);

    const accessToken = generateAccessToken(userId, username);
    const refreshToken = generateRefreshToken(userId);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.tokens.create(userId, refreshToken, expiresAt);

    res.status(201).json({
      message: 'Registration successful',
      user: { id: userId, username, email },
      accessToken,
      refreshToken
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.users.findByUsername(username);
    if (!user || !db.users.verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.users.updateLastSeen(user.id);

    const accessToken = generateAccessToken(user.id, user.username);
    const refreshToken = generateRefreshToken(user.id);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.tokens.create(user.id, refreshToken, expiresAt);

    res.json({
      message: 'Login successful',
      user: { id: user.id, username: user.username, email: user.email },
      accessToken,
      refreshToken
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const storedToken = db.tokens.find(refreshToken, decoded.userId);
    if (!storedToken) {
      return res.status(401).json({ error: 'Refresh token not found' });
    }

    const user = db.users.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Delete old token and issue new ones
    db.tokens.delete(refreshToken);

    const newAccessToken = generateAccessToken(user.id, user.username);
    const newRefreshToken = generateRefreshToken(user.id);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.tokens.create(user.id, newRefreshToken, expiresAt);

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const decoded = verifyRefreshToken(refreshToken);
      if (decoded) {
        db.tokens.delete(refreshToken);
      }
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.json({ message: 'Logged out successfully' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      created_at: req.user.created_at,
      last_seen: req.user.last_seen
    }
  });
});

module.exports = router;
