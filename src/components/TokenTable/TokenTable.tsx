import React, { useState, useEffect } from 'react';

interface Token {
  name: string;
  symbol: string;
  price: number;
  marketCap: number;
  mintAddress: string;
  volume24h?: number;
  logoURI?: string;
  createdAt?: string;
  decimals?: number;
}

interface TokenTableProps {
  heliusApiKey?: string;
  onSelectToken?: (mintAddress: string, symbol: string) => void;
  filterType?: 'default' | 'new';
}

const truncateAddress = (address: string) => {
  if (!address) return '';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

// Add PriceCell component at the top level
const PriceCell: React.FC<{ price: number; symbol: string }> = ({ price, symbol }) => {
  const [prevPrice, setPrevPrice] = useState(price);
  const [isChanged, setIsChanged] = useState(false);

  useEffect(() => {
    if (price !== prevPrice) {
      setIsChanged(true);
      setPrevPrice(price);
      
      // Reset the highlight after animation
      const timer = setTimeout(() => {
        setIsChanged(false);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [price, prevPrice]);

  const formatPrice = (value: number, symbol: string) => {
    if (value === 0) return '$0.00';
    
    // Handle stable coins specially
    const isStableCoin = ['USDC', 'USDT', 'PYUSD', 'DAI'].includes(symbol);
    if (isStableCoin) {
      return `$${value.toFixed(2)}`;
    }
    
    // For very small prices, use subscript notation
    if (value < 0.01) {
      // Convert to string and find significant digits
      const priceStr = value.toFixed(12).replace(/\.?0+$/, '');
      const match = priceStr.match(/^0\.0*[1-9]/);
      if (match) {
        // Count leading zeros after decimal
        const leadingZeros = match[0].length - 3; // -3 for "0." and the first non-zero digit
        // Get the remaining significant digits
        const sigDigits = priceStr.slice(match[0].length - 1).slice(0, 4);
        return `$0.0<sub>${leadingZeros}</sub>${sigDigits}`;
      }
    }
    
    // For prices between $0.01 and $1, show 4 significant digits
    if (value < 1) {
      const expStr = value.toFixed(4);
      const trimmed = expStr.replace(/\.?0+$/, '');
      return `$${trimmed}`;
    }
    
    // For prices >= $1, use 3 significant digits
    const expStr = value.toPrecision(3);
    return `$${Number(expStr).toString()}`;
  };

  return (
    <div 
      style={{
        transition: 'transform 0.3s ease-out',
        color: '#e2e8f0',
        transform: isChanged ? 'scale(1.05)' : 'scale(1)',
        display: 'inline-block'
      }}
      dangerouslySetInnerHTML={{ __html: formatPrice(price, symbol) }}
    />
  );
};

// Add this new component before the TokenTable component
const TokenLogo: React.FC<{ logoURI?: string | null; symbol: string; size?: number }> = ({ 
  logoURI, 
  symbol,
  size = 24
}) => {
  const [imgError, setImgError] = useState(false);
  
  // Function to convert IPFS URL to a more reliable gateway
  const getReliableImageUrl = (url: string) => {
    if (!url) return null;
    
    // Handle IPFS URLs
    if (url.includes('ipfs')) {
      const ipfsHash = url.split('/ipfs/')[1];
      if (!ipfsHash) return null;
      // Use multiple IPFS gateways for redundancy
      return [
        `https://ipfs.io/ipfs/${ipfsHash}`,
        `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
        `https://dweb.link/ipfs/${ipfsHash}`
      ];
    }
    
    return [url];
  };

  const urls = logoURI ? getReliableImageUrl(logoURI) : null;
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0);

  const handleError = () => {
    if (urls && currentUrlIndex < urls.length - 1) {
      // Try next URL in the list
      setCurrentUrlIndex(currentUrlIndex + 1);
    } else {
      setImgError(true);
    }
  };

  if (imgError || !urls) {
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
        fontWeight: 'bold'
      }}>
        {symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={urls[currentUrlIndex]}
      alt={`${symbol} logo`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'contain'
      }}
      onError={handleError}
    />
  );
};

export const TokenTable: React.FC<TokenTableProps> = ({ heliusApiKey, onSelectToken, filterType = 'default' }) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [filteredTokens, setFilteredTokens] = useState<Token[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<number>(0);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const PRICE_UPDATE_INTERVAL = 15000; // 15 seconds between batch updates
  const BATCH_SIZE = 5; // Update 5 tokens at a time

  const updatePricesForBatch = async () => {
    try {
      if (tokens.length === 0) return;

      // Check if enough time has passed since last update
      const now = Date.now();
      if (now - lastPriceUpdate < PRICE_UPDATE_INTERVAL) {
        return;
      }
      setLastPriceUpdate(now);

      // Calculate the current batch of tokens to update
      const startIndex = currentBatchIndex * BATCH_SIZE;
      const batch = tokens.slice(startIndex, startIndex + BATCH_SIZE);
      
      // Update index for next batch
      setCurrentBatchIndex((prevIndex) => {
        const nextIndex = prevIndex + 1;
        // Reset to 0 if we've processed all tokens
        return nextIndex * BATCH_SIZE >= tokens.length ? 0 : nextIndex;
      });

      if (batch.length === 0) return;

      // Get addresses of current batch
      const addresses = batch.map(token => token.mintAddress).join(',');
      
      // Fetch only prices for this batch
      const priceResponse = await fetch(
        `https://api.jup.ag/price/v2?ids=${addresses}`
      );
      
      if (!priceResponse.ok) return;
      
      const priceData = await priceResponse.json();
      
      // Update only the tokens in the current batch
      setTokens(currentTokens => 
        currentTokens.map(token => {
          if (!batch.find(b => b.mintAddress === token.mintAddress)) {
            return token; // Keep unchanged if not in current batch
          }
          return {
            ...token,
            price: priceData.data[token.mintAddress]?.price 
              ? parseFloat(priceData.data[token.mintAddress].price)
              : token.price
          };
        })
      );
      
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error updating prices for batch:', error);
    }
  };

  const fetchTokenData = async () => {
    try {
      // Keep existing tokens while refreshing
      setLoading(prevLoading => tokens.length === 0 ? true : prevLoading);
      
      // Fetch top tokens from Jupiter API
      const response = await fetch('https://token.jup.ag/all');
      if (!response.ok) {
        throw new Error('Failed to fetch token list');
      }
      
      const data = await response.json();
      
      console.log('Jupiter API response type:', typeof data);
      console.log('Is array?', Array.isArray(data));
      console.log('Sample of first few tokens:', data.slice(0, 2));
      console.log('Sample token tags:', data[0]?.tags);

      if (!Array.isArray(data)) {
        throw new Error('Invalid token list format');
      }

      // Filter for major verified tokens first (has significant volume/liquidity)
      const majorTokens = data
        .filter((token: any) => {
          if (!token.address || !token.symbol) return false;
          
          // Consider tokens verified if they:
          // 1. Have tags array (indicates they are in Jupiter's list)
          // 2. Are on Solana mainnet
          // 3. Have a valid address and symbol
          const isVerified = 
            Array.isArray(token.tags) && 
            token.chainId === 101 &&
            token.address?.length > 0 &&
            token.symbol?.length > 0;

          // Debug log for specific tokens
          if (token.symbol === 'SOL' || token.symbol === 'BONK') {
            console.log(`Token ${token.symbol} basic verification:`, {
              hasTags: Array.isArray(token.tags),
              chainId: token.chainId,
              hasAddress: token.address?.length > 0,
              hasSymbol: token.symbol?.length > 0,
              isVerified
            });
          }
          
          return isVerified && 
                 token.chainId === 101 && // Solana mainnet
                 !token.name?.toLowerCase().includes('wrapped'); // Exclude wrapped tokens
        })
        // Take top 50 by volume
        .sort((a: any, b: any) => {
          const volumeA = parseFloat(a.volume24h || '0');
          const volumeB = parseFloat(b.volume24h || '0');
          return volumeB - volumeA;
        })
        .slice(0, 50);

      console.log('Found major tokens:', majorTokens.length);
      if (majorTokens.length > 0) {
        console.log('Sample verified token:', majorTokens[0]);
      }

      if (majorTokens.length === 0) {
        throw new Error('No verified tokens found');
      }

      // Split tokens into batches of 10 for price fetching
      const tokenBatches = [];
      for (let i = 0; i < majorTokens.length; i += 10) {
        tokenBatches.push(majorTokens.slice(i, i + 10));
      }

      // Fetch prices for each batch with delay between batches
      const allPriceData: Record<string, any> = {};
      for (const batch of tokenBatches) {
        const addresses = batch.map((t: { address: string }) => t.address).join(',');
        try {
          const priceResponse = await fetch(
            `https://api.jup.ag/price/v2?ids=${addresses}`
          );
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            Object.assign(allPriceData, priceData.data);
          }
          // Add delay between batches to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error('Error fetching batch prices:', error);
          continue;
        }
      }

      // Combine token data with price and volume data
      const tokenData = majorTokens
        .map((token: any) => {
          const priceInfo = allPriceData[token.address];
          const price = priceInfo?.price ? parseFloat(priceInfo.price) : 0;
          
          return {
            name: token.name || token.symbol,
            symbol: token.symbol,
            mintAddress: token.address,
            price,
            marketCap: price * (parseFloat(token.supply) || 0),
            volume24h: parseFloat(token.volume24h) || 0,
            logoURI: token.logoURI || null
          };
        })
        .filter((token: Token) => token.price > 0);

      setTokens(tokenData);
      setFilteredTokens(tokenData);
      setLoading(false);
      setError(null);
      setLastUpdated(new Date());
      setLastPriceUpdate(Date.now());
    } catch (error) {
      console.error('Error fetching token data:', error);
      setError('Failed to load token data');
      setLoading(false);
    }
  };

  const fetchNewTokens = async () => {
    try {
      setLoading(true);
      
      // Fetch new tokens from Jupiter API
      const response = await fetch('https://api.jup.ag/tokens/v1/new');
      if (!response.ok) {
        throw new Error('Failed to fetch new tokens');
      }
      
      const data = await response.json();
      
      // Take top 20 newest tokens
      const newTokens = data
        .slice(0, 20)
        .map((token: any) => ({
          name: token.name || token.symbol,
          symbol: token.symbol,
          mintAddress: token.mint,
          price: 0, // Price will be updated later
          marketCap: 0,
          volume24h: 0,
          logoURI: token.logo_uri || null,
          createdAt: token.created_at,
          decimals: token.decimals || 9 // Default to 9 decimals if not specified
        }));

      setTokens(newTokens);
      setFilteredTokens(newTokens);
      setLoading(false);
      setError(null);
      setLastUpdated(new Date());
      
      // Fetch prices for new tokens
      const updatedTokens = await Promise.all(
        newTokens.map(async (token: Token & { decimals: number }) => {
          try {
            // Try both quote directions with USDC first
            const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
            const solMint = 'So11111111111111111111111111111111111111112';
            
            // Amount for price check (use 1 unit of token)
            const amount = Math.pow(10, token.decimals);

            // Try token -> USDC
            let priceResponse = await fetch(
              `https://quote-api.jup.ag/v6/quote?inputMint=${token.mintAddress}&outputMint=${usdcMint}&amount=${amount}&slippageBps=50`
            );

            // If failed, try USDC -> token
            if (!priceResponse.ok) {
              priceResponse = await fetch(
                `https://quote-api.jup.ag/v6/quote?inputMint=${usdcMint}&outputMint=${token.mintAddress}&amount=1000000&slippageBps=50`
              );
              
              if (priceResponse.ok) {
                const quoteData = await priceResponse.json();
                if (quoteData.outAmount) {
                  // Calculate price: 1 USDC / (outAmount in token units)
                  const priceInUSD = 1 / (Number(quoteData.outAmount) / Math.pow(10, token.decimals));
                  return {
                    ...token,
                    price: priceInUSD
                  };
                }
              }

              // If USDC pairs fail, try SOL pairs
              // Try token -> SOL first
              priceResponse = await fetch(
                `https://quote-api.jup.ag/v6/quote?inputMint=${token.mintAddress}&outputMint=${solMint}&amount=${amount}&slippageBps=50`
              );

              if (!priceResponse.ok) {
                // Try SOL -> token
                priceResponse = await fetch(
                  `https://quote-api.jup.ag/v6/quote?inputMint=${solMint}&outputMint=${token.mintAddress}&amount=1000000000&slippageBps=50`
                );

                if (priceResponse.ok) {
                  const quoteData = await priceResponse.json();
                  if (quoteData.outAmount) {
                    // Get current SOL price
                    const solPriceResponse = await fetch(
                      `https://price.jup.ag/v4/price?ids=${solMint}`
                    );
                    if (solPriceResponse.ok) {
                      const solPriceData = await solPriceResponse.json();
                      const solPrice = solPriceData.data[solMint]?.price || 0;
                      
                      // Calculate price: 1 SOL / (outAmount in token units) * SOL price
                      const priceInUSD = (1 / (Number(quoteData.outAmount) / Math.pow(10, token.decimals))) * solPrice;
                      return {
                        ...token,
                        price: priceInUSD
                      };
                    }
                  }
                }
              } else {
                // Token -> SOL quote succeeded
                const quoteData = await priceResponse.json();
                if (quoteData.outAmount) {
                  // Get current SOL price
                  const solPriceResponse = await fetch(
                    `https://price.jup.ag/v4/price?ids=${solMint}`
                  );
                  if (solPriceResponse.ok) {
                    const solPriceData = await solPriceResponse.json();
                    const solPrice = solPriceData.data[solMint]?.price || 0;
                    
                    // Calculate price: (outAmount in SOL) * SOL price / input amount
                    const priceInUSD = (Number(quoteData.outAmount) / 1e9) * solPrice;
                    return {
                      ...token,
                      price: priceInUSD
                    };
                  }
                }
              }
            } else {
              // Token -> USDC quote succeeded
              const quoteData = await priceResponse.json();
              if (quoteData.outAmount) {
                // Calculate price: outAmount in USDC / input amount
                const priceInUSD = Number(quoteData.outAmount) / 1e6;
                return {
                  ...token,
                  price: priceInUSD
                };
              }
            }
          } catch (error) {
            console.error(`Error fetching price for token ${token.symbol}:`, error);
          }
          
          // Return original token if price fetch failed
          return token;
        })
      );

      setTokens(updatedTokens);
      setFilteredTokens(updatedTokens);
    } catch (error) {
      console.error('Error fetching new tokens:', error);
      setError('Failed to load new tokens');
      setLoading(false);
    }
  };

  // Modify the initial fetch to handle both default and new tokens
  useEffect(() => {
    if (filterType === 'new') {
      fetchNewTokens();
    } else {
      fetchTokenData();
    }
  }, [filterType]);

  // Set up rotating batch updates
  useEffect(() => {
    if (tokens.length === 0) return;

    const intervalId = setInterval(updatePricesForBatch, PRICE_UPDATE_INTERVAL);
    return () => clearInterval(intervalId);
  }, [tokens.length]);

  // Add search filter function
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTokens(tokens);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = tokens.filter(token => 
      token.name.toLowerCase().includes(query) ||
      token.symbol.toLowerCase().includes(query) ||
      token.mintAddress.toLowerCase().includes(query)
    );
    setFilteredTokens(filtered);
  }, [searchQuery, tokens]);

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const formatCompactNumber = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toFixed(1);
  };

  if (loading) {
    return (
      <div style={{ padding: '1rem', backgroundColor: '#1e293b', borderRadius: '0.5rem' }}>
        <div style={{ color: '#94a3b8' }}>Loading token data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', backgroundColor: '#1e293b', borderRadius: '0.5rem' }}>
        <div style={{ color: '#ef4444' }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '0.75rem',
      backgroundColor: '#1e293b',
      borderRadius: '0.5rem',
      width: '100%'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '0.75rem',
        gap: '1rem'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <h2 style={{ 
            color: '#e2e8f0', 
            fontSize: '1rem', 
            fontWeight: 600,
            margin: 0,
            whiteSpace: 'nowrap'
          }}>Solana Tokens</h2>
          {lastUpdated && (
            <span style={{ 
              color: '#94a3b8',
              fontSize: '0.75rem'
            }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div style={{ 
          flex: 1,
          maxWidth: '300px',
          marginLeft: '-0.5rem'
        }}>
          <input
            type="text"
            placeholder="Search by name or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.375rem 0.75rem',
              backgroundColor: '#2d3748',
              border: '1px solid #4a5568',
              borderRadius: '0.25rem',
              color: '#e2e8f0',
              fontSize: '0.875rem',
              outline: 'none',
              transition: 'all 0.2s'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#3b82f6';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#4a5568';
            }}
          />
        </div>
      </div>
      <table style={{ 
        width: '100%',
        borderCollapse: 'collapse',
        color: '#e2e8f0',
        fontSize: '0.8125rem'
      }}>
        <thead>
          <tr style={{ fontSize: '0.75rem' }}>
            <th style={{ 
              textAlign: 'left',
              padding: '0.5rem',
              borderBottom: '1px solid #2d3748',
              color: '#94a3b8',
              fontWeight: 500
            }}>Token</th>
            <th style={{ 
              textAlign: 'right',
              padding: '0.5rem',
              borderBottom: '1px solid #2d3748',
              color: '#94a3b8',
              fontWeight: 500
            }}>Price</th>
            <th style={{ 
              textAlign: 'right',
              padding: '0.5rem',
              borderBottom: '1px solid #2d3748',
              color: '#94a3b8',
              fontWeight: 500
            }}>24h Vol</th>
            <th style={{ 
              textAlign: 'right',
              padding: '0.5rem',
              borderBottom: '1px solid #2d3748',
              color: '#94a3b8',
              fontWeight: 500
            }}>Mkt Cap</th>
          </tr>
        </thead>
        <tbody>
          {filteredTokens.map((token) => (
            <tr 
              key={token.mintAddress}
              onClick={() => onSelectToken?.(token.mintAddress, token.symbol)}
              style={{
                cursor: onSelectToken ? 'pointer' : 'default',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2d3748';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <td style={{ 
                padding: '0.5rem',
                borderBottom: '1px solid #2d3748',
                whiteSpace: 'nowrap'
              }}>
                <div style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <TokenLogo 
                    logoURI={token.logoURI} 
                    symbol={token.symbol} 
                    size={24}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{token.symbol}</div>
                    <div style={{ 
                      fontSize: '0.75rem',
                      color: '#94a3b8'
                    }}>{token.name}</div>
                  </div>
                </div>
              </td>
              <td style={{ 
                textAlign: 'right',
                padding: '0.5rem',
                borderBottom: '1px solid #2d3748'
              }}>
                <PriceCell price={token.price} symbol={token.symbol} />
              </td>
              <td style={{ 
                textAlign: 'right',
                padding: '0.5rem',
                borderBottom: '1px solid #2d3748'
              }}>
                ${formatCompactNumber(token.volume24h || 0)}
              </td>
              <td style={{ 
                textAlign: 'right',
                padding: '0.5rem',
                borderBottom: '1px solid #2d3748'
              }}>
                ${formatCompactNumber(token.marketCap)}
              </td>
            </tr>
          ))}
          {filteredTokens.length === 0 && (
            <tr>
              <td 
                colSpan={4} 
                style={{ 
                  textAlign: 'center', 
                  padding: '1rem',
                  color: '#94a3b8'
                }}
              >
                No tokens found matching your search
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}; 