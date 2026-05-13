# SecureChat Messenger

A fully functional encrypted web messenger with 1-to-1 chats, group chats, and file transfer.

## Features

- **End-to-End Encryption**: Messages are encrypted client-side using AES-256-GCM
- **ECDH Key Exchange**: Secure key derivation for 1-to-1 chats
- **Group Chats**: With member management and key rotation
- **File Transfer**: Encrypted file uploads with MinIO storage
- **Real-time Messaging**: WebSocket-based instant messaging
- **Offline Support**: Message queue for offline users
- **Responsive UI**: Works on mobile and desktop

## Tech Stack

### Backend
- Node.js + Express
- PostgreSQL (database)
- Redis (cache & pub/sub)
- Socket.IO (WebSocket)
- MinIO (S3-compatible object storage)
- Argon2id (password hashing)
- JWT (authentication)

### Frontend
- React 18
- Vite (build tool)
- Web Crypto API (encryption)
- IndexedDB (local storage)
- Socket.IO Client

### Infrastructure
- Docker & Docker Compose
- Caddy (reverse proxy with auto-HTTPS)
- Let's Encrypt (SSL certificates)

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local development)

### Development Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd securechat
```

2. **Configure environment variables**
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your settings
```

3. **Start all services**
```bash
cd docker
docker-compose up -d
```

4. **Install dependencies**
```bash
# Backend
cd ../backend
npm install

# Frontend
cd ../frontend
npm install
```

5. **Run in development mode**
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

6. **Access the application**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MinIO Console: http://localhost:9001

## Production Deployment

1. **Set required environment variables**
```bash
export JWT_SECRET=$(openssl rand -hex 32)
export DB_PASSWORD=$(openssl rand -base64 32)
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=$(openssl rand -base64 32)
export FRONTEND_URL=https://yourdomain.com
```

2. **Update Caddyfile with your domain**
```bash
# Edit docker/Caddyfile
# Replace example.com with your actual domain
```

3. **Deploy with Docker Compose**
```bash
cd docker
docker-compose -f docker-compose.yml up -d --build
```

4. **Verify deployment**
```bash
docker-compose ps
docker-compose logs -f
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Contacts
- `GET /api/contacts/search?q=query` - Search users
- `GET /api/contacts` - Get contact list
- `POST /api/contacts/request` - Send contact request
- `PUT /api/contacts/:id/status` - Accept/reject request
- `DELETE /api/contacts/:id` - Remove contact

### Chats
- `POST /api/chats` - Create chat
- `GET /api/chats` - List chats
- `GET /api/chats/:id/messages` - Get messages

### WebSocket Events
- `message:send` - Send message
- `message:new` - Receive message
- `typing:start` - Start typing
- `typing:stop` - Stop typing
- `message:read` - Read receipt
- `user:online` - User came online
- `user:offline` - User went offline

## Security Features

- **Password Hashing**: Argon2id with configurable parameters
- **JWT Authentication**: Short-lived access tokens + refresh tokens
- **Client-side Encryption**: AES-256-GCM for messages
- **ECDH Key Exchange**: P-256 curve for shared secrets
- **Secure Headers**: Helmet.js with CSP, HSTS
- **Rate Limiting**: Configurable rate limits on all endpoints
- **CORS**: Restricted to frontend domain
- **Input Validation**: express-validator on all inputs

## Database Schema

- `users` - User accounts with ECDH public keys
- `contacts` - Contact relationships
- `chats` - Chat rooms (direct & group)
- `chat_members` - Chat membership
- `messages` - Encrypted messages
- `attachments` - File metadata
- `chat_keys` - Group chat encryption keys
- `refresh_tokens` - JWT refresh tokens
- `push_subscriptions` - Web push notifications

## License

MIT
