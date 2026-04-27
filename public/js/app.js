// Messenger1 Client Application - Private Chat
(function() {
  'use strict';

  // State
  const state = {
    user: null,
    accessToken: null,
    refreshToken: null,
    socket: null,
    currentConversation: null,
    conversations: [],
    onlineUsers: new Map(),
    allUsers: [],
    messageQueue: [],
    isReconnecting: false,
    typingTimeout: null,
    heartbeatInterval: null
  };

  // DOM Elements
  const elements = {
    authScreen: document.getElementById('auth-screen'),
    appScreen: document.getElementById('app-screen'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    loginError: document.getElementById('login-error'),
    registerError: document.getElementById('register-error'),
    conversationList: document.getElementById('conversation-list'),
    onlineUsersList: document.getElementById('online-users-list'),
    currentUsername: document.getElementById('current-username'),
    chatName: document.getElementById('chat-name'),
    messagesContainer: document.getElementById('messages-container'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    connectionStatus: document.getElementById('connection-status'),
    typingIndicator: document.getElementById('typing-indicator'),
    newChatBtn: document.getElementById('new-chat-btn'),
    newChatModal: document.getElementById('new-chat-modal'),
    userList: document.getElementById('user-list'),
    cancelNewChatBtn: document.getElementById('cancel-new-chat-btn'),
    logoutBtn: document.getElementById('logout-btn'),
    uploadBtn: document.getElementById('upload-btn'),
    fileInput: document.getElementById('file-input'),
    uploadProgress: document.getElementById('upload-progress'),
    progressFill: document.getElementById('progress-fill'),
    uploadStatus: document.getElementById('upload-status'),
    imagePreviewModal: document.getElementById('image-preview-modal'),
    previewImage: document.getElementById('preview-image'),
    closePreviewBtn: document.getElementById('close-preview-btn')
  };

  // API Helper
  async function api(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.accessToken) {
      headers['Authorization'] = `Bearer ${state.accessToken}`;
    }

    try {
      const response = await fetch(`/api${endpoint}`, {
        ...options,
        headers: { ...headers, ...options.headers }
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 && state.accessToken) {
          await refreshToken();
          headers['Authorization'] = `Bearer ${state.accessToken}`;
          const retryResponse = await fetch(`/api${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
          });
          return await retryResponse.json();
        }
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        throw new Error('Network error. Please check your connection.');
      }
      throw err;
    }
  }

  // Token Refresh
  async function refreshToken() {
    if (!state.refreshToken) throw new Error('No refresh token');
    
    const data = await api('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: state.refreshToken })
    });

    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    saveSession();
  }

  // Session Management
  function saveSession() {
    localStorage.setItem('messenger_session', JSON.stringify({
      user: state.user,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken
    }));
  }

  function loadSession() {
    const saved = localStorage.getItem('messenger_session');
    if (saved) {
      const session = JSON.parse(saved);
      state.user = session.user;
      state.accessToken = session.accessToken;
      state.refreshToken = session.refreshToken;
      return true;
    }
    return false;
  }

  function clearSession() {
    localStorage.removeItem('messenger_session');
    state.user = null;
    state.accessToken = null;
    state.refreshToken = null;
  }

  // Auth Functions
  async function login(username, password) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    state.user = data.user;
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    saveSession();
    showApp();
  }

  async function register(username, email, password) {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });

    state.user = data.user;
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    saveSession();
    showApp();
  }

  async function logout() {
    try {
      if (state.refreshToken) {
        await api('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: state.refreshToken })
        });
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      if (state.socket) {
        state.socket.disconnect();
      }
      if (state.heartbeatInterval) {
        clearInterval(state.heartbeatInterval);
      }
      clearSession();
      showAuth();
    }
  }

  // Screen Management
  function showAuth() {
    elements.authScreen.classList.remove('hidden');
    elements.appScreen.classList.add('hidden');
  }

  function showApp() {
    elements.authScreen.classList.add('hidden');
    elements.appScreen.classList.remove('hidden');
    elements.currentUsername.textContent = state.user.username;
    initSocket();
    loadConversations();
    loadUsers();
    requestNotificationPermission();
  }

  // Socket.IO
  function initSocket() {
    if (state.socket) {
      state.socket.disconnect();
    }

    state.socket = io({
      auth: { token: state.accessToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    state.socket.on('connect', () => {
      console.log('Socket connected');
      updateConnectionStatus('connected');
      state.isReconnecting = false;
      
      // Send queued messages
      while (state.messageQueue.length > 0) {
        const msg = state.messageQueue.shift();
        state.socket.emit('message:send', msg);
      }

      // Start heartbeat
      startHeartbeat();

      // Rejoin conversation if was in one
      if (state.currentConversation) {
        state.socket.emit('conversation:join', { conversationId: state.currentConversation });
      }
    });

    state.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      updateConnectionStatus('disconnected');
      if (state.heartbeatInterval) {
        clearInterval(state.heartbeatInterval);
      }
    });

    state.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      updateConnectionStatus('connecting');
      state.isReconnecting = true;
    });

    state.socket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      updateConnectionStatus('connected');
      state.isReconnecting = false;
    });

    state.socket.on('error', (err) => {
      console.error('Socket error:', err);
      showToast(err.message || 'An error occurred');
    });

    // Conversation events
    state.socket.on('conversation:history', (data) => {
      renderMessages(data.messages);
    });

    state.socket.on('conversation:user_online', (data) => {
      updateConversationStatus(data.userId, true);
    });

    state.socket.on('conversation:user_left', (data) => {
      updateConversationStatus(data.userId, false);
    });

    // Message events
    state.socket.on('message:new', (message) => {
      appendMessage(message);
      if (document.hidden && message.author_id !== state.user.id) {
        showBrowserNotification(message.author, message.content);
      }
    });

    // Online status
    state.socket.on('user:online', (data) => {
      state.onlineUsers.set(data.userId, data.username);
      renderOnlineUsers();
      updateConversationList();
    });

    state.socket.on('user:offline', (data) => {
      state.onlineUsers.delete(data.userId);
      renderOnlineUsers();
      updateConversationList();
    });

    // Typing
    state.socket.on('typing:update', (data) => {
      updateTypingIndicator(data);
    });

    // Heartbeat
    state.socket.on('pong', () => {
      // Server responded to ping
    });
  }

  function startHeartbeat() {
    if (state.heartbeatInterval) {
      clearInterval(state.heartbeatInterval);
    }
    state.heartbeatInterval = setInterval(() => {
      if (state.socket && state.socket.connected) {
        state.socket.emit('ping');
      }
    }, 30000);
  }

  function updateConnectionStatus(status) {
    elements.connectionStatus.className = 'connection-status';
    switch (status) {
      case 'connected':
        elements.connectionStatus.textContent = '● Connected';
        break;
      case 'connecting':
        elements.connectionStatus.textContent = '◐ Connecting...';
        elements.connectionStatus.classList.add('connecting');
        break;
      case 'disconnected':
        elements.connectionStatus.textContent = '○ Disconnected';
        elements.connectionStatus.classList.add('disconnected');
        break;
    }
  }

  function updateConversationStatus(userId, isOnline) {
    // Update conversation list indicators
    elements.conversationList.querySelectorAll('.conversation-item').forEach(el => {
      if (parseInt(el.dataset.userId) === userId) {
        const statusEl = el.querySelector('.conv-status');
        if (statusEl) {
          statusEl.textContent = isOnline ? 'Online' : 'Offline';
          statusEl.className = 'conv-status' + (isOnline ? ' online' : ' offline');
        }
      }
    });
  }

  // Conversations
  async function loadConversations() {
    try {
      const data = await api('/conversations');
      state.conversations = data.conversations;
      renderConversations();
    } catch (err) {
      console.error('Failed to load conversations:', err);
      showToast('Failed to load conversations');
    }
  }

  function renderConversations() {
    elements.conversationList.innerHTML = '';
    
    if (state.conversations.length === 0) {
      elements.conversationList.innerHTML = '<p class="empty-state">No conversations yet. Click + to start chatting!</p>';
      return;
    }

    state.conversations.forEach(conv => {
      const div = document.createElement('div');
      const isActive = state.currentConversation === conv.id;
      div.className = 'conversation-item' + (isActive ? ' active' : '');
      div.dataset.conversationId = conv.id;
      div.dataset.userId = conv.other_user_id;

      const initial = (conv.other_username || '?')[0].toUpperCase();
      const isOnline = state.onlineUsers.has(conv.other_user_id);
      const timeAgo = conv.last_message_at ? formatTimeAgo(conv.last_message_at) : '';
      const preview = conv.last_message || 'No messages yet';

      div.innerHTML = `
        <div class="conversation-avatar">${initial}</div>
        <div class="conv-info">
          <div class="conv-name">${escapeHtml(conv.other_username || 'Unknown')}</div>
          <div class="conv-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="conv-meta">
          <div class="conv-time">${timeAgo}</div>
          <div class="conv-status ${isOnline ? 'online' : 'offline'}">${isOnline ? '●' : '○'}</div>
        </div>
      `;

      div.addEventListener('click', () => joinConversation(conv.id, conv.other_user_id, conv.other_username));
      elements.conversationList.appendChild(div);
    });
  }

  function updateConversationList() {
    // Just re-render for now
    renderConversations();
  }

  async function joinConversation(conversationId, otherUserId, otherUsername) {
    // Leave current conversation
    if (state.currentConversation && state.socket) {
      state.socket.emit('conversation:leave', { conversationId: state.currentConversation });
    }

    state.currentConversation = conversationId;
    elements.chatName.textContent = otherUsername;

    renderConversations();

    // Join via socket
    if (state.socket && state.socket.connected) {
      state.socket.emit('conversation:join', { conversationId });
    }

    // Enable input
    elements.messageInput.disabled = false;
    elements.sendBtn.disabled = false;
    elements.messageInput.focus();
  }

  async function startConversation(userId) {
    try {
      const data = await api('/conversations', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });

      closeNewChatModal();
      loadConversations();
      joinConversation(
        data.conversation.id,
        data.conversation.other_user_id,
        data.conversation.other_username
      );
    } catch (err) {
      showToast(err.message);
    }
  }

  // Users
  async function loadUsers() {
    try {
      const data = await api('/users');
      state.allUsers = data.users;
      renderUserList();
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  function renderUserList() {
    elements.userList.innerHTML = '';
    
    if (state.allUsers.length === 0) {
      elements.userList.innerHTML = '<p class="empty-state">No other users yet</p>';
      return;
    }

    state.allUsers.forEach(user => {
      const div = document.createElement('div');
      div.className = 'user-item';
      
      const initial = user.username[0].toUpperCase();
      const isOnline = state.onlineUsers.has(user.id);

      div.innerHTML = `
        <div class="user-avatar">${initial}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(user.username)}</div>
          <div class="user-status ${isOnline ? '' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</div>
        </div>
      `;

      div.addEventListener('click', () => startConversation(user.id));
      elements.userList.appendChild(div);
    });
  }

  // Messages
  function renderMessages(messages) {
    elements.messagesContainer.innerHTML = '';
    messages.forEach(msg => appendMessage(msg, false));
    scrollToBottom(false);
  }

  function appendMessage(message, animate = true) {
    const div = document.createElement('div');
    const isOwn = message.author_id === state.user.id;
    div.className = 'message' + (isOwn ? ' own' : '');

    const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let contentHtml = '';
    if (message.type === 'image' && message.file_url) {
      contentHtml = `
        <img src="${escapeHtml(message.file_url)}" alt="Image" class="message-image" onclick="window.previewImage(this.src)">
        ${message.content ? `<div class="message-content">${escapeHtml(message.content)}</div>` : ''}
      `;
    } else if (message.type === 'file' && message.file_url) {
      contentHtml = `
        <div class="message-file">
          <a href="${escapeHtml(message.file_url)}" target="_blank" download>📄 Download File</a>
        </div>
        ${message.content ? `<div class="message-content">${escapeHtml(message.content)}</div>` : ''}
      `;
    } else {
      contentHtml = `<div class="message-content">${escapeHtml(message.content)}</div>`;
    }

    div.innerHTML = `
      <div class="message-author">${escapeHtml(message.author)}</div>
      ${contentHtml}
      <div class="message-time">${time}</div>
    `;

    if (animate) {
      div.style.opacity = '0';
      elements.messagesContainer.appendChild(div);
      requestAnimationFrame(() => {
        div.style.transition = 'opacity 0.3s';
        div.style.opacity = '1';
      });
      scrollToBottom(true);
    } else {
      elements.messagesContainer.appendChild(div);
    }
  }

  function sendMessage(content, type = 'text', fileUrl = null) {
    const message = {
      conversationId: state.currentConversation,
      content,
      type,
      fileUrl
    };

    if (state.isReconnecting || !state.socket || !state.socket.connected) {
      state.messageQueue.push(message);
      showToast('Message queued (offline)');
      return;
    }

    state.socket.emit('message:send', message);
  }

  // File Upload
  async function uploadFile(file) {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    elements.uploadProgress.classList.remove('hidden');
    elements.progressFill.style.width = '0%';
    elements.uploadStatus.textContent = 'Uploading...';

    try {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          elements.progressFill.style.width = `${percent}%`;
        }
      });

      const response = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(xhr.responseText));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        
        xhr.open('POST', '/api/upload');
        xhr.setRequestHeader('Authorization', `Bearer ${state.accessToken}`);
        xhr.send(formData);
      });

      elements.uploadStatus.textContent = 'Upload complete!';
      setTimeout(() => {
        elements.uploadProgress.classList.add('hidden');
      }, 1000);

      sendMessage(response.fileUrl || 'File uploaded', response.fileType || 'file', response.fileUrl);
    } catch (err) {
      elements.uploadStatus.textContent = 'Upload failed: ' + err.message;
      elements.progressFill.style.background = 'var(--red)';
      setTimeout(() => {
        elements.uploadProgress.classList.add('hidden');
        elements.progressFill.style.background = 'var(--primary)';
      }, 3000);
    }
  }

  // Typing Indicator
  function sendTypingStart() {
    if (state.socket && state.currentConversation) {
      state.socket.emit('typing:start', { conversationId: state.currentConversation });
    }
  }

  function sendTypingStop() {
    if (state.socket && state.currentConversation) {
      state.socket.emit('typing:stop', { conversationId: state.currentConversation });
    }
  }

  function updateTypingIndicator(data) {
    if (data.conversationId !== state.currentConversation) return;
    
    if (data.typing) {
      elements.typingIndicator.textContent = `${data.username} is typing...`;
    } else {
      elements.typingIndicator.textContent = '';
    }
  }

  // Online Users
  function renderOnlineUsers() {
    elements.onlineUsersList.innerHTML = '';
    state.onlineUsers.forEach((username, userId) => {
      const li = document.createElement('li');
      li.textContent = username;
      elements.onlineUsersList.appendChild(li);
    });
  }

  // Notifications
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function showBrowserNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, {
        body,
        icon: '/favicon.ico'
      });
    }
  }

  // UI Helpers
  function scrollToBottom(smooth = true) {
    if (smooth) {
      elements.messagesContainer.scrollTo({
        top: elements.messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }
  }

  function showToast(message) {
    console.log('[Toast]', message);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
  }

  function openNewChatModal() {
    renderUserList();
    elements.newChatModal.classList.remove('hidden');
  }

  function closeNewChatModal() {
    elements.newChatModal.classList.add('hidden');
  }

  // Preview image
  window.previewImage = function(src) {
    elements.previewImage.src = src;
    elements.imagePreviewModal.classList.remove('hidden');
  };

  // Event Listeners
  function initEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById(`${tab}-form`).classList.add('active');
      });
    });

    // Login form
    elements.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      elements.loginError.textContent = '';
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      
      try {
        await login(username, password);
      } catch (err) {
        elements.loginError.textContent = err.message;
      }
    });

    // Register form
    elements.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      elements.registerError.textContent = '';
      const username = document.getElementById('register-username').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;

      // Client-side validation
      if (username.length < 3 || username.length > 30) {
        elements.registerError.textContent = 'Username must be 3-30 characters';
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        elements.registerError.textContent = 'Username can only contain letters, numbers, and underscore';
        return;
      }
      if (!email.includes('@')) {
        elements.registerError.textContent = 'Please enter a valid email';
        return;
      }
      if (password.length < 6) {
        elements.registerError.textContent = 'Password must be at least 6 characters';
        return;
      }
      
      try {
        await register(username, email, password);
      } catch (err) {
        elements.registerError.textContent = err.message;
      }
    });

    // Logout
    elements.logoutBtn.addEventListener('click', logout);

    // New chat
    elements.newChatBtn.addEventListener('click', openNewChatModal);
    elements.cancelNewChatBtn.addEventListener('click', closeNewChatModal);

    elements.newChatModal.addEventListener('click', (e) => {
      if (e.target === elements.newChatModal) {
        closeNewChatModal();
      }
    });

    // Message input
    elements.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const content = elements.messageInput.value.trim();
        if (content) {
          sendMessage(content);
          elements.messageInput.value = '';
          sendTypingStop();
        }
      }
    });

    elements.messageInput.addEventListener('input', () => {
      clearTimeout(state.typingTimeout);
      sendTypingStart();
      state.typingTimeout = setTimeout(sendTypingStop, 2000);
    });

    elements.sendBtn.addEventListener('click', () => {
      const content = elements.messageInput.value.trim();
      if (content) {
        sendMessage(content);
        elements.messageInput.value = '';
        sendTypingStop();
      }
    });

    // File upload
    elements.uploadBtn.addEventListener('click', () => {
      elements.fileInput.click();
    });

    elements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          showToast('File too large (max 10MB)');
          return;
        }
        uploadFile(file);
        elements.fileInput.value = '';
      }
    });

    // Image preview
    elements.closePreviewBtn.addEventListener('click', () => {
      elements.imagePreviewModal.classList.add('hidden');
      elements.previewImage.src = '';
    });

    elements.imagePreviewModal.addEventListener('click', (e) => {
      if (e.target === elements.imagePreviewModal) {
        elements.imagePreviewModal.classList.add('hidden');
        elements.previewImage.src = '';
      }
    });

    // Visibility change for notifications
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Clear any pending notifications
      }
    });
  }

  // Initialize
  function init() {
    initEventListeners();

    // Check for existing session
    if (loadSession() && state.accessToken) {
      // Verify token is still valid
      api('/auth/me')
        .then(data => {
          state.user = data.user;
          showApp();
        })
        .catch(() => {
          clearSession();
          showAuth();
        });
    } else {
      showAuth();
    }
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
