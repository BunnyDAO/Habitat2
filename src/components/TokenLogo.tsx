import React, { useState, useEffect } from 'react';

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const loadImage = async () => {
      if (!logoURI) {
        setImageUrl(null);
        return;
      }

      try {
        // First try to fetch the content
        const response = await fetch(logoURI);
        const contentType = response.headers.get('content-type');
        
        // Try to parse as JSON first
        if (contentType?.includes('json') || contentType?.includes('text')) {
          try {
            const data = await response.json();
            if (data.image) {
              console.log(`Found image URL in JSON for ${symbol}:`, data.image);
              // Try to load the image URL
              const imgResponse = await fetch(data.image);
              if (imgResponse.ok) {
                setImageUrl(data.image);
                return;
              }
            }
          } catch (e) {
            console.log(`Failed to parse JSON for ${symbol}, trying as image`);
          }
        }

        // If we get here, try to use the URL directly
        const imgResponse = await fetch(logoURI);
        if (imgResponse.ok) {
          setImageUrl(logoURI);
        } else {
          throw new Error('Failed to load image');
        }
      } catch (error) {
        console.warn(`Error loading image for ${symbol}:`, error);
        setImageError(true);
      }
    };

    loadImage();
  }, [logoURI, symbol]);

  if (!imageUrl || imageError) {
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
      src={imageUrl}
      alt={`${symbol} logo`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        backgroundColor: '#2d3748',
        flexShrink: 0
      }}
      onError={() => {
        console.error(`Failed to load image for ${symbol}:`, imageUrl);
        setImageError(true);
      }}
    />
  );
}; 