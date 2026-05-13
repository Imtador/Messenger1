import { useState, useEffect } from 'react';
import { authService, socketService, apiService } from '../services/api';
import { cryptoService } from '../crypto/crypto';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initAuth() {
      try {
        const currentUser = await authService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          const token = authService.getAccessToken();
          socketService.connect(token);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setLoading(false);
      }
    }

    initAuth();

    return () => {
      socketService.disconnect();
    };
  }, []);

  const handleLogin = async (email, password) => {
    try {
      const data = await authService.login(email, password);
      setUser(data.user);
      socketService.connect(data.accessToken);
    } catch (error) {
      throw error;
    }
  };

  const handleRegister = async (username, email, password) => {
    try {
      // Generate ECDH key pair
      const { keyPair, publicKey } = await cryptoService.generateECDHKeyPair();
      
      // Register with public key
      const data = await authService.register(username, email, password, publicKey);
      
      // Encrypt private key with password and store in IndexedDB
      const encryptedKeyData = await cryptoService.encryptPrivateKey(
        keyPair.privateKey,
        password
      );
      
      // Store encrypted private key in IndexedDB (simplified - would use idb library)
      await saveEncryptedPrivateKey(data.user.id, encryptedKeyData);
      
      setUser(data.user);
      socketService.connect(data.accessToken);
    } catch (error) {
      throw error;
    }
  };

  const handleLogout = () => {
    authService.logout();
    socketService.disconnect();
    setUser(null);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      {!user ? (
        <Auth onLogin={handleLogin} onRegister={handleRegister} />
      ) : (
        <Main user={user} onLogout={handleLogout} />
      )}
    </div>
  );
}

// Save encrypted private key to IndexedDB
async function saveEncryptedPrivateKey(userId, encryptedKeyData) {
  // Simplified - would use idb library for proper IndexedDB access
  const db = await openDB('securechat', 1, {
    upgrade(db) {
      db.createObjectStore('keys', { keyPath: 'userId' });
    },
  });
  await db.put('keys', { userId, ...encryptedKeyData });
}

async function openDB(name, version, options) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = options.upgrade;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Auth Component
function Auth({ onLogin, onRegister }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await onLogin(formData.email, formData.password);
      } else {
        await onRegister(formData.username, formData.email, formData.password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>SecureChat</h1>
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        
        {error && <div className="error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              placeholder="Username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              required
              minLength={3}
              maxLength={50}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            minLength={8}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        
        <p className="toggle-auth">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
}

// Main Chat Interface
function Main({ user, onLogout }) {
  return (
    <div className="main-container">
      <header className="app-header">
        <h1>SecureChat</h1>
        <div className="user-info">
          <span>{user.displayName || user.username}</span>
          <button onClick={onLogout}>Logout</button>
        </div>
      </header>
      <main className="chat-interface">
        <div className="sidebar">
          <h2>Chats</h2>
          {/* Chat list would go here */}
          <p className="placeholder">Select a chat to start messaging</p>
        </div>
        <div className="chat-area">
          <div className="messages-container">
            <p className="placeholder">Messages will appear here</p>
          </div>
          <div className="message-input">
            <input type="text" placeholder="Type a message..." disabled />
            <button disabled>Send</button>
          </div>
        </div>
      </main>
    </div>
  );
}
