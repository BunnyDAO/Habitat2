import React from 'react';

interface WalletLimitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  maxWallets?: number; // Make the wallet limit configurable
}

const WalletLimitDialog: React.FC<WalletLimitDialogProps> = ({ 
  isOpen, 
  onClose,
  maxWallets = 3 // Default to 3 if not specified
}) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#1e293b',
        padding: '2rem',
        borderRadius: '0.75rem',
        maxWidth: '480px', // Increased from 400px
        width: '90%',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        border: '1px solid #2d3748'
      }}>
        <h3 style={{
          color: '#e2e8f0',
          margin: '0 0 1rem 0',
          fontSize: '1.25rem',
          fontWeight: '600'
        }}>
          Wallet Limit Reached
        </h3>
        <p style={{
          color: '#94a3b8',
          margin: '0 0 1.5rem 0',
          fontSize: '1rem',
          lineHeight: '1.5'
        }}>
          {`Unfortunately, at this time a maximum of ${maxWallets} Trading ${maxWallets === 1 ? 'Wallet is' : 'Wallets are'} permitted per user. Please delete an existing wallet before creating a new one.`}
        </p>
        <button
          onClick={onClose}
          style={{
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            cursor: 'pointer',
            transition: 'background-color 0.2s ease',
            width: '100%'
          }}
          onMouseOver={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#2563eb';
          }}
          onMouseOut={(e) => {
            (e.target as HTMLButtonElement).style.backgroundColor = '#3b82f6';
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default WalletLimitDialog; 