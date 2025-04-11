import React from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';

export const WalletButton: React.FC = () => {
  const { connected, publicKey } = useWallet();
  
  const truncatedAddress = publicKey ? 
    `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}` : 
    '';

  return (
    <WalletMultiButton
      style={{
        backgroundColor: connected ? '#3b82f6' : '#4c1d95',
        color: 'white',
        border: 'none',
        borderRadius: '0.375rem',
        padding: '0.5rem 0.75rem',
        fontSize: '0.875rem',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        fontWeight: '500',
        height: '32px',
        justifyContent: 'center',
        minWidth: '140px',
        lineHeight: '1'
      }}
    >
      {connected ? truncatedAddress : 'Select Wallet'}
    </WalletMultiButton>
  );
}; 