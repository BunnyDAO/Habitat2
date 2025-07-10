import React from 'react';
import { PublishedStrategyWithMetrics } from '../../types/strategy-marketplace';
import { WalletMonitorIcon } from '../WalletMonitorIcon';
import { PriceMonitorIcon, VaultIcon, LevelsIcon } from '../StrategyIcons';

interface StrategyCardProps {
  strategy: PublishedStrategyWithMetrics;
  onView: () => void;
  onAdopt: () => void;
  currentUserWallet?: string;
}

export const StrategyCard: React.FC<StrategyCardProps> = ({ 
  strategy, 
  onView, 
  onAdopt, 
  currentUserWallet 
}) => {
  const isOwnStrategy = currentUserWallet === strategy.publisher_wallet;

  const getStrategyIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'wallet-monitor':
        return <WalletMonitorIcon isActive={true} onClick={() => {}} />;
      case 'price-monitor':
        return <PriceMonitorIcon />;
      case 'vault':
        return <VaultIcon />;
      case 'levels':
        return <LevelsIcon />;
      default:
        return <div className="strategy-icon-placeholder">📊</div>;
    }
  };

  const formatROI = (roi?: number) => {
    if (roi === undefined || roi === null) return 'N/A';
    return `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
  };

  const formatWinRate = (winRate?: number) => {
    if (winRate === undefined || winRate === null) return 'N/A';
    return `${(winRate * 100).toFixed(1)}%`;
  };

  const formatPrice = (price: number, isFree: boolean) => {
    if (isFree) return 'Free';
    return `${price} SOL`;
  };

  const renderRating = (rating: number, reviewCount: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <span key={i} className={i <= rating ? 'star filled' : 'star'}>
          ★
        </span>
      );
    }
    return (
      <div className="rating">
        {stars}
        <span className="review-count">({reviewCount})</span>
      </div>
    );
  };

  return (
    <div className="strategy-card">
      <div className="card-header">
        <div className="strategy-icon">
          {getStrategyIcon(strategy.strategy_type)}
        </div>
        <div className="strategy-info">
          <h3 className="strategy-title">{strategy.title}</h3>
          <p className="strategy-category">{strategy.category}</p>
        </div>
        <div className="strategy-price">
          {formatPrice(strategy.price_sol, strategy.is_free)}
        </div>
      </div>

      <div className="card-body">
        <p className="strategy-description">{strategy.description}</p>
        
        <div className="strategy-tags">
          {strategy.tags?.slice(0, 3).map((tag, index) => (
            <span key={index} className="strategy-tag">
              {tag}
            </span>
          ))}
          {strategy.tags && strategy.tags.length > 3 && (
            <span className="tag-more">+{strategy.tags.length - 3}</span>
          )}
        </div>

        <div className="strategy-metrics">
          <div className="metric">
            <label>ROI</label>
            <span className={`value ${(strategy.total_roi_percentage || 0) >= 0 ? 'positive' : 'negative'}`}>
              {formatROI(strategy.total_roi_percentage)}
            </span>
          </div>
          <div className="metric">
            <label>Win Rate</label>
            <span className="value">{formatWinRate(strategy.win_rate)}</span>
          </div>
          <div className="metric">
            <label>Wallets</label>
            <span className="value">{strategy.required_wallets}</span>
          </div>
          <div className="metric">
            <label>Downloads</label>
            <span className="value">{strategy.downloads}</span>
          </div>
        </div>

        <div className="strategy-rating">
          {renderRating(strategy.rating, strategy.review_count)}
        </div>

        <div className="publisher-info">
          <span className="publisher-label">By:</span>
          <span className="publisher-wallet">
            {strategy.publisher_name || `${strategy.publisher_wallet.slice(0, 8)}...`}
          </span>
        </div>
      </div>

      <div className="card-footer">
        <button onClick={onView} className="view-button">
          View Details
        </button>
        {!isOwnStrategy && (
          <button onClick={onAdopt} className="adopt-button">
            Adopt Strategy
          </button>
        )}
        {isOwnStrategy && (
          <span className="own-strategy-label">Your Strategy</span>
        )}
      </div>
    </div>
  );
};