import React, { useState, useEffect, useRef } from 'react';
import { TokenTable } from '../components/TokenTable/TokenTable';
import { TradingViewChart } from '../components/TradingViewChart/TradingViewChart';
import { TradingWalletSelector } from '../components/TradingWalletSelector/TradingWalletSelector';
import { TradingWallet } from '../types/wallet';
import { Connection, PublicKey } from '@solana/web3.js';
import { createRoot } from 'react-dom/client';
import { TokenBalancesList } from '../App';

interface GraphsProps {
  tradingWallets: TradingWallet[];
  heliusApiKey: string;
  endpoint: string;
}

// Component to fetch and report portfolio value
const PortfolioValueFetcher: React.FC<{
  walletAddress: string;
  connection: Connection;
  tradingWallet: TradingWallet;
  onValue: (value: number) => void;
}> = ({ walletAddress, connection, tradingWallet, onValue }) => {
  const [totalValue, setTotalValue] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const mountedRef = useRef(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    
    // Create a container div that will be hidden but still rendered
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; visibility: hidden; pointer-events: none;';
    document.body.appendChild(container);
    containerRef.current = container;

    // Create a portal to render the TokenBalancesList
    rootRef.current = createRoot(container);
    rootRef.current.render(
      <div id={`portfolio-value-${walletAddress}`}>
        <TokenBalancesList
          walletAddress={walletAddress}
          connection={connection}
          tradingWallet={tradingWallet}
          displayMode="total-only"
          onRpcError={() => {}}
        />
      </div>
    );

    // Set up an interval to check for value updates
    const intervalId = setInterval(() => {
      if (!mountedRef.current) return;
      
      const text = container.textContent || '';
      const match = text.match(/Portfolio Value: \$([0-9,.]+)/);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(value) && value !== totalValue) {
          setTotalValue(value);
          onValue(value);
        }
      }
    }, 1000); // Check every second

    // Store cleanup function
    cleanupRef.current = () => {
      if (rootRef.current) {
        rootRef.current.unmount();
        rootRef.current = null;
      }
      if (containerRef.current) {
        document.body.removeChild(containerRef.current);
        containerRef.current = null;
      }
    };

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
      
      // Schedule cleanup for next tick
      if (cleanupRef.current) {
        Promise.resolve().then(cleanupRef.current);
      }
    };
  }, [walletAddress, connection, tradingWallet, onValue, totalValue]);

  return null;
};

export const Graphs: React.FC<GraphsProps> = ({
  tradingWallets,
  heliusApiKey,
  endpoint
}) => {
  const [selectedToken, setSelectedToken] = useState<{ mintAddress: string; symbol: string } | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<TradingWallet | null>(null);
  const [portfolioValues, setPortfolioValues] = useState<Record<string, number>>({});
  const connection = useRef(new Connection(
    endpoint.startsWith('http') ? endpoint : `http://localhost:3001${endpoint}`
  ));

  // Handle token selection
  const handleTokenSelect = (mintAddress: string, symbol: string) => {
    setSelectedToken({ mintAddress, symbol });
  };

  // Handle wallet selection
  const handleWalletSelect = (wallet: TradingWallet) => {
    setSelectedWallet(wallet);
  };

  // Handle portfolio value updates
  const handlePortfolioValue = (walletAddress: string, value: number) => {
    setPortfolioValues(prev => ({
      ...prev,
      [walletAddress]: value
    }));
  };

  return (
    <>
      {/* Portfolio value fetchers */}
      {tradingWallets.map(wallet => (
        <PortfolioValueFetcher
          key={wallet.publicKey}
          walletAddress={wallet.publicKey}
          connection={connection.current}
          tradingWallet={wallet}
          onValue={(value) => handlePortfolioValue(wallet.publicKey, value)}
        />
      ))}

      {/* Main UI */}
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
          {/* Header with Trading Wallet Selector */}
          <div style={{
            backgroundColor: '#1e293b',
            padding: '1rem',
            borderRadius: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem'
            }}>
              <h2 style={{ 
                color: '#e2e8f0', 
                margin: 0,
                fontSize: '1.125rem',
                fontWeight: 600
              }}>Trading Wallet</h2>
              {selectedWallet && (
                <div style={{
                  color: '#94a3b8',
                  fontSize: '0.875rem'
                }}>
                  {selectedWallet.name || `Trading Wallet ${tradingWallets.indexOf(selectedWallet) + 1}`}
                </div>
              )}
            </div>
            <TradingWalletSelector
              wallets={tradingWallets}
              selectedWallet={selectedWallet}
              onSelectWallet={handleWalletSelect}
              portfolioValues={portfolioValues}
            />
          </div>

          {/* Chart or Prompt */}
          {selectedToken ? (
            <div style={{
              backgroundColor: '#1e293b',
              padding: '1rem',
              borderRadius: '0.5rem',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem'
              }}>
                <h2 style={{ 
                  color: '#e2e8f0', 
                  margin: 0,
                  fontSize: '1.125rem',
                  fontWeight: 600
                }}>Price Chart</h2>
                <div style={{
                  color: '#94a3b8',
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{ color: '#60a5fa' }}>{selectedToken.symbol}</span>
                  <span>•</span>
                  <span>{selectedToken.mintAddress.slice(0, 4)}...{selectedToken.mintAddress.slice(-4)}</span>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <TradingViewChart
                  symbol={selectedToken.symbol}
                  tokenAddress={selectedToken.mintAddress}
                  heliusEndpoint={endpoint}
                />
              </div>
            </div>
          ) : (
            <div style={{
              backgroundColor: '#1e293b',
              padding: '1.5rem',
              borderRadius: '0.5rem',
              color: '#94a3b8',
              textAlign: 'center',
              fontSize: '0.875rem'
            }}>
              Select a token from the list to view its chart
            </div>
          )}

          {/* Trading Interface - TODO */}
          {selectedToken && selectedWallet && (
            <div style={{
              backgroundColor: '#1e293b',
              padding: '1rem',
              borderRadius: '0.5rem'
            }}>
              <h2 style={{ 
                color: '#e2e8f0', 
                marginTop: 0,
                marginBottom: '1rem',
                fontSize: '1.125rem',
                fontWeight: 600
              }}>
                Trading Interface
              </h2>
              <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                Trading functionality coming soon...
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}; 