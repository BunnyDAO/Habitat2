import { encryptData, decryptData, calculateChecksum } from './encryption';
import { PublicKey } from '@solana/web3.js';
import {
  prepareWalletsForExport,
  decryptImportedWallets,
  generateSignatureMessage,
  verifyWalletSignature,
  SecureExportMetadata,
  EncryptedWallet
} from './secureKeyManagement';

// Use the types from App.tsx
interface TradingWallet {
  publicKey: string;
  secretKey: Uint8Array;
  mnemonic: string;
  name?: string;
  createdAt: number;
}

// File format version
const WALLET_FILE_VERSION = '2.0.0';

// File format for exported wallets
interface WalletExportFile {
  version: string;
  timestamp: number;
  checksum: string;
  encryptedData: string;
  secureMetadata: SecureExportMetadata;
  encryptedWallets: EncryptedWallet[];
}

/**
 * Stores a wallet's secret key in localStorage
 * @param publicKey The wallet's public key
 * @param secretKey The wallet's secret key
 */
export const storeWalletSecretKey = (publicKey: string, secretKey: Uint8Array) => {
    try {
        console.log('Storing secret key for wallet:', publicKey);
        console.log('Secret key length:', secretKey.length);
        console.log('Secret key type:', secretKey.constructor.name);
        
        // Store the secretKey as a base64 string to preserve the Uint8Array data
        const base64SecretKey = Buffer.from(secretKey).toString('base64');
        localStorage.setItem(`wallet_${publicKey}`, base64SecretKey);
        
        // Verify storage
        const storedKey = localStorage.getItem(`wallet_${publicKey}`);
        console.log('Storage verification - key exists:', !!storedKey);
        return true;
    } catch (error) {
        console.error('Error storing wallet secret key:', error);
        return false;
    }
};

/**
 * Retrieves a wallet's secret key from localStorage
 * @param publicKey The wallet's public key
 * @returns The wallet's secret key as Uint8Array, or null if not found
 */
export const getWalletSecretKey = (publicKey: string): Uint8Array | null => {
    try {
        const storedKey = localStorage.getItem(`wallet_${publicKey}`);
        if (!storedKey) return null;
        
        // Convert base64 string back to Uint8Array
        const secretKeyBuffer = Buffer.from(storedKey, 'base64');
        return new Uint8Array(secretKeyBuffer);
    } catch (error) {
        console.error('Error retrieving wallet secret key:', error);
        return null;
    }
};

/**
 * Exports trading wallets to an encrypted file
 * @param wallets The wallets to export
 * @param ownerAddress The address of the wallet owner
 * @param password The password to encrypt the data with
 * @param wallet The wallet to sign with
 * @param backupWallets Optional backup wallet addresses that can also decrypt
 * @returns A Blob containing the encrypted wallet data
 */
export async function exportWallets(
  wallets: TradingWallet[],
  ownerAddress: string,
  password: string,
  wallet: { publicKey: PublicKey; signMessage: (message: Uint8Array) => Promise<Uint8Array> },
  backupWallets: string[] = []
): Promise<Blob> {
  try {
    // Generate signature message
    const signatureMessage = generateSignatureMessage(ownerAddress);
    console.log('Generated signature message:', signatureMessage);
    
    // Get signature from wallet
    const messageBytes = new TextEncoder().encode(signatureMessage);
    const signature = await wallet.signMessage(messageBytes);
    console.log('Generated signature length:', signature.length);
    
    // Convert TradingWallet array to format needed by prepareWalletsForExport
    const walletsForExport = wallets.map(w => ({
      publicKey: w.publicKey,
      secretKey: new Uint8Array(w.secretKey)
    }));
    
    // Prepare wallets for secure export
    const { metadata, encryptedWallets } = await prepareWalletsForExport(
      walletsForExport,
      wallet.publicKey.toString(),
      signature,
      password,
      backupWallets
    );
    
    // Prepare the data to export (metadata about the wallets)
    const exportData = {
      wallets: wallets.map(w => ({
        publicKey: w.publicKey,
        name: w.name,
        createdAt: w.createdAt
      })),
      ownerAddress,
      exportDate: new Date().toISOString()
    };
    
    // Encrypt the metadata
    const encryptedData = await encryptData(exportData, password);
    
    // Calculate checksum of the encrypted data
    const checksum = await calculateChecksum(encryptedData);
    
    // Create the export file structure
    const exportFile: WalletExportFile = {
      version: WALLET_FILE_VERSION,
      timestamp: Date.now(),
      checksum,
      encryptedData,
      secureMetadata: {
        ...metadata,
        signatureMessage // Store the original signature message
      },
      encryptedWallets
    };
    
    // Convert to JSON and create a Blob
    const jsonData = JSON.stringify(exportFile, null, 2);
    return new Blob([jsonData], { type: 'application/json' });
  } catch (error) {
    console.error('Error exporting wallets:', error);
    throw new Error('Failed to export wallets');
  }
}

/**
 * Imports trading wallets from an encrypted file
 * @param fileContent The content of the encrypted file
 * @param password The password to decrypt the data with
 * @param wallet The wallet to verify with
 * @returns The decrypted wallets and the owner address
 */
export async function importWallets(
    fileContent: string,
    password: string,
    wallet: { publicKey: PublicKey; signMessage: (message: Uint8Array) => Promise<Uint8Array> }
): Promise<{ wallets: TradingWallet[]; ownerAddress: string }> {
    try {
        // Parse the file content
        const importFile: WalletExportFile = JSON.parse(fileContent);
        
        // Verify the file version
        if (!importFile.version || importFile.version !== WALLET_FILE_VERSION) {
            throw new Error(`Unsupported file version: ${importFile.version}`);
        }
        
        // Verify the checksum
        const calculatedChecksum = await calculateChecksum(importFile.encryptedData);
        if (calculatedChecksum !== importFile.checksum) {
            throw new Error('File integrity check failed. The file may be corrupted.');
        }
        
        // Get signature for decryption
        const messageBytes = new TextEncoder().encode(importFile.secureMetadata.signatureMessage);
        const signature = await wallet.signMessage(messageBytes);
        
        // Verify signature
        const isValidSignature = await verifyWalletSignature(
            importFile.secureMetadata.signatureMessage,
            signature,
            wallet.publicKey
        );
        
        if (!isValidSignature) {
            throw new Error('Invalid wallet signature');
        }
        
        // Decrypt wallets
        const decryptedWallets = await decryptImportedWallets(
            importFile.secureMetadata,
            importFile.encryptedWallets,
            signature,
            password,
            wallet.publicKey.toString()
        );
        
        // Decrypt the metadata
        const decryptedData = await decryptData(importFile.encryptedData, password);
        
        // Validate the decrypted data
        if (!decryptedData.wallets || !Array.isArray(decryptedData.wallets) || !decryptedData.ownerAddress) {
            throw new Error('Invalid wallet data format');
        }
        
        // Combine the decrypted wallet data
        const wallets: TradingWallet[] = decryptedWallets.map(w => {
            const metadata = decryptedData.wallets.find((m: { publicKey: string }) => m.publicKey === w.publicKey);
            
            // Store secret key in localStorage using the new function
            storeWalletSecretKey(w.publicKey, w.secretKey);
            
            return {
                publicKey: w.publicKey,
                secretKey: w.secretKey,
                mnemonic: '', // Empty string since we don't need it
                name: metadata?.name,
                createdAt: metadata?.createdAt || Date.now()
            };
        });
        
        return {
            wallets,
            ownerAddress: decryptedData.ownerAddress
        };
    } catch (error) {
        console.error('Error importing wallets:', error);
        throw error;
    }
}

/**
 * Merges imported wallets with existing wallets
 * @param existingWallets The existing wallets
 * @param importedWallets The imported wallets
 * @param strategy The strategy to use for handling duplicates ('skip', 'replace', or 'keep-both')
 * @returns The merged wallets
 */
export function mergeWallets(
  existingWallets: TradingWallet[],
  importedWallets: TradingWallet[],
  strategy: 'skip' | 'replace' | 'keep-both' = 'skip'
): TradingWallet[] {
  const result = [...existingWallets];
  const existingPublicKeys = new Set(existingWallets.map(w => w.publicKey));
  
  for (const importedWallet of importedWallets) {
    const isDuplicate = existingPublicKeys.has(importedWallet.publicKey);
    
    if (!isDuplicate) {
      // Not a duplicate, just add it
      result.push(importedWallet);
    } else if (strategy === 'replace') {
      // Replace the existing wallet
      const index = result.findIndex(w => w.publicKey === importedWallet.publicKey);
      result[index] = importedWallet;
    } else if (strategy === 'keep-both') {
      // Add with a modified name to indicate it's imported
      result.push({
        ...importedWallet,
        name: `${importedWallet.name || 'Imported'} (${new Date().toLocaleDateString()})`
      });
    }
    // For 'skip' strategy, do nothing
  }
  
  return result;
} 