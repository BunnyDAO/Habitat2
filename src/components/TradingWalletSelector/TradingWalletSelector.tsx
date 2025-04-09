import React, { useState, useRef, useEffect } from 'react';
import { TradingWallet } from '../../types/wallet';

interface TradingWalletSelectorProps {
  wallets: TradingWallet[];
  selectedWallet: TradingWallet | null;
  onSelectWallet: (wallet: TradingWallet) => void;
  portfolioValues: Record<string, number>;
}

export const TradingWalletSelector: React.FC<TradingWalletSelectorProps> = ({
  wallets,
  selectedWallet,
  onSelectWallet,
  portfolioValues
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (wallets.length === 0) {
    return (
      <div style={{
        backgroundColor: '#1e293b',
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
        color: '#94a3b8',
        fontSize: '0.875rem',
        textAlign: 'center',
        border: '1px solid #2d3748'
      }}>
        No trading wallets available. Create one from the Dashboard.
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '1rem',
      width: '100%'
    }}>
      <div 
        ref={dropdownRef}
        style={{
          flex: 1,
          position: 'relative'
        }}
      >
        {/* Dropdown trigger */}
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            backgroundColor: '#1e293b',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            border: '1px solid #2d3748',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#e2e8f0',
            fontSize: '0.875rem',
            transition: 'all 0.2s ease'
          }}
        >
          <div>
            {selectedWallet 
              ? selectedWallet.name || `Trading Wallet ${wallets.indexOf(selectedWallet) + 1}`
              : 'Select Trading Wallet'
            }
          </div>
          <div style={{ color: '#94a3b8', transform: isOpen ? 'rotate(180deg)' : undefined }}>▼</div>
        </div>

        {/* Dropdown options */}
        {isOpen && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            left: 0,
            right: 0,
            backgroundColor: '#1e293b',
            border: '1px solid #2d3748',
            borderRadius: '0.5rem',
            overflow: 'hidden',
            zIndex: 10,
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {wallets.map((wallet) => (
              <div
                key={wallet.publicKey}
                onClick={() => {
                  onSelectWallet(wallet);
                  setIsOpen(false);
                }}
                style={{
                  padding: '0.75rem 1rem',
                  cursor: 'pointer',
                  borderBottom: '1px solid #2d3748',
                  backgroundColor: selectedWallet?.publicKey === wallet.publicKey ? '#2d3748' : 'transparent',
                  transition: 'background-color 0.2s ease',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLDivElement).style.backgroundColor = '#2d3748';
                }}
                onMouseLeave={(e) => {
                  if (selectedWallet?.publicKey !== wallet.publicKey) {
                    (e.target as HTMLDivElement).style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{ color: '#e2e8f0' }}>
                  {wallet.name || `Trading Wallet ${wallets.indexOf(wallet) + 1}`}
                </div>
                <div style={{ color: '#94a3b8' }}>
                  ${portfolioValues[wallet.publicKey]?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedWallet && (
        <div style={{
          padding: '0.75rem 1rem',
          backgroundColor: '#2d3748',
          borderRadius: '0.5rem',
          color: '#e2e8f0',
          fontSize: '0.875rem',
          whiteSpace: 'nowrap'
        }}>
          ${portfolioValues[selectedWallet.publicKey]?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
        </div>
      )}
    </div>
  );
};

export default TradingWalletSelector; 