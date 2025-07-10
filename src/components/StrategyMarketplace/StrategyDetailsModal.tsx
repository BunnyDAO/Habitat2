import React, { useState, useEffect } from 'react';
import { PublishedStrategyWithMetrics, StrategyDetailsResponse } from '../../types/strategy-marketplace';
import { API_CONFIG } from '../../config/api';
import './StrategyModals.css';

interface StrategyDetailsModalProps {
  strategy: PublishedStrategyWithMetrics;
  onClose: () => void;
  onAdopt: () => void;
  currentUserWallet?: string;
}

export const StrategyDetailsModal: React.FC<StrategyDetailsModalProps> = ({
  strategy,
  onClose,
  onAdopt,
  currentUserWallet
}) => {
  const [details, setDetails] = useState<StrategyDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'reviews'>('overview');

  useEffect(() => {
    loadStrategyDetails();
  }, [strategy.id]);

  const loadStrategyDetails = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth.token');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/shop/strategies/${strategy.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load strategy details');
      }

      const data: StrategyDetailsResponse = await response.json();
      setDetails(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategy details');
    } finally {
      setLoading(false);
    }
  };

  const formatROI = (roi?: number) => {
    if (roi === undefined || roi === null) return 'N/A';
    return `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const isOwnStrategy = currentUserWallet === strategy.publisher_wallet;

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content strategy-details-modal" onClick={(e) => e.stopPropagation()}>
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading strategy details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content strategy-details-modal" onClick={(e) => e.stopPropagation()}>
          <div className="error-message">
            <h3>Error Loading Details</h3>
            <p>{error || 'Failed to load strategy details'}</p>
            <button onClick={onClose} className="close-button">Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content strategy-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{strategy.title}</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="strategy-details-content">
          {/* Strategy Overview */}
          <div className="strategy-overview">
            <div className="overview-grid">
              <div className="strategy-meta">
                <span className="category">{strategy.category}</span>
                <span className="type">{strategy.strategy_type}</span>
                <span className="price">{strategy.is_free ? 'Free' : `${strategy.price_sol} SOL`}</span>
              </div>
              <div className="strategy-stats">
                <div className="stat">
                  <label>Downloads</label>
                  <span>{strategy.downloads}</span>
                </div>
                <div className="stat">
                  <label>Rating</label>
                  <span>{strategy.rating.toFixed(1)} ★</span>
                </div>
                <div className="stat">
                  <label>Required Wallets</label>
                  <span>{strategy.required_wallets}</span>
                </div>
              </div>
            </div>

            <div className="description">
              <h3>Description</h3>
              <p>{strategy.description || 'No description provided.'}</p>
            </div>

            {strategy.tags && strategy.tags.length > 0 && (
              <div className="tags-section">
                <h3>Tags</h3>
                <div className="tags">
                  {strategy.tags.map((tag, index) => (
                    <span key={index} className="tag">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="details-tabs">
            <button 
              className={activeTab === 'overview' ? 'active' : ''}
              onClick={() => setActiveTab('overview')}
            >
              Requirements
            </button>
            <button 
              className={activeTab === 'performance' ? 'active' : ''}
              onClick={() => setActiveTab('performance')}
            >
              Performance
            </button>
            <button 
              className={activeTab === 'reviews' ? 'active' : ''}
              onClick={() => setActiveTab('reviews')}
            >
              Reviews ({details.reviews.summary.totalReviews})
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'overview' && (
              <div className="wallet-requirements">
                <h3>Wallet Requirements</h3>
                {details.walletRequirements.length > 0 ? (
                  <div className="requirements-list">
                    {details.walletRequirements.map((req) => (
                      <div key={req.id} className="requirement-item">
                        <div className="requirement-header">
                          <span className="position">Wallet {req.wallet_position}</span>
                          <span className="role">{req.wallet_role}</span>
                          <span className="balance">{req.min_balance_sol} SOL min</span>
                        </div>
                        {req.description && (
                          <p className="requirement-description">{req.description}</p>
                        )}
                        {req.required_tokens && req.required_tokens.length > 0 && (
                          <div className="required-tokens">
                            <strong>Required tokens:</strong> {req.required_tokens.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No specific wallet requirements specified.</p>
                )}
              </div>
            )}

            {activeTab === 'performance' && (
              <div className="performance-section">
                <div className="performance-metrics">
                  <div className="metric-card">
                    <label>Total ROI</label>
                    <span className={`value ${(details.performance.totalROI || 0) >= 0 ? 'positive' : 'negative'}`}>
                      {formatROI(details.performance.totalROI)}
                    </span>
                  </div>
                  <div className="metric-card">
                    <label>Avg Daily Return</label>
                    <span className={`value ${(details.performance.avgDailyReturn || 0) >= 0 ? 'positive' : 'negative'}`}>
                      {formatROI(details.performance.avgDailyReturn)}
                    </span>
                  </div>
                  <div className="metric-card">
                    <label>Max Drawdown</label>
                    <span className="value negative">
                      {formatROI(details.performance.maxDrawdown)}
                    </span>
                  </div>
                  <div className="metric-card">
                    <label>Win Rate</label>
                    <span className="value">
                      {((details.performance.winRate || 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="metric-card">
                    <label>Total Trades</label>
                    <span className="value">{details.performance.totalTrades}</span>
                  </div>
                </div>

                {details.performance.performanceChart && details.performance.performanceChart.length > 0 && (
                  <div className="performance-chart">
                    <h3>Performance History</h3>
                    <div className="chart-placeholder">
                      <p>Performance chart would be displayed here</p>
                      <small>Chart showing ROI over time for the last 30 days</small>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reviews' && (
              <div className="reviews-section">
                <div className="reviews-summary">
                  <div className="average-rating">
                    <span className="rating-number">{details.reviews.summary.averageRating.toFixed(1)}</span>
                    <div className="stars">
                      {[1, 2, 3, 4, 5].map(star => (
                        <span key={star} className={star <= details.reviews.summary.averageRating ? 'star filled' : 'star'}>
                          ★
                        </span>
                      ))}
                    </div>
                    <span className="total-reviews">({details.reviews.summary.totalReviews} reviews)</span>
                  </div>
                  
                  <div className="rating-distribution">
                    {[5, 4, 3, 2, 1].map(rating => (
                      <div key={rating} className="rating-bar">
                        <span>{rating}★</span>
                        <div className="bar">
                          <div 
                            className="fill" 
                            style={{ 
                              width: `${((details.reviews.summary.ratingDistribution[rating] || 0) / details.reviews.summary.totalReviews) * 100}%` 
                            }}
                          ></div>
                        </div>
                        <span>{details.reviews.summary.ratingDistribution[rating] || 0}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="recent-reviews">
                  <h3>Recent Reviews</h3>
                  {details.reviews.recent.length > 0 ? (
                    <div className="reviews-list">
                      {details.reviews.recent.map((review) => (
                        <div key={review.id} className="review-item">
                          <div className="review-header">
                            <div className="reviewer">
                              {review.reviewer_wallet.slice(0, 8)}...
                            </div>
                            <div className="review-rating">
                              {[1, 2, 3, 4, 5].map(star => (
                                <span key={star} className={star <= review.rating ? 'star filled' : 'star'}>
                                  ★
                                </span>
                              ))}
                            </div>
                            <div className="review-date">
                              {formatDate(review.created_at)}
                            </div>
                          </div>
                          {review.review_text && (
                            <p className="review-text">{review.review_text}</p>
                          )}
                          {review.actual_roi_percentage !== null && (
                            <div className="review-metrics">
                              <span>Actual ROI: {formatROI(review.actual_roi_percentage)}</span>
                              {review.used_duration_days && (
                                <span>Used for: {review.used_duration_days} days</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>No reviews yet. Be the first to review this strategy!</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Publisher Info */}
          <div className="publisher-section">
            <h3>Publisher</h3>
            <div className="publisher-details">
              <div className="publisher-stats">
                <span className="wallet">{details.publisher.wallet.slice(0, 12)}...</span>
                <span className="strategies">{details.publisher.publishedStrategies} strategies</span>
                <span className="downloads">{details.publisher.totalDownloads} total downloads</span>
                <span className="rating">{details.publisher.averageRating.toFixed(1)}★ avg rating</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            Close
          </button>
          {!isOwnStrategy && (
            <button onClick={onAdopt} className="adopt-button">
              Adopt This Strategy
            </button>
          )}
        </div>
      </div>
    </div>
  );
};