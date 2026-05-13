const { body, param, query, validationResult } = require('express-validator');

const validationRules = {
  register: [
    body('username')
      .trim()
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3-50 characters, alphanumeric and underscores only'),
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Invalid email format'),
    body('password')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be 8-128 characters'),
    body('publicKey')
      .notEmpty()
      .withMessage('Public key is required'),
    body('displayName')
      .optional()
      .trim()
      .isLength({ max: 100 }),
  ],

  login: [
    body('email').trim().isEmail().normalizeEmail().withMessage('Invalid email'),
    body('password').notEmpty().withMessage('Password is required'),
  ],

  refreshToken: [
    body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  ],

  updateUser: [
    body('displayName')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Display name must be under 100 characters'),
    body('avatarUrl')
      .optional()
      .trim()
      .isURL()
      .withMessage('Invalid avatar URL'),
  ],

  searchUsers: [
    query('q')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Search query must be 1-50 characters'),
  ],

  contactRequest: [
    body('userId')
      .trim()
      .isUUID()
      .withMessage('Invalid user ID'),
  ],

  createChat: [
    body('type')
      .isIn(['direct', 'group'])
      .withMessage('Chat type must be direct or group'),
    body('name')
      .optional()
      .trim()
      .isLength({ max: 255 }),
    body('memberIds')
      .optional()
      .isArray()
      .withMessage('Member IDs must be an array'),
  ],

  sendMessage: [
    body('chatId').trim().isUUID().withMessage('Invalid chat ID'),
    body('contentEncrypted').notEmpty().withMessage('Encrypted content is required'),
    body('contentIv').notEmpty().withMessage('IV is required'),
    body('contentTag').notEmpty().withMessage('Auth tag is required'),
    body('messageType')
      .optional()
      .isIn(['text', 'image', 'file', 'system']),
    body('replyTo')
      .optional()
      .trim()
      .isUUID(),
  ],

  getMessages: [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Limit must be between 1 and 50'),
    query('cursor')
      .optional()
      .trim()
      .isUUID(),
  ],
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
};

module.exports = {
  validationRules,
  validate,
};
