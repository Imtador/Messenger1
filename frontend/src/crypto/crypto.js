// Crypto utilities for client-side encryption

class CryptoService {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
  }

  // Generate ECDH key pair for registration
  async generateECDHKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      ['deriveKey', 'deriveBits']
    );

    // Export public key
    const publicKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicKeyBase64 = this.arrayBufferToBase64(publicKey);

    return {
      keyPair,
      publicKey: publicKeyBase64,
    };
  }

  // Import public key from base64
  async importPublicKey(publicKeyBase64) {
    const publicKeyData = this.base64ToArrayBuffer(publicKeyBase64);
    return await window.crypto.subtle.importKey(
      'spki',
      publicKeyData,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
  }

  // Derive shared secret using ECDH
  async deriveSharedSecret(privateKey, publicKey) {
    const sharedSecret = await window.crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: publicKey,
      },
      privateKey,
      this.keyLength
    );

    return sharedSecret;
  }

  // Create AES key from shared secret
  async createAESKey(sharedSecret) {
    return await window.crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt message with AES-GCM
  async encryptMessage(message, aesKey) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const encodedMessage = new TextEncoder().encode(message);
    
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      encodedMessage
    );

    // Extract ciphertext, IV, and auth tag (last 16 bytes)
    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertext = encryptedBytes.slice(0, -16);
    const tag = encryptedBytes.slice(-16);

    return {
      ciphertext: this.arrayBufferToBase64(ciphertext.buffer),
      iv: this.arrayBufferToBase64(iv.buffer),
      tag: this.arrayBufferToBase64(tag.buffer),
    };
  }

  // Decrypt message with AES-GCM
  async decryptMessage(contentEncrypted, contentIv, contentTag, aesKey) {
    const ciphertext = this.base64ToArrayBuffer(contentEncrypted);
    const iv = this.base64ToArrayBuffer(contentIv);
    const tag = this.base64ToArrayBuffer(contentTag);

    // Combine ciphertext and tag
    const encryptedData = new Uint8Array(ciphertext.byteLength + tag.byteLength);
    encryptedData.set(new Uint8Array(ciphertext), 0);
    encryptedData.set(new Uint8Array(tag), ciphertext.byteLength);

    try {
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        aesKey,
        encryptedData
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt message');
    }
  }

  // Encrypt private key with password using PBKDF2 + AES-GCM
  async encryptPrivateKey(privateKey, password) {
    // Generate salt
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    
    // Derive key from password using PBKDF2
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt']
    );

    // Export private key
    const privateKeyData = await window.crypto.subtle.exportKey('pkcs8', privateKey);
    
    // Encrypt private key
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      privateKeyData
    );

    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertext = encryptedBytes.slice(0, -16);
    const tag = encryptedBytes.slice(-16);

    return {
      encryptedPrivateKey: this.arrayBufferToBase64(ciphertext.buffer),
      iv: this.arrayBufferToBase64(iv.buffer),
      tag: this.arrayBufferToBase64(tag.buffer),
      salt: this.arrayBufferToBase64(salt.buffer),
    };
  }

  // Decrypt private key with password
  async decryptPrivateKey(encryptedPrivateKey, iv, tag, salt, password) {
    // Derive key from password
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.base64ToArrayBuffer(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt']
    );

    // Combine ciphertext and tag
    const ciphertext = this.base64ToArrayBuffer(encryptedPrivateKey);
    const tagData = this.base64ToArrayBuffer(tag);
    const encryptedData = new Uint8Array(ciphertext.byteLength + tagData.byteLength);
    encryptedData.set(new Uint8Array(ciphertext), 0);
    encryptedData.set(new Uint8Array(tagData), ciphertext.byteLength);

    // Decrypt
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.base64ToArrayBuffer(iv) },
      derivedKey,
      encryptedData
    );

    // Import private key
    return await window.crypto.subtle.importKey(
      'pkcs8',
      decrypted,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // Utility functions
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export const cryptoService = new CryptoService();
