import React from 'react';

interface ProfitBarProps {
  profit: number;  // Current profit percentage
  width?: string;  // Optional width override
  height?: string; // Optional height override
}

const ProfitBar: React.FC<ProfitBarProps> = ({ 
  profit, 
  width = '100%', 
  height = '4px'  // Thin bar by default
}) => {
  // Convert profit to a percentage for the bar (-100 to +100)
  // If profit is beyond these bounds, we'll cap it for display purposes
  const displayProfit = Math.max(-100, Math.min(100, profit));
  
  // Calculate the width percentage for the profit/loss bar
  const barWidth = Math.abs(displayProfit);
  
  // Determine if we're showing profit (green) or loss (red)
  const isProfit = displayProfit >= 0;
  
  return (
    <div style={{
      position: 'relative',
      width,
      height,
      backgroundColor: '#1e293b', // Dark background
      borderRadius: '2px',
      overflow: 'hidden',
      marginTop: '4px'
    }}>
      {/* Center line */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: '1px',
        backgroundColor: '#4b5563', // Gray center line
        transform: 'translateX(-50%)',
        zIndex: 1
      }} />
      
      {/* Profit/Loss bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: `${barWidth}%`,
        backgroundColor: isProfit ? '#22c55e' : '#ef4444', // Green for profit, red for loss
        left: isProfit ? '50%' : `${50 - barWidth}%`,
        transition: 'all 0.3s ease-in-out'
      }} />
      
      {/* Percentage label */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#94a3b8',
        fontSize: '10px',
        fontWeight: 'bold',
        whiteSpace: 'nowrap',
        textShadow: '0 0 2px rgba(0,0,0,0.5)',
        zIndex: 2,
        opacity: 0,
        transition: 'opacity 0.2s',
        pointerEvents: 'none'
      }}>
        {displayProfit > 0 ? '+' : ''}{displayProfit.toFixed(2)}%
      </div>
    </div>
  );
};

export default ProfitBar; 