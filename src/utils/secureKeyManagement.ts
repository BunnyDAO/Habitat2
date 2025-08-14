import { PublicKey } from '@solana/web3.js';
import { MerkleTree } from 'merkletreejs';
import { keccak256 } from 'js-sha3';
import { Buffer } from 'buffer';
import * as nacl from 'tweetnacl';

// Constants
export const SIGNATURE_PREFIX = 'Resonance-Auth-v1';
export const KEY_DERIVATION_ITERATIONS = 100000; // High iteration count for security

export interface SecureExportMetadata {
    version: string;
    timestamp: number;
    merkleRoot: string;
    signatureMessage: string;
    authorizedWallets: string[]; // Public keys of wallets that can decrypt
    expiryDate?: number; // Optional expiry timestamp
}

export interface EncryptedWallet {
    publicKey: string;
    encryptedPrivateKey: string;
    merkleProof: string[];
    index: number;
}

/**
 * Generates a unique message for wallet signing
 */
export function generateSignatureMessage(ownerAddress: string): string {
    const timestamp = Date.now();
    return `${SIGNATURE_PREFIX}:${ownerAddress}:${timestamp}`;
}

/**
 * Derives an encryption key from password and signature
 */
export async function deriveEncryptionKey(
    password: string,
    signature: Uint8Array
): Promise<CryptoKey> {
    try {
        // Convert password to bytes
        const passwordBytes = new TextEncoder().encode(password);
        
        // Create a concatenated buffer of password and signature
        const combinedBuffer = Buffer.concat([
            passwordBytes,
            signature.slice(0, 32)
        ]);
        
        // Log detailed information about the inputs
        console.log('Key derivation inputs:', {
            password,
            passwordLength: password.length,
            passwordBytes: Array.from(passwordBytes),
            signatureSlice: Array.from(signature.slice(0, 32)),
            combinedLength: combinedBuffer.length
        });
        
        // Hash the combined buffer
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            combinedBuffer
        );
        
        // Log hash details
        console.log('Hash details:', {
            hashLength: hashBuffer.byteLength,
            hashBytes: Array.from(new Uint8Array(hashBuffer))
        });
        
        // Import the hash as a key
        const baseKey = await crypto.subtle.importKey(
            'raw',
            hashBuffer,
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        ).catch(err => {
            console.error('Failed to import base key:', err);
            throw new Error('Failed to initialize key derivation');
        });
        
        // Use fixed salt for consistent key derivation
        const salt = new TextEncoder().encode(SIGNATURE_PREFIX);
        console.log('Using salt:', SIGNATURE_PREFIX, 'length:', salt.length);
        
        // Derive the actual encryption key
        const derivedKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt,
                iterations: KEY_DERIVATION_ITERATIONS,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        ).catch(err => {
            console.error('Failed to derive key:', err);
            throw new Error('Failed to generate encryption key');
        });
        
        // Log success
        console.log('Successfully derived encryption key');
        
        return derivedKey;
    } catch (error) {
        console.error('Key derivation failed:', error);
        throw new Error('Failed to set up encryption');
    }
}

/**
 * Creates a Merkle tree from wallet public keys
 */
export function createWalletMerkleTree(walletPublicKeys: string[]): MerkleTree {
    const leaves = walletPublicKeys.map(key => keccak256(key));
    return new MerkleTree(leaves, keccak256, { sortPairs: true });
}

/**
 * Encrypts a private key using the derived encryption key
 */
export async function encryptPrivateKey(
    privateKey: Uint8Array,
    encryptionKey: CryptoKey
): Promise<string> {
    try {
        // Generate IV
        const iv = crypto.getRandomValues(new Uint8Array(12));
        
        // Log input data sizes and validate key format
        console.log('Encrypting private key:', {
            keyLength: privateKey.length,
            ivLength: iv.length,
            keyBytes: Array.from(privateKey.slice(0, 8)) // Log first 8 bytes for debugging
        });
        
        // Validate private key length
        if (privateKey.length !== 64 && privateKey.length !== 32) {
            console.error('❌ Invalid private key length:', privateKey.length);
            console.error('❌ Expected 64 bytes (full keypair) or 32 bytes (seed)');
            throw new Error(`Invalid private key length: ${privateKey.length} bytes. Expected 64 or 32 bytes.`);
        }
        
        // Log key type for debugging
        console.log('🔑 Private key type:', privateKey.length === 64 ? 'Full keypair (64 bytes)' : 'Seed (32 bytes)');
        
        // Encrypt the data
        const encryptedData = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv,
                tagLength: 128 // Explicitly set tag length to 128 bits (16 bytes)
            },
            encryptionKey,
            privateKey
        ).catch(err => {
            console.error('Encryption operation failed:', err);
            throw new Error('Failed to encrypt wallet data');
        });
        
        // Log encrypted data size
        console.log('Encrypted data size:', encryptedData.byteLength);
        
        // Combine IV and encrypted data
        const combined = new Uint8Array(iv.length + encryptedData.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encryptedData), iv.length);
        
        // Convert to base64
        const base64 = Buffer.from(combined).toString('base64');
        console.log('Final base64 length:', base64.length);
        
        return base64;
    } catch (error) {
        console.error('Encryption process failed:', error);
        throw new Error('Failed to encrypt wallet');
    }
}

/**
 * Decrypts a private key using the derived encryption key
 */
export async function decryptPrivateKey(
    encryptedPrivateKey: string,
    encryptionKey: CryptoKey
): Promise<Uint8Array> {
    try {
        // Decode base64 string to buffer
        const encryptedData = Buffer.from(encryptedPrivateKey, 'base64');
        
        // Log input data
        console.log('Decrypting data:', {
            base64Length: encryptedPrivateKey.length,
            totalLength: encryptedData.length,
            expectedTotalLengthFor64ByteKey: 92, // 12 (IV) + 64 (key) + 16 (auth tag)
            expectedTotalLengthFor32ByteKey: 60, // 12 (IV) + 32 (seed) + 16 (auth tag)
            base64String: encryptedPrivateKey.substring(0, 40) + '...' // Log first part for debugging
        });
        
        // Validate minimum length (IV + some data + auth tag)
        const minLength = 12 + 1 + 16; // IV + at least 1 byte + auth tag
        if (encryptedData.length < minLength) {
            throw new Error(`Invalid encrypted data format: data too short (${encryptedData.length} bytes, minimum ${minLength} required)`);
        }
        
        // Extract IV and encrypted content
        const iv = new Uint8Array(encryptedData.subarray(0, 12));
        const data = new Uint8Array(encryptedData.subarray(12));
        
        // Log component sizes and data
        console.log('Decryption components:', {
            ivSize: iv.length,
            ivBytes: Array.from(iv),
            dataSize: data.length,
            dataBytes: Array.from(data),
            expectedAuthTagSize: 16,
            expectedKeySize: 64,
            totalDataLength: encryptedData.length
        });
        
        // Check if this looks like an AES-GCM encrypted payload
        if (data.length < 16) {
            console.error('🚨 Critical: Encrypted data too short for AES-GCM auth tag');
            console.error('🚨 Expected format: IV(12) + EncryptedKey(64) + AuthTag(16) = 92 bytes');
            console.error('🚨 Actual format: IV(12) + Data(' + data.length + ') = ' + encryptedData.length + ' bytes');
            console.error('🚨 This suggests export/import version mismatch or corrupted data');
            throw new Error(`Encrypted data too short: ${data.length} bytes (need at least 16 for auth tag)`);
        }
        
        // Decrypt the data
        const decryptedData = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv,
                tagLength: 128
            },
            encryptionKey,
            data
        ).catch(err => {
            console.error('Decryption operation failed:', err);
            throw new Error('Failed to decrypt wallet data');
        });
        
        // Convert to Uint8Array and validate length
        const result = new Uint8Array(decryptedData);
        console.log('Decrypted result:', {
            length: result.length,
            keyType: result.length === 64 ? 'Full keypair' : result.length === 32 ? 'Seed' : 'Unknown',
            bytes: Array.from(result.slice(0, 8)) // Log first 8 bytes for debugging
        });
        
        // Validate decrypted data length (can be 32 or 64 bytes)
        if (result.length !== 64 && result.length !== 32) {
            console.error('❌ Decrypted data has invalid length:', result.length);
            console.error('❌ Expected 64 bytes (full keypair) or 32 bytes (seed)');
            throw new Error(`Decrypted data has invalid length: ${result.length} bytes. Expected 64 or 32 bytes.`);
        }
        
        return result;
    } catch (error) {
        console.error('Decryption process failed:', error);
        throw new Error('Failed to decrypt wallet: Invalid password or corrupted data');
    }
}

/**
 * Verifies a wallet signature
 */
export async function verifyWalletSignature(
    message: string,
    signature: Uint8Array,
    publicKey: PublicKey
): Promise<boolean> {
    try {
        const messageBytes = new TextEncoder().encode(message);
        return nacl.sign.detached.verify(
            messageBytes,
            signature,
            publicKey.toBytes()
        );
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}

/**
 * Prepares wallets for secure export
 */
export async function prepareWalletsForExport(
    wallets: { publicKey: string; secretKey: Uint8Array }[],
    ownerPublicKey: string,
    signature: Uint8Array,
    password: string,
    backupWallets: string[] = []
): Promise<{
    metadata: SecureExportMetadata;
    encryptedWallets: EncryptedWallet[];
}> {
    // Generate encryption key
    const encryptionKey = await deriveEncryptionKey(password, signature);
    
    // Create Merkle tree
    const merkleTree = createWalletMerkleTree(wallets.map(w => w.publicKey));
    
    // Encrypt each wallet's private key
    const encryptedWallets: EncryptedWallet[] = await Promise.all(
        wallets.map(async (wallet, index) => {
            const encryptedPrivateKey = await encryptPrivateKey(
                wallet.secretKey,
                encryptionKey
            );
            
            const merkleProof = merkleTree.getProof(
                keccak256(wallet.publicKey)
            ).map((x: { data: Buffer }) => x.data.toString('hex'));
            
            return {
                publicKey: wallet.publicKey,
                encryptedPrivateKey,
                merkleProof,
                index
            };
        })
    );
    
    // Create metadata
    const metadata: SecureExportMetadata = {
        version: '2.0.0',
        timestamp: Date.now(),
        merkleRoot: merkleTree.getRoot().toString('hex'),
        signatureMessage: generateSignatureMessage(ownerPublicKey),
        authorizedWallets: [ownerPublicKey, ...backupWallets],
        expiryDate: Date.now() + (90 * 24 * 60 * 60 * 1000) // 90 days expiry
    };
    
    return { metadata, encryptedWallets };
}

/**
 * Validates and decrypts imported wallets
 */
export async function decryptImportedWallets(
    metadata: SecureExportMetadata,
    encryptedWallets: EncryptedWallet[],
    signature: Uint8Array,
    password: string,
    currentWalletPublicKey: string
): Promise<{ publicKey: string; secretKey: Uint8Array }[]> {
    try {
        // Verify expiry
        if (metadata.expiryDate && metadata.expiryDate < Date.now()) {
            throw new Error('Export file has expired');
        }
        
        // Verify authorized wallet
        if (!metadata.authorizedWallets.includes(currentWalletPublicKey)) {
            throw new Error('Current wallet is not authorized to decrypt this export');
        }
        
        // Derive decryption key
        console.log('Deriving key with password length:', password.length);
        console.log('Signature length:', signature.length);
        const decryptionKey = await deriveEncryptionKey(password, signature);
        console.log('Successfully derived decryption key');
        
        // Verify Merkle tree and decrypt wallets
        const merkleTree = createWalletMerkleTree(
            encryptedWallets.map(w => w.publicKey)
        );
        
        if (merkleTree.getRoot().toString('hex') !== metadata.merkleRoot) {
            console.error('Merkle root mismatch:', {
                expected: metadata.merkleRoot,
                actual: merkleTree.getRoot().toString('hex')
            });
            throw new Error('Merkle root verification failed');
        }
        
        // Decrypt all wallets
        const results = await Promise.all(
            encryptedWallets.map(async (wallet) => {
                try {
                    // Verify Merkle proof
                    const leaf = keccak256(wallet.publicKey);
                    const isValid = merkleTree.verify(
                        wallet.merkleProof.map(p => Buffer.from(p, 'hex')),
                        leaf,
                        metadata.merkleRoot
                    );
                    
                    if (!isValid) {
                        throw new Error(`Invalid Merkle proof for wallet ${wallet.publicKey}`);
                    }
                    
                    console.log(`Attempting to decrypt wallet: ${wallet.publicKey}`);
                    const secretKey = await decryptPrivateKey(
                        wallet.encryptedPrivateKey,
                        decryptionKey
                    );
                    console.log(`Successfully decrypted wallet: ${wallet.publicKey}`);
                    
                    return {
                        publicKey: wallet.publicKey,
                        secretKey
                    };
                } catch (error) {
                    console.error(`Failed to decrypt wallet ${wallet.publicKey}:`, error);
                    throw error;
                }
            })
        );
        
        return results;
    } catch (error) {
        console.error('Wallet decryption process failed:', error);
        throw error;
    }
} 