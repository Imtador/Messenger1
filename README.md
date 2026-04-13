# Messenger1
# 📋 TECHNICAL SPECIFICATION: Personal Messenger
**Server OS:** Linux (Ubuntu/Debian)  
**Goal:** Fully functional product, accessible via HTTPS with auto-start and basic operational configuration

---

## 🔹 PHASE 1. Server Core and Database
### Tasks
1. Create project structure, initialize repository, configure dependencies.
2. Deploy HTTP server with basic routes (`/health`, `/api/auth/*`).
3. Connect database (SQLite or PostgreSQL), create schemas: `users`, `rooms`, `messages`.
4. Implement registration and authentication with input validation.
5. Configure secure password storage (hashing) and token/session issuance.

### Requirements
- RESTful API, JSON responses, standard HTTP status codes.
- Password hashing: `bcrypt` or `argon2`.
- Authentication: JWT (access + refresh) or HTTP-only cookies.
- Field validation: length, format, username/email uniqueness.
- Errors handled centrally; internal server details are not exposed.

### ✅ Acceptance Criteria
- User can register and receive a token/session.
- Data is persisted to the database; passwords are not stored in plaintext.
- API responds correctly to valid and invalid requests.

---

## 🔹 PHASE 2. Real-time Communication and Rooms
### Tasks
1. Integrate WebSocket transport (Socket.IO or `ws`).
2. Implement WebSocket authentication (token verification during handshake).
3. Add room logic: `join`, `leave`, `broadcast` by `room_id`.
4. Configure saving each message to the database before broadcasting.
5. Implement loading of the last 50 messages upon entering a room.
6. Add heartbeat, reconnection logic, and online status indicators.

### Requirements
- Message format: `{ id, room_id, author_id, content, type, created_at }`.
- Guaranteed delivery within an active session.
- Automatic client reconnection on connection drop.
- History limit: 50–100 messages per request.
- Statuses: `online` (connected), `offline` (disconnected >30 sec).

### ✅ Acceptance Criteria
- Two clients in the same room exchange messages in real time.
- Upon re-entry, history loads correctly; no duplicate messages.
- User statuses update accurately.

---

## 🔹 PHASE 3. Client Interface (Web)
### Tasks
1. Build the main UI: room list, chat area, input field, user panel.
2. Integrate WebSocket client with the interface.
3. Implement message rendering (timestamp, author, scroll, "mine/others" distinction).
4. Configure network state handling: disconnect, reconnect, outbound message queue.
5. Add basic UX elements: auto-scroll, input focus, loading indicator.

### Requirements
- Responsive layout (mobile + desktop).
- No blocking operations during send/receive.
- Client-side input validation (empty messages, special characters).
- Smooth scroll; position preserved when loading history.
- Graceful degradation on network loss (message queue persists until reconnection).

### ✅ Acceptance Criteria
- Interface is fully functional; messages display instantly.
- Network issues handled without crashes; message queue preserved during downtime.
- UI meets basic usability standards.

---

## 🔹 PHASE 4. Media and Extended Features
### Tasks
1. Implement image/file upload via the interface.
2. Configure server-side file storage (local directory or S3-compatible storage).
3. Generate previews; send file URL within the message.
4. Integrate `Notification API` for browser notifications.
5. Configure client-side optimization: image compression, size limits, progress bar.

### Requirements
- Supported formats: `JPEG`, `PNG`, `WEBP`, `MP4` (optional).
- File size limit: up to 10 MB.
- Secure filename handling (hash/UUID; block `.exe/.sh` extensions).
- Asynchronous upload without blocking the UI.
- Notifications request permission, avoid spam, and include sender name + message text.

### ✅ Acceptance Criteria
- Files upload, save, and display correctly in chat.
- Limits and validation work; upload errors are handled gracefully.
- Browser notifications arrive when the tab is inactive.

---
