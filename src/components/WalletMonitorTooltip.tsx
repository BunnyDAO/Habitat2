import React from 'react';

interface WalletMonitorTooltipProps {
  walletAddress: string;
  walletName?: string;
  profitLoss: string;
  mirror: string;
}

export const WalletMonitorTooltip: React.FC<WalletMonitorTooltipProps> = ({
  walletAddress,
  walletName,
  profitLoss,
  mirror
}) => {
  return (
    <div style={{
      backgroundColor: '#1e293b',
      padding: '0.75rem',
      borderRadius: '0.375rem',
      fontSize: '0.75rem',
      color: '#e2e8f0',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      minWidth: '200px'
    }}>
      <div style={{ marginBottom: '0.5rem' }}>
        Monitoring: {walletName || `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`}
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
        {walletAddress}
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        Profit/Loss: {profitLoss}
      </div>
      <div style={{ marginTop: '0.25rem' }}>
        Mirror: {mirror}
      </div>
    </div>
  );
}; 