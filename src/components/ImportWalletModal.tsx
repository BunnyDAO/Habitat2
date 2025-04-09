import React, { useState, useRef } from 'react';
import PasswordModal from './PasswordModal';
import { importWallets, mergeWallets } from '../utils/walletExportImport';
import { PublicKey } from '@solana/web3.js';

// Use the TradingWallet type directly
interface TradingWallet {
  publicKey: string;
  secretKey: number[];
  mnemonic: string;
  name?: string;
  createdAt: number;
}

interface ImportWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (wallets: TradingWallet[]) => void;
  existingWallets: TradingWallet[];
  ownerAddress: string;
  wallet: {
    publicKey: PublicKey;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  } | null;
}

const ImportWalletModal: React.FC<ImportWalletModalProps> = ({
  isOpen,
  onClose,
  onImport,
  existingWallets,
  ownerAddress,
  wallet
}) => {
  const [step, setStep] = useState<'select-file' | 'enter-password' | 'select-strategy'>('select-file');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importedWallets, setImportedWallets] = useState<TradingWallet[]>([]);
  const [mergeStrategy, setMergeStrategy] = useState<'skip' | 'replace' | 'keep-both'>('skip');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setStep('select-file');
    setFileContent(null);
    setError(null);
    setImportedWallets([]);
    setMergeStrategy('skip');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setError(null);
      return;
    }

    const file = files[0];
    setError(null);

    // Read the file content
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setFileContent(content);
        setStep('enter-password');
      } catch (err) {
        setError('Failed to read the file. Please try again.');
        console.error('Error reading file:', err);
      }
    };
    reader.onerror = () => {
      setError('Failed to read the file. Please try again.');
    };
    reader.readAsText(file);
  };

  const handlePasswordSubmit = async (password: string) => {
    if (!fileContent || !wallet) {
      setError('No file content to import or wallet not connected');
      return;
    }

    try {
      setError(null);
      const { wallets, ownerAddress: importedOwnerAddress } = await importWallets(fileContent, password, wallet);
      
      // Check if the owner address matches
      if (importedOwnerAddress !== ownerAddress) {
        setError('Warning: The wallets were exported from a different owner address.');
      }
      
      setImportedWallets(wallets);
      setStep('select-strategy');
    } catch (err) {
      setError((err as Error).message || 'Failed to import wallets');
      console.error('Import error:', err);
    }
  };

  const handleImport = () => {
    try {
      const mergedWallets = mergeWallets(existingWallets, importedWallets, mergeStrategy);
      onImport(mergedWallets);
      handleClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to merge wallets');
      console.error('Merge error:', err);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        width: '90%',
        maxWidth: '500px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}>
        <h2 style={{ 
          color: '#e2e8f0', 
          marginTop: 0, 
          fontSize: '1.25rem',
          marginBottom: '1rem'
        }}>
          Import Trading Wallets
        </h2>

        {step === 'select-file' && (
          <>
            <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.875rem' }}>
              Select a wallet file to import. The file should be in the format exported by this application.
            </p>
            
            <div style={{ marginBottom: '1rem' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#2d3748',
                  color: '#e2e8f0',
                  border: '1px solid #4b5563',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem'
                }}
              />
            </div>
          </>
        )}

        {step === 'enter-password' && (
          <PasswordModal
            isOpen={true}
            onClose={() => setStep('select-file')}
            onSubmit={handlePasswordSubmit}
            title="Enter Password"
            message="Please enter the password used to encrypt this wallet file."
            submitLabel="Decrypt"
          />
        )}

        {step === 'select-strategy' && (
          <>
            <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.875rem' }}>
              Found {importedWallets.length} wallets to import. How would you like to handle duplicates?
            </p>

            <div style={{ 
              maxHeight: '200px', 
              overflowY: 'auto', 
              marginBottom: '1rem',
              backgroundColor: '#1a2234',
              borderRadius: '0.375rem',
              padding: '0.5rem'
            }}>
              {importedWallets.map((wallet, index) => (
                <div 
                  key={wallet.publicKey} 
                  style={{
                    padding: '0.5rem',
                    borderBottom: index < importedWallets.length - 1 ? '1px solid #2d3748' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                      {wallet.name || 'Unnamed Wallet'}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
                      {wallet.publicKey.slice(0, 8)}...{wallet.publicKey.slice(-8)}
                    </div>
                  </div>
                  <div style={{ 
                    color: existingWallets.some(w => w.publicKey === wallet.publicKey) ? '#fbbf24' : '#10b981',
                    fontSize: '0.75rem'
                  }}>
                    {existingWallets.some(w => w.publicKey === wallet.publicKey) ? 'Duplicate' : 'New'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <select
                value={mergeStrategy}
                onChange={(e) => setMergeStrategy(e.target.value as 'skip' | 'replace' | 'keep-both')}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#2d3748',
                  color: '#e2e8f0',
                  border: '1px solid #4b5563',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem'
                }}
              >
                <option value="skip">Skip duplicates</option>
                <option value="replace">Replace duplicates</option>
                <option value="keep-both">Keep both (rename imported)</option>
              </select>
            </div>
          </>
        )}

        {error && (
          <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Error: {error}
          </p>
        )}

        {!wallet && (
          <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Please connect your wallet to import
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={handleClose}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#4b5563',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Cancel
          </button>
          {step === 'select-strategy' && (
            <button
              onClick={handleImport}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportWalletModal; 