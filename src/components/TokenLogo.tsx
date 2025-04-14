import React, { useState } from 'react';

interface TokenLogoProps {
  logoURI?: string | null;
  symbol: string;
  size?: number;
}

export const TokenLogo: React.FC<TokenLogoProps> = ({ 
  logoURI, 
  symbol, 
  size = 24 
}) => {
  const [imageError, setImageError] = useState(false);

  if (!logoURI || imageError) {
    return (
      <div style={{ 
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#2d3748',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#e2e8f0',
        fontSize: `${size * 0.5}px`,
        fontWeight: 500,
        flexShrink: 0
      }}>
        {symbol.charAt(0)}
      </div>
    );
  }

  return (
    <img 
      src={logoURI}
      alt={`${symbol} logo`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        backgroundColor: '#2d3748',
        flexShrink: 0
      }}
      onError={() => setImageError(true)}
    />
  );
}; 