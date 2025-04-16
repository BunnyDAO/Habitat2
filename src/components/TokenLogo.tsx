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
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;

  useEffect(() => {
    const loadImage = async () => {
      if (!logoURI) {
        console.log(`[${symbol}] No logoURI provided`);
        setImageUrl(null);
        return;
      }

      setImageError(false); // Reset error state on new URI
      console.log(`[${symbol}] Starting image load from:`, logoURI);

      try {
        // Check if it's an IPFS link that needs resolution
        if (logoURI.includes('/ipfs/') && !logoURI.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
          console.log(`[${symbol}] IPFS link detected, resolving through backend...`);
          const response = await fetch(`/api/v1/token/metadata-image/${encodeURIComponent(logoURI)}`);
          
          if (!response.ok) {
            throw new Error(`Backend request failed: ${response.status}`);
          }

          const data = await response.json();
          
          if (data.error) {
            throw new Error(`Backend error: ${data.error}`);
          }
          
          if (!data.imageUrl) {
            throw new Error('No image URL returned from backend');
          }

          console.log(`[${symbol}] Resolved image URL:`, data.imageUrl);
          setImageUrl(data.imageUrl);
          return;
        }
        
        // If not an IPFS link or it's a direct image link, use directly
        console.log(`[${symbol}] Using direct URL:`, logoURI);
        setImageUrl(logoURI);
      } catch (e) {
        console.error(`[${symbol}] Error:`, e);
        if (retryCount < MAX_RETRIES) {
          console.log(`[${symbol}] Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          setRetryCount(prev => prev + 1);
          // Retry after a delay
          setTimeout(() => {
            setImageError(false);
          }, 1000 * (retryCount + 1));
        } else {
          console.log(`[${symbol}] Max retries reached, showing fallback`);
          setImageError(true);
        }
      }
    };

    loadImage();
  }, [logoURI, symbol, retryCount]);

  if (!imageUrl || imageError) {
    // Fallback to symbol in a colored circle
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
      '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'
    ];
    const colorIndex = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    
    return (
      <div style={{ 
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: colors[colorIndex],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: `${size * 0.4}px`,
        fontWeight: 'bold',
        flexShrink: 0
      }}>
        {symbol.slice(0, 2)}
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
        console.error(`[${symbol}] Failed to load image:`, imageUrl);
        if (retryCount < MAX_RETRIES) {
          console.log(`[${symbol}] Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          setRetryCount(prev => prev + 1);
          // Retry after a delay
          setTimeout(() => {
            setImageError(false);
          }, 1000 * (retryCount + 1));
        } else {
          console.log(`[${symbol}] Max retries reached, showing fallback`);
          setImageError(true);
        }
      }}
    />
  );
}; 