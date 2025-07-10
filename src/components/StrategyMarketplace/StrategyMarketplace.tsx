import React, { useState, useEffect } from 'react';
import { PublishedStrategyWithMetrics, BrowseStrategiesRequest, BrowseStrategiesResponse } from '../../types/strategy-marketplace';
import { StrategyCard } from './StrategyCard';
import { StrategyFilters } from './StrategyFilters';
import { StrategyDetailsModal } from './StrategyDetailsModal';
import { PublishStrategyModal } from './PublishStrategyModal';
import { AdoptStrategyModal } from './AdoptStrategyModal';
import { API_CONFIG } from '../../config/api';
import { authService } from '../../services/auth.service';
import './StrategyMarketplace.css';

interface StrategyMarketplaceProps {
  userWallet?: string;
}

export const StrategyMarketplace: React.FC<StrategyMarketplaceProps> = ({ userWallet }) => {
  const [strategies, setStrategies] = useState<PublishedStrategyWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<PublishedStrategyWithMetrics | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showAdoptModal, setShowAdoptModal] = useState(false);
  const [filters, setFilters] = useState<BrowseStrategiesRequest>({
    sortBy: 'rating',
    sortOrder: 'desc',
    page: 1,
    limit: 12
  });
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    hasNext: false,
    hasPrev: false
  });

  useEffect(() => {
    loadStrategies();
  }, [filters]);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      
      // Check if user is authenticated
      if (!authService.isAuthenticated()) {
        throw new Error('Please connect your wallet and sign in first');
      }
      
      const token = localStorage.getItem('auth.token');
      if (!token) {
        throw new Error('Authentication token not found');
      }

      console.log('Loading strategies with token:', token ? 'Token present' : 'No token');
      console.log('API URL:', `${API_CONFIG.BASE_URL}/api/shop/strategies`);

      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            queryParams.set(key, value.join(','));
          } else {
            queryParams.set(key, value.toString());
          }
        }
      });

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/shop/strategies?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Response:', response.status, errorText);
        console.error('Request URL:', `${API_CONFIG.BASE_URL}/api/shop/strategies`);
        
        if (response.status === 404) {
          throw new Error(`Backend server may not be running or marketplace routes not found. Please ensure backend is running with 'npm run dev' in the backend folder. (Error: ${response.status})`);
        }
        
        throw new Error(`API Error: ${response.status} - ${errorText.substring(0, 100)}`);
      }

      const data: BrowseStrategiesResponse = await response.json();
      setStrategies(data.strategies);
      setPagination(data.pagination);
      setError(null);
    } catch (err) {
      console.error('Full error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load strategies');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters: Partial<BrowseStrategiesRequest>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleStrategyClick = (strategy: PublishedStrategyWithMetrics) => {
    setSelectedStrategy(strategy);
  };

  const handleAdoptStrategy = (strategy: PublishedStrategyWithMetrics) => {
    setSelectedStrategy(strategy);
    setShowAdoptModal(true);
  };

  const handleAdoptComplete = () => {
    setShowAdoptModal(false);
    setSelectedStrategy(null);
    // Optionally refresh strategies to update adoption counts
    loadStrategies();
  };

  const handlePublishComplete = () => {
    setShowPublishModal(false);
    // Refresh strategies to show the newly published strategy
    loadStrategies();
  };

  if (loading && strategies.length === 0) {
    return (
      <div className="strategy-marketplace">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading strategies...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isAuthError = error.includes('Authentication') || error.includes('connect your wallet');
    
    return (
      <div className="strategy-marketplace">
        <div className="error-message">
          <h3>{isAuthError ? 'Authentication Required' : 'Error Loading Strategies'}</h3>
          <p>{error}</p>
          {isAuthError ? (
            <div>
              <p>To access the strategy marketplace, you need to:</p>
              <ol style={{ textAlign: 'left', margin: '10px 0' }}>
                <li>Connect your wallet using the wallet button in the top-right corner</li>
                <li>Sign the authentication message when prompted</li>
                <li>Return to the marketplace</li>
              </ol>
            </div>
          ) : (
            <button onClick={loadStrategies} className="retry-button">
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="strategy-marketplace">
      <div className="marketplace-header">
        <div className="header-content">
          <h1>Strategy Marketplace</h1>
          <p>Discover and adopt proven trading automation strategies</p>
        </div>
        <div className="header-actions">
          {userWallet && (
            <button 
              onClick={() => setShowPublishModal(true)}
              className="publish-button"
            >
              Publish Strategy
            </button>
          )}
        </div>
      </div>

      <StrategyFilters 
        filters={filters}
        onFilterChange={handleFilterChange}
      />

      <div className="marketplace-content">
        {strategies.length === 0 ? (
          <div className="empty-state">
            <h3>No strategies found</h3>
            <p>Try adjusting your filters or be the first to publish a strategy!</p>
          </div>
        ) : (
          <>
            <div className="strategies-grid">
              {strategies.map((strategy) => (
                <StrategyCard
                  key={strategy.id}
                  strategy={strategy}
                  onView={() => handleStrategyClick(strategy)}
                  onAdopt={() => handleAdoptStrategy(strategy)}
                  currentUserWallet={userWallet}
                />
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button 
                  onClick={() => handlePageChange(pagination.currentPage - 1)}
                  disabled={!pagination.hasPrev}
                  className="pagination-button"
                >
                  Previous
                </button>
                
                <span className="pagination-info">
                  Page {pagination.currentPage} of {pagination.totalPages}
                </span>
                
                <button 
                  onClick={() => handlePageChange(pagination.currentPage + 1)}
                  disabled={!pagination.hasNext}
                  className="pagination-button"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedStrategy && !showAdoptModal && (
        <StrategyDetailsModal
          strategy={selectedStrategy}
          onClose={() => setSelectedStrategy(null)}
          onAdopt={() => handleAdoptStrategy(selectedStrategy)}
          currentUserWallet={userWallet}
        />
      )}

      {showPublishModal && (
        <PublishStrategyModal
          onClose={() => setShowPublishModal(false)}
          onComplete={handlePublishComplete}
          userWallet={userWallet}
        />
      )}

      {showAdoptModal && selectedStrategy && (
        <AdoptStrategyModal
          strategy={selectedStrategy}
          onClose={() => setShowAdoptModal(false)}
          onComplete={handleAdoptComplete}
          userWallet={userWallet}
        />
      )}
    </div>
  );
};