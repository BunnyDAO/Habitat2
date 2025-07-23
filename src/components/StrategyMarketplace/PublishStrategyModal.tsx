import React, { useState, useEffect } from 'react';
import { PublishStrategyRequest, STRATEGY_CATEGORIES, STRATEGY_TAGS } from '../../types/strategy-marketplace';
import { API_CONFIG } from '../../config/api';
import './StrategyModals.css';

interface PublishStrategyModalProps {
  onClose: () => void;
  onComplete: () => void;
  userWallet?: string;
}

interface Strategy {
  id: number;
  name: string;
  strategy_type: string;
  is_active: boolean;
}

export const PublishStrategyModal: React.FC<PublishStrategyModalProps> = ({
  onClose,
  onComplete,
  userWallet
}) => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<number | null>(null);
  const [publishData, setPublishData] = useState<PublishStrategyRequest>({
    title: '',
    description: '',
    category: 'Wallet Monitor',
    tags: [],
    requiredWallets: 1,
    walletRequirements: [
      {
        position: 1,
        role: 'primary',
        minBalance: 0.1,
        description: ''
      }
    ],
    minBalanceSol: 0.1,
    isFree: true,
    priceSol: 0
  });
  const [loading, setLoading] = useState(false);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUserStrategies();
  }, []);

  const loadUserStrategies = async () => {
    try {
      const token = localStorage.getItem('auth.token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/strategies/unpublished`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load strategies');
      }

      const unpublishedStrategies = await response.json();
      // Backend already returns only unpublished, active strategies
      setStrategies(unpublishedStrategies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategies');
    } finally {
      setLoadingStrategies(false);
    }
  };

  const handleStrategySelection = (strategyId: number) => {
    setSelectedStrategy(strategyId);
    const strategy = strategies.find(s => s.id === strategyId);
    if (strategy) {
      setPublishData(prev => ({
        ...prev,
        title: strategy.name || `${strategy.strategy_type} Strategy`,
        category: strategy.strategy_type === 'wallet-monitor' ? 'Wallet Monitor' :
                 strategy.strategy_type === 'price-monitor' ? 'Price Monitor' :
                 strategy.strategy_type === 'vault' ? 'Vault' :
                 strategy.strategy_type === 'levels' ? 'Levels' :
                 strategy.strategy_type === 'drift-perp' ? 'Drift Perp' : 'Other'
      }));
    }
  };

  const handleInputChange = (field: keyof PublishStrategyRequest, value: any) => {
    setPublishData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleTagToggle = (tag: string) => {
    setPublishData(prev => ({
      ...prev,
      tags: prev.tags?.includes(tag) 
        ? prev.tags.filter(t => t !== tag)
        : [...(prev.tags || []), tag]
    }));
  };

  const handleWalletRequirementChange = (index: number, field: string, value: any) => {
    setPublishData(prev => ({
      ...prev,
      walletRequirements: prev.walletRequirements.map((req, i) => 
        i === index ? { ...req, [field]: value } : req
      )
    }));
  };

  const addWalletRequirement = () => {
    if (publishData.walletRequirements.length < 3) {
      setPublishData(prev => ({
        ...prev,
        requiredWallets: prev.requiredWallets + 1,
        walletRequirements: [...prev.walletRequirements, {
          position: prev.walletRequirements.length + 1,
          role: 'secondary',
          minBalance: 0.1,
          description: ''
        }]
      }));
    }
  };

  const removeWalletRequirement = (index: number) => {
    if (publishData.walletRequirements.length > 1) {
      setPublishData(prev => ({
        ...prev,
        requiredWallets: prev.requiredWallets - 1,
        walletRequirements: prev.walletRequirements
          .filter((_, i) => i !== index)
          .map((req, i) => ({ ...req, position: i + 1 }))
      }));
    }
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    
    if (!selectedStrategy) {
      errors.push('Please select a strategy to publish');
    }
    
    if (!publishData.title.trim()) {
      errors.push('Title is required');
    }
    
    if (!publishData.isFree && (!publishData.priceSol || publishData.priceSol <= 0)) {
      errors.push('Price must be greater than 0 for paid strategies');
    }

    if (publishData.walletRequirements.length === 0) {
      errors.push('At least one wallet requirement is needed');
    }

    return errors;
  };

  const handlePublish = async () => {
    const validationErrors = validateForm();
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

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/strategies/${selectedStrategy}/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(publishData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to publish strategy');
      }

      const result = await response.json();
      console.log('Strategy published successfully:', result);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish strategy');
    } finally {
      setLoading(false);
    }
  };

  if (loadingStrategies) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content publish-strategy-modal" onClick={(e) => e.stopPropagation()}>
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading your strategies...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content publish-strategy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Publish Strategy</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="publish-content">
          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}

          {/* Strategy Selection */}
          <div className="form-section">
            <h3>Select Strategy to Publish</h3>
            {strategies.length > 0 ? (
              <div className="strategy-selection">
                {strategies.map(strategy => (
                  <div 
                    key={strategy.id} 
                    className={`strategy-option ${selectedStrategy === strategy.id ? 'selected' : ''}`}
                    onClick={() => handleStrategySelection(strategy.id)}
                  >
                    <h4>{strategy.name || `${strategy.strategy_type} Strategy`}</h4>
                    <p>Type: {strategy.strategy_type}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-strategies">
                <p>You don't have any unpublished strategies. Create a strategy first to publish it.</p>
              </div>
            )}
          </div>

          {selectedStrategy && (
            <>
              {/* Basic Information */}
              <div className="form-section">
                <h3>Publishing Details</h3>
                
                <div className="form-group">
                  <label>Title *</label>
                  <input
                    type="text"
                    value={publishData.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="Enter a catchy title for your strategy"
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={publishData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder="Describe how your strategy works and its benefits"
                    rows={4}
                    disabled={loading}
                  />
                </div>

                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={publishData.category}
                    onChange={(e) => handleInputChange('category', e.target.value)}
                    disabled={loading}
                  >
                    {STRATEGY_CATEGORIES.map(category => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tags */}
              <div className="form-section">
                <h3>Tags (Select up to 5)</h3>
                <div className="tags-selection">
                  {STRATEGY_TAGS.slice(0, 15).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-option ${publishData.tags?.includes(tag) ? 'selected' : ''}`}
                      onClick={() => handleTagToggle(tag)}
                      disabled={loading || (!publishData.tags?.includes(tag) && (publishData.tags?.length || 0) >= 5)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pricing */}
              <div className="form-section">
                <h3>Pricing</h3>
                <div className="pricing-options">
                  <label className="radio-option">
                    <input
                      type="radio"
                      checked={publishData.isFree}
                      onChange={() => handleInputChange('isFree', true)}
                      disabled={loading}
                    />
                    Free Strategy
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      checked={!publishData.isFree}
                      onChange={() => handleInputChange('isFree', false)}
                      disabled={loading}
                    />
                    Paid Strategy
                  </label>
                </div>
                
                {!publishData.isFree && (
                  <div className="form-group">
                    <label>Price (SOL)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={publishData.priceSol}
                      onChange={(e) => handleInputChange('priceSol', parseFloat(e.target.value))}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>

              {/* Wallet Requirements */}
              <div className="form-section">
                <h3>Wallet Requirements</h3>
                {publishData.walletRequirements.map((req, index) => (
                  <div key={index} className="wallet-requirement">
                    <div className="requirement-header">
                      <h4>Wallet {req.position}</h4>
                      {publishData.walletRequirements.length > 1 && (
                        <button 
                          type="button"
                          onClick={() => removeWalletRequirement(index)}
                          className="remove-button"
                          disabled={loading}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    
                    <div className="form-row">
                      <div className="form-group">
                        <label>Role</label>
                        <select
                          value={req.role}
                          onChange={(e) => handleWalletRequirementChange(index, 'role', e.target.value)}
                          disabled={loading}
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary">Secondary</option>
                          <option value="vault">Vault</option>
                          <option value="backup">Backup</option>
                        </select>
                      </div>
                      
                      <div className="form-group">
                        <label>Min Balance (SOL)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={req.minBalance}
                          onChange={(e) => handleWalletRequirementChange(index, 'minBalance', parseFloat(e.target.value))}
                          disabled={loading}
                        />
                      </div>
                    </div>
                    
                    <div className="form-group">
                      <label>Description</label>
                      <input
                        type="text"
                        value={req.description}
                        onChange={(e) => handleWalletRequirementChange(index, 'description', e.target.value)}
                        placeholder="Describe the purpose of this wallet"
                        disabled={loading}
                      />
                    </div>
                  </div>
                ))}
                
                {publishData.walletRequirements.length < 3 && (
                  <button 
                    type="button"
                    onClick={addWalletRequirement}
                    className="add-wallet-button"
                    disabled={loading}
                  >
                    Add Another Wallet
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} disabled={loading} className="cancel-button">
            Cancel
          </button>
          <button 
            onClick={handlePublish} 
            disabled={loading || !selectedStrategy || strategies.length === 0}
            className="publish-button"
          >
            {loading ? 'Publishing...' : 'Publish Strategy'}
          </button>
        </div>
      </div>
    </div>
  );
};