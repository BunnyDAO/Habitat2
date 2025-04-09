import React from 'react';

export type TimeFilterType = '5m' | '1h' | '6h' | '24h' | '3D' | '7D';
export type MainFilterType = 'trending' | 'top' | 'gainers' | 'new';
export type TopFilterType = 'volume' | 'txns';
export type NewPairsFilterType = 'newest' | TimeFilterType;
export type TokenFilterType = MainFilterType | TimeFilterType | TopFilterType | 'newest';

interface TokenFilterButtonsProps {
  selectedFilter: MainFilterType;
  selectedTimeFilter: TimeFilterType;
  selectedTopFilter: TopFilterType;
  selectedNewPairsFilter: NewPairsFilterType;
  onFilterChange: (filter: TokenFilterType, filterType: 'main' | 'time' | 'top' | 'newPairs') => void;
}

export const TokenFilterButtons: React.FC<TokenFilterButtonsProps> = ({
  selectedFilter,
  selectedTimeFilter,
  selectedTopFilter,
  selectedNewPairsFilter,
  onFilterChange
}) => {
  // Common styles
  const buttonBaseStyle = {
    padding: '0.5rem 1rem',
    borderRadius: '0.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    background: 'rgba(30, 41, 59, 0.8)',
    backdropFilter: 'blur(8px)',
    color: '#94a3b8',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    height: '2.5rem'
  };

  const selectedStyle = {
    background: 'rgba(59, 130, 246, 0.15)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
    color: '#60a5fa'
  };

  const smallButtonStyle = {
    ...buttonBaseStyle,
    padding: '0.25rem 0.75rem',
    height: '2rem',
    fontSize: '0.75rem'
  };

  // SVG icons with consistent sizing
  const icons = {
    trending: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 3L12 7L7 3M12 7V21" />
      </svg>
    ),
    top: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="M18 9l-5 5-4-4-4 4" />
      </svg>
    ),
    gainers: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 17l5-5 4 4 4-4" />
        <path d="M17 8l3 3-3 3" />
      </svg>
    ),
    new: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L8 6 12 10 16 6z" />
        <path d="M12 10v12" />
      </svg>
    )
  };

  const renderSubFilters = () => {
    const subFiltersStyle = {
      position: 'absolute' as const,
      top: '3.5rem',
      left: 0,
      display: 'flex',
      gap: '0.5rem',
      zIndex: 10
    };

    switch (selectedFilter) {
      case 'trending':
      case 'gainers':
        return (
          <div style={subFiltersStyle}>
            {['5m', '1h', '6h', '24h'].map((time) => (
              <button
                key={time}
                style={{
                  ...smallButtonStyle,
                  ...(selectedTimeFilter === time ? selectedStyle : {})
                }}
                onClick={() => onFilterChange(time as TimeFilterType, 'time')}
              >
                {time}
              </button>
            ))}
          </div>
        );
      
      case 'new':
        return (
          <div style={subFiltersStyle}>
            {['newest', '1h', '6h', '24h', '3D', '7D'].map((filter) => (
              <button
                key={filter}
                style={{
                  ...smallButtonStyle,
                  ...(selectedNewPairsFilter === filter ? selectedStyle : {})
                }}
                onClick={() => onFilterChange(filter as NewPairsFilterType, 'newPairs')}
              >
                {filter}
              </button>
            ))}
          </div>
        );
      
      case 'top':
        return (
          <div style={subFiltersStyle}>
            {['volume', 'txns'].map((metric) => (
              <button
                key={metric}
                style={{
                  ...smallButtonStyle,
                  ...(selectedTopFilter === metric ? selectedStyle : {})
                }}
                onClick={() => onFilterChange(metric as TopFilterType, 'top')}
              >
                {metric.charAt(0).toUpperCase() + metric.slice(1)}
              </button>
            ))}
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div style={{ 
      position: 'relative',
      paddingBottom: '3rem'
    }}>
      {/* Main filter buttons */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          style={{
            ...buttonBaseStyle,
            ...(selectedFilter === 'trending' ? selectedStyle : {})
          }}
          onClick={() => onFilterChange('trending', 'main')}
        >
          {icons.trending}
          Trending
        </button>
        <button
          style={{
            ...buttonBaseStyle,
            ...(selectedFilter === 'top' ? selectedStyle : {})
          }}
          onClick={() => onFilterChange('top', 'main')}
        >
          {icons.top}
          Top
        </button>
        <button
          style={{
            ...buttonBaseStyle,
            ...(selectedFilter === 'gainers' ? selectedStyle : {})
          }}
          onClick={() => onFilterChange('gainers', 'main')}
        >
          {icons.gainers}
          Gainers
        </button>
        <button
          style={{
            ...buttonBaseStyle,
            ...(selectedFilter === 'new' ? selectedStyle : {})
          }}
          onClick={() => onFilterChange('new', 'main')}
        >
          {icons.new}
          New Pairs
        </button>
      </div>

      {/* Render sub-filters based on selected main filter */}
      {renderSubFilters()}
    </div>
  );
}; 