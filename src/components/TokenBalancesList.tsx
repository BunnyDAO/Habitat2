import React from 'react';

interface TokenBalance {
  mint: string;
  symbol: string;
  balance: number;
  decimals: number;
  uiBalance?: number;
  usdValue?: number;
  logoURI?: string;
}

interface TokenBalancesListProps {
  backendBalances?: TokenBalance[];
  displayMode?: 'full' | 'total-only';
}

export const TokenBalancesList: React.FC<TokenBalancesListProps> = ({ 
  backendBalances,
  displayMode = 'full',
}) => {
  // Pure presentational: render directly from backendBalances prop
  // Remove local state for balances and totalUsdValue

  // Debug: log backendBalances every render
  console.log('TokenBalancesList backendBalances:', backendBalances);

  // Calculate total USD value from backendBalances
  const balances = backendBalances && Array.isArray(backendBalances) ? backendBalances : [];
  const totalUsdValue = balances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0);

  // Show loading state (only for initial load or manual refresh)
  if (!backendBalances) {
    return (
      <div style={{ color: '#94a3b8', padding: '1rem' }}>
        <div>Fetching token balances...</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Display total USD value */}
      <div style={{
        backgroundColor: '#1e293b',
        padding: '0.75rem',
        borderRadius: '0.375rem',
        marginBottom: '0.5rem',
        border: '1px solid #3b82f6',
        position: 'relative'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '0.25rem'
        }}>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            Total Portfolio Value
          </div>
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '1rem', fontWeight: '500' }}>
          ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      {/* Only show tokens with non-zero balance */}
      {balances
        .filter(balance => (balance.uiBalance !== undefined ? balance.uiBalance : (balance.balance / Math.pow(10, balance.decimals))) > 0)
        .map((balance) => {
          const uiBalance = balance.uiBalance !== undefined ? balance.uiBalance : (balance.balance / Math.pow(10, balance.decimals));
          return (
            <div 
              key={balance.mint}
              style={{
                backgroundColor: '#1e293b',
                padding: '0.5rem',
                borderRadius: '0.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem',
                color: '#e2e8f0' 
              }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  backgroundColor: '#2d3748',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {balance.logoURI ? (
                    <img 
                      src={balance.logoURI} 
                      alt={`${balance.symbol} logo`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).parentElement!.innerHTML = balance.symbol.charAt(0);
                      }}
                    />
                  ) : (
                    <span style={{ 
                      color: '#e2e8f0', 
                      fontSize: '0.875rem',
                      fontWeight: 500 
                    }}>
                      {balance.symbol.charAt(0)}
                    </span>
                  )}
                </div>
                {balance.symbol}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div>{uiBalance.toFixed(4)}</div>
                  {balance.usdValue !== undefined && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      ${balance.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
    </div>
  );
}; 