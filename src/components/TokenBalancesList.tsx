import { useState, useEffect, useCallback } from 'react';
import { TokenBalance } from '../types/balance';
import { TokenLogo } from './TokenLogo';
import { WalletBalancesService } from '../services/WalletBalancesService';

interface TokenBalancesListProps {
  walletAddress: string;
  displayMode?: 'full' | 'total-only';
  onRpcError?: () => void;
}

export const TokenBalancesList: React.FC<TokenBalancesListProps> = ({ 
  walletAddress, 
  displayMode = 'full',
  onRpcError 
}) => {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [totalUsdValue, setTotalUsdValue] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return;
    if (isFetching) return;

    setIsFetching(true);
    setFetchProgress(0);

    try {
      const walletBalancesService = WalletBalancesService.getInstance();
      const response = await walletBalancesService.getBalances(walletAddress);
      
      // Calculate total USD value
      const total = response.balances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
      
      setBalances(response.balances);
      setTotalUsdValue(total);
      setFetchProgress(100);
    } catch (error) {
      console.error('Error fetching balances:', error);
      if (onRpcError) onRpcError();
    } finally {
      setIsFetching(false);
      setIsInitialLoad(false);
    }
  }, [walletAddress, onRpcError]);

  // Initial fetch
  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Set up auto-refresh
  useEffect(() => {
    const intervalId = setInterval(fetchBalances, 30000); // 30 seconds
    return () => clearInterval(intervalId);
  }, [fetchBalances]);

  // Show loading state
  if (isInitialLoad) {
    return (
      <div style={{ color: '#94a3b8', padding: '1rem' }}>
        <div>Fetching token balances...</div>
        {isFetching && (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ 
              width: '100%', 
              backgroundColor: '#1e293b', 
              borderRadius: '0.25rem',
              height: '0.5rem',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${fetchProgress}%`, 
                backgroundColor: '#3b82f6', 
                height: '100%',
                transition: 'width 0.3s ease-in-out'
              }}></div>
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#94a3b8' }}>
              {fetchProgress < 100 ? `${fetchProgress}% complete` : 'Finalizing...'}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Show empty state
  if (balances.length === 0) {
    return <div style={{ color: '#94a3b8' }}>No tokens found</div>;
  }

  // Show total only mode
  if (displayMode === 'total-only') {
    return (
      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
        Portfolio Value: ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    );
  }

  // Show full list
  return (
    <div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '0.25rem'
      }}>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
          Total Portfolio Value
        </div>
        <button 
          onClick={fetchBalances}
          disabled={isFetching}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: isFetching ? 'not-allowed' : 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.75rem'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 8L16 4M16 4L20 8M16 4V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(135 16 4)"/>
          </svg>
          <span style={{ marginLeft: '0.25rem' }}>Refresh</span>
        </button>
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '1rem', fontWeight: '500', marginBottom: '1rem' }}>
        ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>

      {balances.map(balance => (
        <div key={balance.mint} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0.5rem',
          borderBottom: '1px solid #2d3748'
        }}>
          <TokenLogo 
            logoURI={balance.logoURI} 
            symbol={balance.symbol} 
            size={24}
          />
          <div style={{ flex: 1, marginLeft: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{balance.symbol}</span>
              <span>${balance.usdValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>{balance.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span>${(balance.usdValue / balance.uiBalance)?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}; 