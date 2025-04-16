import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [hiddenTokens, setHiddenTokens] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!walletAddress) return;
    if (isFetching) return;

    setIsFetching(true);
    setFetchProgress(0);

    try {
      const walletBalancesService = WalletBalancesService.getInstance();
      const response = await walletBalancesService.getBalances(walletAddress);
      
      // Get hidden tokens from backend
      const hiddenTokens = await walletBalancesService.getHiddenTokens(walletAddress);
      setHiddenTokens(hiddenTokens);
      
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

  // Hide token
  const handleHide = async (mint: string) => {
    try {
      const walletBalancesService = WalletBalancesService.getInstance();
      await walletBalancesService.hideToken(walletAddress, mint);
      setHiddenTokens(prev => [...prev, mint]);
      setMenuOpen(null);
    } catch (error) {
      console.error('Error hiding token:', error);
    }
  };

  // Unhide token
  const handleUnhide = async (mint: string) => {
    try {
      const walletBalancesService = WalletBalancesService.getInstance();
      await walletBalancesService.unhideToken(walletAddress, mint);
      setHiddenTokens(prev => prev.filter(m => m !== mint));
      setMenuOpen(null);
    } catch (error) {
      console.error('Error unhiding token:', error);
    }
  };

  // Click outside to close menu
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
          Total Portfolio Value
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
          <button
            onClick={() => setShowHidden(v => !v)}
            style={{
              background: showHidden ? '#334155' : 'none',
              border: '1px solid #64748b',
              color: '#94a3b8',
              borderRadius: '0.25rem',
              padding: '0.25rem 0.5rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
              marginLeft: '0.5rem',
              opacity: hiddenTokens.length === 0 ? 0.5 : 1
            }}
            disabled={hiddenTokens.length === 0}
          >
            {showHidden ? 'Hide Hidden Tokens' : 'Show Hidden Tokens'}
          </button>
        </div>
      </div>
      <div style={{ color: '#e2e8f0', fontSize: '1rem', fontWeight: '500', marginBottom: '1rem' }}>
        ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      {[...balances.filter(b => showHidden ? true : !hiddenTokens.includes(b.mint))].map(balance => (
        <div key={balance.mint} style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0.5rem',
          borderBottom: '1px solid #2d3748',
          opacity: hiddenTokens.includes(balance.mint) ? 0.5 : 1,
          background: hiddenTokens.includes(balance.mint) ? 'rgba(100,116,139,0.1)' : undefined,
          position: 'relative'
        }}>
          {/* Ellipsis menu */}
          <div style={{ position: 'relative', marginRight: '0.5rem' }}>
            <button
              onClick={() => setMenuOpen(balance.mint === menuOpen ? null : balance.mint)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1.25rem',
                padding: '0.25rem',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(100,116,139,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              aria-label="Token options"
            >
              ⋮
            </button>
            {menuOpen === balance.mint && (
              <div
                ref={menuRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '0.375rem',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  zIndex: 10,
                  minWidth: '120px',
                  overflow: 'hidden'
                }}
              >
                <button
                  onClick={() => hiddenTokens.includes(balance.mint) ? handleUnhide(balance.mint) : handleHide(balance.mint)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#e2e8f0',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 1rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#334155';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {hiddenTokens.includes(balance.mint) ? 'Unhide' : 'Hide'}
                </button>
              </div>
            )}
          </div>
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