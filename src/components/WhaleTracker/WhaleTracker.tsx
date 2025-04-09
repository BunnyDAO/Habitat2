import React, { useState, useEffect } from 'react';
import { HeliusService } from '../../services/whale-tracker/helius';
import { WhaleWallet, WhaleTrackerConfig, Trade, WhaleAnalytics } from '../../types/whale-tracker/types';
import { TokenTable } from '../TokenTable/TokenTable';
import { TokenFilterButtons, TokenFilterType, MainFilterType, TimeFilterType, TopFilterType, NewPairsFilterType } from './TokenFilterButtons';

interface WhaleTrackerProps {
  heliusApiKey: string;
  endpoint: string;
}

export const WhaleTracker: React.FC<WhaleTrackerProps> = ({ heliusApiKey, endpoint }) => {
  const [whales, setWhales] = useState<WhaleWallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<WhaleTrackerConfig>({
    minTokenAmount: 1000,
    targetTokenMint: '',
    timeframe: 7,
    profitabilityThreshold: 0.5
  });
  const [selectedWhale, setSelectedWhale] = useState<string | null>(null);
  const [whaleAnalytics, setWhaleAnalytics] = useState<WhaleAnalytics | null>(null);
  const [tokenInfo, setTokenInfo] = useState<{ symbol: string; decimals: number } | null>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [mainFilter, setMainFilter] = useState<MainFilterType>('trending');
  const [timeFilter, setTimeFilter] = useState<TimeFilterType>('24h');
  const [topFilter, setTopFilter] = useState<TopFilterType>('volume');
  const [newPairsFilter, setNewPairsFilter] = useState<NewPairsFilterType>('newest');

  const heliusService = new HeliusService(endpoint, heliusApiKey);

  // Handle real-time whale movements
  useEffect(() => {
    type WhaleMovementEvent = CustomEvent<{
      address: string;
      timestamp: number;
      analytics: WhaleAnalytics;
    }>;

    const handleWhaleMovement = (event: Event) => {
      const whaleEvent = event as WhaleMovementEvent;
      const { address, analytics } = whaleEvent.detail;
      
      // Update whale analytics if this is the selected whale
      if (selectedWhale === address) {
        setWhaleAnalytics(analytics);
      }
      
      // Update whales list
      setWhales(prevWhales => {
        const index = prevWhales.findIndex(w => w.address === address);
        if (index === -1) return prevWhales;
        
        const updatedWhales = [...prevWhales];
        updatedWhales[index] = {
          ...updatedWhales[index],
          lastTradeTimestamp: analytics.lastTradeTimestamp,
          profitableTradesCount: analytics.profitableTrades,
          totalTradesCount: analytics.totalTrades,
          profitabilityRate: analytics.profitabilityRate
        };
        return updatedWhales;
      });
    };

    if (realtimeEnabled) {
      window.addEventListener('whale-movement', handleWhaleMovement);
      heliusService.trackWhaleMovements(config);
    }

    return () => {
      window.removeEventListener('whale-movement', handleWhaleMovement);
    };
  }, [realtimeEnabled, selectedWhale, config, heliusService]);

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setWhales([]);
    setSelectedWhale(null);
    setWhaleAnalytics(null);

    try {
      // First, validate the token mint address
      const trimmedMint = config.targetTokenMint.trim();
      if (!trimmedMint.match(/^[A-Za-z0-9]{32,44}$/)) {
        throw new Error('Invalid token mint address format');
      }

      // Update the config with trimmed address
      const updatedConfig = { ...config, targetTokenMint: trimmedMint };
      setConfig(updatedConfig);

      // Get whale wallets
      const whaleWallets = await heliusService.getTokenHolders(trimmedMint, config.minTokenAmount);
      
      if (whaleWallets.length === 0) {
        throw new Error('No whale wallets found for this token with the specified minimum amount');
      }

      // Get initial analytics for each whale
      const walletsWithAnalytics = await Promise.all(
        whaleWallets.map(async (whale) => {
          try {
            const analytics = await heliusService.getWhaleAnalytics(whale.address, updatedConfig);
            return {
              ...whale,
              lastTradeTimestamp: analytics.lastTradeTimestamp,
              profitableTradesCount: analytics.profitableTrades,
              totalTradesCount: analytics.totalTrades,
              profitabilityRate: analytics.profitabilityRate
            };
          } catch (error) {
            console.error(`Error fetching analytics for whale ${whale.address}:`, error);
            return whale;
          }
        })
      );

      setWhales(walletsWithAnalytics);

      // Start real-time tracking if enabled
      if (realtimeEnabled) {
        try {
          await heliusService.trackWhaleMovements(updatedConfig);
        } catch (error) {
          console.error('Error starting real-time tracking:', error);
          setError('Real-time tracking could not be enabled. Tracking in polling mode.');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred');
      console.error('Error in handleConfigSubmit:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWhaleSelect = async (address: string) => {
    setSelectedWhale(address);
    setLoading(true);
    try {
      const analytics = await heliusService.getWhaleAnalytics(address, config);
      setWhaleAnalytics(analytics);
    } catch (error) {
      setError('Failed to fetch whale analytics');
    } finally {
      setLoading(false);
    }
  };

  const handleTokenSelect = (mintAddress: string) => {
    setConfig(prev => ({ ...prev, targetTokenMint: mintAddress }));
  };

  const handleFilterChange = (filter: TokenFilterType, filterType: 'main' | 'time' | 'top' | 'newPairs') => {
    switch (filterType) {
      case 'main':
        setMainFilter(filter as MainFilterType);
        break;
      case 'time':
        setTimeFilter(filter as TimeFilterType);
        break;
      case 'top':
        setTopFilter(filter as TopFilterType);
        break;
      case 'newPairs':
        setNewPairsFilter(filter as NewPairsFilterType);
        break;
    }
    // TODO: Add logic to filter whale data based on selected filters
  };

  // Add cleanup effect
  useEffect(() => {
    // Cleanup function
    return () => {
      // Reset any potential styles that might have leaked
      document.documentElement.style.filter = '';
      document.documentElement.style.opacity = '';
      document.body.style.filter = '';
      document.body.style.opacity = '';
    };
  }, []);

  return (
    <div className="whale-tracker">
      {/* Filter section with fixed height */}
      <div style={{ 
        marginBottom: '1rem',
        height: '7rem',  // Fixed height to accommodate both button rows
        position: 'relative'
      }}>
        <TokenFilterButtons
          selectedFilter={mainFilter}
          selectedTimeFilter={timeFilter}
          selectedTopFilter={topFilter}
          selectedNewPairsFilter={newPairsFilter}
          onFilterChange={handleFilterChange}
        />
      </div>
      
      <div style={{ 
        display: 'flex', 
        gap: '2.5rem', 
        padding: '1rem',
        maxWidth: '1600px',
        margin: '0 auto',
        isolation: 'isolate',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Token Table Section */}
        <div style={{ 
          flex: '1.2',
          minWidth: '0',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem'
        }}>
          <TokenTable 
            heliusApiKey={heliusApiKey} 
            onSelectToken={handleTokenSelect}
            filterType={mainFilter === 'new' ? 'new' : 'default'}
          />
        </div>

        {/* Whale Tracker Section */}
        <div style={{ 
          flex: '1',
          minWidth: '0',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem'
        }}>
          <div style={{ 
            backgroundColor: '#1e293b',
            padding: '1.5rem',
            borderRadius: '0.5rem'
          }}>
            <h2 style={{ 
              color: '#e2e8f0', 
              marginBottom: '1.5rem',
              fontSize: '1.125rem',
              fontWeight: 600
            }}>Whale Tracker Configuration</h2>
            <form onSubmit={handleConfigSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                  Token Mint Address
                </label>
                <input
                  type="text"
                  value={config.targetTokenMint}
                  onChange={(e) => setConfig({ ...config, targetTokenMint: e.target.value.trim() })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #2d3748',
                    borderRadius: '0.375rem',
                    color: '#e2e8f0',
                    fontSize: '0.875rem'
                  }}
                  placeholder="Enter token mint address"
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                  Minimum Token Amount
                </label>
                <input
                  type="number"
                  value={config.minTokenAmount}
                  onChange={(e) => setConfig({ ...config, minTokenAmount: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #2d3748',
                    borderRadius: '0.375rem',
                    color: '#e2e8f0',
                    fontSize: '0.875rem'
                  }}
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                  Timeframe (days)
                </label>
                <input
                  type="number"
                  value={config.timeframe}
                  onChange={(e) => setConfig({ ...config, timeframe: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: '#1e293b',
                    border: '1px solid #2d3748',
                    borderRadius: '0.375rem',
                    color: '#e2e8f0',
                    fontSize: '0.875rem'
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={realtimeEnabled}
                  onChange={(e) => setRealtimeEnabled(e.target.checked)}
                  id="realtime-toggle"
                />
                <label htmlFor="realtime-toggle" style={{ color: '#94a3b8' }}>
                  Enable Real-time Tracking
                </label>
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '0.75rem',
                  backgroundColor: loading ? '#4b5563' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                {loading ? 'Loading...' : 'Track Whales'}
              </button>
            </form>
            {error && (
              <div style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</div>
            )}
          </div>

          {whales.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ color: '#e2e8f0', marginBottom: '1rem' }}>Whale Wallets</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {whales.map((whale) => (
                  <div
                    key={whale.address}
                    onClick={() => handleWhaleSelect(whale.address)}
                    style={{
                      backgroundColor: selectedWhale === whale.address ? '#2d3748' : '#1e293b',
                      padding: '1rem',
                      borderRadius: '0.5rem',
                      cursor: 'pointer',
                      border: '1px solid #3b82f6',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ color: '#e2e8f0', marginBottom: '0.5rem' }}>
                      {whale.address.slice(0, 4)}...{whale.address.slice(-4)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                      Holdings: {whale.tokenHoldings[0]?.amount.toLocaleString()} {tokenInfo?.symbol || 'tokens'}
                    </div>
                    {whale.profitabilityRate !== undefined && (
                      <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                        Win Rate: {whale.profitabilityRate.toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {whaleAnalytics && (
            <div style={{ marginTop: '2rem', backgroundColor: '#1e293b', padding: '1.5rem', borderRadius: '0.5rem' }}>
              <h3 style={{ color: '#e2e8f0', marginBottom: '1rem' }}>Whale Analytics</h3>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div style={{ backgroundColor: '#2d3748', padding: '1rem', borderRadius: '0.375rem' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Profitable Trades</div>
                    <div style={{ color: '#e2e8f0', fontSize: '1.25rem' }}>{whaleAnalytics.profitableTrades}</div>
                  </div>
                  <div style={{ backgroundColor: '#2d3748', padding: '1rem', borderRadius: '0.375rem' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Total Trades</div>
                    <div style={{ color: '#e2e8f0', fontSize: '1.25rem' }}>{whaleAnalytics.totalTrades}</div>
                  </div>
                  <div style={{ backgroundColor: '#2d3748', padding: '1rem', borderRadius: '0.375rem' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Win Rate</div>
                    <div style={{ color: '#e2e8f0', fontSize: '1.25rem' }}>
                      {whaleAnalytics.profitabilityRate.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#2d3748', padding: '1rem', borderRadius: '0.375rem' }}>
                    <div style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Avg. Profit</div>
                    <div style={{ color: '#e2e8f0', fontSize: '1.25rem' }}>
                      {whaleAnalytics.averageProfitPercentage.toFixed(2)}%
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <h4 style={{ color: '#e2e8f0', marginBottom: '1rem' }}>Recent Trades</h4>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {whaleAnalytics.recentTrades.map((trade, index) => (
                      <div
                        key={index}
                        style={{
                          backgroundColor: '#2d3748',
                          padding: '0.75rem',
                          borderRadius: '0.375rem',
                          display: 'grid',
                          gridTemplateColumns: '1fr auto',
                          gap: '1rem'
                        }}
                      >
                        <div>
                          <div style={{ color: '#e2e8f0', fontSize: '0.875rem' }}>
                            {trade.tokenIn.amount.toFixed(2)} {trade.tokenIn.symbol || 'tokens'} →{' '}
                            {trade.tokenOut.amount.toFixed(2)} {trade.tokenOut.symbol || 'tokens'}
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                            {new Date(trade.timestamp).toLocaleString()}
                          </div>
                        </div>
                        <div style={{
                          color: trade.isProfit ? '#10b981' : '#ef4444',
                          fontSize: '0.875rem'
                        }}>
                          {trade.profitPercentage?.toFixed(2)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}; 