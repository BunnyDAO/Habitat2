import React, { useRef } from 'react';
import { AnyJob } from '../types/jobs';
import { importLackeys } from '../utils/lackeyExportImport';

interface ImportLackeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (jobs: AnyJob[]) => void;
  title: string;
  message: string;
  submitLabel: string;
  password: string;
  onPasswordChange: (password: string) => void;
  error?: string | null;
}

const ImportLackeysModal: React.FC<ImportLackeysModalProps> = ({
  isOpen,
  onClose,
  onImport,
  title,
  message,
  submitLabel,
  password,
  onPasswordChange,
  error
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && password) {
      try {
        const text = await file.text();
        const { lackeys } = await importLackeys(text, password);
        onImport(lackeys);
      } catch (error) {
        console.error('Error importing file:', error);
      }
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
          {title}
        </h2>

        <p style={{ color: '#94a3b8', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {message}
        </p>

        {error && (
          <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Error: {error}
          </p>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Enter password"
          style={{
            width: '100%',
            padding: '0.5rem',
            backgroundColor: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4b5563',
            borderRadius: '0.25rem',
            fontSize: '0.875rem',
            marginBottom: '1rem'
          }}
        />

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
            fontSize: '0.875rem',
            marginBottom: '1rem'
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={onClose}
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!password}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: password ? 'pointer' : 'not-allowed',
              opacity: password ? 1 : 0.5,
              fontSize: '0.875rem'
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportLackeysModal; 