import { useState, useEffect, useCallback, useRef } from 'react';
import { TokenBalance } from '../types/balance';
import { TokenLogo } from './TokenLogo';
import { WalletBalancesService } from '../services/WalletBalancesService';
import { usePortfolio } from '../contexts/PortfolioContext';

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
  const { updatePortfolioValue } = usePortfolio();

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
      updatePortfolioValue(walletAddress, total);
      setFetchProgress(100);
    } catch (error) {
      console.error('Error fetching balances:', error);
      if (onRpcError) onRpcError();
    } finally {
      setIsFetching(false);
      setIsInitialLoad(false);
    }
  }, [walletAddress, onRpcError, updatePortfolioValue]);

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
          position: 'relative',
          zIndex: 1
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
            <TokenLogo logoURI={balance.logoURI} symbol={balance.symbol} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{balance.symbol}</span>
                <span>${balance.usdValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
                <span>{balance.uiBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                <span>${(balance.usdValue / balance.uiBalance)?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/token</span>
              </div>
            </div>
          </div>

          {/* Vertical ellipsis menu */}
          <div style={{ position: 'relative', marginLeft: '12px', zIndex: 2 }}>
            <button
              onClick={() => setMenuOpen(balance.mint === menuOpen ? null : balance.mint)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '6px 8px',
                fontSize: '20px',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'all 0.2s ease',
                fontWeight: 'bold',
                width: '32px',
                height: '32px',
                position: 'relative',
                zIndex: 2
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#334155';
                e.currentTarget.style.color = '#e2e8f0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              ⋮
            </button>

            {/* Dropdown menu */}
            {menuOpen === balance.mint && (
              <div
                ref={menuRef}
                style={{
                  position: 'absolute',
                  right: '100%',
                  top: '0',
                  marginRight: '8px',
                  backgroundColor: '#1e293b',
                  border: '1px solid #3b82f6',
                  borderRadius: '8px',
                  padding: '4px',
                  zIndex: 999,
                  minWidth: '140px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                }}
              >
                <button
                  onClick={() => hiddenTokens.includes(balance.mint) ? handleUnhide(balance.mint) : handleHide(balance.mint)}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    color: '#e2e8f0',
                    padding: '8px 12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#334155';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {hiddenTokens.includes(balance.mint) ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/>
                      </svg>
                      <span>Show Token</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                        <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" fill="currentColor"/>
                      </svg>
                      <span>Hide Token</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}; 