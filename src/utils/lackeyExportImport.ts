import { encryptData, decryptData, calculateChecksum } from './encryption';
import { AnyJob } from '../types/jobs';
import {
    prepareWalletsForExport,
    decryptImportedWallets,
    generateSignatureMessage,
    verifyWalletSignature,
    SecureExportMetadata,
    EncryptedWallet
} from './secureKeyManagement';
import { PublicKey } from '@solana/web3.js';

// File format version
const LACKEY_FILE_VERSION = '2.0.0';

// File format for exported lackeys
interface LackeyExportFile {
    version: string;
    timestamp: number;
    checksum: string;
    encryptedData: string;
    secureMetadata: SecureExportMetadata;
    encryptedWallets: EncryptedWallet[];
}

/**
 * Exports lackeys to an encrypted file
 */
export async function exportLackeys(
    lackeys: AnyJob[],
    ownerAddress: string,
    password: string,
    wallet: { publicKey: PublicKey; signMessage: (message: Uint8Array) => Promise<Uint8Array> },
    backupWallets: string[] = []
): Promise<Blob> {
    try {
        // Generate signature message
        const signatureMessage = generateSignatureMessage(ownerAddress);
        
        // Get signature from wallet
        const messageBytes = new TextEncoder().encode(signatureMessage);
        const signature = await wallet.signMessage(messageBytes);
        
        // Get saved wallets from localStorage
        const savedWallets = localStorage.getItem(`saved_wallets_${ownerAddress}`);
        const parsedSavedWallets = savedWallets ? JSON.parse(savedWallets) : [];
        
        // Prepare wallets for secure export
        const { metadata, encryptedWallets } = await prepareWalletsForExport(
            parsedSavedWallets,
            wallet.publicKey.toString(),
            signature,
            password,
            backupWallets
        );
        
        // Prepare the data to export
        const exportData = {
            lackeys,
            ownerAddress,
            exportDate: new Date().toISOString()
        };
        
        // Encrypt the lackey data
        const encryptedData = await encryptData(exportData, password);
        
        // Calculate checksum of the encrypted data
        const checksum = await calculateChecksum(encryptedData);
        
        // Create the export file structure
        const exportFile: LackeyExportFile = {
            version: LACKEY_FILE_VERSION,
            timestamp: Date.now(),
            checksum,
            encryptedData,
            secureMetadata: metadata,
            encryptedWallets
        };
        
        // Convert to JSON and create a Blob
        const jsonData = JSON.stringify(exportFile, null, 2);
        return new Blob([jsonData], { type: 'application/json' });
    } catch (error) {
        console.error('Error exporting lackeys:', error);
        throw new Error('Failed to export lackeys');
    }
}

/**
 * Imports lackeys from an encrypted file
 */
export async function importLackeys(
    fileContent: string,
    password: string,
    wallet: { publicKey: PublicKey; signMessage: (message: Uint8Array) => Promise<Uint8Array> }
): Promise<{
    lackeys: AnyJob[];
    savedWallets: { publicKey: string; secretKey: Uint8Array }[];
    ownerAddress: string;
}> {
    try {
        // Parse the file content
        const importFile: LackeyExportFile = JSON.parse(fileContent);
        
        // Verify the file version
        if (!importFile.version || importFile.version !== LACKEY_FILE_VERSION) {
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
        
        // Decrypt the lackey data
        const decryptedData = await decryptData(importFile.encryptedData, password);
        
        // Validate the decrypted data
        if (!decryptedData.lackeys || !Array.isArray(decryptedData.lackeys) || !decryptedData.ownerAddress) {
            throw new Error('Invalid lackey data format');
        }
        
        return {
            lackeys: decryptedData.lackeys,
            savedWallets: decryptedWallets,
            ownerAddress: decryptedData.ownerAddress
        };
    } catch (error) {
        console.error('Error importing lackeys:', error);
        throw error;
    }
}

/**
 * Merges imported lackeys with existing lackeys
 * @param existingLackeys The existing lackeys
 * @param importedLackeys The imported lackeys
 * @param strategy The strategy to use for handling duplicates ('skip', 'replace', or 'keep-both')
 * @returns The merged lackeys
 */
export function mergeLackeys(
  existingLackeys: AnyJob[],
  importedLackeys: AnyJob[],
  strategy: 'skip' | 'replace' | 'keep-both' = 'skip'
): AnyJob[] {
  const result = [...existingLackeys];
  const existingIds = new Set(existingLackeys.map(l => l.id));
  
  for (const importedLackey of importedLackeys) {
    const isDuplicate = existingIds.has(importedLackey.id);
    
    if (!isDuplicate) {
      // Not a duplicate, just add it
      result.push(importedLackey);
    } else if (strategy === 'replace') {
      // Replace the existing lackey
      const index = result.findIndex(l => l.id === importedLackey.id);
      result[index] = importedLackey;
    } else if (strategy === 'keep-both') {
      // Add with a modified ID to indicate it's imported
      result.push({
        ...importedLackey,
        id: `${importedLackey.id}-${Date.now()}`
      });
    }
    // For 'skip' strategy, do nothing
  }
  
  return result;
} 