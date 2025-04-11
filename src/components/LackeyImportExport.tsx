import React, { useState, useRef } from 'react';
import { exportLackeys, importLackeys, mergeLackeys } from '../utils/lackeyExportImport';
import { AnyJob } from '../types/jobs';
import ExportLackeysModal from './ExportLackeysModal';
import ImportLackeysModal from './ImportLackeysModal';
import PasswordModal from './PasswordModal';
import { PublicKey } from '@solana/web3.js';

interface LackeyImportExportProps {
  jobs: AnyJob[];
  setJobs: (jobs: AnyJob[]) => void;
  walletConnected: boolean;
  walletPublicKey: string;
  wallet: { publicKey: PublicKey; signMessage: (message: Uint8Array) => Promise<Uint8Array> };
}

interface FileSaveOptions {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

interface FileSystemFileHandle {
  createWritable: () => Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

declare global {
  interface Window {
    showSaveFilePicker: (options: FileSaveOptions) => Promise<FileSystemFileHandle>;
  }
}

const LackeyImportExport: React.FC<LackeyImportExportProps> = ({
  jobs,
  setJobs,
  walletConnected,
  walletPublicKey,
  wallet
}) => {
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'select-file' | 'enter-password'>('select-file');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportLackeys = async (password: string) => {
    if (!walletConnected || jobs.length === 0) return;

    try {
      setError(null);
      const blob = await exportLackeys(jobs, walletPublicKey, password, wallet);
      
      // Use the File System Access API if available
      if ('showSaveFilePicker' in window) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `lackey-strategies-${new Date().toISOString().split('T')[0]}.json`,
            types: [{
              description: 'JSON Files',
              accept: { 'application/json': ['.json'] }
            }],
          });
          
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          
          setIsExportModalOpen(false);
        } catch (error) {
          // User cancelled the save dialog or other error
          if ((error as Error).name !== 'AbortError') {
            throw error;
          }
        }
      } else {
        // Fallback for browsers that don't support the File System Access API
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lackey-strategies-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setIsExportModalOpen(false);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error exporting lackeys:', error);
        setError(error.message);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setFileContent(null);
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
    if (!fileContent) {
      setError('No file content to import');
      return;
    }

    try {
      setError(null);
      const { lackeys, savedWallets } = await importLackeys(fileContent, password, wallet);
      
      // Merge lackeys
      const mergedJobs = mergeLackeys(jobs, lackeys);
      setJobs(mergedJobs);
      
      // If there are saved wallets, merge them
      if (savedWallets && savedWallets.length > 0) {
        const existingWallets = localStorage.getItem(`saved_wallets_${walletPublicKey}`);
        const parsedExistingWallets = existingWallets ? JSON.parse(existingWallets) : [];
        
        // Merge wallets, avoiding duplicates by public key
        const uniqueWallets = [...parsedExistingWallets];
        for (const newWallet of savedWallets) {
          if (!uniqueWallets.some(w => w.publicKey === newWallet.publicKey)) {
            uniqueWallets.push(newWallet);
          }
        }
        
        localStorage.setItem(`saved_wallets_${walletPublicKey}`, JSON.stringify(uniqueWallets));
      }
      
      setIsImportModalOpen(false);
      resetImportState();
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error importing lackeys:', error);
        setError(error.message);
      }
    }
  };

  const resetImportState = () => {
    setStep('select-file');
    setFileContent(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => setIsImportModalOpen(true)}
          disabled={!walletConnected}
          style={{ 
            fontSize: '0.75rem',
            backgroundColor: '#4b5563',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            padding: '0.5rem 0.75rem',
            cursor: !walletConnected ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
            opacity: !walletConnected ? '0.6' : '1'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4V16M12 16L7 11M12 16L17 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 20H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Import Lackeys</span>
        </button>
        
        <button
          onClick={() => setIsExportModalOpen(true)}
          disabled={!walletConnected || jobs.length === 0}
          style={{ 
            fontSize: '0.75rem',
            backgroundColor: '#4b5563',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            padding: '0.5rem 0.75rem',
            cursor: (!walletConnected || jobs.length === 0) ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease-in-out',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
            opacity: (!walletConnected || jobs.length === 0) ? '0.6' : '1'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 20V8M12 8L7 13M12 8L17 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 4H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Export Lackeys</span>
        </button>
      </div>

      {/* Export Modal */}
      <PasswordModal
        isOpen={isExportModalOpen}
        onClose={() => {
          setIsExportModalOpen(false);
          setError(null);
        }}
        onSubmit={handleExportLackeys}
        title="Export Lackeys"
        message={`Please enter a password to encrypt your lackeys. This password will be required to import the lackeys later. ${error ? `\n\nError: ${error}` : ''}`}
        submitLabel="Export"
      />

      {/* Import Modal */}
      {isImportModalOpen && (
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
              Import Lackeys
            </h2>

            {step === 'select-file' ? (
              <>
                <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  Select a lackey file to import. The file should be in the format exported by this application.
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
            ) : (
              <PasswordModal
                isOpen={true}
                onClose={() => setStep('select-file')}
                onSubmit={handlePasswordSubmit}
                title="Enter Password"
                message="Please enter the password used to encrypt this lackey file."
                submitLabel="Decrypt"
              />
            )}

            {error && (
              <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
                Error: {error}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  setIsImportModalOpen(false);
                  resetImportState();
                }}
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
              {step === 'select-file' && (
                <button
                  onClick={() => fileInputRef.current?.click()}
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
                  Select File
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LackeyImportExport; 