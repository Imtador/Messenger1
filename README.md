# 📋 TECHNICAL SPECIFICATION: SecureChat Messenger

**Server OS:** Linux (Ubuntu/Debian)
**Goal:** Fully functional encrypted web messenger with 1-to-1 chats, group chats, and file transfer. Accessible via HTTPS with auto-start and basic operational configuration.

---

## 🔹 PHASE 1. Server Core, Database, and Authentication

### Tasks
- Create project structure, initialize repository, configure dependencies.
- Deploy HTTP server with basic routes (`/health`, `/api/auth/*`).
- Connect database (PostgreSQL) and cache (Redis); create schemas: `users`, `contacts`, `chats`, `chat_members`, `messages`, `attachments`, `chat_keys`.
- Implement registration with ECDH public key submission.
- Implement authentication with input validation and token issuance.
- Configure secure password storage (Argon2id) and JWT management (access + refresh).
- Implement user profile retrieval and updates.

### Requirements
- RESTful API, JSON responses, standard HTTP status codes.
- Password hashing: Argon2id.
- Authentication: JWT (short-lived access + refresh) or HTTP-only cookies.
- Field validation: length, format, username/email uniqueness.
- Errors handled centrally; internal server details are not exposed.
- Client generates ECDH key pair on registration; public key stored on server, private key encrypted with password (PBKDF2 + AES-256-GCM) and stored in browser IndexedDB.

### ✅ Acceptance Criteria
- User can register and receive a token/session.
- Data is persisted to the database; passwords are not stored in plaintext.
- API responds correctly to valid and invalid requests.
- ECDH key pair generated; public key on server, encrypted private key in IndexedDB.

---

## 🔹 PHASE 2. Contacts and Chat Management

### Tasks
- Implement user search by username/display name.
- Implement contact management: send request, accept/reject, remove, list contacts.
- Implement 1-to-1 chat creation (create or return existing).
- Implement chat listing with last message preview and unread count.
- Derive shared encryption key for 1-to-1 chats via ECDH (private key + recipient's public key).

### Requirements
- Contact requests are bidirectional; status tracking (pending, accepted, blocked).
- Duplicate 1-to-1 chat creation returns the existing chat.
- Chat list sorted by last message timestamp.
- Shared secret derived via ECDH; AES-256-GCM key established for each 1-to-1 chat.
- Server never has access to the derived encryption key.

### ✅ Acceptance Criteria
- Full contact lifecycle works: request → accept → appear in list → remove.
- 1-to-1 chat created between two users; duplicate creation returns same chat.
- Chat list displays correctly with previews and unread counts.
- ECDH shared secret derived correctly on both clients independently.

---

## 🔹 PHASE 3. Real-time Messaging and Encryption

### Tasks
- Integrate WebSocket transport (Socket.IO).
- Implement WebSocket authentication (token verification during handshake).
- Implement room logic: join `user:{id}` and `chat:{chatId}`, broadcast by chat_id.
- Configure saving each encrypted message to the database before broadcasting.
- Implement loading of the last 50 messages upon entering a chat (cursor pagination).
- Implement client-side message encryption/decryption (AES-256-GCM).
- Add heartbeat, reconnection logic, and online status indicators.
- Implement offline message queue (Redis); deliver pending messages on reconnect.
- Implement typing indicators and read receipts.

### Requirements
- Message format: `{ id, chat_id, sender_id, content_encrypted, content_iv, content_tag, message_type, reply_to, created_at }`.
- Messages encrypted client-side before transmission; server stores only ciphertext.
- Guaranteed delivery within an active session; pending messages delivered on reconnect.
- Automatic client reconnection on connection drop.
- History limit: 50 messages per request; cursor-based pagination.
- Statuses: online (connected), offline (disconnected >30 sec).
- Typing indicators throttled (1 event per 3 seconds).
- Read receipts update `last_read_message_id` in `chat_members`.

### ✅ Acceptance Criteria
- Two clients in the same chat exchange encrypted messages in real time.
- Messages are unreadable in the database; decrypt correctly on the receiver side.
- Upon re-entry, history loads correctly; no duplicate messages.
- User statuses update accurately.
- Offline users receive all missed messages upon reconnection.
- Typing indicators and read receipts function correctly.

---

## 🔹 PHASE 4. Group Chats and Key Management

### Tasks
- Implement group chat creation with member selection.
- Implement group key generation and distribution (random AES-256 key encrypted with each member's public key).
- Implement member management: add, remove, change roles (owner, admin, member).
- Implement key rotation on membership changes (new AES key, increment version).
- Implement group metadata updates (name, description, avatar).
- Implement leaving a group (require owner transfer if last owner).
- Generate system messages for membership events ("X added Y", "Y left").

### Requirements
- Group chat key encrypted individually for each member; stored in `chat_keys` table.
- Key rotation mandatory on member add (new member can't read old messages) and member remove (removed member can't read new messages).
- Role hierarchy: owner > admin > member. Cannot remove last owner.
- System messages generated automatically for join/leave/role change events.
- All key operations performed client-side; server only stores encrypted keys.

### ✅ Acceptance Criteria
- Group created with all members receiving encrypted chat keys.
- Removed member cannot decrypt new messages; new member cannot decrypt old messages.
- Role changes enforced correctly; last owner cannot leave without transfer.
- System messages appear for all membership events.

---

## 🔹 PHASE 5. File Transfer and Media

### Tasks
- Implement presigned URL generation for direct upload to MinIO (S3-compatible storage).
- Implement client-side file encryption (random AES-256 key per file, encrypt before upload).
- Implement file key encryption with chat key; store in `attachments` table.
- Implement file download with client-side decryption.
- Implement image thumbnail generation, encryption, and storage.
- Configure file limits and validation (size, MIME types, user quota).

### Requirements
- Supported formats: JPEG, PNG, WEBP, GIF, PDF, common document formats.
- File size limit: up to 100 MB.
- User quota: 1 GB per user.
- Secure filename handling (UUID; block executable extensions).
- Asynchronous upload/download without blocking the UI.
- File encryption key encrypted with the chat's symmetric key; stored in database.
- Thumbnails encrypted with the same file key.

### ✅ Acceptance Criteria
- Files upload, save, and display correctly in chat.
- Uploaded files are unreadable in storage without the decryption key.
- Files download and decrypt correctly on the receiving client.
- Limits and validation work; upload errors are handled gracefully.
- Image thumbnails display in chat; full image available on click.

---

## 🔹 PHASE 6. Client Interface (Web)

### Tasks
- Build the main UI: chat list sidebar, chat area, input field, user panel.
- Integrate WebSocket client with the interface.
- Implement message rendering (timestamp, author, scroll, "mine/others" distinction, encryption status).
- Implement contact management UI: search, add, accept/reject, list.
- Implement group chat UI: creation, member management, role assignment.
- Implement file upload UI: drag-drop, progress bar, attachment display.
- Configure network state handling: disconnect, reconnect, outbound message queue.
- Add basic UX elements: auto-scroll, input focus, loading indicator, responsive layout.

### Requirements
- Responsive layout (mobile + desktop).
- No blocking operations during send/receive.
- Client-side input validation (empty messages, special characters).
- Smooth scroll; position preserved when loading history.
- Graceful degradation on network loss (message queue persists until reconnection).
- Visual indicators for encrypted messages, read receipts, and typing status.
- File attachments display inline (images) or as downloadable links (documents).

### ✅ Acceptance Criteria
- Interface is fully functional; messages display instantly.
- Network issues handled without crashes; message queue preserved during downtime.
- UI meets basic usability standards across mobile and desktop.
- All features (contacts, 1-to-1, groups, files) accessible and functional through the interface.

---

## 🔹 PHASE 7. Notifications, Search, and Extended Features

### Tasks
- Integrate Web Push Notification API for browser notifications.
- Implement sound notifications with toggle.
- Implement server-side chat search by group name/contact name.
- Implement client-side message search by decrypted content in IndexedDB cache.
- Implement message editing and deletion with real-time propagation.
- Implement reply-to functionality with quoted message display.

### Requirements
- Notifications request permission; avoid spam.
- Push notification content: sender name + "New message" only (no encrypted content leaked).
- Server-side search limited to metadata (chat names, contact names); message content is encrypted.
- Client-side search operates on locally decrypted and cached messages.
- Edited messages marked with "(edited)"; deleted messages replaced with "Message deleted".
- Reply messages display quoted excerpt with scroll-to-original functionality.

### ✅ Acceptance Criteria
- Browser notifications arrive when the tab is inactive; no content leaked.
- Sound notifications play on new messages; toggle works.
- Server-side search returns matching chats/contacts.
- Client-side search finds messages by text content.
- Edit and delete operations propagate to all participants in real time.
- Reply functionality links to original message correctly.

---

## 🔹 PHASE 8. Testing, Security, and Deployment

### Tasks
- Write unit tests for backend services (auth, encryption, chat management); target >80% coverage on critical paths.
- Write E2E tests for API flow (registration → login → chat → message → file).
- Write unit tests for frontend components (forms, crypto module, store).
- Write E2E tests for frontend flow (Playwright: register → login → chat → send → receive).
- Conduct security audit: SQL injection, XSS, CSRF, rate limiting, brute force protection, JWT security.
- Conduct load testing (k6: 100 concurrent users, 10 msg/sec; target <200ms avg response).
- Create production Docker Compose configuration.
- Create server setup script (Docker, UFW firewall, fail2ban, deploy user).
- Configure Caddy reverse proxy with auto-HTTPS (Let's Encrypt) and HSTS.
- Configure monitoring (Prometheus + Grafana dashboards).
- Configure backups (PostgreSQL, MinIO, Redis) with daily cron and 30-day retention.
- Generate Swagger/OpenAPI documentation.
- Write user guide and admin guide.

### Requirements
- All tests pass before deployment.
- Rate limiting on all public endpoints.
- JWT: short TTL, HTTP-only cookies or secure token storage.
- Docker containers run as non-root user.
- UFW firewall: allow 22, 80, 443 only.
- fail2ban configured and running.
- SSH key-only authentication (disable password login).
- Structured JSON logging at INFO level.
- No secrets in code (environment variables only).
- CORS restricted to frontend domain.
- CSP headers configured.
- Backup restore tested and verified.

### ✅ Acceptance Criteria
- All tests pass; coverage >80% on critical backend paths.
- Security audit reveals no critical vulnerabilities.
- Load test meets performance targets (<200ms avg, no memory leaks).
- Production deployment works on clean Ubuntu/Debian server.
- SSL Labs rating A+.
- Monitoring dashboards show live metrics.
- Backup restore succeeds.
- API documentation is complete and accurate.
- New user can follow user guide; admin can deploy and maintain using admin guide.
