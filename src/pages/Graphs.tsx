import React, { useState, useEffect, useRef } from 'react';
import { TokenTable } from '../components/TokenTable/TokenTable';
import { TradingViewChart } from '../components/TradingViewChart/TradingViewChart';
import { TradingWallet } from '../types/wallet';
import { Connection } from '@solana/web3.js';
import { createRoot } from 'react-dom/client';
import { TokenBalancesList } from '../components/TokenBalancesList';

interface GraphsProps {
  tradingWallets: TradingWallet[];
  heliusApiKey: string;
  endpoint: string;
}

interface TokenTableProps {
  heliusApiKey: string;
  onSelectToken: (tokenAddress: string, symbol: string) => void;
}

// Component to fetch and report portfolio value
const PortfolioValueFetcher: React.FC<{
  walletAddress: string;
  connection: Connection;
  tradingWallet: TradingWallet;
  onRpcError: () => void;
  onPortfolioValue?: (value: number) => void;
}> = ({ walletAddress, connection, tradingWallet, onRpcError, onPortfolioValue }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const root = createRoot(containerRef.current);
    root.render(
      <TokenBalancesList
        walletAddress={walletAddress}
        displayMode="total-only"
        onRpcError={onRpcError}
      />
    );

    return () => {
      root.unmount();
    };
  }, [walletAddress, connection, tradingWallet, onRpcError]);

  return <div ref={containerRef} style={{ display: 'none' }} />;
};

export const Graphs: React.FC<GraphsProps> = ({
  tradingWallets,
  heliusApiKey,
  endpoint
}) => {
  const [selectedToken, setSelectedToken] = useState<{ tokenAddress: string; symbol: string } | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<TradingWallet | null>(null);
  const [portfolioValues, setPortfolioValues] = useState<Record<string, number>>({});
  const connection = useRef(new Connection(
    endpoint.startsWith('http') ? endpoint : `http://localhost:3001${endpoint}`
  ));

  // Handle token selection
  const handleTokenSelect = (tokenAddress: string, symbol: string) => {
    setSelectedToken({ tokenAddress, symbol });
  };

  // Handle wallet selection
  const handleWalletSelect = (wallet: TradingWallet) => {
    setSelectedWallet(wallet);
  };

  // Handle portfolio value update
  const handlePortfolioValue = (walletAddress: string, value: number) => {
    setPortfolioValues(prev => ({
      ...prev,
      [walletAddress]: value
    }));
  };

  // Handle RPC error
  const handleRpcError = () => {
    console.error('RPC error occurred');
  };

  return (
    <div style={{ 
      display: 'flex', 
      gap: '1.5rem',
      padding: '0.75rem',
      maxWidth: '1600px',
      margin: '0 auto',
      height: 'calc(100vh - 4rem)'
    }}>
      {/* Left side - Token Table */}
      <div style={{ 
        flex: '1.2',
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <TokenTable 
          heliusApiKey={heliusApiKey} 
          onSelectToken={handleTokenSelect} 
        />
      </div>

      {/* Right side - Trading Wallet Selector and Chart */}
      <div style={{ 
        flex: '2',
        minWidth: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        {/* Portfolio Value Fetchers */}
        {tradingWallets.map(wallet => (
          <PortfolioValueFetcher
            key={wallet.publicKey}
            walletAddress={wallet.publicKey}
            connection={connection.current}
            tradingWallet={wallet}
            onRpcError={handleRpcError}
            onPortfolioValue={(value) => handlePortfolioValue(wallet.publicKey, value)}
          />
        ))}

        {/* Trading Wallet Selector */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {tradingWallets.map(wallet => (
            <button
              key={wallet.publicKey}
              onClick={() => handleWalletSelect(wallet)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: selectedWallet?.publicKey === wallet.publicKey ? '#3b82f6' : '#1e293b',
                color: '#e2e8f0',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <span>{wallet.name || wallet.publicKey.slice(0, 4) + '...' + wallet.publicKey.slice(-4)}</span>
              {portfolioValues[wallet.publicKey] && (
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                  ${portfolioValues[wallet.publicKey].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Chart */}
        {selectedToken?.tokenAddress && selectedToken?.symbol && selectedWallet && (
          <div style={{ flex: 1, minHeight: 0 }}>
            <TradingViewChart
              symbol={selectedToken.symbol}
              tokenAddress={selectedToken.tokenAddress}
              heliusEndpoint={endpoint}
            />
          </div>
        )}
      </div>
    </div>
  );
}; 