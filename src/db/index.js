const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '../../data/messenger.db');

const db = new Database(DB_PATH);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create schemas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL CHECK(length(username) >= 3 AND length(username) <= 30),
    email TEXT UNIQUE NOT NULL CHECK(length(email) <= 255),
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text' CHECK(type IN ('text', 'image', 'file')),
    file_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
  CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON conversation_participants(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
`);

// Prepared statements for users
const createUserStmt = db.prepare(
  'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
);
const findUserByUsername = db.prepare(
  'SELECT id, username, email, password_hash FROM users WHERE username = ?'
);
const findUserByEmail = db.prepare(
  'SELECT id, username, email, password_hash FROM users WHERE email = ?'
);
const findUserById = db.prepare(
  'SELECT id, username, email, created_at, last_seen FROM users WHERE id = ?'
);
const getAllUsers = db.prepare(
  'SELECT id, username, email, last_seen FROM users ORDER BY username ASC'
);
const updateLastSeen = db.prepare(
  'UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?'
);

// Prepared statements for conversations
const createConversation = db.prepare(
  'INSERT INTO conversations DEFAULT VALUES'
);
const addParticipant = db.prepare(
  'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)'
);
const getConversationById = db.prepare(
  'SELECT * FROM conversations WHERE id = ?'
);
const getUserConversations = db.prepare(`
  SELECT DISTINCT c.id, c.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
    (SELECT u.username FROM users u 
     JOIN conversation_participants cp ON u.id = cp.user_id 
     WHERE cp.conversation_id = c.id AND u.id != ? 
     LIMIT 1) as other_username,
    (SELECT u.id FROM users u 
     JOIN conversation_participants cp ON u.id = cp.user_id 
     WHERE cp.conversation_id = c.id AND u.id != ? 
     LIMIT 1) as other_user_id,
    (SELECT m.content FROM messages m 
     WHERE m.conversation_id = c.id 
     ORDER BY m.created_at DESC LIMIT 1) as last_message,
    (SELECT m.created_at FROM messages m 
     WHERE m.conversation_id = c.id 
     ORDER BY m.created_at DESC LIMIT 1) as last_message_at
  FROM conversations c
  JOIN conversation_participants cp ON c.id = cp.conversation_id
  WHERE cp.user_id = ?
  ORDER BY c.updated_at DESC
`);
const findExistingConversation = db.prepare(`
  SELECT c.id FROM conversations c
  JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
  JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
  WHERE cp1.user_id = ? AND cp2.user_id = ?
  AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
`);

// Prepared statements for messages
const insertMessage = db.prepare(
  'INSERT INTO messages (conversation_id, author_id, content, type, file_url) VALUES (?, ?, ?, ?, ?)'
);
const updateConversationTime = db.prepare(
  'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);
const getMessagesByConversation = db.prepare(`
  SELECT m.id, m.conversation_id, m.author_id, u.username as author, m.content, m.type, m.file_url, m.created_at
  FROM messages m
  JOIN users u ON m.author_id = u.id
  WHERE m.conversation_id = ?
  ORDER BY m.created_at DESC
  LIMIT ?
`);

// Prepared statements for refresh tokens
const insertRefreshToken = db.prepare(
  'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
);
const findRefreshToken = db.prepare(
  'SELECT * FROM refresh_tokens WHERE token = ? AND user_id = ?'
);
const deleteRefreshToken = db.prepare(
  'DELETE FROM refresh_tokens WHERE token = ?'
);
const deleteExpiredTokens = db.prepare(
  'DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP'
);

module.exports = {
  db,
  users: {
    create: (username, email, password) => {
      const hash = bcrypt.hashSync(password, 10);
      const result = createUserStmt.run(username, email, hash);
      return result.lastInsertRowid;
    },
    findByUsername: findUserByUsername.get.bind(findUserByUsername),
    findByEmail: findUserByEmail.get.bind(findUserByEmail),
    findById: findUserById.get.bind(findUserById),
    findAll: getAllUsers.all.bind(getAllUsers),
    updateLastSeen: updateLastSeen.run.bind(updateLastSeen),
    verifyPassword: (user, password) => bcrypt.compareSync(password, user.password_hash)
  },
  conversations: {
    create: () => {
      const result = createConversation.run();
      return result.lastInsertRowid;
    },
    addParticipant: addParticipant.run.bind(addParticipant),
    getById: getConversationById.get.bind(getConversationById),
    getUserConversations: (userId) => getUserConversations.all(userId, userId, userId),
    findExisting: (userId1, userId2) => {
      const result = findExistingConversation.get(userId1, userId2);
      return result ? result.id : null;
    }
  },
  messages: {
    create: (conversationId, authorId, content, type = 'text', fileUrl = null) => {
      const result = insertMessage.run(conversationId, authorId, content, type, fileUrl);
      updateConversationTime.run(conversationId);
      return result.lastInsertRowid;
    },
    getByConversation: (conversationId, limit = 50) => 
      getMessagesByConversation.all(conversationId, limit).reverse()
  },
  tokens: {
    create: (userId, token, expiresAt) => insertRefreshToken.run(userId, token, expiresAt),
    find: (token, userId) => findRefreshToken.get(token, userId),
    delete: deleteRefreshToken.run.bind(deleteRefreshToken),
    deleteExpired: deleteExpiredTokens.run.bind(deleteExpiredTokens)
  }
};
