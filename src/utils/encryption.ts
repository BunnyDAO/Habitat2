/**
 * Utilities for encrypting and decrypting wallet data
 */

/**
 * Encrypts wallet data using a password
 * @param data The data to encrypt
 * @param password The password to use for encryption
 * @returns The encrypted data as a string
 */
export async function encryptData(data: any, password: string): Promise<string> {
  try {
    // Convert the password to a key using PBKDF2
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const key = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    
    // Generate an initialization vector
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt the data
    const dataBuffer = new TextEncoder().encode(JSON.stringify(data));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      dataBuffer
    );
    
    // Combine the salt, iv, and encrypted data
    const result = {
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encryptedBuffer))
    };
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts wallet data using a password
 * @param encryptedData The encrypted data as a string
 * @param password The password to use for decryption
 * @returns The decrypted data
 */
export async function decryptData(encryptedData: string, password: string): Promise<any> {
  try {
    const { salt, iv, data } = JSON.parse(encryptedData);
    
    // Convert the password to a key using PBKDF2
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    const key = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    // Decrypt the data
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv)
      },
      key,
      new Uint8Array(data)
    );
    
    // Parse and return the decrypted data
    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedText);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data. The password may be incorrect.');
  }
}

/**
 * Calculates a checksum for the data
 * @param data The data to calculate a checksum for
 * @returns A promise that resolves to the checksum as a hex string
 */
export async function calculateChecksum(data: string): Promise<string> {
  const buffer = new TextEncoder().encode(data);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
} 