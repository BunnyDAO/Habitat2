import React, { useState, useEffect } from 'react';
import { PublishedStrategyWithMetrics, AdoptStrategyRequest, WalletMapping } from '../../types/strategy-marketplace';
import { API_CONFIG } from '../../config/api';
import './StrategyModals.css';

interface AdoptStrategyModalProps {
  strategy: PublishedStrategyWithMetrics;
  onClose: () => void;
  onComplete: () => void;
  userWallet?: string;
}

interface TradingWallet {
  id: number;
  name: string;
  pubkey: string;
  balance_sol: number;
}

export const AdoptStrategyModal: React.FC<AdoptStrategyModalProps> = ({
  strategy,
  onClose,
  onComplete,
  userWallet
}) => {
  const [tradingWallets, setTradingWallets] = useState<TradingWallet[]>([]);
  const [walletMapping, setWalletMapping] = useState<WalletMapping>({});
  const [customName, setCustomName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingWallets, setLoadingWallets] = useState(true);

  useEffect(() => {
    loadTradingWallets();
  }, []);

  const loadTradingWallets = async () => {
    try {
      const token = localStorage.getItem('auth.token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/trading-wallets`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load trading wallets');
      }

      const wallets = await response.json();
      setTradingWallets(wallets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trading wallets');
    } finally {
      setLoadingWallets(false);
    }
  };

  const handleWalletMapping = (position: number, walletId: number) => {
    setWalletMapping(prev => ({
      ...prev,
      [position]: walletId
    }));
  };

  const validateMapping = (): string[] => {
    const errors: string[] = [];
    
    // Check if all required positions are mapped
    for (let i = 1; i <= strategy.required_wallets; i++) {
      if (!walletMapping[i]) {
        errors.push(`Please select a wallet for position ${i}`);
      }
    }

    // Check for duplicate mappings
    const walletIds = Object.values(walletMapping);
    const uniqueWalletIds = new Set(walletIds);
    if (walletIds.length !== uniqueWalletIds.size) {
      errors.push('Cannot map multiple positions to the same wallet');
    }

    return errors;
  };

  const handleAdopt = async () => {
    const validationErrors = validateMapping();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('. '));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('auth.token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const adoptRequest: AdoptStrategyRequest = {
        walletMapping,
        customizations: customName ? { name: customName } : undefined
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/shop/strategies/${strategy.id}/adopt`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(adoptRequest)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to adopt strategy');
      }

      const result = await response.json();
      console.log('Strategy adopted successfully:', result);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adopt strategy');
    } finally {
      setLoading(false);
    }
  };

  if (loadingWallets) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content adopt-strategy-modal" onClick={(e) => e.stopPropagation()}>
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading your wallets...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content adopt-strategy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Adopt Strategy: {strategy.title}</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="adopt-content">
          <div className="strategy-summary">
            <p><strong>Category:</strong> {strategy.category}</p>
            <p><strong>Required Wallets:</strong> {strategy.required_wallets}</p>
            <p><strong>Price:</strong> {strategy.is_free ? 'Free' : `${strategy.price_sol} SOL`}</p>
          </div>

          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}

          <div className="wallet-mapping">
            <h3>Map Strategy Wallets to Your Wallets</h3>
            <p>Select which of your trading wallets to use for each position in this strategy:</p>

            {Array.from({ length: strategy.required_wallets }, (_, i) => i + 1).map(position => (
              <div key={position} className="wallet-mapping-row">
                <label>Position {position}:</label>
                <select
                  value={walletMapping[position] || ''}
                  onChange={(e) => handleWalletMapping(position, parseInt(e.target.value))}
                  disabled={loading}
                >
                  <option value="">Select a wallet...</option>
                  {tradingWallets.map(wallet => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name} ({wallet.pubkey.slice(0, 8)}...) - {wallet.balance_sol.toFixed(2)} SOL
                    </option>
                  ))}
                </select>
              </div>
            ))}

            {tradingWallets.length === 0 && (
              <div className="no-wallets">
                <p>You don't have any trading wallets. Create some trading wallets first to adopt strategies.</p>
              </div>
            )}
          </div>

          <div className="customization">
            <h3>Customization (Optional)</h3>
            <div className="form-group">
              <label>Custom Name:</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Give this strategy a custom name..."
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} disabled={loading} className="cancel-button">
            Cancel
          </button>
          <button 
            onClick={handleAdopt} 
            disabled={loading || tradingWallets.length === 0 || Object.keys(walletMapping).length < strategy.required_wallets}
            className="adopt-button"
          >
            {loading ? 'Adopting...' : 'Adopt Strategy'}
          </button>
        </div>
      </div>
    </div>
  );
};