import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class AuthService {
  async register(username, email, password, publicKey) {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, publicKey }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    return data.data;
  }

  async login(email, password) {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error);
    
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    return data.data;
  }

  async logout() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  getAccessToken() {
    return localStorage.getItem('accessToken');
  }

  getRefreshToken() {
    return localStorage.getItem('refreshToken');
  }

  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');

    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error);

    localStorage.setItem('accessToken', data.data.accessToken);
    return data.data.accessToken;
  }

  async getCurrentUser() {
    const token = this.getAccessToken();
    if (!token) return null;

    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) return null;
      return data.data;
    } catch {
      return null;
    }
  }
}

export const authService = new AuthService();

// Socket.IO service
class SocketService {
  constructor() {
    this.socket = null;
  }

  connect(token) {
    if (this.socket?.connected) return;

    this.socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  sendMessage(chatId, contentEncrypted, contentIv, contentTag, messageType = 'text') {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        return reject(new Error('Socket not connected'));
      }

      this.socket.emit('message:send', {
        chatId,
        contentEncrypted,
        contentIv,
        contentTag,
        messageType,
      }, (response) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  onMessageNew(callback) {
    this.socket?.on('message:new', callback);
  }

  onTypingUpdate(callback) {
    this.socket?.on('typing:update', callback);
  }

  onReceiptRead(callback) {
    this.socket?.on('receipt:read', callback);
  }

  onUserOnline(callback) {
    this.socket?.on('user:online', callback);
  }

  onUserOffline(callback) {
    this.socket?.on('user:offline', callback);
  }

  removeListeners() {
    this.socket?.removeAllListeners();
  }
}

export const socketService = new SocketService();

// REST API service
class ApiService {
  async request(endpoint, options = {}) {
    const token = authService.getAccessToken();
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.headers,
      },
    };

    let response = await fetch(`${API_URL}${endpoint}`, config);

    // Handle token expiration
    if (response.status === 401) {
      try {
        await authService.refreshToken();
        const newToken = authService.getAccessToken();
        config.headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(`${API_URL}${endpoint}`, config);
      } catch {
        authService.logout();
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    const data = await response.json();
    if (!data.success && response.status >= 400) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // Contacts
  searchUsers(query) {
    return this.request(`/api/contacts/search?q=${encodeURIComponent(query)}`);
  }

  getContacts() {
    return this.request('/api/contacts');
  }

  sendContactRequest(userId) {
    return this.request('/api/contacts/request', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  acceptContact(contactId) {
    return this.request(`/api/contacts/${contactId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'accepted' }),
    });
  }

  removeContact(contactId) {
    return this.request(`/api/contacts/${contactId}`, {
      method: 'DELETE',
    });
  }

  // Chats
  createChat(type, memberIds, name) {
    return this.request('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ type, memberIds, name }),
    });
  }

  getChats() {
    return this.request('/api/chats');
  }

  getMessages(chatId, limit = 50, cursor) {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor) params.append('cursor', cursor);
    return this.request(`/api/chats/${chatId}/messages?${params}`);
  }
}

export const apiService = new ApiService();
